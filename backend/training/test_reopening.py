import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    Attempt,
    AttemptBudget,
    AttemptReopening,
    AuditEvent,
    Invitation,
    LearningAssignment,
    User,
)
from .operations import assignment_rows
from .services import finalize, hash_token, identity_for_user, start_attempt
from .tests import make_exam


@override_settings(DEBUG=True)
class ReopeningTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("reopen-owner", role="instructor")
        self.learner = User.objects.create_user("reopen-learner", "reopen@example.com")
        self.exam = make_exam(self.owner, essay=True)
        self.attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        self.manager = APIClient()
        self.manager.force_authenticate(self.owner)
        self.participant = APIClient()
        self.participant.force_authenticate(self.learner)
        self.detail = f"/api/attempts/{self.attempt.pk}/"
        self.endpoint = self.detail + "reopenings/"
        self.review = f"/api/results/{self.attempt.pk}/review/"
        self.choice, self.essay = [str(q["id"]) for q in self.attempt.snapshot]

    def submit(self):
        self.attempt.refresh_from_db()
        response = self.participant.post(
            self.detail,
            {
                "answer_revision": self.attempt.answer_revision,
                "answers": {self.choice: 1, self.essay: "Original evidence"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.attempt.refresh_from_db()

    def payload(self, **changes):
        self.attempt.refresh_from_db()
        return {
            "request_id": str(uuid.uuid4()),
            "minutes": 10,
            "reason": "Restore interrupted assessment",
            "answer_revision": self.attempt.answer_revision,
            "submitted_at": self.attempt.submitted_at.isoformat()
            if self.attempt.submitted_at
            else timezone.now().isoformat(),
            **changes,
        }

    def reopen(self, **changes):
        return self.manager.post(self.endpoint, self.payload(**changes), format="json")

    def test_active_inspection_is_scoped_read_only_and_shows_all_frozen_questions(self):
        self.attempt.allow_skip = False
        self.attempt.answers = {self.choice: 0}
        self.attempt.save()
        before = Attempt.objects.values().get(pk=self.attempt.pk)
        result = self.manager.get(self.detail + "inspection/")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["answers"], {self.choice: 0})
        self.assertEqual(result.data["questions"], self.attempt.snapshot)
        self.assertEqual(result.data["status"], "in_progress")
        self.assertIn("no-store", result["Cache-Control"])
        self.assertEqual(Attempt.objects.values().get(pk=self.attempt.pk), before)
        self.assertEqual(
            self.manager.post(self.detail + "inspection/", {}).status_code, 405
        )
        for actor in (
            self.learner,
            User.objects.create_user("other-teacher", role="instructor"),
            None,
        ):
            client = APIClient()
            client.force_authenticate(actor)
            for suffix in ("inspection/", "reopenings/"):
                self.assertEqual(client.get(self.detail + suffix).status_code, 403)
                if suffix == "reopenings/":
                    self.assertEqual(
                        client.post(self.detail + suffix, {}).status_code, 403
                    )
        preview = self.manager.post(
            f"/api/exams/{self.exam.pk}/previews/", {"mode": "unrestricted"}
        ).data
        self.assertEqual(
            self.manager.get(f"/api/attempts/{preview['id']}/inspection/").status_code,
            404,
        )

    def test_inspection_expires_saved_answers_without_accepting_edits(self):
        Attempt.objects.filter(pk=self.attempt.pk).update(
            deadline=timezone.now() - timedelta(seconds=1), answers={self.choice: 1}
        )
        result = self.manager.get(self.detail + "inspection/")
        self.assertEqual(result.data["status"], "pending_review")
        self.assertEqual(result.data["answers"], {self.choice: 1})
        self.assertEqual(
            AuditEvent.objects.filter(action="attempt.submitted").count(), 1
        )

    def test_reopening_preserves_evidence_and_budget_and_withdraws_current_completion(
        self,
    ):
        assignment = LearningAssignment.objects.create(
            exam=self.exam, user=self.learner, created_by=self.owner
        )
        self.submit()
        self.manager.post(
            self.review,
            {"grades": {self.essay: {"points": 40, "feedback": "Original feedback"}}},
            format="json",
        )
        self.attempt.refresh_from_db()
        before = Attempt.objects.values().get(pk=self.attempt.pk)
        budget = AttemptBudget.objects.values().get(exam=self.exam)
        self.assertEqual(assignment_rows([assignment])[0]["status"], "completed")
        response = self.reopen()
        self.assertEqual(response.status_code, 201, response.data)
        self.attempt.refresh_from_db()
        for name in (
            "snapshot",
            "pass_score",
            "answers",
            "number",
            "started_at",
            "last_saved_at",
            "allow_skip",
            "unlocked_question_count",
        ):
            self.assertEqual(getattr(self.attempt, name), before[name])
        self.assertEqual(AttemptBudget.objects.values().get(exam=self.exam), budget)
        self.assertEqual(
            (
                self.attempt.status,
                self.attempt.reopen_count,
                self.attempt.answer_revision,
            ),
            ("in_progress", 1, before["answer_revision"] + 1),
        )
        self.assertIsNone(self.attempt.score)
        self.assertIsNone(self.attempt.passed)
        self.assertIsNone(self.attempt.submitted_at)
        self.assertIsNone(self.attempt.last_seen_at)
        self.assertEqual(self.attempt.manual_grades, {})
        self.assertEqual(assignment_rows([assignment])[0]["status"], "in_progress")
        self.assertAlmostEqual(
            (self.attempt.deadline - timezone.now()).total_seconds(), 600, delta=5
        )
        record = AttemptReopening.objects.get()
        preserved = record.previous_submission
        self.assertEqual(preserved["score"], 100)
        self.assertEqual(
            preserved["manual_grades"][self.essay]["feedback"], "Original feedback"
        )
        self.assertEqual(preserved["answers"], before["answers"])
        self.assertEqual(preserved["questions"], before["snapshot"])
        self.submit()
        self.manager.post(
            self.review,
            {
                "answer_revision": self.attempt.answer_revision,
                "grades": {self.essay: {"points": 0}},
            },
            format="json",
        )
        record.refresh_from_db()
        self.assertEqual(record.previous_submission, preserved)
        self.assertEqual(
            AuditEvent.objects.filter(action="attempt.reopened").count(), 1
        )

    def test_idempotent_retry_after_resubmission_never_reopens_again(self):
        self.submit()
        payload = self.payload()
        first = self.manager.post(self.endpoint, payload, format="json")
        self.assertEqual(first.status_code, 201)
        self.submit()
        before = Attempt.objects.values().get(pk=self.attempt.pk)
        retry = self.manager.post(self.endpoint, payload, format="json")
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.data, first.data)
        self.assertEqual(Attempt.objects.values().get(pk=self.attempt.pk), before)
        for changes in (
            {"minutes": 11},
            {"reason": "different"},
            {"answer_revision": 99},
            {"submitted_at": timezone.now().isoformat()},
        ):
            self.assertEqual(
                self.manager.post(
                    self.endpoint, {**payload, **changes}, format="json"
                ).status_code,
                409,
            )
        self.manager.force_authenticate(
            User.objects.create_user("reopen-admin", role="admin")
        )
        self.assertEqual(
            self.manager.post(self.endpoint, payload, format="json").status_code, 409
        )
        self.assertEqual(AttemptReopening.objects.count(), 1)

    def test_old_or_missing_answer_and_review_revisions_cannot_overwrite_reopened_work(
        self,
    ):
        self.submit()
        old = self.attempt.answer_revision
        self.assertEqual(self.reopen().status_code, 201)
        for method in (self.participant.patch, self.participant.post):
            for revision in ({}, {"answer_revision": old}):
                result = method(
                    self.detail,
                    {"answers": {self.essay: "stale"}, **revision},
                    format="json",
                )
                self.assertEqual(result.status_code, 409)
                self.assertEqual(result.data["code"], "answer_conflict")
        self.assertEqual(
            self.manager.post(self.review, {"grades": {}}, format="json").status_code,
            400,
        )
        self.submit()
        for revision in ({}, {"answer_revision": old}):
            result = self.manager.post(
                self.review,
                {"grades": {self.essay: {"points": 40}}, **revision},
                format="json",
            )
            self.assertEqual(result.status_code, 409)
        self.assertEqual(
            self.manager.post(
                self.review,
                {
                    "answer_revision": self.attempt.answer_revision,
                    "grades": {self.essay: {"points": 40}},
                },
                format="json",
            ).status_code,
            200,
        )

    def test_validation_stale_submission_and_extra_time_bounds(self):
        self.assertEqual(self.reopen().status_code, 409)
        self.submit()
        for changes in (
            {"minutes": 0},
            {"minutes": 241},
            {"minutes": 1.5},
            {"reason": " "},
            {"reason": "x" * 501},
            {"request_id": "invalid"},
            {"submitted_at": None},
            {"answer_revision": -1},
        ):
            self.assertEqual(self.reopen(**changes).status_code, 400, changes)
        self.assertEqual(self.reopen(answer_revision=50).status_code, 409)
        self.assertEqual(
            self.reopen(submitted_at=timezone.now().isoformat()).status_code, 409
        )
        Attempt.objects.filter(pk=self.attempt.pk).update(extra_time_minutes=1435)
        self.assertEqual(self.reopen().status_code, 400)
        self.assertEqual(self.reopen(minutes=5).status_code, 201)
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.extra_time_minutes, 1440)

    def test_only_latest_attempt_can_reopen_and_access_rules_remain_enforced(self):
        self.submit()
        for model, changes in (
            (self.exam, {"published": False}),
            (self.learner, {"is_active": False}),
        ):
            for field, value in changes.items():
                setattr(model, field, value)
            model.save()
            self.assertEqual(self.reopen().status_code, 403)
            for field in changes:
                setattr(model, field, True)
            model.save()
        newer = start_attempt(self.exam.pk, self.attempt.identity)
        self.assertEqual(self.reopen().status_code, 409)
        finalize(newer)
        self.assertEqual(self.reopen().status_code, 409)
        self.assertFalse(AttemptReopening.objects.exists())

    def test_reopened_guest_resumes_after_closing_without_consuming_limits(self):
        invitation = Invitation.objects.create(
            exam=self.exam,
            identity=self.attempt.identity,
            token_hash=hash_token("reopening-guest"),
            max_attempts=1,
            used=1,
            expires_at=timezone.now() + timedelta(days=1),
            created_by=self.owner,
        )
        self.attempt.invitation = invitation
        self.attempt.save()
        self.submit()
        for changes in (
            {"revoked": True},
            {"expires_at": timezone.now() - timedelta(seconds=1)},
        ):
            Invitation.objects.filter(pk=invitation.pk).update(**changes)
            self.assertEqual(self.reopen().status_code, 403)
            Invitation.objects.filter(pk=invitation.pk).update(
                revoked=False, expires_at=timezone.now() + timedelta(days=1)
            )
        self.exam.ends_at = timezone.now() - timedelta(minutes=1)
        self.exam.save()
        self.assertEqual(self.reopen().status_code, 201)
        resumed = start_attempt(self.exam.pk, self.attempt.identity, invitation)
        self.assertEqual(resumed.pk, self.attempt.pk)
        self.assertEqual(AttemptBudget.objects.get(exam=self.exam).used, 1)
        invitation.refresh_from_db()
        self.assertEqual(invitation.used, 1)
        guest = APIClient()
        self.assertEqual(
            guest.post(
                "/api/guest/exchange/", {"token": "reopening-guest"}, format="json"
            ).status_code,
            200,
        )
        self.assertEqual(
            guest.post("/api/guest/exam/", {}).data["id"], str(self.attempt.pk)
        )
        self.assertEqual(guest.get(self.detail).status_code, 200)
        Invitation.objects.filter(pk=invitation.pk).update(revoked=True)
        self.assertEqual(guest.get(self.detail).status_code, 403)

    def test_history_is_paginated_scoped_private_and_read_only(self):
        self.submit()
        first = self.reopen().data["id"]
        self.submit()
        self.reopen()
        history = self.manager.get(self.endpoint, {"page_size": 1, "page": 2})
        self.assertEqual(
            (
                history.data["count"],
                history.data["pages"],
                len(history.data["results"]),
            ),
            (2, 2, 1),
        )
        self.assertNotIn("answers", history.data["results"][0])
        path = self.endpoint + first + "/"
        self.assertIn("no-store", self.manager.get(path)["Cache-Control"])
        self.assertEqual(
            self.manager.get(path).data["answers"][self.essay], "Original evidence"
        )
        self.assertEqual(self.participant.get(path).status_code, 403)
        self.assertEqual(self.manager.post(path, {}).status_code, 405)
        self.assertEqual(
            self.manager.get(self.endpoint + str(uuid.uuid4()) + "/").status_code, 404
        )
        self.assertNotIn("reopenings", self.participant.get(self.detail).data)

    def test_reopening_requires_csrf_for_session_authentication(self):
        self.submit()
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.owner)
        self.assertEqual(
            client.post(self.endpoint, self.payload(), format="json").status_code, 403
        )


