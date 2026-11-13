import time
from django.core.management import call_command
from django.core.management.base import BaseCommand
from training.directory import scheduled_sync
from training.notifications import deliver_queued, logger
from training.reminders import produce_reminders


def scheduler_tick():
    # Isolate each duty so a failure cannot skip later work or stop the loop.
    for duty in (lambda: call_command("expire_attempts"), produce_reminders, deliver_queued, scheduled_sync):
        try:
            duty()
        except Exception as error:
            # Never log exception text, provider responses or recipient details.
            logger.warning("scheduler duty interrupted exception=%s", type(error).__name__)


class Command(BaseCommand):
    help = "Run the single-instance attempt, email and directory scheduler."

    def handle(self, *args, **options):
        while True:
            scheduler_tick()
            time.sleep(60)
