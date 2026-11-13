"""Synthetic domain-code provisioning: no real Graph or mail transport."""
import hashlib
from datetime import timedelta
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

from django.conf import settings
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from . import directory
from .models import AuditEvent, EmailCode, Identity, OutboundEmail, User
from .test_directory import CLIENT, TENANT, Response, person

DOMAIN_SETTINGS = dict(
    DEBUG=True, EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    EMAIL_CODE_DOMAINS=[' PlAnT.Example.Com '], EMAIL_CODE_FOR_ENTRA_USERS=False,
    ENTRA_TENANT_ID=TENANT, GRAPH_DIRECTORY_TENANT_ID=TENANT,
    GRAPH_DIRECTORY_CLIENT_ID=CLIENT, GRAPH_DIRECTORY_CLIENT_SECRET='synthetic-secret',
    DIRECTORY_EMAIL_DOMAINS=['main.example.com'], DIRECTORY_REQUIRE_LICENSE=True,
)
ADDRESS = 'arden@plant.example.com'
CODE = '123456'


def external_person(**extra):
    return person(1, **{
        'mail': ADDRESS, 'userPrincipalName': 'arden_plant.example.com#EXT#@tenant.example.com',
        'creationType': 'Invitation', 'assignedLicenses': [], 'employeeType': 'External consultant',
        **extra,
    })


