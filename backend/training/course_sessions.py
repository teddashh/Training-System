"""Scheduled admission, serialized with every course enrollment writer."""

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from .models import Course, CourseSession, Enrollment
from .i18n import translate
from .access import views_meeting


def released(course, now=None):
    return course.published and (not course.release_at or (now or timezone.now()) >= course.release_at)


def occupied(session):
    return session.reserved_count if hasattr(session, 'reserved_count') else session.enrollments.filter(status__in=('approved', 'pending')).count()


def session_data(session, now=None, user=None):
    now = now or timezone.now()
    seats = occupied(session)
    close = session.registration_closes_at or session.starts_at
    if session.cancelled:
        state = 'cancelled'
    elif now >= session.ends_at:
        state = 'ended'
    elif now >= session.starts_at:
        state = 'in_progress'
    elif not released(session.course, now) or (session.registration_opens_at and now < session.registration_opens_at):
        state = 'upcoming'
    elif now >= close:
        state = 'closed'
    elif seats >= session.capacity:
        state = 'full'
    else:
        state = 'open'
    return {
        'id': session.pk, 'title': session.title, 'revision': session.revision,
        'location': session.location,
        **({'meeting_url': session.meeting_url} if user and views_meeting(user, session) else {}),
        'registration_opens_at': session.registration_opens_at,
        'registration_closes_at': close, 'starts_at': session.starts_at,
        'ends_at': session.ends_at, 'capacity': session.capacity,
        'reserved': seats, 'remaining': max(0, session.capacity-seats),
        'cancelled': session.cancelled, 'state': state,
    }


class SessionInput(serializers.ModelSerializer):
    revision = serializers.IntegerField(min_value=0, required=False, default=0)

    class Meta:
        model = CourseSession
        fields = ['title', 'registration_opens_at', 'registration_closes_at',
                  'starts_at', 'ends_at', 'capacity', 'cancelled', 'revision', 'location', 'meeting_url']

    def validate_meeting_url(self, value):
        from .materials import https_url
        return https_url(value) if value else value

    def validate(self, data):
        def value(key):return data.get(key, getattr(self.instance, key, None))
        course = self.context['course']
        if course.venue == 'onsite' and not (value('location') or '').strip():
            raise ValidationError(translate('Location is required for on-site sessions.'))
        if course.venue == 'online':
            data['location'] = ''
        start, end = value('starts_at'), value('ends_at')
        opens, closes = value('registration_opens_at'), value('registration_closes_at') or start
        if not start or not end or start >= end or (closes and closes > start) or (opens and opens >= closes):
            raise ValidationError(translate('Registration must close by the session start; the session end must be later.'))
        capacity = value('capacity') if value('capacity') is not None else 100
        if not 1 <= capacity <= 10000:
            raise ValidationError(translate('Capacity must be between 1 and 10000.'))
        if self.instance and capacity < occupied(self.instance):
            raise ValidationError(translate('Capacity cannot be lower than the number of reserved seats.'))
        return data


@transaction.atomic
def save_session(user, course_id, data, session_id=None):
    from .enrollments import can_manage_course, EnrollmentConflict
    from .services import audit
    course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
    if not can_manage_course(user, course):raise PermissionDenied()
    cancellation_only = bool(session_id and data.get('cancelled') is True and set(data) <= {'cancelled', 'revision'})
    if not course.published and not cancellation_only:
        raise ValidationError(translate('Publish this course before scheduling sessions or assigning training.'))
    if course.delivery_mode != 'scheduled':
        raise ValidationError(translate('Save the course as Scheduled sessions first.'))
    session = get_object_or_404(CourseSession, pk=session_id, course=course) if session_id else None
    previous = (session.starts_at, session.ends_at, session.cancelled, session.location, session.title) if session else None
    form = SessionInput(instance=session, data=data, partial=bool(session), context={'course': course})
    form.is_valid(raise_exception=True)
    revision = form.validated_data.pop('revision', 0)
    if session and revision != session.revision:raise EnrollmentConflict()
    session = form.save(course=course, revision=revision+1)
    if previous and session.ends_at != previous[1] and session.ends_at > timezone.now() and session.reminders_seen_at:
        # A real reschedule into the future: quiz mails may follow the new end. Editing the
        # end of a finished session (still in the past) keeps the earlier observation and sends nothing.
        session.reminders_seen_at = None
        session.save(update_fields=['reminders_seen_at'])
    audit(user, 'course.session_updated' if session_id else 'course.session_created', session.pk, {'course': course.pk})
    if previous:
        cancelled = session.cancelled and not previous[2]
        rescheduled = not session.cancelled and previous[:2] != (session.starts_at, session.ends_at)
        if cancelled or rescheduled:
            from .notifications import enqueue
            before = None if cancelled else CourseSession(
                title=previous[4], starts_at=previous[0], ends_at=previous[1], location=previous[3])
            for row in session.enrollments.filter(status__in=("approved", "pending")).select_related("user"):
                enqueue(
                    kind="session_cancelled" if cancelled else "session_rescheduled",
                    user=row.user, target=course, actor=user, session=session, old_session=before,
                    event="Session cancelled" if cancelled else "Session rescheduled",
                    dedupe_key=f"session:{session.pk}:{session.revision}:{row.pk}",
                    context={"session_id": session.pk, "course_id": course.pk, "enrollment_id": row.pk},
                )
    return session_data(session, user=user)


