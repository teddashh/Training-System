"""The organizer's one-call training workflow and overview."""
import math
from datetime import timedelta
import secrets

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
import json

from .access import has_courses, manages_course
from .assessments import attach_quiz, gated
from .course_sessions import session_data
from .covers import cover_ids, scene_for
from .i18n import translate
from .models import Attempt, Course, CourseSession, Exam, OutboundEmail, TrainingRequest, User
from .roster_import import PeopleInput, Resolution, apply_roster, check_people, import_roster, resolve
from .services import audit


class TrainingSessionInput(serializers.Serializer):
    title = serializers.CharField(max_length=100, allow_blank=True, default='')
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField()
    location = serializers.CharField(max_length=200)
    capacity = serializers.IntegerField(min_value=1, max_value=10000, default=100)


class TrainingRosterInput(PeopleInput):
    session = serializers.IntegerField(min_value=0, default=0)
    dry_run = serializers.BooleanField(default=False)


class TrainingInput(serializers.Serializer):
    request_id = serializers.UUIDField()
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(allow_blank=True, default='')
    cover = serializers.CharField(max_length=80, allow_blank=True, default='')
    sessions = TrainingSessionInput(many=True, min_length=1, max_length=10)
    rosters = TrainingRosterInput(many=True, required=False, default=list, max_length=10)
    exam = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    notify = serializers.BooleanField(default=True)


def flatten_errors(errors, prefix=''):
    result = {}
    if isinstance(errors, dict):
        for key, value in errors.items():
            path = f'{prefix}[{key}]' if isinstance(key, int) or str(key).isdigit() else f'{prefix}.{key}' if prefix else key
            result.update(flatten_errors(value, path))
    elif isinstance(errors, list) and any(isinstance(item, dict) for item in errors):
        for index, item in enumerate(errors):
            if item:
                result.update(flatten_errors(item, f'{prefix}[{index}]'))
    else:
        result[prefix] = errors
    return result


def registration_path(course):
    return settings.APP_BASE_PATH + '/register#' + course.registration_key if course.registration_key else None


