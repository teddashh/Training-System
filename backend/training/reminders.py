"""Four database statements per idle tick; participants are read only for due batches."""
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Exists, F, OuterRef, Q
from django.utils import timezone

from .course_sessions import released
from .models import Attempt, AttemptBudget, Course, CourseSession, Exam, ReminderBatch
from .notifications import enqueue
from .services import audit, in_exam_audience, next_attempt_at

KINDS = {'session_tomorrow': 'Session tomorrow', 'quiz_ready': 'Your quiz is ready', 'quiz_reminder': 'Quiz reminder'}


def event_key(session, kind, exam_id=None):
    stamp = session.starts_at if kind == 'session_tomorrow' else session.ends_at
    suffix = ':' + session.ends_at.isoformat() if kind == 'session_tomorrow' else ''
    return f'reminder:{session.pk}:{kind}:{exam_id or 0}:{stamp.isoformat()}{suffix}'


WINDOW = timedelta(days=7)
REMINDER_DELAY = timedelta(hours=72)


def planned_ready(session, exam):
    due = max(session.ends_at, exam.starts_at) if exam.starts_at else session.ends_at
    return max(due, session.course.release_at) if session.course.release_at else due


def schedule(session, exam=None, kind='session_tomorrow', ready_at=None):
    """Due time. A reminder is due 72 hours after its ready batch was produced (planned ready + 72 h before that)."""
    if kind == 'session_tomorrow':
        due = session.starts_at - timedelta(hours=24)
        return max(due, session.course.release_at) if session.course.release_at else due
    if kind == 'quiz_ready':
        return planned_ready(session, exam)
    return (ready_at or planned_ready(session, exam)) + REMINDER_DELAY


def current_batches(session, exam, kind):
    """Quiz batches since the session was (last) seen ending; a reschedule into the future resets that."""
    if not session.reminders_seen_at:
        return ReminderBatch.objects.none()
    return ReminderBatch.objects.filter(session=session, exam=exam, kind=kind,
                                        produced_at__gte=session.reminders_seen_at).order_by('-produced_at')


def in_window(session, exam, kind, link, now, ready_at=None):
    """Ready: within 7 days of its planned time, for links made within 7 days of the session end.
    Reminder: only after a ready batch, within 7 days of its due time."""
    if kind == 'quiz_ready':
        return now <= planned_ready(session, exam) + WINDOW and link.created_at <= session.ends_at + WINDOW
    return ready_at is not None and now <= schedule(session, exam, kind, ready_at) + WINDOW


def quiz_eligible(row, exam, kind, now):
    if not row.user.is_active or not exam.published or exam.audience == 'invitation':
        return False
    if row.attendance == 'absent':
        # "Your session is over" does not apply to someone marked absent.
        return False
    if (exam.starts_at and exam.starts_at > now) or (exam.ends_at and exam.ends_at <= now):
        return False
    if not in_exam_audience(exam, row.user):
        return False
    history = list(Attempt.objects.filter(exam=exam, identity__user=row.user).order_by('number'))
    if kind == 'quiz_ready':
        return not history
    if any(a.passed for a in history):
        return False
    from .attempt_rounds import round_status
    budget = AttemptBudget.objects.filter(exam=exam, identity__user=row.user).first()
    retry = next_attempt_at(exam, history[-1].started_at if history else None)
    can_resume = any(a.status == 'in_progress' and a.deadline > now for a in history)
    return round_status(exam, budget, now, history=history)['attempts_remaining'] > 0 and (can_resume or not retry or retry <= now)


def queue_quiz(row, exam, kind, now, *, automatic=False):
    """None when the person is not eligible, otherwise whether a new message was queued."""
    if not quiz_eligible(row, exam, kind, now):
        return None
    expiry = min(now + timedelta(days=7), exam.ends_at) if exam.ends_at else now + timedelta(days=7)
    return enqueue(kind=kind, user=row.user, target=exam, event=KINDS[kind],
            dedupe_key=event_key(row.session, kind, exam.pk) + f':{row.user_id}', expires_at=expiry,
            context={'course_id': row.course_id, 'session_id': row.session_id, 'exam_id': exam.pk,
                     'event_at': row.session.ends_at.isoformat(), 'enrollment_id': row.pk, 'automatic': automatic})


def ready_for_late_enrollment(row):
    """(eligible for a quiz-ready mail, number of messages queued)."""
    now = timezone.now()
    if (row.session.cancelled or row.session.ends_at > now or not released(row.course, now)
            or row.course.delivery_mode != 'scheduled'):
        return False, 0
    eligible, queued = False, 0
    for link in row.course.assessment_links.filter(release='after_session').select_related('exam'):
        result = queue_quiz(row, link.exam, 'quiz_ready', now)
        eligible, queued = eligible or result is not None, queued + bool(result)
    return eligible, queued


