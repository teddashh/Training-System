import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from unittest.mock import patch

from django.conf import settings
from django.core.management import call_command
from django.db import connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    Attempt,
    AttemptBudget,
    AttemptTimeExtension,
    AuditEvent,
    ExamPreview,
    Invitation,
    User,
)
from .services import (
    finalize,
    hash_token,
    identity_for_user,
    resolve_identity,
    start_attempt,
)
from .tests import make_exam


@override_settings(DEBUG=True)
class MonitoringTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("monitor-owner", role="instructor")
        self.learner = User.objects.create_user(
            "monitor-learner",
            "monitor@example.com",
            display_name="Morgan Learner",
            employee_id="MON-001",
            department="Operations",
        )
        self.exam = make_exam(self.owner, essay=True)
        self.attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        self.manager = APIClient()
        self.manager.force_authenticate(self.owner)
        self.participant = APIClient()
        self.participant.force_authenticate(self.learner)
        self.monitor = f"/api/exams/{self.exam.pk}/monitor/"
        self.detail = f"/api/attempts/{self.attempt.pk}/"
        self.extensions = self.detail + "extensions/"

    def grant(self, **overrides):
        return self.manager.post(
            self.extensions,
            {
                "request_id": str(uuid.uuid4()),
                "minutes": 10,
                "reason": "Network interruption",
                **overrides,
            },
            format="json",
        )

    def test_scoped_monitor_counts_saved_progress_and_excludes_preview_and_answers(
        self,
    ):
        self.manager.post(
            f"/api/exams/{self.exam.pk}/previews/", {"mode": "unrestricted"}
        )
        self.assertEqual(ExamPreview.objects.count(), 1)
        key = str(self.attempt.snapshot[0]["id"])
        self.participant.patch(
            self.detail, {"answers": {key: 0}, "answer_revision": 0}, format="json"
        )
        data = self.manager.get(self.monitor).data
        self.assertEqual(
            data["summary"],
            {
                "total": 1,
                "in_progress": 1,
                "pending_review": 0,
                "graded": 0,
                "recent": 1,
            },
        )
        row = data["results"][0]
        self.assertEqual(
            (row["answered"], row["question_count"], row["person"]),
            (1, 2, "Morgan Learner"),
        )
        self.assertTrue(row["last_saved_at"])
        for private in [
            "answers",
            "questions",
            "snapshot",
            "solution",
            "manual_grades",
        ]:
            self.assertNotIn(private, row)
        other = User.objects.create_user("unrelated-monitor", role="instructor")
        for user in (self.learner, other):
            self.manager.force_authenticate(user)
            self.assertEqual(self.manager.get(self.monitor).status_code, 403)
            self.assertEqual(self.manager.get(self.extensions).status_code, 403)
            self.assertEqual(self.grant().status_code, 403)
        admin = User.objects.create_user("monitor-admin", role="admin")
        self.manager.force_authenticate(admin)
        self.assertEqual(self.manager.get(self.monitor).status_code, 200)
        self.assertEqual(self.grant().status_code, 201)
        self.assertEqual(
            self.manager.post(self.detail + "heartbeat/", {}).status_code, 404
        )

    def test_filters_pagination_expiry_and_recent_contact_are_truthful(self):
        Attempt.objects.filter(pk=self.attempt.pk).update(
            deadline=timezone.now() - timedelta(seconds=1)
        )
        second = start_attempt(self.exam.pk, self.attempt.identity)
        Attempt.objects.filter(pk=second.pk).update(
            last_seen_at=timezone.now() - timedelta(seconds=61)
        )
        data = self.manager.get(
            self.monitor, {"search": "MON-001", "page_size": 1}
        ).data
        self.assertEqual(
            (data["count"], data["pages"], data["summary"]["recent"]), (2, 2, 0)
        )
        self.assertEqual(data["results"][0]["id"], str(second.pk))
        self.assertFalse(data["results"][0]["recent"])
        data = self.manager.get(
            self.monitor, {"number": 1, "status": "pending_review"}
        ).data
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["summary"]["in_progress"], 0)
        self.assertEqual(
            self.manager.get(self.monitor, {"search": "absent"}).data["count"], 0
        )
        for params in [
            {"number": 0},
            {"page_size": 101},
            {"page": "no"},
            {"status": "unknown"},
        ]:
            self.assertEqual(self.manager.get(self.monitor, params).status_code, 400)
        Attempt.objects.filter(pk=second.pk).update(
            deadline=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(
            self.manager.get(self.monitor, {"status": "pending_review"}).data["count"],
            2,
        )
        self.assertEqual(
            AuditEvent.objects.filter(action="attempt.submitted").count(), 2
        )

    def test_extension_is_idempotent_audited_and_preserves_all_participant_evidence(
        self,
    ):
        key = str(self.attempt.snapshot[0]["id"])
        self.participant.patch(self.detail, {"answers": {key: 1}}, format="json")
        before = Attempt.objects.values().get(pk=self.attempt.pk)
        request_id = str(uuid.uuid4())
        first = self.grant(request_id=request_id)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(self.grant(request_id=request_id).status_code, 200)
        self.assertEqual(self.grant(request_id=request_id, minutes=11).status_code, 409)
        after = Attempt.objects.values().get(pk=self.attempt.pk)
        for field in before.keys() - {"deadline", "extra_time_minutes"}:
            self.assertEqual(before[field], after[field], field)
        self.assertEqual(after["deadline"], before["deadline"] + timedelta(minutes=10))
        self.assertEqual(after["extra_time_minutes"], 10)
        self.assertEqual(AttemptBudget.objects.get().used, 1)
        self.assertEqual(Attempt.objects.count(), 1)
        event = AuditEvent.objects.get(action="attempt.time_extended")
        self.assertEqual(event.actor, self.owner)
        self.assertEqual(event.detail["reason"], "Network interruption")
        self.assertEqual(event.detail["new_deadline"], after["deadline"].isoformat())
        self.assertEqual(self.manager.get(self.extensions).data["count"], 1)
        self.attempt.refresh_from_db()
        finalize(self.attempt)
        self.assertEqual(self.grant(request_id=request_id).status_code, 200)
        self.assertEqual(AttemptTimeExtension.objects.count(), 1)

    def test_extension_validation_bounds_and_completed_attempts_stay_closed(self):
        for minutes in [0, -1, 241, 1.5, True, None]:
            self.assertEqual(self.grant(minutes=minutes).status_code, 400)
        for reason in ["", "   ", "x" * 501, None]:
            self.assertEqual(self.grant(reason=reason).status_code, 400)
        self.assertEqual(self.grant(request_id="bad").status_code, 400)
        Attempt.objects.filter(pk=self.attempt.pk).update(extra_time_minutes=1439)
        self.assertEqual(self.grant(minutes=2).status_code, 400)
        self.assertEqual(self.grant(minutes=1).status_code, 201)
        self.assertEqual(self.grant(minutes=1).status_code, 400)
        Attempt.objects.filter(pk=self.attempt.pk).update(
            deadline=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(self.grant().status_code, 409)
        self.attempt.refresh_from_db()
        finalize(self.attempt)
        self.assertEqual(self.grant().status_code, 409)
        self.assertEqual(AttemptTimeExtension.objects.count(), 1)

    def test_heartbeat_updates_contact_without_changing_answers_or_revision(self):
        before = Attempt.objects.values().get(pk=self.attempt.pk)
        self.participant.get(self.detail)
        self.assertEqual(Attempt.objects.values().get(pk=self.attempt.pk), before)
        response = self.participant.post(
            self.detail + "heartbeat/", {"answers": {"bad": "discard"}}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(response.data),
            {"deadline", "extra_time_minutes", "status", "server_time"},
        )
        self.assertIn("no-store", response["Cache-Control"])
        after = Attempt.objects.values().get(pk=self.attempt.pk)
        for field in before.keys() - {"last_seen_at"}:
            self.assertEqual(before[field], after[field], field)
        self.assertGreater(after["last_seen_at"], before["last_seen_at"])
        self.grant()
        updated = self.participant.post(self.detail + "heartbeat/", {}).data
        self.assertEqual(
            updated["deadline"], before["deadline"] + timedelta(minutes=10)
        )
        self.assertEqual(updated["extra_time_minutes"], 10)

    def test_heartbeat_timeout_finalizes_saved_answers_once_and_never_accepts_late_payload(
        self,
    ):
        key = str(self.attempt.snapshot[0]["id"])
        self.participant.patch(self.detail, {"answers": {key: 1}}, format="json")
        Attempt.objects.filter(pk=self.attempt.pk).update(
            deadline=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(
            self.participant.post(self.detail + "heartbeat/", {}).data["status"],
            "pending_review",
        )
        self.participant.post(self.detail, {"answers": {key: 0}}, format="json")
        self.participant.post(self.detail + "heartbeat/", {})
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.answers, {key: 1})
        self.assertEqual(self.attempt.answer_revision, 1)
        self.assertEqual(
            AuditEvent.objects.filter(action="attempt.submitted").count(), 1
        )

    def test_extended_account_and_guest_resume_after_exam_close_without_budget_charge(
        self,
    ):
        closed = timezone.now() + timedelta(minutes=2)
        self.exam.ends_at = closed
        self.exam.save()
        Attempt.objects.filter(pk=self.attempt.pk).update(deadline=closed)
        invitation = Invitation.objects.create(
            exam=self.exam,
            identity=self.attempt.identity,
            created_by=self.owner,
            token_hash=hash_token("monitor-guest"),
            max_attempts=1,
            expires_at=timezone.now() + timedelta(days=1),
        )
        guest = APIClient()
        self.assertEqual(
            guest.post("/api/guest/exchange/", {"token": "monitor-guest"}).status_code,
            200,
        )
        self.assertEqual(self.grant(minutes=10).status_code, 201)
        with patch(
            "django.utils.timezone.now", return_value=closed + timedelta(minutes=1)
        ):
            account = self.participant.post(
                f"/api/exams/{self.exam.pk}/start/", {}
            ).data
            linked = guest.post("/api/guest/exam/", {}).data
            self.assertEqual(account["id"], str(self.attempt.pk))
            self.assertEqual(linked["id"], str(self.attempt.pk))
            self.assertEqual(
                guest.post(self.detail + "heartbeat/", {}).data["status"], "in_progress"
            )
            other = User.objects.create_user("late-monitor")
            self.participant.force_authenticate(other)
            self.assertEqual(
                self.participant.post(
                    f"/api/exams/{self.exam.pk}/start/", {}
                ).status_code,
                403,
            )
        invitation.refresh_from_db()
        self.assertEqual(invitation.used, 0)
        self.assertEqual(AttemptBudget.objects.get().used, 1)

    def test_guest_monitoring_access_and_invitation_revocation_and_expiry(self):
        identity = resolve_identity("outside-monitor@example.com")
        invitation = Invitation.objects.create(
            exam=self.exam,
            identity=identity,
            created_by=self.owner,
            token_hash=hash_token("external-monitor"),
            max_attempts=1,
            expires_at=timezone.now() + timedelta(days=1),
        )
        guest = APIClient()
        guest.post("/api/guest/exchange/", {"token": "external-monitor"})
        data = guest.post("/api/guest/exam/", {}).data
        endpoint = f"/api/attempts/{data['id']}/"
        self.assertEqual(guest.post(endpoint + "heartbeat/", {}).status_code, 200)
        self.assertEqual(guest.post(self.detail + "heartbeat/", {}).status_code, 403)
        self.assertEqual(guest.get(self.monitor).status_code, 403)
        self.assertEqual(guest.get(endpoint + "extensions/").status_code, 403)
        self.assertEqual(self.manager.get(self.monitor).data["count"], 2)
        self.extensions = endpoint + "extensions/"
        self.assertEqual(self.grant().status_code, 201)
        invitation.expires_at = timezone.now() - timedelta(seconds=1)
        invitation.save()
        self.assertEqual(guest.post(endpoint + "heartbeat/", {}).status_code, 403)
        invitation.expires_at = timezone.now() + timedelta(days=1)
        invitation.revoked = True
        invitation.save()
        self.assertEqual(guest.post(endpoint + "heartbeat/", {}).status_code, 403)

    def test_unsafe_monitor_endpoints_require_csrf_and_preview_ids_are_not_real_attempts(
        self,
    ):
        self.learner.set_password("Monitor-test-pass-2026")
        self.learner.save()
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.learner)
        client.get("/api/auth/session/")
        self.assertEqual(client.post(self.detail + "heartbeat/", {}).status_code, 403)
        csrf = client.cookies[settings.CSRF_COOKIE_NAME].value
        self.assertEqual(
            client.post(
                self.detail + "heartbeat/", {}, HTTP_X_CSRFTOKEN=csrf
            ).status_code,
            200,
        )
        client.force_login(self.owner)
        self.assertEqual(client.post(self.extensions, {}).status_code, 403)
        response = self.manager.post(
            f"/api/exams/{self.exam.pk}/previews/", {"mode": "unrestricted"}
        )
        for suffix in ("heartbeat/", "extensions/"):
            self.assertEqual(
                self.manager.post(
                    f"/api/attempts/{response.data['id']}/{suffix}", {}
                ).status_code,
                404,
            )
        self.owner.role = "learner"
        self.owner.save()
        self.manager.force_authenticate(self.owner)
        self.assertEqual(self.grant().status_code, 403)


@override_settings(DEBUG=True)
class ConcurrentMonitoringTests(TransactionTestCase):
    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("Row-lock verification requires PostgreSQL.")
        self.owner = User.objects.create_user("concurrent-monitor", role="instructor")
        self.exam = make_exam(self.owner)
        self.attempt = start_attempt(self.exam.pk, identity_for_user(self.owner))
        self.endpoint = f"/api/attempts/{self.attempt.pk}/"

    def request(self, suffix, payload, method="post"):
        try:
            client = APIClient()
            client.force_authenticate(User.objects.get(pk=self.owner.pk))
            return getattr(client, method)(
                self.endpoint + suffix, payload, format="json"
            ).status_code
        finally:
            connections.close_all()

    def test_concurrent_duplicate_and_distinct_grants_apply_exactly_once(self):
        payload = {
            "request_id": str(uuid.uuid4()),
            "minutes": 5,
            "reason": "Connection recovery",
        }
        before = self.attempt.deadline
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(lambda _: self.request("extensions/", payload), range(2))
            )
        self.assertEqual(sorted(results), [200, 201])
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(
                    lambda _: self.request(
                        "extensions/", {**payload, "request_id": str(uuid.uuid4())}
                    ),
                    range(2),
                )
            )
        self.assertEqual(results, [201, 201])
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.deadline, before + timedelta(minutes=15))
        self.assertEqual(self.attempt.extra_time_minutes, 15)
        self.assertEqual(AttemptTimeExtension.objects.count(), 3)
        self.assertEqual(
            AuditEvent.objects.filter(action="attempt.time_extended").count(), 3
        )

    def test_submit_racing_extension_never_reopens_a_submission(self):
        payload = {"request_id": str(uuid.uuid4()), "minutes": 5, "reason": "Recovery"}
        key = str(self.attempt.snapshot[0]["id"])
        with ThreadPoolExecutor(max_workers=2) as pool:
            grant = pool.submit(self.request, "extensions/", payload)
            submit = pool.submit(
                self.request, "", {"answers": {key: 1}, "answer_revision": 0}
            )
            statuses = (grant.result(timeout=10), submit.result(timeout=10))
        self.assertIn(statuses, [(201, 200), (409, 200)])
        self.attempt.refresh_from_db()
        self.assertEqual(
            (self.attempt.status, self.attempt.score, self.attempt.answer_revision),
            ("graded", 100, 1),
        )
        self.assertEqual(
            AuditEvent.objects.filter(action="attempt.submitted").count(), 1
        )

    def test_expiry_worker_reports_and_monitor_recheck_deadline_after_lock_wait(self):
        for consumer in ("worker", "results", "monitor"):
            with self.subTest(consumer=consumer):
                Attempt.objects.filter(pk=self.attempt.pk).update(
                    deadline=timezone.now() - timedelta(seconds=1)
                )
                waiting = Event()

                def observe(execute, sql, params, many, context, waiting=waiting):
                    if "FOR UPDATE" in sql:
                        waiting.set()
                    return execute(sql, params, many, context)

                def expire(consumer=consumer, observe=observe):
                    try:
                        with connection.execute_wrapper(observe):
                            if consumer == "worker":
                                out = io.StringIO()
                                call_command("expire_attempts", stdout=out)
                                return out.getvalue()
                            client = APIClient()
                            client.force_authenticate(
                                User.objects.get(pk=self.owner.pk)
                            )
                            path = (
                                "/api/results/"
                                if consumer == "results"
                                else f"/api/exams/{self.exam.pk}/monitor/"
                            )
                            return client.get(path).status_code
                    finally:
                        connections.close_all()

                with ThreadPoolExecutor(max_workers=1) as pool:
                    with transaction.atomic():
                        row = Attempt.objects.select_for_update().get(
                            pk=self.attempt.pk
                        )
                        # A grant began before expiry and is about to commit.
                        row.deadline = timezone.now() + timedelta(minutes=5)
                        row.save(update_fields=["deadline"])
                        pending = pool.submit(expire)
                        self.assertTrue(waiting.wait(timeout=5))
                    result = pending.result(timeout=10)
                self.assertEqual(
                    result,
                    "Finalized 0 expired attempts.\n" if consumer == "worker" else 200,
                )
                self.attempt.refresh_from_db()
                self.assertEqual(self.attempt.status, "in_progress")
        self.assertFalse(AuditEvent.objects.filter(action="attempt.submitted").exists())
