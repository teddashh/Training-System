"""Explicit, authorized removal of training records and cancellation of schedules."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from .access import manages_course, manages_exam
from .i18n import translate
from .models import Course, Exam, LearningAssignment, OutboundEmail
from .services import audit


def managed(user, model, pk, *, lock=False):
    rows = model.objects.select_for_update() if lock else model.objects.all()
    target = get_object_or_404(rows, pk=pk)
    if not (manages_course(user, target) if model is Course else manages_exam(user, target)):
        raise PermissionDenied()
    return target


def deletion_preview(user, model, pk):
    target = managed(user, model, pk)
    if model is Course:
        counts = {'sessions': target.sessions.count(), 'enrollments': target.enrollments.count(),
                  'assignments': LearningAssignment.objects.filter(course=target).count()}
    else:
        counts = {'questions': target.questions.count(), 'attempts': target.attempt_set.count(),
                  'assignments': LearningAssignment.objects.filter(exam=target).count(),
                  'invitations': target.invitation_set.count(), 'courses': target.assessment_links.count()}
    return {'title': target.title, 'counts': counts}


@transaction.atomic
def delete_training(user, model, pk, data):
    target = managed(user, model, pk, lock=True)
    class Confirmation(serializers.Serializer):
        confirm_title = serializers.CharField(max_length=200, trim_whitespace=False)
    form = Confirmation(data=data)
    form.is_valid(raise_exception=True)
    if form.validated_data['confirm_title'] != target.title:
        raise ValidationError(translate('Enter the exact title to confirm deletion.'))
    kind = 'course' if model is Course else 'exam'
    detail = deletion_preview(user, model, pk)
    if model is Exam and target.attempt_set.exists():
        raise ValidationError(translate('This exam has attempts or results and cannot be deleted. Unpublish it instead.'))
    # Preserve delivery evidence while preventing queued messages from linking to a removed target.
    OutboundEmail.objects.filter(status='queued', **{f'context__{kind}_id': target.pk}).update(
        status='cancelled', last_error='Training deleted before delivery.')
    LearningAssignment.objects.filter(**{kind: target}).delete()
    if model is Course:
        # Enrollment protects its selected session from ordinary session deletion.
        target.enrollments.all().delete()
    else:
        # Remove invitations before their protected batch; attempts have already been ruled out.
        target.invitation_set.all().delete()
        target.invitationbatch_set.all().delete()
        target.marksimport_set.all().delete()
    target.delete()
    audit(user, f'{kind}.deleted', pk, detail)


@transaction.atomic
def cancel_training(user, pk, data):
    from .course_sessions import save_session
    from .enrollments import EnrollmentConflict

    course = managed(user, Course, pk, lock=True)
    class SessionRevision(serializers.Serializer):
        id = serializers.IntegerField(min_value=1)
        revision = serializers.IntegerField(min_value=0)
    class Cancellation(serializers.Serializer):
        sessions = SessionRevision(many=True, allow_empty=False)
    form = Cancellation(data=data)
    form.is_valid(raise_exception=True)
    sessions = list(course.sessions.filter(cancelled=False, ends_at__gt=timezone.now()))
    expected = [{'id': session.pk, 'revision': session.revision} for session in sessions]
    if sorted(form.validated_data['sessions'], key=lambda s: s['id']) != sorted(expected, key=lambda s: s['id']):
        raise EnrollmentConflict()
    for session in sessions:
        save_session(user, course.pk, {'cancelled': True, 'revision': session.revision}, session.pk)
    audit(user, 'course.training_cancelled', course.pk, {'sessions': [s.pk for s in sessions]})
    return {'cancelled': len(sessions)}
