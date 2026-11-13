"""Transactional notification snapshots and bounded, non-duplicating delivery."""
from .runtime_settings import organization, from_email, mail_enabled

import logging
from time import monotonic, sleep
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import EmailMultiAlternatives
from django.db import connection, transaction
from django.utils import timezone

from .email_layout import description_excerpt, render_email
from .mail import GraphMailError
from .models import EmailQueueState, OutboundEmail

logger = logging.getLogger("training.notifications")
UNKNOWN = "delivery result unknown"
VERIFICATION_KINDS = {"sign_in_code", "guest_verification"}
SAFE_GRAPH_ERRORS = {
    "Graph mail authentication failed.",
    "Message sender differs from the configured Graph mailbox.",
    "Graph mail transport failed.",
    "Graph mail was not accepted.",
}


def sanitized_error(error):
    """Allowlist, never truncate arbitrary provider/exception text into the log."""
    if isinstance(error, GraphMailError):
        if isinstance(error.status_code, int) and 100 <= error.status_code <= 599:
            return f"Graph mail request failed (HTTP {error.status_code})."
        if str(error) in SAFE_GRAPH_ERRORS:
            return str(error)
    if isinstance(error, ImproperlyConfigured):
        return "Email configuration is incomplete."
    return UNKNOWN


def format_time(value):
    local = value.astimezone(ZoneInfo(settings.NOTIFICATION_TIME_ZONE))
    return local.strftime("%a, %b ") + str(local.day) + local.strftime(", %Y, ") + local.strftime("%I:%M %p %Z").lstrip("0")


NEW_EVENTS = {
    'You are registered': 'Check your session details below; you can switch or cancel from My training.',
    'Session changed': 'Check the new time and place for your session below.',
    'Registration cancelled': 'Choose another session when you are ready.',
    'Request received': 'Wait for the organizer to approve your seat; we will email you their decision.',
    'Session tomorrow': 'Come to your session at the time and place below.',
    'Your quiz is ready': 'Take your quiz online now.',
    'Quiz reminder': 'Take your quiz online while it is still open.',
}


def next_step(event, target, *, session=None, note=""):
    if event in NEW_EVENTS:
        return NEW_EVENTS[event]
    if event == "New training assigned":
        if target._meta.model_name != "course":
            return "Open the exam when you are ready to begin."
        if target.delivery_mode == "scheduled":
            return "Choose a session to reserve your seat." + (
                " An organizer reviews your registration." if target.requires_approval else "")
        if target.requires_approval:
            return "Request enrollment; an organizer reviews it before learning begins."
        return "Open the course to start learning."
    if event in {"Session registration confirmed", "Enrollment approved"}:
        if session:
            return "Your seat is reserved. You can add the session to your calendar from My training."
        return "You can start learning now."
    if event in {"Enrollment rejected", "Enrollment removed"}:
        sentence = ("Your enrollment request was not approved." if event == "Enrollment rejected"
                    else "Your enrollment was removed.")
        return sentence + (" See the organizer's note below." if note
                           else " Contact the organizer if you have questions.")
    if event == "Session cancelled":
        return "This session was cancelled. Choose another session if one is available."
    if event == "Session rescheduled":
        return "The session time changed. The new time is below."
    return "Open training to view the details."


# Session mails: what and when in the subject; one lead, When/Where, one button.
SESSION_MAIL = {
    # event: (subject prefix, lead, button, may carry the course description)
    'You are registered': ('Registered', 'You are registered.', 'View my session', True),
    'Session registration confirmed': ('Registered', 'You are registered.', 'View my session', True),
    'Enrollment approved': ('Approved', 'Your seat is confirmed.', 'View my session', True),
    'Request received': ('Requested', 'We received your request. The organizer will confirm your seat by email.',
                         'View my session', False),
    'Session changed': ('Changed', 'Your session changed.', 'View my session', False),
    'Session rescheduled': ('Changed', 'Your session time changed.', 'View my session', False),
    'Registration cancelled': ('Cancelled', 'Your registration is cancelled.', 'Choose a session', False),
    'Session cancelled': ('Cancelled', 'This session is cancelled. Choose another one.', 'Choose a session', False),
    'Session tomorrow': ('Tomorrow', 'Your session is tomorrow.', 'View my session', False),
}
QUIZ_MAIL = {'Your quiz is ready': ('Quiz ready', 'Your session is over. Take the quiz.'),
             'Quiz reminder': ('Quiz reminder', 'Your quiz is still open.')}


