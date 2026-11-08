from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from training.models import (
    Attempt,
    AuthRate,
    EmailCode,
    ExamPreview,
    GuestEmailChallenge,
)
from training.previews import finish_preview
from training.services import finalize


class Command(BaseCommand):
    help = "Finalize timed-out attempts; run every minute in production."

    def handle(self, *args, **options):
        count = 0
        for pk in Attempt.objects.filter(
            status="in_progress", deadline__lte=timezone.now()
        ).values_list("pk", flat=True):
            with transaction.atomic():
                finalize(Attempt.objects.select_for_update().get(pk=pk))
                count += 1
        ExamPreview.objects.filter(expires_at__lte=timezone.now()).delete()
        for pk in ExamPreview.objects.filter(
            status="in_progress", deadline__lte=timezone.now()
        ).values_list("pk", flat=True):
            with transaction.atomic():
                preview = ExamPreview.objects.select_for_update().filter(pk=pk).first()
                if preview:
                    finish_preview(preview)
        AuthRate.objects.filter(window__lt=timezone.now() - timedelta(days=1)).delete()
        EmailCode.objects.filter(expires_at__lt=timezone.now()).delete()
        GuestEmailChallenge.objects.filter(expires_at__lt=timezone.now()).delete()
        self.stdout.write(f"Finalized {count} expired attempts.")
