import io
import json
import tempfile
from copy import deepcopy
from datetime import timedelta
from pathlib import Path

from django.core.management import CommandError, call_command
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .management.commands.import_yaksh import convert_question
from .models import Attempt, BankQuestion, Exam, Invitation, Question, User
from .reporting import question_analysis, question_variant
from .serializers import QuestionSerializer
from .services import (
    hash_token,
    identity_for_user,
    question_points,
    resolve_identity,
    start_attempt,
)


def text_question(**changes):
    return {
        "description": "Enter the release phrase with the required capitalization and spacing",
        "type": "short",
        "options": [],
        "solution": ["Release  Ready\nChecked", "Approved"],
        "answer_matching": ["exact", "lower"],
        "points": 10,
        **changes,
    }


class TextRuleTests(SimpleTestCase):
    def test_yaksh_modes_preserve_case_spacing_and_line_semantics(self):
        question = text_question()
        for answer in (
            "Release  Ready\nChecked",
            "Release  Ready\r\nChecked\r\n",
            "APPROVED",
            "approved",
            "Approved\n",
        ):
            with self.subTest(answer=answer):
                self.assertEqual(question_points(question, answer), 10)
        for answer in (
            "release  ready\nchecked",
            "Release Ready\nChecked",
            "Release  Ready Checked",
            "Release  Ready\n\nChecked",
            "Release  Ready\nChecked\n\n",
            "Approved ",
            " Approved",
            "\nApproved",
            "",
            "  ",
            None,
            [],
            True,
        ):
            with self.subTest(answer=answer):
                self.assertEqual(question_points(question, answer), 0)

    def test_legacy_normalization_stays_distinct_from_yaksh_lower(self):
        question = text_question(solution=["Straße"], answer_matching=["normalized"])
        self.assertEqual(question_points(question, "  STRASSE\n"), 10)
        del question["answer_matching"]
        self.assertEqual(question_points(question, "  STRASSE\n"), 10)
        question["answer_matching"] = []
        self.assertEqual(question_points(question, "  STRASSE\n"), 10)
        question["answer_matching"] = ["lower"]
        self.assertEqual(question_points(question, "STRAẞE"), 10)
        self.assertEqual(question_points(question, "STRASSE"), 0)
        self.assertEqual(question_points(question, " Straße "), 0)
        for mode in ("normalized", "lower", "exact"):
            question = text_question(
                solution=[" 你好  世界\nÉxito "], answer_matching=[mode]
            )
            self.assertEqual(question_points(question, " 你好  世界\nÉxito "), 10)
            self.assertEqual(question_points(question, "你好 世界 Éxito"), 0)

    def test_invalid_text_rules_are_rejected_without_silent_fallback(self):
        invalid = [
            text_question(solution=[]),
            text_question(solution=[" "]),
            text_question(solution=[42]),
            text_question(solution=[True]),
            text_question(solution=["x" * 20001], answer_matching=["exact"]),
            text_question(solution=["x"] * 21, answer_matching=["exact"] * 21),
            *[
                text_question(answer_matching=modes)
                for modes in (
                    ["exact"],
                    ["exact", "unknown"],
                    ["exact", {}],
                    "exact",
                    None,
                )
            ],
        ]
        for data in invalid:
            with self.subTest(data=data):
                self.assertFalse(QuestionSerializer(data=data).is_valid())
        for modes in (["exact"], ["exact", "unknown"], "exact", None):
            self.assertEqual(
                question_points(text_question(answer_matching=modes), "Approved"), 0
            )
        old = text_question(answer_matching=[])
        serializer = QuestionSerializer(data=old)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(
            serializer.validated_data["answer_matching"], ["normalized"] * 2
        )

    def test_reporting_separates_rule_changes_and_normalizes_alternative_order(self):
        first = text_question(id=1)
        changed = text_question(id=1, answer_matching=["lower", "lower"])
        reordered = text_question(
            id=1, solution=first["solution"][::-1], answer_matching=["lower", "exact"]
        )
        self.assertEqual(question_variant(first), question_variant(reordered))
        self.assertNotEqual(question_variant(first), question_variant(changed))
        legacy = text_question(id=1)
        del legacy["answer_matching"]
        self.assertEqual(
            question_variant(legacy),
            question_variant(text_question(id=1, answer_matching=["normalized"] * 2)),
        )

    def test_yaksh_string_import_preserves_each_testcase_rule_and_text(self):
        data = {
            "type": "string",
            "description": "Phrase",
            "testcase": [
                {"correct": "  <Release>\nReady  ", "string_check": "exact"},
                {"correct": "APPROVED", "string_check": "lower"},
            ],
        }
        question = convert_question(data)
        self.assertEqual(question["solution"], ["  <Release>\nReady  ", "APPROVED"])
        self.assertEqual(question["answer_matching"], ["exact", "lower"])
        self.assertEqual(question_points(question, "approved"), 1)
        self.assertEqual(question_points(question, "<Release>\nReady"), 0)
        for mode in (None, "normalized", "regex"):
            data["testcase"][0]["string_check"] = mode
            with self.assertRaisesRegex(ValueError, "explicit lower or exact"):
                convert_question(data)


