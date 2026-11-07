from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import Throttled
from rest_framework.test import APIClient, APIRequestFactory

from .auth_views import rate_limit
from .models import Attempt, AuthRate, Course, EmailCode, ScormPackage, ScormState, User
from .services import find_user, identity_for_user, start_attempt
from .tests import make_exam


@override_settings(DEBUG=True)
class AnswerReliabilityTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("writer", "writer@example.com")
        self.exam = make_exam(self.user)
        self.attempt = start_attempt(self.exam.pk, identity_for_user(self.user))
        self.key = str(self.attempt.snapshot[0]["id"])
        self.url = f"/api/attempts/{self.attempt.pk}/"
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_stale_save_and_submission_preserve_newer_answers(self):
        response = self.client.patch(
            self.url, {"answers": {self.key: 1}, "answer_revision": 0}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answer_revision"], 1)
        for method in [self.client.patch, self.client.post]:
            response = method(
                self.url,
                {"answers": {self.key: 0}, "answer_revision": 0},
                format="json",
            )
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["code"], "answer_conflict")
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.answers, {self.key: 1})
        self.assertEqual(self.attempt.status, "in_progress")
        response = self.client.post(
            self.url, {"answers": {self.key: 1}, "answer_revision": 1}, format="json"
        )
        self.assertEqual(response.json()["score"], 100)
        self.assertEqual(response.json()["answer_revision"], 2)
        repeat = self.client.post(
            self.url, {"answers": {}, "answer_revision": 1}, format="json"
        )
        self.assertEqual(repeat.json()["score"], 100)
        self.assertEqual(repeat.json()["answer_revision"], 2)

    def test_legacy_writes_advance_revision_and_invalid_revisions_are_rejected(self):
        for invalid in [True, "0", -1, 1.5]:
            response = self.client.patch(
                self.url, {"answers": {}, "answer_revision": invalid}, format="json"
            )
            self.assertEqual(response.status_code, 400)
        response = self.client.patch(
            self.url, {"answers": {self.key: 1}}, format="json"
        )
        self.assertEqual(response.json()["answer_revision"], 1)

    def test_deadline_uses_last_saved_answers_even_with_stale_revision(self):
        Attempt.objects.filter(pk=self.attempt.pk).update(
            answers={self.key: 1},
            answer_revision=2,
            deadline=timezone.now() - timedelta(seconds=1),
        )
        response = self.client.post(
            self.url, {"answers": {self.key: 0}, "answer_revision": 0}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answers"], {self.key: 1})
        self.assertEqual(response.json()["score"], 100)
        self.assertNotIn("solution", response.json()["questions"][0])

    def test_revision_does_not_allow_another_user_to_access_answers(self):
        other = User.objects.create_user("otherwriter")
        self.client.force_authenticate(other)
        response = self.client.patch(
            self.url, {"answers": {self.key: 1}, "answer_revision": 0}, format="json"
        )
        self.assertIn(response.status_code, [403, 404])
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.answer_revision, 0)


class ConcurrentAnswerTests(TransactionTestCase):
    def test_only_one_simultaneous_writer_can_use_a_revision(self):
        if connection.vendor != "postgresql":
            self.skipTest("Row-lock concurrency verification requires PostgreSQL.")
        user = User.objects.create_user("parallel-writer")
        attempt = start_attempt(make_exam(user).pk, identity_for_user(user))
        key = str(attempt.snapshot[0]["id"])

        def write(value):
            try:
                client = APIClient()
                client.force_authenticate(User.objects.get(pk=user.pk))
                response = client.patch(
                    f"/api/attempts/{attempt.pk}/",
                    {"answers": {key: value}, "answer_revision": 0},
                    format="json",
                )
                return response.status_code, value
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(write, [0, 1]))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        attempt.refresh_from_db()
        self.assertEqual(attempt.answer_revision, 1)
        self.assertEqual(
            attempt.answers[key],
            next(value for status, value in results if status == 200),
        )


@override_settings(DEBUG=True, AUTH_ACCOUNT_LIMIT=3, AUTH_NETWORK_LIMIT=30)
class SignInReliabilityTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            "office", "office@example.com", employee_id="E012"
        )
        self.request = APIRequestFactory().post("/", REMOTE_ADDR="192.0.2.10")

    def test_aliases_share_limit_and_response_has_retry_after(self):
        for identifier in ["OFFICE", "Office@example.com", " E012 "]:
            rate_limit(self.request, identifier)
        response = APIClient().post(
            "/api/auth/login/",
            {"identifier": "office", "password": "wrong"},
            REMOTE_ADDR="192.0.2.11",
        )
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)
        self.assertLessEqual(int(response["Retry-After"]), 600)

    def test_network_allows_different_accounts_and_ignores_forwarded_header(self):
        for number in range(30):
            self.request.META["HTTP_X_FORWARDED_FOR"] = f"203.0.113.{number}"
            rate_limit(self.request, f"worker-{number}")
        with self.assertRaises(Throttled):
            rate_limit(self.request, "one-more-worker")
        AuthRate.objects.update(window=timezone.now() - timedelta(minutes=11))
        rate_limit(self.request, "one-more-worker")

    def test_empty_identifier_does_not_resolve_employee_without_email(self):
        User.objects.create_user("employee", email="", employee_id="E013")
        self.assertIsNone(find_user("  "))

    def test_blank_email_does_not_issue_code_for_employee_without_email(self):
        User.objects.create_user("no-mail", email="", employee_id="E014")
        with patch("training.auth_views.send_mail") as delivery:
            response = APIClient().post("/api/auth/email/request/", {"email": "  "})
        self.assertEqual(response.status_code, 200)
        delivery.assert_not_called()
        self.assertFalse(EmailCode.objects.exists())

    def test_failed_older_email_does_not_delete_newer_code(self):
        def later_delivery(*args, **kwargs):
            EmailCode.objects.filter(email=self.user.email).update(digest="newer-code")
            raise OSError("Simulated earlier delivery failure")

        with patch("training.auth_views.send_mail", side_effect=later_delivery):
            response = APIClient().post(
                "/api/auth/email/request/", {"email": self.user.email}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            EmailCode.objects.get(email=self.user.email).digest, "newer-code"
        )

    def test_failed_current_email_discards_undelivered_code(self):
        with patch("training.auth_views.send_mail", side_effect=OSError("Offline")):
            response = APIClient().post(
                "/api/auth/email/request/", {"email": self.user.email}
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(EmailCode.objects.filter(email=self.user.email).exists())


@override_settings(DEBUG=True)
class LearningAccessTests(TestCase):
    def test_demoted_owner_cannot_launch_or_commit_draft_course(self):
        owner = User.objects.create_user("course-owner", role="instructor")
        course = Course.objects.create(title="Draft", owner=owner)
        package = ScormPackage.objects.create(
            course=course, launch_path="index.html", version="1.2"
        )
        client = APIClient()
        client.force_authenticate(owner)
        launch = client.post(f"/api/scorm/{package.pk}/launch/", {}, format="json")
        self.assertEqual(launch.status_code, 200)
        owner.role = "learner"
        owner.save()
        for action, data in [
            ("launch", {}),
            (
                "commit",
                {
                    "nonce": launch.json()["nonce"],
                    "cmi": {"cmi.suspend_data": "changed"},
                },
            ),
        ]:
            response = client.post(
                f"/api/scorm/{package.pk}/{action}/", data, format="json"
            )
            self.assertEqual(response.status_code, 403)
        self.assertFalse(ScormState.objects.exists())
