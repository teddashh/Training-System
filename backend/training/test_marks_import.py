import csv
import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from unittest.mock import patch

from django.core.management import call_command
from django.db import connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .marks_import import COLUMNS, MAX_BYTES
from .models import (
    Attempt,
    AttemptBudget,
    AuditEvent,
    ExamPreview,
    Invitation,
    LearningAssignment,
    MarksImport,
    Question,
    User,
)
from .operations import assignment_rows
from .reporting import question_analysis
from .services import (
    apply_manual_grades,
    finalize,
    hash_token,
    identity_for_user,
    resolve_identity,
    start_attempt,
)
from .tests import make_exam


def sheet(rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def mark_row(attempt, qid=None, **changes):
    attempt.refresh_from_db()
    return {
        "attempt_id": str(attempt.pk),
        "question_id": qid or attempt.snapshot[0]["id"],
        "answer_revision": attempt.answer_revision,
        "grading_revision": attempt.grading_revision,
        "points": "10",
        "feedback": "Reviewed offline",
        **changes,
    }


@override_settings(DEBUG=True)
class MarksImportTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("marks-owner", role="instructor")
        self.learner = User.objects.create_user("marks-learner", "marks@example.com")
        self.exam = make_exam(self.owner, essay=True)
        self.attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        self.attempt.answers = {
            str(self.attempt.snapshot[0]["id"]): 0,
            str(self.attempt.snapshot[1]["id"]): "Original response",
        }
        finalize(self.attempt)
        self.choice, self.essay = [q["id"] for q in self.attempt.snapshot]
        self.invite = Invitation.objects.create(
            exam=self.exam,
            identity=resolve_identity("marks-guest@example.com"),
            token_hash=hash_token("marks-guest"),
            max_attempts=1,
            expires_at=timezone.now() + timedelta(days=1),
            created_by=self.owner,
        )
        self.guest = start_attempt(self.exam.pk, self.invite.identity, self.invite)
        finalize(self.guest)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.root = f"/api/exams/{self.exam.pk}/marks/"

    def preview(self, rows=None, **changes):
        return self.client.post(
            self.root + "imports/",
            {
                "csv": sheet(rows or [mark_row(self.attempt, self.essay, points="40")]),
                "reason": "Moderated marks",
                **changes,
            },
            format="json",
        )

    def apply(self, data):
        return self.client.post(
            self.root + "imports/" + data["id"] + "/", {}, format="json"
        )

    def test_template_is_scoped_frozen_filtered_private_and_spreadsheet_safe(self):
        self.attempt.snapshot[0]["description"] = ' \n=HYPERLINK("bad")'
        self.attempt.manual_grades[str(self.choice)] = {
            "points": 0,
            "feedback": "+formula\nquoted, text",
        }
        self.attempt.save()
        self.exam.questions.filter(pk=self.choice).update(
            description="Changed current question", points=1
        )
        preview = self.client.post(
            f"/api/exams/{self.exam.pk}/previews/", {"mode": "unrestricted"}
        )
        self.assertEqual(preview.status_code, 201)
        response = self.client.get(
            self.root + "template/", {"search": "marks-learner", "number": 1}
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["question"], '\' \n=HYPERLINK("bad")')
        self.assertEqual(rows[0]["maximum_points"], "60")
        self.assertTrue(rows[0]["current_feedback"].startswith("'+formula"))
        self.assertTrue(all(not row["points"] and not row["feedback"] for row in rows))
        self.assertEqual({row["attempt_id"] for row in rows}, {str(self.attempt.pk)})
        self.assertEqual(
            self.client.get(
                self.root + "template/", {"status": "in_progress"}
            ).status_code,
            400,
        )
        self.assertEqual(
            self.preview(csv=response.content.decode("utf-8-sig")).status_code, 400
        )

    def test_preview_changes_nothing_and_apply_updates_account_guest_reports_and_completion_once(
        self,
    ):
        assignment = LearningAssignment.objects.create(
            user=self.learner, exam=self.exam, created_by=self.owner
        )
        before = {
            str(a.pk): Attempt.objects.values().get(pk=a.pk)
            for a in (self.attempt, self.guest)
        }
        budgets = list(AttemptBudget.objects.order_by("pk").values())
        self.invite.refresh_from_db()
        used = self.invite.used
        rows = [
            mark_row(
                a, qid, points=points, feedback='CSV feedback\nWith comma, and quote "'
            )
            for a in (self.attempt, self.guest)
            for qid, points in ((self.choice, "60"), (self.essay, "40"))
        ]
        response = self.preview(rows)
        self.assertEqual(response.status_code, 201, response.data)
        data = response.data
        self.assertEqual((data["row_count"], data["attempt_count"]), (4, 2))
        self.assertEqual({x["after"]["score"] for x in data["outcomes"]}, {100})
        for a in (self.attempt, self.guest):
            self.assertEqual(Attempt.objects.values().get(pk=a.pk), before[str(a.pk)])
        applied = self.apply(data)
        self.assertEqual(applied.status_code, 200)
        self.assertEqual(applied.data["status"], "applied")
        for a in (self.attempt, self.guest):
            a.refresh_from_db()
            self.assertEqual(
                (a.status, a.score, a.passed, a.grading_revision),
                ("graded", 100, True, 1),
            )
            for field in (
                "answers",
                "snapshot",
                "answer_revision",
                "submitted_at",
                "number",
                "deadline",
                "last_seen_at",
                "last_saved_at",
            ):
                self.assertEqual(getattr(a, field), before[str(a.pk)][field])
        self.assertEqual(list(AttemptBudget.objects.order_by("pk").values()), budgets)
        self.invite.refresh_from_db()
        self.assertEqual(self.invite.used, used)
        self.assertEqual(assignment_rows([assignment])[0]["status"], "completed")
        stats = question_analysis(Attempt.objects.filter(exam=self.exam))
        self.assertTrue(stats)
        self.assertEqual(self.apply(data).data, applied.data)
        self.assertEqual(
            AuditEvent.objects.filter(action="marks.import_applied").count(), 1
        )
        self.assertEqual(
            AuditEvent.objects.filter(action="attempt.marks_imported").count(), 2
        )
        self.assertEqual(MarksImport.objects.get().reason, "Moderated marks")

    def test_all_seven_question_types_support_bounded_overrides_and_shared_analysis(
        self,
    ):
        shapes = [
            {"type": "single", "options": ["A", "B"], "solution": [1]},
            {"type": "multiple", "options": ["A", "B"], "solution": [0, 1]},
            {"type": "short", "solution": ["correct"]},
            {"type": "essay"},
            {"type": "integer", "solution": ["42"]},
            {"type": "numeric", "solution": ["1.5"], "answer_tolerances": ["0.1"]},
            {"type": "ordering", "options": ["A", "B"], "solution": [0, 1]},
        ]
        self.exam.questions.all().delete()
        for shape in shapes:
            Question.objects.create(
                exam=self.exam, description=shape["type"], points=10, **shape
            )
        attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        finalize(attempt)
        data = self.preview(
            [mark_row(attempt, q["id"], points="4.5") for q in attempt.snapshot]
        ).data
        self.assertEqual(self.apply(data).status_code, 200)
        attempt.refresh_from_db()
        self.assertEqual((attempt.status, attempt.score), ("graded", 45))
        stats = question_analysis(Attempt.objects.filter(pk=attempt.pk))
        self.assertEqual(len(stats), 7)
        self.assertTrue(all(row["average_points"] == 4.5 for row in stats))

    def test_feedback_only_preserves_pending_or_automatic_scores_and_clear_is_explicit(
        self,
    ):
        data = self.preview(
            [
                mark_row(self.attempt, qid, points="", feedback="Feedback only")
                for qid in (self.choice, self.essay)
            ]
        ).data
        self.apply(data)
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.status, "pending_review")
        self.assertIsNone(self.attempt.manual_grades[str(self.essay)]["points"])
        self.assertIsNone(self.attempt.manual_grades[str(self.choice)]["points"])
        data = self.preview(
            [mark_row(self.attempt, self.essay, points="35", feedback="")]
        ).data
        self.apply(data)
        self.attempt.refresh_from_db()
        self.assertEqual(
            self.attempt.manual_grades[str(self.essay)]["feedback"], "Feedback only"
        )
        data = self.preview(
            [
                mark_row(
                    self.attempt,
                    self.essay,
                    points="",
                    feedback="",
                    clear_feedback="true",
                )
            ]
        ).data
        self.apply(data)
        self.attempt.refresh_from_db()
        self.assertEqual(
            self.attempt.manual_grades[str(self.essay)],
            {"points": 35.0, "feedback": "", "source": "csv"},
        )
        self.assertEqual(self.attempt.score, 35)

    def test_invalid_rows_reject_the_entire_preview_without_creating_evidence_or_grades(
        self,
    ):
        valid = mark_row(self.attempt, self.essay)
        for invalid in (
            {"points": "-1"},
            {"points": "41"},
            {"points": "NaN"},
            {"points": "Infinity"},
            {"points": "0.0000001"},
            {"points": "1,5"},
            {"points": "1e999"},
            {"question_id": 999999},
            {"attempt_id": str(uuid.uuid4())},
            {"attempt_id": "invalid"},
            {"grading_revision": "true"},
            {"feedback": "x" * 5001},
            {"clear_feedback": "true"},
        ):
            response = self.preview(
                [mark_row(self.guest, self.essay), {**valid, **invalid}]
            )
            self.assertEqual(response.status_code, 200, invalid)
            self.assertFalse(response.data["valid"], invalid)
            self.assertTrue(response.data["errors"])
            self.assertFalse(MarksImport.objects.exists())
        self.assertFalse(self.preview([valid, valid]).data["valid"])
        for a in (self.attempt, self.guest):
            a.refresh_from_db()
            self.assertEqual(a.manual_grades, {})

    def test_malformed_headers_size_row_limits_and_blank_rows_are_handled(self):
        valid = sheet([mark_row(self.attempt)])
        bad = [
            "",
            valid.replace("attempt_id,", "unknown,"),
            valid.replace("question_id,", "attempt_id,"),
            valid + "broken,row\n",
            valid + '"unclosed',
            valid + "\x00",
            "x" * (MAX_BYTES + 1),
            sheet([mark_row(self.attempt)] * 501),
            valid.replace(",clear_feedback", ",another_column"),
        ]
        for content in bad:
            self.assertEqual(self.preview(csv=content).status_code, 400)
        unchanged = mark_row(self.guest, points="", feedback="")
        data = self.preview(
            csv="\ufeff" + sheet([unchanged, mark_row(self.attempt)]) + "\n"
        ).data
        self.assertTrue(data["valid"])
        self.assertEqual((data["skipped"], data["row_count"]), (1, 1))

    def test_import_and_template_bounds_do_not_silently_truncate_records(self):
        rows = [
            mark_row(self.attempt, attempt_id=str(uuid.uuid4())) for _ in range(101)
        ]
        self.assertEqual(self.preview(rows).status_code, 400)
        copies = [
            Attempt(
                exam=self.exam,
                identity=self.attempt.identity,
                number=n,
                status="pending_review",
                snapshot=self.attempt.snapshot,
                pass_score=70,
                deadline=self.attempt.deadline,
                submitted_at=timezone.now(),
            )
            for n in range(2, 101)
        ]
        Attempt.objects.bulk_create(copies)
        self.assertEqual(self.client.get(self.root + "template/").status_code, 400)
        self.assertEqual(
            self.client.get(
                self.root + "template/", {"search": "marks-guest"}
            ).status_code,
            200,
        )
        copies[-1].delete()
        large = [{**q, "description": "x" * 5000} for q in self.attempt.snapshot]
        Attempt.objects.update(snapshot=large)
        self.assertEqual(self.client.get(self.root + "template/").status_code, 400)

    def test_pending_preview_limit_localization_and_feedback_privacy(self):
        for _ in range(20):
            self.assertEqual(self.preview().status_code, 201)
        response = self.preview()
        self.assertEqual(response.status_code, 400)
        self.assertIn("20", str(response.data))
        self.client.credentials(HTTP_ACCEPT_LANGUAGE="es")
        response = self.preview([mark_row(self.attempt, self.essay, points=999)])
        self.assertIn("La nota", response.data["errors"][0]["message"])
        job = MarksImport.objects.first()
        self.assertEqual(self.apply({"id": str(job.pk)}).status_code, 200)
        self.exam.allow_response_review = False
        self.exam.save()
        learner = APIClient()
        learner.force_authenticate(self.learner)
        result = learner.get(f"/api/attempts/{self.attempt.pk}/")
        self.assertEqual(result.data["manual_grades"], {})
        self.assertEqual(result.data["questions"], [])

    def test_old_spreadsheets_and_stale_previews_cannot_overwrite_grading(self):
        rows = [mark_row(a, self.essay, points=30) for a in (self.attempt, self.guest)]
        data = self.preview(rows).data
        apply_manual_grades(
            self.attempt, {str(self.essay): {"points": 25, "feedback": "New review"}}
        )
        self.assertFalse(self.preview(rows).data["valid"])
        response = self.apply(data)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "stale_marks_preview")
        self.guest.refresh_from_db()
        self.assertEqual(self.guest.manual_grades, {})
        self.assertEqual(MarksImport.objects.get(pk=data["id"]).status, "stale")
        self.assertEqual(self.apply(data).status_code, 409)

    def test_reopening_invalidates_spreadsheet_and_preview_and_preserves_imported_evidence(
        self,
    ):
        first = self.preview().data
        self.apply(first)
        row = mark_row(self.attempt, self.essay)
        preview = self.preview([row]).data
        self.attempt.refresh_from_db()
        response = self.client.post(
            f"/api/attempts/{self.attempt.pk}/reopenings/",
            {
                "request_id": str(uuid.uuid4()),
                "minutes": 5,
                "reason": "Recovery",
                "answer_revision": self.attempt.answer_revision,
                "submitted_at": self.attempt.submitted_at.isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.apply(preview).status_code, 409)
        self.assertFalse(self.preview([row]).data["valid"])
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.manual_grades, {})
        self.assertEqual(self.apply(first).status_code, 200)
        self.assertEqual(self.attempt.status, "in_progress")

    def test_review_revision_prevents_stale_forms_and_keeps_automatic_imports(self):
        data = self.preview(
            [
                mark_row(self.attempt, self.choice, points=20),
                mark_row(self.attempt, self.essay, points=30),
            ]
        ).data
        self.apply(data)
        url = f"/api/results/{self.attempt.pk}/review/"
        for version in ({}, {"grading_revision": 0}, {"grading_revision": True}):
            response = self.client.post(
                url,
                {"grades": {str(self.essay): {"points": 40}}, **version},
                format="json",
            )
            self.assertEqual(response.status_code, 409)
        current = self.client.get(url).data
        response = self.client.post(
            url,
            {
                "grading_revision": current["grading_revision"],
                "grades": {str(self.essay): {"points": 40}},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["score"], 60)
        self.assertEqual(response.data["manual_grades"][str(self.choice)]["points"], 20)
        self.assertNotIn("source", response.data["manual_grades"][str(self.essay)])
        self.assertEqual(self.apply(data).data["outcomes"][0]["after"]["score"], 50)

    def test_scopes_csrf_and_history_do_not_expose_or_modify_unrelated_papers(self):
        data = self.preview().data
        path = self.root + "imports/" + data["id"] + "/"
        self.assertIn("no-store", self.client.get(path)["Cache-Control"])
        for user in (
            self.learner,
            User.objects.create_user("marks-other", role="instructor"),
            None,
        ):
            client = APIClient()
            client.force_authenticate(user)
            for endpoint in (self.root + "template/", self.root + "imports/", path):
                self.assertEqual(client.get(endpoint).status_code, 403)
            self.assertEqual(client.post(path, {}).status_code, 403)
        admin = User.objects.create_user("marks-admin", role="admin")
        self.client.force_authenticate(admin)
        self.assertFalse(self.client.get(path).data["can_apply"])
        self.assertEqual(self.apply(data).status_code, 403)
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)
        self.assertEqual(client.post(path, {}).status_code, 403)
        self.assertEqual(client.post(self.root + "imports/", {}).status_code, 403)
        self.client.force_authenticate(self.owner)
        self.assertEqual(
            self.client.post(path, {"points": 100}, format="json").status_code, 400
        )
        foreign = make_exam(admin, essay=True)
        other = start_attempt(foreign.pk, identity_for_user(admin))
        finalize(other)
        self.assertFalse(self.preview([mark_row(other)]).data["valid"])
        preview = self.client.post(
            f"/api/exams/{self.exam.pk}/previews/", {"mode": "unrestricted"}
        ).data
        self.assertFalse(
            self.preview([mark_row(self.attempt, attempt_id=preview["id"])]).data[
                "valid"
            ]
        )
        self.assertEqual(ExamPreview.objects.count(), 1)

    def test_expiry_retention_and_history_pagination_keep_applied_receipts(self):
        first = self.preview().data
        second = self.preview([mark_row(self.guest)]).data
        self.apply(first)
        expired = timezone.now() - timedelta(days=8)
        MarksImport.objects.update(expires_at=expired)
        self.assertEqual(self.apply(second).status_code, 409)
        self.assertEqual(self.apply(first).status_code, 200)
        history = self.client.get(self.root + "imports/", {"page_size": 1})
        self.assertEqual((history.data["count"], history.data["pages"]), (2, 2))
        self.assertNotIn("changes", history.data["results"][0])
        call_command("expire_attempts", stdout=io.StringIO())
        self.assertEqual(
            list(MarksImport.objects.values_list("pk", flat=True)),
            [uuid.UUID(first["id"])],
        )

    def test_failure_during_apply_rolls_back_every_grade_and_audit(self):
        data = self.preview(
            [mark_row(a, self.essay) for a in (self.attempt, self.guest)]
        ).data
        before = list(Attempt.objects.order_by("pk").values())
        from .services import audit

        calls = 0

        def failing(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("Storage failure")
            audit(*args, **kwargs)

        with (
            patch("training.marks_import.audit", side_effect=failing),
            self.assertRaises(RuntimeError),
        ):
            self.apply(data)
        self.assertEqual(list(Attempt.objects.order_by("pk").values()), before)
        self.assertFalse(
            AuditEvent.objects.filter(action="attempt.marks_imported").exists()
        )
        self.assertEqual(MarksImport.objects.get().status, "preview")
        self.assertEqual(self.apply(data).status_code, 200)


@override_settings(DEBUG=True)
class ConcurrentMarksImportTests(TransactionTestCase):
    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("Row-lock verification requires PostgreSQL.")
        self.owner = User.objects.create_user("concurrent-marks", role="instructor")
        self.exam = make_exam(self.owner, essay=True)
        self.attempt = start_attempt(self.exam.pk, identity_for_user(self.owner))
        finalize(self.attempt)
        self.essay = self.attempt.snapshot[1]["id"]
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.root = f"/api/exams/{self.exam.pk}/marks/imports/"

    def preview(self):
        response = self.client.post(
            self.root,
            {
                "csv": sheet([mark_row(self.attempt, self.essay, points=40)]),
                "reason": "Moderation",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        return response.data["id"]

    def post(self, path, data=None):
        try:
            client = APIClient()
            client.force_authenticate(User.objects.get(pk=self.owner.pk))
            return client.post(path, data or {}, format="json").status_code
        finally:
            connections.close_all()

    def test_duplicate_apply_commits_once_and_distinct_previews_conflict(self):
        first, second = self.preview(), self.preview()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(lambda _: self.post(self.root + first + "/"), range(2))
            )
        self.assertEqual(results, [200, 200])
        self.assertEqual(self.post(self.root + second + "/"), 409)
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.grading_revision, 1)
        self.assertEqual(
            AuditEvent.objects.filter(action="attempt.marks_imported").count(), 1
        )

    def test_review_racing_apply_has_one_winner_and_no_lost_grade(self):
        job = self.preview()
        with ThreadPoolExecutor(max_workers=2) as pool:
            apply = pool.submit(self.post, self.root + job + "/")
            review = pool.submit(
                self.post,
                f"/api/results/{self.attempt.pk}/review/",
                {"grading_revision": 0, "grades": {str(self.essay): {"points": 20}}},
            )
            results = (apply.result(timeout=10), review.result(timeout=10))
        self.assertIn(results, ((200, 409), (409, 200)))
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.grading_revision, 1)
        self.assertEqual(self.attempt.score, 40 if results[0] == 200 else 20)

    def test_reopening_racing_apply_preserves_the_correct_prior_submission(self):
        job = self.preview()
        with ThreadPoolExecutor(max_workers=2) as pool:
            apply = pool.submit(self.post, self.root + job + "/")
            reopen = pool.submit(
                self.post,
                f"/api/attempts/{self.attempt.pk}/reopenings/",
                {
                    "request_id": str(uuid.uuid4()),
                    "minutes": 5,
                    "reason": "Recovery",
                    "answer_revision": 0,
                    "submitted_at": self.attempt.submitted_at.isoformat(),
                },
            )
            results = (apply.result(timeout=10), reopen.result(timeout=10))
        self.assertEqual(results[1], 201)
        self.assertIn(results[0], (200, 409))
        self.attempt.refresh_from_db()
        self.assertEqual(
            (self.attempt.status, self.attempt.manual_grades), ("in_progress", {})
        )
        previous = self.attempt.attemptreopening_set.get().previous_submission
        self.assertEqual(previous["score"], 40 if results[0] == 200 else 0)

    def test_expiry_is_rechecked_after_waiting_for_attempt_lock(self):
        job = self.preview()
        deadline = timezone.now() + timedelta(seconds=5)
        MarksImport.objects.filter(pk=job).update(expires_at=deadline)
        waiting = Event()
        real_select = Attempt.objects.select_for_update

        def selected(*args, **kwargs):
            waiting.set()
            return real_select(*args, **kwargs)

        clock = [deadline - timedelta(seconds=1)]
        with (
            ThreadPoolExecutor(max_workers=1) as pool,
            patch(
                "training.marks_import.Attempt.objects.select_for_update",
                side_effect=selected,
            ),
            patch("training.marks_import.timezone.now", side_effect=lambda: clock[0]),
        ):
            with transaction.atomic():
                Attempt.objects.select_for_update().get(pk=self.attempt.pk)
                waiting.clear()
                pending = pool.submit(self.post, self.root + job + "/")
                self.assertTrue(waiting.wait(timeout=5))
                clock[0] = deadline + timedelta(seconds=1)
            self.assertEqual(pending.result(timeout=10), 409)
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.manual_grades, {})
