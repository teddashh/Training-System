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

    Preserve MCQ/MCC correct-option semantics from Yaksh's AnswerPaper.
    Other legacy evaluators are explicitly rejected instead of silently
    changing integer, float-tolerance, case-sensitive, or code grading.
    """
    kind = data.get("type")
    if kind not in ("mcq", "mcc"):
        raise ValueError(
            f"Unsupported Yaksh type: {kind}. Only mcq/mcc are migrated automatically."
        )
    points = float(data.get("points", 1))
    if not points.is_integer():
        raise ValueError(
            "Fractional Yaksh points require an explicit grading migration."
        )
    cases = data.get("testcase", [])
    result = {
        "description": unescape(
            strip_tags(data.get("description") or data.get("summary", ""))
        ),
        "type": "single" if kind == "mcq" else "multiple",
        "points": int(points),
        "options": [unescape(strip_tags(c["options"])) for c in cases],
        "solution": [i for i, c in enumerate(cases) if c.get("correct") is True],
    }
    serializer = QuestionSerializer(data=result)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


class Command(BaseCommand):
    help = "Import Yaksh MCQ/MCC JSON export records into a draft independent exam (atomic)."

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
