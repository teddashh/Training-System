"""Runtime configuration and identity flows: synthetic data, no external calls."""
import base64
import hashlib
import io
import json
import time
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.fernet import Fernet
from django.conf import settings
from django.core import mail
from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone, translation
from PIL import Image
from pypdf import PdfReader
from rest_framework.test import APIClient

from . import google_auth
from .brand import BRAND
from .email_layout import render_email
from .email_views import configured
from .mail import ConfiguredEmailBackend
from .models import AuditEvent, Course, CourseSession, OutboundEmail, SystemSettings, User
from .notifications import enqueue, deliver_queued, message_content
from .runtime_settings import (allowed_languages, decrypt, encrypt, from_email, mail_config,
                               organization, sign_in_config)

LOCAL = dict(EMAIL_SERVER=False, EMAIL_BACKEND='training.mail.ConfiguredEmailBackend',
    ENTRA_TENANT_ID='', ENTRA_CLIENT_ID='', ENTRA_CLIENT_SECRET='', GOOGLE_CLIENT_ID='', GOOGLE_CLIENT_SECRET='',
    INTERFACE_LANGUAGES_SERVER=False, INTERFACE_LANGUAGES=['en', 'zh-TW', 'es'], SETTINGS_ENCRYPTION_KEY='')
TENANT = '11111111-1111-4111-8111-111111111111'
CLIENT = '22222222-2222-4222-8222-222222222222'


def logo_file(fmt='PNG', size=(16, 8), mime=None):
    output = io.BytesIO()
    Image.new('RGB', size, 'white').save(output, format=fmt)
    return SimpleUploadedFile('logo.' + fmt.lower(), output.getvalue(), content_type=mime or Image.MIME[fmt])


