"""Manager-only evidence inspection and explicit, idempotent reopening."""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.cache import never_cache
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .i18n import translate
from .models import Attempt, AttemptReopening, Exam
from .monitoring import ExtensionInput, MonitorFilters, page_data
from .services import audit, check_invite, finalize_if_expired
from .views import manage_exam


class ReopeningInput(ExtensionInput):
    answer_revision = serializers.IntegerField(min_value=0)
    submitted_at = serializers.DateTimeField()


def evidence(attempt):
    """Only used for authorized staff; never send this through learner APIs."""
    return {
        "title": attempt.exam.title,
        "person": attempt.identity.label,
        "status": attempt.status,
        "questions": attempt.snapshot,
        "answers": attempt.answers,
        "answer_revision": attempt.answer_revision,
        "grading_revision": attempt.grading_revision,
        "manual_grades": attempt.manual_grades,
        "score": attempt.score,
        "passed": attempt.passed,
        "pass_score": attempt.pass_score,
        "submitted_at": attempt.submitted_at.isoformat()
        if attempt.submitted_at
        else None,
        "deadline": attempt.deadline.isoformat(),
        "last_saved_at": attempt.last_saved_at.isoformat()
        if attempt.last_saved_at
        else None,
        "unlocked_question_count": attempt.unlocked_question_count,
    }


def reopening_data(record):
    previous = record.previous_submission
    return {
        "id": str(record.id),
        "minutes": record.minutes,
        "reason": record.reason,
        "actor": record.actor.display_name or record.actor.username,
        "created_at": record.created_at,
        "new_deadline": record.new_deadline,
        "previous_status": previous["status"],
        "previous_score": previous["score"],
        "previous_submitted_at": previous["submitted_at"],
    }


@never_cache
@api_view(["GET"])
def inspect_attempt(request, pk):
    with transaction.atomic():
        attempt = get_object_or_404(
            Attempt.objects.select_for_update(of=("self",)).select_related(
                "exam", "identity"
            ),
            pk=pk,
        )
        manage_exam(request.user, attempt.exam)
        finalize_if_expired(attempt)
        return Response({**evidence(attempt), "observed_at": timezone.now()})


@never_cache
@api_view(["GET"])
def previous_submission(request, pk, record_id):
    attempt = get_object_or_404(Attempt.objects.select_related("exam"), pk=pk)
    manage_exam(request.user, attempt.exam)
    record = get_object_or_404(AttemptReopening, pk=record_id, attempt=attempt)
    return Response(record.previous_submission)


@never_cache
@api_view(["GET", "POST"])
def reopenings(request, pk):
    # Starts also lock the exam before any attempt. A new attempt and reopening
    # must never create two active papers for the same participant.
    with transaction.atomic():
        exam_id = get_object_or_404(Attempt.objects.only("exam_id"), pk=pk).exam_id
        exam = get_object_or_404(Exam.objects.select_for_update(), pk=exam_id)
        manage_exam(request.user, exam)
        attempt = get_object_or_404(
            Attempt.objects.select_for_update(of=("self",)).select_related(
                "exam", "identity", "invitation"
            ),
            pk=pk,
        )
        if request.method == "GET":
            filters = MonitorFilters(data=request.query_params)
            filters.is_valid(raise_exception=True)
            return Response(
                page_data(
                    AttemptReopening.objects.filter(attempt=attempt).select_related(
                        "actor"
                    ),
                    filters.validated_data,
                    reopening_data,
                )
            )
        serializer = ReopeningInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        existing = (
            AttemptReopening.objects.filter(pk=values["request_id"])
            .select_related("actor")
            .first()
        )
        conflict = translate(
            "This reopening request was already used with different details."
        )
        if existing:
            if (
                existing.attempt_id != attempt.pk
                or existing.actor_id != request.user.pk
                or existing.minutes != values["minutes"]
                or existing.reason != values["reason"]
                or existing.previous_submission["answer_revision"]
                != values["answer_revision"]
                or serializers.DateTimeField().to_internal_value(
                    existing.previous_submission["submitted_at"]
                )
                != values["submitted_at"]
            ):
                return Response({"detail": conflict}, status=409)
            return Response(reopening_data(existing))
        if (
            attempt.status not in ("pending_review", "graded")
            or attempt.answer_revision != values["answer_revision"]
            or attempt.submitted_at != values["submitted_at"]
        ):
            return Response(
                {
                    "detail": translate(
                        "This submission has changed. Refresh the monitor before reopening."
                    )
                },
                status=409,
            )
        if (
            Attempt.objects.filter(exam=exam, identity=attempt.identity)
            .exclude(pk=attempt.pk)
            .filter(Q(number__gt=attempt.number) | Q(status="in_progress"))
            .exists()
        ):
            return Response(
                {
                    "detail": translate(
                        "Only the latest attempt can be reopened, with no other active attempt."
                    )
                },
                status=409,
            )
        if not exam.published:
            raise PermissionDenied(
                translate("Publish this exam before reopening a submission.")
            )
        if attempt.identity.user_id and not attempt.identity.user.is_active:
            raise PermissionDenied(translate("This participant account is disabled."))
        if attempt.invitation_id:
            check_invite(attempt.invitation)
        if attempt.extra_time_minutes + values["minutes"] > 1440:
            return Response(
                {
                    "detail": translate(
                        "An attempt can receive at most 1,440 extra minutes in total."
                    )
                },
                status=400,
            )
        deadline = timezone.now() + timedelta(minutes=values["minutes"])
        try:
            with transaction.atomic():
                record = AttemptReopening.objects.create(
                    id=values["request_id"],
                    attempt=attempt,
                    actor=request.user,
                    minutes=values["minutes"],
                    reason=values["reason"],
                    previous_submission=evidence(attempt),
                    new_deadline=deadline,
                )
        except IntegrityError:
            return Response({"detail": conflict}, status=409)
        attempt.status = "in_progress"
        attempt.deadline = deadline
        attempt.extra_time_minutes += values["minutes"]
        attempt.reopen_count += 1
        attempt.answer_revision += 1
        attempt.grading_revision += 1
        attempt.score = attempt.passed = attempt.submitted_at = None
        attempt.manual_grades = {}
        attempt.last_seen_at = None
        attempt.save(
            update_fields=[
                "status",
                "deadline",
                "extra_time_minutes",
                "reopen_count",
                "answer_revision",
                "grading_revision",
                "score",
                "passed",
                "submitted_at",
                "manual_grades",
                "last_seen_at",
            ]
        )
        audit(
            request.user,
            "attempt.reopened",
            attempt.pk,
            {
                "request_id": str(record.pk),
                "minutes": record.minutes,
                "reason": record.reason,
                "previous_status": record.previous_submission["status"],
                "previous_score": record.previous_submission["score"],
                "previous_submitted_at": record.previous_submission["submitted_at"],
                "new_deadline": deadline.isoformat(),
            },
        )
        return Response(reopening_data(record), status=201)
