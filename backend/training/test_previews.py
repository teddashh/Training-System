import io
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    Attempt,
    AttemptBudget,
    AuditEvent,
    Exam,
    ExamPreview,
    Identity,
    LearningAssignment,
    Question,
    User,
)
from .services import apply_manual_grades, finalize, identity_for_user, start_attempt
from .operations import assignment_rows


def trial_exam(owner, **kwargs):
    exam = Exam.objects.create(
        owner=owner, title="Instructor trial", published=True, **kwargs
    )
    Question.objects.create(
        exam=exam,
        position=0,
        description="Choice",
        type="single",
        options=["Yes", "No"],
        solution=[0],
        points=10,
    )
    Question.objects.create(
        exam=exam,
        position=1,
        description="Explanation",
        type="essay",
        options=[],
        solution=[],
        points=10,
    )
    return exam


@override_settings(DEBUG=True)
class PreviewTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("preview-owner", role="instructor")
        self.other = User.objects.create_user("preview-other", role="instructor")
        self.admin = User.objects.create_user("preview-admin", role="admin")
        self.learner = User.objects.create_user("preview-learner")
        self.exam = trial_exam(self.owner)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.collection = f"/api/exams/{self.exam.pk}/previews/"

    def start(self, mode="learner"):
        response = self.client.post(self.collection, {"mode": mode}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIn("no-store", response["Cache-Control"])
        return ExamPreview.objects.get(pk=response.data["id"]), response

    def save(self, preview, answers, *, submit=False, revision=None):
        preview.refresh_from_db()
        method = self.client.post if submit else self.client.patch
        return method(
            f"/api/previews/{preview.pk}/",
            {
                "answers": answers,
                "answer_revision": preview.answer_revision
                if revision is None
                else revision,
            },
            format="json",
        )

    def test_preview_never_creates_participant_evidence_or_consumes_budgets(self):
        real = start_attempt(self.exam.pk, identity_for_user(self.owner))
        real.answers = {
            str(q["id"]): "Actual essay" if q["type"] == "essay" else 0
            for q in real.snapshot
        }
        finalize(real)
        apply_manual_grades(
            real,
            {str(real.snapshot[1]["id"]): {"points": 0, "feedback": "Actual feedback"}},
        )
        LearningAssignment.objects.create(
            user=self.owner, exam=self.exam, created_by=self.owner
        )
        required = assignment_rows(LearningAssignment.objects.all())
        original = deepcopy(Attempt.objects.values().get(pk=real.pk))
        actual_events = AuditEvent.objects.filter(action__startswith="attempt.").count()
        before_results = self.client.get("/api/results/").data
        before_csv = self.client.get("/api/results/export/").content
        # A trial is not an audience check, retry grant or real attempt.
        self.exam.audience = "people"
        self.exam.max_attempts = 1
        self.exam.retry_interval_minutes = 5000
        self.exam.save()
        for mode in ("learner", "unrestricted"):
            preview, _ = self.start(mode)
            answers = {
                str(q["id"]): "Trial essay" if q["type"] == "essay" else 0
                for q in preview.snapshot
            }
            self.assertEqual(self.save(preview, answers, submit=True).status_code, 200)
            review = self.client.post(
                f"/api/previews/{preview.pk}/review/",
                {
                    "grades": {
                        str(preview.snapshot[1]["id"]): {
                            "points": 10,
                            "feedback": "Test only",
                        }
                    }
                },
                format="json",
            )
            self.assertEqual(review.data["score"], 100)
        self.assertEqual(Attempt.objects.count(), 1)
        self.assertEqual(AttemptBudget.objects.count(), 1)
        self.assertEqual(AttemptBudget.objects.get().used, 1)
        self.assertEqual(Identity.objects.count(), 1)
        self.assertEqual(Attempt.objects.values().get(pk=real.pk), original)
        self.assertEqual(self.client.get("/api/results/").data, before_results)
        self.assertEqual(self.client.get("/api/results/export/").content, before_csv)
        self.assertEqual(assignment_rows(LearningAssignment.objects.all()), required)
        self.assertEqual(
            AuditEvent.objects.filter(action__startswith="attempt.").count(),
            actual_events,
        )
        self.assertEqual(
            self.client.get(f"/api/exams/{self.exam.pk}/").data["attempts_used"], 1
        )

    def test_learner_window_and_timer_and_unrestricted_drafts(self):
        now = timezone.now()
        for changes in (
            {"published": False},
            {"published": True, "starts_at": now + timedelta(hours=1)},
            {"starts_at": None, "ends_at": now},
        ):
            for name, value in changes.items():
                setattr(self.exam, name, value)
            self.exam.save()
            response = self.client.post(
                self.collection,
                {"mode": "learner"},
                format="json",
                HTTP_ACCEPT_LANGUAGE="es",
            )
            self.assertEqual(response.status_code, 403)
            self.assertNotIn("Learner simulation requires", str(response.data))
            preview, result = self.start("unrestricted")
            self.assertIsNone(preview.deadline)
            self.assertIsNone(result.data["deadline"])
        self.exam.ends_at = now + timedelta(minutes=2)
        self.exam.save()
        preview, _ = self.start()
        self.assertEqual(preview.deadline, self.exam.ends_at)
        self.assertAlmostEqual(
            (preview.expires_at - preview.started_at).total_seconds(),
            7 * 86400,
            delta=2,
        )
        for mode in (None, "godmode", {}, True):
            self.assertEqual(
                self.client.post(
                    self.collection, {"mode": mode}, format="json"
                ).status_code,
                400,
            )

    def test_private_owner_access_role_changes_and_endpoint_separation(self):
        preview, _ = self.start()
        url = f"/api/previews/{preview.pk}/"
        for user in (None, self.learner, self.other):
            self.client.force_authenticate(user)
            self.assertIn(
                self.client.post(
                    self.collection, {"mode": "unrestricted"}, format="json"
                ).status_code,
                (401, 403),
            )
            for method in (
                self.client.get,
                self.client.post,
                self.client.patch,
                self.client.delete,
            ):
                self.assertIn(
                    method(url, {}, format="json").status_code, (401, 403, 404)
                )
            self.assertIn(self.client.get(url + "review/").status_code, (401, 403, 404))
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self.collection).data, [])
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.get(url + "review/").status_code, 404)
        self.start("unrestricted")  # Admin can create their own exam trial.
        self.client.force_authenticate(self.owner)
        self.assertEqual(
            self.client.get(f"/api/attempts/{preview.pk}/").status_code, 404
        )
        self.assertEqual(
            self.client.get(f"/api/results/{preview.pk}/review/").status_code, 404
        )
        self.owner.role = "learner"
        self.owner.save()
        self.assertEqual(self.client.get(url).status_code, 403)
        self.owner.role = "instructor"
        self.owner.save()
        self.exam.owner = self.other
        self.exam.save()
        self.assertEqual(self.client.get(url).status_code, 403)

    def test_random_snapshot_and_rules_freeze_across_edits_and_resume(self):
        self.exam.shuffle_questions = self.exam.shuffle_options = True
        self.exam.questions_per_attempt = 1
        self.exam.save()
        with (
            patch("training.services.secrets.SystemRandom.sample", return_value=[0]),
            patch(
                "training.services.secrets.SystemRandom.shuffle",
                side_effect=lambda values: values.reverse(),
            ),
        ):
            preview, result = self.start()
        frozen = deepcopy(preview.snapshot)
        self.assertEqual(frozen[0]["options"], ["No", "Yes"])
        self.assertEqual(frozen[0]["solution"], [1])
        self.assertNotIn("solution", result.data["questions"][0])
        self.exam.questions.all().delete()
        self.exam.allow_skip = False
        self.exam.pass_score = 100
        self.exam.save()
        resumed = self.client.get(f"/api/previews/{preview.pk}/")
        self.assertEqual(resumed.data["questions"], result.data["questions"])
        self.assertTrue(resumed.data["allow_skip"])
        self.assertEqual(resumed.data["pass_score"], 70)
        self.assertEqual(
            self.save(preview, {str(frozen[0]["id"]): 1}, submit=True).data["score"],
            100,
        )
        self.assertEqual(
            self.client.post(
                self.collection, {"mode": "unrestricted"}, format="json"
            ).status_code,
            400,
        )

    def test_sequential_unlock_revision_conflict_and_incomplete_submit(self):
        self.exam.allow_skip = False
        self.exam.save()
        preview, result = self.start()
        first, second = [str(q["id"]) for q in preview.snapshot]
        self.assertEqual(result.data["question_count"], 2)
        self.assertEqual(len(result.data["questions"]), 1)
        self.assertEqual(self.save(preview, {second: "Ahead"}).status_code, 400)
        self.assertEqual(
            self.save(preview, {first: []}, submit=True).data["code"],
            "answers_required",
        )
        response = self.save(preview, {first: 0})
        self.assertEqual(len(response.data["questions"]), 2)
        conflict = self.save(preview, {first: 1}, revision=0)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.data["code"], "answer_conflict")
        for revision in (None, True, -1, "1"):
            self.assertEqual(
                self.client.patch(
                    f"/api/previews/{preview.pk}/",
                    {"answers": {}, "answer_revision": revision},
                    format="json",
                ).status_code,
                400,
            )
        self.assertEqual(
            self.save(preview, {first: 0, second: "Done"}, submit=True).data["status"],
            "pending_review",
        )

    def test_shared_grading_all_seven_types_and_private_review_release(self):
        self.exam.questions.all().delete()
        kinds = [
            ("single", ["Yes", "No"], [0], {}, 0),
            ("multiple", ["A", "B", "C"], [0, 1], {}, [0, 1]),
            (
                "short",
                [],
                [" Keep Case "],
                {"answer_matching": ["exact"]},
                " Keep Case ",
            ),
            ("integer", [], ["42"], {}, "42"),
            ("numeric", [], ["12.5"], {"answer_tolerances": ["0.05"]}, "12.55"),
            ("ordering", ["First", "Last"], [0, 1], {}, None),
            ("essay", [], [], {}, "Test essay"),
        ]
        for index, (kind, options, solution, extra, _) in enumerate(kinds):
            Question.objects.create(
                exam=self.exam,
                position=index,
                description=kind,
                type=kind,
                options=options,
                solution=solution,
                points=10,
                **extra,
            )
        self.exam.allow_response_review = False
        self.exam.save()
        preview, _ = self.start()
        review_url = f"/api/previews/{preview.pk}/review/"
        self.assertEqual(self.client.get(review_url).status_code, 400)
        answers = {
            str(q["id"]): q["solution"] if value is None else value
            for q, (*_, value) in zip(preview.snapshot, kinds)
        }
        submitted = self.save(preview, answers, submit=True)
        self.assertEqual(submitted.data["questions"], [])
        self.assertEqual(submitted.data["answers"], {})
        review = self.client.get(review_url)
        self.assertEqual(review.data["answers"], answers)
        self.assertIn("no-store", review["Cache-Control"])
        key = str(preview.snapshot[-1]["id"])
        for marks in (
            [],
            {key: {"points": -1}},
            {key: {"points": 11}},
            {"foreign": {"points": 0}},
        ):
            self.assertEqual(
                self.client.post(
                    review_url, {"grades": marks}, format="json"
                ).status_code,
                400,
            )
        marked = self.client.post(
            review_url,
            {"grades": {key: {"points": 10, "feedback": "Preview feedback"}}},
            format="json",
        )
        self.assertEqual(marked.data["score"], 100)
        hidden = self.client.get(f"/api/previews/{preview.pk}/")
        self.assertEqual(hidden.data["score"], 100)
        self.assertEqual(hidden.data["manual_grades"], {})
        self.exam.allow_response_review = True
        self.exam.save()
        released = self.client.get(f"/api/previews/{preview.pk}/")
        self.assertEqual(
            released.data["manual_grades"][key]["feedback"], "Preview feedback"
        )
        self.assertNotIn("answer_matching", released.data["questions"][2])
        self.assertEqual(self.client.get(f"/api/results/?exam={self.exam.pk}").data, [])

    def test_timeout_uses_saved_answers_and_untimed_test_stays_open(self):
        preview, _ = self.start()
        first = str(preview.snapshot[0]["id"])
        self.save(preview, {first: 0})
        ExamPreview.objects.filter(pk=preview.pk).update(
            deadline=timezone.now() - timedelta(seconds=1)
        )
        late = self.save(preview, {first: 1}, submit=True, revision=0)
        self.assertEqual(late.data["status"], "pending_review")
        self.assertEqual(late.data["answers"], {first: 0})
        untimed, _ = self.start("unrestricted")
        with patch(
            "training.previews.timezone.now",
            return_value=timezone.now() + timedelta(days=1),
        ):
            self.assertEqual(
                self.client.get(f"/api/previews/{untimed.pk}/").data["status"],
                "in_progress",
            )
        timed, _ = self.start()
        ExamPreview.objects.filter(pk=timed.pk).update(
            deadline=timezone.now() - timedelta(seconds=1)
        )
        call_command("expire_attempts", stdout=io.StringIO())
        timed.refresh_from_db()
        untimed.refresh_from_db()
        self.assertEqual(timed.status, "pending_review")
        self.assertEqual(untimed.status, "in_progress")
        self.assertEqual(Attempt.objects.count(), 0)

    def test_saved_list_delete_retention_and_bounded_storage(self):
        preview, _ = self.start()
        self.assertEqual(len(self.client.get(self.collection).data), 1)
        self.assertEqual(
            self.client.delete(f"/api/previews/{preview.pk}/").status_code, 204
        )
        self.assertEqual(len(self.client.get(self.collection).data), 0)
        expired, _ = self.start("unrestricted")
        ExamPreview.objects.filter(pk=expired.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(
            self.client.get(f"/api/previews/{expired.pk}/").status_code, 404
        )
        self.assertEqual(len(self.client.get(self.collection).data), 0)
        call_command("expire_attempts", stdout=io.StringIO())
        self.assertFalse(ExamPreview.objects.filter(pk=expired.pk).exists())
        previews = [
            ExamPreview(
                exam=self.exam,
                owner=self.owner,
                mode="unrestricted",
                pass_score=70,
                expires_at=timezone.now() + timedelta(days=7),
            )
            for _ in range(20)
        ]
        ExamPreview.objects.bulk_create(previews)
        capped = self.client.post(
            self.collection, {"mode": "unrestricted"}, format="json"
        )
        self.assertEqual(capped.status_code, 400)
        self.assertEqual(ExamPreview.objects.count(), 20)
        self.client.delete(f"/api/previews/{previews[0].pk}/")
        self.start("unrestricted")
        self.assertEqual(ExamPreview.objects.count(), 20)


@override_settings(DEBUG=True)
class ConcurrentPreviewTests(TransactionTestCase):
    def test_competing_preview_saves_preserve_one_revision(self):
        if connection.vendor != "postgresql":
            self.skipTest("Row-lock verification requires PostgreSQL.")
        user = User.objects.create_user("concurrent-preview", role="instructor")
        exam = trial_exam(user, allow_skip=False)
        client = APIClient()
        client.force_authenticate(user)
        response = client.post(
            f"/api/exams/{exam.pk}/previews/", {"mode": "learner"}, format="json"
        )
        preview = ExamPreview.objects.get(pk=response.data["id"])
        key = str(preview.snapshot[0]["id"])

        def save(value):
            try:
                worker = APIClient()
                worker.force_authenticate(User.objects.get(pk=user.pk))
                return worker.patch(
                    f"/api/previews/{preview.pk}/",
                    {"answers": {key: value}, "answer_revision": 0},
                    format="json",
                ).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(save, [0, 1])), [200, 409])
        preview.refresh_from_db()
        self.assertEqual(preview.answer_revision, 1)
        self.assertEqual(preview.unlocked_question_count, 2)
        self.assertEqual(AttemptBudget.objects.count(), 0)
