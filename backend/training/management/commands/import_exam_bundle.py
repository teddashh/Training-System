"""Create a draft exam atomically from a portable, self-contained JSON bundle."""

from training.access import has_exams
import base64
import binascii
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import ValidationError

from training.figures import MAX_INPUT, process_figure
from training.models import Exam, User
from training.serializers import ExamSerializer, QuestionSerializer
from training.services import audit

EXAM_FIELDS = {
    "title", "description", "duration_minutes", "max_attempts", "retry_interval_minutes",
    "attempt_reset_minutes", "allow_skip", "allow_response_review", "pass_score", "audience",
    "shuffle_questions", "shuffle_options", "questions_per_attempt",
}


class Command(BaseCommand):
    help = "Import an exam-bundle/1 JSON file (or - for standard input) as an unpublished exam."

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--owner", required=True)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        try:
            if options["path"] == "-":
                bundle = json.load(sys.stdin)
            else:
                with Path(options["path"]).open(encoding="utf-8") as source:
                    bundle = json.load(source)
        except (OSError, ValueError):
            raise CommandError("Cannot read a valid JSON bundle.") from None
        if not isinstance(bundle, dict) or bundle.get("format") != "exam-bundle/1":
            raise CommandError("Expected exam-bundle/1.")
        if set(bundle) - {"format", "exam", "figures", "questions"}:
            raise CommandError("Unknown bundle fields.")
        exam_data = bundle.get("exam")
        if not isinstance(exam_data, dict) or set(exam_data) - EXAM_FIELDS:
            raise CommandError("Unknown or invalid exam fields; publication cannot be imported.")
        if exam_data.get("audience") in ("departments", "people", "groups"):
            raise CommandError("This audience requires lists and cannot be imported.")
        title = exam_data.get("title")
        if not isinstance(title, str) or not title.strip():
            raise CommandError("An exam title is required.")
        try:
            title = ExamSerializer().fields["title"].run_validation(title)
        except ValidationError:
            raise CommandError("Invalid exam title.") from None
        owners = User.objects.filter(Q(email__iexact=options["owner"]) | Q(username=options["owner"]),
                                     is_active=True)
        if owners.count() != 1:
            raise CommandError("Owner must identify exactly one active exam author.")
        owner = owners.get()
        if not has_exams(owner):
            raise CommandError("Owner must have exam authoring access.")
        with transaction.atomic():
            # Serialize imports for this owner, including the create-only title check.
            User.objects.select_for_update().get(pk=owner.pk)
            if Exam.objects.filter(title=title).exists():
                self.stdout.write("An exam with this title already exists. Nothing was changed.")
                return
            figures = bundle.get("figures", {})
            questions = bundle.get("questions")
            if not isinstance(figures, dict) or not isinstance(questions, list) or not 1 <= len(questions) <= 200:
                raise CommandError("Provide a figure map and 1–200 questions.")
            mapped = {}
            for name, entry in figures.items():
                if not isinstance(entry, dict) or set(entry) != {"data"} or not isinstance(entry["data"], str):
                    raise CommandError("Invalid figure entry.")
                if len(entry["data"]) > 4 * ((MAX_INPUT + 2) // 3):
                    raise CommandError("Figure exceeds the 5 MiB input limit.")
                try:
                    raw = base64.b64decode(entry["data"], validate=True)
                    mapped[name] = process_figure(raw, created_by=owner)
                except (ValueError, binascii.Error, ValidationError):
                    raise CommandError("Invalid figure; use a static PNG, JPEG or WebP within the figure limits.") from None
            context = {"request": SimpleNamespace(user=owner)}
            question_fields = set(QuestionSerializer().fields)
            prepared = []
            for index, question in enumerate(questions):
                if not isinstance(question, dict) or set(question) - question_fields:
                    raise CommandError(f"Question {index + 1} has unknown or invalid fields.")
                question = dict(question)
                name = question.get("figure")
                if name is not None:
                    if not isinstance(name, str) or name not in mapped:
                        raise CommandError(f"Question {index + 1} references an unknown figure.")
                    question["figure"] = mapped[name].key
                question["position"] = index
                serializer = QuestionSerializer(data=question, context=context)
                if not serializer.is_valid():
                    raise CommandError(f"Question {index + 1} failed validation (fields: {', '.join(serializer.errors)}).")
                prepared.append(question)
            serializer = ExamSerializer(data={**exam_data, "questions": prepared}, context=context)
            if not serializer.is_valid():
                raise CommandError(f"Exam failed validation (fields: {', '.join(serializer.errors)}).")
            exam = serializer.save(owner=owner, published=False, courses=[])
            audit(owner, "exam.import", exam.pk, {"source": "bundle", "questions": len(prepared)})
            self.stdout.write(
                f"Exam id: {exam.pk}; questions: {len(prepared)}; "
                f"total points: {sum(q.points for q in exam.questions.all())}; "
                f"figures: {len({f.pk for f in mapped.values()})}"
            )
            if options["dry_run"]:
                transaction.set_rollback(True)
                self.stdout.write("Dry run: validation passed. Nothing was written; exam id is provisional.")
