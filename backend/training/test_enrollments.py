import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import (
    AuditEvent,
    Course,
    Enrollment,
    LearningAssignment,
    ScormPackage,
    ScormState,
    User,
)


@override_settings(DEBUG=True)
class EnrollmentTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("course-owner", role="instructor")
        self.learner = User.objects.create_user(
            "applicant", display_name="Taylor", department="Operations"
        )
        self.other = User.objects.create_user("other-owner", role="instructor")
        self.admin = User.objects.create_user("administrator", role="admin")
        self.course = Course.objects.create(
            title="Approval course",
            owner=self.owner,
            published=True,
            requires_approval=True,
            blocks=[{"type": "text", "text": "Private lesson content"}],
        )
        self.root = f"/api/courses/{self.course.pk}/"
        self.participant = APIClient()
        self.participant.force_authenticate(self.learner)
        self.manager = APIClient()
        self.manager.force_authenticate(self.owner)

    def request(self, **extra):
        return self.participant.post(
            self.root + "enroll/", {"note": "For my role", **extra}, format="json"
        )

    def decide(self, decision="approved", **extra):
        row = Enrollment.objects.get(course=self.course, user=self.learner)
        return self.manager.post(
            self.root + f"enrollments/{row.pk}/review/",
            {
                "revision": row.revision,
                "decision": decision,
                "note": "Reviewed",
                **extra,
            },
            format="json",
        )

    def test_request_approval_content_and_completion_flow(self):
        detail = self.participant.get(self.root)
        self.assertEqual(detail["Cache-Control"], "no-store")
        self.assertFalse(detail.data["can_learn"])
        self.assertEqual(detail.data["blocks"], [])
        self.assertEqual(self.participant.get("/api/courses/").data[0]["blocks"], [])
        self.assertEqual(
            self.participant.post(self.root + "complete/").status_code, 403
        )
        requested = self.request()
        self.assertEqual(requested.status_code, 200)
        self.assertEqual(requested.data["status"], "pending")
        self.assertEqual(self.request().data, requested.data)
        self.assertEqual(
            AuditEvent.objects.filter(action="enrollment.requested").count(), 1
        )
        self.assertEqual(self.participant.get("/api/dashboard/").data["enrollments"], 0)
        self.assertIsNone(self.participant.get(self.root).data["progress"])
        self.assertEqual(self.manager.get(self.root + "enrollments/").data["count"], 1)
        self.assertEqual(self.decide().status_code, 200)
        detail = self.participant.get(self.root).data
        self.assertTrue(detail["can_learn"])
        self.assertEqual(detail["blocks"], self.course.blocks)
        self.assertEqual(detail["enrolled_count"], 1)
        self.assertEqual(
            self.participant.post(self.root + "complete/").status_code, 200
        )
        self.assertEqual(Enrollment.objects.get().progress, 100)

    def test_rejection_reapplication_removal_restore_and_history(self):
        self.request()
        self.assertEqual(self.decide("rejected", note="").status_code, 400)
        self.assertEqual(self.decide("removed").status_code, 400)
        self.assertEqual(
            self.decide("rejected", note="Complete prerequisites").status_code, 200
        )
        self.assertEqual(self.request().status_code, 409)
        row = Enrollment.objects.get()
        self.assertEqual(self.request(revision=row.revision).data["status"], "pending")
        self.assertEqual(self.decide().status_code, 200)
        LearningAssignment.objects.create(
            user=self.learner, course=self.course, created_by=self.owner
        )
        self.participant.post(self.root + "complete/")
        row.refresh_from_db()
        completion = row.completed_at
        self.assertEqual(self.decide("removed").status_code, 200)
        row.refresh_from_db()
        self.assertEqual((row.progress, row.completed_at), (100, completion))
        self.assertFalse(self.participant.get(self.root).data["can_learn"])
        self.assertEqual(
            self.participant.get("/api/assignments/").data[0]["status"], "completed"
        )
        self.assertEqual(self.participant.get("/api/dashboard/").data["completed"], 1)
        self.assertEqual(self.request(revision=row.revision).status_code, 403)
        self.assertEqual(
            self.participant.post(self.root + "complete/").status_code, 403
        )
        self.assertEqual(self.decide().status_code, 200)
        self.assertTrue(self.participant.get(self.root).data["can_learn"])
        events = AuditEvent.objects.filter(action__startswith="enrollment.").order_by(
            "id"
        )
        self.assertEqual(events.count(), 6)
        removed = events.get(action="enrollment.removed")
        self.assertEqual(removed.detail["before"]["progress"], 100)
        self.assertEqual(removed.detail["after"]["status"], "removed")
        self.assertEqual(removed.detail["after"]["review_note"], "Reviewed")

    def test_stale_reviews_and_lost_responses_do_not_repeat_decisions(self):
        first = self.request().data
        approved = self.decide(revision=first["revision"])
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(self.decide(revision=first["revision"]).data, approved.data)
        self.assertEqual(
            AuditEvent.objects.filter(action="enrollment.approved").count(), 1
        )
        self.assertEqual(
            self.decide("rejected", revision=first["revision"]).status_code, 409
        )
        self.manager.force_authenticate(self.admin)
        self.assertEqual(self.decide(revision=first["revision"]).status_code, 409)
        self.assertEqual(self.decide("removed").status_code, 200)
        self.manager.force_authenticate(self.owner)
        self.assertEqual(self.decide(revision=first["revision"]).status_code, 409)

    def test_scope_csrf_validation_and_private_participant_data(self):
        self.request()
        row = Enrollment.objects.get()
        for user in (self.learner, self.other):
            self.manager.force_authenticate(user)
            self.assertEqual(
                self.manager.get(self.root + "enrollments/").status_code, 403
            )
            self.assertEqual(self.decide().status_code, 403)
            self.assertEqual(
                self.manager.patch(
                    self.root, {"requires_approval": False}, format="json"
                ).status_code,
                403,
            )
        self.assertIsNone(self.manager.get(self.root).data["enrollment"])
        self.manager.force_authenticate(self.owner)
        other_course = Course.objects.create(title="Other", owner=self.owner)
        response = self.manager.post(
            f"/api/courses/{other_course.pk}/enrollments/{row.pk}/review/",
            {"revision": 1, "decision": "approved", "note": ""},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        csrf = APIClient(enforce_csrf_checks=True)
        csrf.force_login(self.owner)
        self.assertEqual(
            csrf.post(self.root + f"enrollments/{row.pk}/review/", {}).status_code, 403
        )
        self.assertEqual(self.decide(note="x" * 1001).status_code, 400)
        self.assertEqual(self.decide(revision=-1).status_code, 400)
        self.assertEqual(self.decide("unknown").status_code, 400)
        User.objects.filter(pk=self.learner.pk).update(is_active=False)
        self.assertEqual(self.decide().status_code, 400)

    def test_policy_changes_keep_existing_enrollments_and_pending_requests(self):
        self.course.requires_approval = False
        self.course.save()
        self.assertEqual(self.request().data["status"], "approved")
        self.assertEqual(
            self.manager.patch(
                self.root, {"requires_approval": True}, format="json"
            ).status_code,
            200,
        )
        self.assertTrue(self.participant.get(self.root).data["can_learn"])
        self.participant.force_authenticate(self.other)
        self.assertEqual(self.request().data["status"], "pending")
        self.assertEqual(
            self.manager.patch(
                self.root, {"requires_approval": False}, format="json"
            ).status_code,
            200,
        )
        self.assertFalse(self.participant.get(self.root).data["can_learn"])
        self.assertEqual(self.request().data["status"], "pending")
        self.assertEqual(
            self.manager.patch(
                self.root, {"published": False}, format="json"
            ).status_code,
            200,
        )
        self.assertEqual(self.participant.get(self.root).status_code, 404)
        self.assertTrue(self.manager.get(self.root).data["can_learn"])
        self.assertEqual(
            self.manager.post(self.root + "enroll/").data["status"], "approved"
        )

    def test_assignments_do_not_bypass_approval_and_pending_is_not_learning(self):
        LearningAssignment.objects.create(
            user=self.learner, course=self.course, created_by=self.owner
        )
        self.assertFalse(self.participant.get(self.root).data["can_learn"])
        self.request()
        row = self.participant.get("/api/assignments/").data[0]
        self.assertEqual((row["status"], row["progress"]), ("awaiting_approval", 0))
        self.assertEqual(self.participant.get("/api/dashboard/").data["enrollments"], 0)
        self.decide()
        self.assertEqual(
            self.participant.get("/api/assignments/").data[0]["status"], "in_progress"
        )

    def test_search_pagination_and_localized_errors(self):
        self.request()
        Enrollment.objects.bulk_create(
            [
                Enrollment(
                    course=self.course,
                    user=User.objects.create_user(f"applicant-{i}"),
                    status="pending",
                )
                for i in range(22)
            ]
        )
        result = self.manager.get(self.root + "enrollments/").data
        self.assertEqual((result["count"], len(result["results"])), (23, 20))
        result = self.manager.get(self.root + "enrollments/?page=2").data
        self.assertEqual(len(result["results"]), 3)
        result = self.manager.get(self.root + "enrollments/?search=Operations").data
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["results"][0]["person"], "Taylor")
        self.assertEqual(
            self.manager.get(self.root + "enrollments/?page=bad").status_code, 400
        )
        self.assertEqual(
            self.manager.get(self.root + "enrollments/?status=bad").status_code, 400
        )
        response = self.participant.post(
            self.root + "complete/", HTTP_ACCEPT_LANGUAGE="zh-hant"
        )
        self.assertIn("核准", str(response.data))
        response = self.participant.post(
            self.root + "complete/", HTTP_ACCEPT_LANGUAGE="es"
        )
        self.assertIn("aprobación", str(response.data))

    def test_review_and_request_audit_failure_roll_back_state(self):
        with patch(
            "training.enrollments.audit",
            side_effect=RuntimeError("storage unavailable"),
        ):
            with self.assertRaises(RuntimeError):
                self.request()
        self.assertFalse(Enrollment.objects.exists())
        self.request()
        with patch(
            "training.enrollments.audit",
            side_effect=RuntimeError("storage unavailable"),
        ):
            with self.assertRaises(RuntimeError):
                self.decide()
        self.assertEqual(Enrollment.objects.get().status, "pending")

    def test_scorm_gate_revokes_tickets_cookies_and_writes_without_losing_state(self):
        package = ScormPackage.objects.create(
            course=self.course, title="Lesson", version="1.2", launch_path="index.html"
        )
        launch_path = f"/api/scorm/{package.pk}/launch/"
        commit_path = f"/api/scorm/{package.pk}/commit/"
        self.assertEqual(self.participant.post(launch_path).status_code, 403)
        self.request()
        self.assertEqual(self.participant.post(launch_path).status_code, 403)
        self.decide()
        launched = self.participant.post(launch_path).data
        ticket = parse_qs(urlsplit(launched["url"]).query)["ticket"][0]
        payload = {
            "nonce": launched["nonce"],
            "cmi": {
                "cmi.core.lesson_status": "completed",
                "cmi.suspend_data": "saved bookmark",
            },
        }
        self.assertEqual(
            self.participant.post(commit_path, payload, format="json").status_code, 200
        )
        with (
            tempfile.TemporaryDirectory() as directory,
            override_settings(MEDIA_ROOT=Path(directory)),
        ):
            root = Path(directory) / "packages" / str(package.pk)
            root.mkdir(parents=True)
            (root / "index.html").write_text("Private lesson")
            content = APIClient()
            path = f"/packages/{package.pk}/index.html"
            with override_settings(ROOT_URLCONF="config.content_urls"):
                self.assertEqual(
                    content.get("/launch", {"ticket": ticket}).status_code, 200
                )
                allowed = content.get(path)
                self.assertEqual(allowed.status_code, 200)
            self.decide("removed")
            with override_settings(ROOT_URLCONF="config.content_urls"):
                self.assertEqual(content.get(path).status_code, 403)
                self.assertEqual(
                    content.get("/launch", {"ticket": ticket}).status_code, 403
                )
            self.assertEqual(self.participant.post(launch_path).status_code, 403)
            payload["cmi"]["cmi.suspend_data"] = "overwritten"
            self.assertEqual(
                self.participant.post(commit_path, payload, format="json").status_code,
                403,
            )
            self.assertEqual(
                ScormState.objects.get().cmi["cmi.suspend_data"], "saved bookmark"
            )
            self.assertEqual(Enrollment.objects.get().progress, 100)
            self.decide()
            with override_settings(ROOT_URLCONF="config.content_urls"):
                restored = content.get("/launch", {"ticket": ticket})
                self.assertContains(restored, "saved bookmark")
                User.objects.filter(pk=self.learner.pk).update(is_active=False)
                self.assertEqual(content.get(path).status_code, 403)


