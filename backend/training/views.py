import secrets
from datetime import timedelta

from django.db import transaction
from django.db.models import Avg, Count, Prefetch, Q
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from rest_framework import viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response

from .i18n import translate
from .models import (
    Attempt,
    AttemptBudget,
    AuditEvent,
    Course,
    Enrollment,
    Exam,
    GuestEmailChallenge,
    Invitation,
    User,
)
from .serializers import (
    CourseSerializer,
    ExamSerializer,
    InvitationSerializer,
    UserSerializer,
)
from .services import (
    audit,
    check_invite,
    finalize,
    grade,
    hash_token,
    identity_for_user,
    in_exam_audience,
    invitation_from_token,
    public_attempt,
    resolve_identity,
    start_attempt,
    validate_answers,
)


def manager(user):
    return user.is_authenticated and user.role in ("admin", "instructor")


def manage_exam(user, exam):
    if not manager(user) or (user.role != "admin" and exam.owner_id != user.id):
        raise PermissionDenied(translate("You cannot manage this exam."))


class AdminOnly(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "admin"


class Users(viewsets.ModelViewSet):
    permission_classes = [AdminOnly]
    queryset = User.objects.all().order_by("id")
    serializer_class = UserSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    @transaction.atomic
    def perform_create(self, serializer):
        user = serializer.save()
        identity_for_user(user)
        audit(self.request.user, "user.created", user.id)

    @transaction.atomic
    def perform_update(self, serializer):
        user = serializer.instance
        if user.id == self.request.user.id and (
            serializer.validated_data.get("role", user.role) != "admin"
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
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = Course.objects.all().order_by("-created_at")
        if self.request.user.role == "admin":
            return qs
        if self.request.user.role == "instructor":
            return qs.filter(Q(published=True) | Q(owner=self.request.user))
        return qs.filter(published=True)

    def perform_create(self, serializer):
        if not manager(self.request.user):
            raise PermissionDenied()
        course = serializer.save(owner=self.request.user)
        audit(self.request.user, "course.created", course.id)

    def perform_update(self, serializer):
        if not manager(self.request.user) or (
            self.request.user.role != "admin"
            and serializer.instance.owner_id != self.request.user.id
        ):
            raise PermissionDenied()
        serializer.save()
        audit(self.request.user, "course.updated", serializer.instance.id)

    @action(detail=True, methods=["post"])
    def enroll(self, request, pk=None):
        course = self.get_object()
        enrollment, _ = Enrollment.objects.get_or_create(
            user=request.user, course=course
        )
        return Response({"progress": enrollment.progress})

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        course = self.get_object()
        if course.packages.exists() or not course.blocks:
            raise ValidationError(
                translate(
                    "SCORM completion must be reported by the player. Empty content cannot be completed."
                )
            )
        Enrollment.objects.update_or_create(
            user=request.user,
            course=course,
            defaults={"progress": 100, "completed_at": timezone.now()},
        )
        return Response({"progress": 100})


class Exams(viewsets.ModelViewSet):
    serializer_class = ExamSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = Exam.objects.prefetch_related(
            "allowed_users",
            Prefetch(
                "attemptbudget_set",
                queryset=AttemptBudget.objects.filter(identity__user=self.request.user),
                to_attr="user_budgets",
            ),
            Prefetch(
                "attempt_set",
                queryset=Attempt.objects.filter(
                    identity__user=self.request.user,
                    status="in_progress",
                    deadline__gt=timezone.now(),
                ),
                to_attr="active_user_attempts",
            ),
        ).order_by("-created_at")
        if self.request.user.role == "admin":
            return qs
        permitted = [
            exam.pk
            for exam in qs.filter(published=True)
            if in_exam_audience(exam, self.request.user)
        ]
        if self.request.user.role == "instructor":
            return qs.filter(Q(pk__in=permitted) | Q(owner=self.request.user))
        return qs.filter(pk__in=permitted)

    @action(detail=False, methods=["get"], url_path="audience-options")
    def audience_options(self, request):
        if not manager(request.user):
            raise PermissionDenied()
        people = list(
            User.objects.filter(is_active=True)
            .order_by("display_name", "id")
            .values("id", "display_name", "username", "department")
        )
        return Response(
            {
                "people": people,
                "departments": sorted(
                    {person["department"] for person in people if person["department"]}
                ),
            }
        )

    @transaction.atomic
    def perform_create(self, serializer):
        if not manager(self.request.user):
            raise PermissionDenied()
        exam = serializer.save(owner=self.request.user)
        audit(self.request.user, "exam.created", exam.id)

    @transaction.atomic
    def perform_update(self, serializer):
        exam = Exam.objects.select_for_update().get(pk=serializer.instance.pk)
        manage_exam(self.request.user, exam)
        serializer.save()
        audit(self.request.user, "exam.updated", exam.id)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        exam = self.get_object()
        return Response(
            public_attempt(start_attempt(exam.id, identity_for_user(request.user)))
        )

    @action(detail=True, methods=["post"])
    def budget(self, request, pk=None):
        exam = self.get_object()
        manage_exam(request.user, exam)
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
            if limit < budget.used:
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


class Invitations(viewsets.ReadOnlyModelViewSet):
    serializer_class = InvitationSerializer

    def get_queryset(self):
        if not manager(self.request.user):
            raise PermissionDenied()
        qs = Invitation.objects.select_related("exam", "identity").order_by(
            "-created_at"
        )
        return (
            qs
            if self.request.user.role == "admin"
            else qs.filter(exam__owner=self.request.user)
        )

    @action(detail=False, methods=["post"])
    def issue(self, request):
        exam = get_object_or_404(Exam, pk=request.data.get("exam"))
        manage_exam(request.user, exam)
        try:
            limit, days = (
                int(request.data.get("max_attempts", 1)),
                int(request.data.get("days", 7)),
            )
        except (TypeError, ValueError):
            raise ValidationError(
                translate("Attempts and validity days must be integers.")
            )
        if not 1 <= limit <= 100 or not 1 <= days <= 90:
            raise ValidationError(
                translate("Attempts must be 1–100 and validity must be 1–90 days.")
            )
        required = request.data.get("require_email_verification", False)
        if type(required) is not bool:
            raise ValidationError(
                translate("Email verification must be enabled or disabled.")
            )
        token = secrets.token_urlsafe(32)
        with transaction.atomic():
            Exam.objects.select_for_update().get(pk=exam.pk)
            identity = resolve_identity(request.data.get("key", ""))
            email = ""
            if required:
                from django.core.exceptions import ValidationError as InvalidEmail
                from django.core.validators import validate_email

                email = (
                    str(request.data.get("verification_email", "")).strip().casefold()
                )
                if not email:
                    email = (
                        identity.key.removeprefix("email:")
                        if identity.key.startswith("email:")
                        else (identity.user.email if identity.user else "")
                    )
                try:
                    validate_email(email)
                except InvalidEmail:
                    raise ValidationError(
                        translate(
                            "A valid recipient email is required for verification."
                        )
                    )
            inv = Invitation.objects.create(
                exam=exam,
                identity=identity,
                token_hash=hash_token(token),
                max_attempts=limit,
                expires_at=timezone.now() + timedelta(days=days),
                created_by=request.user,
                require_email_verification=required,
                verification_email=email,
            )
            audit(request.user, "invitation.created", inv.id, {"exam": exam.id})
        from django.conf import settings

        return Response(
            {
                **self.get_serializer(inv).data,
                "url": settings.APP_ORIGIN + "/invite#" + token,
                "note": translate(
                    "This link is also subject to the participant's total attempt limit."
                ),
            },
            status=201,
        )

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        inv = self.get_object()
        inv.revoked = True
        inv.save(update_fields=["revoked"])
        audit(request.user, "invitation.revoked", inv.id)
        return Response({"ok": True})


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
        request.session["guest_pending_invitation"] = str(inv.id)
        return Response(verification_info(inv))
    request.session["guest_invitation"] = str(inv.id)
    return Response(guest_info(inv))


def verification_info(inv):
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
            translate("Evitina Learn exam verification"),
            translate("Your verification code: ")
            + code
            + "\n"
            + translate("Valid for 10 minutes."),
            settings.DEFAULT_FROM_EMAIL,
            [inv.verification_email],
        )
    except Exception:
        challenge.delete()
        request.session.pop("guest_challenge", None)
        return Response(
            {
                "detail": translate(
                    "Email delivery failed. Please try again or contact the organizer."
                )
            },
            status=503,
        )
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
    remaining = (
        (budget.limit_override or inv.exam.max_attempts) - budget.used
        if budget
        else inv.exam.max_attempts
    )
    # The secret link identifies one pre-bound recipient; typing another email
    # never creates a new identity or budget. The link itself is a credential.
    return {
        "exam_id": inv.exam_id,
        "title": inv.exam.title,
        "description": inv.exam.description,
        "duration_minutes": inv.exam.duration_minutes,
        "remaining": max(0, min(remaining, inv.max_attempts - inv.used)),
        "recipient": inv.identity.label,
        "expires_at": inv.expires_at,
    }


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
        return
    inv = session_invite(request)
    if inv.identity_id != attempt.identity_id or inv.exam_id != attempt.exam_id:
        raise PermissionDenied()


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
            attempt.answers = validate_answers(
                request.data.get("answers", attempt.answers), attempt.snapshot
            )
            attempt.answer_revision += 1
            attempt.save(update_fields=["answers", "answer_revision"])
            if request.method == "POST":
                finalize(attempt)
        return Response(public_attempt(attempt))


def scoped_attempts(user):
    qs = Attempt.objects.select_related("exam", "identity", "identity__user").order_by(
        "-started_at"
    )
    if user.role == "admin":
        return qs
    if user.role == "instructor":
        return qs.filter(exam__owner=user)
    return qs.filter(identity__user=user)


@api_view(["GET", "POST"])
def review(request, pk):
    with transaction.atomic():
        attempt = get_object_or_404(
            Attempt.objects.select_for_update().select_related("exam", "identity"),
            pk=pk,
        )
        manage_exam(request.user, attempt.exam)
        if attempt.status not in ("pending_review", "graded"):
            raise ValidationError(translate("This attempt has not been submitted."))
        if request.method == "POST":
            marks = request.data.get("grades", {})
            if not isinstance(marks, dict):
                raise ValidationError(translate("Invalid grading format."))
            essay = {str(q["id"]): q for q in attempt.snapshot if q["type"] == "essay"}
            for key, mark in marks.items():
                if (
                    key not in essay
                    or not isinstance(mark, dict)
                    or type(mark.get("points")) not in (int, float)
                    or not 0 <= mark["points"] <= essay[key]["points"]
                    or len(str(mark.get("feedback", ""))) > 5000
                ):
                    raise ValidationError(
                        translate(
                            "The written-response score exceeds its points or the question does not exist."
                        )
                    )
            attempt.manual_grades.update(marks)
            grade(attempt)
            attempt.save()
            audit(request.user, "attempt.reviewed", attempt.id, {"grades": marks})
        return Response(
            {
                **public_attempt(attempt),
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
    attempts = scoped_attempts(user).filter(started_at__gte=since)
    enrollments = Enrollment.objects.all()
    people = User.objects.filter(is_active=True)
    courses = Course.objects.all()
    if user.role == "learner":
        enrollments = enrollments.filter(user=user)
        people = people.filter(pk=user.pk)
        courses = courses.filter(published=True)
    elif user.role == "instructor":
        enrollments = enrollments.filter(course__owner=user)
        people = people.filter(enrollment__course__owner=user).distinct()
        courses = courses.filter(owner=user)
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
    if request.user.role != "admin":
        raise PermissionDenied()
    return Response(
        list(
            AuditEvent.objects.order_by("-created_at").values(
                "id", "actor__display_name", "action", "target", "detail", "created_at"
            )[:200]
        )
    )
