from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Attempt, Exam, Identity, Invitation, Question, User
from .serializers import BankQuestionSerializer, QuestionSerializer
from .services import hash_token, public_attempt

GUIDE = "Award 6 points for the route.\nAward 4 points for the explanation."


def essay(**changes):
    return {"type": "essay", "description": "Explain the synthetic route.", "points": 10,
            "options": [], "solution": [], "grading_guide": GUIDE, **changes}


@override_settings(DEBUG=True)
class GradingGuideTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("guide-owner", role="instructor")
        self.learner = User.objects.create_user("guide-learner")
        self.exam = Exam.objects.create(owner=self.owner, title="Synthetic guide exam", published=True,
                                       allow_response_review=True)
        self.question = Question.objects.create(exam=self.exam, **essay())
        self.client = APIClient()
        self.staff = APIClient()
        self.staff.force_authenticate(self.owner)

    def assert_private(self, response):
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn(GUIDE, response.content.decode())
        self.assertNotIn("grading_guide", response.content.decode())
        for question in response.data.get("questions", []):
            for key in ("solution", "answer_tolerances", "answer_matching", "grading_guide"):
                self.assertNotIn(key, question)

    def test_essay_serializers_enforce_limit_and_keep_line_breaks(self):
        for cls in (QuestionSerializer, BankQuestionSerializer):
            for guide in ("", GUIDE, "x" * 5000, "x" * 5001):
                with self.subTest(serializer=cls.__name__, length=len(guide)):
                    serializer = cls(data=essay(grading_guide=guide))
                    self.assertEqual(serializer.is_valid(), len(guide) <= 5000, serializer.errors)
                    if len(guide) <= 5000:
                        obj = serializer.save(**({"exam": self.exam} if cls == QuestionSerializer else {"owner": self.owner}))
                        self.assertEqual(obj.grading_guide, guide)
                    else:
                        self.assertIn("grading_guide", serializer.errors)

    def test_nonessay_types_clear_guides_including_type_changes(self):
        kinds = {"single": (["A", "B"], [0]), "multiple": (["A", "B"], [0, 1]),
                 "short": ([], ["route"]), "integer": ([], ["1"]), "numeric": ([], ["1"]),
                 "ordering": (["A", "B"], [0, 1])}
        for cls in (QuestionSerializer, BankQuestionSerializer):
            for kind, (options, solution) in kinds.items():
                with self.subTest(serializer=cls.__name__, kind=kind):
                    values = essay(type=kind, options=options, solution=solution)
                    if kind == "numeric":
                        values["answer_tolerances"] = ["0"]
                    serializer = cls(data=values)
                    self.assertTrue(serializer.is_valid(), serializer.errors)
                    self.assertEqual(serializer.validated_data["grading_guide"], "")
                    initial = cls(data=essay())
                    initial.is_valid(raise_exception=True)
                    obj = initial.save(**({"exam": self.exam} if cls == QuestionSerializer else {"owner": self.owner}))
                    values.pop("grading_guide")
                    changed = cls(obj, data=values, partial=True)
                    self.assertTrue(changed.is_valid(), changed.errors)
                    self.assertEqual(changed.save().grading_guide, "")

    def test_learner_and_guest_attempts_and_reviews_hide_frozen_guide(self):
        for guest in (False, True):
            with self.subTest(guest=guest):
                if guest:
                    self.client.force_authenticate(None)
                    invitation = Invitation.objects.create(exam=self.exam,
                        identity=Identity.objects.create(key="email:guide-guest@corp.example.com"),
                        token_hash=hash_token("synthetic-guide-token"), created_by=self.owner,
                        expires_at=timezone.now() + timedelta(days=1))
                    session = self.client.session
                    session["guest_invitation"] = str(invitation.pk)
                    session.save()
                    self.assert_private(self.client.get("/api/guest/exam/"))
                    started = self.client.post("/api/guest/exam/")
                else:
                    self.client.force_authenticate(self.learner)
                    self.assert_private(self.client.get(f"/api/exams/{self.exam.pk}/"))
                    started = self.client.post(f"/api/exams/{self.exam.pk}/start/")
                self.assert_private(started)
                attempt_id = started.data["id"]
                attempt = Attempt.objects.get(pk=attempt_id)
                self.assertEqual(attempt.snapshot[0]["grading_guide"], GUIDE)
                self.question.grading_guide = "Changed guide for later candidates"
                self.question.save()
                submitted = self.client.post(f"/api/attempts/{attempt_id}/", {
                    "answers": {str(self.question.pk): "A synthetic written response"}, "answer_revision": 0}, format="json")
                self.assert_private(submitted)
                self.assert_private(self.client.get(f"/api/attempts/{attempt_id}/"))
                review_url = f"/api/results/{attempt_id}/review/"
                staff_review = self.staff.get(review_url)
                self.assertEqual(staff_review.status_code, 200)
                self.assertEqual(staff_review.data["questions"][0]["grading_guide"], GUIDE)
                graded = self.staff.post(review_url, {"grades": {str(self.question.pk): {
                    "points": 10, "feedback": "Synthetic feedback"}}}, format="json")
                self.assertEqual(graded.status_code, 200, graded.content)
                self.assertEqual(graded.data["questions"][0]["grading_guide"], GUIDE)
                self.assert_private(self.client.get(f"/api/attempts/{attempt_id}/"))
                self.assertEqual(self.client.get(review_url).status_code, 403)
                self.question.grading_guide = GUIDE
                self.question.save()
                # Legacy snapshots without the new field remain usable.
                attempt.snapshot[0].pop("grading_guide")
                attempt.save(update_fields=["snapshot"])
                self.assertNotIn("grading_guide", public_attempt(attempt)["questions"][0])

    def test_organizer_trial_hides_guide_until_staff_review(self):
        started = self.staff.post(f"/api/exams/{self.exam.pk}/previews/", {"mode": "unrestricted"}, format="json")
        self.assertEqual(started.status_code, 201)
        self.assertNotIn("grading_guide", started.data["questions"][0])
        preview_id = started.data["id"]
        submitted = self.staff.post(f"/api/previews/{preview_id}/", {
            "answers": {str(self.question.pk): "Synthetic response"}, "answer_revision": 0}, format="json")
        self.assert_private(submitted)
        reviewed = self.staff.get(f"/api/previews/{preview_id}/review/")
        self.assertEqual(reviewed.status_code, 200, reviewed.content)
        self.assertEqual(reviewed.data["questions"][0]["grading_guide"], GUIDE)

    def test_bank_exam_and_back_copies_keep_guide(self):
        bank = self.staff.post("/api/question-bank/", essay(), format="json")
        self.assertEqual(bank.status_code, 201, bank.content)
        created = self.staff.post("/api/exams/", {"title": "Copied synthetic guide", "questions": [bank.data]}, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        copied = self.staff.post("/api/question-bank/", created.data["questions"][0], format="json")
        self.assertEqual(copied.status_code, 201, copied.content)
        for data in (bank.data, created.data["questions"][0], copied.data):
            self.assertEqual(data["grading_guide"], GUIDE)
