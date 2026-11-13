"""Compatibility with writers from before question figures were introduced."""
from django.db import connection
from django.test import TestCase
from django.utils import timezone

from .models import BankQuestion, Exam, Question, User


class QuestionFigureRollbackTests(TestCase):
    def test_legacy_sql_inserts_omit_feature_columns_and_receive_empty_defaults(self):
        owner = User.objects.create_user("rollback-owner", role="instructor")
        exam = Exam.objects.create(owner=owner, title="Synthetic rollback assessment")
        now = connection.ops.adapt_datetimefield_value(timezone.now())
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO "training_question" '
                '("exam_id", "description", "type", "options", "solution", '
                '"answer_tolerances", "answer_matching", "points", "position") '
                'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)',
                [exam.pk, "Legacy question insert", "essay", "[]", "[]", "[]", "[]", 10, 0],
            )
            cursor.execute(
                'INSERT INTO "training_bankquestion" '
                '("owner_id", "category", "description", "type", "options", "solution", '
                '"answer_tolerances", "answer_matching", "points", "archived", "created_at", "updated_at") '
                'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                [owner.pk, "Synthetic", "Legacy bank insert", "essay", "[]", "[]", "[]", "[]", 10, False, now, now],
            )
        for model in (Question, BankQuestion):
            with self.subTest(model=model.__name__):
                row = model.objects.get()
                self.assertIsNone(row.figure_id)
                for field in ("figure_alt", "figure_caption", "grading_guide"):
                    self.assertEqual(getattr(row, field), "")
                    self.assertEqual(getattr(model(), field), "")