def _local(value):
    return value.astimezone(ZoneInfo(settings.NOTIFICATION_TIME_ZONE))


def subject_time(value, with_date=True):
    local = _local(value)
    clock = local.strftime("%I:%M %p").lstrip("0")
    return local.strftime("%a %b ") + str(local.day) + ", " + clock if with_date else clock


def session_when(session):
    from .i18n import format_when
    return format_when(session.starts_at, session.ends_at, ZoneInfo(settings.NOTIFICATION_TIME_ZONE), "en")


def session_where(course, session):
    if course.venue == "online":
        return "Online"
    return (session.location or "").strip() or "Online"


def one_line(value):
    return " ".join(str(value).split())


def session_content(event, course, session, *, note="", approved=False, old_session=None,
                    first=True, many_sessions=False):
    prefix, lead, button_label, describes = SESSION_MAIL[event]
    title = course.title
    if event == 'Session tomorrow' and _local(session.starts_at).date() == _local(timezone.now()).date():
        # Produced on the day itself (a late batch or a session added at short notice).
        prefix, lead = 'Today', 'Your session is today.'
    if event == 'Session tomorrow':
        subject = f"{prefix}: {title}, {subject_time(session.starts_at, with_date=False)}"
    elif prefix == 'Changed':
        subject = f"{prefix}: {title}, now {subject_time(session.starts_at)}"
    else:
        subject = f"{prefix}: {title}, {subject_time(session.starts_at)}"
    facts = []
    if many_sessions and session.title:
        facts.append(("Session", session.title))
    when, where = session_when(session), session_where(course, session)
    if old_session:
        timing = (old_session.starts_at, old_session.ends_at) != (session.starts_at, session.ends_at)
        moved = session_where(course, old_session) != where
        def describe(item):
            if not timing and not moved:
                return item.title
            return ", ".join(([session_when(item)] if timing else []) + ([session_where(course, item)] if moved else []))
        facts.extend([("Was", describe(old_session)), ("Now", describe(session))])
        if not timing:
            facts.append(("When", when))
        if not moved:
            facts.append(("Where", where))
    else:
        facts.extend([("When", when), ("Where", where)])
    if approved and session.meeting_url:
        facts.append(("Meeting link", session.meeting_url))
    route = f"/courses?course={course.pk}&action=register"
    url = settings.APP_ORIGIN + settings.APP_BASE_PATH + route
    text, html = render_email(
        title=title, next_step=lead, facts=facts, note=note if event == 'Enrollment approved' else "",
        description=description_excerpt(course.description, 300) if describes and first else "",
        url=url, button_label=button_label, instruction_first=True,
    )
    return one_line(subject)[:500], text, html


def quiz_content(event, exam):
    prefix, lead = QUIZ_MAIL[event]
    facts = []
    if exam.duration_minutes > 0:
        facts.append(("Time limit", f"{exam.duration_minutes} min"))
    if exam.questions_per_attempt:
        facts.append(("Questions", str(exam.questions_per_attempt)))
    if exam.pass_score is not None:
        facts.append(("Passing score", str(exam.pass_score)))
    if exam.ends_at:
        facts.append(("Closes", format_time(exam.ends_at)))
    subject = f"{prefix}: {exam.title}" + (f", closes {subject_time(exam.ends_at)}" if exam.ends_at else "")
    url = settings.APP_ORIGIN + settings.APP_BASE_PATH + f"/exams?exam={exam.pk}&action=start"
    text, html = render_email(title=exam.title, next_step=lead, facts=facts, url=url,
                              button_label="Take the quiz", instruction_first=True)
    return one_line(subject)[:500], text, html


