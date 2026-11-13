import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    AttemptBudget,
    AuditEvent,
    Identity,
    Invitation,
    InvitationBatch,
    User,
)
from .services import hash_token, identity_for_user, start_attempt
from .tests import make_exam


@override_settings(DEBUG=True)
class InvitationWorkflowTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("organizer", role="admin")
        self.member = User.objects.create_user(
            "member",
            "member@example.com",
            employee_id="EMP101",
            display_name="Member One",
        )
        self.exam = make_exam(self.admin)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def payload(self, **changes):
        return {
            "exam": self.exam.pk,
            "csv": "key,verification_email\nEMP101,\nguest@example.com,\n",
            "request_id": str(uuid.uuid4()),
            "apply": False,
            **changes,
        }

    def bulk(self, payload):
        return self.client.post("/api/invitations/bulk/", payload, format="json")

    @override_settings(APP_ORIGIN="https://learn.example.test", APP_BASE_PATH="/training")
    def test_subpath_is_retained_in_single_batch_and_replayed_guest_links(self):
        one = self.client.post("/api/invitations/issue/", {
            "exam": self.exam.pk, "key": "single@example.com",
            "require_email_verification": False,
        }, format="json")
        self.assertEqual(one.status_code, 201, one.content)
        self.assertTrue(one.json()["url"].startswith("https://learn.example.test/training/invite#"))
        payload = self.payload(apply=True, require_email_verification=False)
        first = self.bulk(payload)
        replay = self.bulk(payload)
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(first.json()["invitations"], replay.json()["invitations"])
        for invitation in first.json()["invitations"]:
            self.assertTrue(invitation["url"].startswith("https://learn.example.test/training/invite#"))

    def test_preview_validates_without_persisting_accounts_identities_or_links(self):
        before = Identity.objects.count()
        result = self.bulk(self.payload()).json()
        self.assertTrue(result["valid"], result)
        self.assertFalse(result["applied"])
        self.assertEqual(result["rows"][0]["verification_email"], self.member.email)
        self.assertEqual(result["rows"][0]["participant"], "Member One")
        self.assertEqual(Identity.objects.count(), before)
        self.assertFalse(Invitation.objects.exists())
        self.assertFalse(InvitationBatch.objects.exists())
        self.assertFalse(AuditEvent.objects.exists())
        self.assertEqual(User.objects.count(), 2)

    def test_alias_duplicates_and_invalid_rows_roll_back_entire_apply(self):
        data = self.payload(
            csv="key,verification_email\nfresh@example.com,\nEMP101,\n MEMBER@example.com,\nbad-address@,\n",
            apply=True,
        )
        result = self.bulk(data).json()
        self.assertFalse(result["valid"], result)
        self.assertTrue(result["rows"][2]["error"])
        self.assertTrue(result["rows"][3]["error"])
        self.assertFalse(Invitation.objects.exists())
        self.assertFalse(InvitationBatch.objects.exists())
        self.assertFalse(Identity.objects.exists())
        self.assertFalse(AuditEvent.objects.exists())

    def test_batch_replay_returns_same_links_and_preserves_identity_budget(self):
        identity = identity_for_user(self.member)
        AttemptBudget.objects.create(exam=self.exam, identity=identity, used=2)
        data = self.payload(apply=True, require_email_verification=False)
        response = self.bulk(data)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response["Cache-Control"], "no-store")
        first = response.json()
        self.assertEqual(Invitation.objects.count(), 2)
        self.assertEqual(InvitationBatch.objects.count(), 1)
        self.assertEqual(
            AuditEvent.objects.filter(action="invitation.created").count(), 2
        )
        again = self.bulk(data)
        self.assertEqual(again.status_code, 200, again.content)
        self.assertTrue(again.json()["replayed"])
        self.assertEqual(first["invitations"], again.json()["invitations"])
        self.assertEqual(Invitation.objects.count(), 2)
        self.assertEqual(
            AuditEvent.objects.filter(action="invitation.created").count(), 2
        )
        bound = next(
            row for row in first["invitations"] if row["identity_key"] == identity.key
        )
        self.assertEqual(bound["remaining_new_attempts"], 0)
        self.assertEqual(bound["state"], "exhausted")
        guest_link = next(row for row in first["invitations"] if row != bound)
        token = guest_link["url"].split("#")[1]
        self.assertEqual(
            Invitation.objects.get(pk=guest_link["id"]).token_hash, hash_token(token)
        )
        guest = APIClient()
        self.assertEqual(
            guest.post("/api/guest/exchange/", {"token": token}).status_code, 200
        )
        self.assertEqual(guest.post("/api/guest/exam/", {}).status_code, 200)
        self.assertEqual(
            AttemptBudget.objects.get(exam=self.exam, identity=identity).used, 2
        )
        history = self.client.get("/api/invitations/?page=1").json()
        self.assertEqual(history["count"], 2)
        self.assertNotIn(token, str(history))
        self.assertNotIn("url", history["results"][0])
        self.assertNotIn(token, str(list(AuditEvent.objects.values("detail"))))

    def test_replay_rejects_changed_payload_other_actor_expiry_and_secret_rotation(
        self,
    ):
        data = self.payload(apply=True)
        self.assertEqual(self.bulk(data).status_code, 201)
        self.assertEqual(self.bulk({**data, "days": 8}).status_code, 409)
        other = User.objects.create_user("second-admin", role="admin")
        self.client.force_authenticate(other)
        self.assertEqual(self.bulk(data).status_code, 409)
        self.client.force_authenticate(self.admin)
        with override_settings(SECRET_KEY="rotated-key-for-test-only"):
            self.assertEqual(self.bulk(data).status_code, 409)
        InvitationBatch.objects.update(
            created_at=timezone.now() - timedelta(minutes=11)
        )
        self.assertEqual(self.bulk(data).status_code, 409)
        self.assertEqual(Invitation.objects.count(), 2)

    def test_verification_defaults_on_and_account_key_requires_a_mailbox(self):
        response = self.bulk(self.payload(apply=True))
        self.assertTrue(
            all(
                row["require_email_verification"]
                for row in response.json()["invitations"]
            )
        )
        bad = self.bulk(self.payload(csv="key\ncontractor-no-email\n"))
        self.assertFalse(bad.json()["valid"])
        good = self.bulk(
            self.payload(
                csv="key,verification_email\ncontractor-no-email,contractor@example.com\n"
            )
        )
        self.assertTrue(good.json()["valid"])
        self.assertEqual(
            good.json()["rows"][0]["verification_email"], "contractor@example.com"
        )

    def test_csv_structure_limits_and_options_rejected(self):
        for csv in [
            "email\nworker@example.com\n",
            "key,key\na,b\n",
            "key,password\na,b\n",
            "key\n",
            'key\n"unterminated',
            "key\n" + "guest@example.com\n" * 201,
            "key\n" + "x" * 262145,
        ]:
            with self.subTest(csv=csv[:25]):
                self.assertEqual(self.bulk(self.payload(csv=csv)).status_code, 400)
        for changes in [
            {"max_attempts": 0},
            {"max_attempts": 1.5},
            {"days": 91},
            {"apply": True, "request_id": None},
        ]:
            self.assertEqual(self.bulk(self.payload(**changes)).status_code, 400)
        malformed = self.bulk(
            self.payload(csv="key,verification_email\na@example.com\n")
        )
        self.assertFalse(malformed.json()["valid"])
        self.assertFalse(InvitationBatch.objects.exists())

    def test_batch_permission_and_publication_enforced(self):
        self.exam.published = False
        self.exam.save()
        self.assertEqual(self.bulk(self.payload()).status_code, 400)
        self.exam.published = True
        self.exam.save()
        for role in ["learner", "instructor"]:
            self.client.force_authenticate(User.objects.create_user(role, role=role))
            self.assertEqual(self.bulk(self.payload(apply=True)).status_code, 403)
            self.assertEqual(
                self.client.get("/api/invitations/?page=1").status_code,
                403 if role == "learner" else 200,
            )
        self.assertFalse(InvitationBatch.objects.exists())

    def test_disabled_recipient_is_rejected_in_single_and_batch_issuance(self):
        self.member.is_active = False
        self.member.save()
        self.assertFalse(self.bulk(self.payload()).json()["valid"])
        response = self.client.post(
            "/api/invitations/issue/",
            {"exam": self.exam.pk, "key": "EMP101"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Invitation.objects.exists())

    def test_disabling_account_blocks_existing_guest_session_and_attempt(self):
        issued = self.client.post(
            "/api/invitations/issue/",
            {"exam": self.exam.pk, "key": "EMP101"},
            format="json",
        ).json()
        guest = APIClient()
        token = issued["url"].split("#")[1]
        self.assertEqual(
            guest.post("/api/guest/exchange/", {"token": token}).status_code, 200
        )
        attempt = guest.post("/api/guest/exam/", {}).json()
        User.objects.filter(pk=self.member.pk).update(is_active=False)
        self.assertEqual(guest.get("/api/guest/exam/").status_code, 403)
        self.assertEqual(guest.post("/api/guest/exam/", {}).status_code, 403)
        self.assertEqual(guest.get(f"/api/attempts/{attempt['id']}/").status_code, 403)
        self.assertEqual(
            guest.patch(
                f"/api/attempts/{attempt['id']}/",
                {"answers": {}, "answer_revision": 0},
                format="json",
            ).status_code,
            403,
        )
        self.assertEqual(
            APIClient().post("/api/guest/exchange/", {"token": token}).status_code, 403
        )
        history = self.client.get("/api/invitations/?page=1&status=blocked").json()
        self.assertEqual(history["count"], 1)
        self.assertEqual(AttemptBudget.objects.get().used, 1)

    def test_history_pagination_filters_and_manager_scope(self):
        rows = [
            {
                "exam": self.exam,
                "identity": identity_for_user(self.member),
                "token_hash": hash_token(str(number)),
                "created_by": self.admin,
                "expires_at": timezone.now() + timedelta(days=1),
            }
            for number in range(30)
        ]
        Invitation.objects.bulk_create([Invitation(**row) for row in rows])
        first = self.client.get(
            "/api/invitations/?page=1&page_size=7&search=EMP101"
        ).json()
        self.assertEqual(first["count"], 30)
        first = self.client.get(
            "/api/invitations/?page=1&page_size=7&search=member"
        ).json()
        second = self.client.get(
            "/api/invitations/?page=2&page_size=7&search=member"
        ).json()
        self.assertEqual(first["count"], 30)
        self.assertEqual(first["pages"], 5)
        self.assertEqual(len(first["results"]), 7)
        self.assertFalse(
            {row["id"] for row in first["results"]}
            & {row["id"] for row in second["results"]}
        )
        self.assertEqual(
            self.client.get("/api/invitations/?page=999&page_size=7").json()["page"], 5
        )
        self.assertIsInstance(self.client.get("/api/invitations/").json(), list)
        other = User.objects.create_user("trainer", role="instructor")
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get("/api/invitations/?page=1").json()["count"], 0)
        self.assertEqual(
            self.client.post(
                f"/api/invitations/{first['results'][0]['id']}/revoke/", {}
            ).status_code,
            404,
        )

    def test_resume_only_status_and_idempotent_revoke_preserve_budget(self):
        data = self.payload(
            csv="key\nmember@example.com\n",
            apply=True,
            require_email_verification=False,
        )
        item = self.bulk(data).json()["invitations"][0]
        inv = Invitation.objects.get(pk=item["id"])
        start_attempt(self.exam.pk, inv.identity, inv)
        page = self.client.get("/api/invitations/?page=1&status=resume_only").json()
        self.assertEqual(page["count"], 1)
        self.assertEqual(page["results"][0]["remaining_new_attempts"], 0)
        for _ in range(2):
            self.assertEqual(
                self.client.post(f"/api/invitations/{inv.pk}/revoke/", {}).status_code,
                200,
            )
        self.assertEqual(
            AuditEvent.objects.filter(action="invitation.revoked").count(), 1
        )
        self.assertEqual(
            self.client.get("/api/invitations/?page=1&status=revoked").json()["count"],
            1,
        )
        self.assertEqual(AttemptBudget.objects.get().used, 1)


@override_settings(DEBUG=True)
class ConcurrentInvitationTests(TransactionTestCase):
    def test_simultaneous_batch_retries_issue_once(self):
        if connection.vendor != "postgresql":
            self.skipTest("Concurrent batch verification requires PostgreSQL.")
        admin = User.objects.create_user("batch-race", role="admin")
        exam = make_exam(admin)
        payload = {
            "exam": exam.pk,
            "csv": "key\none@example.com\ntwo@example.com\n",
            "apply": True,
            "request_id": str(uuid.uuid4()),
        }

        def issue(_):
            try:
                client = APIClient()
                client.force_authenticate(User.objects.get(pk=admin.pk))
                response = client.post("/api/invitations/bulk/", payload, format="json")
                return response.status_code, response.json()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(issue, range(2)))
        self.assertEqual(sorted(status for status, _ in results), [200, 201])
        self.assertEqual(results[0][1]["invitations"], results[1][1]["invitations"])
        self.assertEqual(InvitationBatch.objects.count(), 1)
        self.assertEqual(Invitation.objects.count(), 2)
