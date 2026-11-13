import io
import json
import tempfile
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .management.commands.import_yaksh import convert_question
from .models import Attempt, AttemptBudget, Exam, Invitation, Question, User
from .reporting import question_analysis, question_variant
from .serializers import QuestionSerializer
from .services import (
    hash_token,
    identity_for_user,
    question_points,
    resolve_identity,
    start_attempt,
)


def numeric(**changes):
    return {
        "description": "Enter a valid calibration value",
        "type": "numeric",
        "options": [],
        "solution": ["0.3", "10"],
        "answer_tolerances": ["0.1", "0.02"],
        "points": 10,
        **changes,
    }


def ordering(**changes):
    return {
        "description": "Arrange the safety procedure",
        "type": "ordering",
        "options": ["Isolate", "Verify", "Maintain"],
        "solution": [0, 1, 2],
        "points": 10,
        **changes,
    }


class QuestionRuleTests(TestCase):
    def test_numeric_boundaries_multiple_rules_and_scientific_notation(self):
        for answer in ("0.2", "0.4", "2e-1", "  +.30  ", "9.98", "10.02"):
            with self.subTest(answer=answer):
                self.assertEqual(question_points(numeric(), answer), 10)
        for answer in (
            "0.19999999999999999999999999999",
            "0.40000000000000000000000000001",
            "10.0200000000000000001",
        ):
            with self.subTest(answer=answer):
                self.assertEqual(question_points(numeric(), answer), 0)

    def test_numeric_grading_preserves_precision_beyond_binary_float(self):
        question = numeric(solution=["9007199254740993"], answer_tolerances=["0"])
        self.assertEqual(question_points(question, "9007199254740993"), 10)
        self.assertEqual(question_points(question, "9007199254740992"), 0)
        tiny = numeric(solution=["2e-100"], answer_tolerances=["1e-100"])
        self.assertEqual(question_points(tiny, "1e-100"), 10)
        self.assertEqual(question_points(tiny, "1.000e-100"), 10)
        self.assertEqual(question_points(tiny, "1000e-103"), 10)
        self.assertEqual(question_points(tiny, "0"), 0)
        # Large cancellation must not round an out-of-range answer onto a boundary.
        huge = numeric(solution=["1e100"], answer_tolerances=["1e100"])
        self.assertEqual(question_points(huge, "0"), 10)
        self.assertEqual(question_points(huge, "0.1e101"), 10)
        self.assertEqual(question_points(huge, "-1e-100"), 0)

    def test_integer_answers_accept_alternatives_and_reject_nonintegers(self):
        question = numeric(
            type="integer",
            solution=["-42", "0", "9007199254740993"],
            answer_tolerances=[],
        )
        for answer in (" -42 ", "+0", "-0", "9007199254740993"):
            self.assertEqual(question_points(question, answer), 10)
        for answer in ("-42.0", "0e0", "9007199254740992", "1.5"):
            self.assertEqual(question_points(question, answer), 0)

    def test_malformed_and_unbounded_numbers_never_receive_credit(self):
        for answer in (
            None,
            True,
            0.3,
            ["0.3"],
            {},
            "",
            "-",
            "NaN",
            "sNaN",
            "Infinity",
            "1/3",
            "0,3",
            "1_0",
            "０.３",
            "1e99999999999999999999",
            "1e-101",
            "1" * 129,
        ):
            with self.subTest(answer=answer):
                self.assertEqual(question_points(numeric(), answer), 0)

    def test_ordering_requires_the_correct_sequence_not_just_the_same_set(self):
        self.assertEqual(question_points(ordering(), [0, 1, 2]), 10)
        for answer in (
            [2, 1, 0],
            [0, 0, 2],
            [0, 1],
            [False, 1, 2],
            ["0", "1", "2"],
            [],
            None,
        ):
            self.assertEqual(question_points(ordering(), answer), 0)

    def test_configuration_rejects_invalid_numeric_rules_and_orderings(self):
        invalid = [
            numeric(solution=[]),
            numeric(solution=["1"] * 21, answer_tolerances=["0"] * 21),
            numeric(solution=[True]),
            numeric(solution=["NaN"]),
            numeric(solution=["1e101"]),
            numeric(answer_tolerances=["0"]),
            numeric(answer_tolerances="0.1"),
            numeric(answer_tolerances=["0", "-0.1"]),
            numeric(answer_tolerances=["0", "Infinity"]),
            numeric(type="integer", solution=["1.2"]),
            ordering(options=["Same", " Same "], solution=[0, 1]),
            ordering(options=["First", ""], solution=[0, 1]),
            ordering(solution=[0, 0, 2]),
            ordering(solution=[0, 1]),
            ordering(solution=[False, 1, 2]),
            ordering(solution=[0, "1", 2]),
        ]
        for data in invalid:
            with self.subTest(data=data):
                self.assertFalse(QuestionSerializer(data=data).is_valid())

    def test_reporting_normalizes_order_shuffle_but_preserves_changed_rules(self):
        first = ordering(id=1)
        shuffled = ordering(
            id=1, options=["Verify", "Maintain", "Isolate"], solution=[2, 0, 1]
        )
        self.assertEqual(question_variant(first), question_variant(shuffled))
        shuffled["solution"] = [2, 1, 0]
        self.assertNotEqual(question_variant(first), question_variant(shuffled))
        first = numeric(id=2)
        changed = numeric(id=2, answer_tolerances=["0.1", "0.03"])
        self.assertNotEqual(question_variant(first), question_variant(changed))
        reordered = numeric(
            id=2, solution=["10", "0.3"], answer_tolerances=["0.02", "0.1"]
        )
        self.assertEqual(question_variant(first), question_variant(reordered))

    def test_yaksh_numeric_rules_and_explicit_order_migrate_without_guessing(self):
        integer = convert_question(
            {
                "type": "integer",
                "description": "Count",
                "testcase": [{"correct": 42}, {"correct": -42}],
            }
        )
        self.assertEqual(integer["solution"], ["42", "-42"])
        decimal = convert_question(
            {
                "type": "float",
                "description": "Range",
                "testcase": [
                    {"correct": 0.3, "error_margin": 0.1},
                    {"correct": 10, "error_margin": 0.02},
                ],
            }
        )
        self.assertEqual(decimal["answer_tolerances"], ["0.1", "0.02"])
        self.assertEqual(question_points(decimal, "10.02"), 1)
        arrange = {
            "type": "arrange",
            "description": "Order",
            "testcase": [{"options": "B"}, {"options": "A"}],
        }
        with self.assertRaisesRegex(ValueError, "correct_order"):
            convert_question(arrange)
        self.assertEqual(
            convert_question({**arrange, "correct_order": [1, 0]})["solution"], [1, 0]
        )


