"""Course admission. Writers lock the course before changing enrollment evidence."""

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response

from .i18n import translate
from .models import Attempt, Course, Enrollment
from .services import audit


from .access import manages_course as can_manage_course


def can_learn(user, course, enrollment=None):
    if not user.is_active or course.venue == 'onsite':
        return False
    if can_manage_course(user, course):
        return True
    from .course_sessions import released
    if not released(course):
        return False
    if enrollment is None:
        enrollment = user_enrollment(user, course)
    if course.delivery_mode == 'scheduled':
        if not enrollment or enrollment.status != 'approved' or not enrollment.session_id:
            return False
        session = enrollment.session
        return not session.cancelled and session.starts_at <= timezone.now() < session.ends_at
    if enrollment:
        return enrollment.status == "approved"
    return not course.requires_approval


def check_learning_access(user, course, save_progress=False):
    if course.venue == 'onsite':
        raise PermissionDenied(translate('On-site courses use attendance for completion.'))
    # A valid launch may flush its last buffered progress just after the window
    # closes. This does not grant content access or bypass revoked admission.
    if save_progress and user.is_active and course.delivery_mode == 'scheduled':
        from datetime import timedelta
        from .course_sessions import released
        row = Enrollment.objects.select_related('session').filter(user=user, course=course, status='approved').first()
        if (released(course) and row and row.session_id and not row.session.cancelled
                and row.session.starts_at <= timezone.now() < row.session.ends_at + timedelta(seconds=60)):
            return
    if not can_learn(user, course):
        raise PermissionDenied(translate('Choose an available session and return during its scheduled time.') if course.delivery_mode == 'scheduled' else translate("Course enrollment approval is required."))


def enrollment_data(row):
    if row is None:
        return None
    return {
        "id": row.pk,
        "status": row.status,
        "revision": row.revision,
        "request_note": row.request_note,
        "requested_at": row.requested_at,
        "review_note": row.review_note,
        "reviewed_at": row.reviewed_at,
        "progress": row.progress,
        "progress_known": row.progress_known,
        "completed_at": row.completed_at,
        "attended_at": row.attended_at,
        "attendance": row.attendance,
        "attendance_marked_at": row.attendance_marked_at,
        "effective_attendance": row.attendance or ("present" if row.attended_at else ""),
        "session": ({'id': row.session_id, 'title': row.session.title,
                     'starts_at': row.session.starts_at, 'ends_at': row.session.ends_at,
                     'cancelled': row.session.cancelled, 'location': row.session.location} if row.session_id else None),
    }


class EnrollmentConflict(APIException):
    status_code = 409

    def __init__(self):
        super().__init__(
            {
                "code": "enrollment_conflict",
                "detail": translate("Enrollment changed. Refresh before trying again."),
            }
        )


class RequestInput(serializers.Serializer):
    session = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    revision = serializers.IntegerField(min_value=0, required=False, default=0)
    note = serializers.CharField(
        max_length=1000, allow_blank=True, required=False, default=""
    )


class ReviewInput(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)
    decision = serializers.ChoiceField(choices=["approved", "rejected", "removed"])
    note = serializers.CharField(max_length=1000, allow_blank=True)


@transaction.atomic
def enroll(user, course_id, data):
    course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
    from .course_sessions import released, check_seat
    if not released(course) and not can_manage_course(user, course):
        raise PermissionDenied()
    form = RequestInput(data=data)
    form.is_valid(raise_exception=True)
    values = form.validated_data
    row = Enrollment.objects.filter(course=course, user=user).first()
    if row and row.status == "removed" and not can_manage_course(user, course):
        raise PermissionDenied(
            translate("Enrollment was removed. Contact the course organizer.")
        )
    switching = bool(row and row.status in ("approved", "pending") and values.get("session") and row.session_id != values["session"])
    old_session = row.session if switching else None
    if row and row.status in ("approved", "pending"):
        if not values.get('session') or row.session_id == values['session']:
            return row
        if old_session and timezone.now() >= old_session.starts_at:
            raise ValidationError(translate('Registration can only be cancelled before the session starts.'))
    if values["revision"] != (row.revision if row else 0):
        raise EnrollmentConflict()
    status = (
        "pending"
        if course.requires_approval and not can_manage_course(user, course)
        else "approved"
    )
    if switching:
        status = row.status
    session = None
    if course.delivery_mode == 'scheduled':
        if values.get('session'):
            session = check_seat(course, values['session'], row)
        elif not can_manage_course(user, course):
            raise ValidationError(translate('Choose a session before enrolling.'))
    if row is None:
        row = Enrollment(course=course, user=user)
    before = enrollment_data(row) if row.pk else None
    if row.session_id != (session.pk if session else None):
        row.attended_at = None
        row.attendance = ''
        row.attendance_marked_by = None
        row.attendance_marked_at = None
        if course.venue == 'onsite':
            row.progress, row.completed_at = 0, None
    row.status = status
    row.session = session
    row.revision += 1
    row.request_note = values["note"]
    if not switching:
        row.requested_at = timezone.now()
        row.review_note = ""
        row.reviewed_at = None
        row.reviewed_by = None
    row.save()
    audit(
        user,
        "enrollment.switched" if switching else "enrollment.requested" if status == "pending" else "enrollment.enrolled",
        row.pk,
        {
            "course": course.pk,
            "user": user.pk,
            "before": _audit_data(before),
            "after": _audit_data(enrollment_data(row)),
        },
    )
    if switching:
        from .notifications import session_changed
        session_changed(row, user, old_session)
    elif status == "pending":
        from .notifications import enrollment_notification
        enrollment_notification(row, None, "Request received")
    elif status == "approved" and session:
        from .notifications import enrollment_notification
        enrollment_notification(row, None, "Session registration confirmed")
    return row


