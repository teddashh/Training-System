import secrets
from datetime import timedelta

from django.db import transaction
from django.db.models import Avg, Case, Count, IntegerField, OuterRef, Prefetch, Q, Subquery, Value, When
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.cache import never_cache
from rest_framework import viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .runtime_settings import verification_brand, verification_heading, from_email, mail_enabled
from .access import (AdminOnly, has_courses, has_exams, manages_course, manages_exam,
                     people_access, require_exam, require_results, role_access, scope, scope_q, system_admin)
from .course_sessions import course_queryset

from .i18n import translate
from .enrollments import (
    check_learning_access,
    enroll,
    enrollment_data,
    roster,
    review as review_course_enrollment,
)
from .models import (
    Attempt,
    AttemptBudget,
    Course,
    Enrollment,
    Exam,
    GuestEmailChallenge,
    Invitation,
    Question,
    User,
)
from .serializers import (
    CourseSerializer,
    ExamSerializer,
    UserSerializer,
)
from .services import (
    audit,
    apply_manual_grades,
    check_invite,
    finalize,
    hash_token,
    identity_for_user,
    in_exam_audience,
    invitation_from_token,
    next_attempt_at,
    public_attempt,
    resolve_identity,
    start_attempt,
    record_answers,
)





class Users(viewsets.ModelViewSet):
    permission_classes = [AdminOnly]
    queryset = User.objects.all().order_by("id")
    serializer_class = UserSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        # Read local access decisions after any in-flight directory write completes.
        get_object_or_404(self.get_queryset().select_for_update(), pk=kwargs['pk'])
        return super().update(request, *args, **kwargs)

    def get_queryset(self):
        from .people import filter_people
        qs = super().get_queryset()
        return filter_people(qs, self.request.query_params) if self.action == 'list' else qs

    def list(self, request, *args, **kwargs):
        from .people import page_people, departments
        rows, pagination = page_people(self.get_queryset(), request.query_params)
        return Response({**pagination, 'results': self.get_serializer(rows, many=True).data,
                         'departments': departments()})

    @transaction.atomic
    def perform_create(self, serializer):
        user = serializer.save()
        identity_for_user(user)
        audit(self.request.user, "user.created", user.id)

    @transaction.atomic
    def perform_update(self, serializer):
        user = serializer.instance
        if user.id == self.request.user.id and (
            not role_access(serializer.validated_data.get("role", user.role))["system_admin"]
            or serializer.validated_data.get("is_active") is False
        ):
            raise ValidationError(
                translate(
                    "You cannot disable yourself or remove your own administrator role."
                )
            )
        serializer.save()
        audit(self.request.user, "user.updated", user.id)