@override_settings(DEBUG=True)
class ConcurrentEnrollmentTests(TransactionTestCase):
    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("Row-lock verification requires PostgreSQL.")
        self.owner = User.objects.create_user("concurrent-owner", role="instructor")
        self.learner = User.objects.create_user("concurrent-learner")
        self.course = Course.objects.create(
            owner=self.owner,
            title="Course",
            published=True,
            requires_approval=True,
            blocks=[{"type": "text", "text": "Content"}],
        )
        self.root = f"/api/courses/{self.course.pk}/"

    def post(self, user_id, path, data=None):
        try:
            client = APIClient()
            client.force_authenticate(User.objects.get(pk=user_id))
            return client.post(path, data or {}, format="json").status_code
        finally:
            connections.close_all()

    def test_duplicate_requests_and_reviews_commit_once(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(
                pool.map(
                    lambda _: self.post(self.learner.pk, self.root + "enroll/"),
                    range(2),
                )
            )
        self.assertEqual(statuses, [200, 200])
        row = Enrollment.objects.get()
        self.assertEqual(
            AuditEvent.objects.filter(action="enrollment.requested").count(), 1
        )
        path = self.root + f"enrollments/{row.pk}/review/"
        data = {"revision": row.revision, "decision": "approved", "note": "Reviewed"}
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(
                pool.map(lambda _: self.post(self.owner.pk, path, data), range(2))
            )
        self.assertEqual(statuses, [200, 200])
        self.assertEqual(
            AuditEvent.objects.filter(action="enrollment.approved").count(), 1
        )

    def test_conflicting_review_has_one_winner(self):
        row = Enrollment.objects.create(
            course=self.course, user=self.learner, status="pending"
        )
        path = self.root + f"enrollments/{row.pk}/review/"
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(
                pool.map(
                    lambda decision: self.post(
                        self.owner.pk,
                        path,
                        {"revision": 0, "decision": decision, "note": "Reviewed"},
                    ),
                    ["approved", "rejected"],
                )
            )
        self.assertEqual(sorted(statuses), [200, 409])
        self.assertEqual(
            AuditEvent.objects.filter(action__startswith="enrollment.").count(), 1
        )

    def test_removal_racing_completion_preserves_serial_order(self):
        row = Enrollment.objects.create(course=self.course, user=self.learner)
        path = self.root + f"enrollments/{row.pk}/review/"
        with ThreadPoolExecutor(max_workers=2) as pool:
            removal = pool.submit(
                self.post,
                self.owner.pk,
                path,
                {"revision": 0, "decision": "removed", "note": "Access ended"},
            )
            completion = pool.submit(
                self.post, self.learner.pk, self.root + "complete/"
            )
            self.assertEqual(removal.result(timeout=10), 200)
            completed = completion.result(timeout=10)
        row.refresh_from_db()
        self.assertEqual(row.status, "removed")
        self.assertEqual(row.progress, 100 if completed == 200 else 0)
        self.assertIn(completed, (200, 403))
        self.assertEqual(self.post(self.learner.pk, self.root + "complete/"), 403)
