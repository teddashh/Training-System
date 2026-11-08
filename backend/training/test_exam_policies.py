import io
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Attempt, AttemptBudget, Exam, Invitation, Question, User
from .services import hash_token, identity_for_user, resolve_identity, start_attempt


def policy_exam(owner, **changes):
    exam = Exam.objects.create(
        owner=owner,
        title="Controlled assessment",
        published=True,
        max_attempts=4,
        allow_skip=False,
        allow_response_review=False,
        **changes,
    )
    for index in range(3):
        Question.objects.create(
            exam=exam,
            position=index,
            description=f"Private question {index + 1}",
            type="single",
            options=["Correct", "Incorrect"],
            solution=[0],
            points=10,
        )
    return exam


@override_settings(DEBUG=True)
class ExamPolicyTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("policy-owner", role="instructor")
        self.learner = User.objects.create_user("policy-learner", role="learner")
        self.other = User.objects.create_user("other-policy-owner", role="instructor")
        self.exam = policy_exam(self.owner)
        self.client = APIClient()
        self.client.force_authenticate(self.learner)

    def start(self):
        response = self.client.post(
            f"/api/exams/{self.exam.pk}/start/", {}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("no-store", response["Cache-Control"])
        return Attempt.objects.get(pk=response.data["id"]), response

    def save(self, attempt, answers, *, submit=False, revision=None, **headers):
        attempt.refresh_from_db()
        method = self.client.post if submit else self.client.patch
        return method(
            f"/api/attempts/{attempt.pk}/",
            {
                "answers": answers,
                "answer_revision": attempt.answer_revision
                if revision is None
                else revision,
            },
            format="json",
            **headers,
        )

    def complete(self, attempt):
        answers = {}
        for question in attempt.snapshot:
            answers[str(question["id"])] = (
                "Written response" if question["type"] == "essay" else 0
            )
            response = self.save(attempt, answers)
            self.assertEqual(response.status_code, 200, response.content)
        result = self.save(attempt, answers, submit=True)
        self.assertEqual(result.status_code, 200, result.content)
        return result

    def test_defaults_editor_round_trip_and_ownership(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            "/api/exams/", {"title": "Compatible defaults"}, format="json"
        )
        self.assertEqual(created.status_code, 201)
        self.assertTrue(created.data["allow_skip"])
        self.assertTrue(created.data["allow_response_review"])
        url = f"/api/exams/{created.data['id']}/"
        changed = self.client.patch(
            url, {"allow_skip": False, "allow_response_review": False}, format="json"
        )
        self.assertEqual(changed.status_code, 200)
        self.assertFalse(self.client.get(url).data["allow_skip"])
        self.assertFalse(self.client.get(url).data["allow_response_review"])
        self.assertEqual(
            self.client.patch(
                url, {"allow_skip": "invalid"}, format="json"
            ).status_code,
            400,
        )
        for user in (self.other, self.learner):
            self.client.force_authenticate(user)
            self.assertIn(
                self.client.patch(
                    url, {"allow_response_review": True}, format="json"
                ).status_code,
                (403, 404),
            )

    def test_locked_questions_cannot_be_read_or_answered_ahead(self):
        attempt, response = self.start()
        self.assertEqual(response.data["question_count"], 3)
        self.assertEqual(len(response.data["questions"]), 1)
        self.assertNotIn("Private question 2", str(response.data))
        self.assertNotIn(
            "questions", self.client.get(f"/api/exams/{self.exam.pk}/").data
        )
        first, second, third = (str(q["id"]) for q in attempt.snapshot)
        for answers in ({second: 0}, {first: 0, second: 0}, {first: 0, third: 0}):
            rejected = self.save(attempt, answers)
            self.assertEqual(rejected.status_code, 400)
        attempt.refresh_from_db()
        self.assertEqual(attempt.answers, {})
        self.assertEqual(attempt.answer_revision, 0)
        self.assertEqual(attempt.unlocked_question_count, 1)
        saved = self.save(attempt, {first: 0})
        self.assertEqual(len(saved.data["questions"]), 2)
        self.assertNotIn("Private question 3", str(saved.data))
        resumed, response = self.start()
        self.assertEqual(resumed.pk, attempt.pk)
        self.assertEqual(len(response.data["questions"]), 2)
        self.assertEqual(AttemptBudget.objects.get(exam=self.exam).used, 1)

    def test_blank_answers_do_not_unlock_and_revisits_keep_progress(self):
        attempt, _ = self.start()
        first, second, third = (str(q["id"]) for q in attempt.snapshot)
        blank = self.save(attempt, {first: []})
        self.assertEqual(len(blank.data["questions"]), 1)
        self.assertEqual(len(self.save(attempt, {first: 0}).data["questions"]), 2)
        # A cleared earlier answer does not hide questions already seen, but all
        # preceding answers must be present to release the next unseen question.
        self.assertEqual(
            len(self.save(attempt, {first: [], second: 0}).data["questions"]), 2
        )
        self.assertEqual(
            len(self.save(attempt, {first: 0, second: 0}).data["questions"]), 3
        )
        before = deepcopy(Attempt.objects.get(pk=attempt.pk).answers)
        rejected = self.save(
            attempt,
            {first: [], second: 0, third: 0},
            submit=True,
            HTTP_ACCEPT_LANGUAGE="es",
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(rejected.data["code"], "answers_required")
        self.assertNotIn("Answer every question", str(rejected.data))
        attempt.refresh_from_db()
        self.assertEqual(attempt.answers, before)
        self.assertEqual(attempt.status, "in_progress")
        self.assertEqual(
            self.save(
                attempt, {first: 0, second: 0, third: 0}, submit=True
            ).status_code,
            200,
        )

    def test_all_question_types_unlock_on_presence_without_requiring_correctness(self):
        self.exam.questions.all().delete()
        kinds = [
            ("single", ["A", "B"], [0], 1, []),
            ("multiple", ["A", "B"], [0], [1], []),
            ("short", [], ["Expected"], "Different", " \t\n"),
            ("essay", [], [], "A response", ""),
            ("integer", [], ["42"], "-", ""),
            ("numeric", [], ["12.5"], "1e", ""),
            ("ordering", ["First", "Last"], [0, 1], None, []),
        ]
        for i, (kind, options, solution, _, _) in enumerate(kinds):
            Question.objects.create(
                exam=self.exam,
                position=i,
                description=kind,
                type=kind,
                options=options,
                solution=solution,
                answer_tolerances=["0"] if kind == "numeric" else [],
            )
        attempt, _ = self.start()
        answers = {}
        for index, (question, (_, _, _, value, blank)) in enumerate(
            zip(attempt.snapshot, kinds)
        ):
            key = str(question["id"])
            answers[key] = blank
            response = self.save(attempt, answers)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(len(response.data["questions"]), index + 1)
            answers[key] = question["solution"][::-1] if value is None else value
            response = self.save(attempt, answers)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(len(response.data["questions"]), min(7, index + 2))
        response = self.save(attempt, answers, submit=True)
        self.assertEqual(response.data["status"], "pending_review")
        self.assertEqual(response.data["questions"], [])

    def test_navigation_policy_is_frozen_and_randomized_order_stays_stable(self):
        self.exam.shuffle_questions = True
        self.exam.shuffle_options = True
        self.exam.questions_per_attempt = 2
        self.exam.save()
        with patch(
            "training.services.secrets.SystemRandom.shuffle",
            side_effect=lambda items: items.reverse(),
        ):
            attempt, first = self.start()
        frozen = deepcopy(attempt.snapshot)
        self.exam.allow_skip = True
        self.exam.save()
        resumed, data = self.start()
        self.assertFalse(resumed.allow_skip)
        self.assertEqual(first.data["questions"], data.data["questions"])
        self.assertEqual(
            len(self.save(attempt, {str(frozen[0]["id"]): 0}).data["questions"]), 2
        )
        attempt.refresh_from_db()
        self.assertEqual(attempt.snapshot, frozen)
        self.client.force_authenticate(self.other)
        new, response = self.start()
        self.assertTrue(new.allow_skip)
        self.assertEqual(len(response.data["questions"]), 2)

    def test_completed_review_is_live_and_hides_questions_answers_and_feedback(self):
        question = self.exam.questions.last()
        question.type = "essay"
        question.options = question.solution = []
        question.save()
        attempt, _ = self.start()
        result = self.complete(attempt)
        self.assertEqual(result.data["status"], "pending_review")
        self.assertFalse(result.data["review_available"])
        self.assertEqual(result.data["questions"], [])
        self.assertEqual(result.data["answers"], {})
        self.client.force_authenticate(self.owner)
        review_url = f"/api/results/{attempt.pk}/review/"
        review = self.client.post(
            review_url,
            {
                "grades": {
                    str(question.pk): {"points": 9, "feedback": "Private feedback"}
                }
            },
            format="json",
        )
        self.assertEqual(review.status_code, 200, review.content)
        self.assertEqual(len(review.data["questions"]), 3)
        self.assertTrue(review.data["answers"])
        self.assertIn("no-store", review["Cache-Control"])
        self.client.force_authenticate(self.learner)
        url = f"/api/attempts/{attempt.pk}/"
        for method in (self.client.get, self.client.patch, self.client.post):
            response = method(url + "?for_review=true", {}, format="json")
            self.assertEqual(response.status_code, 200)
            self.assertIsNotNone(response.data["score"])
            self.assertEqual(response.data["questions"], [])
            self.assertEqual(response.data["answers"], {})
            self.assertEqual(response.data["manual_grades"], {})
            self.assertIn("no-store", response["Cache-Control"])
        attempt.refresh_from_db()
        saved = (deepcopy(attempt.answers), attempt.score, attempt.answer_revision)
        self.exam.allow_response_review = True
        self.exam.save()
        released = self.client.get(url)
        self.assertTrue(released.data["review_available"])
        self.assertEqual(
            released.data["manual_grades"][str(question.pk)]["feedback"],
            "Private feedback",
        )
        self.assertNotIn("solution", released.data["questions"][0])
        self.exam.allow_response_review = False
        self.exam.save()
        self.assertEqual(self.client.get(url).data["answers"], {})
        attempt.refresh_from_db()
        self.assertEqual(
            (attempt.answers, attempt.score, attempt.answer_revision), saved
        )

    def test_manager_only_review_override_and_other_participant_access(self):
        # Even an instructor's own participant endpoint follows the exam policy.
        self.client.force_authenticate(self.owner)
        attempt, _ = self.start()
        self.assertEqual(self.complete(attempt).data["answers"], {})
        url = f"/api/results/{attempt.pk}/review/"
        self.assertTrue(self.client.get(url).data["answers"])
        for user in (self.learner, self.other):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(url).status_code, 403)
            self.assertEqual(
                self.client.get(f"/api/attempts/{attempt.pk}/").status_code, 404
            )

    def test_guest_uses_sequential_access_hidden_results_and_same_budget(self):
        identity = resolve_identity("policy-guest@example.com")
        invitation = Invitation.objects.create(
            exam=self.exam,
            identity=identity,
            created_by=self.owner,
            token_hash=hash_token("policy-token"),
            expires_at=timezone.now() + timedelta(days=1),
            max_attempts=1,
        )
        self.client = APIClient()
        self.assertEqual(
            self.client.post(
                "/api/guest/exchange/", {"token": "policy-token"}, format="json"
            ).status_code,
            200,
        )
        info = self.client.get("/api/guest/exam/")
        self.assertFalse(info.data["allow_skip"])
        self.assertFalse(info.data["allow_response_review"])
        start = self.client.post("/api/guest/exam/", {}, format="json")
        self.assertEqual(len(start.data["questions"]), 1)
        attempt = Attempt.objects.get(pk=start.data["id"])
        self.assertEqual(self.complete(attempt).data["questions"], [])
        self.assertEqual(
            self.client.post("/api/guest/exam/", {}, format="json").status_code, 403
        )
        invitation.refresh_from_db()
        self.assertEqual(invitation.used, 1)
        self.assertEqual(AttemptBudget.objects.get(exam=self.exam).used, 1)
        invitation.revoked = True
        invitation.save()
        self.assertEqual(
            self.client.get(f"/api/attempts/{attempt.pk}/").status_code, 403
        )

    def test_expiry_finalizes_only_saved_answers_without_requiring_completion(self):
        attempt, _ = self.start()
        first, second, _ = (str(q["id"]) for q in attempt.snapshot)
        self.save(attempt, {first: 0})
        Attempt.objects.filter(pk=attempt.pk).update(
            deadline=timezone.now() - timedelta(seconds=1)
        )
        late = self.save(attempt, {first: 1, second: 0}, submit=True, revision=0)
        self.assertEqual(late.status_code, 200)
        self.assertEqual(late.data["status"], "graded")
        self.assertEqual(late.data["questions"], [])
        attempt.refresh_from_db()
        self.assertEqual(attempt.answers, {first: 0})
        self.assertAlmostEqual(attempt.score, 33.33, places=2)
        next_attempt, _ = self.start()
        Attempt.objects.filter(pk=next_attempt.pk).update(
            deadline=timezone.now() - timedelta(seconds=1)
        )
        call_command("expire_attempts", stdout=io.StringIO())
        next_attempt.refresh_from_db()
        self.assertEqual(next_attempt.status, "graded")
        self.assertEqual(next_attempt.score, 0)

    def test_free_navigation_keeps_incomplete_submission_compatible(self):
        self.exam.allow_skip = self.exam.allow_response_review = True
        self.exam.save()
        attempt, started = self.start()
        self.assertEqual(len(started.data["questions"]), 3)
        result = self.save(attempt, {}, submit=True)
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.data["review_available"])
        self.assertEqual(len(result.data["questions"]), 3)
        self.assertEqual(result.data["score"], 0)


@override_settings(DEBUG=True)
class ConcurrentExamPolicyTests(TransactionTestCase):
    def test_competing_saves_unlock_only_one_question_for_one_revision(self):
        if connection.vendor != "postgresql":
            self.skipTest("Row-lock verification requires PostgreSQL.")
        user = User.objects.create_user("parallel-policy", role="instructor")
        attempt = start_attempt(policy_exam(user).pk, identity_for_user(user))
        key = str(attempt.snapshot[0]["id"])

        def save(value):
            try:
                client = APIClient()
                client.force_authenticate(User.objects.get(pk=user.pk))
                return client.patch(
                    f"/api/attempts/{attempt.pk}/",
                    {"answers": {key: value}, "answer_revision": 0},
                    format="json",
                ).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(save, [0, 1]))
        self.assertEqual(sorted(statuses), [200, 409])
        attempt.refresh_from_db()
        self.assertEqual(attempt.unlocked_question_count, 2)
        self.assertEqual(attempt.answer_revision, 1)
