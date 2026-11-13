"""Offline integration contracts for directory/groups and the notification release."""
from unittest.mock import patch

from django.core import mail
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import TestCase, SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .directory import sync_directory
from .management.commands.run_scheduler import Command, scheduler_tick
from .models import Course, LearningAssignment, OutboundEmail, TrainingGroup, TrainingGroupMembership, User
from .notifications import deliver_queued
from .test_directory import TENANT, person
from .test_notifications import TEST_SETTINGS


class SchedulerIntegrationTests(SimpleTestCase):
    def test_each_failed_duty_leaves_other_duties_and_next_tick_running(self):
        class StopLoop(Exception):
            pass

        for failed in ('call_command', 'produce_reminders', 'deliver_queued', 'scheduled_sync'):
            with self.subTest(failed=failed):
                with patch('training.management.commands.run_scheduler.call_command') as expire, \
                     patch('training.management.commands.run_scheduler.deliver_queued') as deliver, \
                     patch('training.management.commands.run_scheduler.produce_reminders') as reminders, \
                     patch('training.management.commands.run_scheduler.scheduled_sync') as directory, \
                     patch('training.management.commands.run_scheduler.time.sleep', side_effect=[None, StopLoop]):
                    duties = dict(call_command=expire, produce_reminders=reminders, deliver_queued=deliver, scheduled_sync=directory)
                    duties[failed].side_effect = RuntimeError('private provider response')
                    with self.assertLogs('training.notifications', level='WARNING') as logs:
                        with self.assertRaises(StopLoop):
                            Command().handle()
                    for duty in duties.values():
                        self.assertEqual(duty.call_count, 2)
                    expire.assert_called_with('expire_attempts')
                    self.assertEqual(len(logs.output), 2)
                    self.assertTrue(all('exception=RuntimeError' in entry for entry in logs.output))
                    self.assertNotIn('private provider response', str(logs.output))

    def test_successful_tick_calls_each_duty_once_in_order(self):
        calls = []
        with patch('training.management.commands.run_scheduler.call_command', side_effect=lambda name: calls.append(name)), \
             patch('training.management.commands.run_scheduler.produce_reminders', side_effect=lambda: calls.append('reminders')), \
             patch('training.management.commands.run_scheduler.deliver_queued', side_effect=lambda: calls.append('email')), \
             patch('training.management.commands.run_scheduler.scheduled_sync', side_effect=lambda: calls.append('directory')):
            scheduler_tick()
        self.assertEqual(calls, ['expire_attempts', 'reminders', 'email', 'directory'])


