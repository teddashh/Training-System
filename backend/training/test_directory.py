"""Synthetic-only directory contracts. No test contacts Microsoft or sends real mail."""
import hashlib
import io
import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from django.conf import settings
from django.core import mail
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from . import directory
from .models import AuditEvent, DirectorySyncState, EmailCode, User
from .services import identity_for_user

TENANT = '11111111-1111-4111-8111-111111111111'
CLIENT = '22222222-2222-4222-8222-222222222222'
OTHER_TENANT = '33333333-3333-4333-8333-333333333333'


def person(number=1, **overrides):
    return {
        'id': str(UUID(int=number)), 'displayName': f'Invented Person {number}',
        'mail': f'fiction{number}@example.test', 'userPrincipalName': f'fiction{number}@example.test',
        'department': 'Imaginary Operations', 'jobTitle': 'Synthetic Specialist',
        'employeeId': f'FIX-{number}', 'employeeType': 'Employee',
        'accountEnabled': True, 'userType': 'Member', 'assignedLicenses': [{'skuId': CLIENT}],
        **overrides,
    }


class Response(io.BytesIO):
    status = 200

    def __init__(self, data):
        super().__init__(json.dumps(data).encode())


def http_error(code, retry='0'):
    return HTTPError('https://graph.microsoft.com/v1.0/users', code, 'private body', {'Retry-After': retry}, None)


