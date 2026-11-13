"""Microsoft Graph mail transport for an Exchange-scoped application identity."""

import base64
from email.utils import parseaddr, parsedate_to_datetime
from datetime import datetime, timezone
import math
import re
import threading
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail.backends.base import BaseEmailBackend
from django.core.mail.message import sanitize_address
from django.core.validators import validate_email
import msal


class GraphMailError(OSError):
    """A delivery failure without credentials, recipient data or message content."""

    def __init__(self, message, *, status_code=None, retry_after=None):
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after if type(retry_after) is int and 1 <= retry_after <= 86400 else None


def retry_after_seconds(value):
    """Accept delta-seconds or an HTTP date; never retain raw provider headers."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    try:
        if re.fullmatch(r"[0-9]{1,6}", value):
            seconds = int(value)
        else:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                return None
            seconds = math.ceil((date - datetime.now(timezone.utc)).total_seconds())
        return seconds if 1 <= seconds <= 86400 else None
    except (TypeError, ValueError, OverflowError):
        return None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GraphEmailBackend(BaseEmailBackend):
    def __init__(self, fail_silently=False, *, tenant_id=None, client_id=None, client_secret=None, sender=None, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        self._configuration = dict(tenant_id=tenant_id, client_id=client_id, client_secret=client_secret, sender=sender)
        self._lock = threading.RLock()
        self._token = None
        self._opener = build_opener(NoRedirect())

    def open(self):
        if self._token:
            return False
        from .runtime_settings import mail_config
        values = self._configuration
        config = mail_config() if any(value is None for value in values.values()) else {}
        for key, value in values.items():
            setattr(self, key, config.get(key, config.get('from_email', '') if key == 'sender' else '') if value is None else value)
        try:
            tenant = str(UUID(self.tenant_id))
            client_id = str(UUID(self.client_id))
            validate_email(self.sender)
            if not self.client_secret:
                raise ValueError()
        except Exception:
            raise ImproperlyConfigured("Graph mail configuration is incomplete.") from None
        try:
            client = msal.ConfidentialClientApplication(
                client_id,
                authority=f"https://login.microsoftonline.com/{tenant}",
                client_credential=self.client_secret,
                timeout=settings.EMAIL_TIMEOUT,
            )
            result = client.acquire_token_for_client(
                scopes=["https://graph.microsoft.com/.default"]
            )
            self._token = result.get("access_token")
            if not self._token:
                raise GraphMailError("Graph mail authentication failed.")
        except Exception:
            raise GraphMailError("Graph mail authentication failed.") from None
        return True

    def close(self):
        self._token = None

    def send_messages(self, email_messages):
        if not email_messages:
            return 0
        sent = 0
        with self._lock:
            try:
                self.open()
                for message in email_messages:
                    if not message.recipients():
                        continue
                    if parseaddr(message.from_email)[1].casefold() != self.sender.casefold():
                        raise GraphMailError("Message sender differs from the configured Graph mailbox.")
                    mime = message.message()
                    # SMTP passes Bcc recipients separately; Graph MIME needs them in
                    # the submitted envelope. Exchange removes Bcc on delivery.
                    if message.bcc:
                        mime["Bcc"] = ", ".join(
                            sanitize_address(address, message.encoding or settings.DEFAULT_CHARSET)
                            for address in message.bcc
                        )
                    request = Request(
                        "https://graph.microsoft.com/v1.0/users/"
                        + quote(self.sender, safe="")
                        + "/sendMail",
                        data=base64.b64encode(mime.as_bytes(linesep="\r\n")),
                        headers={
                            "Authorization": "Bearer " + self._token,
                            "Content-Type": "text/plain",
                        },
                        method="POST",
                    )
                    # Never retry a mail POST automatically: a lost response can
                    # already represent an accepted message and an OTP delivery.
                    try:
                        with self._opener.open(request, timeout=settings.EMAIL_TIMEOUT) as response:
                            if response.status != 202:
                                raise GraphMailError("Graph mail was not accepted.")
                    except HTTPError as error:
                        raise GraphMailError(
                            f"Graph mail request failed (HTTP {error.code}).",
                            status_code=error.code,
                            retry_after=retry_after_seconds(error.headers.get("Retry-After")) if error.headers else None,
                        ) from None
                    except (URLError, TimeoutError, OSError):
                        raise GraphMailError("Graph mail transport failed.") from None
                    sent += 1
            except Exception:
                if not self.fail_silently:
                    raise
            finally:
                self.close()
        return sent


class ConfiguredEmailBackend(BaseEmailBackend):
    """Resolve stored transport at send time, including scheduler jobs outside requests."""
    def send_messages(self, email_messages):
        from django.core.mail.backends.smtp import EmailBackend
        from .runtime_settings import mail_config
        config = mail_config()
        if config['server']:
            from django.core.mail import get_connection
            return get_connection(config['backend'], fail_silently=self.fail_silently).send_messages(email_messages)
        if config['provider'] == 'off':
            return 0
        if not config['configured']:
            if self.fail_silently:
                return 0
            raise ImproperlyConfigured("Email configuration is incomplete.")
        if config['provider'] == 'graph':
            backend = GraphEmailBackend(fail_silently=self.fail_silently,
                tenant_id=config['tenant_id'], client_id=config['client_id'],
                client_secret=config['client_secret'], sender=config['from_email'])
        else:
            backend = EmailBackend(fail_silently=self.fail_silently, host=config['host'], port=config['port'],
                username=config.get('username', ''), password=config.get('password', ''),
                use_tls=config['security'] == 'starttls', use_ssl=config['security'] == 'ssl',
                timeout=settings.EMAIL_TIMEOUT)
        return backend.send_messages(email_messages)
