"""Offline deployment identity and interface language contracts."""
import io
import os
import runpy
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone, translation
from openpyxl import load_workbook
from pypdf import PdfReader
from rest_framework.test import APIClient

from .brand import BRAND, BRAND_PATH, TOKENS, load_brand, pdf_logo
from .email_layout import render_email
from .i18n import current_locale
from .languages import parse_interface_languages
from .models import Course, CourseSession, Enrollment, User


class DeploymentSettingsTests(TestCase):
    def test_language_parsing(self):
        for value in (None, '', '   '):
            self.assertEqual(parse_interface_languages(value), ['en', 'zh-TW', 'es'])
        self.assertEqual(parse_interface_languages(' ES, ZH-tw, en,ES '), ['es', 'zh-TW', 'en'])
        self.assertEqual(parse_interface_languages('unknown, zh-TW'), ['zh-TW'])
        self.assertEqual(parse_interface_languages('fr, uk'), ['en'])
        with patch.dict(os.environ, {'DEBUG': 'true', 'INTERFACE_LANGUAGES': ' ZH-tw, es '}):
            config = runpy.run_path(str(Path(settings.BASE_DIR) / 'config/settings.py'))
        self.assertEqual(config['LANGUAGE_CODE'], 'zh-hant')
        self.assertEqual(config['LANGUAGES'], [('zh-hant', 'Traditional Chinese'), ('es', 'Spanish')])

    @override_settings(INTERFACE_LANGUAGES=['es', 'en'])
    def test_current_locale_is_always_allowed(self):
        with translation.override('zh-hant'):
            self.assertEqual(current_locale(), 'es')
        with translation.override('en'):
            self.assertEqual(current_locale(), 'en')

    def test_active_brand_and_clear_failures(self):
        self.assertEqual(load_brand()[1], BRAND)
        for invalid in ('../default', 'UPPER', 'not-a-real-brand', ''):
            with self.assertRaisesRegex(ValueError, 'BRAND'):
                load_brand(name=invalid)
        self.assertTrue((BRAND_PATH / 'logo.svg').is_file())
        self.assertIsNotNone(pdf_logo(126))
        text, html = render_email(title='Synthetic course', next_step='Open training.')
        self.assertTrue(text.startswith(BRAND['title'] + '\n\n'))
        self.assertTrue(text.endswith(BRAND['email_footer']))
        self.assertIn(TOKENS['brand-blue'], html)


@override_settings(INTERFACE_LANGUAGES=['en'], LANGUAGE_CODE='en', LANGUAGES=[('en', 'English')])
class RestrictedLanguageTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user('synthetic-organizer', email='organizer@example.com', role='instructor')
        self.course = Course.objects.create(title='Synthetic training', owner=self.owner, delivery_mode='scheduled', published=True)
        self.session = CourseSession.objects.create(course=self.course, title='Synthetic session',
            starts_at=timezone.now() - timezone.timedelta(hours=1), ends_at=timezone.now() + timezone.timedelta(hours=1))
        learner = User.objects.create_user('synthetic-learner', email='learner@example.com')
        Enrollment.objects.create(course=self.course, session=self.session, user=learner, status='approved')

    def test_session_payload_including_anonymous_bootstrap(self):
        self.assertEqual(self.client.get('/api/auth/session/').data['languages'], ['en'])
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get('/api/auth/session/').data['languages'], ['en'])
        with override_settings(INTERFACE_LANGUAGES=['es', 'zh-TW']):
            self.assertEqual(self.client.get('/api/auth/session/').data['languages'], ['es', 'zh-TW'])

    def test_disallowed_header_and_cookie_get_english_api_and_validation(self):
        for cookie in ('', 'zh-hant', 'es'):
            self.client.cookies['django_language'] = cookie
            response = self.client.post('/api/auth/login/', {'identifier': 'missing@example.com', 'password': 'synthetic'},
                                        format='json', HTTP_ACCEPT_LANGUAGE='zh-TW')
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data['detail'], 'Incorrect account or password.')
            self.assertEqual(response['Content-Language'], 'en')
        self.client.force_authenticate(self.owner)
        response = self.client.get(f'/api/courses/{self.course.pk}/sessions/{self.session.pk}/export/',
                                   {'kind': 'invalid'}, HTTP_ACCEPT_LANGUAGE='es')
        self.assertEqual(response.data, ['Choose a valid export.'])

    def test_disallowed_header_gets_english_attendance_workbook(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get(f'/api/courses/{self.course.pk}/sessions/{self.session.pk}/export/',
                                   {'kind': 'attendance'}, HTTP_ACCEPT_LANGUAGE='zh-TW')
        self.assertEqual(response.status_code, 200)
        workbook = load_workbook(io.BytesIO(response.content))
        self.assertEqual(workbook.active.title, 'Attendance results')
        self.assertEqual(workbook.active['A1'].value, 'Attendance results')
        self.assertIn('Attendance', [cell.value for row in workbook.active for cell in row])

    def test_disallowed_header_gets_english_drf_errors_and_pdf(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post('/api/courses/', {}, format='json', HTTP_ACCEPT_LANGUAGE='es')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['title'], ['This field is required.'])
        response = self.client.get(f'/api/courses/{self.course.pk}/sessions/{self.session.pk}/export/',
                                   {'kind': 'sign-in-pdf'}, HTTP_ACCEPT_LANGUAGE='zh-TW')
        reader = PdfReader(io.BytesIO(response.content))
        self.assertIn('Sign-in sheet', reader.pages[0].extract_text())
        self.assertEqual(reader.metadata.author, BRAND['title'])

    @override_settings(INTERFACE_LANGUAGES=['es'], LANGUAGE_CODE='es', LANGUAGES=[('es', 'Spanish')],
                       EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_sign_in_email_stays_english_when_interface_is_spanish(self):
        response = self.client.post('/api/auth/email/request/', {'email': self.owner.email},
                                   format='json', HTTP_ACCEPT_LANGUAGE='es')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, BRAND['organization'] + ' sign-in code')
        self.assertIn('Your verification code: ', mail.outbox[0].body)
        self.assertIn('Valid for 10 minutes.', mail.outbox[0].body)
