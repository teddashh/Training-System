"""Synthetic outside-company sign-in profiles; every Graph transport is patched."""
import threading
import time
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from . import directory
from .models import AuditEvent, Identity, User
from .test_directory import OTHER_TENANT, TENANT, person
from .test_email_code_domains import ADDRESS, DOMAIN_SETTINGS, external_person


@override_settings(**DOMAIN_SETTINGS)
class SigninProfileTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = APIClient()
        self.record = external_person()
        graph = patch('training.directory.graph_fetch', return_value=self.record)
        self.graph = graph.start()
        self.addCleanup(graph.stop)
        email = patch('training.directory.graph_email_lookup', return_value=[self.record])
        self.email_lookup = email.start()
        self.addCleanup(email.stop)

    def linked(self, **extra):
        return User.objects.create_user('synthetic-linked', **{
            'email': ADDRESS, 'entra_subject': f'{TENANT}:{self.record["id"]}',
            'display_name': 'Original Name', **extra,
        })

    def signin(self, email=ADDRESS):
        self.client.logout()
        session = self.client.session
        session['entra_flow'] = {'state': 'synthetic'}
        session.save()
        with patch('training.auth_views.entra_client') as client:
            client.return_value.acquire_token_by_auth_code_flow.return_value = {'id_token_claims': {
                'tid': TENANT, 'oid': self.record['id'], 'preferred_username': email, 'name': 'Initial claim',
            }}
            return self.client.get('/api/auth/entra/callback/', {'state': 'synthetic', 'code': 'synthetic'})

    def email_signin(self):
        self.client.logout()
        with patch('training.auth_views.secrets.randbelow', return_value=123456):
            response = self.client.post('/api/auth/email/request/', {'email': ADDRESS}, format='json')
        self.assertEqual(response.status_code, 200)
        return self.client.post('/api/auth/email/verify/', {'email': ADDRESS, 'code': '123456'}, format='json')

    def test_first_microsoft_signin_maps_profile_and_preserves_identity_role(self):
        response = self.signin()
        self.assertEqual(response.status_code, 302)
        user = User.objects.get()
        self.assertEqual(user.display_name, self.record['displayName'])
        self.assertEqual(user.department, self.record['department'])
        self.assertEqual(user.job_title, self.record['jobTitle'])
        self.assertEqual(user.employee_id, self.record['employeeId'])
        self.assertEqual(user.email, ADDRESS)
        self.assertEqual(user.role, 'learner')
        self.assertFalse(user.has_usable_password())
        self.assertIsNotNone(user.directory_seen_at)
        self.assertIsNotNone(user.last_login)
        self.assertEqual(Identity.objects.get().user_id, user.pk)
        url = urlsplit(self.graph.call_args.args[0])
        self.assertEqual(url.path, '/v1.0/users/' + self.record['id'])
        self.assertEqual(parse_qs(url.query), {'$select': [directory.GRAPH_USER_FIELDS]})
        self.assertTrue(self.graph.call_args.kwargs['single'])
        self.assertEqual(self.graph.call_args.kwargs['path'], url.path)
        self.assertGreater(self.graph.call_args.kwargs['deadline'], time.monotonic())
        self.assertLessEqual(self.graph.call_args.kwargs['deadline'], time.monotonic()+4.5)

    def test_refresh_only_when_never_or_at_least_24_hours_old(self):
        user = self.linked()
        self.assertEqual(self.signin().status_code, 302)
        self.graph.reset_mock()
        self.graph.return_value = {**self.record, 'department': 'Changed department'}
        user.refresh_from_db()
        first_seen = user.directory_seen_at
        self.assertEqual(self.signin().status_code, 302)
        self.graph.assert_not_called()
        user.refresh_from_db()
        self.assertEqual(user.directory_seen_at, first_seen)
        User.objects.filter(pk=user.pk).update(directory_seen_at=timezone.now()-timedelta(hours=25))
        self.assertEqual(self.signin().status_code, 302)
        self.graph.assert_called_once()
        user.refresh_from_db()
        self.assertEqual(user.department, 'Changed department')
        self.assertGreater(user.directory_seen_at, first_seen)

    def test_main_domain_local_and_other_tenant_never_fetched(self):
        for values in ({'email': 'member@MAIN.example.com'}, {'entra_subject': None},
                       {'entra_subject': f'{OTHER_TENANT}:{self.record["id"]}'}):
            user = self.linked(**values)
            self.assertTrue(directory.refresh_signin_profile(user))
            self.graph.assert_not_called()
            self.assertIsNone(user.directory_seen_at)
            user.delete()

    def test_main_domain_microsoft_callback_does_not_fetch(self):
        self.assertEqual(self.signin(email='member@main.example.com').status_code, 302)
        self.graph.assert_not_called()

    def test_cross_field_and_historical_identifier_collisions_are_skipped(self):
        user = self.linked(employee_id='ORIGINAL')
        owner = User.objects.create_user('other-owner', email='other@example.test')
        for field in ('email', 'employee_id'):
            proposed = 'collision@example.test' if field == 'email' else 'COLLISION'
            graph_field = 'mail' if field == 'email' else 'employeeId'
            self.graph.return_value = {**self.record, graph_field: proposed, 'displayName': 'Fresh Name'}
            for other_field in ('username', 'email', 'employee_id'):
                original = getattr(owner, other_field)
                setattr(owner, other_field, proposed.upper()); owner.save()
                User.objects.filter(pk=user.pk).update(directory_seen_at=None)
                user.refresh_from_db()
                before = getattr(user, field)
                self.assertTrue(directory.refresh_signin_profile(user))
                self.assertEqual(getattr(user, field), before)
                self.assertEqual(user.display_name, 'Fresh Name')
                setattr(owner, other_field, original); owner.save()
            for prefix in ('email:', 'account:'):
                identity = Identity.objects.create(user=owner, key=(prefix+proposed).upper())
                User.objects.filter(pk=user.pk).update(directory_seen_at=None)
                user.refresh_from_db(); before = getattr(user, field)
                self.assertTrue(directory.refresh_signin_profile(user))
                self.assertEqual(getattr(user, field), before)
                identity.delete()

    def test_empty_or_invalid_mail_keeps_email_despite_external_member_upn(self):
        user = self.linked()
        for mail in ('', None, 'invalid-address'):
            with self.subTest(mail=mail):
                User.objects.filter(pk=user.pk).update(directory_seen_at=None, department='Old department')
                user.refresh_from_db()
                self.graph.return_value = {**self.record, 'mail': mail,
                    'userPrincipalName': 'member_external.example.test#EXT#@tenant.example.test'}
                self.assertTrue(directory.refresh_signin_profile(user))
                user.refresh_from_db()
                self.assertEqual(user.email, ADDRESS)
                self.assertEqual(user.display_name, self.record['displayName'])
                self.assertEqual(user.department, self.record['department'])
                self.assertEqual(user.job_title, self.record['jobTitle'])
                self.assertEqual(user.employee_id, self.record['employeeId'])
                self.assertIsNotNone(user.directory_seen_at)

    def test_empty_values_and_overlong_employee_id_do_not_erase_profile(self):
        user = self.linked(department='Keep department', job_title='Keep title', employee_id='KEEP')
        self.graph.return_value = {**self.record, 'displayName': '', 'department': None, 'jobTitle': '',
                                  'employeeId': 'x'*1000, 'mail': '', 'userPrincipalName': ''}
        self.assertTrue(directory.refresh_signin_profile(user))
        self.assertEqual((user.display_name, user.department, user.job_title, user.employee_id, user.email),
                         ('Original Name', 'Keep department', 'Keep title', 'KEEP', ADDRESS))
        self.assertIsNotNone(user.directory_seen_at)

    def test_disabled_member_refused_without_login_or_auth_audit(self):
        user = self.linked()
        self.graph.return_value = {**self.record, 'accountEnabled': False}
        result = self.signin()
        self.assertEqual(result.status_code, 400)
        self.assertNotIn('_auth_user_id', self.client.session)
        self.assertFalse(AuditEvent.objects.filter(action='auth.entra').exists())
        user.refresh_from_db()
        self.assertIsNone(user.last_login)
        self.assertIsNone(user.directory_seen_at)

    def test_guest_including_disabled_guest_unchanged(self):
        user = self.linked()
        for enabled in (True, False):
            self.graph.return_value = {**self.record, 'userType': 'Guest', 'accountEnabled': enabled}
            self.assertEqual(self.signin().status_code, 302)
            user.refresh_from_db()
            self.assertEqual(user.display_name, 'Original Name')
            self.assertIsNone(user.directory_seen_at)
            self.assertTrue(user.is_active)

    def test_errors_and_timeouts_succeed_and_log_exception_type_only(self):
        user = self.linked()
        for error in (RuntimeError('private name address token'), TimeoutError('private data'), directory.DirectoryError('permission')):
            self.graph.side_effect = error
            with self.assertLogs('training.directory', level='WARNING') as logs:
                self.assertEqual(self.signin().status_code, 302)
            self.assertEqual([r.getMessage() for r in logs.records], [type(error).__name__])
            user.refresh_from_db()
            self.assertEqual(user.display_name, 'Original Name')
            self.assertIsNone(user.directory_seen_at)

    def test_stalled_transport_returns_within_five_seconds_without_late_writes(self):
        user = self.linked()
        release, finished = threading.Event(), threading.Event()
        def stalled(*args, **kwargs):
            release.wait(10)
            finished.set()
            return self.record
        self.graph.side_effect = stalled
        try:
            start = time.monotonic()
            with self.assertLogs('training.directory', level='WARNING') as logs:
                self.assertTrue(directory.refresh_signin_profile(user))
            self.assertLess(time.monotonic()-start, 5)
            self.assertEqual(logs.records[0].getMessage(), 'GraphDeadlineExceeded')
        finally:
            release.set()
            self.assertTrue(finished.wait(1))
        user.refresh_from_db()
        self.assertIsNone(user.directory_seen_at)
        self.assertEqual(user.display_name, 'Original Name')

    @override_settings(GRAPH_DIRECTORY_CLIENT_SECRET='', GRAPH_MAIL_CLIENT_SECRET='')
    def test_missing_configuration_still_signs_in_with_type_only_log(self):
        with self.assertLogs('training.directory', level='WARNING') as logs:
            self.assertEqual(self.signin().status_code, 302)
        self.assertEqual(logs.records[0].getMessage(), 'DirectoryError')
        self.graph.assert_not_called()

    def test_email_provisions_once_and_refreshes_after_24_hours(self):
        self.assertEqual(self.email_signin().status_code, 200)
        user = User.objects.get()
        self.email_lookup.assert_called_once_with(ADDRESS)
        self.graph.assert_not_called()
        self.assertEqual(user.department, self.record['department'])
        self.assertEqual(self.email_signin().status_code, 200)
        self.email_lookup.assert_called_once()
        User.objects.filter(pk=user.pk).update(directory_seen_at=timezone.now()-timedelta(days=2))
        self.graph.return_value = {**self.record, 'jobTitle': 'Updated title'}
        self.assertEqual(self.email_signin().status_code, 200)
        self.graph.assert_called_once()
        self.assertEqual(User.objects.count(), 1)
        user.refresh_from_db(); self.assertEqual(user.job_title, 'Updated title')

    def test_email_disabled_refused_and_guest_failure_keep_existing_behavior(self):
        self.linked()
        self.graph.return_value = {**self.record, 'accountEnabled': False}
        self.assertEqual(self.email_signin().status_code, 400)
        self.assertNotIn('_auth_user_id', self.client.session)
        self.graph.return_value = {**self.record, 'userType': 'Guest', 'accountEnabled': False}
        self.assertEqual(self.email_signin().status_code, 200)
        self.graph.side_effect = TimeoutError('private')
        with self.assertLogs('training.directory', level='WARNING'):
            self.assertEqual(self.email_signin().status_code, 200)

    def test_wrong_object_response_is_ignored(self):
        user = self.linked()
        self.graph.return_value = person(2)
        with self.assertLogs('training.directory', level='WARNING'):
            self.assertTrue(directory.refresh_signin_profile(user))
        user.refresh_from_db(); self.assertIsNone(user.directory_seen_at)

    def test_object_lookup_validates_id_before_transport(self):
        with self.assertRaises(ValueError):
            directory.graph_user_lookup('../other?token=private')
        self.graph.assert_not_called()
