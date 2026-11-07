"""Scoped assessment reporting, with shared filters for pages and exports."""

import csv
import hashlib
import io
import json
from datetime import timedelta

from django.db import transaction
from django.db.models import Avg, Count, Q
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .i18n import translate
from .models import Attempt, Exam
from .services import finalize, question_points
from .views import manage_exam, scoped_attempts


class ReportFilters(serializers.Serializer):
    exam = serializers.IntegerField(min_value=1, required=False)
    status = serializers.ChoiceField(
        choices=["", "in_progress", "pending_review", "graded"], default=""
    )
    outcome = serializers.ChoiceField(choices=["", "passed", "not_passed"], default="")
    search = serializers.CharField(max_length=200, allow_blank=True, default="")
    department = serializers.CharField(max_length=100, allow_blank=True, default="")
    days = serializers.ChoiceField(
        choices=["all", "7", "30", "90", "365"], default="all"
    )
    page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=25)


def filtered_attempts(request, exam=None):
    filters = ReportFilters(data=request.query_params)
    filters.is_valid(raise_exception=True)
    values = filters.validated_data
    qs = scoped_attempts(request.user).order_by("-started_at", "-pk")
    if exam is not None:
        qs = qs.filter(exam=exam)
    elif values.get("exam"):
        qs = qs.filter(exam_id=values["exam"])
    if values["search"]:
        term = values["search"]
        qs = qs.filter(
            Q(exam__title__icontains=term)
            | Q(identity__label__icontains=term)
            | Q(identity__key__icontains=term)
            | Q(identity__user__display_name__icontains=term)
            | Q(identity__user__department__icontains=term)
        )
    if values["department"]:
        qs = qs.filter(identity__user__department=values["department"])
    # Finalize before applying status/outcome/date filters: a just-expired attempt
    # must appear in the same filtered page and CSV without waiting for cron.
    for pk in (
        qs.filter(status="in_progress", deadline__lte=timezone.now())
        .values_list("pk", flat=True)
        .iterator()
    ):
        with transaction.atomic():
            finalize(
                Attempt.objects.select_for_update()
                .select_related("identity", "exam")
                .get(pk=pk)
            )
    if values["days"] != "all":
        qs = qs.annotate(report_time=Coalesce("submitted_at", "started_at")).filter(
            report_time__gte=timezone.now() - timedelta(days=int(values["days"]))
        )
    if values["status"]:
        qs = qs.filter(status=values["status"])
    if values["outcome"]:
        qs = qs.filter(status="graded", passed=values["outcome"] == "passed")
    return qs, values


def summary(qs):
    data = qs.aggregate(
        total=Count("id"),
        graded=Count("id", filter=Q(status="graded")),
        pending=Count("id", filter=Q(status="pending_review")),
        in_progress=Count("id", filter=Q(status="in_progress")),
        passed=Count("id", filter=Q(status="graded", passed=True)),
        average_score=Avg("score", filter=Q(status="graded")),
        participants=Count("identity", distinct=True),
    )
    data["average_score"] = (
        round(data["average_score"], 1) if data["average_score"] is not None else None
    )
    data["pass_rate"] = (
        round(100 * data["passed"] / data["graded"], 1) if data["graded"] else None
    )
    return data


def result_row(attempt):
    return {
        "id": str(attempt.pk),
        "exam": attempt.exam.title,
        "exam_id": attempt.exam_id,
        "person": attempt.identity.label,
        "department": attempt.identity.user.department
        if attempt.identity.user
        else translate("External participant"),
        "number": attempt.number,
        "status": attempt.status,
        "score": attempt.score if attempt.status == "graded" else None,
        "passed": attempt.passed,
        "submitted_at": attempt.submitted_at,
    }


