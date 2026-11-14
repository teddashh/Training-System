"""Password sign-in can be turned off by the server."""

from django.test import Client, TestCase, override_settings
from rest_framework.test import APIClient

from .models import AuditEvent, AuthRate, User
from .readiness import deployment_readiness
from .test_system_settings import LOCAL


@override_settings(**LOCAL)
class PasswordSwitchTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            "admin",
            "admin@example.com",
            "strong-test-password",
            role="admin",
            is_staff=True,
        )
        self.learner = User.objects.create_user(
            "learner",
            "learner@example.com",
            "strong-test-password",
        )
        self.client = APIClient()

    def test_default_is_on(self):
        session = self.client.get("/api/auth/session/")
        self.assertEqual(session.status_code, 200)
        self.assertIs(session.data["sign_in"]["password"], True)

        login = self.client.post(
            "/api/auth/login/",
            {"identifier": "learner", "password": "strong-test-password"},
            format="json",
        )
        self.assertEqual(login.status_code, 200)

    @override_settings(PASSWORD_SIGN_IN=False)
    def test_session_flag_off(self):
        session = self.client.get("/api/auth/session/")
        self.assertEqual(session.status_code, 200)
        self.assertIs(session.data["sign_in"]["password"], False)

    @override_settings(PASSWORD_SIGN_IN=False)
    def test_sign_in_refused(self):
        login = self.client.post(
            "/api/auth/login/",
            {"identifier": "learner", "password": "strong-test-password"},
            format="json",
        )
        self.assertEqual(login.status_code, 403)
        self.assertEqual(login.data["detail"], "Password sign-in is off.")

        session = self.client.get("/api/auth/session/")
        self.assertIsNone(session.data["user"])
        self.assertEqual(AuditEvent.objects.filter(action="auth.password").count(), 0)
        self.assertEqual(AuthRate.objects.count(), 0)

    @override_settings(PASSWORD_SIGN_IN=False)
    def test_password_change_refused(self):
        self.client.force_authenticate(self.learner)
        response = self.client.post(
            "/api/auth/password/",
            {
                "current_password": "strong-test-password",
                "new_password": "Another-long-phrase-2026!",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["detail"], "Password sign-in is off.")

        self.learner.refresh_from_db()
        self.assertTrue(self.learner.check_password("strong-test-password"))

    def test_people_api(self):
        self.client.force_authenticate(self.admin)

        with override_settings(PASSWORD_SIGN_IN=False):
            rejected = self.client.post(
                "/api/users/",
                {
                    "username": "new-person",
                    "role": "learner",
                    "password": "Another-long-phrase-2026!",
                },
                format="json",
            )
            self.assertEqual(rejected.status_code, 400)
            self.assertIn("password", rejected.data)
            self.assertFalse(User.objects.filter(username="new-person").exists())

            created = self.client.post(
                "/api/users/",
                {"username": "new-person", "role": "learner"},
                format="json",
            )
            self.assertEqual(created.status_code, 201)
            self.assertFalse(
                User.objects.get(username="new-person").has_usable_password()
            )

            blank = self.client.post(
                "/api/users/",
                {"username": "blank-person", "role": "learner", "password": ""},
                format="json",
            )
            self.assertEqual(blank.status_code, 201)

            patch_password = self.client.patch(
                f"/api/users/{self.learner.id}/",
                {"password": "Another-long-phrase-2026!"},
                format="json",
            )
            self.assertEqual(patch_password.status_code, 400)
            self.learner.refresh_from_db()
            self.assertTrue(self.learner.check_password("strong-test-password"))

            patch_department = self.client.patch(
                f"/api/users/{self.learner.id}/",
                {"department": "Operations"},
                format="json",
            )
            self.assertEqual(patch_department.status_code, 200)

        allowed = self.client.post(
            "/api/users/",
            {
                "username": "allowed-person",
                "role": "learner",
                "password": "Another-long-phrase-2026!",
            },
            format="json",
        )
        self.assertEqual(allowed.status_code, 201)

    def test_data_tool_login_closed(self):
        client = Client()

        self.assertEqual(client.get("/admin/data/login/").status_code, 200)

        for prefix in ("", "/training"):
            with self.subTest(prefix=prefix), override_settings(
                PASSWORD_SIGN_IN=False, APP_BASE_PATH=prefix
            ):
                get_login = client.get("/admin/data/login/")
                self.assertEqual(get_login.status_code, 302)
                self.assertEqual(get_login["Location"], prefix + "/")

                post_login = client.post(
                    "/admin/data/login/",
                    {
                        "username": self.admin.username,
                        "password": "strong-test-password",
                    },
                )
                self.assertEqual(post_login.status_code, 302)
                self.assertEqual(post_login["Location"], prefix + "/")
                self.assertNotIn("_auth_user_id", client.session)

        with override_settings(PASSWORD_SIGN_IN=False):
            client.force_login(self.admin)
            self.assertEqual(client.get("/admin/data/").status_code, 200)

    def test_readiness(self):
        check = lambda: next(
            (c for c in deployment_readiness()["checks"] if c["key"] == "sign_in"),
            None,
        )

        self.assertIsNone(check())

        with override_settings(PASSWORD_SIGN_IN=False):
            self.assertEqual(check()["status"], "action_required")
            self.assertIs(deployment_readiness()["ready"], False)

            self.client.force_authenticate(self.admin)
            smtp = self.client.put(
                "/api/settings/email/",
                {
                    "provider": "smtp",
                    "host": "smtp.example.com",
                    "port": 587,
                    "security": "starttls",
                    "username": "sender@example.com",
                    "password": "synthetic-password",
                    "from_email": "sender@example.com",
                },
                format="json",
            )
            self.assertEqual(smtp.status_code, 200)
            self.assertEqual(check()["status"], "ready")
