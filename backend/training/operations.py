"""Company training operations: assignments, reusable questions and onboarding."""

import csv
import io

from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from .i18n import translate
from .models import (
    Attempt,
    BankQuestion,
    Course,
    Enrollment,
    Exam,
    LearningAssignment,
    User,
)
from .serializers import BankQuestionSerializer, UserSerializer
from .services import audit, identity_for_user
from .access import AdminOnly, has_exams, can_assign, scope_q


class QuestionBank(viewsets.ModelViewSet):
    serializer_class = BankQuestionSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        if not has_exams(self.request.user):
            raise PermissionDenied()
        qs = BankQuestion.objects.select_related("figure").defer("figure__data").order_by("-updated_at", "-id")
        return qs.filter(scope_q(self.request.user, 'exams'))

    def perform_create(self, serializer):
        if not has_exams(self.request.user):
            raise PermissionDenied()
        question = serializer.save(owner=self.request.user)
        audit(self.request.user, "question_bank.created", question.pk)

    def perform_update(self, serializer):
        question = serializer.save()
        audit(self.request.user, "question_bank.updated", question.pk)


def assignment_scope(user, report=False):
    qs = LearningAssignment.objects.select_related("user", "course", "exam").order_by(
        "due_at", "id"
    )
    if not report:
        return qs.filter(user=user, cancelled_at=None)
    if not can_assign(user):
        raise PermissionDenied()
    return qs.filter(scope_q(user, 'courses', 'course__') | (
        scope_q(user, 'exams', 'exam__') & scope_q(user, 'results', 'exam__')))


def assignment_rows(queryset):
    assignments = list(queryset)
    users = {a.user_id for a in assignments}
    courses = {a.course_id for a in assignments if a.course_id}
    exams = {a.exam_id for a in assignments if a.exam_id}
    enrollments = {
        (e.user_id, e.course_id): e
        for e in Enrollment.objects.filter(user_id__in=users, course_id__in=courses)
    }
    attempts = {}
    for attempt in (
        Attempt.objects.filter(identity__user_id__in=users, exam_id__in=exams)
        .select_related("identity")
        .order_by("started_at")
    ):
        attempts.setdefault((attempt.identity.user_id, attempt.exam_id), []).append(
            attempt
        )
    now = timezone.now()
    rows = []
    for item in assignments:
        target = item.course or item.exam
        progress_known = True
        progress, completed_at, score, status = 0, None, None, "not_started"
        if item.course_id:
            enrollment = enrollments.get((item.user_id, item.course_id))
            if enrollment:
                progress_known = enrollment.progress_known
                progress, completed_at = enrollment.progress, enrollment.completed_at
                status = (
                    "completed" if progress == 100 else {
                        "approved": "in_progress",
                        "pending": "awaiting_approval",
                        "rejected": "enrollment_rejected",
                        "removed": "enrollment_removed",
                        "cancelled": "registration_cancelled",
                    }[enrollment.status]
                )
        else:
            history = attempts.get((item.user_id, item.exam_id), [])
            passed = [a for a in history if a.status == "graded" and a.passed]
            graded = [
                a.score for a in history if a.status == "graded" and a.score is not None
            ]
            score = max(graded) if graded else None
            if passed:
                status, progress, completed_at = (
                    "completed",
                    100,
                    passed[0].submitted_at,
                )
            elif history:
                status = (
                    "pending_review"
                    if any(a.status == "pending_review" for a in history)
                    else "in_progress"
                )
        overdue = bool(
            item.due_at
            and item.due_at < now
            and status != "completed"
            and not item.cancelled_at
        )
        if item.cancelled_at:
            status = "cancelled"
        rows.append(
            {
                "id": item.id,
                "user_id": item.user_id,
                "person": item.user.display_name or item.user.username,
                "username": item.user.username,
                "department": item.user.department,
                "employment": item.user.employment,
                "active": item.user.is_active,
                "kind": "course" if item.course_id else "exam",
                "target_id": target.pk,
                "title": target.title,
                "available": (target.published and (not item.course_id or not target.release_at or target.release_at <= now)),
                "due_at": item.due_at,
                "assigned_at": item.assigned_at,
                "notes": item.notes,
                "status": status,
                "overdue": overdue,
                "progress": progress,
                "progress_known": progress_known,
                "score": score,
                "completed_at": completed_at,
            }
        )
    return rows


