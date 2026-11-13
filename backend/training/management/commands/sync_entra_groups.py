import json
from django.core.management.base import BaseCommand, CommandError
from training.entra_groups import sync_all
from training.models import TrainingGroup


class Command(BaseCommand):
    help = 'Sync linked Entra groups with the removal guard; output counts only.'

    def add_arguments(self, parser):
        parser.add_argument('--group', type=int, nargs='+', action='extend', dest='group_ids')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        ids = options['group_ids']
        if ids and TrainingGroup.objects.filter(pk__in=set(ids), entra_group_id__isnull=False).count() != len(set(ids)):
            raise CommandError('Select linked training groups.')
        self.stdout.write(json.dumps(sync_all(group_ids=ids, dry_run=options['dry_run'])))