@override_settings(**DOMAIN_SETTINGS)
class DomainCodeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = APIClient()
        patch('training.directory.graph_fetch', side_effect=TimeoutError('synthetic failure')).start()
        self.lookup = patch('training.directory.graph_email_lookup', return_value=[external_person()]).start()
        self.addCleanup(patch.stopall)
        patch('training.auth_views.secrets.randbelow', return_value=123456).start()
        baseline = self.request('unknown@other.example.com')
        self.generic = (baseline.status_code, baseline.data)

    def request(self, email=ADDRESS):
        return self.client.post('/api/auth/email/request/', {'email': email}, format='json')

    def verify(self, email=ADDRESS):
        return self.client.post('/api/auth/email/verify/', {'email': email, 'code': CODE}, format='json')

    def negative(self, email=ADDRESS):
        before = (len(mail.outbox), EmailCode.objects.count(), OutboundEmail.objects.count(), User.objects.count())
        response = self.request(email)
        self.assertEqual((response.status_code, response.data), self.generic)
        self.assertEqual((len(mail.outbox), EmailCode.objects.count(), OutboundEmail.objects.count(), User.objects.count()), before)
        return response

    def linked(self, **extra):
        return User.objects.create_user('synthetic-linked', email=ADDRESS,
                                       entra_subject=f"{TENANT}:{person()['id']}", **extra)

    def stored_code(self, email=ADDRESS):
        EmailCode.objects.update_or_create(email=email, defaults={
            'digest': hashlib.sha256((settings.SECRET_KEY + email + CODE).encode()).hexdigest(),
            'expires_at': timezone.now() + timedelta(minutes=10), 'failures': 0,
        })

    def test_local_accounts_unchanged_including_privileged_and_other_domains(self):
        for index, extra in enumerate(({}, {'role': 'admin'}, {'role': 'instructor'}, {'is_staff': True}, {'is_superuser': True})):
            address = f'local{index}@other.example.com'
            User.objects.create_user(f'local{index}', email=address, **extra)
            self.assertEqual((self.request(address).status_code, len(mail.outbox)), (200, index + 1))
            self.assertEqual(self.verify(address).status_code, 200)
        self.lookup.assert_not_called()

    @override_settings(EMAIL_CODE_FOR_ENTRA_USERS=True, EMAIL_CODE_DOMAINS=[])
    def test_global_override_preserves_all_existing_roles(self):
        for index, extra in enumerate(({}, {'role': 'admin'}, {'role': 'instructor'}, {'is_staff': True}, {'is_superuser': True})):
            address = f'linked{index}@other.example.com'
            User.objects.create_user(f'linked{index}', email=address, entra_subject=f'{TENANT}:{person(index + 2)["id"]}', **extra)
            self.assertEqual(self.request(address).status_code, 200)
            self.assertEqual(self.verify(address).status_code, 200)
        self.assertEqual(len(mail.outbox), 5)
        self.lookup.assert_not_called()

    @override_settings(EMAIL_CODE_DOMAINS=[])
    def test_empty_setting_preserves_linked_denial_unknown_and_local_codes(self):
        self.negative()
        self.linked()
        self.negative()
        self.stored_code()
        self.assertEqual(self.verify().status_code, 400)
        User.objects.create_user('local', email='local@plant.example.com')
        self.assertEqual(self.request('local@plant.example.com').status_code, 200)
        self.assertEqual(self.verify('local@plant.example.com').status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.lookup.assert_not_called()

    def test_listed_active_learner_gets_and_verifies_code_case_insensitively(self):
        user = self.linked()
        result = self.request('  ARDEN@PLANT.EXAMPLE.COM  ')
        self.assertEqual((result.status_code, result.data), self.generic)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(self.verify().data['user']['id'], user.pk)
        self.assertEqual(self.verify().status_code, 400)  # One use only.
        self.lookup.assert_not_called()

    def test_privileged_directory_accounts_cannot_request_or_verify(self):
        for index, extra in enumerate(({'role': 'admin'}, {'role': 'instructor'}, {'is_staff': True}, {'is_superuser': True})):
            address = f'privileged{index}@plant.example.com'
            User.objects.create_user(f'privileged{index}', email=address, entra_subject=f'{TENANT}:{person(index+2)["id"]}', **extra)
            self.negative(address)
            self.stored_code(address)
            self.assertEqual(self.verify(address).status_code, 400)
        self.lookup.assert_not_called()

    def test_domain_is_exact_not_parent_subdomain_or_suffix(self):
        for address in ('arden@sub.plant.example.com', 'arden@notplant.example.com', 'arden@plant.example.com.invalid', 'arden@example.com', 'bad@@plant.example.com'):
            self.negative(address)
        self.lookup.assert_not_called()

    def test_unlisted_existing_directory_learner_is_denied(self):
        user = self.linked()
        user.email = 'arden@other.example.com'
        user.save()
        self.negative(user.email)
        self.stored_code(user.email)
        self.assertEqual(self.verify(user.email).status_code, 400)
        self.lookup.assert_not_called()

    def test_provision_matches_sync_constructor_and_audits_without_notifying(self):
        now = timezone.now()
        record = external_person(displayName='  Synthetic Arden  ', employeeId='  SYN-1  ', jobTitle='Specialist' * 40)
        self.lookup.return_value = [record]
        # Bulk eligibility differs, but construction must be identical.
        with override_settings(DIRECTORY_REQUIRE_LICENSE=False, DIRECTORY_EMAIL_DOMAINS=[]):
            planned = directory.plan(directory.clean_listing([record]), TENANT, now)[1][0]
        with patch('training.directory.timezone.now', return_value=now), patch('training.notifications.enqueue') as enqueue:
            response = self.request()
            enqueue.assert_not_called()
        self.assertEqual((response.status_code, response.data), self.generic)
        user = User.objects.get()
        fields = ('username', 'entra_subject', 'email', 'employee_id', 'display_name', 'department',
                  'job_title', 'employment', 'role', 'is_active', 'is_staff', 'is_superuser', 'directory_seen_at')
        for field in fields:
            self.assertEqual(getattr(user, field), getattr(planned, field), field)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(user.employment, 'contractor')
        event = AuditEvent.objects.get(action='directory.provision')
        self.assertEqual((event.actor_id, event.target, event.detail), (None, str(user.pk), {'source': 'email_code'}))
        self.assertEqual(len(mail.outbox), 1)
        row = OutboundEmail.objects.get()
        self.assertEqual((row.kind, row.status, row.body_text, row.context), ('sign_in_code', 'sent', '', {}))
        self.assertEqual(self.verify().data['user']['id'], user.pk)
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(AuditEvent.objects.filter(action='directory.provision').count(), 1)
        self.lookup.assert_called_once_with(ADDRESS)

    def test_lookup_requires_configuration(self):
        with patch('training.directory.configured', return_value=False):
            self.negative()
        self.lookup.assert_not_called()

    def test_zero_multiple_malformed_guest_disabled_and_mismatched_records_denied(self):
        for records in ([], [external_person(), person(2)], [{'id': 'bad'}],
                        [external_person(userType='Guest')], [external_person(accountEnabled=False)],
                        [external_person(mail='other@plant.example.com')], [external_person(mail='arden@other.example.com')],
                        [external_person(employeeId='X'*65)], [external_person(accountEnabled='true')]):
            with self.subTest(records=records):
                self.lookup.return_value = records
                self.negative()
        self.assertFalse(AuditEvent.objects.filter(action='directory.provision').exists())

    def test_subject_owned_in_any_case_active_or_inactive_is_not_replaced(self):
        record = external_person(id='abcdefab-abcd-4abc-8abc-abcdefabcdef')
        self.lookup.return_value = [record]
        user = User.objects.create_user('prior-subject', email='prior@other.example.com',
                                       entra_subject=f'{TENANT}:{record["id"]}'.upper())
        for active in (True, False):
            user.is_active = active
            user.save()
            self.negative()
            user.refresh_from_db()
            self.assertEqual(user.is_active, active)
            self.assertEqual(user.email, 'prior@other.example.com')

    def test_inactive_local_or_directory_email_owner_stays_suspended(self):
        user = self.linked(is_active=False)
        self.negative()
        user.entra_subject = None
        user.save()
        self.negative()
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.stored_code()
        self.assertEqual(self.verify().status_code, 400)

    def test_all_new_identifiers_reserve_current_accounts_and_owned_identities(self):
        owner = User.objects.create_user('owner', email='owner@other.example.com', is_active=False)
        values = (ADDRESS, external_person()['employeeId'], 'entra_' + external_person()['id'])
        for value in values:
            for field in ('email', 'employee_id', 'username'):
                with self.subTest(value=value, field=field):
                    original = getattr(owner, field)
                    setattr(owner, field, value.upper())
                    owner.save()
                    self.negative()
                    setattr(owner, field, original)
                    owner.save()
            for prefix in ('email:', 'account:'):
                with self.subTest(value=value, prefix=prefix):
                    identity = Identity.objects.create(user=owner, key=(prefix+value).upper())
                    self.negative()
                    identity.delete()
        self.assertFalse(AuditEvent.objects.filter(action='directory.provision').exists())

    def test_unbound_guest_identity_remains_available_for_adoption(self):
        identity = Identity.objects.create(key='email:' + ADDRESS)
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(self.verify().status_code, 200)
        identity.refresh_from_db()
        self.assertEqual(identity.user_id, User.objects.get().pk)

    def test_graph_and_token_failures_are_generic_and_logs_only_class(self):
        for error in (TimeoutError('private token'), URLError('private address'), RuntimeError('private name'),
                      directory.DirectoryError('permission')):
            with self.subTest(error=type(error).__name__):
                self.lookup.side_effect = error
                with self.assertLogs('training.directory', level='WARNING') as logs:
                    self.negative()
                self.assertEqual(logs.records[0].getMessage(), type(error).__name__)
                self.assertEqual(len(logs.records), 1)

    def test_unique_subject_race_returns_generic_response_and_preserves_winner(self):
        winner = self.linked()
        # Simulate the initial account read occurring before the competing insert.
        from django.db.models.query import QuerySet
        original = QuerySet.first
        def initial_miss(qs):
            return None if qs.model is User else original(qs)
        with patch.object(QuerySet, 'first', initial_miss):
            self.negative()
        # Now exercise the unique-constraint race after the subject/collision checks.
        winner.email = 'prior@other.example.com'
        winner.save()
        with patch.object(QuerySet, 'exists', return_value=False):
            with self.assertLogs('training.directory', level='WARNING') as logs:
                self.negative()
        self.assertEqual(logs.records[0].getMessage(), 'IntegrityError')
        self.assertEqual(User.objects.count(), 1)
        winner.refresh_from_db()
        self.assertEqual(winner.email, 'prior@other.example.com')
        self.assertFalse(AuditEvent.objects.filter(action='directory.provision').exists())

    def test_audit_failure_rolls_back_creation_and_sends_nothing(self):
        with patch('training.directory.audit', side_effect=RuntimeError('sensitive detail')):
            with self.assertLogs('training.directory', level='WARNING'):
                self.negative()
        self.assertFalse(User.objects.exists())

    def test_rate_limit_is_first_and_blocks_lookup(self):
        with override_settings(AUTH_ACCOUNT_LIMIT=1):
            self.lookup.return_value = []
            self.negative()
            self.lookup.reset_mock()
            self.assertEqual(self.request().status_code, 429)
            self.lookup.assert_not_called()
        self.assertEqual(len(mail.outbox), 0)

    def test_verify_rechecks_domain_role_flags_and_active_state(self):
        user = self.linked()
        for changes in ({'role': 'instructor'}, {'is_staff': True}, {'is_superuser': True}, {'is_active': False}):
            self.stored_code()
            User.objects.filter(pk=user.pk).update(**changes)
            self.assertEqual(self.verify().status_code, 400)
            User.objects.filter(pk=user.pk).update(role='learner', is_staff=False, is_superuser=False, is_active=True)
        self.stored_code()
        with override_settings(EMAIL_CODE_DOMAINS=[]):
            self.assertEqual(self.verify().status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    def test_outside_bulk_scope_unchanged_then_disabled_or_absent_deactivated(self):
        self.request()
        user = User.objects.get()
        original = (user.display_name, user.email, user.directory_seen_at)
        before_mail = OutboundEmail.objects.count()
        for licenses in ([], [{'skuId': CLIENT}]):
            record = external_person(displayName='Changed upstream', assignedLicenses=licenses)
            with patch('training.directory.graph_listing', return_value=[record]):
                result = directory.sync_directory(apply=True)
            user.refresh_from_db()
            self.assertEqual((user.display_name, user.email, user.directory_seen_at), original)
            self.assertTrue(user.is_active)
            self.assertEqual(result['counts']['update'], 0)
        with patch('training.directory.graph_listing', return_value=[external_person(accountEnabled=False)]):
            directory.sync_directory(apply=True)
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertIsNotNone(user.directory_disabled_at)
        user.is_active = True
        user.directory_disabled_at = None
        user.save()
        with patch('training.directory.graph_listing', return_value=[]):
            directory.sync_directory(apply=True)
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertEqual(OutboundEmail.objects.count(), before_mail)
        self.assertEqual(len(mail.outbox), 1)


@override_settings(**DOMAIN_SETTINGS)
class ExactGraphLookupTests(SimpleTestCase):
    def setUp(self):
        directory._email_clients.clear()
        self.addCleanup(directory._email_clients.clear)
        self.factory = patch('training.directory.msal.ConfidentialClientApplication').start()
        self.factory.return_value.acquire_token_for_client.return_value = {'access_token': 'synthetic-token'}
        self.addCleanup(patch.stopall)

    def test_exact_filter_quote_escaping_select_top_timeout_and_no_redirect(self):
        opener = Mock()
        opener.open.return_value = Response({'value': [external_person()]})
        with patch('training.directory.build_opener', return_value=opener) as build, \
             patch('training.directory.validate_link', wraps=directory.validate_link) as validate:
            self.assertEqual(directory.graph_email_lookup("o'brien@plant.example.com"), [external_person()])
        request = opener.open.call_args.args[0]
        parsed = urlsplit(request.full_url)
        self.assertEqual((parsed.scheme, parsed.netloc, parsed.path), ('https', 'graph.microsoft.com', '/v1.0/users'))
        self.assertEqual(parse_qs(parsed.query), {'$filter': ["mail eq 'o''brien@plant.example.com'"],
                        '$top': ['2'], '$select': [directory.GRAPH_USER_FIELDS]})
        self.assertEqual(opener.open.call_args.kwargs, {'timeout': 10})
        self.assertEqual(self.factory.call_args.kwargs['timeout'], 10)
        http = self.factory.call_args.kwargs['http_client']
        self.assertEqual(http.request.keywords, {'timeout': 10, 'allow_redirects': False})
        self.assertEqual(http.get_adapter('https://example.invalid').max_retries.total, 0)
        self.assertTrue(http.trust_env)
        self.assertIsInstance(build.call_args.args[0], directory.NoRedirect)
        self.assertIsNone(build.call_args.args[0].redirect_request(None, None, 302, '', {}, 'https://example.invalid'))
        validate.assert_called_once_with(request.full_url)

    def test_invalid_address_never_fetches_token_or_graph(self):
        opener = Mock()
        for address in ('bad@@plant.example.com', "x' or true", 'x\r\n@plant.example.com'):
            with self.assertRaises(Exception):
                directory.graph_email_lookup(address, opener=opener)
        self.factory.assert_not_called()
        opener.open.assert_not_called()

    def test_module_client_reused_and_secret_rotation_replaces_client(self):
        opener = Mock()
        opener.open.side_effect = [Response({'value': []}) for _ in range(4)]
        directory.graph_email_lookup(ADDRESS, opener=opener)
        directory.graph_email_lookup(ADDRESS, opener=opener)
        self.assertEqual(self.factory.call_count, 1)
        self.assertEqual(self.factory.return_value.acquire_token_for_client.call_count, 2)
        with override_settings(GRAPH_DIRECTORY_CLIENT_SECRET='rotated-synthetic'):
            directory.graph_email_lookup(ADDRESS, opener=opener)
        self.assertEqual(self.factory.call_count, 2)
        with override_settings(GRAPH_DIRECTORY_CLIENT_ID='33333333-3333-4333-8333-333333333333'):
            directory.graph_email_lookup(ADDRESS, opener=opener)
        self.assertEqual(self.factory.call_count, 3)

    def test_missing_token_and_token_timeout_prevent_graph(self):
        opener = Mock()
        self.factory.return_value.acquire_token_for_client.return_value = {'error': 'synthetic failure'}
        with self.assertRaises(directory.DirectoryError):
            directory.graph_email_lookup(ADDRESS, opener=opener)
        self.factory.return_value.acquire_token_for_client.side_effect = TimeoutError('private token')
        with self.assertRaises(TimeoutError):
            directory.graph_email_lookup(ADDRESS, opener=opener)
        opener.open.assert_not_called()

    def test_429_and_503_retry_only_once_with_short_retry_after(self):
        for code in (429, 503):
            error = HTTPError('https://graph.microsoft.com/v1.0/users', code, 'private body', {'Retry-After': '5'}, None)
            opener, sleep = Mock(), Mock()
            opener.open.side_effect = [error, Response({'value': []})]
            self.assertEqual(directory.graph_email_lookup(ADDRESS, opener=opener, sleep=sleep), [])
            self.assertEqual(opener.open.call_count, 2)
            sleep.assert_called_once_with(5)
            opener.open.reset_mock()
            opener.open.side_effect = [error, error]
            with self.assertRaises(HTTPError):
                directory.graph_email_lookup(ADDRESS, opener=opener, sleep=sleep)
            self.assertEqual(opener.open.call_count, 2)

    def test_long_missing_invalid_retry_after_and_other_statuses_do_not_retry(self):
        for code, header in ((429, '6'), (503, None), (429, 'not-a-time'), (503, 'nan'), (503, '-1'), (403, '1'), (302, '1')):
            opener, sleep = Mock(), Mock()
            opener.open.side_effect = HTTPError('https://graph.microsoft.com/v1.0/users', code, 'private', {'Retry-After': header}, None)
            with self.assertRaises(HTTPError):
                directory.graph_email_lookup(ADDRESS, opener=opener, sleep=sleep)
            self.assertEqual(opener.open.call_count, 1)
            sleep.assert_not_called()

    def test_short_http_date_retry_after_is_honored(self):
        from email.utils import format_datetime
        now = timezone.now().replace(microsecond=0)
        opener, sleep = Mock(), Mock()
        error = HTTPError('https://graph.microsoft.com/v1.0/users', 429, 'private',
                          {'Retry-After': format_datetime(now + timedelta(seconds=3), usegmt=True)}, None)
        opener.open.side_effect = [error, Response({'value': []})]
        with patch('training.directory.datetime') as clock:
            clock.now.return_value = now
            self.assertEqual(directory.graph_email_lookup(ADDRESS, opener=opener, sleep=sleep), [])
        sleep.assert_called_once_with(3)

    def test_partial_invalid_response_and_network_failure_rejected(self):
        for page in ({'value': [external_person()], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skip=1'},
                     {'value': {}}, [], {'error': 'private'}):
            opener = Mock()
            opener.open.return_value = Response(page)
            with self.assertRaises(directory.DirectoryError):
                directory.graph_email_lookup(ADDRESS, opener=opener)
            self.assertEqual(opener.open.call_count, 1)
        opener = Mock()
        opener.open.side_effect = TimeoutError('private')
        with self.assertRaises(TimeoutError):
            directory.graph_email_lookup(ADDRESS, opener=opener)
        self.assertEqual(opener.open.call_count, 1)
