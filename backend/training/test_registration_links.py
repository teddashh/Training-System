"""Synthetic public registration capabilities and unchanged admission contracts."""
import base64
import json
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import AnonRateThrottle

from .access import ROLE_POLICY, manages_course
from .course_sessions import visible_sessions
from .models import AuditEvent, Course, CourseSession, Enrollment, OutboundEmail, User


class RegistrationLinkTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.owner = User.objects.create_user('synthetic-owner', role='instructor')
        self.learner = User.objects.create_user('synthetic-learner')
        self.course = Course.objects.create(owner=self.owner, title='Synthetic course', description='Public description', published=True)
        self.client = APIClient()

    def issue(self, course=None, **data):
        return self.client.post(f'/api/courses/{(course or self.course).pk}/registration-link/', data, format='json')

    def key(self):
        self.client.force_authenticate(self.owner)
        response = self.issue()
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(None)
        return response.data['url'].split('#')[1]

    def lookup(self, key):
        return self.client.post('/api/registration/lookup/', {'key': key}, format='json')

    def session(self, **extra):
        now = timezone.now()
        values = dict(course=self.course, title='Synthetic session', starts_at=now+timedelta(days=1),
                      ends_at=now+timedelta(days=1, hours=1), capacity=2,
                      meeting_url='https://example.test/private-meeting', location='Synthetic Room')
        return CourseSession.objects.create(**{**values, **extra})

    def test_each_role_creation_rotation_ownership_and_audit_ids_only(self):
        for role in [*ROLE_POLICY, 'unknown']:
            actor = User.objects.create_user('role-' + role, role=role)
            for own in (True, False):
                course = Course.objects.create(owner=actor if own else self.owner, title='Synthetic', published=True)
                self.client.force_authenticate(actor)
                allowed = manages_course(actor, course)
                first = self.issue(course)
                self.assertEqual(first.status_code, 200 if allowed else 403, (role, own))
                if allowed:
                    key = first.data['url'].split('#')[1]
                    self.assertGreaterEqual(len(base64.urlsafe_b64decode(key + '=')), 32)
                    self.assertEqual(self.issue(course).data, first.data)
                    second = self.issue(course, rotate=True)
                    self.assertNotEqual(second.data, first.data)
                    events = AuditEvent.objects.filter(target=str(course.pk), action__startswith='course.registration_')
                    self.assertEqual(events.count(), 2)
                    self.assertEqual(list(events.values_list('detail', flat=True)), [{}, {}])
                    self.assertNotIn(key, json.dumps(list(events.values('detail', 'target'))))
                else:
                    self.assertEqual(self.issue(course, rotate=True).status_code, 403)
                    course.refresh_from_db()
                    self.assertIsNone(course.registration_key)
        self.client.force_authenticate(None)
        self.assertIn(self.issue().status_code, (401, 403))
        self.assertFalse(OutboundEmail.objects.exists())

    @override_settings(APP_ORIGIN='https://training.example.test', APP_BASE_PATH='/training')
    def test_link_subpath_reuse_rotation_and_no_list_or_detail_key(self):
        key = self.key()
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.issue().data['url'], 'https://training.example.test/training/register#' + key)
        for url in ('/api/courses/', f'/api/courses/{self.course.pk}/'):
            response = self.client.get(url)
            self.assertNotIn(key, json.dumps(response.data, default=str))
            self.assertNotIn('registration_key', json.dumps(response.data, default=str))
        self.issue(rotate=True)
        self.assertEqual(self.lookup(key).status_code, 404)

    def test_invalid_variants_have_one_answer(self):
        key = self.key()
        invalid = self.lookup('unknown' * 7)
        self.assertEqual((invalid.status_code, invalid.data), (404, {'detail': 'This registration link is not valid.'}))
        for value in (None, {}, [], '', 123, 'a'*1000):
            result = self.lookup(value)
            self.assertEqual((result.status_code, result.data), (404, invalid.data))
        for change in ({'published': False}, {'published': True, 'release_at': timezone.now()+timedelta(days=1)}):
            Course.objects.filter(pk=self.course.pk).update(**change)
            result = self.lookup(key)
            self.assertEqual((result.status_code, result.data), (404, invalid.data))

    def test_public_projection_and_exact_learner_session_filter(self):
        self.course.delivery_mode = 'scheduled'
        self.course.blocks = [{'private': 'private-material'}]
        self.course.save()
        now = timezone.now()
        opened = self.session()
        upcoming = self.session(registration_opens_at=now+timedelta(hours=1))
        full = self.session(capacity=1)
        full_upcoming = self.session(capacity=1, registration_opens_at=now+timedelta(hours=1))
        for session in (full, full_upcoming):
            Enrollment.objects.create(course=self.course, session=session,
                user=User.objects.create_user('seat-' + str(session.pk)), status='pending')
        self.session(starts_at=now-timedelta(hours=1), ends_at=now+timedelta(hours=1))
        self.session(starts_at=now-timedelta(hours=2), ends_at=now-timedelta(hours=1))
        self.session(cancelled=True)
        self.session(registration_closes_at=now-timedelta(minutes=1))
        key = self.key()
        result = self.lookup(key)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result['Cache-Control'], 'no-store')
        data = result.data
        self.assertEqual(set(data), {'id', 'title', 'description', 'category', 'cover', 'duration_minutes',
                                   'delivery_mode', 'venue', 'requires_approval', 'sessions'})
        self.assertEqual([s['id'] for s in data['sessions']], [opened.pk, upcoming.pk])
        self.assertEqual([s['id'] for s in data['sessions']], [s['id'] for s in visible_sessions(self.learner, self.course)])
        for session in data['sessions']:
            upcoming_keys = {'registration_opens_at'} if session['state'] == 'upcoming' else set()
            self.assertEqual(set(session), {'id', 'title', 'starts_at', 'ends_at', 'state', 'seats_remain', 'seats_left'} | upcoming_keys)
            self.assertTrue(session['seats_remain'])
        for private in (key, 'private-material', 'private-meeting', self.owner.username, 'registration_key', 'meeting_url', 'owner', 'capacity', 'reserved'):
            self.assertNotIn(private, json.dumps(data, default=str))
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.lookup(key).data, {**data, 'enrollment': None})  # No unrelated personal details.
        self.course.refresh_from_db(); self.course.venue = 'onsite'; self.course.save()
        self.assertEqual(self.lookup(key).data['sessions'][0]['location'], 'Synthetic Room')

    def test_self_paced_has_no_sessions_and_translated_invalid_answer(self):
        self.session()
        self.assertEqual(self.lookup(self.key()).data['sessions'], [])
        for locale, expected in [('zh-hant', '這個報名連結無效。'), ('es', 'Este enlace de inscripción no es válido.')]:
            result = self.client.post('/api/registration/lookup/', {'key': 'unknown'*7}, format='json', HTTP_ACCEPT_LANGUAGE=locale)
            self.assertEqual(result.data['detail'], expected)

    def test_public_csrf_and_guest_equivalent_throttling(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.post('/api/registration/lookup/', {'key': 'a'*43}, format='json').status_code, 403)
        with patch.object(AnonRateThrottle, 'get_rate', return_value='1/min'):
            self.assertEqual(self.lookup('a'*43).status_code, 404)
            self.assertEqual(self.lookup('a'*43).status_code, 429)

    def test_existing_enroll_endpoint_keeps_approval_full_removed_and_hidden_rules(self):
        self.course.delivery_mode = 'scheduled'; self.course.requires_approval = True; self.course.save()
        opened = self.session(capacity=1)
        self.key()
        self.assertFalse(Enrollment.objects.exists())
        self.client.force_authenticate(self.learner)
        url = f'/api/courses/{self.course.pk}/enroll/'
        admitted = self.client.post(url, {'session': opened.pk}, format='json')
        self.assertEqual(admitted.data['status'], 'pending')
        repeated = self.client.post(url, {'session': opened.pk}, format='json')
        self.assertEqual(repeated.data['id'], admitted.data['id'])
        other = User.objects.create_user('other-learner')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.post(url, {'session': opened.pk}, format='json').status_code, 400)
        for options in ({'cancelled': True}, {'registration_closes_at': timezone.now()-timedelta(hours=1)},
                        {'registration_opens_at': timezone.now()+timedelta(hours=1)},
                        {'starts_at': timezone.now()-timedelta(minutes=1)}):
            hidden = self.session(**options)
            self.assertEqual(self.client.post(url, {'session': hidden.pk}, format='json').status_code, 400)
        row = Enrollment.objects.get(user=self.learner)
        row.status = 'removed'; row.save()
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.post(url, {'session': self.session().pk, 'revision': row.revision}, format='json').status_code, 403)

    def test_migration_old_writer_insert_omits_new_column(self):
        executor = MigrationExecutor(connection)
        state = executor.loader.project_state([('training', '0023_onsite_courses')])
        OldCourse = state.apps.get_model('training', 'Course')
        self.assertNotIn('registration_key', [f.name for f in OldCourse._meta.fields])
        old = OldCourse.objects.create(owner_id=self.owner.pk, title='Old image insert')
        self.assertIsNone(Course.objects.get(pk=old.pk).registration_key)
        OldCourse.objects.create(owner_id=self.owner.pk, title='Another old insert')
        field = Course._meta.get_field('registration_key')
        self.assertTrue(field.null)
        self.assertTrue(field.unique)
        self.assertIsNone(field.db_default)