def message_content(event, target, *, actor=None, due_at=None, note="", session=None, approved=False, old_session=None,
                    first=True, many_sessions=False):
    is_course = target._meta.model_name == "course"
    if is_course and session and session.starts_at and session.ends_at and event in SESSION_MAIL:
        return session_content(event, target, session, note=note, approved=approved, old_session=old_session,
                               first=first, many_sessions=many_sessions)
    if not is_course and event in QUIZ_MAIL:
        return quiz_content(event, target)
    title = target.title
    subject = (f"{organization()['title']}: {event} - {title}").replace("\r", " ").replace("\n", " ")[:500]
    is_course = target._meta.model_name == "course"
    scheduled = is_course and target.delivery_mode == "scheduled"
    facts = []
    if actor:
        actor_label = "By"
        if event == "New training assigned":
            actor_label = "Assigned by"
        elif event in {"Enrollment approved", "Enrollment rejected", "Enrollment removed"}:
            actor_label = "Reviewed by"
        elif event in {"Session cancelled", "Session rescheduled"}:
            actor_label = "Updated by"
        facts.append((actor_label, actor.display_name or actor.username))
    if due_at:
        facts.append(("Due", format_time(due_at)))
    if session:
        for label, value in (("Session", session.title), ("Starts", session.starts_at),
                             ("Ends", session.ends_at), ("Location", session.location)):
            if value:
                facts.append((label, format_time(value) if label in {"Starts", "Ends"} else value))
        if approved and session.meeting_url:
            facts.append(("Meeting link", session.meeting_url))
    if old_session:
        facts.extend([('Previous session', old_session.title), ('Previous start', format_time(old_session.starts_at)),
                      ('Previous end', format_time(old_session.ends_at)), ('Previous location', old_session.location)])
    if is_course:
        course_format = "Self-paced"
        if scheduled:
            course_format = "On-site sessions" if target.venue == "onsite" else "Scheduled online sessions"
        facts.append(("Format", course_format))
        if target.duration_minutes > 0:
            facts.append(("Duration", f"About {target.duration_minutes} min"))
        if target.category:
            facts.append(("Category", target.category))
    else:
        # Scalar fields only: never count related questions once per recipient.
        if target.duration_minutes > 0:
            facts.append(("Time limit", f"{target.duration_minutes} min"))
        if target.questions_per_attempt:
            facts.append(("Questions", str(target.questions_per_attempt)))
        if target.pass_score is not None:
            facts.append(("Passing score", str(target.pass_score)))
    # Numeric learner destinations only; no capabilities or redirect parameters.
    route = f"/courses?course={target.pk}" if is_course else f"/exams?exam={target.pk}"
    if scheduled:
        route += "&action=register"
    if event in {'Your quiz is ready', 'Quiz reminder'}:
        route += '&action=start'
    url = settings.APP_ORIGIN + settings.APP_BASE_PATH + route
    if scheduled and event in {"New training assigned", "Session cancelled", "Registration cancelled"}:
        button_label = "Choose a session"
    elif session and event in {"Session registration confirmed", "Enrollment approved", "Session rescheduled", "You are registered", "Session changed", "Session tomorrow", "Request received"}:
        button_label = "View my session"
    elif not is_course:
        button_label = "Open exam"
    else:
        button_label = "Open training"
    if event in {'Your quiz is ready', 'Quiz reminder'}:
        button_label = 'Take the quiz'
    text, html = render_email(
        title=title, event=event, next_step=next_step(event, target, session=session, note=note),
        facts=facts, note=note, description=description_excerpt(target.description),
        description_label="About this training" if is_course else "About this exam",
        url=url, button_label=button_label, instruction_first=event in NEW_EVENTS,
    )
    return subject, text, html


def enqueue(*, kind, user, target, event, dedupe_key, actor=None, context=None, expires_at=None, **content):
    """Call inside the event transaction. No delivery happens here."""
    if not mail_enabled() or not settings.EMAIL_NOTIFICATIONS_ENABLED or not user.is_active or not user.email.strip():
        return False
    if content.get('session'):
        session = content['session']
        content['approved'] = session.enrollments.filter(user=user, status='approved').exists()
        if target._meta.model_name == 'course' and event in SESSION_MAIL:
            content['many_sessions'] = target.sessions.filter(cancelled=False).count() > 1
            # The description travels only in the first mail a person gets for this course.
            content['first'] = SESSION_MAIL[event][3] and not OutboundEmail.objects.filter(
                recipient_user=user, context__course_id=target.pk).exists()
    subject, body_text, body_html = message_content(event, target, actor=actor, **content)
    explicit_expiry = expires_at
    expires_at = expires_at or timezone.now() + timedelta(days=7)
    if content.get("session") and explicit_expiry is None:
        expires_at = min(expires_at, content["session"].ends_at)
    _, created = OutboundEmail.objects.get_or_create(dedupe_key=dedupe_key, defaults={
        "kind": kind, "recipient_user": user, "to_email": user.email.strip(),
        "subject": subject, "body_text": body_text, "body_html": body_html,
        "created_by": actor, "context": context or {},
        "expires_at": expires_at,
    })
    return created