def check_seat(course, session_id, row=None, admission=True):
    """Caller holds the course lock; pending requests reserve seats too."""
    session = get_object_or_404(CourseSession, pk=session_id, course=course)
    now = timezone.now()
    if session.cancelled or now >= session.ends_at:
        raise ValidationError(translate('This session is cancelled or has ended.'))
    if admission and session_data(session, now)['state'] not in ('open', 'full'):
        raise ValidationError(translate('Registration for this session is not open.'))
    reserved = bool(row and row.session_id == session.pk and row.status in ('approved', 'pending'))
    if not reserved and occupied(session) >= session.capacity:
        raise ValidationError(translate('This session is full. Choose another session.'))
    return session


@transaction.atomic
def cancel_registration(user, course_id, data):
    from .enrollments import enrollment_data, EnrollmentConflict
    from .services import audit
    course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
    row = get_object_or_404(Enrollment.objects.select_related('session'), course=course, user=user)
    if row.status == 'cancelled':return enrollment_data(row)
    if data.get('revision') != row.revision:raise EnrollmentConflict()
    if not row.session or row.status not in ('approved', 'pending') or timezone.now() >= row.session.starts_at:
        raise ValidationError(translate('Registration can only be cancelled before the session starts.'))
    row.status='cancelled';row.revision+=1;row.save()
    audit(user, 'enrollment.cancelled', row.pk, {'course': course.pk, 'session': row.session_id})
    from .notifications import enrollment_notification
    enrollment_notification(row, None, 'Registration cancelled')
    return enrollment_data(row)


def course_queryset(user):
    """Bounded queries for sessions, seat counts, packages and personal admission."""
    from django.db.models import Count, Prefetch, Q
    from .models import ScormPackage
    from .assessments import exam_queryset
    return Course.objects.annotate(
        approved_count=Count('enrollments', filter=Q(enrollments__status='approved')),
    ).prefetch_related(
        Prefetch('assessments', queryset=exam_queryset(user), to_attr='linked_assessments'),
        Prefetch('sessions', queryset=CourseSession.objects.annotate(
            reserved_count=Count('enrollments', filter=Q(enrollments__status__in=('approved', 'pending'))))),
        Prefetch('enrollments', queryset=Enrollment.objects.filter(user=user).select_related('session'), to_attr='user_enrollments'),
        Prefetch('packages', queryset=ScormPackage.objects.order_by('-created_at'), to_attr='ordered_packages'),
    )


def selectable_session(data):
    # Upcoming windows can already be full through organizer assignment.
    return data['state'] in ('open', 'upcoming') and data['remaining'] > 0


def visible_sessions(user, course):
    from .access import manages_course
    from .enrollments import user_enrollment
    row = user_enrollment(user, course)
    own_id = row.session_id if row and row.status in ('approved', 'pending') else None
    manager = manages_course(user, course)
    now = timezone.now()
    rows = [session_data(session, now, user=user) for session in course.sessions.all()]
    return [data for data in rows if manager or selectable_session(data) or data['id'] == own_id]