@override_settings(DEBUG=True)
class ConcurrentReopeningTests(TransactionTestCase):
    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("Row-lock verification requires PostgreSQL.")
        self.owner = User.objects.create_user("concurrent-reopen", role="instructor")
        self.exam = make_exam(self.owner)
        self.attempt = start_attempt(self.exam.pk, identity_for_user(self.owner))
        finalize(self.attempt)
        self.payload = {
            "request_id": str(uuid.uuid4()),
            "minutes": 10,
            "reason": "Recovery",
            "answer_revision": 0,
            "submitted_at": self.attempt.submitted_at.isoformat(),
        }

    def post(self, path, payload):
        try:
            client = APIClient()
            client.force_authenticate(User.objects.get(pk=self.owner.pk))
            return client.post(path, payload, format="json").status_code
        finally:
            connections.close_all()

    def reopen(self, payload=None):
        return self.post(
            f"/api/attempts/{self.attempt.pk}/reopenings/", payload or self.payload
        )

    def test_duplicate_and_distinct_reopening_requests_never_apply_twice(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.reopen(), range(2)))
        self.assertEqual(sorted(results), [200, 201])
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.reopen_count, 1)
        finalize(self.attempt)
        self.payload.update(
            answer_revision=self.attempt.answer_revision,
            submitted_at=self.attempt.submitted_at.isoformat(),
        )
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(
                    lambda _: self.reopen(
                        {**self.payload, "request_id": str(uuid.uuid4())}
                    ),
                    range(2),
                )
            )
        self.assertEqual(sorted(results), [201, 409])
        self.assertEqual(AttemptReopening.objects.count(), 2)

    def test_start_racing_reopening_leaves_exactly_one_active_paper(self):
        def start():
            try:
                return start_attempt(self.exam.pk, self.attempt.identity).pk
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            grant = pool.submit(self.reopen)
            started = pool.submit(start)
            status, started_id = grant.result(timeout=10), started.result(timeout=10)
        active = Attempt.objects.get(exam=self.exam, status="in_progress")
        self.assertEqual(active.pk, started_id)
        self.assertEqual(
            AttemptBudget.objects.get(exam=self.exam).used, 1 if status == 201 else 2
        )
        self.assertEqual(status, 201 if started_id == self.attempt.pk else 409)

    def test_grading_racing_reopening_is_preserved_or_rejected_without_deadlock(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            grant = pool.submit(self.reopen)
            review = pool.submit(
                self.post,
                f"/api/results/{self.attempt.pk}/review/",
                {"grades": {}, "answer_revision": 0},
            )
            self.assertEqual(grant.result(timeout=10), 201)
            self.assertIn(review.result(timeout=10), (200, 400))
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.status, "in_progress")
        self.assertIsNone(self.attempt.score)
        self.assertEqual(
            AttemptReopening.objects.get().previous_submission["status"], "graded"
        )