@api_view(['POST'])
def create_training(request):
    if not has_courses(request.user):
        raise PermissionDenied()
    try:
        request_id = serializers.UUIDField().run_validation(request.data.get('request_id'))
    except ValidationError as exc:
        raise ValidationError({'request_id': exc.detail}) from None
    previous = TrainingRequest.objects.filter(owner=request.user, request_id=request_id).first()
    if previous:
        return Response(previous.response, headers={'Cache-Control': 'no-store'})
    form = TrainingInput(data=request.data)
    if not form.is_valid():
        raise ValidationError(flatten_errors(form.errors))
    values, now = form.validated_data, timezone.now()
    for index, session in enumerate(values['sessions']):
        if session['starts_at'] <= now:
            raise ValidationError({f'sessions[{index}].starts_at': translate('Choose a future session start.')})
        if session['ends_at'] <= session['starts_at']:
            raise ValidationError({f'sessions[{index}].ends_at': translate('The session end must be after its start.')})
    if values['cover'] and values['cover'] not in cover_ids():
        raise ValidationError({'cover': translate('Choose a cover from the library.')})
    rosters = values['rosters']
    for index, roster in enumerate(rosters):
        if roster['session'] >= len(values['sessions']):
            raise ValidationError({f'rosters[{index}].session': translate('Choose a valid session.')})
        if roster['dry_run']:
            raise ValidationError({f'rosters[{index}].dry_run': translate('Preview the roster before creating the training.')})
    # One deadline, one directory cache and one people limit for all lists; a person
    # named in an earlier list keeps that session and is reported as a duplicate later.
    state, resolved = Resolution(), []
    for index, roster in enumerate(rosters):
        try:
            resolved.append(resolve(roster, state))
        except ValidationError as exc:
            raise ValidationError(flatten_errors(exc.detail, f'rosters[{index}]')) from None
    with transaction.atomic():
        # An owner lock serializes absent request receipts, including concurrent retries.
        User.objects.select_for_update(no_key=True).get(pk=request.user.pk)
        previous = TrainingRequest.objects.filter(owner=request.user, request_id=request_id).first()
        if previous:
            return Response(previous.response, headers={'Cache-Control': 'no-store'})
        first = values['sessions'][0]
        course = Course.objects.create(owner=request.user, title=values['title'], description=values['description'],
            cover=values['cover'], venue='onsite', delivery_mode='scheduled', published=True,
            release_at=now, requires_approval=False, reminders=True, registration_key=secrets.token_urlsafe(32),
            duration_minutes=max(1, math.ceil((first['ends_at'] - first['starts_at']).total_seconds() / 60)))
        if not course.cover:
            # New trainings get an illustrated scene; existing courses keep theirs.
            course.cover = scene_for(course.pk, course.title)
            course.save(update_fields=['cover'])
        audit(request.user, 'course.created', course.pk)
        audit(request.user, 'course.registration_created', course.pk)
        sessions = []
        for index, data in enumerate(values['sessions']):
            session = CourseSession.objects.create(course=course, **{**data,
                'title': data['title'] or translate('Session {number}', number=index + 1)},
                registration_opens_at=now, registration_closes_at=data['starts_at'], revision=1)
            sessions.append(session)
            audit(request.user, 'course.session_created', session.pk, {'course': course.pk})
        quiz = None
        if values.get('exam'):
            exam = Exam.objects.select_for_update().filter(pk=values['exam']).first()
            if exam is None:
                raise ValidationError({'exam': translate('Choose a valid quiz.')})
            try:
                link = attach_quiz(request.user, course, exam, release='after_session', publish=True)
            except ValidationError as exc:
                raise ValidationError({'exam': exc.detail}) from None
            quiz = {'id': exam.pk, 'published': exam.published, 'release': link.release, 'gated': gated(link, course)}
        reports = [apply_roster(request.user, course, sessions[roster['session']], entries, notify=values['notify'])
                   for roster, entries in zip(rosters, resolved)]
        payload = {'course': course.pk, 'registration_url': registration_path(course),
                   'sessions': [session.pk for session in sessions], 'rosters': reports, 'quiz': quiz}
        payload = json.loads(json.dumps(payload, cls=DjangoJSONEncoder))
        TrainingRequest.objects.create(owner=request.user, request_id=request_id, response=payload)
        return Response(payload, status=201, headers={'Cache-Control': 'no-store'})


@api_view(['POST'])
def check_training_people(request):
    if not has_courses(request.user):
        raise PermissionDenied()
    return Response(check_people(request.data, flatten=flatten_errors), headers={'Cache-Control': 'no-store'})