@override_settings(DEBUG=True)
class StructuredAssessmentTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("structured-owner", role="instructor")
        self.learner = User.objects.create_user("structured-learner", role="learner")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.exam = Exam.objects.create(
            owner=self.owner, title="Structured exam", published=True, max_attempts=5
        )
        self.numeric = Question.objects.create(exam=self.exam, position=0, **numeric())
        self.integer = Question.objects.create(
            exam=self.exam,
            position=1,
            **numeric(type="integer", solution=["42", "-42"], answer_tolerances=[]),
        )
        self.ordering = Question.objects.create(
            exam=self.exam, position=2, **ordering()
        )

    def correct_answers(self, attempt):
        return {
            str(q["id"]): q["solution"]
            if q["type"] == "ordering"
            else "10.02"
            if q["type"] == "numeric"
            else "-42"
            for q in attempt.snapshot
        }

    def test_bank_and_exam_editor_round_trip_and_patch_validation(self):
        bank = self.client.post(
            "/api/question-bank/", {**numeric(), "category": "Quality"}, format="json"
        )
        self.assertEqual(bank.status_code, 201, bank.content)
        copied = {
            key: bank.data[key]
            for key in (
                "description",
                "type",
                "options",
                "solution",
                "answer_tolerances",
                "points",
            )
        }
        exam = self.client.post(
            "/api/exams/",
            {"title": "From bank", "questions": [copied, ordering()]},
            format="json",
        )
        self.assertEqual(exam.status_code, 201, exam.content)
        self.assertEqual(
            exam.data["questions"][0]["answer_tolerances"], ["0.1", "0.02"]
        )
        self.assertEqual(
            self.client.patch(
                f"/api/question-bank/{bank.data['id']}/",
                {"answer_tolerances": ["0"]},
                format="json",
            ).status_code,
            400,
        )
        updated = self.client.patch(
            f"/api/question-bank/{bank.data['id']}/",
            {"answer_tolerances": ["0", "0"]},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(
            Exam.objects.get(pk=exam.data["id"]).questions.first().answer_tolerances,
            ["0.1", "0.02"],
        )
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.get("/api/question-bank/").status_code, 403)

    def test_attempt_freezes_rules_and_order_with_private_answers(self):
        with patch(
            "training.services.secrets.SystemRandom.shuffle",
            side_effect=lambda values: values.reverse(),
        ):
            attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        frozen = deepcopy(attempt.snapshot)
        self.assertEqual(frozen[2]["options"], ["Maintain", "Verify", "Isolate"])
        self.assertEqual(frozen[2]["solution"], [2, 1, 0])
        self.numeric.answer_tolerances = ["0", "0"]
        self.numeric.solution = ["100", "200"]
        self.numeric.save()
        self.ordering.solution = [2, 1, 0]
        self.ordering.save()
        resumed = start_attempt(self.exam.pk, identity_for_user(self.learner))
        self.assertEqual(resumed.pk, attempt.pk)
        self.assertEqual(resumed.snapshot, frozen)
        self.assertEqual(AttemptBudget.objects.get().used, 1)
        self.client.force_authenticate(self.learner)
        url = f"/api/attempts/{attempt.pk}/"
        visible = self.client.get(url).json()
        for question in visible["questions"]:
            self.assertNotIn("solution", question)
            self.assertNotIn("answer_tolerances", question)
        submitted = self.client.post(
            url,
            {"answers": self.correct_answers(attempt), "answer_revision": 0},
            format="json",
        )
        self.assertEqual(submitted.status_code, 200, submitted.content)
        self.assertEqual(submitted.json()["score"], 100)
        self.assertEqual(submitted.json()["status"], "graded")
        self.client.force_authenticate(self.owner)
        review = self.client.get(f"/api/results/{attempt.pk}/review/").json()
        self.assertEqual(review["questions"][0]["answer_tolerances"], ["0.1", "0.02"])
        self.assertTrue(
            all(
                row["full_credit_rate"] == 100
                for row in question_analysis(Attempt.objects.filter(pk=attempt.pk))
            )
        )

    def test_autosave_preserves_incomplete_numbers_and_rejects_invalid_orders(self):
        attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        url = f"/api/attempts/{attempt.pk}/"
        self.client.force_authenticate(self.learner)
        answers = {str(self.numeric.pk): "-", str(self.ordering.pk): []}
        saved = self.client.patch(
            url, {"answers": answers, "answer_revision": 0}, format="json"
        )
        self.assertEqual(saved.status_code, 200)
        for bad in ([0, 0, 1], [0, 1], [0, True, 2], "0,1,2", [0, 1, 3]):
            result = self.client.patch(
                url,
                {
                    "answers": {**answers, str(self.ordering.pk): bad},
                    "answer_revision": 1,
                },
                format="json",
            )
            self.assertEqual(result.status_code, 400, result.content)
        attempt.refresh_from_db()
        self.assertEqual(attempt.answers, answers)
        self.assertEqual(attempt.answer_revision, 1)
        self.assertEqual(
            self.client.post(
                url,
                {"answers": self.correct_answers(attempt), "answer_revision": 1},
                format="json",
            ).json()["score"],
            100,
        )

    def test_guest_link_grades_new_types_and_preserves_attempt_budget(self):
        identity = resolve_identity("structured-guest@example.com")
        invitation = Invitation.objects.create(
            exam=self.exam,
            identity=identity,
            created_by=self.owner,
            token_hash=hash_token("structured-token"),
            expires_at=timezone.now() + timedelta(days=1),
            max_attempts=1,
        )
        guest = APIClient()
        self.assertEqual(
            guest.post(
                "/api/guest/exchange/", {"token": "structured-token"}, format="json"
            ).status_code,
            200,
        )
        start = guest.post("/api/guest/exam/", {}, format="json")
        self.assertEqual(start.status_code, 200, start.content)
        attempt = Attempt.objects.get(pk=start.json()["id"])
        for question in start.json()["questions"]:
            self.assertNotIn("solution", question)
            self.assertNotIn("answer_tolerances", question)
        result = guest.post(
            f"/api/attempts/{attempt.pk}/",
            {"answers": self.correct_answers(attempt)},
            format="json",
        )
        self.assertEqual(result.json()["score"], 100)
        self.assertEqual(
            guest.post("/api/guest/exam/", {}, format="json").status_code, 403
        )
        invitation.refresh_from_db()
        self.assertEqual(invitation.used, 1)

    def test_invalid_legacy_import_is_atomic(self):
        before = Exam.objects.count()
        records = [
            {"type": "integer", "description": "Count", "testcase": [{"correct": 42}]},
            {
                "type": "float",
                "description": "Invalid margin",
                "testcase": [{"correct": 1, "error_margin": -1}],
            },
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "questions.json"
            path.write_text(json.dumps(records))
            with self.assertRaises(CommandError):
                call_command(
                    "import_yaksh",
                    str(path),
                    owner=self.owner.username,
                    title="Rejected",
                    stdout=io.StringIO(),
                )
        self.assertEqual(Exam.objects.count(), before)
