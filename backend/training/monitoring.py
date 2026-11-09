"""Progress signals and auditable, idempotent extensions for real attempts."""

from datetime import timedelta

from django.core.paginator import Paginator
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .i18n import translate
from .models import Attempt, AttemptTimeExtension, Exam
from .services import answer_provided, audit, finalize_if_expired
from .views import accessible_attempt, manage_exam


class MonitorFilters(serializers.Serializer):
    search = serializers.CharField(
        max_length=200, required=False, default="", allow_blank=True
    )
    status = serializers.ChoiceField(
        choices=["", "in_progress", "pending_review", "graded"], default=""
    )
    number = serializers.IntegerField(min_value=1, required=False)
    page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=25)


class ExtensionInput(serializers.Serializer):
    request_id = serializers.UUIDField()
    minutes = serializers.IntegerField(min_value=1, max_value=240)
    reason = serializers.CharField(max_length=500, allow_blank=False)


def page_data(queryset, values, render):
    paginator = Paginator(queryset, values["page_size"])
    page = paginator.get_page(values["page"])
    return {
        "results": [render(row) for row in page],
        "count": paginator.count,
        "page": page.number,
        "pages": paginator.num_pages,
        "page_size": paginator.per_page,
    }


def extension_data(extension):
    return {
        "id": str(extension.id),
        "minutes": extension.minutes,
        "reason": extension.reason,
        "actor": extension.actor.display_name or extension.actor.username,
        "created_at": extension.created_at,
        "previous_deadline": extension.previous_deadline,
        "new_deadline": extension.new_deadline,
    }


@never_cache
@api_view(["GET"])
def exam_monitor(request, pk):
    exam = get_object_or_404(Exam, pk=pk)
    manage_exam(request.user, exam)
    filters = MonitorFilters(data=request.query_params)
    filters.is_valid(raise_exception=True)
    values = filters.validated_data
    qs = Attempt.objects.filter(exam=exam)
    if values.get("number"):
        qs = qs.filter(number=values["number"])
    if values["search"]:
        term = values["search"]
        qs = qs.filter(
            Q(identity__label__icontains=term)
            | Q(identity__key__icontains=term)
            | Q(identity__user__display_name__icontains=term)
            | Q(identity__user__employee_id__icontains=term)
            | Q(identity__user__department__icontains=term)
        )
    for attempt_id in (
        qs.filter(status="in_progress", deadline__lte=timezone.now())
        .values_list("pk", flat=True)
        .iterator()
    ):
        with transaction.atomic():
            finalize_if_expired(Attempt.objects.select_for_update().get(pk=attempt_id))
    now = timezone.now()
    recent = now - timedelta(seconds=60)
    counts = qs.aggregate(
        total=Count("pk"),
        in_progress=Count("pk", filter=Q(status="in_progress")),
        pending_review=Count("pk", filter=Q(status="pending_review")),
        graded=Count("pk", filter=Q(status="graded")),
        recent=Count("pk", filter=Q(status="in_progress", last_seen_at__gte=recent)),
    )
    if values["status"]:
        qs = qs.filter(status=values["status"])

    def render(attempt):
        user = attempt.identity.user
        return {
            "id": str(attempt.id),
            "person": (user.display_name if user else "") or attempt.identity.label,
            "key": attempt.identity.key,
            "department": user.department if user else "",
            "number": attempt.number,
            "status": attempt.status,
            "started_at": attempt.started_at,
            "submitted_at": attempt.submitted_at,
            "deadline": attempt.deadline,
            "extra_time_minutes": attempt.extra_time_minutes,
            "last_seen_at": attempt.last_seen_at,
            "last_saved_at": attempt.last_saved_at,
            "recent": bool(attempt.last_seen_at and attempt.last_seen_at >= recent),
            "answered": sum(
                answer_provided(attempt.answers.get(str(q["id"])))
                for q in attempt.snapshot
            ),
            "question_count": len(attempt.snapshot),
        }

    return Response(
        {
            "exam": {"id": exam.id, "title": exam.title},
            "summary": counts,
            "server_time": now,
            **page_data(
                qs.select_related("identity__user").order_by("-started_at", "-id"),
                values,
                render,
            ),
        }
    )


@never_cache
@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def heartbeat(request, pk):
    with transaction.atomic():
        attempt = get_object_or_404(
            Attempt.objects.select_for_update(of=("self",)).select_related(
                "exam", "identity"
            ),
            pk=pk,
        )
        accessible_attempt(request, attempt)
        finalize_if_expired(attempt)
        if attempt.status == "in_progress":
            attempt.last_seen_at = timezone.now()
            attempt.save(update_fields=["last_seen_at"])
        return Response(
            {
                "status": attempt.status,
                "deadline": attempt.deadline,
                "extra_time_minutes": attempt.extra_time_minutes,
                "server_time": timezone.now(),
            }
        )


@never_cache
@api_view(["GET", "POST"])
def time_extensions(request, pk):
    with transaction.atomic():
        attempt = get_object_or_404(
            Attempt.objects.select_for_update(of=("self",)).select_related("exam"),
            pk=pk,
        )
        manage_exam(request.user, attempt.exam)
        if request.method == "GET":
            filters = MonitorFilters(data=request.query_params)
            filters.is_valid(raise_exception=True)
            return Response(
                page_data(
                    AttemptTimeExtension.objects.filter(attempt=attempt).select_related(
                        "actor"
                    ),
                    filters.validated_data,
                    extension_data,
                )
            )
        serializer = ExtensionInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        existing = AttemptTimeExtension.objects.filter(pk=values["request_id"]).first()
        if existing:
            if (
                existing.attempt_id != attempt.id
                or existing.actor_id != request.user.id
                or existing.minutes != values["minutes"]
                or existing.reason != values["reason"]
            ):
                return Response(
                    {
                        "detail": translate(
                            "This extension request was already used with different details."
                        )
                    },
                    status=409,
                )
            return Response(extension_data(existing))
        if attempt.status != "in_progress" or attempt.deadline <= timezone.now():
            return Response(
                {
                    "detail": translate(
                        "Only an active, unexpired attempt can receive extra time."
                    )
                },
                status=409,
            )
        if attempt.extra_time_minutes + values["minutes"] > 1440:
            return Response(
                {
                    "detail": translate(
                        "An attempt can receive at most 1,440 extra minutes in total."
                    )
                },
                status=400,
            )
        old_deadline = attempt.deadline
        new_deadline = old_deadline + timedelta(minutes=values["minutes"])
        try:
            # A different attempt could race with the same global request ID.
            # Roll back only this insert and never apply an unrecorded extension.
            with transaction.atomic():
                extension = AttemptTimeExtension.objects.create(
                    id=values["request_id"],
                    attempt=attempt,
                    actor=request.user,
                    minutes=values["minutes"],
                    reason=values["reason"],
                    previous_deadline=old_deadline,
                    new_deadline=new_deadline,
                )
        except IntegrityError:
            return Response(
                {
                    "detail": translate(
                        "This extension request was already used with different details."
                    )
                },
                status=409,
            )
        attempt.deadline = new_deadline
        attempt.extra_time_minutes += values["minutes"]
        attempt.save(update_fields=["deadline", "extra_time_minutes"])
        audit(
            request.user,
            "attempt.time_extended",
            attempt.id,
            {
                "request_id": str(extension.id),
                "minutes": extension.minutes,
                "reason": extension.reason,
                "previous_deadline": old_deadline.isoformat(),
                "new_deadline": new_deadline.isoformat(),
            },
        )
        return Response(extension_data(extension), status=201)