@api_view(['GET'])
def people_template(request):
    if not has_courses(request.user):
        raise PermissionDenied()
    from io import BytesIO
    from django.http import HttpResponse
    from openpyxl import Workbook
    from openpyxl.styles import Font

    book = Workbook()
    sheet = book.active
    sheet.append([translate(label) for label in ('Email', 'Employee ID', 'Name')])
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    sheet.freeze_panes = 'A2'
    for column, width in (('A', 36), ('B', 24), ('C', 30)):
        sheet.column_dimensions[column].width = width
    output = BytesIO()
    book.save(output)
    response = HttpResponse(output.getvalue(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition'] = 'attachment; filename="people-template.xlsx"; filename*=UTF-8\'\'people-template.xlsx'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


@api_view(['POST'])
def roster_import(request, course_id):
    return Response(import_roster(request.user, course_id, request.data), headers={'Cache-Control': 'no-store'})


@api_view(['GET'])
def training_overview(request, course_id):
    from .reminders import WINDOW, event_key, in_window, schedule
    course = get_object_or_404(Course, pk=course_id)
    now = timezone.now()
    if not manages_course(request.user, course):
        raise PermissionDenied()
    links = list(course.assessment_links.select_related('exam').annotate(question_count=Count('exam__questions')))
    participants = course.enrollments.filter(status='approved').values('user_id')
    participation = {item['exam_id']: {'started': item['started'], 'passed': item['passed']}
        for item in Attempt.objects.filter(exam_id__in=[link.exam_id for link in links],
            identity__user_id__in=participants).values('exam_id').annotate(
                started=Count('identity', distinct=True),
                passed=Count('identity', distinct=True, filter=Q(status='graded', passed=True)))}
    quizzes = []
    for link in links:
        item = {'id': link.exam_id, 'title': link.exam.title, 'published': link.exam.published,
                'release': link.release, 'question_count': link.question_count, 'gated': gated(link, course)}
        item['participation'] = participation.get(link.exam_id, {'started': 0, 'passed': 0})
        quizzes.append(item)
    sessions = []
    for session in course.sessions.all():
        session.course = course
        counts = session.enrollments.aggregate(
            registered=Count('pk', filter=Q(status='approved')), pending=Count('pk', filter=Q(status='pending')),
            present=Count('pk', filter=Q(attendance='present') | Q(attendance='', attended_at__isnull=False)),
            absent=Count('pk', filter=Q(attendance='absent')))
        counts['seats'] = max(0, session.capacity - counts['registered'] - counts['pending'])
        events = []
        all_batches = list(session.reminder_batches.all())
        batches = {batch.key: batch for batch in all_batches}

        def current(exam, kind):
            seen = session.reminders_seen_at
            found = [batch for batch in all_batches if batch.exam_id == exam.pk and batch.kind == kind
                     and seen and batch.produced_at >= seen]
            return max(found, key=lambda batch: batch.produced_at) if found else None

        plans = [('session_tomorrow', None, None)] + [(kind, link.exam, link) for link in links
                                                     if link.release == 'after_session' and course.delivery_mode == 'scheduled'
                                                     for kind in ('quiz_ready', 'quiz_reminder')]
        keys = set()
        for kind, exam, link in plans:
            key = event_key(session, kind, exam.pk if exam else None)
            batch = current(exam, kind) if exam else batches.get(key)
            key = batch.key if batch else key
            keys.add(key)
            enabled = course.reminders and course.published and not session.cancelled
            ready = current(exam, 'quiz_ready') if kind == 'quiz_reminder' else None
            due = schedule(session, exam, kind, ready.produced_at if ready else None)
            if exam:
                enabled = enabled and exam.published and exam.audience != 'invitation' and (not exam.ends_at or exam.ends_at > now)
                if (exam.ends_at and due >= exam.ends_at) or (session.reminders_seen_at or now) > session.ends_at + WINDOW:
                    enabled = False
                if kind == 'quiz_ready' and not in_window(session, exam, kind, link, now):
                    enabled = False
                if kind == 'quiz_reminder' and now > due + WINDOW:
                    enabled = False
            else:
                enabled = enabled and session.starts_at > now
            events.append({'kind': kind, 'exam': exam.pk if exam else None, 'scheduled_at': due,
                           'produced_at': batch.produced_at if batch else None,
                           'state': 'produced' if batch else 'scheduled' if enabled else 'disabled',
                           'delivery': dict(OutboundEmail.objects.filter(dedupe_key__startswith=key + ':').values('status').annotate(
                               total=Count('pk')).values_list('status', 'total'))})
        for key, batch in batches.items():
            if key not in keys:
                events.append({'kind': batch.kind, 'exam': batch.exam_id, 'scheduled_at': batch.scheduled_at,
                               'produced_at': batch.produced_at, 'state': 'superseded',
                               'delivery': dict(OutboundEmail.objects.filter(dedupe_key__startswith=key + ':').values('status').annotate(
                                   total=Count('pk')).values_list('status', 'total'))})
        sessions.append({**session_data(session, user=request.user), 'counts': counts, 'emails': events})
    return Response({'id': course.pk, 'title': course.title, 'published': course.published, 'release_at': course.release_at,
                     'sessions': sessions, 'registration_url': registration_path(course), 'quizzes': quizzes,
                     'reminders': course.reminders, 'people': participants.count()}, headers={'Cache-Control': 'no-store'})
