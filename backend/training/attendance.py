"""Session attendance evidence and organizer decisions."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from .access import manages_course
from .i18n import translate
from .models import Course, CourseSession, Enrollment
from .services import audit


def effective(row):
    return row.attendance or ('present' if row.attended_at else '')


def record_content_access(user, course):
    """Automatic attendance evidence for online scheduled sessions.

    Callers have already checked learning access. Idempotent: one conditional UPDATE that
    matches only the learner's approved, running, not-yet-recorded session. No course lock,
    so SCORM asset requests from many learners never queue behind each other.
    """
    if course.delivery_mode != 'scheduled' or course.venue != 'online':
        return
    now = timezone.now()
    count = Enrollment.objects.filter(
        user=user, course=course, status='approved', attended_at=None,
        session__cancelled=False, session__starts_at__lte=now, session__ends_at__gt=now,
    ).update(attended_at=now)
    if count:
        audit(user, 'course.attendance_recorded', course.pk, {'user': user.pk, 'count': count})


def session_for_manager(user, course_id, session_id, lock=False):
    course = get_object_or_404(Course.objects.select_for_update() if lock else Course.objects.all(), pk=course_id)
    if not manages_course(user, course):
        raise PermissionDenied()
    return get_object_or_404(CourseSession.objects.select_related('course'), pk=session_id, course=course)


def attendance_data(session):
    from .enrollments import enrollment_data
    rows = session.enrollments.filter(status='approved').select_related('user', 'session').order_by('user__display_name', 'user__username', 'pk')
    counts = {'present': 0, 'absent': 0, 'no_record': 0}
    result = []
    for row in rows:
        counts[effective(row) or 'no_record'] += 1
        result.append({**enrollment_data(row), 'person': row.user.display_name or row.user.username,
                       'department': row.user.department, 'employee_id': row.user.employee_id})
    return {'counts': counts, 'results': result, 'can_mark': timezone.now() >= session.starts_at and not session.cancelled}


class AttendanceInput(serializers.Serializer):
    enrollment = serializers.IntegerField(min_value=1, required=False)
    attendance = serializers.ChoiceField(choices=['', 'present', 'absent'])
    all_present = serializers.BooleanField(default=False)

    def validate(self, data):
        if data['all_present']:
            if data.get('enrollment') or data['attendance'] != 'present':
                raise ValidationError(translate('Choose a person or mark all present.'))
        elif not data.get('enrollment'):
            raise ValidationError(translate('Choose a person or mark all present.'))
        return data


@transaction.atomic
def mark_attendance(user, course_id, session_id, data):
    session = session_for_manager(user, course_id, session_id, lock=True)
    now = timezone.now()
    if now < session.starts_at or session.cancelled:
        raise ValidationError(translate('Attendance can be marked from the session start for an active session.'))
    form = AttendanceInput(data=data)
    form.is_valid(raise_exception=True)
    values = form.validated_data
    rows = session.enrollments.filter(status='approved')
    if not values['all_present']:
        rows = [get_object_or_404(rows, pk=values['enrollment'])]
    count = 0
    for row in rows:
        row.attendance = values['attendance']
        row.attendance_marked_by = user if row.attendance else None
        row.attendance_marked_at = now if row.attendance else None
        if session.course.venue == 'onsite':
            row.progress_known = True
            row.progress = 100 if effective(row) == 'present' else 0
            row.completed_at = min(session.ends_at, now) if row.progress == 100 else None
        row.revision += 1
        row.save()
        count += 1
    audit(user, 'course.attendance_marked', session.pk, {
        'course': session.course_id, 'count': count,
        **({'enrollment': values['enrollment']} if values.get('enrollment') else {}),
    })
    return attendance_data(session)
