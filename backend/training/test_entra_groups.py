"""Invented identities and fake HTTP transports only; no Microsoft connections."""
import io
import json
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from django.conf import settings
from pathlib import Path

from django.core import signing
from django.core.management import call_command
from django.db import IntegrityError, connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from . import directory, entra_groups as entra
from .models import AuditEvent, DirectorySyncState, TrainingGroup, TrainingGroupMembership, User
from .test_directory import Response, person

TENANT = 'abcdefab-1234-4234-8234-abcdefabcdef'
GROUP = 'abcdefab-1234-4234-8234-abcdefabcdea'
OTHER = 'abcdefab-1234-4234-8234-abcdefabcdeb'
SETTINGS = dict(DEBUG=True, ENTRA_TENANT_ID=TENANT, GRAPH_DIRECTORY_TENANT_ID=TENANT,
                GRAPH_DIRECTORY_CLIENT_ID=OTHER, GRAPH_DIRECTORY_CLIENT_SECRET='invented-secret',
                DIRECTORY_SYNC_INTERVAL_HOURS=0, DIRECTORY_EMAIL_DOMAINS=[])


def record(oid=GROUP, **extra):
    return {'id': oid, 'displayName': 'Invented Nested Team', 'description': 'Synthetic description',
            'groupTypes': [], 'securityEnabled': True, 'mailEnabled': False, **extra}


class FakeGraph:
    def __init__(self, ids=()):
        self.ids = list(ids)
        self.group = record()
        self.error = None
        self.calls = []
        self.on_members = None

    def open(self, request, timeout):
        self.calls.append(request)
        if self.error:
            raise HTTPError(request.full_url, self.error, 'private provider body', {}, io.BytesIO(b'private body'))
        path = urlsplit(request.full_url).path
        if '/transitiveMembers/' in path:
            if self.on_members:
                self.on_members()
            return Response({'value': [{'id': oid} for oid in self.ids]})
        if path == '/v1.0/groups':
            return Response({'value': [self.group]})
        return Response({**self.group, 'id': path.rsplit('/', 1)[-1]})


@contextmanager
def transport(fake):
    # Exercise the production transport/parser, injecting only its HTTP and token clients.
    client = Mock()
    client.acquire_token_for_client.return_value = {'access_token': 'invented-token'}
    with patch('training.directory.build_opener', return_value=fake), patch('training.directory.msal.ConfidentialClientApplication', return_value=client):
        yield


