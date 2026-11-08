from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from .models import Attempt, AttemptBudget, AuditEvent, Exam, Identity, Invitation, User
from .services import (
    finalize,
    hash_token,
    identity_for_user,
    next_attempt_at,
    resolve_identity,
    start_attempt,
)
from .tests import make_exam


@override_settings(DEBUG=True)
class RetryIntervalTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("retry-owner", role="instructor")
        self.user = User.objects.create_user(
            "retry-user", "retry@example.com", employee_id="RETRY-01"
        )
        self.identity = identity_for_user(self.user)
        self.exam = make_exam(self.owner, limit=5)
        self.exam.retry_interval_minutes = 60
        self.exam.save()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def invite(self, token="retry-token", identity=None):
        return Invitation.objects.create(
            exam=self.exam,
            identity=identity or self.identity,
            created_by=self.owner,
            token_hash=hash_token(token),
            max_attempts=3,
            expires_at=timezone.now() + timedelta(days=2),
        )

    def start_and_finish(self):
        attempt = start_attempt(self.exam.pk, self.identity)
        finalize(attempt)
        return attempt

    def test_settings_validation_and_existing_exam_default(self):
        self.assertEqual(
            Exam.objects.create(
                owner=self.owner, title="Default"
            ).retry_interval_minutes,
            0,
        )
        self.client.force_authenticate(self.owner)
        url = f"/api/exams/{self.exam.pk}/"
        for bad in [-1, 525601, 1.5, True, None]:
            with self.subTest(value=bad):
                self.assertEqual(
                    self.client.patch(
                        url, {"retry_interval_minutes": bad}, format="json"
                    ).status_code,
                    400,
                )
        for value in [0, 1, 90, 525600]:
            response = self.client.patch(
                url, {"retry_interval_minutes": value}, format="json"
            )
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.data["retry_interval_minutes"], value)
        self.client.force_authenticate(self.user)
        self.assertEqual(
            self.client.patch(
                url, {"retry_interval_minutes": 0}, format="json"
            ).status_code,
            403,
        )

    def test_active_account_and_guest_resume_before_retry_time_without_charging(self):
        invitation = self.invite()
        invitation.max_attempts = 1
        invitation.save()
        attempt = start_attempt(self.exam.pk, self.identity, invitation)
        for access in [None, invitation]:
            self.assertEqual(
                start_attempt(self.exam.pk, self.identity, access).pk, attempt.pk
            )
        self.assertEqual(AttemptBudget.objects.get().used, 1)
        invitation.refresh_from_db()
        self.assertEqual(invitation.used, 1)
        data = self.client.get(f"/api/exams/{self.exam.pk}/").json()
        self.assertEqual(data["active_attempt_id"], str(attempt.pk))
        self.assertEqual(
            data["next_attempt_at"],
            next_attempt_at(self.exam, attempt.started_at).isoformat(),
        )

    def test_exact_boundary_uses_previous_start_not_submission(self):
        attempt = self.start_and_finish()
        eligible = attempt.started_at + timedelta(minutes=60)
        # A later manual grading/submission timestamp must not reset the interval.
        Attempt.objects.filter(pk=attempt.pk).update(
            submitted_at=eligible - timedelta(minutes=5), status="pending_review"
        )
        with patch(
            "training.services.timezone.now",
            return_value=eligible - timedelta(microseconds=1),
        ):
            with self.assertRaises(PermissionDenied) as error:
                start_attempt(self.exam.pk, self.identity)
            self.assertEqual(error.exception.detail["code"], "retry_wait")
        self.assertEqual(AttemptBudget.objects.get().used, 1)
        with patch("training.services.timezone.now", return_value=eligible):
            second = start_attempt(self.exam.pk, self.identity)
        self.assertEqual(second.number, 2)
        self.assertEqual(second.started_at, eligible)

    def test_early_start_has_localized_metadata_and_no_side_effects(self):
        attempt = self.start_and_finish()
        count = AuditEvent.objects.count()
        for language, expected in [
            ("en", "The waiting period"),
            ("es", "El período de espera"),
            ("zh-hant", "下一次作答"),
        ]:
            response = self.client.post(
                f"/api/exams/{self.exam.pk}/start/",
                {},
                format="json",
                HTTP_ACCEPT_LANGUAGE=language,
            )
            self.assertEqual(response.status_code, 403)
            data = response.json()
            self.assertEqual(data["code"], "retry_wait")
            self.assertTrue(data["detail"].startswith(expected))
            self.assertEqual(
                data["next_attempt_at"],
                next_attempt_at(self.exam, attempt.started_at).isoformat(),
            )
            self.assertIn("server_time", data)
        self.assertEqual(AuditEvent.objects.count(), count)
        self.assertEqual(Attempt.objects.count(), 1)
        self.assertEqual(AttemptBudget.objects.get().used, 1)

    def test_aliases_reissued_links_and_extra_attempts_share_waiting_period(self):
        self.start_and_finish()
        AttemptBudget.objects.update(limit_override=20)
        for index, key in enumerate(["retry@example.com", "retry-user", "RETRY-01"]):
            self.assertEqual(resolve_identity(key).pk, self.identity.pk)
            invitation = self.invite(f"alias-{index}")
            with self.assertRaises(PermissionDenied) as error:
                start_attempt(self.exam.pk, resolve_identity(key), invitation)
            self.assertEqual(error.exception.detail["code"], "retry_wait")
            invitation.refresh_from_db()
            self.assertEqual(invitation.used, 0)
        self.assertEqual(AttemptBudget.objects.get().used, 1)

    def test_guest_history_survives_later_account_linking(self):
        identity = resolve_identity("later-retry@example.com")
        attempt = start_attempt(self.exam.pk, identity, self.invite(identity=identity))
        finalize(attempt)
        later = User.objects.create_user("later-retry", "later-retry@example.com")
        linked = identity_for_user(later)
        self.assertEqual(identity.pk, linked.pk)
        with self.assertRaises(PermissionDenied) as error:
            start_attempt(self.exam.pk, linked)
        self.assertEqual(error.exception.detail["code"], "retry_wait")

    def test_preflight_is_identity_scoped_for_account_and_verified_guest(self):
        attempt = self.start_and_finish()
        data = self.client.get(f"/api/exams/{self.exam.pk}/").json()
        self.assertEqual(
            data["next_attempt_at"],
            next_attempt_at(self.exam, attempt.started_at).isoformat(),
        )
        self.assertIsNone(data["active_attempt_id"])
        self.client.force_authenticate(self.owner)
        self.assertIsNone(
            self.client.get(f"/api/exams/{self.exam.pk}/").json()["next_attempt_at"]
        )
        self.assertIsNone(self.client.get("/api/exams/").json()[0]["next_attempt_at"])
        inv = self.invite()
        guest = APIClient()
        response = guest.post(
            "/api/guest/exchange/", {"token": "retry-token"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["next_attempt_at"],
            data["next_attempt_at"].replace("+00:00", "Z"),
        )
        self.assertEqual(
            guest.post("/api/guest/exam/", {}, format="json").json()["code"],
            "retry_wait",
        )
        inv.require_email_verification = True
        inv.verification_email = self.user.email
        inv.save()
        challenge = (
            APIClient()
            .post("/api/guest/exchange/", {"token": "retry-token"}, format="json")
            .json()
        )
        self.assertTrue(challenge["verification_required"])
        self.assertNotIn("next_attempt_at", challenge)
        self.assertNotIn("remaining", challenge)

    def test_current_policy_changes_affect_new_starts_and_zero_removes_wait(self):
        first = self.start_and_finish()
        with patch(
            "training.services.timezone.now",
            return_value=first.started_at + timedelta(minutes=30),
        ):
            with self.assertRaises(PermissionDenied):
                start_attempt(self.exam.pk, self.identity)
            self.exam.retry_interval_minutes = 15
            self.exam.save()
            second = start_attempt(self.exam.pk, self.identity)
        finalize(second)
        self.exam.retry_interval_minutes = 0
        self.exam.save()
        third = start_attempt(self.exam.pk, self.identity)
        self.assertEqual(third.number, 3)
        first.refresh_from_db()
        self.assertEqual(first.status, "graded")
        self.assertEqual(first.snapshot, third.snapshot)

    def test_expired_attempt_does_not_restart_retry_clock(self):
        first = start_attempt(self.exam.pk, self.identity)
        Attempt.objects.filter(pk=first.pk).update(
            answers={str(first.snapshot[0]["id"]): 1}
        )
        with patch(
            "training.services.timezone.now",
            return_value=first.started_at + timedelta(minutes=40),
        ):
            with self.assertRaises(PermissionDenied):
                start_attempt(self.exam.pk, self.identity)
        with patch(
            "training.services.timezone.now",
            return_value=first.started_at + timedelta(minutes=60),
        ):
            second = start_attempt(self.exam.pk, self.identity)
        first.refresh_from_db()
        self.assertEqual(first.score, 100)
        self.assertEqual(second.number, 2)
        self.assertEqual(AttemptBudget.objects.get().used, 2)

    def test_retry_timestamp_does_not_override_schedule_or_attempt_limit(self):
        first = self.start_and_finish()
        self.exam.ends_at = first.started_at + timedelta(minutes=30)
        self.exam.save()
        with patch(
            "training.services.timezone.now",
            return_value=first.started_at + timedelta(hours=2),
        ):
            with self.assertRaisesMessage(PermissionDenied, "not open"):
                start_attempt(self.exam.pk, self.identity)
        self.exam.ends_at = None
        self.exam.max_attempts = 1
        self.exam.save()
        with self.assertRaisesMessage(PermissionDenied, "attempt limit"):
            start_attempt(self.exam.pk, self.identity)


class ConcurrentRetryTests(TransactionTestCase):
    def test_parallel_account_and_guest_retries_share_one_start(self):
        if connection.vendor != "postgresql":
            self.skipTest("Row-lock concurrency verification requires PostgreSQL.")
        user = User.objects.create_user(
            "parallel-retry", email="parallel-retry@example.com"
        )
        identity = identity_for_user(user)
        exam = make_exam(user, limit=5)
        exam.retry_interval_minutes = 60
        exam.save()
        first = start_attempt(exam.pk, identity)
        finalize(first)
        inv = Invitation.objects.create(
            exam=exam,
            identity=identity,
            created_by=user,
            token_hash=hash_token("parallel-retry"),
            expires_at=timezone.now() + timedelta(days=1),
            max_attempts=5,
        )

        def start(use_guest):
            try:
                try:
                    result = start_attempt(
                        exam.pk,
                        Identity.objects.get(pk=identity.pk),
                        Invitation.objects.get(pk=inv.pk) if use_guest else None,
                    )
                    return str(result.pk)
                except PermissionDenied as error:
                    return error.detail["code"]
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(
                list(pool.map(start, [True, False, True, False])), ["retry_wait"] * 4
            )
        self.assertEqual(AttemptBudget.objects.get().used, 1)
        inv.refresh_from_db()
        self.assertEqual(inv.used, 0)
        Attempt.objects.filter(pk=first.pk).update(
            started_at=timezone.now() - timedelta(minutes=61)
        )
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(start, [True, False, True, False]))
        self.assertEqual(len(set(results)), 1)
        self.assertNotEqual(results[0], "retry_wait")
        self.assertEqual(AttemptBudget.objects.get().used, 2)
        inv.refresh_from_db()
        second = Attempt.objects.get(pk=results[0])
        self.assertEqual(inv.used, 1 if second.invitation_id else 0)