@override_settings(**LOCAL)
class SystemSettingsTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user('owner', email='owner@example.com', role='admin')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def put(self, section, data):
        return self.client.put('/api/settings/' + section + '/', data, format='json')

    def google(self, **extra):
        return self.put('sign_in', dict(provider='google', client_id='synthetic-client',
            client_secret='synthetic-google-secret', domains=['example.com'], **extra))

    def test_permissions_all_writes_and_reads(self):
        for role in ('learner', 'training_admin', 'exam_admin', 'course_creator', 'training_scheduler'):
            with self.subTest(role=role):
                user = User.objects.create_user(role, role=role, is_staff=True)
                self.client.force_authenticate(user)
                self.assertEqual(self.client.get('/api/settings/').status_code, 403)
                for section in ('organization', 'sign_in', 'email'):
                    self.assertEqual(self.put(section, {}).status_code, 403)
                self.assertEqual(self.client.post('/api/settings/logo/').status_code, 403)
                self.assertEqual(self.client.delete('/api/settings/logo/').status_code, 403)

    def test_server_lock_partial_credentials_and_languages(self):
        for variable in ('ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'):
            with self.subTest(variable=variable), override_settings(**{variable: 'synthetic-1234'}):
                response = self.client.get('/api/settings/')
                self.assertTrue(response.data['sign_in']['server'])
                self.assertNotIn('synthetic-1234', json.dumps(response.data))
                self.assertEqual(self.google().status_code, 409)
        with override_settings(EMAIL_SERVER=True):
            self.assertEqual(self.put('email', {'provider': 'off'}).status_code, 409)
        with override_settings(INTERFACE_LANGUAGES_SERVER=True, INTERFACE_LANGUAGES=['en']):
            self.assertEqual(self.put('organization', {'languages': ['es']}).status_code, 409)
            self.assertEqual(self.put('organization', {'organization_name': 'Cedar'}).status_code, 200)
            self.assertEqual(allowed_languages(), ['en'])

    def test_secret_encryption_preservation_and_no_audit_values(self):
        response = self.google()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['sign_in']['client_secret_set'])
        self.assertNotIn('synthetic-google-secret', json.dumps(response.data))
        row = SystemSettings.objects.get()
        self.assertNotIn('synthetic-google-secret', json.dumps(row.sign_in_fields))
        ciphertext = row.sign_in_fields['client_secret']
        self.assertEqual(decrypt(ciphertext), 'synthetic-google-secret')
        self.assertEqual(self.put('sign_in', {'provider': 'google', 'client_id': 'synthetic-client', 'domains': ['example.com']}).status_code, 200)
        self.assertEqual(SystemSettings.objects.get().sign_in_fields['client_secret'], ciphertext)
        self.assertTrue(all(event.detail == {} and event.target == '' for event in AuditEvent.objects.all()))
        self.assertNotIn('synthetic-google-secret', str(list(AuditEvent.objects.values())))

    def test_key_change_disables_provider_and_requests_secret(self):
        self.google()
        with override_settings(SECRET_KEY='another-synthetic-key'):
            self.assertFalse(sign_in_config()['configured'])
            response = self.client.get('/api/settings/')
            self.assertFalse(response.data['sign_in']['client_secret_set'])
            self.assertFalse(self.client.get('/api/auth/session/').data['sign_in']['google'])
            self.assertEqual(self.put('sign_in', {'provider': 'google', 'client_id': 'synthetic', 'domains': ['example.com']}).status_code, 400)
            self.assertEqual(self.google().status_code, 200)
        with override_settings(SETTINGS_ENCRYPTION_KEY=Fernet.generate_key().decode()):
            value = encrypt('synthetic')
            with override_settings(SECRET_KEY='changed-again'):
                self.assertEqual(decrypt(value), 'synthetic')
        with override_settings(SETTINGS_ENCRYPTION_KEY='invalid'):
            self.assertEqual(decrypt(value), '')
            self.assertEqual(self.google().status_code, 400)

    def test_switching_providers_keeps_secrets_separate(self):
        self.google()
        self.assertEqual(self.put('sign_in', {'provider': 'entra', 'tenant_id': TENANT, 'client_id': CLIENT}).status_code, 400)
        self.assertEqual(self.put('sign_in', {'provider': 'entra', 'tenant_id': TENANT, 'client_id': CLIENT, 'client_secret': 'entra-secret'}).status_code, 200)
        self.assertEqual(self.put('sign_in', {'provider': 'none'}).status_code, 200)
        response = self.put('sign_in', {'provider': 'google', 'client_id': 'synthetic-client', 'domains': ['example.com']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sign_in_config()['client_secret'], 'synthetic-google-secret')
        self.assertNotIn('provider_secrets', json.dumps(response.data))

    def test_request_cache_reads_once_and_next_request_sees_changes(self):
        from .runtime_settings import settings_snapshot
        with settings_snapshot(), self.assertNumQueries(1):
            organization(); allowed_languages(); sign_in_config(); mail_config()
        SystemSettings.objects.create(organization_name='Maple')
        with settings_snapshot(), self.assertNumQueries(1):
            self.assertEqual(organization()['name'], 'Maple')
            self.assertEqual(organization()['title'], 'Maple Training')

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_verification_and_test_email_use_organization_title(self):
        self.put('organization', {'organization_name': 'Cedar'})
        self.assertEqual(self.client.post('/api/auth/email/request/', {'email': self.admin.email}, format='json').status_code, 200)
        self.assertTrue(mail.outbox[-1].subject.startswith('Cedar Training'))
        self.assertTrue(mail.outbox[-1].body.startswith('Cedar Training'))
        self.assertEqual(self.client.post('/api/email/test/').status_code, 200)
        self.assertTrue(mail.outbox[-1].subject.startswith('Cedar Training'))

    def test_settings_validation(self):
        for data in ({'organization_name': 'x' * 81}, {'languages': []}, {'languages': ['fr']}, {'organization_name': 'bad\nname'}):
            self.assertEqual(self.put('organization', data).status_code, 400)
        for domains in ([], ['https://example.com'], 'example.com'):
            self.assertEqual(self.put('sign_in', dict(provider='google', client_id='client', client_secret='secret', domains=domains)).status_code, 400)
        self.assertFalse(SystemSettings.objects.exists())

    def test_logo_formats_reencoded_headers_and_removal(self):
        for fmt in ('PNG', 'JPEG', 'WEBP'):
            with self.subTest(fmt=fmt):
                response = self.client.post('/api/settings/logo/', {'logo': logo_file(fmt)}, format='multipart')
                self.assertEqual(response.status_code, 200, response.data)
                row = SystemSettings.objects.get()
                raw = bytes(row.logo)
                self.assertTrue(raw.startswith(b'\x89PNG'))
                self.assertEqual((row.logo_width, row.logo_height), (16, 8))
                self.assertEqual(row.logo_size, len(raw))
                self.assertEqual(row.logo_hash, hashlib.sha256(raw).hexdigest())
                self.client.force_authenticate(None)
                public = self.client.get(response.data['organization']['logo_url'])
                self.assertEqual(public.content, raw)
                self.assertEqual(public['Content-Type'], 'image/png')
                self.assertEqual(public['X-Content-Type-Options'], 'nosniff')
                self.assertIn('immutable', public['Cache-Control'])
                self.client.force_authenticate(self.admin)
        previous = response.data['organization']['logo_url']
        self.assertEqual(self.client.delete('/api/settings/logo/').status_code, 200)
        self.assertIsNone(organization()['logo_url'])
        self.assertEqual(self.client.get(previous).status_code, 404)

    def test_logo_rejects_bad_formats_dimensions_size_and_mime(self):
        files = [SimpleUploadedFile('logo.svg', b'<svg/>', content_type='image/svg+xml'),
            SimpleUploadedFile('logo.png', b'x' * (2 * 1024 * 1024 + 1), content_type='image/png'),
            logo_file(size=(2049, 1)), logo_file('JPEG', mime='image/png'),
            SimpleUploadedFile('logo.png', b'not an image', content_type='image/png'), logo_file('GIF', mime='image/gif')]
        for upload in files:
            self.assertEqual(self.client.post('/api/settings/logo/', {'logo': upload}, format='multipart').status_code, 400)
        self.assertFalse(SystemSettings.objects.exists())

    def test_session_brand_language_and_per_request_refresh(self):
        self.assertEqual(self.client.get('/api/auth/session/').data['organization']['title'], BRAND['title'])
        self.assertEqual(self.put('organization', {'organization_name': 'Cedar', 'languages': ['es', 'en']}).status_code, 200)
        self.google()
        self.client.force_authenticate(None)
        response = self.client.get('/api/auth/session/', HTTP_ACCEPT_LANGUAGE='zh-TW')
        self.assertEqual(response.data['organization'], {'name': 'Cedar', 'title': 'Cedar Training', 'logo_url': None})
        self.assertEqual(response.data['languages'], ['es', 'en'])
        self.assertEqual(response['Content-Language'], 'es')
        self.assertEqual(response.data['sign_in'], {'entra': False, 'google': True})
        self.assertFalse(response.data['entra_enabled'])
        self.assertFalse(response.data['email_enabled'])
        from .i18n import current_locale
        with translation.override('zh-hant'):
            self.assertEqual(current_locale(), 'es')

    def test_organization_mail_and_pdf(self):
        self.put('organization', {'organization_name': 'Cedar'})
        text, html = render_email(title='Synthetic training', next_step='Open training.')
        self.assertTrue(text.startswith('Cedar Training'))
        self.assertIn('Cedar Training', html)
        course = Course.objects.create(title='Synthetic training', owner=self.admin, published=True, delivery_mode='scheduled')
        session = CourseSession.objects.create(course=course, title='Morning', starts_at=timezone.now(), ends_at=timezone.now() + timezone.timedelta(hours=1))
        self.assertTrue(message_content('Assigned', course)[0].startswith('Cedar Training:'))
        self.assertEqual(self.client.post('/api/settings/logo/', {'logo': logo_file(size=(1, 2048))}, format='multipart').status_code, 200)
        response = self.client.get(f'/api/courses/{course.pk}/sessions/{session.pk}/export/?kind=sign-in-pdf')
        self.assertEqual(PdfReader(io.BytesIO(response.content)).metadata.author, 'Cedar Training')

    def test_stored_entra_flow(self):
        response = self.put('sign_in', {'provider': 'entra', 'tenant_id': TENANT, 'client_id': CLIENT, 'client_secret': 'entra-secret'})
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(None)
        with patch('training.auth_views.msal.ConfidentialClientApplication') as msal, patch('training.directory.refresh_signin_profile', return_value=True):
            msal.return_value.initiate_auth_code_flow.return_value = {'auth_uri': 'https://example.com/login'}
            self.assertEqual(self.client.get('/api/auth/entra/').status_code, 302)
            msal.assert_called_with(CLIENT, authority='https://login.microsoftonline.com/' + TENANT, client_credential='entra-secret')
            msal.return_value.acquire_token_by_auth_code_flow.return_value = {'id_token_claims': {'tid': TENANT, 'oid': CLIENT, 'preferred_username': 'learner@example.com'}}
            self.assertEqual(self.client.get('/api/auth/entra/callback/').status_code, 302)
            self.assertTrue(User.objects.filter(entra_subject=TENANT + ':' + CLIENT).exists())

    def test_readiness_treats_email_off_as_a_choice(self):
        from .readiness import deployment_readiness
        email = lambda: next(c for c in deployment_readiness()['checks'] if c['key'] == 'email')
        self.assertEqual(email()['status'], 'off')
        self.assertEqual(self.smtp().status_code, 200)
        self.assertEqual(email()['status'], 'ready')
        with override_settings(SECRET_KEY='rotated'):
            self.assertEqual(email()['status'], 'action_required')
            self.assertFalse(deployment_readiness()['ready'])

    def smtp(self):
        return self.put('email', {'provider': 'smtp', 'host': 'smtp.example.com', 'port': 587, 'security': 'starttls',
            'username': 'sender@example.com', 'password': 'synthetic-password', 'from_email': 'sender@example.com'})

    def test_smtp_transport_and_key_change(self):
        self.assertEqual(self.smtp().status_code, 200)
        self.assertTrue(configured())
        self.assertEqual(from_email(), 'sender@example.com')
        self.assertNotIn('synthetic-password', json.dumps(self.client.get('/api/settings/').data))
        with patch('django.core.mail.backends.smtp.EmailBackend') as smtp:
            smtp.return_value.send_messages.return_value = 1
            self.assertEqual(ConfiguredEmailBackend().send_messages([mail.EmailMessage('test', 'body', from_email(), ['owner@example.com'])]), 1)
            smtp.assert_called_with(fail_silently=False, host='smtp.example.com', port=587, username='sender@example.com', password='synthetic-password', use_tls=True, use_ssl=False, timeout=10)
        with override_settings(SECRET_KEY='rotated'):
            self.assertFalse(configured())
            with self.assertRaises(ImproperlyConfigured):
                ConfiguredEmailBackend().send_messages([mail.EmailMessage()])

    def test_graph_transport(self):
        response = self.put('email', {'provider': 'graph', 'tenant_id': TENANT, 'client_id': CLIENT,
            'client_secret': 'graph-secret', 'from_email': 'sender@example.com'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(configured())
        self.assertNotIn('graph-secret', json.dumps(response.data))
        with patch('training.mail.GraphEmailBackend') as graph:
            graph.return_value.send_messages.return_value = 1
            self.assertEqual(ConfiguredEmailBackend().send_messages([mail.EmailMessage()]), 1)
            graph.assert_called_with(fail_silently=False, tenant_id=TENANT, client_id=CLIENT, client_secret='graph-secret', sender='sender@example.com')
        with override_settings(SECRET_KEY='rotated'):
            self.assertFalse(configured())

    def test_off_no_queue_no_codes_no_test_mail(self):
        self.assertFalse(configured())
        self.assertEqual(ConfiguredEmailBackend().send_messages([mail.EmailMessage()]), 0)
        course = Course.objects.create(title='Synthetic', owner=self.admin)
        self.assertFalse(enqueue(kind='assignment', user=self.admin, target=course, event='Assigned', dedupe_key='synthetic'))
        deliver_queued()
        for path in ('auth/email/request/', 'auth/email/verify/', 'guest/email/request/', 'guest/email/verify/', 'email/test/'):
            response = self.client.post('/api/' + path, {'email': self.admin.email}, format='json')
            self.assertEqual(response.status_code, 400)
            self.assertIn('Email is off.', str(response.data))
        self.assertFalse(OutboundEmail.objects.exists())
        self.assertTrue(self.client.get('/api/email/').data['off'])

    @override_settings(EMAIL_SERVER=True, EMAIL_HOST='smtp.example.com', DEFAULT_FROM_EMAIL='server@example.com')
    def test_host_only_environment_uses_legacy_smtp_transport(self):
        self.assertEqual(settings.EMAIL_BACKEND, 'training.mail.ConfiguredEmailBackend')
        # Preserve the legacy readiness rule for a synthetic example.com sender.
        self.assertFalse(configured())
        self.assertTrue(mail_config()['server'])
        with patch('django.core.mail.get_connection') as connect:
            connect.return_value.send_messages.return_value = 1
            self.assertEqual(ConfiguredEmailBackend().send_messages([mail.EmailMessage()]), 1)
            connect.assert_called_with('django.core.mail.backends.smtp.EmailBackend', fail_silently=False)

    def test_environment_wins_over_stored_mail(self):
        self.smtp()
        with override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', DEFAULT_FROM_EMAIL='server@example.com'):
            self.assertTrue(mail_config()['server'])
            self.assertEqual(from_email(), 'server@example.com')
            self.assertEqual(self.put('email', {'provider': 'off'}).status_code, 409)
            self.assertEqual(self.client.post('/api/email/test/').status_code, 200)
            self.assertEqual(mail.outbox[-1].from_email, 'server@example.com')


@override_settings(**LOCAL)
class GoogleFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.key.public_key()))
        cls.jwk.update(kid='synthetic-key', use='sig', alg='RS256')

    def setUp(self):
        self.client = APIClient()
        SystemSettings.objects.create(sign_in_provider='google', sign_in_fields={
            'client_id': 'synthetic-client', 'client_secret': encrypt('synthetic-secret'), 'domains': ['example.com']})
        google_auth._keys, google_auth._keys_until = None, 0
        self.get = patch('training.google_auth.requests.get').start()
        self.post = patch('training.google_auth.requests.post').start()
        self.addCleanup(patch.stopall)
        self.get.return_value.json.return_value = {'keys': [self.jwk]}

    def start(self):
        response = self.client.get('/api/auth/google/start/')
        self.assertEqual(response.status_code, 302)
        return self.client.session['google_flow'], parse_qs(urlsplit(response.url).query)

    def callback(self, changes=None, state=None):
        flow, query = self.start()
        claims = dict(sub='123456', email='learner@example.com', email_verified=True, hd='example.com',
            aud='synthetic-client', iss='https://accounts.google.com', iat=int(time.time()), exp=int(time.time())+300, nonce=flow['nonce'], name='Alex Reed')
        claims.update(changes or {})
        self.post.return_value.json.return_value = {'id_token': jwt.encode(claims, self.key, algorithm='RS256', headers={'kid': 'synthetic-key'})}
        return self.client.get('/api/auth/google/callback/', {'code': 'synthetic-code', 'state': state if state is not None else flow['state']})

    def test_pkce_and_create(self):
        flow, query = self.start()
        self.assertEqual(query['scope'], ['openid email profile'])
        self.assertEqual(query['hd'], ['example.com'])
        self.assertEqual(query['code_challenge_method'], ['S256'])
        self.assertEqual(query['code_challenge'][0], base64.urlsafe_b64encode(hashlib.sha256(flow['verifier'].encode()).digest()).rstrip(b'=').decode())
        response = self.callback()
        self.assertEqual(response.status_code, 302, getattr(response, 'data', None))
        self.assertEqual(response.url, settings.APP_ORIGIN + settings.APP_BASE_PATH + '/')
        user = User.objects.get(google_subject='123456')
        self.assertEqual((user.username, user.role, user.display_name), ('google_123456', 'learner', 'Alex Reed'))
        self.assertFalse(user.has_usable_password())
        self.assertTrue(AuditEvent.objects.filter(action='auth.google').exists())
        self.get.assert_called_once_with(google_auth.KEYS_URL, timeout=10)
        self.assertEqual(self.post.call_args.kwargs['timeout'], 10)
        self.assertIn('code_verifier', self.post.call_args.kwargs['data'])
        self.assertNotIn('google_flow', self.client.session)

    def test_link_existing_active_account(self):
        user = User.objects.create_user('learner', email='Learner@example.com')
        self.assertEqual(self.callback({'iss': 'accounts.google.com'}).status_code, 302)
        user.refresh_from_db()
        self.assertEqual(user.google_subject, '123456')
        self.assertTrue(AuditEvent.objects.filter(action='auth.google.link', actor=user).exists())
        self.assertEqual(self.callback().status_code, 302)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(AuditEvent.objects.filter(action='auth.google.link').count(), 1)
        self.assertEqual(self.get.call_count, 1)

    def test_invalid_claims(self):
        for changes in ({'nonce': 'wrong'}, {'aud': 'wrong'}, {'iss': 'https://example.com'}, {'exp': int(time.time())-1},
                        {'email_verified': False}, {'email_verified': 'true'}, {'hd': 'other.example.com'}, {'hd': ''}, {'sub': ''}):
            with self.subTest(changes=changes):
                response = self.callback(changes)
                self.assertEqual(response.status_code, 400)
                self.assertFalse(User.objects.exists())
        self.assertFalse(AuditEvent.objects.exists())

    def test_state_replay_expiry_and_provider_failure(self):
        self.assertEqual(self.callback(state='wrong').status_code, 400)
        self.post.assert_not_called()
        self.assertEqual(self.client.get('/api/auth/google/callback/').status_code, 400)
        self.start()
        session = self.client.session
        session['google_flow']['created_at'] = 0
        session.save()
        self.assertEqual(self.client.get('/api/auth/google/callback/').status_code, 400)
        self.post.side_effect = TimeoutError('synthetic-secret must not be returned')
        response = self.callback()
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('synthetic-secret', str(response.data))

    def test_untrusted_signatures_algorithms_and_missing_claims(self):
        other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        for algorithm, key, remove in [('RS256', other_key, None), ('HS256', 'synthetic-signing-key-at-least-32-characters', None), ('RS256', self.key, 'exp'), ('RS256', self.key, 'nonce')]:
            with self.subTest(algorithm=algorithm, remove=remove):
                flow, _ = self.start()
                claims = dict(sub='123456', email='learner@example.com', email_verified=True, hd='example.com',
                    aud='synthetic-client', iss='https://accounts.google.com', iat=int(time.time()), exp=int(time.time())+300, nonce=flow['nonce'])
                if remove:
                    del claims[remove]
                token = jwt.encode(claims, key, algorithm=algorithm, headers={'kid': 'synthetic-key'})
                self.post.return_value.json.return_value = {'id_token': token}
                response = self.client.get('/api/auth/google/callback/', {'code': 'synthetic', 'state': flow['state']})
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.callback(state='錯誤').status_code, 400)
        self.assertFalse(User.objects.exists())

    @override_settings(AUTH_ACCOUNT_LIMIT=1)
    def test_account_limits_are_per_verified_email(self):
        User.objects.create_user('first', email='learner@example.com')
        User.objects.create_user('second', email='another@example.com')
        self.assertEqual(self.callback().status_code, 302)
        self.assertEqual(self.callback({'email': 'another@example.com', 'sub': '654321'}).status_code, 302)
        self.assertEqual(self.callback().status_code, 429)

    def test_key_endpoint_failure_and_rate_limit(self):
        self.get.side_effect = TimeoutError('private provider failure')
        self.assertEqual(self.callback().status_code, 400)
        with override_settings(AUTH_NETWORK_LIMIT=1):
            self.assertEqual(self.client.get('/api/auth/google/start/').status_code, 429)
        self.assertFalse(User.objects.exists())

    def test_disabled_and_conflicting_accounts(self):
        user = User.objects.create_user('learner', email='learner@example.com', is_active=False)
        self.assertEqual(self.callback().status_code, 400)
        user.refresh_from_db()
        self.assertIsNone(user.google_subject)
        user.google_subject = '123456'
        user.save()
        self.assertEqual(self.callback().status_code, 400)
        user.is_active, user.google_subject = True, 'another-subject'
        user.save()
        self.assertEqual(self.callback().status_code, 400)
        self.assertFalse(AuditEvent.objects.exists())