@override_settings(DEBUG=True)
class TextAssessmentTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("text-owner", role="instructor")
        self.learner = User.objects.create_user("text-learner", role="learner")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.exam = Exam.objects.create(
            owner=self.owner, title="Text rules", published=True, max_attempts=5
        )
        self.question = Question.objects.create(exam=self.exam, **text_question())

    def test_bank_copy_and_partial_updates_keep_text_and_rules_paired(self):
        response = self.client.post(
            "/api/question-bank/", text_question(), format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        bank = BankQuestion.objects.get(pk=response.data["id"])
        copied = {key: response.data[key] for key in text_question()}
        exam = self.client.post(
            "/api/exams/",
            {"title": "Copied text", "questions": [copied]},
            format="json",
        )
        self.assertEqual(exam.status_code, 201, exam.content)
        self.assertEqual(
            exam.data["questions"][0]["answer_matching"], ["exact", "lower"]
        )
        url = f"/api/question-bank/{bank.pk}/"
        rejected = self.client.patch(url, {"solution": ["Only one"]}, format="json")
        self.assertEqual(rejected.status_code, 400)
        bank.refresh_from_db()
        self.assertEqual(bank.solution, text_question()["solution"])
        updated = self.client.patch(
            url, {"solution": ["Exact"], "answer_matching": ["exact"]}, format="json"
        )
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertEqual(
            Exam.objects.get(pk=exam.data["id"]).questions.first().answer_matching,
            ["exact", "lower"],
        )
        changed = self.client.patch(
            url, {"type": "essay", "solution": []}, format="json"
        )
        self.assertEqual(changed.data["answer_matching"], [])
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.get(url).status_code, 403)

    def test_account_autosave_resume_and_grading_use_private_frozen_rules(self):
        self.client.force_authenticate(self.learner)
        started = self.client.post(
            f"/api/exams/{self.exam.pk}/start/", {}, format="json"
        )
        self.assertEqual(started.status_code, 200, started.content)
        attempt = Attempt.objects.get(pk=started.data["id"])
        frozen = deepcopy(attempt.snapshot)
        for key in ("solution", "answer_tolerances", "answer_matching"):
            self.assertNotIn(key, started.data["questions"][0])
        self.question.answer_matching = ["lower", "exact"]
        self.question.save()
        url = f"/api/attempts/{attempt.pk}/"
        answer = {str(self.question.pk): "Release  Ready\r\nChecked\r\n"}
        saved = self.client.patch(
            url, {"answers": answer, "answer_revision": 0}, format="json"
        )
        self.assertEqual(saved.status_code, 200)
        resumed = self.client.post(
            f"/api/exams/{self.exam.pk}/start/", {}, format="json"
        )
        self.assertEqual(resumed.data["id"], str(attempt.pk))
        self.assertEqual(resumed.data["answers"], answer)
        result = self.client.post(
            url,
            {"answers": {str(self.question.pk): "APPROVED"}, "answer_revision": 1},
            format="json",
        )
        self.assertEqual(result.data["score"], 100)
        self.assertNotIn("answer_matching", result.data["questions"][0])
        attempt.refresh_from_db()
        self.assertEqual(attempt.snapshot, frozen)
        self.client.force_authenticate(self.owner)
        review = self.client.get(f"/api/results/{attempt.pk}/review/")
        self.assertEqual(
            review.data["questions"][0]["answer_matching"], ["exact", "lower"]
        )
        self.assertEqual(
            question_analysis(Attempt.objects.filter(pk=attempt.pk))[0][
                "full_credit_rate"
            ],
            100,
        )

    def test_pre_migration_snapshots_keep_normalized_grading(self):
        attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        attempt.snapshot[0].pop("answer_matching")
        attempt.save()
        self.client.force_authenticate(self.learner)
        result = self.client.post(
            f"/api/attempts/{attempt.pk}/",
            {"answers": {str(self.question.pk): "  approved  "}},
            format="json",
        )
        self.assertEqual(result.data["score"], 100)

    def test_guest_grading_honors_rules_and_shared_budget(self):
        identity = resolve_identity("text-guest@example.com")
        invitation = Invitation.objects.create(
            exam=self.exam,
            identity=identity,
            created_by=self.owner,
            token_hash=hash_token("text-token"),
            expires_at=timezone.now() + timedelta(days=1),
            max_attempts=2,
        )
        guest = APIClient()
        self.assertEqual(
            guest.post(
                "/api/guest/exchange/", {"token": "text-token"}, format="json"
            ).status_code,
            200,
        )
        for answer, score in (("release  ready\nchecked", 0), ("APPROVED", 100)):
            start = guest.post("/api/guest/exam/", {}, format="json")
            self.assertEqual(start.status_code, 200, start.content)
            self.assertNotIn("answer_matching", start.data["questions"][0])
            result = guest.post(
                f"/api/attempts/{start.data['id']}/",
                {"answers": {str(self.question.pk): answer}},
                format="json",
            )
            self.assertEqual(result.data["score"], score)
        invitation.refresh_from_db()
        self.assertEqual(invitation.used, 2)
        self.assertEqual(
            guest.post("/api/guest/exam/", {}, format="json").status_code, 403
        )

    def test_invalid_text_and_localized_configuration_errors_do_not_write(self):
        for lang in ("es", "zh-hant"):
            response = self.client.post(
                "/api/question-bank/",
                text_question(answer_matching=["wrong"]),
                format="json",
                HTTP_ACCEPT_LANGUAGE=lang,
            )
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("Choose one valid", str(response.data))
        attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        self.client.force_authenticate(self.learner)
        for answer in (True, ["Approved"], "x" * 20001):
            rejected = self.client.patch(
                f"/api/attempts/{attempt.pk}/",
                {"answers": {str(self.question.pk): answer}, "answer_revision": 0},
                format="json",
            )
            self.assertEqual(rejected.status_code, 400)
        attempt.refresh_from_db()
        self.assertEqual(attempt.answers, {})
        self.assertEqual(attempt.answer_revision, 0)

    def test_string_import_is_atomic_and_preserves_draft_rules(self):
        valid = {
            "type": "string",
            "description": "Release phrase",
            "testcase": [{"correct": "Release\nReady", "string_check": "exact"}],
        }
        invalid = {**valid, "testcase": [{"correct": "Unknown matching mode"}]}
        before = Exam.objects.count()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "text.json"
            path.write_text(json.dumps([valid, invalid]))
            with self.assertRaises(CommandError):
                call_command(
                    "import_yaksh",
                    str(path),
                    owner=self.owner.username,
                    title="Rejected text",
                    stdout=io.StringIO(),
                )
            self.assertEqual(Exam.objects.count(), before)
            path.write_text(json.dumps([valid]))
            call_command(
                "import_yaksh",
                str(path),
                owner=self.owner.username,
                title="Imported text",
                stdout=io.StringIO(),
            )
        imported = Exam.objects.get(title="Imported text")
        self.assertFalse(imported.published)
        self.assertEqual(imported.questions.first().answer_matching, ["exact"])
        self.assertEqual(imported.questions.first().solution, ["Release\nReady"])
