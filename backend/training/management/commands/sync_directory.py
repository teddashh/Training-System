import json
from django.core.management.base import BaseCommand, CommandError
from training.directory import DirectoryError, sync_directory


class Command(BaseCommand):
    help = 'Preview directory provisioning by default. Only --apply writes changes.'

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument('--dry-run', action='store_true')
        mode.add_argument('--apply', action='store_true')
        parser.add_argument('--from-file', help='Complete synthetic/offline Graph JSON value array')
        parser.add_argument('--allow-mass-deactivation', action='store_true')
        parser.add_argument('--verbose', action='store_true', help='Include up to 20 personal display names per category')

    def handle(self, *args, **options):
        try:
            result = sync_directory(apply=options['apply'], from_file=options['from_file'],
                                    allow_mass_deactivation=options['allow_mass_deactivation'])
        except DirectoryError as exc:
            raise CommandError(str(exc)) from None
        if not options['verbose']:
            result.pop('samples', None)
        self.stdout.write(json.dumps(result, ensure_ascii=False))
