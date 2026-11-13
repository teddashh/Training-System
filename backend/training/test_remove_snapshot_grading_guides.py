from copy import deepcopy
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from .models import Attempt, AuditEvent, Exam, Identity, User


class RemoveSnapshotGradingGuidesTests(TestCase):
    def setUp(self):
        owner = User.objects.create_user("rollback-guide-owner", role="instructor")
        exam = Exam.objects.create(owner=owner, title="Synthetic rollback guides")
        identity = Identity.objects.create(key="email:rollback@corp.example.com")
        question = {
            "id": 7, "type": "essay", "description": "Explain the synthetic route.",
            "grading_guide": "Private synthetic guide\nAward points for the route.",
            "figure": {"key": "synthetic-figure", "width": 40, "height": 20,
                       "alt": "Two connected boxes", "caption": "Synthetic route"},
            "solution": ["route"], "answer_tolerances": [], "answer_matching": [],
            "options": [], "points": 10,
        }
        self.before = {}
        for number, status, snapshot in (
            (1, "in_progress", [question, {**question, "id": 8, "grading_guide": ""}]),
            (2, "graded", [question]),
            (3, "submitted", [{"id": 9, "grading_guide": ""}]),
            (4, "graded", [{"id": 10, "figure": None, "solution": [0]}]),
            (5, "in_progress", []),
        ):
            attempt = Attempt.objects.create(
                exam=exam, identity=identity, number=number, status=status,
                snapshot=deepcopy(snapshot), pass_score=70,
                deadline=timezone.now() + timedelta(hours=1),
                answers={"7": "Synthetic response"}, answer_revision=2,
                manual_grades={"7": {"points": 10}}, grading_revision=1,
            )
            self.before[attempt.pk] = Attempt.objects.filter(pk=attempt.pk).values().get()

    def run_command(self, **options):
        output = StringIO()
        call_command("remove_snapshot_grading_guides", stdout=output, **options)
        return output.getvalue()

    def assert_unchanged(self):
        for pk, before in self.before.items():
            self.assertEqual(Attempt.objects.filter(pk=pk).values().get(), before)

    def test_removes_only_guides_from_active_and_finished_attempts_and_audits_counts(self):
        output = self.run_command()
        self.assertEqual(output, "Attempts scanned: 5; attempts changed: 3; non-empty guides removed: 2\n")
        for pk, before in self.before.items():
            expected = deepcopy(before)
            for question in expected["snapshot"]:
                question.pop("grading_guide", None)
            self.assertEqual(Attempt.objects.filter(pk=pk).values().get(), expected)
        event = AuditEvent.objects.get()
        self.assertEqual(event.action, "attempt.snapshot_grading_guides_removed")
        self.assertIsNone(event.actor)
        self.assertEqual(event.target, "")
        self.assertEqual(event.detail, {
            "attempts_scanned": 5, "attempts_changed": 3, "non_empty_guides_removed": 2,
        })

    def test_second_run_is_a_noop_without_another_audit_event(self):
        self.run_command()
        before = list(Attempt.objects.order_by("pk").values())
        self.assertEqual(self.run_command(),
                         "Attempts scanned: 5; attempts changed: 0; non-empty guides removed: 0\n")
        self.assertEqual(list(Attempt.objects.order_by("pk").values()), before)
        self.assertEqual(AuditEvent.objects.count(), 1)

    def test_dry_run_reports_same_counts_without_any_writes(self):
        output = self.run_command(dry_run=True)
        self.assert_unchanged()
        self.assertFalse(AuditEvent.objects.exists())
        self.assertEqual(output, self.run_command())

    def test_output_contains_counts_only_and_no_snapshot_text(self):
        for dry_run in (True, False):
            with self.subTest(dry_run=dry_run):
                output = self.run_command(dry_run=dry_run)
                self.assertRegex(output, r"\AAttempts scanned: \d+; attempts changed: \d+; non-empty guides removed: \d+\n\Z")
                for before in self.before.values():
                    for question in before["snapshot"]:
                        guide = question.get("grading_guide")
                        if guide:
                            self.assertNotIn(guide, output)

    def test_save_hooks_are_respected_and_failure_rolls_back(self):
        original_save = Attempt.save
        calls = []

        def guarded_save(attempt, *args, **kwargs):
            self.assertEqual(kwargs, {"update_fields": ["snapshot"]})
            calls.append(attempt.pk)
            if len(calls) == 2:
                raise ValueError("Synthetic attempt save guard")
            return original_save(attempt, *args, **kwargs)

        with patch.object(Attempt, "save", guarded_save):
            with self.assertRaisesMessage(ValueError, "Synthetic attempt save guard"):
                self.run_command()
        self.assertEqual(len(calls), 2)
        self.assert_unchanged()
        self.assertFalse(AuditEvent.objects.exists())