def _audit_data(data):
    return (
        {
            key: (value.isoformat() if hasattr(value, "isoformat") else _audit_data(value) if isinstance(value, dict) else value)
            for key, value in data.items()
        }
        if data
        else None
    )


def roster(user, course, params):
    if not can_manage_course(user, course):
        raise PermissionDenied()
    rows = course.enrollments.select_related("user", "reviewed_by", "session").order_by(
        "requested_at", "id"
    )
    from django.db.models import Count
    counts = rows.aggregate(
        all=Count('id'), registered=Count('id', filter=Q(status='approved')),
        pending=Count('id', filter=Q(status='pending')),
        attended=Count('id', filter=Q(attendance='present') | Q(attendance='', attended_at__isnull=False)),
        absent=Count('id', filter=Q(attendance='absent')),
        cancelled=Count('id', filter=Q(status='cancelled')),
    )
    quizzes = list(course.assessments.filter(published=True).values_list('pk', flat=True))
    quiz_status = {}
    if quizzes:
        # One grouped query serves both the page and the unfiltered course count.
        for item in Attempt.objects.filter(exam_id__in=quizzes, status='graded',
                identity__user_id__in=course.enrollments.values('user_id')).values('identity__user_id').annotate(
                    passed=Count('exam_id', distinct=True, filter=Q(passed=True))):
            quiz_status[item['identity__user_id']] = 'passed' if item['passed'] == len(quizzes) else 'not_passed'
        counts['passed'] = sum(value == 'passed' for value in quiz_status.values())
    status = params.get("status", "pending")
    if status not in ("all", "pending", "approved", "rejected", "removed", "cancelled"):
        raise ValidationError(translate("Invalid enrollment status."))
    if status != "all":
        rows = rows.filter(status=status)
    if params.get('session'):
        try:session_id = int(params['session'])
        except (TypeError, ValueError):raise ValidationError(translate('Choose a valid session.'))
        rows = rows.filter(session_id=session_id)
    search = params.get("search", "").strip()[:200]
    if search:
        rows = rows.filter(
            Q(user__display_name__icontains=search)
            | Q(user__username__icontains=search)
            | Q(user__department__icontains=search)
        )
    try:
        page = max(1, int(params.get("page", 1)))
    except (ValueError, TypeError):
        raise ValidationError(translate("Invalid page number."))
    count = rows.count()
    page = min(page, max(1, (count + 19) // 20))
    return {
        "counts": counts,
        "count": count,
        "page": page,
        "page_size": 20,
        "results": [
            {
                **enrollment_data(row),
                "user_id": row.user_id,
                "quiz": quiz_status.get(row.user_id, 'not_started') if quizzes else None,
                "person": row.user.display_name or row.user.username,
                "username": row.user.username,
                "department": row.user.department,
                "active": row.user.is_active,
                "reviewer": (row.reviewed_by.display_name or row.reviewed_by.username)
                if row.reviewed_by
                else "",
            }
            for row in rows[(page - 1) * 20 : page * 20]
        ],
    }


@transaction.atomic
def review(user, course_id, enrollment_id, data):
    course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
    if not can_manage_course(user, course):
        raise PermissionDenied()
    row = get_object_or_404(
        Enrollment.objects.select_related("user"), pk=enrollment_id, course=course
    )
    form = ReviewInput(data=data)
    form.is_valid(raise_exception=True)
    values = form.validated_data
    decision, note = values["decision"], values["note"]
    if (
        row.revision == values["revision"] + 1
        and row.status == decision
        and row.review_note == note
        and row.reviewed_by_id == user.pk
    ):
        return Response(enrollment_data(row))
    if row.revision != values["revision"]:
        raise EnrollmentConflict()
    if decision == "approved" and not row.user.is_active:
        raise ValidationError(translate("Select active participants."))
    if decision == 'approved' and course.delivery_mode == 'scheduled':
        from .course_sessions import check_seat
        if not row.session_id:raise ValidationError(translate('Choose a session before enrolling.'))
        check_seat(course, row.session_id, row, admission=False)
    if (
        (decision == "removed" and row.status != "approved")
        or (decision == "rejected" and row.status != "pending")
        or decision == row.status
    ):
        raise ValidationError(translate("This enrollment decision is not available."))
    if decision != "approved" and not note:
        raise ValidationError(translate("Explain the enrollment decision."))
    before = enrollment_data(row)
    row.status = decision
    row.revision += 1
    row.review_note = note
    row.reviewed_at = timezone.now()
    row.reviewed_by = user
    row.save()
    audit(
        user,
        "enrollment." + decision,
        row.pk,
        {
            "course": course.pk,
            "user": row.user_id,
            "before": _audit_data(before),
            "after": _audit_data(enrollment_data(row)),
        },
    )
    from .notifications import enrollment_notification
    enrollment_notification(row, user, {
        "approved": "Enrollment approved", "rejected": "Enrollment rejected",
        "removed": "Enrollment removed",
    }[decision])
    return Response(enrollment_data(row))


def user_enrollment(user, course):
    if hasattr(course, 'user_enrollments'):
        return next(iter(course.user_enrollments), None)
    return course.enrollments.select_related('session').filter(user=user).first()