class Courses(viewsets.ModelViewSet):
    serializer_class = CourseSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    @action(detail=True, methods=['get'], url_path='deletion-preview')
    def deletion_preview(self, request, pk=None):
        from .lifecycle import deletion_preview
        return Response(deletion_preview(request.user, Course, pk))

    def destroy(self, request, pk=None):
        from .lifecycle import delete_training
        delete_training(request.user, Course, pk, request.data)
        return Response(status=204)

    @action(detail=True, methods=['post'], url_path='cancel-training')
    def cancel_training(self, request, pk=None):
        from .lifecycle import cancel_training
        return Response(cancel_training(request.user, pk, request.data))

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = response.get("Cache-Control", "no-store")
        return response

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        # Serialize policy changes with admissions, completions and SCORM writes.
        get_object_or_404(Course.objects.select_for_update(), pk=kwargs["pk"])
        return super().update(request, *args, **kwargs)

    def get_queryset(self):
        qs = course_queryset(self.request.user).order_by("-created_at")
        visible = Q(published=True) & (Q(release_at__isnull=True) | Q(release_at__lte=timezone.now()))
        if scope(self.request.user, 'courses') == 'all':
            return qs
        return qs.filter(visible | scope_q(self.request.user, 'courses'))

    @action(detail=False, methods=['get'])
    def mine(self, request):
        from .models import LearningAssignment
        mine = Enrollment.objects.filter(user=request.user).filter(
            ~Q(status__in=['cancelled', 'rejected']) | Q(progress__gt=0) | Q(progress_known=False) | Q(completed_at__isnull=False)
        ).values('course_id')
        assigned = LearningAssignment.objects.filter(user=request.user, cancelled_at=None).values('course_id')
        # Personal learning follows publication even for organizers. Keep the underlying
        # enrollment/assignment history so republishing restores the same progress.
        rows = course_queryset(request.user).filter(published=True).filter(Q(pk__in=mine) | Q(pk__in=assigned)).order_by('title')
        return Response(self.get_serializer(rows, many=True).data)

    def perform_create(self, serializer):
        if not has_courses(self.request.user):
            raise PermissionDenied()
        course = serializer.save(owner=self.request.user)
        audit(self.request.user, "course.created", course.id)

    def perform_update(self, serializer):
        if not manages_course(self.request.user, serializer.instance):
            raise PermissionDenied()
        serializer.save()
        audit(self.request.user, "course.updated", serializer.instance.id)

    @action(detail=True, methods=['get', 'post', 'patch'], url_path='assessments')
    @transaction.atomic
    def assessments(self, request, pk=None):
        course = get_object_or_404(Course.objects.select_for_update(), pk=pk)
        if not manages_course(request.user, course):
            raise PermissionDenied()
        if request.method in ('POST', 'PATCH'):
            from rest_framework import serializers
            class LinkInput(serializers.Serializer):
                exam = serializers.IntegerField(min_value=1)
                attach = serializers.BooleanField(default=True)
                release = serializers.ChoiceField(choices=['immediate', 'after_session'], required=False)
                publish = serializers.BooleanField(default=False)
            form = LinkInput(data=request.data)
            if request.method == 'PATCH':
                form.fields['release'].required = True
                form.fields.pop('attach')
                form.fields.pop('publish')
            form.is_valid(raise_exception=True)
            from .assessments import require_release
            require_release(course, form.validated_data.get('release'))
            exam = get_object_or_404(Exam.objects.select_for_update(), pk=form.validated_data['exam'])
            attach = form.validated_data.get('attach', True)
            from .models import CourseAssessment
            if request.method == 'PATCH':
                link = get_object_or_404(CourseAssessment, course=course, exam=exam)
                if link.release != form.validated_data['release']:
                    link.release = form.validated_data['release']
                    link.save(update_fields=['release'])
                    audit(request.user, 'course.assessment_release', course.pk, {'exam': exam.pk, 'release': link.release})
            elif attach:
                from .assessments import attach_quiz
                attach_quiz(request.user, course, exam, release=form.validated_data.get('release'),
                            publish=form.validated_data.get('publish', False))
            elif request.method == 'POST':
                deleted, _ = CourseAssessment.objects.filter(course=course, exam=exam).delete()
                if deleted:
                    audit(request.user, 'course.assessment_detached', course.pk, {'exam': exam.pk})
        from .assessments import exam_queryset, option
        from .services import exam_audience_sets
        membership = exam_audience_sets(request.user)
        linked, available = [], []
        for exam in exam_queryset(request.user).order_by('title', 'id'):
            linked_here = any(link.course_id == course.pk for link in exam.assessment_links.all())
            if not linked_here and exam.audience == 'invitation' and not manages_exam(request.user, exam):
                continue
            (linked if linked_here else available).append(option(exam, request.user, course.pk, membership))
        order = {exam_id: index for index, exam_id in enumerate(course.assessment_links.values_list('exam_id', flat=True))}
        linked.sort(key=lambda row: order[row['id']])
        return Response({'linked': linked, 'available': available})

    @action(detail=True, methods=['post'], url_path='registration-link')
    def registration_link(self, request, pk=None):
        from .registration import registration_link
        return registration_link(request.user, pk, request.data)

    @action(detail=True, methods=["post"])
    def enroll(self, request, pk=None):
        course = self.get_object()
        row = enroll(request.user, course.pk, request.data)
        return Response(enrollment_data(row))

    @action(detail=True, methods=["get"])
    def enrollments(self, request, pk=None):
        return Response(roster(request.user, self.get_object(), request.query_params))

    @action(detail=True, methods=['get', 'post'])
    def sessions(self, request, pk=None):
        from .course_sessions import visible_sessions, save_session
        course = self.get_object()
        if request.method == 'GET':
            return Response(visible_sessions(request.user, course))
        return Response(save_session(request.user, course.pk, request.data), status=201)

    @action(detail=True, methods=['patch'], url_path=r'sessions/(?P<session_id>\d+)')
    def session_detail(self, request, pk=None, session_id=None):
        from .course_sessions import save_session
        self.get_object()
        return Response(save_session(request.user, pk, request.data, session_id))

    @action(detail=True, methods=['post'], url_path='cancel-registration')
    def cancel_registration(self, request, pk=None):
        from .course_sessions import cancel_registration
        self.get_object()
        return Response(cancel_registration(request.user, pk, request.data))

    @action(
        detail=True,
        methods=["post"],
        url_path=r"enrollments/(?P<enrollment_id>\d+)/review",
    )
    def review_enrollment(self, request, pk=None, enrollment_id=None):
        self.get_object()
        return review_course_enrollment(request.user, pk, enrollment_id, request.data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def content(self, request, pk=None):
        course = self.get_object()
        check_learning_access(request.user, course)
        if course.blocks and not course.packages.exists():
            from .attendance import record_content_access
            record_content_access(request.user, course)
        return Response(self.get_serializer(course).data)

    @action(detail=True, methods=['get', 'post'], url_path=r'sessions/(?P<session_id>\d+)/attendance')
    def attendance(self, request, pk=None, session_id=None):
        from .attendance import attendance_data, mark_attendance, session_for_manager
        if request.method == 'POST':
            return Response(mark_attendance(request.user, pk, session_id, request.data))
        return Response(attendance_data(session_for_manager(request.user, pk, session_id)))

    @action(detail=True, methods=['get'], url_path=r'sessions/(?P<session_id>\d+)/export')
    def session_export(self, request, pk=None, session_id=None):
        from .session_exports import session_export
        return session_export(request, pk, session_id)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def complete(self, request, pk=None):
        self.get_object()
        course = get_object_or_404(Course.objects.select_for_update(), pk=pk)
        check_learning_access(request.user, course)
        if course.packages.exists() or not course.blocks:
            raise ValidationError(
                translate(
                    "SCORM completion must be reported by the player. Empty content cannot be completed."
                )
            )
        Enrollment.objects.update_or_create(
            user=request.user,
            course=course,
            defaults={"progress": 100, "progress_known": True, "completed_at": timezone.now()},
        )
        return Response({"progress": 100})


class Exams(viewsets.ModelViewSet):
    serializer_class = ExamSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    @action(detail=True, methods=['get'], url_path='deletion-preview')
    def deletion_preview(self, request, pk=None):
        from .lifecycle import deletion_preview
        return Response(deletion_preview(request.user, Exam, pk))

    def destroy(self, request, pk=None):
        from .lifecycle import delete_training
        delete_training(request.user, Exam, pk, request.data)
        return Response(status=204)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        # Validate the linked course against a fresh row, serialized with course-side linking.
        get_object_or_404(Exam.objects.select_for_update(), pk=kwargs['pk'])
        return super().update(request, *args, **kwargs)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['audience_sets'] = self.audience_sets()
        return context

    def audience_sets(self):
        from .services import exam_audience_sets
        if not hasattr(self, '_audience_sets'):
            self._audience_sets = exam_audience_sets(self.request.user)
        return self._audience_sets

    def get_queryset(self):
        from .assessments import exam_queryset
        qs = exam_queryset(self.request.user).order_by('-created_at')
        # Only management responses can serialize questions/answers.
        if has_exams(self.request.user):
            qs = qs.prefetch_related('allowed_users', 'allowed_groups', Prefetch(
                'questions', queryset=Question.objects.select_related('figure').defer('figure__data')))
        if scope(self.request.user, 'exams') == 'all':
            return qs
        membership = self.audience_sets()
        from .services import visible_exam
        permitted = [exam.pk for exam in Exam.objects.filter(published=True)
                     if visible_exam(exam, self.request.user, membership)]
        return qs.filter(Q(pk__in=permitted) | scope_q(self.request.user, 'exams'))

    @action(detail=False, methods=['get'], url_path='link-options')
    def link_options(self, request):
        if request.query_params.get('quizzes') == '1':
            if not has_courses(request.user):
                raise PermissionDenied()
            qs = Exam.objects.annotate(question_count=Count('questions')).exclude(audience='invitation').filter(
                Q(published=True) | (Q(owner=request.user, published=False, question_count__gt=0) if has_exams(request.user) else Q(pk__in=[])))
            # gated: linking it "after the session" keeps everybody out until their session (drafts become course-only).
            # The organizer's own quizzes come first: in a long company list those are the ones they are looking for.
            qs = qs.annotate(other=Case(When(owner=request.user, then=Value(0)), default=Value(1), output_field=IntegerField()))
            return Response([{**row, 'gated': row['audience'] == 'course' or (not row['published'] and row['audience'] == 'all')}
                             for row in qs.order_by('other', 'title', 'id').values('id', 'title', 'published', 'audience', 'question_count')])
        if not has_exams(request.user):
            raise PermissionDenied()
        qs = Course.objects.all()
        if scope(request.user, 'exams') != 'all':
            qs = qs.filter(scope_q(request.user, 'courses'))
        return Response(list(qs.order_by('title', 'id').values('id', 'title', 'published')))

    @action(detail=False, methods=["get"], url_path="audience-options")
    def audience_options(self, request):
        if not people_access(request.user):
            raise PermissionDenied()
        from .people import filter_audience_people, page_people, departments
        rows, pagination = page_people(filter_audience_people(User.objects.filter(is_active=True), request.query_params, request.user)
                                       .order_by('display_name', 'id'), request.query_params)
        return Response({**pagination, 'people': list(rows.values('id', 'display_name', 'username', 'department')),
                         'departments': departments(active_only=True)})

    @transaction.atomic
    def perform_create(self, serializer):
        if not has_exams(self.request.user):
            raise PermissionDenied()
        exam = serializer.save(owner=self.request.user)
        audit(self.request.user, "exam.created", exam.id)

    @transaction.atomic
    def perform_update(self, serializer):
        exam = Exam.objects.select_for_update().get(pk=serializer.instance.pk)
        require_exam(self.request.user, exam)
        serializer.save()
        audit(self.request.user, "exam.updated", exam.id)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        exam = self.get_object()
        return Response(
            public_attempt(start_attempt(exam.id, identity_for_user(request.user))),
            headers={"Cache-Control": "no-store"},
        )

    @action(detail=True, methods=["get", "post"])
    def budget(self, request, pk=None):
        exam = self.get_object()
        if request.method == 'GET':
            data = self.get_serializer(exam).data
            from .services import exam_opens_for
            data['starts_at'] = exam_opens_for(exam, request.user, self.audience_sets())
            return Response({key: data[key] for key in (
                'id', 'starts_at', 'ends_at', 'available_to_me', 'attempts_remaining',
                'active_attempt_id', 'next_attempt_at', 'next_round_at', 'server_time')})
        require_exam(request.user, exam)
        try:
            limit = int(request.data["limit"])
        except (KeyError, ValueError, TypeError):
            raise ValidationError(translate("Enter a valid attempt limit."))
        if not 1 <= limit <= 100:
            raise ValidationError(translate("Attempts must be between 1 and 100."))
        with transaction.atomic():
            Exam.objects.select_for_update().get(pk=exam.pk)
            identity = resolve_identity(request.data.get("key", ""))
            budget, _ = AttemptBudget.objects.get_or_create(
                exam=exam, identity=identity
            )
            if limit < budget.used - budget.round_start_used:
                raise ValidationError(
                    translate(
                        "The limit cannot be lower than the attempts already used."
                    )
                )
            budget.limit_override = limit
            budget.save(update_fields=["limit_override"])
            audit(
                request.user,
                "budget.changed",
                budget.id,
                {"limit": limit, "used": budget.used},
            )
        return Response({"limit": limit, "used": budget.used})


def session_invite(request):
    inv = get_object_or_404(
        Invitation.objects.select_related("exam", "identity"),
        pk=request.session.get("guest_invitation"),
    )
    check_invite(inv)
    if inv.require_email_verification and request.session.get(
        "guest_verified_invitation"
    ) != str(inv.pk):
        raise PermissionDenied(
            translate("Verify the recipient email before accessing this exam.")
        )
    return inv


@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def guest_exchange(request):
    inv = invitation_from_token(request.data.get("token", ""))
    request.session.cycle_key()
    for key in (
        "guest_invitation",
        "guest_pending_invitation",
        "guest_verified_invitation",
        "guest_challenge",
    ):
        request.session.pop(key, None)
    if inv.require_email_verification:
        if not mail_enabled():
            raise ValidationError(translate("Email is off."))
        request.session["guest_pending_invitation"] = str(inv.id)
        return Response(verification_info(inv))
    request.session["guest_invitation"] = str(inv.id)
    return Response(guest_info(inv))


def verification_info(inv):
    if not mail_enabled():
        raise ValidationError(translate("Email is off."))
    local, domain = inv.verification_email.rsplit("@", 1)
    return {
        "verification_required": True,
        "email_hint": local[:1] + "***@" + domain,
        "title": inv.exam.title,
    }


def pending_invite(request):
    inv = get_object_or_404(
        Invitation.objects.select_related("exam", "identity"),
        pk=request.session.get("guest_pending_invitation"),
    )
    check_invite(inv)
    if not inv.require_email_verification:
        raise PermissionDenied()
    return inv


@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def guest_email_request(request):
    if not mail_enabled():
        raise ValidationError(translate("Email is off."))
    from .notifications import record_verification
    from django.conf import settings
    from django.core.mail import send_mail

    from .auth_views import rate_limit

    inv = pending_invite(request)
    rate_limit(request, "guest:" + str(inv.pk))
    old = request.session.pop("guest_challenge", None)
    if old:
        GuestEmailChallenge.objects.filter(pk=old, invitation=inv).delete()
    # Remove expired rows without exposing codes or mailboxes in logs.
    GuestEmailChallenge.objects.filter(expires_at__lt=timezone.now()).delete()
    challenge = GuestEmailChallenge(
        invitation=inv, expires_at=timezone.now() + timedelta(minutes=10)
    )
    code = f"{secrets.randbelow(1000000):06d}"
    challenge.digest = hash_token(settings.SECRET_KEY + str(challenge.pk) + code)
    challenge.save()
    request.session["guest_challenge"] = str(challenge.pk)
    try:
        send_mail(
            translate("{organization} exam verification", organization=verification_brand(), locale="en"),
            verification_heading() + "Your verification code: "
            + code
            + "\n"
            + "Valid for 10 minutes.",
            from_email(),
            [inv.verification_email],
        )
    except Exception as error:
        challenge.delete()
        request.session.pop("guest_challenge", None)
        record_verification("guest_verification", inv.verification_email, error=error)
        return Response(
            {
                "detail": translate(
                    "Email delivery failed. Please try again or contact the organizer."
                )
            },
            status=503,
        )
    record_verification("guest_verification", inv.verification_email)
    return Response(
        {
            "detail": translate(
                "A verification code has been sent to the invited recipient."
            )
        }
    )


@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def guest_email_verify(request):
    if not mail_enabled():
        raise ValidationError(translate("Email is off."))
    from django.conf import settings

    from .auth_views import rate_limit

    inv = pending_invite(request)
    rate_limit(request, "guest:" + str(inv.pk))
    challenge_id = request.session.get("guest_challenge")
    valid = False
    with transaction.atomic():
        challenge = (
            GuestEmailChallenge.objects.select_for_update()
            .filter(pk=challenge_id, invitation=inv)
            .first()
        )
        if (
            challenge
            and challenge.expires_at > timezone.now()
            and challenge.failures < 5
        ):
            digest = hash_token(
                settings.SECRET_KEY
                + str(challenge.pk)
                + str(request.data.get("code", ""))
            )
            if secrets.compare_digest(challenge.digest, digest):
                valid = True
                challenge.delete()
            else:
                challenge.failures += 1
                challenge.save(update_fields=["failures"])
    if not valid:
        raise ValidationError(
            translate("The code is invalid, already used or expired.")
        )
    request.session.cycle_key()
    request.session.pop("guest_pending_invitation", None)
    request.session.pop("guest_challenge", None)
    request.session["guest_invitation"] = str(inv.pk)
    request.session["guest_verified_invitation"] = str(inv.pk)
    audit(None, "invitation.email_verified", inv.pk)
    return Response(guest_info(inv))


def guest_info(inv):
    budget = AttemptBudget.objects.filter(exam=inv.exam, identity=inv.identity).first()
    from .attempt_rounds import round_status
    allowance = round_status(inv.exam, budget)
    remaining = allowance['attempts_remaining']
    # The secret link identifies one pre-bound recipient; typing another email
    # never creates a new identity or budget. The link itself is a credential.
    now = timezone.now()
    attempts = Attempt.objects.filter(exam=inv.exam, identity=inv.identity)
    last_started_at = (
        attempts.order_by("-number").values_list("started_at", flat=True).first()
    )
    active = attempts.filter(status="in_progress", deadline__gt=now).first()
    eligible = next_attempt_at(inv.exam, last_started_at)
    if allowance['next_round_at']:
        eligible = max(eligible, allowance['next_round_at']) if eligible else allowance['next_round_at']
    return {
        "exam_id": inv.exam_id,
        "title": inv.exam.title,
        "description": inv.exam.description,
        "duration_minutes": inv.exam.duration_minutes,
        "retry_interval_minutes": inv.exam.retry_interval_minutes,
        "attempt_reset_minutes": inv.exam.attempt_reset_minutes,
        "next_round_at": allowance['next_round_at'],
        "round_awaiting_grading": allowance['round_awaiting_grading'],
        "allow_skip": inv.exam.allow_skip,
        "allow_response_review": inv.exam.allow_response_review,
        "next_attempt_at": eligible,
        "server_time": now,
        "active_attempt_id": str(active.pk) if active else None,
        "remaining": max(0, min(remaining, inv.max_attempts - inv.used)),
        "recipient": inv.identity.label,
        "expires_at": inv.expires_at,
    }


@never_cache
@csrf_protect
@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def guest_exam(request):
    if request.method == "GET" and request.session.get("guest_pending_invitation"):
        return Response(verification_info(pending_invite(request)))
    inv = session_invite(request)
    if request.method == "GET":
        return Response(guest_info(inv))
    return Response(public_attempt(start_attempt(inv.exam_id, inv.identity, inv)))


def accessible_attempt(request, attempt):
    if request.user.is_authenticated and attempt.identity.user_id == request.user.id:
        # Existing owned attempts and historical results retain their admission.
        # New starts/listing use in_exam_audience; invitation access stays separate.
        return
    inv = session_invite(request)
    if inv.identity_id != attempt.identity_id or inv.exam_id != attempt.exam_id:
        raise PermissionDenied()


@never_cache
@csrf_protect
@api_view(["GET", "PATCH", "POST"])
@permission_classes([AllowAny])
def attempt_detail(request, pk):
    with transaction.atomic():
        attempt = get_object_or_404(
            Attempt.objects.select_for_update(of=("self",)).select_related(
                "identity", "exam"
            ),
            pk=pk,
        )
        accessible_attempt(request, attempt)
        if attempt.status == "in_progress" and attempt.deadline <= timezone.now():
            finalize(attempt)
        if request.method != "GET" and attempt.status == "in_progress":
            revision = request.data.get("answer_revision")
            if attempt.reopen_count and revision is None:
                return Response(
                    {
                        "detail": translate(
                            "Reload this reopened attempt before continuing."
                        ),
                        "code": "answer_conflict",
                    },
                    status=409,
                )
            if revision is not None:
                if type(revision) is not int or revision < 0:
                    raise ValidationError(translate("Invalid answer revision."))
                if revision != attempt.answer_revision:
                    return Response(
                        {
                            "detail": translate(
                                "This attempt was updated in another window. Reload saved answers before continuing."
                            ),
                            "code": "answer_conflict",
                        },
                        status=409,
                    )
            record_answers(
                attempt,
                request.data.get("answers", attempt.answers),
                submitting=request.method == "POST",
            )
            if request.method == "POST":
                finalize(attempt)
        return Response(public_attempt(attempt))


def scoped_attempts(user):
    qs = Attempt.objects.select_related("exam", "identity", "identity__user").order_by(
        "-started_at"
    )
    if scope(user, 'results') == 'all':
        return qs
    return qs.filter(Q(identity__user=user) | scope_q(user, 'results', 'exam__'))


@never_cache
@api_view(["GET", "POST"])
def review(request, pk):
    with transaction.atomic():
        attempt = get_object_or_404(
            Attempt.objects.select_for_update(of=("self",)).select_related(
                "exam", "identity"
            ),
            pk=pk,
        )
        require_results(request.user, attempt.exam)
        if attempt.status not in ("pending_review", "graded"):
            raise ValidationError(translate("This attempt has not been submitted."))
        if request.method == "POST":
            grading_revision = request.data.get("grading_revision")
            if (attempt.grading_revision or grading_revision is not None) and (
                type(grading_revision) is not int
                or grading_revision != attempt.grading_revision
            ):
                return Response(
                    {
                        "detail": translate(
                            "The grades have changed. Reopen the review before saving."
                        ),
                        "code": "grading_conflict",
                    },
                    status=409,
                )
            revision = request.data.get("answer_revision")
            if (attempt.reopen_count or revision is not None) and (
                type(revision) is not int or revision != attempt.answer_revision
            ):
                return Response(
                    {
                        "detail": translate(
                            "This submission has changed. Reopen the review before grading."
                        )
                    },
                    status=409,
                )
            marks = request.data.get("grades", {})
            apply_manual_grades(attempt, marks)
            audit(request.user, "attempt.reviewed", attempt.id, {"grades": marks})
        return Response(
            {
                **public_attempt(attempt, for_review=True),
                "questions": attempt.snapshot,
                "person": attempt.identity.label,
            }
        )


@api_view(["GET"])
def dashboard(request):
    user = request.user
    try:
        days = min(365, max(1, int(request.query_params.get("days", "30"))))
    except ValueError:
        raise ValidationError(translate("Invalid date range."))
    since = timezone.now() - timedelta(days=days)
    # R-none users retain personal Overview scores; scoped_attempts excludes other people.
    attempts = scoped_attempts(user).filter(started_at__gte=since)
    # Admission requests are not learning activity. Retain prior learning evidence
    # after access removal, including completed assignments and dashboard totals.
    enrollments = Enrollment.objects.filter(Q(status="approved") | Q(progress__gt=0))
    people = User.objects.filter(is_active=True)
    courses = Course.objects.all()
    if scope(user, 'courses') != 'all':
        enrollments = enrollments.filter(Q(user=user) | scope_q(user, 'courses', 'course__'))
        courses = courses.filter(scope_q(user, 'courses')) if has_courses(user) else courses.filter(published=True)
    if not system_admin(user):
        people = people.filter(Q(pk=user.pk) | Q(pk__in=enrollments.values('user_id'))
                               | Q(pk__in=attempts.values('identity__user_id')))
    department = request.query_params.get("department")
    if department:
        attempts = attempts.filter(identity__user__department=department)
        enrollments = enrollments.filter(user__department=department)
        people = people.filter(department=department)
    graded = attempts.filter(status="graded")
    count = graded.count()
    completed = enrollments.filter(progress=100).count()
    total = enrollments.count()
    trend = list(
        graded.order_by()
        .annotate(day=TruncDate("submitted_at"))
        .values("day")
        .annotate(count=Count("id"), average=Avg("score"))
        .order_by("day")
    )
    depts = list(
        enrollments.order_by()
        .values("user__department")
        .annotate(total=Count("id"), completed=Count("id", filter=Q(progress=100)))
    )
    distribution = [
        graded.filter(score__gte=lo, score__lt=hi).count()
        for lo, hi in [(0, 60), (60, 70), (70, 80), (80, 90), (90, 101)]
    ]
    return Response(
        {
            "people": people.count(),
            "courses": courses.count(),
            "completion": round(completed / total * 100) if total else 0,
            "enrollments": total,
            "completed": completed,
            "pass_rate": round(graded.filter(passed=True).count() / count * 100)
            if count
            else 0,
            "average_score": round(
                graded.aggregate(value=Avg("score"))["value"] or 0, 1
            ),
            "graded_count": count,
            "pending": attempts.filter(status="pending_review").count(),
            "trend": trend,
            "departments": depts,
            "distribution": distribution,
            "employee_count": people.filter(employment="employee").count(),
            "contractor_count": people.filter(employment="contractor").count(),
            "days": days,
        }
    )


@api_view(["GET"])
def audit_log(request):
    if not system_admin(request.user):
        raise PermissionDenied()
    from .administration import activity_rows

    return Response(activity_rows())