def enrollment_notification(row, actor, event):
    return enqueue(
        kind={'You are registered': 'registered', 'Request received': 'request_received',
              'Registration cancelled': 'registration_cancelled'}.get(event, 'enrollment_' + row.status),
        user=row.user, target=row.course, event=event,
        actor=actor, note=row.review_note if actor else "", session=row.session,
        expires_at=(timezone.now() + timedelta(days=7) if event == 'You are registered'
                    and row.session and row.session.ends_at <= timezone.now() else None),
        dedupe_key=f"enrollment:{row.pk}:{row.revision}",
        context={"course_id": row.course_id, "enrollment_id": row.pk,
                 **({"session_id": row.session_id} if row.session_id else {})},
    )


def record_verification(kind, to_email, *, user=None, error=None):
    """Best-effort metadata only; logging must not change authentication behavior."""
    if error:
        logger.warning("verification failure kind=%s exception=%s error=%s",
                       kind, type(error).__name__, sanitized_error(error))
    try:
        # Savepoint also protects an enclosing transaction if evidence cannot be saved.
        with transaction.atomic():
            record_outcome(error)
            OutboundEmail.objects.create(
                kind=kind, recipient_user=user, to_email=to_email, attempts=1,
                status="failed" if error else "sent",
                last_error=outcome_error(error) if error else "",
                sent_at=None if error else timezone.now(),
            )
    except Exception:
        logger.warning("verification evidence unavailable id=none kind=%s", kind)


def locked(queryset):
    if connection.features.has_select_for_update_skip_locked:
        return queryset.select_for_update(skip_locked=True)
    return queryset.select_for_update()


def queue_state_locked():
    # Call only inside atomic(); the singleton is created lazily, including after flush.
    EmailQueueState.objects.get_or_create(pk=1)
    return EmailQueueState.objects.select_for_update().get(pk=1)


def recover_stale():
    with transaction.atomic():
        state = queue_state_locked()
        stale = locked(OutboundEmail.objects.filter(
            status="sending", next_attempt_at__lt=timezone.now() - timedelta(minutes=15),
        )).order_by("id")[:settings.EMAIL_QUEUE_BATCH]
        for row in stale:
            row.status, row.last_error = "failed", UNKNOWN
            row.save(update_fields=["status", "last_error"])
            logger.warning("delivery failure id=%s kind=%s", row.pk, row.kind)
        if state.active_email_id and not OutboundEmail.objects.filter(
            pk=state.active_email_id, status="sending",
        ).exists():
            state.active_email = None
            state.save(update_fields=["active_email"])


def accepted_last_day():
    return OutboundEmail.objects.filter(
        status="sent", sent_at__gt=timezone.now() - timedelta(hours=24),
    ).count()


def daily_budget():
    if not settings.EMAIL_DAILY_LIMIT:
        return None
    with transaction.atomic():
        state = queue_state_locked()
        # Acceptance writers hold this same lock until their log row is committed.
        return accepted_last_day(), state.accepted_total


def claim_next(budget=None):
    with transaction.atomic():
        state = queue_state_locked()
        if state.active_email_id or (state.paused_until and state.paused_until > timezone.now()):
            return None
        row = locked(OutboundEmail.objects.filter(
            status="queued", next_attempt_at__lte=timezone.now(),
        )).order_by("next_attempt_at", "id").first()
        if row is None:
            return None
        reason = ""
        if row.expires_at and row.expires_at <= timezone.now():
            reason = "Expired before delivery."
        elif not row.recipient_user_id:
            reason = "Recipient account no longer exists."
        elif not row.recipient_user.is_active:
            reason = "Recipient account is inactive."
        elif row.kind in VERIFICATION_KINDS or not row.body_text:
            reason = "Message cannot be queued."
        if not reason and row.kind in {'session_tomorrow', 'quiz_ready', 'quiz_reminder'}:
            from .reminders import valid_queued_reminder
            if not valid_queued_reminder(row):
                reason = 'Reminder no longer applies.'
        if reason:
            row.status, row.last_error = "cancelled", reason
        else:
            if budget is not None:
                count, baseline = budget
                if count + state.accepted_total - baseline >= settings.EMAIL_DAILY_LIMIT:
                    return None
            row.status = "sending"
            row.attempts += 1
            row.next_attempt_at = timezone.now()
            state.active_email = row
            state.save(update_fields=["active_email"])
        row.save(update_fields=["status", "attempts", "next_attempt_at", "last_error"])
        return row


