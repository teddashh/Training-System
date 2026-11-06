import time
from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Run the single-instance timeout/cleanup scheduler."

    def handle(self, *args, **options):
        while True:
            call_command("expire_attempts")
            time.sleep(60)
