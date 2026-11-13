import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from .models import User


class MountSettingsTests(SimpleTestCase):
    def settings_process(self, **extra):
        env = {**os.environ, "DEBUG": "true", "APP_ORIGIN": "https://learn.example.test",
               "SCORM_ORIGIN": "https://content.example.test", "APP_BASE_PATH": "/training/", **extra}
        env.pop("ENTRA_REDIRECT_URI", None)
        return subprocess.run([sys.executable, "-c",
            "import json; from config import settings as s; print(json.dumps({k:getattr(s,k) for k in "
            "['APP_BASE_PATH','APP_ORIGIN','FORCE_SCRIPT_NAME','STATIC_URL','ENTRA_REDIRECT_URI','CSRF_TRUSTED_ORIGINS']}))"],
            cwd=Path(__file__).resolve().parents[1], env=env, capture_output=True, text=True)

    def test_mount_path_is_separate_from_browser_origin(self):
        result = self.settings_process()
        self.assertEqual(result.returncode, 0, result.stderr)
        values = json.loads(result.stdout)
        self.assertEqual(values["APP_BASE_PATH"], "/training")
        self.assertEqual(values["FORCE_SCRIPT_NAME"], "/training")
        self.assertEqual(values["STATIC_URL"], "/training/static/")
        self.assertEqual(values["CSRF_TRUSTED_ORIGINS"], ["https://learn.example.test"])
        self.assertEqual(values["ENTRA_REDIRECT_URI"], "https://learn.example.test/training/api/auth/entra/callback/")

    def test_origin_paths_and_unsafe_mount_paths_are_rejected(self):
        for extra in ({"APP_ORIGIN": "https://learn.example.test/training"},
                      {"SCORM_ORIGIN": "https://learn.example.test/content"},
                      {"APP_BASE_PATH": "//other-host"}, {"APP_BASE_PATH": "/../training"}):
            with self.subTest(extra=extra):
                self.assertNotEqual(self.settings_process(**extra).returncode, 0)


@override_settings(DEBUG=True, APP_ORIGIN="https://learn.example.test", APP_BASE_PATH="/training",
                   ENTRA_TENANT_ID="test-tenant", ENTRA_REDIRECT_URI="https://learn.example.test/training/api/auth/entra/callback/")
class SubpathSSOTests(TestCase):
    def assert_callback_returns_to_mount(self, role):
        user = User.objects.create_user("linked-user", role=role, entra_subject="test-tenant:test-object")
        client = APIClient()
        with patch("training.auth_views.entra_client") as factory:
            factory.return_value.initiate_auth_code_flow.return_value = {
                "auth_uri": "https://login.microsoftonline.com/test-tenant/authorize", "state": "flow-state"}
            factory.return_value.acquire_token_by_auth_code_flow.return_value = {
                "id_token_claims": {"tid": "test-tenant", "oid": "test-object"}}
            self.assertEqual(client.get("/api/auth/entra/").status_code, 302)
            self.assertEqual(factory.return_value.initiate_auth_code_flow.call_args.kwargs["redirect_uri"],
                             "https://learn.example.test/training/api/auth/entra/callback/")
            response = client.get("/api/auth/entra/callback/?code=synthetic&state=flow-state")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "https://learn.example.test/training/")
        self.assertEqual(client.get("/api/auth/session/").json()["user"]["id"], user.pk)
        self.assertEqual(User.objects.count(), 1)

    def test_oidc_callback_returns_to_mount_and_preserves_linked_user(self):
        self.assert_callback_returns_to_mount('learner')

    def test_oidc_callback_returns_system_admin_to_mount_root(self):
        self.assert_callback_returns_to_mount('admin')
