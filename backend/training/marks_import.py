"""Bounded, reviewed and atomic score/comment imports for submitted papers."""

import copy
import csv
import hashlib
import io
import json
import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.cache import never_cache
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from .i18n import translate
from .models import Attempt, Exam, MarksImport
from .monitoring import MonitorFilters, page_data
from .reporting import safe_csv
from .services import audit, grade, question_points
from .access import require_results

MAX_BYTES = 256 * 1024
MAX_ROWS = 500
MAX_ATTEMPTS = 100
COLUMNS = [
    "attempt_id",
    "identity",
    "attempt_number",
    "question_id",
    "question",
    "maximum_points",
    "current_points",
    "current_feedback",
    "answer_revision",
    "grading_revision",
    "points",
    "feedback",
    "clear_feedback",
]
REQUIRED = {
    "attempt_id",
    "question_id",
    "answer_revision",
    "grading_revision",
    "points",
    "feedback",
}


class PreviewInput(serializers.Serializer):
    csv = serializers.CharField(max_length=MAX_BYTES, trim_whitespace=False)
    reason = serializers.CharField(max_length=500, allow_blank=False)


def result(attempt):
    return {
        "status": attempt.status,
        "score": attempt.score if attempt.status == "graded" else None,
        "passed": attempt.passed,
    }