class AssignmentInput(serializers.Serializer):
    notify = serializers.BooleanField(default=True)
    kind = serializers.ChoiceField(choices=["course", "exam"])
    target_id = serializers.IntegerField(min_value=1)
    audience = serializers.ChoiceField(
        choices=["people", "groups", "departments", "employees", "contractors", "all"]
    )
    people = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, max_length=500
    )
    groups = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False, max_length=1000)
    departments = serializers.ListField(
        child=serializers.CharField(max_length=100), required=False, max_length=100
    )
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True)


class Assignments(viewsets.ViewSet):
    lookup_value_regex = r"\d+"

    def list(self, request):
        report = request.query_params.get("report") == "1"
        return Response(assignment_rows(assignment_scope(request.user, report)))

    @transaction.atomic
    def create(self, request):
        if not can_assign(request.user):
            raise PermissionDenied()
        serializer = AssignmentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        model = Course if data["kind"] == "course" else Exam
        target = get_object_or_404(
            model.objects.select_for_update(), pk=data["target_id"]
        )
        if not can_assign(request.user, target):
            raise PermissionDenied()
        if not target.published:
            raise ValidationError(
                translate("Publish the course or exam before assigning it.")
            )
        people = User.objects.filter(is_active=True)
        audience = data["audience"]
        if audience == "people":
            ids = set(data.get("people", []))
            people = people.filter(pk__in=ids)
            if not ids or people.count() != len(ids):
                raise ValidationError(translate("Select active participants."))
        elif audience == "groups":
            from .groups import lock_groups, active_group_people
            ids = data.get('groups', [])
            lock_groups(ids)
            people = active_group_people(ids).select_for_update()
        elif audience == "departments":
            people = people.filter(department__in=data.get("departments", []))
        elif audience in ("employees", "contractors"):
            people = people.filter(
                employment="employee" if audience == "employees" else "contractor"
            )
        recipients = list(people.order_by("id")[:501])
        if not 1 <= len(recipients) <= 500:
            raise ValidationError(
                translate("Assign between 1 and 500 active participants at a time.")
            )
        # The target lock serializes assignment/cancellation events. One bulk read,
        # not another query for every person, captures the prior activation state.
        cancelled = dict(LearningAssignment.objects.filter(
            user__in=recipients, **{data["kind"]: target}, cancelled_at__isnull=False,
        ).values_list("user_id", "cancelled_at"))
        queued, no_email = 0, 0
        from .notifications import enqueue
        for user in recipients:
            assignment, created = LearningAssignment.objects.update_or_create(
                user=user,
                **{data["kind"]: target},
                defaults={
                    "created_by": request.user,
                    "due_at": data.get("due_at"),
                    "notes": data.get("notes", ""),
                    "cancelled_at": None,
                },
            )
            audit(
                request.user,
                "assignment.saved",
                assignment.pk,
                {"user": user.pk, "due_at": str(assignment.due_at or "")},
            )
            if created or user.pk in cancelled:
                activation = cancelled[user.pk].isoformat() if user.pk in cancelled else "created"
                no_email += not bool(user.email.strip())
                if data["notify"]:
                    queued += enqueue(
                        kind="assignment", user=user, target=target, actor=request.user,
                        event="New training assigned", due_at=assignment.due_at,
                        note=assignment.notes, dedupe_key=f"assignment:{assignment.pk}:{activation}",
                        context={"assignment_id": assignment.pk, data["kind"] + "_id": target.pk},
                    )
        return Response({"assigned": len(recipients), "emails_queued": queued,
                         "people_without_email": no_email}, status=201)

    @action(detail=False, methods=['post'], url_path='group-preview')
    @transaction.atomic
    def group_preview(self, request):
        if not can_assign(request.user):
            raise PermissionDenied()
        from .groups import lock_groups, active_group_people
        class PreviewInput(serializers.Serializer):
            groups = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1, max_length=1000)
        serializer = PreviewInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data['groups']
        lock_groups(ids)
        count = active_group_people(ids).count()
        return Response({'people': count, 'within_limit': 1 <= count <= 500})

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def cancel(self, request, pk=None):
        item = get_object_or_404(assignment_scope(request.user, report=True), pk=pk)
        target_model = Course if item.course_id else Exam
        target_model.objects.select_for_update().get(pk=item.course_id or item.exam_id)
        item = LearningAssignment.objects.select_for_update().get(pk=item.pk)
        if not item.cancelled_at:
            item.cancelled_at = timezone.now()
            item.save(update_fields=["cancelled_at"])
            audit(request.user, "assignment.cancelled", item.pk)
        return Response({"cancelled": True})

    @action(detail=False, methods=["get"])
    def export(self, request):
        rows = assignment_rows(assignment_scope(request.user, report=True))
        output = io.StringIO()
        writer = csv.writer(output)
        columns = [
            "person",
            "username",
            "department",
            "employment",
            "kind",
            "title",
            "status",
            "overdue",
            "progress",
            "progress_known",
            "score",
            "assigned_at",
            "due_at",
            "completed_at",
        ]
        writer.writerow(columns)
        for row in rows:
            values = [str(row[col]) if row[col] is not None else "" for col in columns]
            writer.writerow(
                [
                    "'" + value
                    if value.startswith(("=", "+", "-", "@", "\t", "\r"))
                    else value
                    for value in values
                ]
            )
        response = HttpResponse(
            "\ufeff" + output.getvalue(), content_type="text/csv; charset=utf-8"
        )
        response["Content-Disposition"] = (
            'attachment; filename="training-completion.csv"'
        )
        return response


