from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from .models import (
    AttemptBudget,
    AuditEvent,
    Course,
    Enrollment,
    Exam,
    LearningAssignment,
    Question,
    User,
)
from .services import finalize, identity_for_user, start_attempt
from .tests import make_exam


@override_settings(DEBUG=True)
class OperationsTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            "ops-admin",
            "ops-admin@example.com",
            "Safe-local-password-123",
            role="admin",
        )
        self.instructor = User.objects.create_user("instructor", role="instructor")
        self.learner = User.objects.create_user(
            "participant",
            "participant@example.com",
            "Safe-local-password-123",
            department="Quality",
        )
        self.other = User.objects.create_user("other-participant", department="Quality")
        self.course = Course.objects.create(
            owner=self.instructor,
            title="Required safety",
            published=True,
            blocks=[{"type": "text", "text": "Safety lesson"}],
        )
        self.exam = make_exam(self.instructor)
        self.client = APIClient()
        self.client.force_authenticate(self.instructor)

    def assign(self, **extra):
        data = {
            "kind": "course",
            "target_id": self.course.pk,
            "audience": "people",
            "people": [self.learner.pk],
            "due_at": (timezone.now() - timedelta(days=1)).isoformat(),
        }
        return self.client.post("/api/assignments/", {**data, **extra}, format="json")

    def test_assignment_is_idempotent_and_completion_is_evidence_based(self):
        self.assertEqual(self.assign().status_code, 201)
        self.assertEqual(self.assign(notes="Updated instructions").status_code, 201)
        self.assertEqual(LearningAssignment.objects.count(), 1)
        self.client.force_authenticate(self.learner)
        row = self.client.get("/api/assignments/").data[0]
        self.assertTrue(row["overdue"])
        self.assertEqual(row["status"], "not_started")
        self.assertEqual(row["notes"], "Updated instructions")
        self.client.post(f"/api/courses/{self.course.pk}/complete/", {}, format="json")
        row = self.client.get("/api/assignments/").data[0]
        self.assertEqual(row["status"], "completed")
        self.assertFalse(row["overdue"])
        self.assertIsNotNone(row["completed_at"])

    def test_report_scope_cancellation_preserves_learning_history(self):
        self.assign()
        assignment = LearningAssignment.objects.get()
        Enrollment.objects.create(
            user=self.learner,
            course=self.course,
            progress=100,
            completed_at=timezone.now(),
        )
        stranger = User.objects.create_user("stranger", role="instructor")
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get("/api/assignments/?report=1").data, [])
        self.assertEqual(
            self.client.post(f"/api/assignments/{assignment.pk}/cancel/").status_code,
            404,
        )
        self.assertEqual(self.assign().status_code, 403)
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.get("/api/assignments/?report=1").status_code, 403)
        self.assertEqual(self.client.get("/api/assignments/export/").status_code, 403)
        self.assertEqual(self.assign().status_code, 403)
        self.client.force_authenticate(self.instructor)
        self.assertEqual(
            self.client.post(f"/api/assignments/{assignment.pk}/cancel/").status_code,
            200,
        )
        self.assertEqual(Enrollment.objects.get().progress, 100)
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.get("/api/assignments/").data, [])
        self.client.force_authenticate(self.instructor)
        self.assertEqual(
            self.client.get("/api/assignments/?report=1").data[0]["status"], "cancelled"
        )

    def test_assignment_grants_exam_access_without_resetting_budget(self):
        self.exam.audience = "invitation"
        self.exam.save()
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.get("/api/exams/").data, [])
        self.client.force_authenticate(self.instructor)
        self.assign(kind="exam", target_id=self.exam.pk)
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.get("/api/exams/").data[0]["id"], self.exam.pk)
        started = self.client.post(f"/api/exams/{self.exam.pk}/start/")
        self.assertEqual(started.status_code, 200)
        from .models import Attempt

        attempt = Attempt.objects.get(pk=started.data["id"])
        attempt.answers = {str(q["id"]): q["solution"][0] for q in attempt.snapshot}
        finalize(attempt)
        row = self.client.get("/api/assignments/").data[0]
        self.assertEqual((row["status"], row["score"]), ("completed", 100))
        self.client.force_authenticate(self.instructor)
        self.assign(kind="exam", target_id=self.exam.pk)
        self.assertEqual(AttemptBudget.objects.get().used, 1)
        self.client.post(f"/api/assignments/{row['id']}/cancel/")
        self.client.force_authenticate(self.learner)
        self.assertEqual(
            self.client.post(f"/api/exams/{self.exam.pk}/start/").status_code, 404
        )
        self.assertEqual(
            self.client.get(f"/api/attempts/{attempt.pk}/").status_code, 200
        )

    def test_department_assignment_targets_only_active_users(self):
        self.other.is_active = False
        self.other.save()
        response = self.assign(audience="departments", departments=["Quality"])
        self.assertEqual(response.data["assigned"], 1)
        self.assertEqual(LearningAssignment.objects.get().user, self.learner)
        self.assertEqual(self.assign(people=[self.other.pk]).status_code, 400)
        self.course.published = False
        self.course.save()
        self.assertEqual(self.assign().status_code, 400)

    def test_completion_export_scopes_and_escapes_spreadsheet_formulas(self):
        self.learner.display_name = "=SUM(1,2)"
        self.learner.save()
        self.assign()
        result = self.client.get("/api/assignments/export/")
        self.assertEqual(result.status_code, 200)
        self.assertIn("'=SUM(1,2)", result.content.decode())
        self.assertIn("overdue", result.content.decode())

    def test_question_bank_is_private_and_copies_do_not_change(self):
        payload = {
            "description": "Safe practice?",
            "type": "single",
            "options": ["Unsafe", "Safe"],
            "solution": [1],
            "points": 5,
            "category": "Safety",
        }
        created = self.client.post("/api/question-bank/", payload, format="json")
        self.assertEqual(created.status_code, 201)
        question_id = created.data["id"]
        copied = self.client.post(
            "/api/exams/", {"title": "Copied", "questions": [payload]}, format="json"
        )
        self.assertEqual(copied.status_code, 201)
        self.assertEqual(
            self.client.patch(
                f"/api/question-bank/{question_id}/",
                {"description": "Revised", "archived": True},
                format="json",
            ).status_code,
            200,
        )
        self.assertEqual(
            Exam.objects.get(pk=copied.data["id"]).questions.get().description,
            "Safe practice?",
        )
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.get("/api/question-bank/").status_code, 403)
        self.assertEqual(
            self.client.post("/api/question-bank/", payload, format="json").status_code,
            403,
        )
        self.client.force_authenticate(
            User.objects.create_user("second-instructor", role="instructor")
        )
        self.assertEqual(self.client.get("/api/question-bank/").data, [])
        self.assertEqual(
            self.client.patch(
                f"/api/question-bank/{question_id}/", {"archived": False}, format="json"
            ).status_code,
            404,
        )

    def test_randomized_snapshot_grades_original_correct_options_and_resumes(self):
        for index in range(4):
            Question.objects.create(
                exam=self.exam,
                type="multiple",
                description=f"Question {index}",
                options=["Safe", "Unsafe", "Also safe"],
                solution=[0, 2],
            )
        self.exam.shuffle_questions = self.exam.shuffle_options = True
        self.exam.questions_per_attempt = 3
        self.exam.save()
        with patch("training.services.secrets.SystemRandom") as rng:
            rng.return_value.sample.return_value = [0, 1, 2]
            rng.return_value.shuffle.side_effect = lambda values: values.reverse()
            attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        self.assertEqual(len(attempt.snapshot), 3)
        for q in attempt.snapshot:
            original = self.exam.questions.get(pk=q["id"])
            self.assertEqual(
                {q["options"][i] for i in q["solution"]},
                {original.options[i] for i in original.solution},
            )
        resumed = start_attempt(self.exam.pk, identity_for_user(self.learner))
        self.assertEqual(attempt.snapshot, resumed.snapshot)
        attempt.answers = {str(q["id"]): q["solution"] for q in attempt.snapshot}
        finalize(attempt)
        self.assertEqual(attempt.score, 100)

    def test_invalid_random_pool_is_rejected_without_charging_attempt(self):
        response = self.client.patch(
            f"/api/exams/{self.exam.pk}/", {"questions_per_attempt": 2}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.exam.questions_per_attempt = 2
        self.exam.save()
        with self.assertRaises(ValidationError):
            start_attempt(self.exam.pk, identity_for_user(self.learner))
        self.assertFalse(AttemptBudget.objects.exists())

    def test_people_import_preview_rolls_back_and_apply_is_atomic(self):
        self.client.force_authenticate(self.admin)
        content = "username,email,employee_id,display_name,department,employment\nnew01,new01@example.com,N001,New Person,Quality,contractor\nnew02,new02@example.com,N002,Another Person,Quality,employee\n"
        preview = self.client.post(
            "/api/users/import/", {"csv": content}, format="json"
        )
        self.assertTrue(preview.data["valid"])
        self.assertFalse(User.objects.filter(username="new01").exists())
        self.assertFalse(AuditEvent.objects.filter(action="user.imported").exists())
        applied = self.client.post(
            "/api/users/import/", {"csv": content, "apply": True}, format="json"
        )
        self.assertTrue(applied.data["applied"])
        new = User.objects.get(username="new01")
        self.assertFalse(new.has_usable_password())
        self.assertEqual(new.role, "learner")
        self.assertEqual(identity_for_user(new).key, "email:new01@example.com")
        duplicate = content.replace("new01", "unique03")
        failed = self.client.post(
            "/api/users/import/", {"csv": duplicate, "apply": True}, format="json"
        )
        self.assertFalse(failed.data["applied"])
        self.assertFalse(User.objects.filter(username="unique03").exists())
        self.assertEqual(AuditEvent.objects.filter(action="user.imported").count(), 2)

    def test_people_import_detects_cross_identifier_collisions_inside_batch(self):
        self.client.force_authenticate(self.admin)
        content = "username,email,employee_id\nfirst,first@example.com,ID001\nid001,second@example.com,\n"
        result = self.client.post(
            "/api/users/import/", {"csv": content, "apply": True}, format="json"
        )
        self.assertFalse(result.data["valid"])
        self.assertEqual(result.data["errors"][0]["row"], 3)
        self.assertFalse(User.objects.filter(username="first").exists())
        forbidden = self.client.post(
            "/api/users/import/",
            {"csv": "username,role\nnewadmin,admin", "apply": True},
            format="json",
        )
        self.assertEqual(forbidden.status_code, 400)
        self.client.force_authenticate(self.instructor)
        self.assertEqual(
            self.client.post(
                "/api/users/import/", {"csv": content}, format="json"
            ).status_code,
            403,
        )

    def test_password_change_requires_current_password_and_preserves_current_session(
        self,
    ):
        self.client.force_authenticate(user=None)
        self.client.force_login(self.learner)
        other_session = APIClient()
        other_session.force_login(self.learner)
        payload = {
            "current_password": "wrong",
            "new_password": "New-strong-password-5940",
        }
        self.assertEqual(
            self.client.post("/api/auth/password/", payload, format="json").status_code,
            400,
        )
        payload["current_password"] = "Safe-local-password-123"
        self.assertEqual(
            self.client.post("/api/auth/password/", payload, format="json").status_code,
            200,
        )
        self.assertEqual(
            self.client.get("/api/auth/session/").data["user"]["id"], self.learner.pk
        )
        self.assertIsNone(other_session.get("/api/auth/session/").data["user"])
        self.learner.refresh_from_db()
        self.assertTrue(self.learner.check_password(payload["new_password"]))

    def test_password_change_is_csrf_protected(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.learner)
        self.assertEqual(
            client.post(
                "/api/auth/password/",
                {
                    "current_password": "Safe-local-password-123",
                    "new_password": "Different-password-9546",
                },
                format="json",
            ).status_code,
            403,
        )

    def test_demoted_course_owner_cannot_access_draft(self):
        self.course.published = False
        self.course.save()
        self.instructor.role = "learner"
        self.instructor.save()
        self.assertEqual(
            self.client.get(f"/api/courses/{self.course.pk}/").status_code, 404
        )

    @override_settings(
        ENTRA_CLIENT_SECRET="must-not-be-returned",
        ENTRA_TENANT_ID="tenant-id",
        ENTRA_CLIENT_ID="client-id",
    )
    def test_readiness_is_admin_only_and_never_returns_secrets(self):
        self.assertEqual(self.client.get("/api/readiness/").status_code, 403)
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/readiness/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["entra_configured"])
        self.assertNotIn("must-not-be-returned", str(response.data))
        self.assertNotIn("tenant-id", str(response.data))
        self.assertFalse(response.data["ready"])

    def test_people_import_rejects_malformed_headers_and_empty_input(self):
        self.client.force_authenticate(self.admin)
        for content in ['"username,broken', "username\n", "username,username\na,b"]:
            with self.subTest(content=content):
                response = self.client.post(
                    "/api/users/import/", {"csv": content, "apply": True}, format="json"
                )
                self.assertEqual(response.status_code, 400)