def mailbox_failure(error):
    code = error.status_code if isinstance(error, GraphMailError) else None
    return code in (401, 403, 404, 429, 503) or isinstance(error, ImproperlyConfigured) or (
        isinstance(error, GraphMailError) and str(error) in {
            "Graph mail authentication failed.",
            "Message sender differs from the configured Graph mailbox.",
        }
    )


def outcome_error(error):
    if mailbox_failure(error):
        return sanitized_error(error)
    code = error.status_code if isinstance(error, GraphMailError) else None
    if type(code) is int and 100 <= code <= 599:
        return f"{UNKNOWN} (HTTP {code})."
    return UNKNOWN


def record_outcome(error=None, *, completed_id=None):
    """Persist mailbox health for all send paths, independent of process lifetime."""
    with transaction.atomic():
        state = queue_state_locked()
        if completed_id and state.active_email_id == completed_id:
            state.active_email = None
        if error is None:
            state.accepted_total += 1
            state.consecutive_failures = 0
            state.paused_until, state.last_error = None, ""
        else:
            state.consecutive_failures += 1
            seconds = min(15, 2 ** min(state.consecutive_failures - 1, 4)) * 60
            if isinstance(error, GraphMailError) and error.status_code in (429, 503) and error.retry_after:
                seconds = max(60, min(3600, error.retry_after))
            state.paused_until = timezone.now() + timedelta(seconds=seconds)
            state.last_error = outcome_error(error)
        state.save()


def send_message(row):
    if not mail_enabled():
        raise GraphMailError("Email is off.")
    message = EmailMultiAlternatives(row.subject, row.body_text, from_email(), [row.to_email])
    if row.body_html:
        message.attach_alternative(row.body_html, "text/html")
    if message.send(fail_silently=False) != 1:
        raise GraphMailError(UNKNOWN)


def deliver(row):
    """Claims are committed before I/O. Every unsuccessful send ends the batch."""
    failure = None
    try:
        send_message(row)
    except Exception as error:
        failure = error
        row.status = "queued" if mailbox_failure(error) else "failed"
        row.last_error = outcome_error(error)
        logger.warning("delivery failure id=%s kind=%s", row.pk, row.kind)
    else:
        row.status, row.last_error, row.sent_at = "sent", "", timezone.now()
    with transaction.atomic():
        # State is always locked before mail rows, including claim/recovery paths.
        record_outcome(failure, completed_id=row.pk)
        row.save(update_fields=["status", "last_error", "sent_at"])
    return failure is not None


def deliver_queued():
    if not mail_enabled() or not settings.EMAIL_NOTIFICATIONS_ENABLED:
        return 0
    started = monotonic()
    recover_stale()
    OutboundEmail.objects.filter(status="queued", expires_at__lte=timezone.now()).update(
        status="cancelled", last_error="Expired before delivery.",
    )
    budget = daily_budget()
    count = 0
    while count < settings.EMAIL_QUEUE_BATCH and monotonic() - started < 30:
        if not mail_enabled():
            break
        row = claim_next(budget)
        if row is None:
            break
        if row.status != "sending":
            continue
        count += 1
        if deliver(row):
            break
        sleep(0.2)
    return count


def session_changed(row, actor, old_session):
    return enqueue(kind='session_changed', user=row.user, target=row.course, event='Session changed',
                   actor=actor, session=row.session, old_session=old_session,
                   dedupe_key=f'enrollment:{row.pk}:{row.revision}',
                   context={'course_id': row.course_id, 'session_id': row.session_id, 'enrollment_id': row.pk})
