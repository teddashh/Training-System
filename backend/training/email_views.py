"""Administrator-only delivery operations. Never expose message bodies or credentials."""

from .runtime_settings import organization, from_email, mail_enabled, mail_config
from .access import system_admin
from .brand import BRAND

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import Throttled, ValidationError
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from .email_layout import render_email
from .i18n import translate
from .models import EmailQueueState, OutboundEmail, User
from .notifications import accepted_last_day, logger, outcome_error, record_outcome, send_message
from .services import audit

NOTIFICATION_KINDS = {
    "assignment", "enrollment_approved", "enrollment_rejected", "enrollment_removed",
    "session_rescheduled", "session_cancelled",
}


class EmailAdministrator(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return system_admin(user)


def configured():
    return mail_config()['configured']


@api_view(["GET"])
@permission_classes([EmailAdministrator])
def email_log(request):
    rows = OutboundEmail.objects.select_related("recipient_user").order_by("-created_at", "-id")
    status = request.query_params.get("status", "all")
    if status not in ("all", *OutboundEmail.Status.values):
        raise ValidationError(translate("Invalid email status."))
    if status != "all":
        rows = rows.filter(status=status)
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (TypeError, ValueError):
        raise ValidationError(translate("Invalid page number."))
    count = rows.count()
    page = min(page, max(1, (count + 19) // 20))
    entries = []
    for row in rows[(page - 1) * 20:page * 20]:
        entries.append({
            "id": row.pk, "kind": row.kind, "to_email": row.to_email,
            "subject": row.subject, "status": row.status, "attempts": row.attempts,
            "last_error": row.last_error, "created_at": row.created_at, "sent_at": row.sent_at,
            "can_retry": row.status == "failed" and row.kind in NOTIFICATION_KINDS and bool(row.body_text)
                and bool(row.recipient_user_id and row.recipient_user.is_active),
        })
    state = EmailQueueState.objects.filter(pk=1).first()
    paused = bool(state and state.paused_until and state.paused_until > timezone.now())
    sent_last_24_hours = accepted_last_day()
    return Response({
        "sent_last_24_hours": sent_last_24_hours,
        "daily_limit": settings.EMAIL_DAILY_LIMIT,
        "daily_limit_reached": bool(settings.EMAIL_DAILY_LIMIT and sent_last_24_hours >= settings.EMAIL_DAILY_LIMIT),
        "paused_until": state.paused_until if paused else None,
        "pause_reason": state.last_error if paused else "",
        "sender": from_email(), "configured": configured(),
        "off": not mail_enabled(),
        "enabled": mail_enabled() and settings.EMAIL_NOTIFICATIONS_ENABLED,
        "queued": OutboundEmail.objects.filter(status="queued").count(),
        "failed": OutboundEmail.objects.filter(status="failed").count(),
        "count": count, "page": page, "page_size": 20, "results": entries,
    })


@api_view(["POST"])
@permission_classes([EmailAdministrator])
@transaction.atomic
def email_action(request, pk, action):
    row = get_object_or_404(OutboundEmail.objects.select_for_update(), pk=pk)
    if action == "retry":
        if (row.status != "failed" or row.kind not in NOTIFICATION_KINDS or not row.body_text
                or not settings.EMAIL_NOTIFICATIONS_ENABLED or not mail_enabled()):
            raise ValidationError(translate("This email cannot be retried."))
        if not row.recipient_user_id or not row.recipient_user.is_active:
            raise ValidationError(translate("This email cannot be retried."))
        row.status, row.last_error, row.next_attempt_at = "queued", "", timezone.now()
        row.expires_at = timezone.now() + timedelta(days=7)
        row.save(update_fields=["status", "last_error", "next_attempt_at", "expires_at"])
    elif action == "cancel":
        if row.status != "queued":
            raise ValidationError(translate("Only queued emails can be cancelled."))
        row.status = "cancelled"
        row.save(update_fields=["status"])
    else:
        raise ValidationError(translate("Invalid email action."))
    audit(request.user, "email." + action, row.pk)
    return Response({"status": row.status})


@api_view(["POST"])
@permission_classes([EmailAdministrator])
def test_email(request):
    if not mail_enabled():
        raise ValidationError(translate("Email is off."))
    # Lock the administrator to serialize rolling-window limits across workers.
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=request.user.pk)
        if not user.email.strip():
            raise ValidationError(translate("Your account has no email address."))
        cutoff = timezone.now() - timedelta(minutes=10)
        recent = OutboundEmail.objects.filter(kind="test", created_by=user, created_at__gt=cutoff)
        if recent.count() >= 3:
            oldest = recent.order_by("created_at").first()
            wait = max(1, int((oldest.created_at + timedelta(minutes=10) - timezone.now()).total_seconds()) + 1)
            raise Throttled(wait=wait, detail=translate("You can send three test emails every ten minutes."))
        row = OutboundEmail.objects.create(
            kind="test", recipient_user=user, to_email=user.email.strip(), created_by=user,
            subject=f"{organization()['title']}: Test email", status="sending", attempts=1,
            body_text=f"{organization()['title']}\n\nThis is your requested test email.\n\n{BRAND['email_footer']}",
            body_html=render_email(title="Test email", next_step="This is your requested test email.",
                                   footer=BRAND["email_footer"])[1],
        )
    failure = None
    try:
        send_message(row)
    except Exception as error:
        failure = error
        row.status, row.last_error = "failed", outcome_error(error)
        logger.warning("delivery failure id=%s kind=%s", row.pk, row.kind)
    else:
        row.status, row.sent_at = "sent", timezone.now()
    with transaction.atomic():
        record_outcome(failure)
        row.save(update_fields=["status", "last_error", "sent_at"])
    return Response({"accepted": row.status == "sent", "error": row.last_error, "detail": row.last_error},
                    status=200 if row.status == "sent" else 503)