def due_batches(now, kind):
    base = CourseSession.objects.filter(course__reminders=True, course__published=True, cancelled=False).filter(
        Q(course__release_at=None) | Q(course__release_at__lte=now))
    if kind == 'session_tomorrow':
        base = base.filter(starts_at__gt=now, starts_at__lte=now + timedelta(hours=24)).annotate(event_time=F('starts_at'))
        done = ReminderBatch.objects.filter(session_id=OuterRef('pk'), kind=kind, event_at=OuterRef('starts_at'), event_end=OuterRef('ends_at'))
        return base.annotate(produced=Exists(done)).filter(produced=False).order_by('pk')
    exams = Exam.objects.filter(published=True).exclude(audience='invitation').filter(
        Q(starts_at=None) | Q(starts_at__lte=now)).filter(Q(ends_at=None) | Q(ends_at__gt=now))
    # One filter() call: every link condition applies to the same link row.
    links = dict(course__delivery_mode='scheduled', course__assessment_links__release='after_session',
                 course__assessment_links__exam_id__in=exams, reminders_seen_at__lte=F('ends_at') + WINDOW)
    if kind == 'quiz_ready':
        base = base.filter(Q(ends_at__gte=now - WINDOW) | Q(course__assessment_links__exam__starts_at__gte=now - WINDOW),
                           ends_at__lte=now, course__assessment_links__created_at__lte=F('ends_at') + WINDOW, **links)
    else:
        base = base.filter(**links)
    base = base.annotate(quiz_id=F('course__assessment_links__exam_id'))
    if kind == 'quiz_reminder':
        ready = ReminderBatch.objects.filter(Q(produced_at__gte=OuterRef('reminders_seen_at')),
                                             Q(produced_at__lte=now - REMINDER_DELAY),
                                             Q(produced_at__gte=now - REMINDER_DELAY - WINDOW),
                                             session_id=OuterRef('pk'), exam_id=OuterRef('quiz_id'), kind='quiz_ready')
        base = base.filter(Exists(ready))
    done = ReminderBatch.objects.filter(session_id=OuterRef('pk'), exam_id=OuterRef('quiz_id'), kind=kind,
                                        produced_at__gte=OuterRef('reminders_seen_at'))
    return base.annotate(produced=Exists(done)).filter(produced=False).order_by('pk')


def produce_reminders():
    if not settings.EMAIL_NOTIFICATIONS_ENABLED:
        return
    now = timezone.now()
    # Remember when enabled sessions first become visible to this duty, even if
    # their quizzes open weeks later. Old sessions remain ineligible thereafter.
    CourseSession.objects.filter(course__reminders=True, course__published=True, cancelled=False,
        ends_at__lte=now, reminders_seen_at=None).filter(
        Q(course__release_at=None) | Q(course__release_at__lte=now)).update(reminders_seen_at=now)
    for kind in KINDS:
        # Bound work on a busy tick as well as on an idle tick.
        for candidate in due_batches(now, kind)[:100]:
            with transaction.atomic():
                course = Course.objects.select_for_update().get(pk=candidate.course_id)
                session = CourseSession.objects.get(pk=candidate.pk)
                session.course = course
                if not course.reminders or not released(course) or session.cancelled:
                    continue
                exam = Exam.objects.select_for_update().get(pk=candidate.quiz_id) if kind != 'session_tomorrow' else None
                link = course.assessment_links.filter(exam=exam, release='after_session').first() if exam else None
                if exam and (not link or course.delivery_mode != 'scheduled'
                             or not session.reminders_seen_at or session.reminders_seen_at > session.ends_at + WINDOW or not exam.published
                             or exam.audience == 'invitation' or (exam.ends_at and exam.ends_at <= now)
                             or current_batches(session, exam, kind).exists()):
                    continue
                ready = current_batches(session, exam, 'quiz_ready').first() if kind == 'quiz_reminder' else None
                if exam and not in_window(session, exam, kind, link, now, ready.produced_at if ready else None):
                    continue
                due = schedule(session, exam, kind, ready.produced_at if ready else None)
                if due > now or (kind == 'session_tomorrow' and now >= session.starts_at):
                    continue
                batch, created = ReminderBatch.objects.get_or_create(key=event_key(session, kind, exam.pk if exam else None),
                    defaults={'session': session, 'exam': exam, 'kind': kind, 'scheduled_at': due,
                              'event_at': session.starts_at if not exam else session.ends_at,
                              'event_end': session.ends_at if not exam else None})
                if not created:
                    continue
                rows = session.enrollments.filter(status='approved').select_related('user')
                if not exam:
                    rows = rows.filter(requested_at__lt=now - timedelta(hours=12))
                for row in rows:
                    row.session, row.course = session, course
                    if exam:
                        queue_quiz(row, exam, kind, now, automatic=True)
                    else:
                        enqueue(kind=kind, user=row.user, target=course, session=session, event=KINDS[kind],
                                dedupe_key=batch.key + f':{row.user_id}', expires_at=session.starts_at,
                                context={'course_id': course.pk, 'session_id': session.pk, 'enrollment_id': row.pk,
                                         'event_at': session.starts_at.isoformat(), 'event_end': session.ends_at.isoformat()})
                audit(None, 'reminder.produced', batch.pk, {'session': session.pk, 'kind': kind})


def valid_queued_reminder(mail):
    """Recheck revocation at claim time; stale queued snapshots must not go out."""
    from .models import Enrollment
    row = Enrollment.objects.select_related('course', 'session', 'user').filter(pk=mail.context.get('enrollment_id')).first()
    if not row or row.status != 'approved' or row.session_id != mail.context.get('session_id'):
        return False
    if row.session.cancelled or not released(row.course) or (mail.context.get('automatic') and not row.course.reminders):
        return False
    if mail.kind == 'session_tomorrow':
        return (row.course.reminders and row.session.starts_at.isoformat() == mail.context.get('event_at')
                and row.session.ends_at.isoformat() == mail.context.get('event_end'))
    exam = Exam.objects.filter(pk=mail.context.get('exam_id')).first()
    return bool(exam and row.session.ends_at.isoformat() == mail.context.get('event_at')
                and row.course.delivery_mode == 'scheduled'
                and row.course.assessment_links.filter(exam=exam, release='after_session').exists()
                and quiz_eligible(row, exam, mail.kind, timezone.now()))
