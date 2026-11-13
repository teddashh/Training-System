"""Assessment listing and safe course-side summaries; no question content."""
from django.db.models import Count, Prefetch
from django.utils import timezone
from .access import manages_exam
from .models import Attempt, AttemptBudget, CourseAssessment, Exam
from .services import visible_exam, exam_opens_for


def exam_queryset(user):
    return Exam.objects.annotate(question_total=Count('questions', distinct=True)).prefetch_related(
        Prefetch('assessment_links', queryset=CourseAssessment.objects.select_related('course')),
        Prefetch('attemptbudget_set', queryset=AttemptBudget.objects.filter(identity__user=user), to_attr='user_budgets'),
        Prefetch('attempt_set', queryset=Attempt.objects.filter(identity__user=user).only(
            'id', 'exam_id', 'identity_id', 'number', 'status', 'deadline', 'started_at', 'graded_at', 'score', 'passed',
        ).order_by('number'), to_attr='user_attempts'),
    )


def gated(link, course=None):
    """True only when nobody can start the quiz before their session: "after the session" really holds."""
    course = course or link.course
    return link.release == 'after_session' and course.delivery_mode == 'scheduled' and link.exam.audience == 'course'


def require_release(course, release):
    from rest_framework.exceptions import ValidationError
    from .i18n import translate
    if release == 'after_session' and course.delivery_mode != 'scheduled':
        raise ValidationError({'release': [translate('Only a course with scheduled sessions can open a quiz after the session.')]})


def option(exam, user, course_id, membership):
    links = list(exam.assessment_links.all())
    now = timezone.now()
    starts = exam.starts_at if manages_exam(user, exam) else exam_opens_for(exam, user, membership)
    link = next((link for link in links if link.course_id == course_id), None)
    return {
        'release': link.release if link else None,
        'gated': bool(link) and link.release == 'after_session' and link.course.delivery_mode == 'scheduled' and exam.audience == 'course',
        'id': exam.pk, 'title': exam.title, 'published': exam.published, 'audience': exam.audience,
        'available_to_me': exam.published and visible_exam(exam, user, membership),
        'question_count': exam.questions_per_attempt or exam.question_total,
        'other_courses': sum(link.course_id != course_id for link in links),
        'can_manage': manages_exam(user, exam),
        'starts_at': starts, 'ends_at': exam.ends_at,
        'window_state': 'upcoming' if starts and now < starts else 'closed' if exam.ends_at and now >= exam.ends_at else 'open',
    }


def course_assessments(course, context):
    from .serializers import ExamSerializer
    from .services import exam_audience_sets
    user = context['request'].user
    membership = context.setdefault('audience_sets', None)
    if membership is None:
        membership = context['audience_sets'] = exam_audience_sets(user)
    from .access import manages_course
    manager = manages_course(user, course)
    rows = []
    exams = course.linked_assessments if hasattr(course, 'linked_assessments') else exam_queryset(user).filter(courses=course)
    exams = sorted(exams, key=lambda exam: next((link.created_at, link.pk) for link in exam.assessment_links.all() if link.course_id == course.pk))
    for exam in exams:
        available = exam.published and visible_exam(exam, user, membership)
        if not manager and not available:
            continue
        serializer = ExamSerializer(context=context)
        rows.append({**option(exam, user, course.pk, membership), 'available_to_me': available,
                     'active_attempt_id': serializer.get_active_attempt_id(exam),
                     'last_result': serializer.get_last_result(exam),
                     'attempts_remaining': serializer.get_attempts_remaining(exam),
                     'next_attempt_at': serializer.get_next_attempt_at(exam),
                     'next_round_at': serializer.get_next_round_at(exam),
                     'round_awaiting_grading': serializer.get_round_awaiting_grading(exam),
                     'attempts_used': serializer.get_attempts_used(exam),
                     'retry_interval_minutes': exam.retry_interval_minutes,
                     'server_time': serializer.get_server_time(exam)})
    return rows


def attach_quiz(user, course, exam, *, release=None, publish=False):
    """Caller locks course then exam. Publication and linking share the transaction."""
    from rest_framework.exceptions import ValidationError
    from .i18n import translate
    from .services import audit
    require_release(course, release)
    if publish:
        if exam.audience == 'invitation' or not exam.questions.exists() or (not exam.published and not manages_exam(user, exam)):
            raise ValidationError(translate('Choose a published quiz or your own draft with questions.'))
        if not exam.published:
            if exam.audience == 'all':
                exam.audience = 'course'
            exam.published = True
            exam.save(update_fields=['published', 'audience'])
            audit(user, 'exam.updated', exam.pk, {'published': True})
    elif exam.audience == 'invitation' and not manages_exam(user, exam):
        raise ValidationError(translate('Only the exam owner or an exam administrator can attach an invitation-only quiz.'))
    link, created = CourseAssessment.objects.get_or_create(course=course, exam=exam,
        defaults={'created_by': user, 'release': release or 'immediate'})
    if release is not None and link.release != release:
        link.release = release
        link.save(update_fields=['release'])
        audit(user, 'course.assessment_release', course.pk, {'exam': exam.pk, 'release': release})
    elif created:
        audit(user, 'course.assessment_linked', course.pk, {'exam': exam.pk})
    return link
