import csv
import io
import secrets
from datetime import timedelta
from django.db import transaction
from django.db.models import Avg, Count, Q
from django.db.models.functions import TruncDate
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from rest_framework import viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import BasePermission, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, ValidationError
from .models import (
    User,
    Course,
    Enrollment,
    Exam,
    Attempt,
    AttemptBudget,
    Invitation,
    AuditEvent,
)
from .serializers import (
    UserSerializer,
    CourseSerializer,
    ExamSerializer,
    InvitationSerializer,
)
from .services import (
    audit,
    resolve_identity,
    identity_for_user,
    hash_token,
    invitation_from_token,
    check_invite,
    start_attempt,
    finalize,
    grade,
    validate_answers,
    public_attempt,
)


def manager(user):
    return user.is_authenticated and user.role in ("admin", "instructor")


def manage_exam(user, exam):
    if not manager(user) or (user.role != "admin" and exam.owner_id != user.id):
        raise PermissionDenied("您無權管理此考試。")


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
            raise ValidationError("不能停用自己或移除自己的管理員權限。")
        serializer.save()
        audit(self.request.user, "user.updated", user.id)


class Courses(viewsets.ModelViewSet):
    serializer_class = CourseSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = Course.objects.all().order_by("-created_at")
        if self.request.user.role == "admin":
            return qs
        return qs.filter(Q(published=True) | Q(owner=self.request.user))

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
            raise ValidationError("SCORM 請由播放器回報完成；空白教材無法完成。")
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
        qs = Exam.objects.all().order_by("-created_at")
        if self.request.user.role == "admin":
            return qs
        return qs.filter(Q(published=True) | Q(owner=self.request.user))

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
            raise ValidationError("請輸入有效次數。")
        if not 1 <= limit <= 100:
            raise ValidationError("次數需介於 1 至 100。")
        with transaction.atomic():
            Exam.objects.select_for_update().get(pk=exam.pk)
            identity = resolve_identity(request.data.get("key", ""))
            budget, _ = AttemptBudget.objects.get_or_create(
                exam=exam, identity=identity
            )
            if limit < budget.used:
                raise ValidationError("次數上限不能低於已使用次數。")
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
            raise ValidationError("次數與有效天數必須是整數。")
        if not 1 <= limit <= 100 or not 1 <= days <= 90:
            raise ValidationError("次數需為 1–100；有效天數需為 1–90。")
        token = secrets.token_urlsafe(32)
        with transaction.atomic():
            Exam.objects.select_for_update().get(pk=exam.pk)
            identity = resolve_identity(request.data.get("key", ""))
            inv = Invitation.objects.create(
                exam=exam,
                identity=identity,
                token_hash=hash_token(token),
                max_attempts=limit,
                expires_at=timezone.now() + timedelta(days=days),
                created_by=request.user,
            )
            audit(request.user, "invitation.created", inv.id, {"exam": exam.id})
        from django.conf import settings

        return Response(
            {
                **self.get_serializer(inv).data,
                "url": settings.APP_ORIGIN + "/invite#" + token,
                "note": "此連結額度仍受受測者總次數上限約束。",
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
    return inv


@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def guest_exchange(request):
    inv = invitation_from_token(request.data.get("token", ""))
    request.session.cycle_key()
    request.session["guest_invitation"] = str(inv.id)
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
            Attempt.objects.select_for_update().select_related("identity", "exam"),
            pk=pk,
        )
        accessible_attempt(request, attempt)
        if attempt.status == "in_progress" and attempt.deadline <= timezone.now():
            finalize(attempt)
        if request.method != "GET" and attempt.status == "in_progress":
            attempt.answers = validate_answers(
                request.data.get("answers", attempt.answers), attempt.snapshot
            )
            attempt.save(update_fields=["answers"])
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


@api_view(["GET"])
def results(request):
    # Expired attempts are finalized on reads, as well as by expire_attempts cron.
    qs = scoped_attempts(request.user)
    for row in qs.filter(status="in_progress", deadline__lte=timezone.now()):
        with transaction.atomic():
            finalize(Attempt.objects.select_for_update().get(pk=row.pk))
    return Response(
        [
            {
                "id": str(a.id),
                "exam": a.exam.title,
                "exam_id": a.exam_id,
                "person": a.identity.label,
                "department": a.identity.user.department
                if a.identity.user
                else "外部人員",
                "number": a.number,
                "status": a.status,
                "score": a.score if a.status == "graded" else None,
                "passed": a.passed,
                "submitted_at": a.submitted_at,
            }
            for a in qs[:1000]
        ]
    )


@api_view(["GET", "POST"])
def review(request, pk):
    with transaction.atomic():
        attempt = get_object_or_404(
            Attempt.objects.select_for_update().select_related("exam", "identity"),
            pk=pk,
        )
        manage_exam(request.user, attempt.exam)
        if attempt.status not in ("pending_review", "graded"):
            raise ValidationError("作答尚未交卷。")
        if request.method == "POST":
            marks = request.data.get("grades", {})
            if not isinstance(marks, dict):
                raise ValidationError("評分格式不正確。")
            essay = {str(q["id"]): q for q in attempt.snapshot if q["type"] == "essay"}
            for key, mark in marks.items():
                if (
                    key not in essay
                    or not isinstance(mark, dict)
                    or type(mark.get("points")) not in (int, float)
                    or not 0 <= mark["points"] <= essay[key]["points"]
                    or len(str(mark.get("feedback", ""))) > 5000
                ):
                    raise ValidationError("申論題分數超出配分或題目不存在。")
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
        raise ValidationError("日期範圍無效。")
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
def export_results(request):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["考試", "受測者", "次數", "狀態", "分數", "及格", "交卷時間"])

    def safe(value):
        s = str(value) if value is not None else ""
        return "'" + s if s.startswith(("=", "+", "-", "@", "\t", "\r")) else s

    for a in scoped_attempts(request.user):
        writer.writerow(
            [
                safe(v)
                for v in [
                    a.exam.title,
                    a.identity.label,
                    a.number,
                    a.status,
                    a.score if a.status == "graded" else None,
                    a.passed,
                    a.submitted_at,
                ]
            ]
        )
    response = HttpResponse(
        "\ufeff" + output.getvalue(), content_type="text/csv; charset=utf-8"
    )
    response["Content-Disposition"] = 'attachment; filename="training-results.csv"'
    return response


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