def fingerprint(attempt):
    # Include the actual evidence as well as revisions, guarding imported/legacy
    # records and any future writer that fails to advance a revision.
    state = {
        "answer_revision": attempt.answer_revision,
        "grading_revision": attempt.grading_revision,
        "status": attempt.status,
        "submitted_at": str(attempt.submitted_at),
        "answers": attempt.answers,
        "snapshot": attempt.snapshot,
        "manual_grades": attempt.manual_grades,
        "pass_score": attempt.pass_score,
        "score": attempt.score,
        "passed": attempt.passed,
    }
    return hashlib.sha256(
        json.dumps(state, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def import_data(record, *, detail=False, user=None):
    status = record.status
    if status == "preview" and record.expires_at <= timezone.now():
        status = "expired"
    data = {
        "id": str(record.pk),
        "actor": record.actor.display_name or record.actor.username,
        "reason": record.reason,
        "status": status,
        "created_at": record.created_at,
        "expires_at": record.expires_at,
        "applied_at": record.applied_at,
        "row_count": len(record.plan["changes"]),
        "attempt_count": len(record.plan["attempts"]),
        "skipped": record.plan["skipped"],
        "can_apply": status == "preview"
        and user is not None
        and record.actor_id == user.pk,
    }
    if detail:
        data.update(changes=record.plan["changes"], outcomes=record.plan["outcomes"])
    return data


def parse_rows(text):
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise ValidationError(translate("Marks CSV must be UTF-8 and at most 256 KiB."))
    if "\x00" in text:
        raise ValidationError(translate("Marks CSV contains an invalid character."))
    reader = csv.reader(io.StringIO(text.lstrip("\ufeff"), newline=""), strict=True)
    try:
        headers = [h.strip() for h in next(reader)]
        if (
            len(headers) != len(set(headers))
            or not REQUIRED.issubset(headers)
            or set(headers) - set(COLUMNS)
        ):
            raise ValidationError(
                translate(
                    "Use the marks template headers without duplicates or unknown columns."
                )
            )
        rows, skipped, previous_line = [], 0, reader.line_num
        count = 0
        for cells in reader:
            line, previous_line = previous_line + 1, reader.line_num
            if not cells or all(not cell.strip() for cell in cells):
                continue
            count += 1
            if count > MAX_ROWS:
                raise ValidationError(
                    translate(
                        "A marks import can contain at most 500 rows and 100 attempts."
                    )
                )
            if len(cells) != len(headers):
                raise ValidationError(
                    translate(
                        "CSV line {line} has the wrong number of columns.", line=line
                    )
                )
            row = dict(zip(headers, cells))
            clear = row.get("clear_feedback", "").strip().casefold()
            if clear not in ("", "false", "true"):
                raise ValidationError(
                    translate(
                        "CSV line {line}: clear_feedback must be true, false or blank.",
                        line=line,
                    )
                )
            if not row["points"].strip() and not row["feedback"] and clear != "true":
                skipped += 1
                continue
            row.update(line=line, clear_feedback=clear == "true")
            rows.append(row)
    except (StopIteration, csv.Error) as exc:
        raise ValidationError(
            translate("The marks CSV is empty or malformed.")
        ) from exc
    if not rows:
        raise ValidationError(
            translate(
                "No mark or feedback changes were provided. Fill the editable template columns."
            )
        )
    return rows, skipped


def build_plan(exam, rows, skipped):
    errors, parsed, seen = [], [], set()

    def fail(row, message):
        errors.append({"line": row["line"], "message": translate(message)})

    for row in rows:
        try:
            attempt_id = uuid.UUID(row["attempt_id"].strip())
            integers = [
                row[name].strip()
                for name in ("question_id", "answer_revision", "grading_revision")
            ]
            if any(
                not v.isascii() or not v.isdecimal() or len(v) > 12 for v in integers
            ):
                raise ValueError
            question_id, answer_revision, grading_revision = map(int, integers)
            key = (attempt_id, question_id)
            if key in seen:
                fail(row, "Duplicate attempt/question row. No marks were changed.")
                continue
            seen.add(key)
            parsed.append(
                (row, attempt_id, question_id, answer_revision, grading_revision)
            )
        except (ValueError, AttributeError):
            fail(row, "Invalid attempt ID, question ID or revision.")
    ids = {item[1] for item in parsed}
    if len(ids) > MAX_ATTEMPTS:
        raise ValidationError(
            translate("A marks import can contain at most 500 rows and 100 attempts.")
        )
    attempts = {
        a.pk: a
        for a in Attempt.objects.select_for_update(of=("self",))
        .select_related("identity")
        .filter(exam=exam, pk__in=ids)
        .order_by("pk")
    }
    updates, changes = {}, []
    for row, attempt_id, qid, answer_revision, grading_revision in parsed:
        attempt = attempts.get(attempt_id)
        if not attempt or attempt.status not in ("pending_review", "graded"):
            fail(row, "This is not a submitted participant attempt in this exam.")
            continue
        if (
            attempt.answer_revision != answer_revision
            or attempt.grading_revision != grading_revision
        ):
            fail(row, "This attempt has changed. Download a new marks template.")
            continue
        question = next((q for q in attempt.snapshot if q["id"] == qid), None)
        if not question:
            fail(row, "The question is not in this attempt’s frozen paper.")
            continue
        if len(row["feedback"]) > 5000 or (row["clear_feedback"] and row["feedback"]):
            fail(
                row,
                "Feedback must be at most 5,000 characters; do not provide text when clearing it.",
            )
            continue
        key = str(qid)
        before = attempt.manual_grades.get(key, {})
        points = before.get("points")
        if row["points"].strip():
            try:
                raw = row["points"].strip()
                if len(raw) > 64:
                    raise ValueError
                value = Decimal(raw)
                if (
                    not value.is_finite()
                    or not 0 <= value <= question["points"]
                    or value.as_tuple().exponent < -6
                ):
                    raise ValueError
                points = float(value)
            except (InvalidOperation, ValueError):
                fail(
                    row,
                    "Points must be a finite number within the frozen question maximum, with at most six decimal places.",
                )
                continue
        feedback = (
            ""
            if row["clear_feedback"]
            else row["feedback"] or before.get("feedback", "")
        )
        mark = {"points": points, "feedback": feedback, "source": "csv"}
        updates.setdefault(attempt_id, {})[key] = mark
        changes.append(
            {
                "line": row["line"],
                "attempt_id": str(attempt_id),
                "person": attempt.identity.label,
                "number": attempt.number,
                "question_id": qid,
                "question": question["description"],
                "maximum_points": question["points"],
                "before_points": question_points(
                    question, attempt.answers.get(key), before or None
                ),
                "after_points": question_points(
                    question, attempt.answers.get(key), mark
                ),
                "before_feedback": before.get("feedback", ""),
                "after_feedback": feedback,
                "before_review": before or None,
                "after_review": mark,
            }
        )
    if errors:
        return None, errors
    plans, outcomes = [], []
    for attempt_id, marks in updates.items():
        attempt = attempts[attempt_id]
        proposed = copy.copy(attempt)
        proposed.manual_grades = {**attempt.manual_grades, **marks}
        grade(proposed)
        plans.append(
            {"id": str(attempt_id), "fingerprint": fingerprint(attempt), "marks": marks}
        )
        outcomes.append(
            {
                "attempt_id": str(attempt_id),
                "person": attempt.identity.label,
                "number": attempt.number,
                "before": result(attempt),
                "after": result(proposed),
            }
        )
    return {
        "attempts": plans,
        "changes": changes,
        "outcomes": outcomes,
        "skipped": skipped,
    }, []


@never_cache
@api_view(["GET"])
def marks_template(request, pk):
    exam = get_object_or_404(Exam, pk=pk)
    require_results(request.user, exam)
    filters = MonitorFilters(data=request.query_params)
    filters.is_valid(raise_exception=True)
    values = filters.validated_data
    qs = Attempt.objects.filter(exam=exam, status__in=["pending_review", "graded"])
    if values.get("number"):
        qs = qs.filter(number=values["number"])
    if values["status"]:
        qs = qs.filter(status=values["status"])
    if values["search"]:
        term = values["search"]
        qs = qs.filter(
            Q(identity__label__icontains=term)
            | Q(identity__key__icontains=term)
            | Q(identity__user__employee_id__icontains=term)
            | Q(identity__user__department__icontains=term)
        )
    attempts = list(
        qs.select_related("identity").order_by("started_at", "pk")[: MAX_ATTEMPTS + 1]
    )
    if not attempts:
        raise ValidationError(
            translate("No submitted attempts match these template filters.")
        )
    if (
        len(attempts) > MAX_ATTEMPTS
        or sum(len(a.snapshot) for a in attempts) > MAX_ROWS
    ):
        raise ValidationError(
            translate(
                "Narrow the template filters to at most 500 question rows and 100 attempts."
            )
        )
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    # Stable machine-readable headers; descriptive UI text is localized.
    writer.writerow(COLUMNS)
    for attempt in attempts:
        for q in attempt.snapshot:
            key = str(q["id"])
            mark = attempt.manual_grades.get(key)
            writer.writerow(
                [
                    safe_csv(v)
                    for v in [
                        attempt.pk,
                        attempt.identity.label,
                        attempt.number,
                        q["id"],
                        q["description"],
                        q["points"],
                        question_points(q, attempt.answers.get(key), mark),
                        (mark or {}).get("feedback", ""),
                        attempt.answer_revision,
                        attempt.grading_revision,
                        "",
                        "",
                        "",
                    ]
                ]
            )
    content = "\ufeff" + output.getvalue()
    if len(content.encode("utf-8")) > MAX_BYTES:
        raise ValidationError(
            translate("Narrow the template filters to keep the CSV within 256 KiB.")
        )
    response = HttpResponse(content, content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="exam-{exam.pk}-marks.csv"'
    return response


@never_cache
@api_view(["GET", "POST"])
def marks_imports(request, pk):
    with transaction.atomic():
        exam = get_object_or_404(Exam.objects.select_for_update(), pk=pk)
        require_results(request.user, exam)
        if request.method == "GET":
            filters = MonitorFilters(data=request.query_params)
            filters.is_valid(raise_exception=True)
            return Response(
                page_data(
                    MarksImport.objects.filter(exam=exam).select_related("actor"),
                    filters.validated_data,
                    lambda row: import_data(row, user=request.user),
                )
            )
        serializer = PreviewInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        rows, skipped = parse_rows(values["csv"])
        plan, errors = build_plan(exam, rows, skipped)
        if errors:
            return Response({"valid": False, "errors": errors, "count": len(rows)})
        now = timezone.now()
        if (
            MarksImport.objects.filter(
                exam=exam, actor=request.user, status="preview", expires_at__gt=now
            ).count()
            >= 20
        ):
            raise ValidationError(
                translate(
                    "You have 20 pending previews for this exam. Apply one or wait for previews to expire."
                )
            )
        record = MarksImport.objects.create(
            exam=exam,
            actor=request.user,
            reason=values["reason"],
            plan=plan,
            expires_at=now + timedelta(minutes=30),
        )
        return Response(
            {"valid": True, **import_data(record, detail=True, user=request.user)},
            status=201,
        )


@never_cache
@api_view(["GET", "POST"])
def marks_import_detail(request, pk, import_id):
    with transaction.atomic():
        exam = get_object_or_404(Exam.objects.select_for_update(), pk=pk)
        require_results(request.user, exam)
        record = get_object_or_404(
            MarksImport.objects.select_for_update(of=("self",)).select_related("actor"),
            pk=import_id,
            exam=exam,
        )
        if request.method == "GET":
            return Response(import_data(record, detail=True, user=request.user))
        if record.actor_id != request.user.pk:
            raise PermissionDenied(
                translate("Only the manager who created this preview can apply it.")
            )
        if request.data:
            raise ValidationError(
                translate("Apply the saved preview without changing its contents.")
            )
        if record.status == "applied":
            return Response(import_data(record, detail=True, user=request.user))
        if record.status != "preview" or record.expires_at <= timezone.now():
            return Response(
                {
                    "detail": translate(
                        "This marks preview is stale or expired. Create a new preview."
                    ),
                    "code": "stale_marks_preview",
                },
                status=409,
            )
        planned = {uuid.UUID(row["id"]): row for row in record.plan["attempts"]}
        attempts = list(
            Attempt.objects.select_for_update()
            .filter(exam=exam, pk__in=planned)
            .order_by("pk")
        )
        if record.expires_at <= timezone.now():
            return Response(
                {
                    "detail": translate(
                        "This marks preview is stale or expired. Create a new preview."
                    ),
                    "code": "stale_marks_preview",
                },
                status=409,
            )
        if len(attempts) != len(planned) or any(
            a.status not in ("pending_review", "graded")
            or fingerprint(a) != planned[a.pk]["fingerprint"]
            for a in attempts
        ):
            record.status = "stale"
            record.save(update_fields=["status"])
            return Response(
                {
                    "detail": translate(
                        "An attempt changed after preview. No marks were applied. Create a new preview."
                    ),
                    "code": "stale_marks_preview",
                },
                status=409,
            )
        for attempt in attempts:
            before = result(attempt)
            attempt.manual_grades.update(planned[attempt.pk]["marks"])
            attempt.grading_revision += 1
            grade(attempt)
            attempt.save(
                update_fields=[
                    "manual_grades",
                    "grading_revision",
                    "status",
                    "score",
                    "passed",
                ]
            )
            audit(
                request.user,
                "attempt.marks_imported",
                attempt.pk,
                {
                    "import_id": str(record.pk),
                    "before": before,
                    "after": result(attempt),
                },
            )
        record.status = "applied"
        record.applied_at = timezone.now()
        record.save(update_fields=["status", "applied_at"])
        audit(
            request.user,
            "marks.import_applied",
            record.pk,
            {
                "exam_id": exam.pk,
                "reason": record.reason,
                "rows": len(record.plan["changes"]),
                "attempts": len(attempts),
            },
        )
        return Response(import_data(record, detail=True, user=request.user))
