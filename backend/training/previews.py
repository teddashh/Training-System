"""Instructor trials use production question rules without participant records."""

from datetime import timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.cache import never_cache
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from .i18n import translate
from .models import Exam, ExamPreview
from .services import (
    apply_manual_grades,
    audit,
    grade,
    public_attempt,
    question_snapshot,
    record_answers,
)
from .views import manage_exam


def finish_preview(preview):
    if preview.status == "in_progress":
        grade(preview)
        preview.submitted_at = timezone.now()
        preview.save()
        audit(preview.owner, "preview.submitted", preview.id, {"exam": preview.exam_id})


def preview_response(preview, *, for_review=False):
    result = {
        **public_attempt(preview, for_review=for_review),
        "preview_mode": preview.mode,
        "preview_expires_at": preview.expires_at,
    }
    if for_review:
        result.update(
            questions=preview.snapshot,
            person=preview.owner.display_name or preview.owner.username,
        )
    return result


def own_preview(request, pk):
    preview = get_object_or_404(
        ExamPreview.objects.select_for_update(of=("self",)).select_related(
            "exam", "owner"
        ),
        pk=pk,
        owner=request.user,
        expires_at__gt=timezone.now(),
    )
    # Ownership changes or removal of instructor permissions revoke access.
    manage_exam(request.user, preview.exam)
    return preview


@never_cache
@api_view(["GET", "POST"])
def exam_previews(request, pk):
    with transaction.atomic():
        exam = get_object_or_404(Exam.objects.select_for_update(), pk=pk)
        manage_exam(request.user, exam)
        now = timezone.now()
        existing = ExamPreview.objects.filter(
            exam=exam, owner=request.user, expires_at__gt=now
        )
        if request.method == "GET":
            return Response(
                list(
                    existing.order_by("-started_at").values(
                        "id", "mode", "status", "started_at", "expires_at"
                    )
                )
            )
        mode = request.data.get("mode")
        if mode not in ("learner", "unrestricted"):
            raise ValidationError(
                translate("Choose learner simulation or untimed test.")
            )
        if mode == "learner" and (
            not exam.published
            or (exam.starts_at and now < exam.starts_at)
            or (exam.ends_at and now >= exam.ends_at)
        ):
            raise PermissionDenied(
                translate(
                    "Learner simulation requires an open, published exam. Use an untimed test for drafts or closed exams."
                )
            )
        if existing.count() >= 20:
            raise ValidationError(
                translate(
                    "You have 20 saved previews for this exam. Delete a preview before starting another."
                )
            )
        deadline = None
        if mode == "learner":
            deadline = now + timedelta(minutes=exam.duration_minutes)
            if exam.ends_at:
                deadline = min(deadline, exam.ends_at)
        preview = ExamPreview.objects.create(
            exam=exam,
            owner=request.user,
            mode=mode,
            snapshot=question_snapshot(exam),
            pass_score=exam.pass_score,
            allow_skip=exam.allow_skip,
            deadline=deadline,
            expires_at=now + timedelta(days=7),
        )
        audit(
            request.user, "preview.started", preview.id, {"exam": exam.id, "mode": mode}
        )
        return Response(preview_response(preview), status=201)


@never_cache
@api_view(["GET", "PATCH", "POST", "DELETE"])
def preview_detail(request, pk):
    with transaction.atomic():
        preview = own_preview(request, pk)
        if request.method == "DELETE":
            audit(
                request.user, "preview.deleted", preview.id, {"exam": preview.exam_id}
            )
            preview.delete()
            return Response(status=204)
        if preview.deadline and preview.deadline <= timezone.now():
            finish_preview(preview)
        if request.method != "GET" and preview.status == "in_progress":
            revision = request.data.get("answer_revision")
            # Preview writes always require a revision; trial tabs can race too.
            if type(revision) is not int or revision < 0:
                raise ValidationError(translate("Invalid answer revision."))
            if revision != preview.answer_revision:
                return Response(
                    {
                        "code": "answer_conflict",
                        "detail": translate(
                            "This attempt was updated in another window. Reload saved answers before continuing."
                        ),
                    },
                    status=409,
                )
            record_answers(
                preview,
                request.data.get("answers", preview.answers),
                submitting=request.method == "POST",
            )
            if request.method == "POST":
                finish_preview(preview)
        return Response(preview_response(preview))


@never_cache
@api_view(["GET", "POST"])
def preview_review(request, pk):
    with transaction.atomic():
        preview = own_preview(request, pk)
        if preview.deadline and preview.deadline <= timezone.now():
            finish_preview(preview)
        if preview.status not in ("pending_review", "graded"):
            raise ValidationError(translate("This attempt has not been submitted."))
        if request.method == "POST":
            apply_manual_grades(preview, request.data.get("grades", {}))
            audit(
                request.user, "preview.reviewed", preview.id, {"exam": preview.exam_id}
            )
        return Response(preview_response(preview, for_review=True))
