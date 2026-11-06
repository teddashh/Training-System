import io
import json
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.core import mail
from django.core.management import call_command
from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APIClient

from .management.commands.import_yaksh import convert_question
from .models import (
    Attempt,
    AttemptBudget,
    Course,
    Enrollment,
    Exam,
    Identity,
    Invitation,
    Question,
    ScormState,
    User,
)
from .scorm import inspect_package
from .services import (
    finalize,
    hash_token,
    identity_for_user,
    resolve_identity,
    start_attempt,
)


def make_exam(owner, limit=2, essay=False):
    exam = Exam.objects.create(
        title="Independent assessment", owner=owner, published=True, max_attempts=limit
    )
    Question.objects.create(
        exam=exam,
        description="Select the safe option",
        options=["unsafe", "safe"],
        solution=[1],
        points=60,
    )
    if essay:
        Question.objects.create(
            exam=exam, type="essay", description="Explain", points=40
        )
    return exam


def package_zip(extra=None, multi=False):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        z.writestr(
            "imsmanifest.xml",
            '<manifest xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"><metadata><schemaversion>1.2</schemaversion></metadata><organizations><organization><title>Test</title></organization></organizations><resources><resource identifier="R" adlcp:scormtype="sco" href="index.html"/>'
            + (
                '<resource identifier="R2" adlcp:scormtype="sco" href="index.html"/>'
                if multi
                else ""
            )
            + "</resources></manifest>",
        )
        z.writestr("index.html", "<html><body>Course</body></html>")
        if extra:
            for name, content in extra.items():
                z.writestr(name, content)
    data.seek(0)
    return data


@override_settings(
    DEBUG=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)
class EnterpriseTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            "admin", "admin@example.com", "strong-test-password", role="admin"
        )
        self.user = User.objects.create_user(
            "learner", "learner@example.com", "strong-test-password", employee_id="E001"
        )
        self.other = User.objects.create_user(
            "other", "other@example.com", "strong-test-password"
        )
        self.identity = identity_for_user(self.user)
        self.exam = make_exam(self.admin)
        self.client = APIClient()

    def login(self, user=None):
        self.client.force_authenticate(user or self.user)

    def invite(self, token="secret-link", limit=2):
        return Invitation.objects.create(
            exam=self.exam,
            identity=self.identity,
            token_hash=hash_token(token),
            max_attempts=limit,
            expires_at=timezone.now() + timedelta(days=1),
            created_by=self.admin,
        )

    def test_independent_exam_and_resume_do_not_double_charge(self):
        first = start_attempt(self.exam.pk, self.identity)
        second = start_attempt(self.exam.pk, self.identity)
        self.assertEqual(first.id, second.id)
        self.assertIsNone(self.exam.course_id)
        self.assertEqual(
            AttemptBudget.objects.get(exam=self.exam, identity=self.identity).used, 1
        )

    def test_attempt_limit_and_invitation_reissue_share_budget(self):
        inv = self.invite()
        finalize(start_attempt(self.exam.id, self.identity))
        finalize(start_attempt(self.exam.id, self.identity, inv))
        second_inv = self.invite("new-token")
        with self.assertRaises(PermissionDenied):
            start_attempt(self.exam.id, self.identity, second_inv)
        self.assertEqual(Attempt.objects.count(), 2)

    def test_employee_email_and_username_resolve_same_identity(self):
        for key in [" E001 ", "LEARNER@EXAMPLE.COM", "LEARNER"]:
            self.assertEqual(resolve_identity(key).id, self.identity.id)

    def test_guest_identity_links_when_account_is_provisioned(self):
        guest = resolve_identity("new@example.com")
        person = User.objects.create_user("new", "new@example.com")
        self.assertEqual(identity_for_user(person).id, guest.id)

    def test_link_limit_exhausted_but_account_budget_remains(self):
        inv = self.invite(limit=1)
        finalize(start_attempt(self.exam.id, self.identity, inv))
        with self.assertRaises(PermissionDenied):
            start_attempt(self.exam.id, self.identity, inv)
        second = start_attempt(self.exam.id, self.identity)
        self.assertEqual(second.number, 2)

    def test_expired_and_revoked_invites_rejected(self):
        inv = self.invite()
        inv.revoked = True
        inv.save()
        with self.assertRaises(PermissionDenied):
            start_attempt(self.exam.id, self.identity, inv)
        inv.revoked = False
        inv.expires_at = timezone.now() - timedelta(seconds=1)
        inv.save()
        with self.assertRaises(PermissionDenied):
            start_attempt(self.exam.id, self.identity, inv)

    def test_question_solutions_never_leak_to_learner(self):
        self.login()
        detail = self.client.get(f"/api/exams/{self.exam.id}/").json()
        self.assertNotIn("questions", detail)
        response = self.client.post(
            f"/api/exams/{self.exam.id}/start/", {}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("solution", response.json()["questions"][0])

    def test_snapshot_remains_unchanged_after_edit(self):
        attempt = start_attempt(self.exam.id, self.identity)
        q = self.exam.questions.first()
        q.solution = [0]
        q.points = 100
        q.save()
        attempt.answers = {str(q.id): 1}
        finalize(attempt)
        self.assertEqual(attempt.score, 100)

    def test_submission_is_idempotent_and_locked(self):
        self.login()
        attempt = start_attempt(self.exam.id, self.identity)
        url = f"/api/attempts/{attempt.id}/"
        q = attempt.snapshot[0]
        first = self.client.post(url, {"answers": {str(q["id"]): 1}}, format="json")
        second = self.client.post(url, {"answers": {str(q["id"]): 0}}, format="json")
        self.assertEqual(first.json()["score"], 100)
        self.assertEqual(second.json()["score"], 100)

    def test_late_answers_are_not_accepted(self):
        self.login()
        attempt = start_attempt(self.exam.id, self.identity)
        attempt.deadline = timezone.now() - timedelta(seconds=1)
        attempt.save()
        response = self.client.post(
            f"/api/attempts/{attempt.id}/",
            {"answers": {str(attempt.snapshot[0]["id"]): 1}},
            format="json",
        )
        self.assertEqual(response.json()["score"], 0)

    def test_foreign_attempt_is_not_readable(self):
        self.login(self.other)
        attempt = start_attempt(self.exam.id, self.identity)
        response = self.client.get(f"/api/attempts/{attempt.id}/")
        self.assertIn(response.status_code, [403, 404])

    def test_guest_cannot_change_bound_identity(self):
        inv = self.invite()
        self.client.post(
            "/api/guest/exchange/", {"token": "secret-link"}, format="json"
        )
        response = self.client.post(
            "/api/guest/exam/", {"email": "other@example.com"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            Attempt.objects.get(pk=response.json()["id"]).identity_id, inv.identity_id
        )
        self.assertEqual(self.client.get("/api/users/").status_code, 403)

    def test_guest_revocation_blocks_existing_session(self):
        inv = self.invite()
        self.client.post(
            "/api/guest/exchange/", {"token": "secret-link"}, format="json"
        )
        inv.revoked = True
        inv.save()
        self.assertEqual(self.client.get("/api/guest/exam/").status_code, 403)

    def test_anonymous_mutations_require_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(
            client.post(
                "/api/auth/login/",
                {"identifier": "learner", "password": "strong-test-password"},
            ).status_code,
            403,
        )
        self.assertEqual(
            client.post("/api/guest/exchange/", {"token": "x"}).status_code, 403
        )
        client.get("/api/auth/session/")
        csrf = client.cookies[settings.CSRF_COOKIE_NAME].value
        self.assertEqual(
            client.post(
                "/api/auth/login/",
                {"identifier": "E001", "password": "strong-test-password"},
                HTTP_X_CSRFTOKEN=csrf,
            ).status_code,
            200,
        )

    def test_email_code_one_time_and_no_registration(self):
        self.client.post(
            "/api/auth/email/request/", {"email": self.user.email}, format="json"
        )
        code = __import__("re").search(r"\b[0-9]{6}\b", mail.outbox[0].body).group()
        first = self.client.post(
            "/api/auth/email/verify/",
            {"email": self.user.email, "code": code},
            format="json",
        )
        self.assertEqual(first.status_code, 200)
        self.client.logout()
        self.assertEqual(
            self.client.post(
                "/api/auth/email/verify/",
                {"email": self.user.email, "code": code},
                format="json",
            ).status_code,
            400,
        )
        before = User.objects.count()
        self.client.post(
            "/api/auth/email/request/", {"email": "unknown@example.com"}, format="json"
        )
        self.assertEqual(User.objects.count(), before)
        self.assertEqual(len(mail.outbox), 1)

    def test_learner_cannot_administer_or_grade(self):
        self.login()
        for path, payload in [
            ("users/", {"username": "hacker", "role": "admin"}),
            ("exams/", {"title": "hack"}),
            ("courses/", {"title": "hack"}),
        ]:
            self.assertEqual(
                self.client.post("/api/" + path, payload, format="json").status_code,
                403,
            )
        response = self.client.post(
            f"/api/exams/{self.exam.id}/budget/",
            {"key": "learner", "limit": 9},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_manual_review_and_regrade_audited(self):
        exam = make_exam(self.admin, essay=True)
        attempt = start_attempt(exam.id, self.identity)
        attempt.answers = {str(attempt.snapshot[0]["id"]): 1}
        finalize(attempt)
        self.assertEqual(attempt.status, "pending_review")
        self.login(self.admin)
        essay_id = str(attempt.snapshot[1]["id"])
        response = self.client.post(
            f"/api/results/{attempt.id}/review/",
            {"grades": {essay_id: {"points": 41}}},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            f"/api/results/{attempt.id}/review/",
            {"grades": {essay_id: {"points": 30, "feedback": "Good"}}},
            format="json",
        )
        self.assertEqual(response.json()["score"], 90)
        self.assertTrue(response.json()["passed"])

    def test_invalid_options_and_question_keys_rejected(self):
        self.login()
        attempt = start_attempt(self.exam.id, self.identity)
        for answers in [{str(attempt.snapshot[0]["id"]): 99}, {"99999": "fake"}]:
            self.assertEqual(
                self.client.patch(
                    f"/api/attempts/{attempt.id}/", {"answers": answers}, format="json"
                ).status_code,
                400,
            )

    def test_instructor_cannot_edit_other_instructors_exam(self):
        instructor = User.objects.create_user("teacher", role="instructor")
        self.login(instructor)
        response = self.client.patch(
            f"/api/exams/{self.exam.id}/", {"title": "Changed"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_csv_escapes_formula_injection(self):
        self.exam.title = '=HYPERLINK("evil")'
        self.exam.save()
        finalize(start_attempt(self.exam.id, self.identity))
        self.login(self.admin)
        response = self.client.get("/api/results/export/")
        self.assertIn("'=HYPERLINK", response.content.decode())

    def test_dashboard_learner_only_sees_own_data(self):
        finalize(start_attempt(self.exam.id, identity_for_user(self.other)))
        self.login()
        data = self.client.get("/api/dashboard/").json()
        self.assertEqual(data["people"], 1)
        self.assertEqual(data["graded_count"], 0)

    def test_scheduled_exam_and_deadline_cap(self):
        self.exam.starts_at = timezone.now() + timedelta(days=1)
        self.exam.save()
        with self.assertRaises(PermissionDenied):
            start_attempt(self.exam.id, self.identity)
        self.exam.starts_at = None
        self.exam.ends_at = timezone.now() + timedelta(minutes=1)
        self.exam.save()
        self.assertEqual(
            start_attempt(self.exam.id, self.identity).deadline, self.exam.ends_at
        )

    def test_scorm_manifest_and_zip_security(self):
        archive, version, launch, _ = inspect_package(package_zip())
        self.assertEqual(version, "1.2")
        self.assertEqual(launch, "index.html")
        archive.close()
        for bad in [
            package_zip({"../escape.js": "bad"}),
            package_zip({"%2e%2e/escape": "bad"}),
            package_zip(multi=True),
            io.BytesIO(b"not zip"),
        ]:
            with self.assertRaises(ValidationError):
                inspect_package(bad)

    def test_scorm_upload_launch_commit_and_source(self):
        course = Course.objects.create(title="SCORM", owner=self.admin, published=True)
        self.login(self.admin)
        with (
            tempfile.TemporaryDirectory() as media,
            override_settings(MEDIA_ROOT=__import__("pathlib").Path(media)),
        ):
            upload = package_zip()
            upload.name = "course.zip"
            response = self.client.post(
                f"/api/courses/{course.id}/upload/",
                {"file": upload},
                format="multipart",
            )
            self.assertEqual(response.status_code, 201, response.content)
            package_id = response.json()["id"]
            launched = self.client.post(
                f"/api/scorm/{package_id}/launch/", {}, format="json"
            ).json()
            response = self.client.post(
                f"/api/scorm/{package_id}/commit/",
                {"nonce": "wrong", "cmi": {}},
                format="json",
            )
            self.assertEqual(response.status_code, 403)
            response = self.client.post(
                f"/api/scorm/{package_id}/commit/",
                {
                    "nonce": launched["nonce"],
                    "cmi": {
                        "cmi.core.lesson_status": "completed",
                        "cmi.suspend_data": "resume",
                    },
                },
                format="json",
            )
            self.assertTrue(response.json()["completed"])
            self.assertEqual(
                Enrollment.objects.get(user=self.admin, course=course).progress, 100
            )
            self.assertEqual(
                ScormState.objects.get(user=self.admin).cmi["cmi.suspend_data"],
                "resume",
            )
            with override_settings(ROOT_URLCONF="config.content_urls"):
                token = launched["url"].split("ticket=")[1]
                from urllib.parse import unquote

                content = APIClient()
                self.assertEqual(
                    content.get(f"/packages/{package_id}/index.html").status_code, 403
                )
                response = content.get("/launch", {"ticket": unquote(token)})
                self.assertEqual(response.status_code, 200)
                self.assertIn("frame-ancestors", response["Content-Security-Policy"])
                self.assertEqual(
                    content.get(f"/packages/{package_id}/index.html").status_code, 200
                )

    def test_yaksh_adapter_preserves_correct_options(self):
        row = convert_question(
            {
                "type": "mcc",
                "description": "<p>Choose</p>",
                "points": 5,
                "testcase": [
                    {"options": "A", "correct": True},
                    {"options": "B", "correct": False},
                    {"options": "C", "correct": True},
                ],
            }
        )
        self.assertEqual(row["solution"], [0, 2])
        self.assertEqual(row["description"], "Choose")
        with self.assertRaises(ValueError):
            convert_question({"type": "code"})

    def test_admin_can_create_multiple_email_only_accounts(self):
        self.login(self.admin)
        for i in range(2):
            response = self.client.post(
                "/api/users/",
                {
                    "username": f"new{i}",
                    "email": f"new{i}@example.com",
                    "employee_id": "",
                    "role": "learner",
                },
                format="json",
            )
            self.assertEqual(response.status_code, 201, response.content)


class ConcurrentBudgetTests(TransactionTestCase):
    def test_parallel_starts_consume_only_one_slot(self):
        if connection.vendor != "postgresql":
            self.skipTest(
                "Row-lock concurrency verification requires PostgreSQL (CI and Compose)."
            )
        user = User.objects.create_user("race", email="race@example.com")
        identity = identity_for_user(user)
        exam = make_exam(user, limit=1)

        def run(_):
            try:
                return start_attempt(exam.id, Identity.objects.get(pk=identity.id)).id
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=5) as pool:
            ids = list(pool.map(run, range(5)))
        self.assertEqual(len(set(ids)), 1)
        self.assertEqual(AttemptBudget.objects.get().used, 1)


@override_settings(DEBUG=True)
class LanguageTests(TestCase):
    def test_validation_messages_follow_request_language_and_default_to_english(self):
        client = APIClient()
        for language, expected in [
            ("en", "Incorrect account or password."),
            ("es", "Cuenta o contraseña incorrectas."),
            ("zh-hant", "帳號或密碼不正確。"),
            ("fr", "Incorrect account or password."),
        ]:
            response = client.post(
                "/api/auth/login/",
                {"identifier": "missing", "password": "invalid"},
                format="json",
                HTTP_ACCEPT_LANGUAGE=language,
            )
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], expected)
        response = client.post("/api/auth/login/", {}, format="json")
        self.assertEqual(response.json()["detail"], "Incorrect account or password.")

    def test_shared_catalog_has_three_locales_and_matching_variables(self):
        import re
        from pathlib import Path

        messages = json.loads(
            (Path(settings.LOCALE_ROOT) / "messages.json").read_text()
        )
        for key, locales in messages.items():
            self.assertEqual(set(locales), {"en", "zh-TW", "es"}, key)
            variables = set(re.findall(r"\{\w+\}", locales["en"]))
            for locale, text in locales.items():
                self.assertTrue(text, (key, locale))
                self.assertEqual(
                    set(re.findall(r"\{\w+\}", text)), variables, (key, locale)
                )


@override_settings(
    DEBUG=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)
class ExamAccessTests(TestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.admin = User.objects.create_user("organizer", role="admin")
        self.employee = User.objects.create_user(
            "staff",
            "staff@example.com",
            employment="employee",
            department="Engineering",
        )
        self.contractor = User.objects.create_user(
            "partner",
            "partner@example.com",
            employment="contractor",
            department="Operations",
        )
        self.exam = make_exam(self.admin)
        self.identity = identity_for_user(self.employee)
        self.client = APIClient()

    def invitation(self, token="verified-link"):
        return Invitation.objects.create(
            exam=self.exam,
            identity=self.identity,
            token_hash=hash_token(token),
            max_attempts=1,
            expires_at=timezone.now() + timedelta(days=1),
            created_by=self.admin,
            require_email_verification=True,
            verification_email=self.employee.email,
        )

    def exchange(self, client=None, token="verified-link"):
        return (client or self.client).post(
            "/api/guest/exchange/", {"token": token}, format="json"
        )

    def send_code(self, client=None):
        import re

        response = (client or self.client).post(
            "/api/guest/email/request/", {}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        return re.search(r"\b\d{6}\b", mail.outbox[-1].body).group()

    def verify(self, code, client=None):
        return (client or self.client).post(
            "/api/guest/email/verify/", {"code": code}, format="json"
        )

    def test_audience_modes_are_enforced_in_lists_and_direct_starts(self):
        from .services import in_exam_audience

        for mode, allowed in [
            ("all", True),
            ("employees", True),
            ("contractors", False),
            ("departments", True),
            ("people", False),
            ("invitation", False),
        ]:
            self.exam.audience = mode
            self.exam.allowed_departments = ["Engineering"]
            self.exam.allowed_users.set([self.contractor])
            self.exam.save()
            self.assertEqual(in_exam_audience(self.exam, self.employee), allowed, mode)
            self.client.force_authenticate(self.employee)
            ids = [row["id"] for row in self.client.get("/api/exams/").json()]
            self.assertEqual(self.exam.id in ids, allowed, mode)
            if not allowed:
                with self.assertRaises(PermissionDenied):
                    start_attempt(self.exam.id, self.identity)
                self.assertEqual(
                    self.client.post(
                        f"/api/exams/{self.exam.id}/start/", {}
                    ).status_code,
                    404,
                )
        self.assertEqual(Attempt.objects.count(), 0)
        self.assertEqual(AttemptBudget.objects.count(), 0)

    def test_selected_people_validation_and_private_assignments(self):
        self.client.force_authenticate(self.admin)
        url = f"/api/exams/{self.exam.id}/"
        self.assertEqual(
            self.client.patch(
                url, {"audience": "people", "allowed_users": []}, format="json"
            ).status_code,
            400,
        )
        response = self.client.patch(
            url,
            {"audience": "people", "allowed_users": [self.employee.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["allowed_users"], [self.employee.id])
        self.client.force_authenticate(self.employee)
        detail = self.client.get(url).json()
        self.assertNotIn("allowed_users", detail)
        self.assertNotIn("questions", detail)
        self.assertFalse(detail["can_manage"])
        self.assertEqual(
            self.client.get("/api/exams/audience-options/").status_code, 403
        )
        self.assertEqual(
            self.client.patch(url, {"audience": "all"}, format="json").status_code, 403
        )
        self.assertEqual(self.client.post(url + "start/", {}).status_code, 200)

    def test_instructor_can_manage_only_owned_exams(self):
        instructor = User.objects.create_user("instructor", role="instructor")
        self.client.force_authenticate(instructor)
        self.assertFalse(
            self.client.get(f"/api/exams/{self.exam.id}/").json()["can_manage"]
        )
        self.assertEqual(
            self.client.patch(
                f"/api/exams/{self.exam.id}/", {"audience": "invitation"}, format="json"
            ).status_code,
            403,
        )
        own = make_exam(instructor)
        self.assertEqual(
            self.client.patch(
                f"/api/exams/{own.id}/", {"audience": "invitation"}, format="json"
            ).status_code,
            200,
        )

    def test_existing_attempt_survives_audience_change_but_new_start_is_rejected(self):
        attempt = start_attempt(self.exam.id, self.identity)
        self.exam.audience = "invitation"
        self.exam.save()
        self.assertEqual(start_attempt(self.exam.id, self.identity).id, attempt.id)
        self.client.force_authenticate(self.employee)
        self.assertEqual(
            self.client.get(f"/api/attempts/{attempt.id}/").status_code, 200
        )
        finalize(attempt)
        with self.assertRaises(PermissionDenied):
            start_attempt(self.exam.id, self.identity)
        self.assertEqual(AttemptBudget.objects.get().used, 1)

    def test_former_instructor_cannot_read_solutions_or_owned_drafts(self):
        former = User.objects.create_user("former-instructor", role="learner")
        exam = make_exam(former)
        self.client.force_authenticate(former)
        detail = self.client.get(f"/api/exams/{exam.id}/").json()
        self.assertFalse(detail["can_manage"])
        self.assertNotIn("questions", detail)
        self.assertNotIn("allowed_users", detail)
        exam.published = False
        exam.save()
        self.assertEqual(self.client.get(f"/api/exams/{exam.id}/").status_code, 404)

    def test_verified_link_grants_audience_access_and_consumes_budget_only_on_start(
        self,
    ):
        from .models import GuestEmailChallenge

        self.exam.audience = "invitation"
        self.exam.save()
        self.invitation()
        response = self.exchange()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["verification_required"])
        self.assertEqual(response.json()["email_hint"], "s***@example.com")
        self.assertNotIn(self.employee.email, str(response.json()))
        self.assertEqual(self.client.post("/api/guest/exam/", {}).status_code, 404)
        self.assertTrue(
            self.client.get("/api/guest/exam/").json()["verification_required"]
        )
        code = self.send_code()
        self.assertNotIn(code, GuestEmailChallenge.objects.get().digest)
        self.assertEqual(mail.outbox[-1].to, [self.employee.email])
        self.assertEqual(self.verify(code).status_code, 200)
        self.assertFalse(GuestEmailChallenge.objects.exists())
        self.assertFalse(Attempt.objects.exists())
        self.assertFalse(AttemptBudget.objects.exists())
        response = self.client.post("/api/guest/exam/", {})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(AttemptBudget.objects.get().used, 1)
        self.assertEqual(Invitation.objects.get().used, 1)
        self.assertEqual(
            self.client.post("/api/guest/exam/", {}).json()["id"], response.json()["id"]
        )
        self.assertEqual(self.verify(code).status_code, 404)

    def test_codes_are_bound_to_session_and_resend_invalidates_previous_code(self):
        self.invitation()
        self.exchange()
        with patch("training.views.secrets.randbelow", return_value=123456):
            first = self.send_code()
        other = APIClient()
        self.exchange(other)
        self.assertEqual(self.verify(first, other).status_code, 400)
        with patch("training.views.secrets.randbelow", return_value=654321):
            second = self.send_code()
        self.assertEqual(self.verify(first).status_code, 400)
        self.assertEqual(self.verify(second).status_code, 200)

    def test_five_wrong_entries_lock_code_even_if_next_code_is_correct(self):
        self.invitation()
        self.exchange()
        code = self.send_code()
        for _ in range(5):
            self.assertEqual(self.verify("not-a-code").status_code, 400)
        self.assertEqual(self.verify(code).status_code, 400)
        self.assertEqual(self.client.post("/api/guest/exam/", {}).status_code, 404)
        self.assertEqual(self.verify(self.send_code()).status_code, 200)

    def test_expired_code_and_revoked_invitation_cannot_verify(self):
        from .models import GuestEmailChallenge

        inv = self.invitation()
        self.exchange()
        code = self.send_code()
        GuestEmailChallenge.objects.update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(self.verify(code).status_code, 400)
        call_command("expire_attempts", stdout=io.StringIO())
        self.assertFalse(GuestEmailChallenge.objects.exists())
        code = self.send_code()
        inv.revoked = True
        inv.save()
        self.assertEqual(self.verify(code).status_code, 403)
        self.assertEqual(
            self.client.post("/api/guest/email/request/", {}).status_code, 403
        )
        self.assertFalse(Attempt.objects.exists())

    def test_email_delivery_failure_removes_challenge_and_allows_retry(self):
        from .models import GuestEmailChallenge

        self.invitation()
        self.exchange()
        with patch(
            "django.core.mail.send_mail", side_effect=OSError("mail unavailable")
        ):
            response = self.client.post("/api/guest/email/request/", {})
        self.assertEqual(response.status_code, 503)
        self.assertFalse(GuestEmailChallenge.objects.exists())
        self.assertNotIn("guest_challenge", self.client.session)
        self.assertEqual(self.verify(self.send_code()).status_code, 200)

    def test_guest_email_endpoints_require_csrf(self):
        self.invitation()
        client = APIClient(enforce_csrf_checks=True)
        client.get("/api/auth/session/")
        csrf = client.cookies[settings.CSRF_COOKIE_NAME].value
        self.assertEqual(
            client.post(
                "/api/guest/exchange/",
                {"token": "verified-link"},
                HTTP_X_CSRFTOKEN=csrf,
            ).status_code,
            200,
        )
        for path in ["request", "verify"]:
            self.assertEqual(
                client.post(f"/api/guest/email/{path}/", {}).status_code, 403
            )
        self.assertEqual(
            client.post(
                "/api/guest/email/request/", {}, HTTP_X_CSRFTOKEN=csrf
            ).status_code,
            200,
        )

    def test_verified_invitation_requires_valid_mailbox_for_account_key(self):
        self.client.force_authenticate(self.admin)
        payload = {
            "exam": self.exam.id,
            "key": "external-contractor",
            "require_email_verification": True,
        }
        self.assertEqual(
            self.client.post(
                "/api/invitations/issue/", payload, format="json"
            ).status_code,
            400,
        )
        response = self.client.post(
            "/api/invitations/issue/",
            {**payload, "verification_email": "recipient@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.json()["require_email_verification"])
        self.assertEqual(response.json()["verification_email"], "recipient@example.com")