@api_view(["GET"])
def results(request):
    qs, values = filtered_attempts(request)
    if "page" not in request.query_params:
        # Preserve the v1.0 array contract for existing API consumers.
        return Response([result_row(a) for a in qs[:1000]])
    stats = summary(qs)
    pages = max(1, (stats["total"] + values["page_size"] - 1) // values["page_size"])
    page = min(values["page"], pages)
    offset = (page - 1) * values["page_size"]
    return Response(
        {
            "results": [
                result_row(a) for a in qs[offset : offset + values["page_size"]]
            ],
            "count": stats["total"],
            "page": page,
            "pages": pages,
            "page_size": values["page_size"],
            "summary": stats,
        }
    )


def safe_csv(value):
    text = str(value) if value is not None else ""
    return "'" + text if text.startswith(("=", "+", "-", "@", "\t", "\r")) else text


def csv_response(columns, rows, filename):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([translate(col) for col in columns])
    for row in rows:
        writer.writerow([safe_csv(value) for value in row])
    response = HttpResponse(
        "\ufeff" + output.getvalue(), content_type="text/csv; charset=utf-8"
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@api_view(["GET"])
def export_results(request):
    qs, _ = filtered_attempts(request)
    return csv_response(
        [
            "Exam",
            "Participant",
            "Attempts",
            "Status",
            "Score",
            "Passed",
            "Submitted at",
            "Department",
        ],
        (
            [
                a.exam.title,
                a.identity.label,
                a.number,
                a.status,
                a.score if a.status == "graded" else None,
                a.passed,
                a.submitted_at,
                a.identity.user.department
                if a.identity.user
                else translate("External participant"),
            ]
            for a in qs.iterator(chunk_size=500)
        ),
        "training-results.csv",
    )


def question_variant(question):
    """Normalize shuffled choices without mixing distinct saved question versions."""
    shape = {key: question[key] for key in ("id", "description", "type", "points")}
    if question["type"] in ("single", "multiple"):
        shape["options"] = sorted(
            (text, index in question["solution"])
            for index, text in enumerate(question["options"])
        )
    else:
        shape["solution"] = sorted(str(value) for value in question["solution"])
    return hashlib.sha256(
        json.dumps(shape, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()[:24]


def question_analysis(qs):
    variants = {}
    for attempt in (
        qs.filter(status="graded")
        .only("snapshot", "answers", "manual_grades")
        .select_related(None)
        .iterator(chunk_size=200)
    ):
        for question in attempt.snapshot:
            key = question_variant(question)
            row = variants.setdefault(
                key,
                {
                    "variant": key,
                    "question_id": question["id"],
                    "description": question["description"],
                    "type": question["type"],
                    "points": question["points"],
                    "responses": 0,
                    "answered": 0,
                    "full_credit": 0,
                    "earned": 0,
                },
            )
            answer = attempt.answers.get(str(question["id"]))
            earned = question_points(
                question, answer, attempt.manual_grades.get(str(question["id"]))
            )
            if earned is None:
                continue
            row["responses"] += 1
            if (
                answer is not None
                and answer != []
                and (not isinstance(answer, str) or answer.strip())
            ):
                row["answered"] += 1
            row["earned"] += earned
            row["full_credit"] += earned == question["points"]
    result = []
    for row in variants.values():
        if not row["responses"]:
            continue
        row["average_points"] = round(row.pop("earned") / row["responses"], 2)
        row["full_credit_rate"] = round(100 * row["full_credit"] / row["responses"], 1)
        row["answer_rate"] = round(100 * row["answered"] / row["responses"], 1)
        result.append(row)
    return sorted(
        result,
        key=lambda row: (row["full_credit_rate"], row["description"], row["variant"]),
    )


@api_view(["GET"])
def exam_insights(request, pk):
    exam = get_object_or_404(Exam, pk=pk)
    manage_exam(request.user, exam)
    qs, _ = filtered_attempts(request, exam)
    questions = question_analysis(qs)
    if request.query_params.get("export") == "csv":
        return csv_response(
            [
                "Question version",
                "Question",
                "Question type",
                "Points",
                "Graded responses",
                "Answered",
                "Full-credit responses",
                "Full-credit rate (%)",
                "Average points",
            ],
            (
                [
                    q["variant"],
                    q["description"],
                    q["type"],
                    q["points"],
                    q["responses"],
                    q["answered"],
                    q["full_credit"],
                    q["full_credit_rate"],
                    q["average_points"],
                ]
                for q in questions
            ),
            "exam-question-analysis.csv",
        )
    distribution = [
        {
            "band": f"{low}–<{high}" if high <= 100 else "90–100",
            "count": qs.filter(status="graded", score__gte=low, score__lt=high).count(),
        }
        for low, high in [(0, 60), (60, 70), (70, 80), (80, 90), (90, 101)]
    ]
    departments = list(
        qs.values("identity__user__department")
        .annotate(
            attempts=Count("id"),
            graded=Count("id", filter=Q(status="graded")),
            passed=Count("id", filter=Q(status="graded", passed=True)),
            average=Avg("score", filter=Q(status="graded")),
        )
        .order_by("identity__user__department")
    )
    return Response(
        {
            "exam": {"id": exam.pk, "title": exam.title},
            "summary": summary(qs),
            "distribution": distribution,
            "questions": questions,
            "departments": [
                {
                    "department": row["identity__user__department"],
                    "attempts": row["attempts"],
                    "graded": row["graded"],
                    "passed": row["passed"],
                    "average": round(row["average"], 1)
                    if row["average"] is not None
                    else None,
                }
                for row in departments
            ],
        }
    )
