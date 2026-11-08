import json
from html import unescape
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.html import strip_tags
from training.models import User, Exam, Question
from training.serializers import QuestionSerializer
from training.services import audit


def convert_question(data):
    """Adapt Yaksh Question.dump_questions JSON-equivalent records.

    Preserve choice, string, integer and per-answer absolute-tolerance semantics.
    Arrange records require explicit correct_order indexes because Yaksh's
    export omits testcase IDs and does not guarantee their database ordering.
    """
    kind = data.get("type")
    kinds = {
        "mcq": "single",
        "mcc": "multiple",
        "integer": "integer",
        "float": "numeric",
        "arrange": "ordering",
        "string": "short",
    }
    if kind not in kinds:
        raise ValueError(
            f"Unsupported Yaksh type: {kind}. Supported types: mcq, mcc, string, integer, float, arrange."
        )
    points = float(data.get("points", 1))
    if not points.is_integer():
        raise ValueError(
            "Fractional Yaksh points require an explicit grading migration."
        )
    cases = data.get("testcase", [])
    if (
        not isinstance(cases, list)
        or not cases
        or any(not isinstance(case, dict) for case in cases)
    ):
        raise ValueError("Provide a non-empty testcase list.")
    result = {
        "description": unescape(
            strip_tags(data.get("description") or data.get("summary", ""))
        ),
        "type": kinds[kind],
        "points": int(points),
        "options": [],
        "solution": [],
    }
    if kind in ("mcq", "mcc", "arrange"):
        result["options"] = [unescape(strip_tags(c["options"])) for c in cases]
        if kind == "arrange":
            if "correct_order" not in data:
                raise ValueError(
                    "Arrange questions require reviewed correct_order indexes; the original export omits reliable ordering metadata."
                )
            result["solution"] = data["correct_order"]
        else:
            result["solution"] = [
                i for i, c in enumerate(cases) if c.get("correct") is True
            ]
    elif kind == "string":
        # Answers are plain text: preserve capitalization, spaces and line breaks.
        # Missing/unknown source modes require review rather than guessed grading.
        if any(case.get("string_check") not in ("lower", "exact") for case in cases):
            raise ValueError(
                "String testcases require an explicit lower or exact string_check."
            )
        result["solution"] = [case["correct"] for case in cases]
        result["answer_matching"] = [case["string_check"] for case in cases]
    else:
        result["solution"] = [str(c["correct"]) for c in cases]
        if kind == "float":
            result["answer_tolerances"] = [
                str(c.get("error_margin") or 0) for c in cases
            ]
    serializer = QuestionSerializer(data=result)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


class Command(BaseCommand):
    help = "Import reviewed Yaksh choice, string, integer, float and arrange JSON records into a draft exam (atomic)."

    def add_arguments(self, parser):
        parser.add_argument("file")
        parser.add_argument("--owner", required=True)
        parser.add_argument("--title", required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        owner = User.objects.filter(
            username=options["owner"], role__in=["admin", "instructor"]
        ).first()
        if not owner:
            raise CommandError(
                "Owner must be an existing instructor or admin username."
            )
        file = Path(options["file"])
        if file.stat().st_size > 2 * 1024 * 1024:
            raise CommandError("Import exceeds 2 MB.")
        try:
            records = json.loads(file.read_text())
            if not isinstance(records, list) or not 1 <= len(records) <= 200:
                raise ValueError("Expected 1–200 questions.")
            questions = [convert_question(row) for row in records]
        except Exception as exc:
            raise CommandError(f"Import rejected without writing data: {exc}")
        exam = Exam.objects.create(title=options["title"], owner=owner, published=False)
        for index, question in enumerate(questions):
            Question.objects.create(exam=exam, position=index, **question)
        audit(owner, "yaksh.imported", exam.id, {"questions": len(questions)})
        self.stdout.write(
            f"Imported {len(questions)} questions into draft exam {exam.id}."
        )