@override_settings(
    ENTRA_TENANT_ID=TENANT, GRAPH_DIRECTORY_TENANT_ID=TENANT,
    GRAPH_DIRECTORY_CLIENT_ID=CLIENT, GRAPH_DIRECTORY_CLIENT_SECRET='synthetic-secret',
    GRAPH_MAIL_TENANT_ID='', GRAPH_MAIL_CLIENT_ID='', GRAPH_MAIL_CLIENT_SECRET='',
    DIRECTORY_REQUIRE_LICENSE=True, DIRECTORY_EMAIL_DOMAINS=[], DIRECTORY_SYNC_INTERVAL_HOURS=0,
    EMAIL_CODE_FOR_ENTRA_USERS=False,
)
class DirectoryTests(TestCase):
    def sync(self, records, **kwargs):
        with patch('training.directory.graph_listing', return_value=records):
            return directory.sync_directory(**kwargs)

    def linked(self, number=1, **kwargs):
        record = person(number)
        return User.objects.create_user(
            username='entra_' + record['id'], entra_subject=f"{TENANT}:{record['id']}",
            email=record['mail'], display_name=record['displayName'], **kwargs,
        )

    def test_preview_create_apply_and_idempotent_rerun(self):
        preview = self.sync([person()])
        self.assertEqual(preview['counts']['create'], 1)
        self.assertFalse(User.objects.exists())
        self.assertFalse(AuditEvent.objects.exists())
        applied = self.sync([person()], apply=True)
        self.assertEqual(preview, applied)
        user = User.objects.get()
        self.assertFalse(user.has_usable_password())
        self.assertEqual((user.role, user.employment, user.is_staff, user.is_superuser), ('learner', 'employee', False, False))
        self.assertIsNone(user.last_login)
        self.assertIsNotNone(user.directory_seen_at)
        self.assertEqual(user.job_title, 'Synthetic Specialist')
        repeated = self.sync([person()], apply=True)
        self.assertEqual(repeated['counts']['unchanged'], 1)
        self.assertEqual(repeated['counts']['create'], 0)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(AuditEvent.objects.filter(action='directory.sync').count(), 2)
        self.assertNotIn('Invented', json.dumps(AuditEvent.objects.first().detail))
        self.assertNotIn('samples', AuditEvent.objects.first().detail)

    def test_profile_update_preserves_permissions_password_employment_and_identity(self):
        user = self.linked(role='admin', is_staff=True, is_superuser=True, employment='contractor', employee_id='OLD')
        user.set_password('synthetic-only'); user.save()
        password = user.password
        identity = identity_for_user(user)
        original_key = identity.key
        result = self.sync([person(displayName='Invented Renamed', mail='renamed@example.test', employeeId='NEW')], apply=True)
        user.refresh_from_db(); identity.refresh_from_db()
        self.assertEqual(result['counts']['update'], 1)
        self.assertEqual((user.display_name, user.email, user.employee_id), ('Invented Renamed', 'renamed@example.test', 'NEW'))
        self.assertEqual((user.role, user.is_staff, user.is_superuser, user.employment, user.password), ('admin', True, True, 'contractor', password))
        self.assertEqual((identity.key, identity.user_id), (original_key, user.pk))
        self.assertEqual(User.objects.count(), 1)

    def test_blank_profile_values_do_not_erase_values(self):
        user = self.linked(department='Kept', job_title='Kept title', employee_id='KEPT')
        self.sync([person(displayName='', department=None, jobTitle='', employeeId='')], apply=True)
        user.refresh_from_db()
        self.assertEqual((user.display_name, user.department, user.job_title, user.employee_id), ('Invented Person 1', 'Kept', 'Kept title', 'KEPT'))

    def test_contractor_mapping_only_for_new_accounts(self):
        values = ['Contractor', 'Vendor', 'Consultant', 'Temporary worker', 'Temp', 'Contract worker', 'Employee', 'Guest', 'unknown']
        self.sync([person(i + 1, employeeType=value) for i, value in enumerate(values)], apply=True)
        self.assertEqual(list(User.objects.order_by('id').values_list('employment', flat=True)), ['contractor'] * 6 + ['employee'] * 3)

    def test_each_eligibility_rule(self):
        cases = [('guest', {'userType': 'Guest'}), ('disabled', {'accountEnabled': False}),
                 ('unlicensed', {'assignedLicenses': []}), ('no_email', {'mail': 'bad', 'userPrincipalName': 'bad'}),
                 ('domain', {'mail': 'person@excluded.test'})]
        with override_settings(DIRECTORY_EMAIL_DOMAINS=['EXAMPLE.TEST']):
            for reason, changes in cases:
                with self.subTest(reason=reason):
                    result = self.sync([person(**changes)])
                    self.assertEqual(result['counts']['skipped'][reason], 1)
                    self.assertEqual(result['counts']['create'], 0)

    def test_upn_fallback_and_optional_license(self):
        with override_settings(DIRECTORY_REQUIRE_LICENSE=False, DIRECTORY_EMAIL_DOMAINS=['example.test']):
            result = self.sync([person(mail='', assignedLicenses=[], userPrincipalName='Alias@Example.Test')], apply=True)
        self.assertEqual(result['counts']['create'], 1)
        self.assertEqual(User.objects.get().email, 'alias@example.test')

    def test_other_ineligibility_does_not_deactivate(self):
        for number in range(1, 5):
            self.linked(number)
        result = self.sync([person(1, userType='Guest'), person(2, assignedLicenses=[]),
                            person(3, mail='', userPrincipalName=''), person(4, mail='person@excluded.test')], apply=True)
        self.assertEqual(result['counts']['deactivate'], 0)
        self.assertEqual(User.objects.filter(is_active=True).count(), 4)

    def test_email_collision_blocks_new_person_case_insensitively(self):
        old = User.objects.create_user('local', email='FICTION1@EXAMPLE.TEST')
        result = self.sync([person()], apply=True)
        self.assertEqual(result['counts']['conflicts'], 1)
        self.assertEqual(result['counts']['create'], 0)
        self.assertEqual(User.objects.get().pk, old.pk)

    def test_employee_and_cross_identifier_collisions_block_creation(self):
        User.objects.create_user('FIX-1')
        User.objects.create_user('another', employee_id='fiction2@example.test')
        result = self.sync([person(1), person(2)], apply=True)
        self.assertEqual(result['counts']['conflicts'], 2)
        self.assertEqual(result['counts']['create'], 0)

    def test_overlong_employee_id_conflicts_without_truncation(self):
        user = self.linked(employee_id='KEPT')
        result = self.sync([person(employeeId='X' * 65), person(2, employeeId='Y' * 65)], apply=True)
        user.refresh_from_db()
        self.assertEqual(result['counts']['conflicts'], 2)
        self.assertEqual(result['counts']['create'], 0)
        self.assertEqual(user.employee_id, 'KEPT')

    def test_new_duplicate_identifiers_in_same_listing(self):
        result = self.sync([person(1), person(2, mail=person(1)['mail'])], apply=True)
        self.assertEqual(result['counts']['create'], 1)
        self.assertEqual(result['counts']['conflicts'], 1)
        self.assertEqual(User.objects.count(), 1)

    def test_existing_conflict_keeps_identifiers_updates_safe_profile(self):
        user = self.linked(employee_id='ORIGINAL')
        User.objects.create_user('other', email='other@example.test', employee_id='OTHER')
        result = self.sync([person(mail='OTHER@example.test', employeeId='OTHER', department='Changed')], apply=True)
        user.refresh_from_db()
        self.assertEqual(result['counts']['conflicts'], 1)
        self.assertEqual((user.email, user.employee_id, user.department), ('fiction1@example.test', 'ORIGINAL', 'Changed'))
        self.assertIsNotNone(user.directory_seen_at)

    def test_disabled_and_absent_deactivate_without_deleting_identity(self):
        first, second = self.linked(1), self.linked(2)
        identity = identity_for_user(first)
        result = self.sync([person(1, accountEnabled=False)], apply=True)
        self.assertEqual(result['counts']['deactivate'], 2)
        first.refresh_from_db(); second.refresh_from_db(); identity.refresh_from_db()
        self.assertFalse(first.is_active); self.assertFalse(second.is_active)
        self.assertIsNotNone(first.directory_disabled_at)
        self.assertEqual(identity.user_id, first.pk)
        self.assertEqual(User.objects.count(), 2)

    def test_protected_admin_staff_superuser_local_and_other_tenant(self):
        self.linked(1, role='admin'); self.linked(2, is_staff=True); self.linked(3, is_superuser=True)
        User.objects.create_user('local')
        User.objects.create_user('other-tenant', entra_subject=OTHER_TENANT + ':' + person(4)['id'])
        result = self.sync([], apply=True)
        self.assertEqual(result['counts']['protected'], 3)
        self.assertEqual(result['counts']['deactivate'], 0)
        self.assertEqual(User.objects.filter(is_active=True).count(), 5)

    def test_local_suspension_preserved_and_sync_suspension_reactivated(self):
        local = self.linked(1, is_active=False)
        remote = self.linked(2, is_active=False, directory_disabled_at=timezone.now())
        result = self.sync([person(1), person(2)], apply=True)
        local.refresh_from_db(); remote.refresh_from_db()
        self.assertFalse(local.is_active); self.assertTrue(remote.is_active)
        self.assertIsNone(remote.directory_disabled_at)
        self.assertEqual(result['counts']['reactivate'], 1)

    def test_mass_deactivation_guard_and_cli_override(self):
        self.sync([person(i) for i in range(1, 22)], apply=True)
        preview = self.sync([])
        self.assertTrue(preview['mass_deactivation_guard'])
        self.assertEqual(preview['deactivation_candidates'], 21)
        result = self.sync([], apply=True)
        self.assertEqual(result['counts']['deactivate'], 0)
        self.assertEqual(User.objects.filter(is_active=True).count(), 21)
        result = self.sync([], apply=True, allow_mass_deactivation=True)
        self.assertEqual(result['counts']['deactivate'], 21)
        self.assertFalse(User.objects.filter(is_active=True).exists())

    def test_guard_uses_ten_percent_and_allows_exact_threshold(self):
        self.sync([person(i) for i in range(1, 251)], apply=True)
        self.assertTrue(self.sync([person(i) for i in range(27, 251)])['mass_deactivation_guard'])
        result = self.sync([person(i) for i in range(26, 251)])
        self.assertFalse(result['mass_deactivation_guard'])
        self.assertEqual(result['counts']['deactivate'], 25)

    def test_samples_are_bounded(self):
        result = self.sync([person(i) for i in range(1, 51)])
        self.assertEqual(result['counts']['create'], 50)
        self.assertEqual(len(result['samples']['create']), 20)

    def test_bulk_query_count(self):
        records = [person(i) for i in range(1, 1001)]
        with CaptureQueriesContext(connection) as queries:
            self.sync(records, apply=True)
        self.assertLess(len(queries), 35)
        with CaptureQueriesContext(connection) as queries:
            self.sync(records, apply=True)
        self.assertLess(len(queries), 30)
        self.assertEqual(User.objects.count(), 1000)

    def test_twenty_thousand_person_preview_uses_two_batched_database_reads(self):
        records = [person(i) for i in range(1, 20001)]
        with CaptureQueriesContext(connection) as queries:
            result = self.sync(records)
        self.assertEqual(len(queries), 2)
        self.assertEqual(result['counts']['create'], 20000)
        self.assertEqual(len(result['samples']['create']), 20)
        self.assertFalse(User.objects.exists())

    def test_first_signin_race_recomputes_after_unique_constraint(self):
        records = [person()]
        stale_plan = directory.plan(records, TENANT, timezone.now())
        winner = self.linked(role='instructor', employment='contractor')
        original_plan = directory.plan
        plans = iter([stale_plan])
        def concurrent_plan(*args, **kwargs):
            return next(plans, None) or original_plan(*args, **kwargs)
        with patch('training.directory.plan', side_effect=concurrent_plan):
            result = self.sync(records, apply=True)
        winner.refresh_from_db()
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(result['counts']['create'], 0)
        self.assertEqual((winner.role, winner.employment), ('instructor', 'contractor'))
        self.assertEqual(AuditEvent.objects.filter(action='directory.sync').count(), 1)

    def test_bad_or_duplicate_objects_abort_before_changes(self):
        user = self.linked()
        for records in ([person(), person()], [person(id='bad')], [person(accountEnabled=None)], [person(assignedLicenses=None)], [None]):
            with self.subTest(records=records), self.assertRaises(directory.DirectoryError):
                self.sync(records, apply=True)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertFalse(AuditEvent.objects.exists())

    def test_file_and_command_default_dry_run_counts_only(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'synthetic.json'
            path.write_text(json.dumps({'value': [person()]}))
            output = io.StringIO()
            call_command('sync_directory', from_file=str(path), stdout=output)
            self.assertFalse(User.objects.exists())
            self.assertEqual(json.loads(output.getvalue())['counts']['create'], 1)
            self.assertNotIn('Invented', output.getvalue())
            output = io.StringIO()
            call_command('sync_directory', from_file=str(path), apply=True, verbose=True, stdout=output)
            self.assertIn('Invented', output.getvalue())
            path.write_text(json.dumps({'value': [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?page=2'}))
            with self.assertRaises(directory.DirectoryError):
                directory.sync_directory(from_file=path, apply=True)
            self.assertTrue(User.objects.get().is_active)

    def test_graph_pages_and_selection(self):
        next_link = 'https://graph.microsoft.com/v1.0/users?$skiptoken=opaque%2Bvalue'
        opener = Mock()
        opener.open.side_effect = [Response({'value': [person()], '@odata.nextLink': next_link}), Response({'value': [person(2)]})]
        result = directory.graph_listing(opener=opener, token='synthetic-token')
        self.assertEqual(len(result), 2)
        first = opener.open.call_args_list[0].args[0]
        query = parse_qs(urlsplit(first.full_url).query)
        self.assertEqual(query['$top'], ['999'])
        self.assertEqual(set(query['$select'][0].split(',')), set(person()))
        self.assertEqual(opener.open.call_args_list[1].args[0].full_url, next_link)
        self.assertEqual(opener.open.call_args_list[1].kwargs['timeout'], 15)

    def test_nextlink_validation_before_request(self):
        for link in ('http://graph.microsoft.com/v1.0/users', 'https://evil.test/v1.0/users',
                     'https://graph.microsoft.com.evil.test/v1.0/users', 'https://user@graph.microsoft.com/v1.0/users',
                     'https://graph.microsoft.com:444/v1.0/users', 'https://graph.microsoft.com/v1.0/users#fragment',
                     '/v1.0/users', 123):
            opener = Mock(); opener.open.return_value = Response({'value': [], '@odata.nextLink': link})
            with self.subTest(link=link), self.assertRaises(directory.DirectoryError):
                directory.graph_listing(opener=opener, token='synthetic')
            self.assertEqual(opener.open.call_count, 1)

    def test_no_redirect_handler(self):
        self.assertIsNone(directory.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.test'))

    def test_retry_429_and_503_honours_retry_after(self):
        opener, sleep = Mock(), Mock()
        opener.open.side_effect = [http_error(429, '2'), http_error(503, '3'), Response({'value': [person()]})]
        self.assertEqual(len(directory.graph_listing(opener=opener, token='synthetic', sleep=sleep)), 1)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [2, 3])

    def test_retry_bounded_and_long_retry_after_defers(self):
        for retry, calls in [('0', 3), ('120', 1)]:
            opener, sleep = Mock(), Mock()
            opener.open.side_effect = http_error(429, retry)
            with self.assertRaises(directory.DirectoryError) as error:
                directory.graph_listing(opener=opener, token='synthetic', sleep=sleep)
            self.assertEqual(error.exception.code, 'throttled')
            self.assertEqual(opener.open.call_count, calls)
            self.assertLessEqual(sleep.call_count, 2)

    def test_partial_page_failure_cannot_deactivate_or_create(self):
        user = self.linked()
        opener = Mock()
        opener.open.side_effect = [Response({'value': [person(2)], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?page=2'}), URLError('private')]
        fetch = directory.graph_listing
        with patch('training.directory.graph_listing', side_effect=lambda: fetch(opener=opener, token='synthetic')):
            with self.assertRaises(directory.DirectoryError):
                directory.sync_directory(apply=True)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertEqual(User.objects.count(), 1)
        self.assertFalse(AuditEvent.objects.exists())

    def test_permission_network_and_invalid_page_errors_sanitized(self):
        for failure, code in [(http_error(403), 'permission'), (URLError('private secret'), 'network'), (Response({'error': 'private body'}), 'invalid_listing')]:
            opener = Mock()
            if isinstance(failure, Exception):
                opener.open.side_effect = failure
            else:
                opener.open.return_value = failure
            with self.assertRaises(directory.DirectoryError) as error:
                directory.graph_listing(opener=opener, token='synthetic')
            self.assertEqual(error.exception.code, code)
            self.assertNotIn('private', str(error.exception))

    def test_configuration_fallback_and_tenant_mismatch(self):
        with override_settings(GRAPH_DIRECTORY_TENANT_ID='', GRAPH_DIRECTORY_CLIENT_ID='', GRAPH_DIRECTORY_CLIENT_SECRET='',
                               GRAPH_MAIL_TENANT_ID=TENANT, GRAPH_MAIL_CLIENT_ID=CLIENT, GRAPH_MAIL_CLIENT_SECRET='fallback'):
            self.assertEqual(directory.credentials(), (TENANT, CLIENT, 'fallback'))
        with override_settings(GRAPH_DIRECTORY_TENANT_ID=OTHER_TENANT):
            self.assertFalse(directory.configured())
            with self.assertRaises(directory.DirectoryError):
                self.sync([])

    def test_scheduled_due_manual_only_and_failures_do_not_escape(self):
        with patch('training.directory.graph_listing', return_value=[person()]) as fetch:
            directory.scheduled_sync()
            fetch.assert_not_called()
            with override_settings(DIRECTORY_SYNC_INTERVAL_HOURS=4):
                directory.scheduled_sync(); directory.scheduled_sync()
                self.assertEqual(fetch.call_count, 1)
                DirectorySyncState.objects.update(last_run_at=timezone.now() - timedelta(hours=5))
                fetch.side_effect = directory.DirectoryError('permission')
                with self.assertLogs('training.directory', level='WARNING') as logs:
                    directory.scheduled_sync()
                self.assertEqual(logs.output, ['WARNING:training.directory:Directory sync failed: permission'])
        self.assertEqual(AuditEvent.objects.filter(action='directory.sync').count(), 1)


@override_settings(ENTRA_TENANT_ID=TENANT, GRAPH_DIRECTORY_TENANT_ID=TENANT,
                   GRAPH_DIRECTORY_CLIENT_ID=CLIENT, GRAPH_DIRECTORY_CLIENT_SECRET='synthetic',
                   EMAIL_CODE_FOR_ENTRA_USERS=False, DIRECTORY_SYNC_INTERVAL_HOURS=0,
                   AUTH_NETWORK_LIMIT=300, AUTH_ACCOUNT_LIMIT=100,
                   EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class DirectoryAPITests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user('invented-admin', role='admin')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def provision(self, records):
        with patch('training.directory.graph_listing', return_value=records):
            directory.sync_directory(apply=True)
        return User.objects.get(entra_subject=TENANT + ':' + records[0]['id'])

    def test_permissions_for_users_directory_and_manager_picker(self):
        for user in (None, User.objects.create_user('learner'), User.objects.create_user('teacher', role='instructor')):
            self.client.force_authenticate(user)
            for path in ('/api/users/', '/api/directory/status/'):
                self.assertEqual(self.client.get(path).status_code, 403)
            self.assertEqual(self.client.post('/api/directory/run/', {}, format='json').status_code, 403)
            self.assertEqual(self.client.get('/api/exams/audience-options/').status_code, 200 if user and user.role == 'instructor' else 403)

    def test_api_preview_apply_status_actor_and_recompute(self):
        with patch('training.directory.graph_listing', side_effect=[[person()], [person(), person(2)]]):
            preview = self.client.post('/api/directory/run/', {'apply': False}, format='json')
            applied = self.client.post('/api/directory/run/', {'apply': True}, format='json')
        self.assertEqual(preview.data['counts']['create'], 1)
        self.assertEqual(applied.data['counts']['create'], 2)
        status = self.client.get('/api/directory/status/').data
        self.assertTrue(status['configured'])
        self.assertEqual(status['last_run']['actor'], 'invented-admin')
        self.assertEqual(status['last_run']['counts']['create'], 2)
        self.assertNotIn('samples', status['last_run']['counts'])
        self.assertEqual(AuditEvent.objects.filter(action='directory.sync').count(), 1)

    def test_api_errors_are_clear_and_sanitized(self):
        for code, status in [('not_configured', 503), ('permission', 502), ('throttled', 503), ('network', 502), ('invalid_listing', 502), ('busy', 409), ('conflict', 409)]:
            with patch('training.directory_views.sync_directory', side_effect=directory.DirectoryError(code)):
                response = self.client.post('/api/directory/run/', {}, format='json')
            self.assertEqual(response.status_code, status)
            self.assertEqual(response.data, {'code': code, 'detail': directory.ERRORS[code]})
        with override_settings(GRAPH_DIRECTORY_CLIENT_SECRET='', GRAPH_MAIL_CLIENT_SECRET=''):
            self.assertFalse(self.client.get('/api/directory/status/').data['configured'])

    def test_api_never_accepts_file_path_or_mass_override(self):
        for body in ({'from_file': '/tmp/file'}, {'allow_mass_deactivation': True}, {'apply': 'false'}):
            self.assertEqual(self.client.post('/api/directory/run/', body, format='json').status_code, 400)

    def test_users_search_all_fields_filters_pagination_and_metadata(self):
        user = self.provision([person()])
        user.is_active = False; user.save()
        for search in ('Invented Person', 'fiction1@', 'Imaginary', 'FIX-1', user.username):
            data = self.client.get('/api/users/', {'search': search}).data
            self.assertEqual(data['total'], 1)
            self.assertEqual(data['results'][0]['id'], user.pk)
        data = self.client.get('/api/users/', {'status': 'inactive', 'signed_in': 'no', 'department': user.department}).data
        self.assertEqual(data['total'], 1)
        row = data['results'][0]
        self.assertTrue(row['directory_linked']); self.assertFalse(row['has_signed_in']); self.assertFalse(row['directory_disabled'])
        self.assertEqual(row['job_title'], 'Synthetic Specialist')
        self.assertEqual(self.client.get('/api/users/', {'status': 'active', 'search': 'fiction1'}).data['total'], 0)
        self.assertEqual(self.client.get('/api/users/', {'signed_in': 'yes'}).data['total'], 0)
        user.last_login = timezone.now(); user.save()
        self.assertEqual(self.client.get('/api/users/', {'signed_in': 'yes'}).data['total'], 1)
        data = self.client.get('/api/users/', {'page': 2, 'page_size': 1}).data
        self.assertEqual((data['total'], len(data['results']), data['page']), (2, 1, 2))
        self.assertEqual(self.client.get('/api/users/', {'page_size': 20000}).data['page_size'], 100)
        self.assertEqual(self.client.get('/api/users/', {'page': 'bad'}).status_code, 400)

    def test_users_and_picker_large_pages_are_bounded(self):
        User.objects.bulk_create([User(username=f'synthetic-{i}', display_name=f'Fiction {i}', department='Lab') for i in range(150)])
        with CaptureQueriesContext(connection) as queries:
            data = self.client.get('/api/users/').data
        self.assertEqual((len(data['results']), data['total']), (50, 151))
        self.assertLessEqual(len(queries), 4)
        first = self.client.get('/api/exams/audience-options/').data
        second = self.client.get('/api/exams/audience-options/', {'page': 2}).data
        self.assertEqual(len(first['people']), 50)
        self.assertEqual(first['total'], 151)
        self.assertFalse({p['id'] for p in first['people']} & {p['id'] for p in second['people']})
        self.assertEqual(first['departments'], ['Lab'])
        filtered = self.client.get('/api/exams/audience-options/', {'search': 'synthetic-149'}).data
        self.assertEqual(filtered['total'], 1)

    def test_local_suspend_clears_sync_ownership(self):
        user = self.provision([person()])
        user.is_active = False; user.directory_disabled_at = timezone.now(); user.save()
        response = self.client.patch(f'/api/users/{user.pk}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db(); self.assertIsNone(user.directory_disabled_at)
        self.provision([person()])
        user.refresh_from_db(); self.assertFalse(user.is_active)

    def test_advanced_admin_access_decision_clears_sync_ownership(self):
        from django.contrib.admin import AdminSite
        from .admin import EnterpriseUserAdmin
        user = self.provision([person()])
        user.directory_disabled_at = timezone.now()
        user.is_active = False
        EnterpriseUserAdmin(User, AdminSite()).save_model(Mock(), user, Mock(admin_changed_fields={'is_active'}), True)
        user.refresh_from_db()
        self.assertIsNone(user.directory_disabled_at)
        self.provision([person()])
        user.refresh_from_db()
        self.assertFalse(user.is_active)

    def callback(self, claims):
        self.client.force_authenticate(None)
        session = self.client.session; session['entra_flow'] = {'state': 'synthetic'}; session.save()
        with patch('training.auth_views.entra_client') as client:
            client.return_value.acquire_token_by_auth_code_flow.return_value = {'id_token_claims': claims}
            return self.client.get('/api/auth/entra/callback/', {'state': 'synthetic', 'code': 'synthetic'})

    def test_first_sso_adopts_precreated_row_and_sets_last_login(self):
        user = self.provision([person()])
        identity = identity_for_user(user)
        response = self.callback({'tid': TENANT, 'oid': person()['id'], 'preferred_username': person()['mail'], 'name': person()['displayName']})
        self.assertEqual(response.status_code, 302)
        user.refresh_from_db(); identity.refresh_from_db()
        self.assertIsNotNone(user.last_login)
        self.assertEqual(identity.user_id, user.pk)
        self.assertEqual(User.objects.count(), 2)
        self.assertEqual(AuditEvent.objects.get(action='auth.entra').actor_id, user.pk)

    def test_sso_unique_race_adopts_only_exact_subject(self):
        user = self.provision([person()])
        original_filter = User.objects.filter
        seen = False
        def first_lookup_missing(*args, **kwargs):
            nonlocal seen
            if 'entra_subject__iexact' in kwargs and not seen:
                seen = True
                result = Mock(); result.first.return_value = None
                return result
            return original_filter(*args, **kwargs)
        with patch.object(User.objects, 'filter', side_effect=first_lookup_missing):
            response = self.callback({'tid': TENANT, 'oid': person()['id'], 'preferred_username': 'fresh@example.test'})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(User.objects.count(), 2)
        user.refresh_from_db(); self.assertIsNotNone(user.last_login)

    def test_sso_does_not_adopt_local_email_collision(self):
        User.objects.create_user('local', email=person()['mail'])
        response = self.callback({'tid': TENANT, 'oid': person()['id'], 'preferred_username': person()['mail']})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.exclude(entra_subject=None).exists())

    def test_email_code_unknown_response_and_local_behavior(self):
        user = self.provision([person()])
        User.objects.create_user('local', email='local@example.test')
        self.client.force_authenticate(None)
        unknown = self.client.post('/api/auth/email/request/', {'email': 'unknown@example.test'}, format='json')
        linked = self.client.post('/api/auth/email/request/', {'email': user.email}, format='json')
        self.assertEqual((unknown.status_code, unknown.data), (linked.status_code, linked.data))
        self.assertFalse(EmailCode.objects.exists()); self.assertEqual(len(mail.outbox), 0)
        self.client.post('/api/auth/email/request/', {'email': 'local@example.test'}, format='json')
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(EmailCode.objects.filter(email='local@example.test').exists())

    def test_email_code_opt_in_and_old_code_rejected_after_opt_out(self):
        user = self.provision([person()])
        self.client.force_authenticate(None)
        with override_settings(EMAIL_CODE_FOR_ENTRA_USERS=True):
            self.client.post('/api/auth/email/request/', {'email': user.email}, format='json')
        self.assertEqual(len(mail.outbox), 1)
        code = '123456'
        EmailCode.objects.filter(email=user.email).update(digest=hashlib.sha256((settings.SECRET_KEY + user.email + code).encode()).hexdigest())
        response = self.client.post('/api/auth/email/verify/', {'email': user.email, 'code': code}, format='json')
        self.assertEqual(response.status_code, 400)
        with override_settings(EMAIL_CODE_FOR_ENTRA_USERS=True):
            EmailCode.objects.create(email=user.email, digest=hashlib.sha256((settings.SECRET_KEY + user.email + code).encode()).hexdigest(), expires_at=timezone.now() + timedelta(minutes=5))
            response = self.client.post('/api/auth/email/verify/', {'email': user.email, 'code': code}, format='json')
        self.assertEqual(response.status_code, 200)
