import json

from django.core.management.base import BaseCommand, CommandError
from training.readiness import deployment_readiness


class Command(BaseCommand):
    help = "Check local deployment prerequisites without contacting Entra or Graph."

    def add_arguments(self, parser):
        parser.add_argument(
            "--strict",
            action="store_true",
            help="Exit unsuccessfully when deployment checks need action.",
        )
        parser.add_argument(
            "--require-entra",
            action="store_true",
            help="Also require Entra configuration (does not verify connectivity).",
        )

    def handle(self, *args, **options):
        result = deployment_readiness()
        self.stdout.write(json.dumps(result, indent=2))
        if (options["strict"] and not result["ready"]) or (
            options["require_entra"] and not result["entra_configured"]
        ):
            raise CommandError(
                "Deployment checks require action; see the report above."
            )