@override_settings(**TEST_SETTINGS)
class GroupNotificationIntegrationTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user('integration-admin', role='admin')
        self.user = User.objects.create_user('integration-arden', email='arden@example.test')
        self.no_email = User.objects.create_user('integration-blair')
        self.inactive = User.objects.create_user('integration-cove', email='cove@example.test', is_active=False)
        self.course = Course.objects.create(title='Synthetic group training', owner=self.admin, published=True)
        self.groups = [TrainingGroup.objects.create(name=name, created_by=self.admin)
                       for name in ('Invented Lab', 'Invented Induction')]
        TrainingGroupMembership.objects.bulk_create([
            TrainingGroupMembership(group=group, user=user, added_by=self.admin)
            for group in self.groups for user in (self.user, self.no_email, self.inactive)
        ])
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def assign(self, notify):
        response = self.client.post('/api/assignments/', {
            'kind': 'course', 'target_id': self.course.pk, 'audience': 'groups',
            'groups': [group.pk for group in self.groups], 'notify': notify,
        }, format='json')
        self.assertEqual(response.status_code, 201)
        return response.data

    def test_group_notify_on_deduplicates_and_notifies_only_new_or_reactivated(self):
        self.assertEqual(self.assign(True), {'assigned': 2, 'emails_queued': 1, 'people_without_email': 1})
        assignment = LearningAssignment.objects.get(user=self.user)
        self.assertEqual(OutboundEmail.objects.get().dedupe_key, f'assignment:{assignment.pk}:created')
        self.assertEqual(self.assign(True), {'assigned': 2, 'emails_queued': 0, 'people_without_email': 0})
        response = self.client.post(f'/api/assignments/{assignment.pk}/cancel/', {}, format='json')
        self.assertEqual(response.status_code, 200)
        assignment.refresh_from_db()
        activation = assignment.cancelled_at.isoformat()
        self.assertEqual(self.assign(True), {'assigned': 2, 'emails_queued': 1, 'people_without_email': 0})
        self.assertEqual(OutboundEmail.objects.latest('pk').dedupe_key, f'assignment:{assignment.pk}:{activation}')
        self.assertEqual(self.assign(True)['emails_queued'], 0)
        self.assertEqual(LearningAssignment.objects.count(), 2)
        self.assertEqual(OutboundEmail.objects.count(), 2)
        self.assertFalse(OutboundEmail.objects.exclude(recipient_user=self.user).exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_group_notify_off_never_queues_including_reactivation(self):
        self.assertEqual(self.assign(False), {'assigned': 2, 'emails_queued': 0, 'people_without_email': 1})
        assignment = LearningAssignment.objects.get(user=self.user)
        self.client.post(f'/api/assignments/{assignment.pk}/cancel/', {}, format='json')
        self.assertEqual(self.assign(False), {'assigned': 2, 'emails_queued': 0, 'people_without_email': 0})
        self.assertEqual(self.assign(False)['emails_queued'], 0)
        self.assertEqual(LearningAssignment.objects.count(), 2)
        self.assertFalse(OutboundEmail.objects.exists())
        self.assertEqual(len(mail.outbox), 0)


@override_settings(**TEST_SETTINGS, ENTRA_TENANT_ID=TENANT, GRAPH_DIRECTORY_TENANT_ID=TENANT,
                   DIRECTORY_REQUIRE_LICENSE=True, DIRECTORY_EMAIL_DOMAINS=[], DIRECTORY_SYNC_INTERVAL_HOURS=0)
class DirectoryNotificationIntegrationTests(TestCase):
    def sync(self, records, apply=True):
        with patch('training.directory.graph_listing', return_value=records):
            return sync_directory(apply=apply)

    def test_directory_lifecycle_never_queues_or_sends_email(self):
        self.sync([person(1), person(2), person(3)])
        restored = User.objects.get(email=person(2)['mail'])
        restored.is_active = False
        restored.directory_disabled_at = timezone.now()
        restored.save()
        records = [person(1, displayName='Invented Changed Name'), person(2),
                   person(3, accountEnabled=False), person(4)]
        with patch('training.notifications.enqueue') as enqueue, \
             patch('training.notifications.send_message') as send_message, \
             patch('django.core.mail.EmailMessage.send') as send:
            for apply in (False, True):
                counts = self.sync(records, apply=apply)['counts']
                for category in ('create', 'update', 'reactivate', 'deactivate'):
                    self.assertEqual(counts[category], 1)
            enqueue.assert_not_called()
            send_message.assert_not_called()
            send.assert_not_called()
        self.assertFalse(OutboundEmail.objects.exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_previously_queued_mail_cancelled_after_sync_deactivation(self):
        self.sync([person(1), person(2)])
        for user in User.objects.all():
            OutboundEmail.objects.create(kind='assignment', recipient_user=user, to_email=user.email,
                                         subject='Synthetic training', body_text='Invented lesson')
        # One explicitly disabled and one absent from a complete listing.
        self.assertEqual(self.sync([person(1, accountEnabled=False)])['counts']['deactivate'], 2)
        self.assertEqual(OutboundEmail.objects.filter(status='queued').count(), 2)
        with patch('training.notifications.send_message') as send:
            self.assertEqual(deliver_queued(), 0)
            send.assert_not_called()
        self.assertEqual(OutboundEmail.objects.filter(
            status='cancelled', attempts=0, last_error='Recipient account is inactive.',
        ).count(), 2)

    def test_migrations_have_one_leaf_and_outbox_precedes_directory(self):
        loader = MigrationLoader(connection)
        directory = ('training', '0019_directory_and_groups')
        outbox = ('training', '0018_outbound_email')
        leaves = loader.graph.leaf_nodes('training')
        self.assertEqual(len(leaves), 1)
        plan = loader.graph.forwards_plan(leaves[0])
        self.assertLess(plan.index(outbox), plan.index(directory))
