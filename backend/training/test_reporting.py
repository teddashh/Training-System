import csv
import io
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Attempt, AttemptBudget, Question, User
from .services import finalize, grade, identity_for_user, start_attempt
from .tests import make_exam


@override_settings(DEBUG=True)
class ReportingTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("report-owner", role="instructor")
        self.admin = User.objects.create_user("report-admin", role="admin")
        self.learner = User.objects.create_user(
            "report-learner", display_name="Taylor", department="Quality"
        )
        self.other = User.objects.create_user(
            "report-other", display_name="Sofia", department="Operations"
        )
        self.exam = make_exam(self.owner, limit=10)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def attempt(self, user=None, correct=True, exam=None):
        attempt = start_attempt(
            (exam or self.exam).pk, identity_for_user(user or self.learner)
        )
        attempt.answers = {
            str(q["id"]): (q["solution"] if correct else []) for q in attempt.snapshot
        }
        finalize(attempt)
        return attempt

    def test_pagination_covers_history_beyond_1000_and_summaries_use_all_rows(self):
        identity = identity_for_user(self.learner)
        now = timezone.now()
        Attempt.objects.bulk_create(
            [
                Attempt(
                    exam=self.exam,
                    identity=identity,
                    number=index + 1,
                    status="graded",
                    pass_score=70,
                    deadline=now,
                    submitted_at=now,
                    score=100 if index % 2 else 0,
                    passed=bool(index % 2),
                )
                for index in range(1005)
            ]
        )
        response = self.client.get("/api/results/?page=11&page_size=100")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            (
                response.data["count"],
                response.data["pages"],
                len(response.data["results"]),
            ),
            (1005, 11, 5),
        )
        self.assertEqual(response.data["summary"]["graded"], 1005)
        self.assertAlmostEqual(response.data["summary"]["average_score"], 50, delta=0.1)
        self.assertEqual(len(self.client.get("/api/results/").data), 1000)
        self.assertEqual(self.client.get("/api/results/?page=99999").data["page"], 41)

    def test_filters_and_csv_match_across_all_pages(self):
        self.attempt()
        failed = self.attempt(self.other, correct=False)
        self.other.display_name = "=CSV FORMULA"
        self.other.save()
        failed.identity.label = "=CSV FORMULA"
        failed.identity.save()
        query = f"exam={self.exam.pk}&status=graded&outcome=not_passed&search=operations&days=all&page=1&page_size=1"
        response = self.client.get("/api/results/?" + query)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], str(failed.pk))
        output = self.client.get("/api/results/export/?" + query)
        lines = list(csv.reader(io.StringIO(output.content.decode("utf-8-sig"))))
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[1][1], "'=CSV FORMULA")
        self.assertEqual(lines[1][-1], "Operations")
        self.assertEqual(response.data["summary"]["average_score"], 0)

    def test_results_and_exports_preserve_role_scopes(self):
        own = self.attempt()
        other_exam = make_exam(self.admin)
        hidden = self.attempt(self.other, exam=other_exam)
        for path in [
            "/api/results/?page=1",
            f"/api/results/?page=1&exam={other_exam.pk}",
        ]:
            response = self.client.get(path)
            self.assertNotIn(str(hidden.pk), str(response.data))
        exported = self.client.get(f"/api/results/export/?exam={other_exam.pk}")
        self.assertEqual(
            len(list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig"))))), 1
        )
        self.client.force_authenticate(self.learner)
        self.assertEqual(
            [
                row["id"]
                for row in self.client.get("/api/results/?page=1").data["results"]
            ],
            [str(own.pk)],
        )
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/api/results/?page=1").data["count"], 2)

    def test_date_filters_use_submission_time_and_expired_attempts_finalize_before_filtering(
        self,
    ):
        recent = self.attempt()
        old = self.attempt(self.other)
        Attempt.objects.filter(pk=old.pk).update(
            submitted_at=timezone.now() - timedelta(days=40)
        )
        Attempt.objects.filter(pk=recent.pk).update(
            started_at=timezone.now() - timedelta(days=40)
        )
        current = start_attempt(self.exam.pk, identity_for_user(self.other))
        Attempt.objects.filter(pk=current.pk).update(
            deadline=timezone.now() - timedelta(seconds=1)
        )
        response = self.client.get("/api/results/?page=1&days=7&status=graded")
        self.assertEqual(response.data["count"], 2)
        current.refresh_from_db()
        self.assertEqual(current.status, "graded")
        self.assertNotIn(str(old.pk), str(response.data))

    def test_report_filters_reject_invalid_inputs(self):
        for query in [
            "page=0",
            "page_size=101",
            "days=-1",
            "status=unknown",
            "exam=x",
            "outcome=unknown",
            "search=" + "a" * 201,
        ]:
            with self.subTest(query=query):
                self.assertEqual(
                    self.client.get("/api/results/?" + query).status_code, 400
                )
                self.assertEqual(
                    self.client.get("/api/results/export/?" + query).status_code, 400
                )

    def test_question_insights_use_frozen_variants_and_normalize_shuffles(self):
        first = self.attempt()
        self.attempt(self.other, correct=False)
        # Represent the same question with a different option order.
        question = first.snapshot[0]
        question["options"] = list(reversed(question["options"]))
        question["solution"] = [0]
        first.answers = {str(question["id"]): 0}
        first.save()
        self.exam.questions.all().delete()
        Question.objects.create(
            exam=self.exam,
            description=question["description"],
            options=["unsafe", "safe"],
            solution=[1],
            points=60,
        )
        self.attempt()
        result = self.client.get(f"/api/exams/{self.exam.pk}/insights/")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["summary"]["graded"], 3)
        self.assertEqual(len(result.data["questions"]), 2)
        old = next(
            row
            for row in result.data["questions"]
            if row["question_id"] == question["id"]
        )
        self.assertEqual(
            (old["responses"], old["full_credit_rate"], old["answer_rate"]), (2, 50, 50)
        )
        self.assertEqual(old["average_points"], 30)
        self.assertNotIn("solution", str(result.data))
        export = self.client.get(f"/api/exams/{self.exam.pk}/insights/?export=csv")
        self.assertEqual(export.status_code, 200)
        self.assertEqual(
            len(list(csv.reader(io.StringIO(export.content.decode("utf-8-sig"))))), 3
        )

    def test_pending_manual_grades_are_excluded_and_partial_credit_is_retained(self):
        essay_exam = make_exam(self.owner, essay=True)
        pending = self.attempt(exam=essay_exam)
        result = self.client.get(f"/api/exams/{essay_exam.pk}/insights/")
        self.assertEqual(result.data["summary"]["pending"], 1)
        self.assertIsNone(result.data["summary"]["average_score"])
        self.assertEqual(result.data["questions"], [])
        essay = next(q for q in pending.snapshot if q["type"] == "essay")
        response = self.client.post(
            f"/api/results/{pending.pk}/review/",
            {
                "grades": {
                    str(essay["id"]): {"points": 20, "feedback": "Partially correct"}
                }
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        result = self.client.get(f"/api/exams/{essay_exam.pk}/insights/")
        row = next(q for q in result.data["questions"] if q["type"] == "essay")
        self.assertEqual(row["average_points"], 20)
        self.assertEqual(row["full_credit_rate"], 0)
        self.assertEqual(result.data["summary"]["average_score"], 80)

    def test_sampled_questions_count_only_when_presented(self):
        self.exam.questions_per_attempt = 1
        self.exam.save()
        extra = Question.objects.create(
            exam=self.exam,
            description="Extra",
            type="short",
            solution=["yes"],
            points=10,
        )
        first = self.attempt()
        second = self.attempt(self.other)
        # Deterministic coverage of two different sampled questions.
        second.snapshot = [
            {
                "id": extra.pk,
                "description": extra.description,
                "type": "short",
                "options": [],
                "solution": ["yes"],
                "points": 10,
            }
        ]
        second.answers = {str(extra.pk): " YES "}
        grade(second)
        second.save()
        first.snapshot = [
            q
            for q in self.exam.questions.values(
                "id", "description", "type", "options", "solution", "points"
            )
            if q["id"] != extra.pk
        ]
        first.answers = {str(first.snapshot[0]["id"]): 1}
        grade(first)
        first.save()
        data = self.client.get(f"/api/exams/{self.exam.pk}/insights/").data
        self.assertEqual(sorted(q["responses"] for q in data["questions"]), [1, 1])
        self.assertTrue(all(q["full_credit_rate"] == 100 for q in data["questions"]))

    def test_insights_require_current_manager_authority(self):
        self.attempt()
        self.client.force_authenticate(self.learner)
        self.assertEqual(
            self.client.get(f"/api/exams/{self.exam.pk}/insights/").status_code, 403
        )
        self.assertEqual(
            self.client.get(
                f"/api/exams/{self.exam.pk}/insights/?export=csv"
            ).status_code,
            403,
        )
        stranger = User.objects.create_user("stranger", role="instructor")
        self.client.force_authenticate(stranger)
        self.assertEqual(
            self.client.get(f"/api/exams/{self.exam.pk}/insights/").status_code, 403
        )
        self.owner.role = "learner"
        self.owner.save()
        self.client.force_authenticate(self.owner)
        self.assertEqual(
            self.client.get(f"/api/exams/{self.exam.pk}/insights/").status_code, 403
        )

    def test_effective_budget_and_active_attempt_are_private_to_the_current_user(self):
        identity = identity_for_user(self.learner)
        AttemptBudget.objects.create(
            exam=self.exam, identity=identity, limit_override=1
        )
        active = start_attempt(self.exam.pk, identity)
        self.client.force_authenticate(self.learner)
        data = self.client.get(f"/api/exams/{self.exam.pk}/").data
        self.assertEqual(
            (
                data["effective_attempt_limit"],
                data["attempts_used"],
                data["attempts_remaining"],
            ),
            (1, 1, 0),
        )
        self.assertEqual(data["active_attempt_id"], str(active.pk))
        self.client.force_authenticate(self.other)
        data = self.client.get(f"/api/exams/{self.exam.pk}/").data
        self.assertEqual(data["effective_attempt_limit"], 10)
        self.assertIsNone(data["active_attempt_id"])
        finalize(active)
        self.client.force_authenticate(self.learner)
        self.assertIsNone(
            self.client.get(f"/api/exams/{self.exam.pk}/").data["active_attempt_id"]
        )
