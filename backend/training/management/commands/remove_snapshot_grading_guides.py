"""Remove frozen grading guides before rolling back to pre-feature images."""
from django.core.management.base import BaseCommand
from django.db import transaction

from training.models import Attempt
from training.services import audit


class Command(BaseCommand):
    help = "Remove grading guides from attempt snapshots before an image rollback."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        counts = {"attempts_scanned": 0, "attempts_changed": 0, "non_empty_guides_removed": 0}
        with transaction.atomic():
            attempts = Attempt.objects.select_for_update().only("id", "snapshot").order_by("pk")
            for attempt in attempts.iterator(chunk_size=500):
                counts["attempts_scanned"] += 1
                changed = False
                for question in attempt.snapshot:
                    if "grading_guide" in question:
                        guide = question.pop("grading_guide")
                        counts["non_empty_guides_removed"] += int(bool(guide))
                        changed = True
                if changed:
                    counts["attempts_changed"] += 1
                    if not options["dry_run"]:
                        # Keep model save hooks and database guards in force.
                        attempt.save(update_fields=["snapshot"])
            if counts["attempts_changed"] and not options["dry_run"]:
                audit(None, "attempt.snapshot_grading_guides_removed", "", counts)
        self.stdout.write(
            f"Attempts scanned: {counts['attempts_scanned']}; "
            f"attempts changed: {counts['attempts_changed']}; "
            f"non-empty guides removed: {counts['non_empty_guides_removed']}"
        )