@override_settings(**SETTINGS)
class EntraGraphTests(TestCase):
    def test_search_sanitizes_and_maps_sorted_kinds(self):
        opener = Mock()
        opener.open.return_value = Response({'value': [
            record(str(UUID(int=1)), displayName='Zulu', securityEnabled=False, mailEnabled=True),
            record(str(UUID(int=2)), displayName='Alpha', groupTypes=['Unified']),
            record(str(UUID(int=3)), displayName='Bravo', mailEnabled=True),
            record(str(UUID(int=4)), displayName='Charlie'),
        ]})
        result = entra.search_groups('Invented " OR displayName:Secret\\\n', opener=opener, token='fake')
        self.assertEqual([g['kind'] for g in result], ['Microsoft 365 group', 'Mail-enabled security group', 'Security group', 'Distribution list'])
        request = opener.open.call_args.args[0]
        query = parse_qs(urlsplit(request.full_url).query)
        self.assertEqual(query['$search'], ['"displayName:Invented OR displayName Secret"'])
        self.assertEqual(query['$top'], ['20'])
        self.assertEqual(query['$select'], [entra.GROUP_FIELDS])
        self.assertEqual(request.get_header('Consistencylevel'), 'eventual')
        self.assertEqual(entra.search_groups('!'), [])

    def test_specific_translations_and_obsolete_keys(self):
        messages = json.loads((Path(settings.LOCALE_ROOT) / 'messages.json').read_text())
        for key in ['Security group', 'Microsoft 365 group', 'Mail-enabled security group',
                    'Distribution list', 'Never synced', 'Groups deferred']:
            self.assertEqual(set(messages[key]), {'en', 'zh-TW', 'es'})
            self.assertEqual(messages[key]['en'], key)
        self.assertEqual(messages['Sync needs review']['zh-TW'], '同步待確認')
        self.assertEqual(messages['Groups needing review']['zh-TW'], '待確認的群組')
        self.assertEqual(messages['With a Training account']['es'], 'Con cuenta de formación')
        self.assertEqual(messages['Without a Training account']['es'], 'Sin cuenta de formación')
        explanation = 'Only existing Training accounts are matched. People without an account are counted only. Existing assignments and learning records stay unchanged.'
        self.assertIn('cuentas de formación', messages[explanation]['es'])
        for key in ['Security', 'Microsoft 365', 'Mail-enabled security', 'Distribution', 'Never', 'Sync guarded', 'Groups guarded']:
            self.assertNotIn(key, messages)

    def test_pasted_uuid_reads_one_and_validates_identity(self):
        fake = FakeGraph()
        result = entra.search_groups(GROUP.upper(), opener=fake, token='fake')
        self.assertEqual(result[0]['id'], GROUP)
        self.assertIn('/groups/' + GROUP, fake.calls[0].full_url)
        with self.assertRaises(directory.DirectoryError):
            entra.member_ids('invalid', opener=fake, token='fake')
        with self.assertRaises(directory.DirectoryError):
            entra.read_group(GROUP, opener=Mock(open=Mock(return_value=Response(record(OTHER)))), token='fake')

    def test_transitive_paging_retry_and_headers(self):
        opener, sleep = Mock(), Mock()
        path = '/v1.0/groups/' + GROUP + '/transitiveMembers/microsoft.graph.user'
        next_link = 'https://graph.microsoft.com' + path + '?$skiptoken=fiction'
        opener.open.side_effect = [HTTPError(next_link, 429, 'private', {'Retry-After': '2'}, None),
            Response({'value': [{'id': str(UUID(int=1))}], '@odata.nextLink': next_link}),
            Response({'value': [{'id': str(UUID(int=2)).upper()}, {'id': OTHER, '@odata.type': '#microsoft.graph.device'}]})]
        self.assertEqual(entra.member_ids(GROUP, opener=opener, token='fake', sleep=sleep), {str(UUID(int=1)), str(UUID(int=2))})
        sleep.assert_called_once_with(2)
        self.assertEqual(opener.open.call_count, 3)
        for call in opener.open.call_args_list:
            self.assertEqual(call.args[0].get_header('Consistencylevel'), 'eventual')
        query = parse_qs(urlsplit(opener.open.call_args_list[0].args[0].full_url).query)
        self.assertEqual(query, {'$select': ['id'], '$top': ['999'], '$count': ['true']})

    def test_permission_missing_and_retry_exhaustion(self):
        for status, code in [(403, 'group_permission'), (404, 'group_missing'), (429, 'throttled'), (302, 'network')]:
            with self.subTest(status=status):
                opener = Mock(open=Mock(side_effect=HTTPError('https://graph.microsoft.com', status, 'private', {'Retry-After': '0'}, None)))
                with self.assertRaises(directory.DirectoryError) as caught:
                    entra.member_ids(GROUP, opener=opener, token='fake', sleep=lambda _: None)
                self.assertEqual(caught.exception.code, code)
                self.assertNotIn('private', str(caught.exception))
                self.assertLessEqual(opener.open.call_count, 3)

    def test_invalid_pages_and_cross_resource_links_fail_closed(self):
        path = 'https://graph.microsoft.com/v1.0/groups/' + GROUP + '/transitiveMembers/microsoft.graph.user'
        bad_pages = [None, {}, {'value': {}}, {'value': [None]}, {'value': [{'id': 'bad'}]},
            {'value': [{'id': GROUP}, {'id': GROUP.upper()}]}, {'value': [], '@odata.nextLink': ''},
            {'value': [], '@odata.nextLink': 'https://example.test/steal'},
            {'value': [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users'},
            {'value': [], '@odata.nextLink': path.replace(GROUP, OTHER)},
            {'value': [], '@odata.nextLink': path + '#fragment'}]
        for page in bad_pages:
            with self.subTest(page=page):
                opener = Mock(open=Mock(return_value=Response(page)))
                with self.assertRaises(directory.DirectoryError) as caught:
                    entra.member_ids(GROUP, opener=opener, token='fake')
                self.assertEqual(caught.exception.code, 'invalid_listing')
                self.assertEqual(opener.open.call_count, 1)

    def test_member_cap_and_search_cap(self):
        opener = Mock(open=Mock(return_value=Response({'value': [{'id': str(UUID(int=i))} for i in range(50001)]})))
        with self.assertRaises(directory.DirectoryError):
            entra.member_ids(GROUP, opener=opener, token='fake')
        opener.open.return_value = Response({'value': [record(str(UUID(int=i))) for i in range(21)], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/groups?$skiptoken=next'})
        self.assertEqual(len(entra.search_groups('Invented', opener=opener, token='fake')), 20)

    def test_shared_transport_deadline_cycle_and_retry_budget(self):
        path = '/v1.0/groups/' + GROUP + '/transitiveMembers/microsoft.graph.user'
        url = 'https://graph.microsoft.com' + path + '?next=1'
        opener = Mock(open=Mock(side_effect=[Response({'value': [], '@odata.nextLink': url}), Response({'value': [], '@odata.nextLink': url})]))
        with self.assertRaises(directory.DirectoryError):
            entra.member_ids(GROUP, opener=opener, token='fake')
        self.assertEqual(opener.open.call_count, 2)
        with patch('training.directory.time.monotonic', return_value=0) as clock:
            def overdue(request, timeout):
                clock.return_value = 91
                return Response({'value': []})
            with self.assertRaises(directory.GraphDeadlineExceeded):
                entra.member_ids(GROUP, opener=Mock(open=overdue), token='fake')
        sleep = Mock()
        with self.assertRaises(directory.DirectoryError) as caught:
            entra.member_ids(GROUP, opener=Mock(open=Mock(side_effect=HTTPError(url, 429, 'private', {'Retry-After': '31'}, None))), token='fake', sleep=sleep)
        self.assertEqual(caught.exception.code, 'throttled')
        sleep.assert_not_called()


    def test_nextlink_path_case_is_insensitive_but_other_paths_are_refused(self):
        path = '/v1.0/groups/' + GROUP + '/transitiveMembers/microsoft.graph.user'
        opener = Mock(open=Mock(side_effect=[
            Response({'value': [{'id': GROUP}], '@odata.nextLink': 'https://graph.microsoft.com' + path.upper() + '?page=2'}),
            Response({'value': [{'id': OTHER}]}),
        ]))
        self.assertEqual(entra.member_ids(GROUP, opener=opener, token='fake'), {GROUP, OTHER})
        self.assertEqual(opener.open.call_count, 2)
        for url in [
            'https://graph.microsoft.com' + path.replace(GROUP, OTHER),
            'http://graph.microsoft.com' + path,
            'https://example.test' + path,
            'https://graph.microsoft.com:444' + path,
            'https://user@graph.microsoft.com' + path,
            'https://graph.microsoft.com' + path + '#fragment',
        ]:
            with self.subTest(url=url), self.assertRaises(directory.DirectoryError):
                directory.validate_link(url, path=path)

    def test_effective_deadline_is_earlier_and_bounds_socket_timeout(self):
        for supplied, effective, timeout in [(105, 105, 5), (300, 190, 15), (None, 190, 15)]:
            with self.subTest(deadline=supplied), patch('training.directory.time.monotonic', return_value=100) as clock:
                def late_response(request, **kwargs):
                    self.assertEqual(kwargs['timeout'], timeout)
                    clock.return_value = effective
                    return Response({'value': []})
                with self.assertRaises(directory.GraphDeadlineExceeded) as caught:
                    entra.member_ids(GROUP, opener=Mock(open=late_response), token='fake', deadline=supplied)
                self.assertEqual(caught.exception.deadline, effective)
        opener = Mock()
        with patch('training.directory.time.monotonic', return_value=100), self.assertRaises(directory.GraphDeadlineExceeded):
            entra.member_ids(GROUP, opener=opener, token='fake', deadline=100)
        opener.open.assert_not_called()

    def test_token_requests_share_absolute_budget_without_real_transport(self):
        with patch('training.directory.time.monotonic', return_value=0) as clock:
            http = Mock()
            http.__enter__ = Mock(return_value=http)
            http.__exit__ = Mock(return_value=False)
            timeouts = []
            def send(method, url, **kwargs):
                self.assertFalse(kwargs['allow_redirects'])
                timeouts.append(kwargs['timeout'])
                clock.return_value += 8 if method == 'GET' else 2
                return Mock()
            http.request = send
            def application(*args, **kwargs):
                client_http = kwargs['http_client']
                client_http.request('GET', 'https://login.example.test/discovery')
                client = Mock()
                def token(**kwargs):
                    client_http.request('POST', 'https://login.example.test/token')
                    return {'access_token': 'fake'}
                client.acquire_token_for_client.side_effect = token
                return client
            opener = Mock()
            with patch('training.directory.requests.Session', return_value=http), patch('training.directory.msal.ConfidentialClientApplication', side_effect=application):
                with self.assertRaises(directory.GraphDeadlineExceeded) as caught:
                    entra.member_ids(GROUP, opener=opener, deadline=10)
            self.assertEqual(caught.exception.deadline, 10)
            self.assertEqual(timeouts, [10, 2])
            opener.open.assert_not_called()

    def test_retry_after_does_not_sleep_past_external_deadline(self):
        opener = Mock(open=Mock(side_effect=HTTPError('https://graph.microsoft.com', 429, 'private', {'Retry-After': '12'}, None)))
        sleep = Mock()
        with patch('training.directory.time.monotonic', return_value=90), self.assertRaises(directory.GraphDeadlineExceeded) as caught:
            entra.member_ids(GROUP, opener=opener, token='fake', deadline=100, sleep=sleep)
        self.assertEqual(caught.exception.deadline, 100)
        sleep.assert_not_called()


@override_settings(**SETTINGS)
class EntraLinkTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user('invented-admin', role='admin')
        self.user = User.objects.create_user('invented-member', entra_subject=(TENANT + ':' + OTHER).upper())
        self.manual = User.objects.create_user('invented-manual')
        self.group = TrainingGroup.objects.create(name='Invented Training', created_by=self.admin)
        TrainingGroupMembership.objects.create(group=self.group, user=self.manual, added_by=self.admin)
        self.fake = FakeGraph([OTHER, str(UUID(int=99))])
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.ctx = transport(self.fake)
        self.ctx.__enter__()
        self.addCleanup(self.ctx.__exit__, None, None, None)

    def post(self, action='entra-link', **data):
        return self.client.post(f'/api/groups/{self.group.pk}/{action}/', data, format='json')

    def link(self):
        preview = self.post(entra_id=GROUP)
        self.assertEqual(preview.status_code, 200, preview.data)
        response = self.post(entra_id=GROUP, apply=True, preview=preview.data['preview'])
        self.assertEqual(response.status_code, 200, response.data)
        self.group.refresh_from_db()
        return response

    def test_counts_case_insensitive_matching_and_counts_only_audit(self):
        count_before = User.objects.count()
        preview = self.post(entra_id=GROUP)
        self.assertEqual(preview.data['counts'], dict(entra_members=2, with_account=1, to_add=1, to_remove=1, without_account=1, current_members=1))
        self.assertEqual(list(self.group.members.all()), [self.manual])
        decoded = signing.loads(preview.data['preview'], salt='entra-group')
        self.assertNotIn(str(UUID(int=99)), json.dumps(decoded))
        result = self.link()
        self.assertEqual(list(self.group.members.all()), [self.user])
        self.assertEqual(User.objects.count(), count_before)
        self.assertEqual(self.group.entra_sync_result['status'], 'ok')
        self.assertIsNotNone(self.group.entra_last_synced_at)
        self.assertEqual(self.group.memberships.get().added_by_id, self.admin.pk)
        event = AuditEvent.objects.get(action='group.entra_linked')
        self.assertEqual(event.detail, result.data['counts'])
        self.assertTrue(all(type(v) is int for v in event.detail.values()))
        self.assertNotIn(self.user.username, json.dumps(event.detail))
        payload = self.client.get(f'/api/groups/{self.group.pk}/').data
        self.assertEqual(payload['entra_display_name'], 'Invented Nested Team')
        self.assertEqual(payload['entra_sync_result']['counts']['without_account'], 1)

    def test_create_preview_name_binding_and_old_style_insert(self):
        url = '/api/groups/entra-create/'
        preview = self.client.post(url, {'entra_id': GROUP}, format='json')
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.data['name'], self.fake.group['displayName'])
        self.assertEqual(TrainingGroup.objects.count(), 1)
        bad = self.client.post(url, {'entra_id': GROUP, 'name': 'Changed', 'apply': True, 'preview': preview.data['preview']}, format='json')
        self.assertEqual(bad.status_code, 409)
        applied = self.client.post(url, {'entra_id': GROUP, 'name': preview.data['name'], 'apply': True, 'preview': preview.data['preview']}, format='json')
        self.assertEqual(applied.status_code, 201)
        events = list(AuditEvent.objects.filter(target=str(applied.data['id'])).order_by('pk'))
        self.assertEqual([event.action for event in events], ['group.created', 'group.entra_linked'])
        self.assertEqual(events[0].detail, {'created': 1})
        self.assertTrue(all(event.actor_id == self.admin.pk for event in events))
        self.assertTrue(all(type(v) is int for event in events for v in event.detail.values()))
        self.assertEqual(TrainingGroup.objects.get(pk=applied.data['id']).members.count(), 1)
        now = timezone.now()
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO training_traininggroup (name, description, created_by_id, created_at, updated_at) VALUES (%s, %s, %s, %s, %s)', ['Old image group', '', self.admin.pk, now, now])
        old = TrainingGroup.objects.get(name='Old image group')
        self.assertIsNone(old.entra_group_id)
        self.assertIsNone(old.entra_sync_result)

    def test_preview_rejects_membership_graph_account_actor_group_and_id_changes(self):
        preview = self.post(entra_id=GROUP).data['preview']
        self.fake.ids.append(str(UUID(int=100)))
        self.assertEqual(self.post(entra_id=GROUP, apply=True, preview=preview).status_code, 409)
        self.fake.ids.pop()
        self.user.entra_subject = None
        self.user.save()
        self.assertEqual(self.post(entra_id=GROUP, apply=True, preview=preview).status_code, 409)
        self.user.entra_subject = TENANT + ':' + OTHER
        self.user.save()
        self.assertEqual(self.post(entra_id=OTHER, apply=True, preview=preview).status_code, 409)
        admin2 = User.objects.create_user('invented-admin-two', role='admin')
        self.client.force_authenticate(admin2)
        self.assertEqual(self.post(entra_id=GROUP, apply=True, preview=preview).status_code, 409)
        self.client.force_authenticate(self.admin)
        self.group.memberships.all().delete()
        self.assertEqual(self.post(entra_id=GROUP, apply=True, preview=preview).status_code, 409)
        another = TrainingGroup.objects.create(name='Invented Other Training', created_by=self.admin)
        self.assertEqual(self.client.post(f'/api/groups/{another.pk}/entra-link/', {'entra_id': GROUP, 'apply': True, 'preview': preview}, format='json').status_code, 409)
        self.assertEqual(self.post(entra_id=GROUP, apply=True, preview='tampered').status_code, 409)

    def test_expired_token_and_replay(self):
        with patch('django.core.signing.time.time', return_value=1000):
            preview = self.post(entra_id=GROUP).data['preview']
        with patch('django.core.signing.time.time', return_value=1901):
            self.assertEqual(self.post(entra_id=GROUP, apply=True, preview=preview).status_code, 409)
        self.link()
        preview = self.post('entra-sync').data['preview']
        self.assertEqual(self.post('entra-sync', apply=True, preview=preview).status_code, 200)
        self.assertEqual(self.post('entra-sync', apply=True, preview=preview).status_code, 409)

    def test_link_conflict_ci_uniqueness_and_already_linked(self):
        other = TrainingGroup.objects.create(name='Invented Owner Group', created_by=self.admin, entra_group_id=GROUP.upper())
        conflict = self.post(entra_id=GROUP)
        self.assertEqual(conflict.status_code, 409)
        self.assertIn(other.name, str(conflict.data))
        with self.assertRaises(IntegrityError), transaction.atomic():
            TrainingGroup.objects.create(name='Invented Duplicate Link', created_by=self.admin, entra_group_id=GROUP)
        other.entra_group_id = None
        other.save()
        self.link()
        self.assertEqual(self.post(entra_id=OTHER).status_code, 409)

    def test_manual_endpoints_refuse_and_unlink_preserves_members(self):
        self.link()
        for action, data in [('members', {'user_ids': [self.manual.pk]}), ('remove-members', {'user_ids': [self.user.pk]}), ('matching-members', {}), ('matching-members', {'apply': True})]:
            response = self.post(action, **data)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(str(response.data['detail']), entra.MANUAL_MESSAGE)
        self.assertEqual(self.client.get('/api/groups/?manual=true').data['total'], 0)
        response = self.post('entra-unlink')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data['entra_group_id'])
        self.assertEqual(list(self.group.members.all()), [self.user])
        self.assertEqual(self.post('members', user_ids=[self.manual.pk]).status_code, 200)
        self.assertEqual(AuditEvent.objects.get(action='group.entra_unlinked').detail, {'members_kept': 1})

    def test_fetch_failure_records_safe_error_without_membership_change(self):
        self.link()
        last_sync = self.group.entra_last_synced_at
        for code, expected in [(403, 'group_permission'), (404, 'group_missing'), (500, 'network')]:
            self.fake.error = code
            response = self.post('entra-sync')
            self.assertEqual(response.status_code, 502)
            self.group.refresh_from_db()
            self.assertEqual(self.group.entra_sync_result['code'], expected)
            self.assertEqual(self.group.entra_sync_result['status'], 'error')
            self.assertEqual(self.group.entra_last_synced_at, last_sync)
            self.assertEqual(list(self.group.members.all()), [self.user])
            self.assertNotIn('private', json.dumps(response.data))
        events = list(AuditEvent.objects.filter(action='group.entra_error').order_by('pk'))
        self.assertEqual([event.detail['code'] for event in events], ['group_permission', 'group_missing', 'network'])
        self.assertTrue(all(type(v) is int for e in events for k, v in e.detail.items() if k != 'code'))

    def test_link_change_while_fetching_does_not_overwrite_or_relink(self):
        self.link()
        self.fake.on_members = lambda: TrainingGroup.objects.filter(pk=self.group.pk).update(entra_group_id=OTHER, updated_at=timezone.now())
        self.assertEqual(self.post('entra-sync').status_code, 409)
        self.group.refresh_from_db()
        self.assertEqual(self.group.entra_group_id, OTHER)
        self.assertEqual(list(self.group.members.all()), [self.user])

    def test_automatic_guard_and_administrator_override(self):
        self.link()
        extras = [User.objects.create_user('invented-extra-' + str(i)) for i in range(9)]
        TrainingGroupMembership.objects.bulk_create([TrainingGroupMembership(group=self.group, user=user, added_by=self.admin) for user in extras])
        self.fake.ids = []
        self.assertEqual(entra.sync_all(), dict(synced=0, unchanged=0, failed=0, guarded=1, deferred=0))
        self.group.refresh_from_db()
        self.assertEqual(self.group.entra_sync_result['status'], 'guard')
        self.assertEqual(self.group.members.count(), 10)
        self.assertEqual(AuditEvent.objects.get(action='group.entra_guard').detail['to_remove'], 10)
        preview = self.post('entra-sync')
        self.assertEqual(preview.data['counts']['to_remove'], 10)
        self.assertEqual(self.post('entra-sync', apply=True, preview=preview.data['preview']).status_code, 200)
        self.assertEqual(self.group.members.count(), 0)

    def test_automatic_small_group_removals_and_creator_attribution(self):
        self.link()
        self.fake.ids = []
        self.assertEqual(entra.sync_all()['synced'], 1)
        self.assertEqual(self.group.members.count(), 0)
        self.fake.ids = [OTHER]
        self.assertEqual(entra.sync_all()['synced'], 1)
        self.assertEqual(self.group.memberships.get().added_by_id, self.admin.pk)
        self.assertEqual(entra.sync_all()['unchanged'], 1)

    def test_dry_run_command_and_failure_isolation_logs_counts_only(self):
        self.link()
        before = TrainingGroup.objects.values().get(pk=self.group.pk)
        self.fake.ids = []
        output = io.StringIO()
        call_command('sync_entra_groups', '--group', str(self.group.pk), '--dry-run', stdout=output)
        self.assertEqual(json.loads(output.getvalue())['synced'], 1)
        self.assertEqual(TrainingGroup.objects.values().get(pk=self.group.pk), before)
        self.assertEqual(self.group.members.count(), 1)
        other = TrainingGroup.objects.create(name='Invented second link', created_by=self.admin, entra_group_id=OTHER)
        original_open = self.fake.open
        def fail_one(request, timeout):
            if '/groups/' + GROUP in request.full_url:
                raise RuntimeError('private SQL personal name invented-member')
            return original_open(request, timeout)
        with patch.object(self.fake, 'open', side_effect=fail_one), self.assertLogs('training.entra_groups', level='WARNING') as logs:
            result = entra.sync_all()
        self.assertEqual(result, dict(synced=0, unchanged=1, failed=1, guarded=0, deferred=0))
        self.assertEqual(logs.output, ['WARNING:training.entra_groups:Entra group sync failed: failed'])
        self.assertEqual(self.group.members.count(), 1)
        other.refresh_from_db()
        self.assertEqual(other.entra_sync_result['status'], 'ok')

    def test_permissions_and_manager_payload(self):
        self.link()
        manager = User.objects.create_user('invented-instructor', role='instructor')
        for actor in [self.user, manager, self.admin]:
            self.client.force_authenticate(actor)
            expected = 200 if actor == self.admin else 403
            self.assertEqual(self.client.get('/api/groups/entra-search/?search=Invented').status_code, expected)
            for action in ['entra-link', 'entra-sync']:
                response = self.post(action, entra_id=GROUP)
                self.assertEqual(response.status_code, 409 if actor == self.admin and action == 'entra-link' else expected)
            if actor != self.admin:
                self.assertEqual(self.post('entra-unlink').status_code, 403)
                self.assertEqual(self.client.post('/api/groups/entra-create/', {'entra_id': OTHER}, format='json').status_code, 403)
            response = self.client.get(f'/api/groups/{self.group.pk}/')
            self.assertEqual(response.status_code, 403 if actor == self.user else 200)
            if actor == manager:
                self.assertEqual(response.data['entra_group_id'], GROUP)

    def test_guard_boundary_exactly_half_and_nine_members(self):
        self.link()
        members = [self.user]
        for i in range(9):
            member = User.objects.create_user('boundary-member-' + str(i), entra_subject=TENANT + ':' + str(UUID(int=1000 + i)))
            TrainingGroupMembership.objects.create(group=self.group, user=member, added_by=self.admin)
            members.append(member)
        self.fake.ids = [member.entra_subject.split(':')[1] for member in members[:5]]
        self.assertEqual(entra.sync_all()['synced'], 1)
        self.assertEqual(self.group.members.count(), 5)
        for member in members[5:9]:
            TrainingGroupMembership.objects.create(group=self.group, user=member, added_by=self.admin)
        self.fake.ids = []
        self.assertEqual(entra.sync_all()['synced'], 1)
        self.assertEqual(self.group.members.count(), 0)

    def test_link_sync_use_shared_row_lock_and_apply_is_atomic(self):
        from .groups import lock_groups
        with patch('training.groups.lock_groups', wraps=lock_groups) as lock:
            self.link()
            self.assertEqual(lock.call_count, 2)  # preview and apply
            lock.assert_called_with([self.group.pk])
            self.assertEqual(entra.sync_all()['unchanged'], 1)
            self.assertEqual(lock.call_count, 3)
        self.fake.ids = []
        preview = self.post('entra-sync').data['preview']
        original_apply = entra.apply_members
        def mutate_then_fail(*args):
            original_apply(*args)
            raise RuntimeError('private SQL and provider data')
        with patch('training.entra_groups.apply_members', side_effect=mutate_then_fail), self.assertLogs('training.groups') as logs:
            response = self.post('entra-sync', apply=True, preview=preview)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(list(self.group.members.all()), [self.user])
        self.assertNotIn('private', json.dumps(response.data))
        self.assertEqual(logs.output, ['WARNING:training.groups:Entra group sync failed: failed'])
        self.group.refresh_from_db()
        self.assertEqual(self.group.entra_sync_result['status'], 'error')

    def test_unknown_member_profile_is_never_exposed_and_inactive_accounts_match(self):
        self.user.is_active = False
        self.user.save()
        original_open = self.fake.open
        def body_with_private_fields(request, timeout):
            if '/transitiveMembers/' in request.full_url:
                return Response({'value': [{'id': OTHER}, {'id': str(UUID(int=99)), 'displayName': 'Invented Unknown Private', 'mail': 'unknown@example.test'}]})
            return original_open(request, timeout)
        with patch.object(self.fake, 'open', side_effect=body_with_private_fields):
            preview = self.post(entra_id=GROUP)
            self.link()
        decoded = signing.loads(preview.data['preview'], salt='entra-group')
        for private in ['Invented Unknown Private', 'unknown@example.test', str(UUID(int=99))]:
            self.assertNotIn(private, json.dumps(decoded))
            self.assertNotIn(private, json.dumps(preview.data))
            self.assertNotIn(private, json.dumps(list(AuditEvent.objects.values_list('detail', flat=True))))
        self.assertEqual(list(self.group.members.all()), [self.user])
        self.assertEqual(self.client.get(f'/api/groups/{self.group.pk}/').data['active_member_count'], 0)

    def test_preview_and_apply_share_one_budget_for_create_link_and_sync(self):
        original_fetch = directory.graph_fetch
        original_open = self.fake.open
        for mode in ['create', 'link', 'sync']:
            if mode == 'sync':
                self.link()
            for apply in [False, True]:
                with self.subTest(mode=mode, apply=apply):
                    self.group.refresh_from_db()
                    options = dict(actor=self.admin, oid=GROUP, group=None if mode == 'create' else self.group,
                                   name='Invented new group' if mode == 'create' else '', mode='sync' if mode == 'sync' else 'link')
                    preview = entra.preview_or_apply(**options)['preview']
                    with patch('training.directory.time.monotonic', return_value=0) as clock:
                        def slow(request, timeout):
                            result = original_open(request, timeout)
                            clock.return_value += 31 if '/transitiveMembers/' in request.full_url else 60
                            return result
                        with patch.object(self.fake, 'open', side_effect=slow), patch('training.directory.graph_fetch', wraps=original_fetch) as fetch:
                            with self.assertRaises(directory.GraphDeadlineExceeded) as caught:
                                entra.preview_or_apply(**options, apply=apply, preview=preview)
                        self.assertEqual(caught.exception.deadline, 90)
                        self.assertEqual([call.kwargs['deadline'] for call in fetch.call_args_list], [90, 90])
                    self.assertFalse(TrainingGroup.objects.filter(name='Invented new group').exists())
                    self.assertEqual(list(self.group.members.all()), [self.user] if mode == 'sync' else [self.manual])

    def test_deferred_before_start_and_during_fetch_record_nothing(self):
        self.link()
        before = TrainingGroup.objects.values().get(pk=self.group.pk)
        events = list(AuditEvent.objects.values())
        for remaining in [9, 10]:
            with self.subTest(remaining=remaining), patch('training.directory.time.monotonic', return_value=100 - remaining) as clock:
                original_open = self.fake.open
                def cutoff(request, timeout):
                    self.assertLessEqual(timeout, remaining)
                    result = original_open(request, timeout)
                    clock.return_value = 100
                    return result
                with patch.object(self.fake, 'open', side_effect=cutoff) as fetch:
                    result = entra.sync_all(deadline=100)
                self.assertEqual(result, dict(synced=0, unchanged=0, failed=0, guarded=0, deferred=1))
                self.assertEqual(fetch.call_count, 0 if remaining == 9 else 1)
            self.assertEqual(TrainingGroup.objects.values().get(pk=self.group.pk), before)
            self.assertEqual(list(AuditEvent.objects.values()), events)
            self.assertEqual(list(self.group.members.all()), [self.user])

    def test_own_fetch_limit_is_failure_not_phase_deferral(self):
        self.link()
        original_open = self.fake.open
        with patch('training.directory.time.monotonic', return_value=0) as clock:
            def cutoff(request, timeout):
                result = original_open(request, timeout)
                clock.return_value = 91
                return result
            with patch.object(self.fake, 'open', side_effect=cutoff), self.assertLogs('training.entra_groups', level='WARNING'):
                counts = entra.sync_all(deadline=100)
        self.assertEqual(counts, dict(synced=0, unchanged=0, failed=1, guarded=0, deferred=0))
        event = AuditEvent.objects.get(action='group.entra_error')
        self.assertEqual(event.detail['code'], 'invalid_listing')
        self.assertIsNone(event.actor_id)
        self.assertEqual(list(self.group.members.all()), [self.user])

    def test_deferred_members_page_timeout_records_nothing(self):
        self.link()
        before = TrainingGroup.objects.values().get(pk=self.group.pk)
        events = list(AuditEvent.objects.values())
        original_open = self.fake.open
        with patch('training.directory.time.monotonic', return_value=80) as clock:
            def cutoff(request, timeout):
                if '/transitiveMembers/' in request.full_url:
                    self.assertEqual(timeout, 5)
                    clock.return_value = 100
                    raise TimeoutError('private provider message')
                result = original_open(request, timeout)
                clock.return_value = 95
                return result
            with patch.object(self.fake, 'open', side_effect=cutoff):
                self.assertEqual(entra.sync_all(deadline=100)['deferred'], 1)
        self.assertEqual(TrainingGroup.objects.values().get(pk=self.group.pk), before)
        self.assertEqual(list(AuditEvent.objects.values()), events)
        self.assertEqual(list(self.group.members.all()), [self.user])

    def test_stalest_first_then_id_and_deferred_group_gets_next_turn(self):
        self.link()
        now = timezone.now()
        TrainingGroup.objects.filter(pk=self.group.pk).update(entra_last_synced_at=now)
        oldest = TrainingGroup.objects.create(name='Invented old', created_by=self.admin, entra_group_id=str(UUID(int=1000)), entra_last_synced_at=now - timedelta(days=2))
        tied = TrainingGroup.objects.create(name='Invented tied', created_by=self.admin, entra_group_id=str(UUID(int=1001)), entra_last_synced_at=oldest.entra_last_synced_at)
        never = TrainingGroup.objects.create(name='Invented never', created_by=self.admin, entra_group_id=str(UUID(int=1002)))
        next_never = TrainingGroup.objects.create(name='Invented next never', created_by=self.admin, entra_group_id=str(UUID(int=1003)))
        with patch('training.entra_groups.sync_one', return_value='unchanged') as sync:
            entra.sync_all()
        self.assertEqual([call.args[0].pk for call in sync.call_args_list], [never.pk, next_never.pk, oldest.pk, tied.pk, self.group.pk])
        original_open = self.fake.open
        with patch('training.directory.time.monotonic', return_value=80) as clock:
            def spend_budget(request, timeout):
                result = original_open(request, timeout)
                if '/transitiveMembers/' in request.full_url:
                    clock.return_value = 91
                return result
            with patch.object(self.fake, 'open', side_effect=spend_budget):
                counts = entra.sync_all(deadline=100)
        self.assertEqual(counts, dict(synced=1, unchanged=0, failed=0, guarded=0, deferred=4))
        with patch('training.entra_groups.sync_one', return_value='unchanged') as sync:
            entra.sync_all()
        self.assertEqual(sync.call_args_list[0].args[0].pk, next_never.pk)

    def test_command_audit_actor_is_none_but_added_by_is_creator(self):
        self.link()
        self.group.memberships.all().delete()
        output = io.StringIO()
        call_command('sync_entra_groups', stdout=output)
        self.assertEqual(json.loads(output.getvalue())['deferred'], 0)
        self.assertEqual(self.group.memberships.get().added_by_id, self.admin.pk)
        event = AuditEvent.objects.get(action='group.entra_ok')
        self.assertIsNone(event.actor_id)
        self.fake.error = 403
        with self.assertLogs('training.entra_groups', level='WARNING'):
            call_command('sync_entra_groups', stdout=io.StringIO())
        event = AuditEvent.objects.get(action='group.entra_error')
        self.assertIsNone(event.actor_id)
        self.assertEqual(event.detail, {'current_members': 1, 'code': 'group_permission'})

    def test_no_assignment_enrollment_or_attempt_mutations(self):
        from .models import Course, Enrollment, LearningAssignment
        from .tests import make_exam
        from .services import identity_for_user, start_attempt
        course = Course.objects.create(title='Invented Lesson', owner=self.admin, published=True)
        assignment = LearningAssignment.objects.create(user=self.manual, course=course, created_by=self.admin)
        enrollment = Enrollment.objects.create(user=self.manual, course=course)
        exam = make_exam(self.admin)
        attempt = start_attempt(exam.pk, identity_for_user(self.manual))
        snapshots = [type(row).objects.values().get(pk=row.pk) for row in [assignment, enrollment, attempt]]
        self.link()
        self.fake.ids = []
        entra.sync_all()
        self.assertEqual([type(row).objects.values().get(pk=row.pk) for row in [assignment, enrollment, attempt]], snapshots)


@override_settings(**SETTINGS)
class EntraDirectoryCommitTests(TransactionTestCase):
    def setUp(self):
        DirectorySyncState.objects.get_or_create(pk=1)
        self.admin = User.objects.create_user('invented-directory-admin', role='admin')
        self.creator = User.objects.create_user('invented-directory-creator', role='admin')
        self.group = TrainingGroup.objects.create(name='Invented after commit', created_by=self.creator, entra_group_id=GROUP)
        self.fake = FakeGraph([str(UUID(int=1))])
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_api_after_commit_matches_new_accounts_and_returns_counts(self):
        with transport(self.fake), patch('training.directory.graph_listing', return_value=[person(1)]):
            def assert_committed():
                self.assertFalse(connection.in_atomic_block)
                self.assertTrue(User.objects.filter(entra_subject=TENANT + ':' + str(UUID(int=1))).exists())
            # read_group happens before the group apply transaction.
            original = entra.read_group
            def read(*args, **kwargs):
                assert_committed()
                return original(*args, **kwargs)
            with patch('training.entra_groups.read_group', side_effect=read):
                response = self.client.post('/api/directory/run/', {'apply': True}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['groups'], dict(synced=1, unchanged=0, failed=0, guarded=0, deferred=0))
        self.assertEqual(self.group.members.count(), 1)
        self.assertEqual(AuditEvent.objects.get(action='group.entra_ok').actor_id, self.admin.pk)
        self.assertEqual(self.group.memberships.get().added_by_id, self.admin.pk)

    def test_callback_waits_for_outer_commit_and_never_runs_on_rollback_or_preview(self):
        with patch('training.directory.graph_listing', return_value=[]), patch('training.entra_groups.sync_all', return_value=dict(synced=0, unchanged=1, failed=0, guarded=0, deferred=0)) as sync:
            directory.sync_directory()
            sync.assert_not_called()
            with self.assertRaises(RuntimeError):
                with transaction.atomic():
                    directory.sync_directory(apply=True)
                    sync.assert_not_called()
                    raise RuntimeError('rollback')
            sync.assert_not_called()
            with transaction.atomic():
                result = directory.sync_directory(apply=True)
                self.assertNotIn('groups', result)
                sync.assert_not_called()
            sync.assert_called_once()
            self.assertEqual(result['groups']['unchanged'], 1)

    def test_group_failure_does_not_fail_directory_api_command_or_scheduler(self):
        self.fake.error = 403
        with transport(self.fake), patch('training.directory.graph_listing', return_value=[]), self.assertLogs('training.entra_groups', level='WARNING'):
            response = self.client.post('/api/directory/run/', {'apply': True}, format='json')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['groups']['failed'], 1)
            output = io.StringIO()
            call_command('sync_directory', '--apply', stdout=output)
            self.assertEqual(json.loads(output.getvalue())['groups']['failed'], 1)
            DirectorySyncState.objects.filter(pk=1).update(last_run_at=timezone.now() - timedelta(days=1))
            with override_settings(DIRECTORY_SYNC_INTERVAL_HOURS=1):
                directory.scheduled_sync()
            self.assertIsNone(DirectorySyncState.objects.get(pk=1).next_scheduled_attempt_at)
        self.assertEqual(AuditEvent.objects.filter(action='directory.sync').count(), 3)
        events = list(AuditEvent.objects.filter(action='group.entra_error').order_by('pk'))
        self.assertEqual([event.actor_id for event in events], [self.admin.pk, None, None])
        self.assertTrue(all(event.detail['code'] == 'group_permission' for event in events))

    def test_api_group_deadline_starts_before_directory_fetch(self):
        before = TrainingGroup.objects.values().get(pk=self.group.pk)
        with patch('training.directory.time.monotonic', return_value=20) as clock:
            def listing():
                clock.return_value = 111  # less than ten seconds remain from request start
                return []
            with transport(self.fake), patch('training.directory.graph_listing', side_effect=listing), patch('training.entra_groups.sync_all', wraps=entra.sync_all) as sync:
                response = self.client.post('/api/directory/run/', {'apply': True}, format='json')
            sync.assert_called_once_with(actor=self.admin, deadline=120)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['groups'], dict(synced=0, unchanged=0, failed=0, guarded=0, deferred=1))
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(TrainingGroup.objects.values().get(pk=self.group.pk), before)
        self.assertFalse(AuditEvent.objects.filter(action__startswith='group.').exists())
        self.assertEqual(AuditEvent.objects.filter(action='directory.sync').count(), 1)

    def test_directory_command_and_scheduler_have_no_deadline_or_audit_actor(self):
        with transport(self.fake), patch('training.directory.graph_listing', return_value=[person(1)]):
            for mode in ['command', 'scheduler']:
                with self.subTest(mode=mode):
                    self.group.memberships.all().delete()
                    DirectorySyncState.objects.filter(pk=1).update(last_run_at=timezone.now() - timedelta(days=1))
                    with patch('training.entra_groups.sync_all', wraps=entra.sync_all) as sync:
                        if mode == 'command':
                            output = io.StringIO()
                            call_command('sync_directory', '--apply', stdout=output)
                            self.assertEqual(json.loads(output.getvalue())['groups']['deferred'], 0)
                        else:
                            with override_settings(DIRECTORY_SYNC_INTERVAL_HOURS=1):
                                directory.scheduled_sync()
                        sync.assert_called_once_with(actor=None, deadline=None)
                    self.assertEqual(self.group.memberships.get().added_by_id, self.creator.pk)
                    event = AuditEvent.objects.filter(action='group.entra_ok').latest('pk')
                    self.assertIsNone(event.actor_id)
        self.assertEqual(AuditEvent.objects.filter(action='group.entra_ok').count(), 2)

    def test_callback_unexpected_failure_still_preserves_directory_result(self):
        with patch('training.directory.graph_listing', return_value=[]), patch('training.entra_groups.sync_all', side_effect=RuntimeError('private data')), self.assertLogs('training.directory') as logs:
            result = directory.sync_directory(apply=True)
        self.assertEqual(result['groups']['failed'], 1)
        self.assertEqual(logs.output, ['WARNING:training.directory:Entra group sync failed: failed'])
        self.assertEqual(AuditEvent.objects.filter(action='directory.sync').count(), 1)
