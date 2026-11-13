"""Give existing courses an illustrated scene cover. Dry run unless --apply; --restore undoes a run."""
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from training.covers import cover_ids, scene_for
from training.models import Course
from training.services import audit


class Command(BaseCommand):
    help = ('Print the scene cover each course without one would get, as JSON with ids only. '
            'Nothing is written unless --apply; --restore FILE puts the "from" values of such a JSON back.')
    requires_system_checks = []

    def add_arguments(self, parser):
        modes = parser.add_mutually_exclusive_group()
        modes.add_argument('--apply', action='store_true', help='Write the changes in one transaction, with audit rows.')
        modes.add_argument('--restore', type=Path, metavar='FILE', help='Restore from the JSON output of an earlier run.')

    def handle(self, *args, **options):
        if options['restore']:
            return self.restore(options['restore'])
        changes, unchanged = [], 0
        with transaction.atomic():
            courses = Course.objects.order_by('pk')
            if options['apply']:
                courses = courses.select_for_update()
            for course in courses.only('pk', 'title', 'category', 'cover'):
                if course.cover.startswith('scene-'):
                    unchanged += 1
                    continue
                target = scene_for(course.pk, course.title, course.category)
                changes.append({'id': course.pk, 'from': course.cover, 'to': target})
                if options['apply']:
                    Course.objects.filter(pk=course.pk).update(cover=target)
                    audit(None, 'course.cover_scene', course.pk, {'from': course.cover, 'to': target})
        self.stdout.write(json.dumps({'changes': changes, 'unchanged': unchanged}))

    def restore(self, path):
        try:
            data = json.loads(path.read_text())
            changes = data['changes']
            rows = [(int(item['id']), item['from'], item['to']) for item in changes]
        except (OSError, ValueError, KeyError, TypeError):
            raise CommandError('Use the JSON output of apply_scene_covers.') from None
        known = cover_ids()
        # "to" is always a library scene; "from" is whatever the course had, possibly empty.
        if any(not isinstance(old, str) or len(old) > 80 or not isinstance(new, str)
               or new not in known or not new.startswith('scene-')
               for _, old, new in rows):
            raise CommandError('The file names covers that apply_scene_covers does not produce.')
        restored, skipped = [], 0
        with transaction.atomic():
            for pk, old, new in rows:
                # Only where nobody chose another cover since the run.
                if Course.objects.filter(pk=pk, cover=new).update(cover=old):
                    audit(None, 'course.cover_restored', pk, {'from': new, 'to': old})
                    restored.append(pk)
                else:
                    skipped += 1
        self.stdout.write(json.dumps({'restored': restored, 'skipped': skipped}))