class PeopleImportInput(serializers.Serializer):
    csv = serializers.CharField(max_length=1_000_000, trim_whitespace=False)
    apply = serializers.BooleanField(default=False)


@api_view(["POST"])
@permission_classes([AdminOnly])
def import_people(request):
    payload = PeopleImportInput(data=request.data)
    payload.is_valid(raise_exception=True)
    data = payload.validated_data
    reader = csv.DictReader(io.StringIO(data["csv"].lstrip("\ufeff")), strict=True)
    allowed = {
        "username",
        "email",
        "employee_id",
        "display_name",
        "department",
        "employment",
    }
    try:
        headers = reader.fieldnames
    except csv.Error:
        raise ValidationError(translate("The CSV file is malformed."))
    if (
        not headers
        or "username" not in headers
        or len(set(headers)) != len(headers)
        or set(headers) - allowed
    ):
        raise ValidationError(
            translate(
                "CSV needs a username column and only the supported participant columns."
            )
        )
    try:
        rows = []
        for row in reader:
            rows.append(row)
            if len(rows) > 500:
                break
    except csv.Error:
        raise ValidationError(translate("The CSV file is malformed."))
    if not 1 <= len(rows) <= 500:
        raise ValidationError(
            translate("Import between 1 and 500 participants at a time.")
        )
    errors = []
    with transaction.atomic():
        for index, row in enumerate(rows, start=2):
            if None in row or any(v is None for v in row.values()):
                errors.append(
                    {
                        "row": index,
                        "message": translate(
                            "The number of CSV values does not match the header."
                        ),
                    }
                )
                continue
            values = {k: v.strip() for k, v in row.items()}
            values["employee_id"] = values.get("employee_id") or None
            values["employment"] = values.get("employment") or "employee"
            serializer = UserSerializer(data={**values, "role": "learner"})
            try:
                with transaction.atomic():
                    serializer.is_valid(raise_exception=True)
                    user = serializer.save()
                    identity_for_user(user)
                    if data["apply"]:
                        audit(request.user, "user.imported", user.pk)
            except ValidationError as exc:
                errors.append({"row": index, "message": exc.detail})
            except IntegrityError:
                errors.append(
                    {
                        "row": index,
                        "message": translate(
                            "This sign-in identifier is already in use."
                        ),
                    }
                )
        if errors or not data["apply"]:
            transaction.set_rollback(True)
    return Response(
        {
            "valid": not errors,
            "count": len(rows),
            "applied": data["apply"] and not errors,
            "errors": errors,
        }
    )


class PasswordInput(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False, write_only=True)
    new_password = serializers.CharField(
        trim_whitespace=False, write_only=True, max_length=128
    )


@api_view(["POST"])
def change_password(request):
    from .auth_views import rate_limit

    rate_limit(request, "password-change:" + str(request.user.pk))
    serializer = PasswordInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    if not request.user.check_password(data["current_password"]):
        raise ValidationError(translate("The current password is incorrect."))
    try:
        validate_password(data["new_password"], request.user)
    except DjangoValidationError as exc:
        raise ValidationError({"new_password": exc.messages})
    request.user.set_password(data["new_password"])
    request.user.save(update_fields=["password"])
    update_session_auth_hash(request, request.user)
    audit(request.user, "user.password_changed", request.user.pk)
    return Response({"changed": True})


@api_view(["GET"])
@permission_classes([AdminOnly])
def readiness(request):
    from .readiness import deployment_readiness

    return Response(deployment_readiness())
