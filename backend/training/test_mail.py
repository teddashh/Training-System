import base64
from email import policy
from email.parser import BytesParser
from io import BytesIO
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

from django.core.exceptions import ImproperlyConfigured
from django.core.mail import EmailMessage, EmailMultiAlternatives
from django.test import SimpleTestCase, override_settings

from .mail import GraphEmailBackend, GraphMailError, NoRedirect, retry_after_seconds


@override_settings(
    GRAPH_MAIL_TENANT_ID="11111111-1111-1111-1111-111111111111",
    GRAPH_MAIL_CLIENT_ID="22222222-2222-2222-2222-222222222222",
    GRAPH_MAIL_CLIENT_SECRET="test-client-secret-never-log",
    GRAPH_MAIL_SENDER="training@example.test",
    EMAIL_TIMEOUT=10,
)
class GraphMailTests(SimpleTestCase):
    def setUp(self):
        self.msal = patch("training.mail.msal.ConfidentialClientApplication").start()
        self.addCleanup(patch.stopall)
        self.msal.return_value.acquire_token_for_client.return_value = {
            "access_token": "test-token-never-log"
        }
        self.backend = GraphEmailBackend()
        self.backend._opener = MagicMock()
        self.backend._opener.open.return_value.__enter__.return_value.status = 202

    def message(self, **kwargs):
        values = dict(subject="登入驗證", body="Your code: 123456", from_email="training@example.test", to=["learner@example.test"])
        values.update(kwargs)
        return EmailMessage(**values)

    def test_mime_preserves_unicode_alternatives_attachments_and_bcc(self):
        message = EmailMultiAlternatives(
            "登入驗證", "Plain text", "Training <training@example.test>",
            ["learner@example.test"], cc=["copy@example.test"], bcc=["hidden@example.test"],
        )
        message.attach_alternative("<p>HTML 中文</p>", "text/html")
        message.attach("lesson.txt", "課程", "text/plain")
        self.assertEqual(self.backend.send_messages([message]), 1)
        request = self.backend._opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://graph.microsoft.com/v1.0/users/training%40example.test/sendMail")
        self.assertEqual(request.get_header("Content-type"), "text/plain")
        mime = BytesParser(policy=policy.default).parsebytes(base64.b64decode(request.data))
        self.assertEqual(str(mime["Subject"]), "登入驗證")
        self.assertEqual(str(mime["Bcc"]), "hidden@example.test")
        self.assertEqual(str(mime["Cc"]), "copy@example.test")
        self.assertEqual(mime.get_body(preferencelist=("html",)).get_content(), "<p>HTML 中文</p>")
        self.assertEqual(next(mime.iter_attachments()).get_filename(), "lesson.txt")
        self.assertIsNone(self.backend._token)

    def test_other_sender_is_rejected_before_delivery(self):
        with self.assertRaisesRegex(GraphMailError, "sender differs"):
            self.backend.send_messages([self.message(from_email="someone@example.test")])
        self.backend._opener.open.assert_not_called()

    def test_token_failure_does_not_expose_provider_response(self):
        self.msal.return_value.acquire_token_for_client.return_value = {
            "error_description": "test-client-secret-never-log"
        }
        with self.assertRaises(GraphMailError) as caught:
            self.backend.send_messages([self.message()])
        self.assertNotIn("test-client-secret", str(caught.exception))
        self.backend._opener.open.assert_not_called()

    def test_failed_post_is_not_retried_and_does_not_expose_message(self):
        for error in (
            HTTPError("https://graph.microsoft.com", 429, "123456", {}, BytesIO(b"test-token-never-log")),
            URLError("test-token-never-log"),
        ):
            with self.subTest(error=type(error).__name__):
                self.backend._opener.open.reset_mock()
                self.backend._opener.open.side_effect = error
                with self.assertRaises(GraphMailError) as caught:
                    self.backend.send_messages([self.message()])
                self.assertNotIn("123456", str(caught.exception))
                self.assertNotIn("test-token", str(caught.exception))
                self.assertEqual(self.backend._opener.open.call_count, 1)

    def test_silent_failure_returns_count_of_accepted_messages(self):
        self.backend.fail_silently = True
        response = MagicMock()
        response.__enter__.return_value.status = 202
        self.backend._opener.open.side_effect = [response, URLError("offline")]
        self.assertEqual(self.backend.send_messages([self.message(), self.message()]), 1)

    def test_http_status_is_available_without_response_body_or_retries(self):
        for status in (400, 401, 403, 404, 429, 503):
            with self.subTest(status=status):
                self.backend._opener.open.reset_mock()
                self.backend._opener.open.side_effect = HTTPError(
                    "https://graph.microsoft.com", status, "sensitive", {}, BytesIO(b"sensitive"),
                )
                with self.assertRaises(GraphMailError) as caught:
                    self.backend.send_messages([self.message()])
                self.assertEqual(caught.exception.status_code, status)
                self.assertNotIn("sensitive", str(caught.exception))
                self.assertEqual(self.backend._opener.open.call_count, 1)

    def test_retry_after_is_validated_seconds_only(self):
        for raw, expected in (("120", 120), ("86400", 86400), ("0", None),
                              ("86401", None), ("-1", None), ("secret header", None),
                              ("1.5", None), (None, None)):
            self.assertEqual(retry_after_seconds(raw), expected)
        for value in ("120", True, 0, -1, 86401):
            self.assertIsNone(GraphMailError("failure", retry_after=value).retry_after)
        from datetime import datetime, timezone
        with patch('training.mail.datetime') as clock:
            clock.now.return_value = datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)
            self.assertEqual(retry_after_seconds('Wed, 11 Nov 2026 12:05:00 GMT'), 300)
            self.assertIsNone(retry_after_seconds('Wed, 11 Nov 2026 11:00:00 GMT'))

    def test_graph_error_passes_only_validated_retry_after(self):
        for raw, expected in (("120", 120), ("sensitive raw header", None)):
            self.backend._opener.open.side_effect = HTTPError(
                "https://graph.microsoft.com", 429, "sensitive", {"Retry-After": raw}, BytesIO(b"sensitive"),
            )
            with self.assertRaises(GraphMailError) as caught:
                self.backend.send_messages([self.message()])
            self.assertEqual(caught.exception.retry_after, expected)
            self.assertNotIn("sensitive", str(caught.exception))

    def test_no_recipient_or_empty_batch_sends_nothing(self):
        self.assertEqual(self.backend.send_messages([]), 0)
        self.msal.assert_not_called()
        self.assertEqual(self.backend.send_messages([self.message(to=[])]), 0)
        self.backend._opener.open.assert_not_called()

    def test_unexpected_success_status_is_not_counted(self):
        self.backend._opener.open.return_value.__enter__.return_value.status = 200
        with self.assertRaises(GraphMailError):
            self.backend.send_messages([self.message()])

    @override_settings(GRAPH_MAIL_TENANT_ID="invalid/authority")
    def test_invalid_configuration_never_contacts_identity_provider(self):
        with self.assertRaises(ImproperlyConfigured):
            self.backend.send_messages([self.message()])
        self.msal.assert_not_called()

    def test_redirects_are_not_followed_with_authorization(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "", {}, "https://untrusted.example"))
