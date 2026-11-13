"""Synthetic seven-role contract tests, including cross-owner and personal access."""
import ast
import csv
import io
import re
import uuid
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib import admin
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TestCase, SimpleTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (Attempt, AttemptReopening, BankQuestion, Course, CourseSession, Enrollment, Exam,
                     LearningAssignment, OutboundEmail, TrainingGroup, User)
from .services import finalize, identity_for_user, start_attempt
from .tests import make_exam, package_zip

# Independent acceptance expectations; do not derive these from the implementation.
EXPECTED = {
    'admin': ('all', 'all', 'all', True, True, True),
    'training_admin': ('all', 'all', 'all', True, True, False),
    'course_creator': ('own', 'none', 'none', True, False, False),
    'exam_admin': ('none', 'all', 'all', True, True, False),
    'training_scheduler': ('own', 'own', 'none', False, False, False),
    'instructor': ('own', 'own', 'own', True, True, False),
    'learner': ('none', 'none', 'none', False, False, False),
}


@override_settings(DEBUG=True, EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class RoleEndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        self.actor = User.objects.create_user('role-actor', email='actor@example.test')
        self.other = User.objects.create_user('role-other', role='instructor')
        self.participant = User.objects.create_user('role-participant', email='participant@example.test')
        self.client = APIClient()
        self.now = timezone.now()
        self.courses = [Course.objects.create(owner=owner, title=title, published=True,
                        delivery_mode='scheduled', blocks=[{'type': 'text', 'text': 'Synthetic lesson'}])
                        for owner, title in ((self.actor, 'Owned course'), (self.other, 'Other course'))]
        self.exams = [make_exam(owner, limit=20, essay=True) for owner in (self.actor, self.other)]
        for index, exam in enumerate(self.exams):
            exam.title = f'Synthetic exam {index}'
            exam.save(update_fields=['title'])
        self.group = TrainingGroup.objects.create(name='Synthetic group', created_by=self.other)

    def as_role(self, role):
        self.actor.role = role
        self.actor.save(update_fields=['role'])
        self.client.force_authenticate(self.actor)
        self.policy = EXPECTED[role]

    def permits(self, column, owned):
        value = self.policy[column]
        return value == 'all' or (value == 'own' and owned)

    def check(self, response, allowed, success=(200, 201, 204)):
        self.assertIn(response.status_code, success if allowed else (403, 404),
                      (response.status_code, getattr(response, 'data', response.content[:200])))

    def session_values(self):
        return {'title': 'Synthetic session', 'starts_at': (self.now + timedelta(days=2)).isoformat(),
                'ends_at': (self.now + timedelta(days=2, hours=1)).isoformat(), 'capacity': 10}

    def submitted(self, exam, person=None):
        attempt = start_attempt(exam.pk, identity_for_user(person or self.participant))
        finalize(attempt)
        return attempt

    def session_payload(self, role):
        self.as_role(role)
        response = self.client.get('/api/auth/session/')
        self.check(response, True)
        data = response.data['user']['access']
        self.assertEqual(tuple(data[k] for k in ('courses', 'exams', 'results', 'assign', 'invitations', 'system_admin')), self.policy)
        self.assertEqual(data['people'], role != 'learner')
        self.assertEqual(data['scorm_source'], role in ('admin', 'instructor'))
        with override_settings(SCORM_TRUSTED_SAME_ORIGIN=True):
            self.assertEqual(self.client.get('/api/auth/session/').data['user']['access']['scorm_upload'], role == 'admin')
        for owned, course, exam in zip((True, False), self.courses, self.exams):
            c = self.client.get(f'/api/courses/{course.pk}/').data
            e = self.client.get(f'/api/exams/{exam.pk}/').data
            self.assertEqual(c['can_manage'], self.permits(0, owned))
            self.assertEqual(e['can_manage'], self.permits(1, owned))
            self.assertEqual(e['can_view_results'], self.permits(2, owned))
        self.actor.refresh_from_db()
        self.assertFalse(self.actor.is_staff)
        self.assertFalse(self.actor.is_superuser)

    def course_authoring(self, role):
        self.as_role(role)
        self.check(self.client.post('/api/courses/', {'title': 'New synthetic course'}, format='json'), self.policy[0] != 'none')
        for owned, course in zip((True, False), self.courses):
            allow = self.permits(0, owned)
            base = f'/api/courses/{course.pk}/'
            self.check(self.client.patch(base, {'description': 'Edited', 'cover': 'learning-skills',
                       'blocks': [{'type': 'text', 'text': 'Updated'}]}, format='json'), allow)
            self.check(self.client.get(base + 'enrollments/'), allow)
            response = self.client.post(base + 'sessions/', self.session_values(), format='json')
            self.check(response, allow)
            session = CourseSession.objects.create(course=course, **self.session_values())
            self.check(self.client.patch(base + f'sessions/{session.pk}/', {'title': 'Rescheduled', 'revision': 0}, format='json'), allow)
            row = Enrollment.objects.create(course=course, user=self.participant, session=session, status='pending')
            self.check(self.client.post(base + f'enrollments/{row.pk}/review/',
                       {'revision': 0, 'decision': 'approved', 'note': ''}, format='json'), allow)
            if allow:
                self.check(self.client.post(base + f'enrollments/{row.pk}/review/',
                           {'revision': 1, 'decision': 'removed', 'note': 'Synthetic removal'}, format='json'), True)
            # Organizer content preview is independent from session registration.
            payload = self.client.get(base).data
            self.assertEqual(payload['can_learn'], allow)
            self.assertEqual(bool(payload['blocks']), allow)
            self.check(self.client.patch(base, {'published': False}, format='json'), allow)
            course.published = False
            course.save(update_fields=['published'])
            self.check(self.client.get(base), allow)

    def exam_authoring(self, role):
        self.as_role(role)
        self.check(self.client.post('/api/exams/', {'title': 'New exam'}, format='json'), self.policy[1] != 'none')
        for owned, exam in zip((True, False), self.exams):
            allow = self.permits(1, owned)
            base = f'/api/exams/{exam.pk}/'
            self.check(self.client.patch(base, {'title': exam.title, 'ends_at': (self.now + timedelta(days=5)).isoformat(),
                       'starts_at': None, 'max_attempts': 30, 'audience': 'all'}, format='json'), allow)
            self.check(self.client.patch(base, {'questions': [{'type': 'essay', 'description': 'Synthetic essay', 'points': 10}]}, format='json'), allow)
            self.check(self.client.post(base + 'budget/', {'key': self.participant.username, 'limit': 4}, format='json'), allow)
            self.check(self.client.post(base + 'previews/', {'mode': 'unrestricted'}, format='json'), allow)
            self.check(self.client.patch(base, {'published': False}, format='json'), allow)
            exam.published = False
            exam.save(update_fields=['published'])
            self.check(self.client.get(base), allow)
        # Figure upload is shared by exams and question bank; attaching still requires item rights.
        from PIL import Image
        out = io.BytesIO(); Image.new('RGB', (2, 2)).save(out, format='PNG')
        self.check(self.client.post('/api/question-figures/', {'file': SimpleUploadedFile('synthetic.png', out.getvalue(), content_type='image/png')}), self.policy[1] != 'none')

    def linking(self, role):
        self.as_role(role)
        # Course-side attachment needs C only, even for someone else's unpublished exam.
        exam = self.exams[1]
        exam.published = False; exam.save(update_fields=['published'])
        for owned, course in zip((True, False), self.courses):
            allow = self.permits(0, owned)
            base = f'/api/courses/{course.pk}/assessments/'
            response = self.client.get(base)
            self.check(response, allow)
            if allow:
                self.assertEqual(set(response.data['available'][0]), {'id', 'title', 'published', 'question_count', 'other_courses', 'can_manage', 'starts_at', 'ends_at', 'window_state', 'audience', 'available_to_me', 'release', 'gated'})
                self.assertIn(exam.pk, [e['id'] for e in response.data['available']])
            self.check(self.client.post(base, {'exam': exam.pk}, format='json'), allow)
            if allow:
                exam.refresh_from_db(); self.assertEqual(exam.course_id, course.pk)
                self.check(self.client.post(base, {'exam': exam.pk, 'attach': False}, format='json'), True)
                exam.refresh_from_db(); self.assertIsNone(exam.course_id)
        # A second link preserves the first course, with the same course-management gate.
        exam.courses.add(self.courses[1])
        response = self.client.post(f'/api/courses/{self.courses[0].pk}/assessments/', {'exam': exam.pk}, format='json')
        self.assertEqual(response.status_code, 200 if self.permits(0, True) else 403)
        response = self.client.get('/api/exams/link-options/')
        self.check(response, self.policy[1] != 'none')
        if self.policy[1] != 'none':
            self.assertEqual({e['id'] for e in response.data}, {c.pk for owned, c in zip((True, False), self.courses) if self.policy[1] == 'all' or self.permits(0, owned)})
            self.assertTrue(all(set(row) == {'id', 'title', 'published'} for row in response.data))
        for exam_owned, target in zip((True, False), self.exams):
            for course_owned, course in zip((True, False), self.courses):
                target.courses.clear()
                allow = self.permits(1, exam_owned) and (self.policy[1] == 'all' or self.permits(0, course_owned))
                response = self.client.patch(f'/api/exams/{target.pk}/', {'course': course.pk}, format='json')
                if allow:self.check(response, True)
                else:self.assertIn(response.status_code, (400, 403, 404))
                response = self.client.patch(f'/api/exams/{target.pk}/', {'course': None}, format='json')
                self.check(response, self.permits(1, exam_owned))

    def question_bank(self, role):
        self.as_role(role)
        questions = [BankQuestion.objects.create(owner=owner, description='Synthetic bank question', type='essay', points=10) for owner in (self.actor, self.other)]
        response = self.client.get('/api/question-bank/')
        self.check(response, self.policy[1] != 'none')
        if self.policy[1] != 'none':
            self.assertEqual({row['id'] for row in response.data}, {q.pk for own, q in zip((True, False), questions) if self.permits(1, own)})
        self.check(self.client.post('/api/question-bank/', {'description': 'Created', 'type': 'essay', 'points': 10}, format='json'), self.policy[1] != 'none')
        for owned, question in zip((True, False), questions):
            self.check(self.client.patch(f'/api/question-bank/{question.pk}/', {'description': 'Changed'}, format='json'), self.permits(1, owned))

    def result_access(self, role):
        self.as_role(role)
        attempts = [self.submitted(exam) for exam in self.exams]
        personal = self.submitted(self.exams[1], self.actor)
        expected = {str(a.pk) for own, a in zip((True, False), attempts) if self.permits(2, own)} | {str(personal.pk)}
        data = self.client.get('/api/results/?page=1').data
        self.assertEqual({a['id'] for a in data['results']}, expected)
        exported = self.client.get('/api/results/export/')
        self.assertEqual(len(list(csv.reader(io.StringIO(exported.content.decode('utf-8-sig'))))), len(expected) + 1)
        self.check(self.client.get(f'/api/attempts/{personal.pk}/'), True)
        for own, exam, attempt in zip((True, False), self.exams, attempts):
            allow = self.permits(2, own)
            for path in (f'exams/{exam.pk}/insights/', f'exams/{exam.pk}/monitor/', f'exams/{exam.pk}/marks/template/',
                         f'exams/{exam.pk}/marks/imports/', f'attempts/{attempt.pk}/inspection/', f'attempts/{attempt.pk}/reopenings/',
                         f'attempts/{attempt.pk}/extensions/', f'results/{attempt.pk}/review/'):
                with self.subTest(path=path):self.check(self.client.get('/api/' + path), allow)
            # Preview and apply real synthetic marks through the same R boundary.
            question = next(q for q in attempt.snapshot if q['type'] == 'essay')
            marks_csv = ('attempt_id,question_id,answer_revision,grading_revision,points,feedback\n'
                         f'{attempt.pk},{question["id"]},{attempt.answer_revision},{attempt.grading_revision},20,Synthetic feedback')
            marks = self.client.post(f'/api/exams/{exam.pk}/marks/imports/', {'csv': marks_csv, 'reason': 'Synthetic import'}, format='json')
            self.check(marks, allow)
            if allow:
                self.assertTrue(marks.data['valid'])
                detail = f"/api/exams/{exam.pk}/marks/imports/{marks.data['id']}/"
                self.check(self.client.get(detail), True)
                self.check(self.client.post(detail, {}, format='json'), True)
            else:
                detail = f'/api/exams/{exam.pk}/marks/imports/{uuid.uuid4()}/'
                self.check(self.client.get(detail), False)
                self.check(self.client.post(detail, {}, format='json'), False)
            attempt.refresh_from_db()
            self.check(self.client.post(f'/api/results/{attempt.pk}/review/', {'grades': {}, 'grading_revision': attempt.grading_revision}, format='json'), allow)
            self.check(self.client.post(f'/api/attempts/{attempt.pk}/reopenings/', {
                'request_id': str(uuid.uuid4()), 'minutes': 5, 'reason': 'Synthetic reopening',
                'answer_revision': attempt.answer_revision, 'submitted_at': attempt.submitted_at.isoformat()}, format='json'), allow)
            if allow:
                record = AttemptReopening.objects.filter(attempt=attempt).first()
                self.check(self.client.get(f'/api/attempts/{attempt.pk}/reopenings/{record.pk}/'), True)
            active = start_attempt(exam.pk, identity_for_user(self.other))
            self.check(self.client.post(f'/api/attempts/{active.pk}/extensions/', {
                'request_id': str(uuid.uuid4()), 'minutes': 5, 'reason': 'Synthetic extension'}, format='json'), allow)
        dashboard = self.client.get('/api/dashboard/').data
        if self.policy[2] == 'none':
            self.assertEqual(dashboard['graded_count'], 0)
            self.assertEqual(dashboard['pending'], 1)
            self.assertEqual(dashboard['trend'], [])
            self.assertEqual(sum(dashboard['distribution']), 0)

    def assignments(self, role):
        self.as_role(role)
        expected = set()
        for column, kind, targets in ((0, 'course', self.courses), (1, 'exam', self.exams)):
            for own, target in zip((True, False), targets):
                allow = self.policy[3] and self.permits(column, own)
                self.check(self.client.post('/api/assignments/', {'kind': kind, 'target_id': target.pk,
                           'audience': 'people', 'people': [self.participant.pk], 'notify': False}, format='json'), allow)
                item, _ = LearningAssignment.objects.get_or_create(user=self.participant, **{kind: target}, defaults={'created_by': self.other})
                report = allow and (kind == 'course' or self.permits(2, own))
                if report:expected.add(item.pk)
                self.check(self.client.post(f'/api/assignments/{item.pk}/cancel/', {}, format='json'), report)
        for path in ('/api/assignments/?report=1', '/api/assignments/export/'):
            response = self.client.get(path)
            self.check(response, self.policy[3])
            if self.policy[3]:
                if 'export' in path:
                    self.assertEqual(len(list(csv.reader(io.StringIO(response.content.decode('utf-8-sig'))))), len(expected)+1)
                else:self.assertEqual({a['id'] for a in response.data}, expected)
        personal = LearningAssignment.objects.create(user=self.actor, course=self.courses[1], created_by=self.other)
        self.assertEqual([a['id'] for a in self.client.get('/api/assignments/').data], [personal.pk])
        self.check(self.client.post('/api/assignments/group-preview/', {'groups': [self.group.pk]}, format='json'), self.policy[3])

    def invitations(self, role):
        self.as_role(role)
        for owned, exam in zip((True, False), self.exams):
            allow = self.policy[4] and self.permits(1, owned)
            response = self.client.post('/api/invitations/issue/', {'exam': exam.pk, 'key': 'guest@example.test',
                                        'max_attempts': 1, 'days': 7}, format='json')
            self.check(response, allow)
            if allow:
                self.check(self.client.post(f"/api/invitations/{response.data['id']}/revoke/", {}, format='json'), True)
            self.check(self.client.post('/api/invitations/bulk/', {'exam': exam.pk, 'csv': 'key\nbatch@example.test',
                       'require_email_verification': False, 'apply': False}, format='json'), allow)
        response = self.client.get('/api/invitations/')
        self.check(response, self.policy[4])
        if self.policy[4]:
            self.assertEqual({row['exam'] for row in response.data}, {e.pk for own, e in zip((True, False), self.exams) if self.permits(1, own)})

    def people_system(self, role):
        self.as_role(role)
        system = self.policy[5]
        for path in ('/api/exams/audience-options/', '/api/groups/', f'/api/groups/{self.group.pk}/'):
            self.check(self.client.get(path), role != 'learner')
        self.check(self.client.patch(f'/api/groups/{self.group.pk}/', {'description': 'Changed'}, format='json'), system)
        self.check(self.client.post('/api/groups/', {'name': 'Another synthetic group'}, format='json'), system)
        self.check(self.client.get(f'/api/groups/{self.group.pk}/members/'), system)
        self.check(self.client.post(f'/api/groups/{self.group.pk}/members/', {'user_ids': [self.participant.pk]}, format='json'), system)
        self.check(self.client.post(f'/api/groups/{self.group.pk}/remove-members/', {'user_ids': [self.participant.pk]}, format='json'), system)
        with patch('training.entra_groups.search_groups', return_value=[]) as search:
            self.check(self.client.get('/api/groups/entra-search/?search=Synthetic'), system)
            self.assertEqual(search.call_count, int(system))
        with patch('training.entra_groups.preview_or_apply', return_value={'synthetic': True}) as link:
            for path in ('/api/groups/entra-create/', f'/api/groups/{self.group.pk}/entra-link/'):
                self.check(self.client.post(path, {'entra_id': str(uuid.uuid4()), 'apply': False}, format='json'), system)
            self.group.entra_group_id = str(uuid.uuid4()); self.group.save(update_fields=['entra_group_id'])
            self.check(self.client.post(f'/api/groups/{self.group.pk}/entra-sync/', {'apply': False}, format='json'), system)
            self.assertEqual(link.call_count, 3 if system else 0)
        self.check(self.client.post(f'/api/groups/{self.group.pk}/entra-unlink/', {}, format='json'), system)
        for path in ('/api/users/', f'/api/users/{self.participant.pk}/', '/api/directory/status/', '/api/email/',
                     '/api/audit/', '/api/readiness/', '/api/administration/'):
            with self.subTest(path=path):self.check(self.client.get(path), system)
        self.check(self.client.post('/api/users/', {'username': 'new-synthetic-person', 'role': 'training_scheduler'}, format='json'), system)
        self.check(self.client.patch(f'/api/users/{self.participant.pk}/', {'role': 'course_creator'}, format='json'), system)
        self.check(self.client.post('/api/users/import/', {'csv': 'username,display_name\nimported-synthetic,Imported', 'apply': False}, format='json'), system)
        with patch('training.directory_views.sync_directory', return_value={'synthetic': True}) as sync:
            self.check(self.client.post('/api/directory/run/', {'apply': False}, format='json'), system)
            self.assertEqual(sync.call_count, int(system))
        with patch('training.email_views.send_message') as send:
            self.check(self.client.post('/api/email/test/', {}, format='json'), system)
            self.assertEqual(send.call_count, int(system))
        row = OutboundEmail.objects.create(kind='assignment', recipient_user=self.participant,
                to_email='participant@example.test', subject='Synthetic', body_text='Synthetic', status='queued')
        self.check(self.client.post(f'/api/email/{row.pk}/cancel/', {}, format='json'), system)
        row.status = 'failed'; row.save(update_fields=['status'])
        with override_settings(EMAIL_NOTIFICATIONS_ENABLED=True):
            self.check(self.client.post(f'/api/email/{row.pk}/retry/', {}, format='json'), system)
        # Existing is_staff is insufficient without the system-admin flag.
        self.actor.is_staff = True
        self.assertEqual(admin.site.has_permission(SimpleNamespace(user=self.actor)), system)

    def documents_scorm(self, role):
        self.as_role(role)
        with patch('training.documents.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='{"pages": []}')) as extract:
            for own, course in zip((True, False), self.courses):
                self.check(self.client.post('/api/documents/convert/', {'course': course.pk,
                    'file': SimpleUploadedFile('synthetic.pdf', b'synthetic')}), self.permits(0, own))
            self.check(self.client.post('/api/documents/convert/', {'file': SimpleUploadedFile('synthetic.pdf', b'synthetic')}), self.policy[0] != 'none')
            self.assertEqual(extract.call_count, sum(self.permits(0, own) for own in (True, False)) + int(self.policy[0] != 'none'))
        with TemporaryDirectory() as media, override_settings(MEDIA_ROOT=Path(media)):
            for trusted in (False, True):
                with override_settings(SCORM_TRUSTED_SAME_ORIGIN=trusted):
                    for own, course in zip((True, False), self.courses):
                        allow = role == 'admin' or (role == 'instructor' and own and not trusted)
                        self.check(self.client.post(f'/api/courses/{course.pk}/upload/',
                                   {'file': SimpleUploadedFile('synthetic.zip', package_zip().getvalue())}), allow)
                        source = self.client.get(f'/api/courses/{course.pk}/source/')
                        self.assertEqual(source.status_code, 400 if role == 'admin' or (role == 'instructor' and own) else 403)


# Separate test names make each role/workflow failure visible in CI output.
for _role in EXPECTED:
    for _workflow in ('session_payload', 'course_authoring', 'exam_authoring', 'linking', 'question_bank',
                      'result_access', 'assignments', 'invitations', 'people_system', 'documents_scorm'):
        def _test(self, role=_role, workflow=_workflow):
            getattr(self, workflow)(role)
        setattr(RoleEndpointTests, f'test_{_role}_{_workflow}', _test)


@override_settings(DEBUG=True)
class SessionVisibilityTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('session-owner', role='course_creator')
        self.learner = User.objects.create_user('session-learner')
        self.other = User.objects.create_user('session-other')
        self.course = Course.objects.create(owner=self.owner, title='Synthetic schedule', published=True, delivery_mode='scheduled')
        self.now = timezone.now()
        self.sessions = {}
        for state in ('open', 'upcoming', 'full', 'closed', 'in_progress', 'ended', 'cancelled'):
            values = {'starts_at': self.now + timedelta(days=2), 'ends_at': self.now + timedelta(days=2, hours=1), 'capacity': 1}
            if state == 'upcoming':values['registration_opens_at'] = self.now + timedelta(days=1)
            if state == 'closed':values['registration_closes_at'] = self.now - timedelta(hours=1)
            if state in ('in_progress', 'ended'):values['starts_at'] = self.now - timedelta(hours=2)
            if state == 'in_progress':values['ends_at'] = self.now + timedelta(hours=1)
            if state == 'ended':values['ends_at'] = self.now - timedelta(hours=1)
            if state == 'cancelled':values['cancelled'] = True
            self.sessions[state] = CourseSession.objects.create(course=self.course, title=state, **values)
        Enrollment.objects.create(user=self.other, course=self.course, session=self.sessions['full'], status='pending')
        self.client = APIClient()
        self.client.force_authenticate(self.learner)

    def visible(self, user, expected):
        self.client.force_authenticate(user)
        for path in ('/api/courses/', f'/api/courses/{self.course.pk}/', f'/api/courses/{self.course.pk}/sessions/'):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                rows = response.data if path.endswith('/sessions/') else response.data['sessions'] if isinstance(response.data, dict) else next(c for c in response.data if c['id'] == self.course.pk)['sessions']
                self.assertEqual({row['title'] for row in rows}, expected)

    def test_nonmanagers_see_open_upcoming_in_all_payloads_for_every_role(self):
        for role in EXPECTED:
            with self.subTest(role=role):
                self.learner.role = role; self.learner.save(update_fields=['role'])
                self.visible(self.learner, set(self.sessions) if EXPECTED[role][0] == 'all' else {'open', 'upcoming'})

    def test_pending_and_approved_keep_own_session_in_every_state(self):
        for status in ('approved', 'pending'):
            for state, session in self.sessions.items():
                with self.subTest(status=status, state=state):
                    Enrollment.objects.update_or_create(user=self.learner, course=self.course, defaults={'session': session, 'status': status})
                    self.visible(self.learner, {'open', 'upcoming', state})
        for status in ('cancelled', 'removed', 'rejected'):
            Enrollment.objects.filter(user=self.learner, course=self.course).update(status=status)
            self.visible(self.learner, {'open', 'upcoming'})

    def test_managers_see_every_session(self):
        self.visible(self.owner, set(self.sessions))

    def test_hidden_sessions_and_upcoming_cannot_be_enrolled_by_id(self):
        for state in set(self.sessions) - {'open'}:
            with self.subTest(state=state):
                response = self.client.post(f'/api/courses/{self.course.pk}/enroll/', {'session': self.sessions[state].pk}, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertFalse(Enrollment.objects.filter(user=self.learner).exists())
        response = self.client.post(f'/api/courses/{self.course.pk}/enroll/', {'session': self.sessions['open'].pk}, format='json')
        self.assertEqual(response.status_code, 200)

    def test_course_payload_query_count_does_not_grow_with_courses_or_sessions(self):
        with CaptureQueriesContext(connection) as initial:
            self.assertEqual(self.client.get('/api/courses/').status_code, 200)
        for n in range(8):
            course = Course.objects.create(owner=self.owner, title=f'Synthetic {n}', published=True, delivery_mode='scheduled')
            for index in range(3):
                CourseSession.objects.create(course=course, title=f'Session {index}', starts_at=self.now + timedelta(days=3), ends_at=self.now + timedelta(days=4))
        with CaptureQueriesContext(connection) as expanded:
            self.assertEqual(len(self.client.get('/api/courses/').data), 9)
        self.assertEqual(len(initial), len(expanded))


@override_settings(DEBUG=True)
class RoleSafetyTests(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user('safety-admin', role='admin', is_staff=True, is_superuser=True)
        self.client = APIClient(); self.client.force_authenticate(self.admin)

    def test_super_admin_cannot_disable_or_demote_self_to_any_role(self):
        for role in EXPECTED:
            if role != 'admin':
                self.assertEqual(self.client.patch(f'/api/users/{self.admin.pk}/', {'role': role}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(f'/api/users/{self.admin.pk}/', {'is_active': False}, format='json').status_code, 400)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, 'admin'); self.assertTrue(self.admin.is_active)

    def test_new_roles_never_gain_staff_or_superuser_flags(self):
        for role in EXPECTED:
            response = self.client.post('/api/users/', {'username': 'new-' + role, 'role': role, 'is_staff': True, 'is_superuser': True}, format='json')
            self.assertEqual(response.status_code, 201)
            user = User.objects.get(pk=response.data['id'])
            self.assertFalse(user.is_staff); self.assertFalse(user.is_superuser)
            if role != 'admin':
                user.is_staff = user.is_superuser = True; user.save()
                self.assertEqual(self.client.patch(f'/api/users/{user.pk}/', {'role': role}, format='json').status_code, 200)
                user.refresh_from_db()
                self.assertFalse(user.is_staff); self.assertFalse(user.is_superuser)

    def test_unknown_and_inactive_roles_fail_closed(self):
        from .access import access_for
        self.admin.role = 'future_role'
        data = access_for(self.admin)
        self.assertEqual((data['courses'], data['exams'], data['results']), ('none', 'none', 'none'))
        self.assertFalse(any(data[k] for k in ('assign', 'invitations', 'system_admin', 'people', 'scorm_source', 'scorm_upload')))
        self.admin.role = 'admin'; self.admin.is_active = False
        self.assertFalse(access_for(self.admin)['system_admin'])


    def test_django_form_protects_self_and_clears_non_system_staff_flags(self):
        from django import forms
        from django.test import RequestFactory
        from .admin import EnterpriseUserAdmin
        request = RequestFactory().get('/admin/data/training/user/')
        request.user = self.admin
        model_admin = EnterpriseUserAdmin(User, admin.site)
        def bound_form(user, changes):
            form_type = model_admin.get_form(request, user)
            initial = form_type(instance=user)
            data = {}
            for name, field in initial.fields.items():
                if name == 'password':continue
                value = initial[name].value()
                if isinstance(field.widget, forms.MultiWidget):
                    for index, part in enumerate(field.widget.decompress(value)):
                        data[f'{name}_{index}'] = part
                else:data[name] = value
            data.update(changes)
            return form_type(data=data, instance=user)
        for changes in ({'role': 'training_admin'}, {'is_active': False}):
            form = bound_form(self.admin, changes)
            self.assertFalse(form.is_valid())
            self.assertIn('You cannot disable yourself', str(form.errors))
            self.admin.refresh_from_db()
        user = User.objects.create_user('django-demoted', role='admin', is_staff=True, is_superuser=True)
        form = bound_form(user, {'role': 'training_admin', 'is_staff': True, 'is_superuser': True})
        self.assertTrue(form.is_valid(), form.errors)
        model_admin.save_model(request, form.save(commit=False), form, True)
        user.refresh_from_db()
        self.assertFalse(user.is_staff); self.assertFalse(user.is_superuser)


class CentralRoleChecksTests(SimpleTestCase):
    def test_raw_role_checks_are_confined_to_policy_and_documented_exceptions(self):
        root = Path(__file__).resolve().parent
        failures = []
        # Permit only the exact comparisons deliberately preserved, not entire files.
        exceptions = {('auth_views.py', "user.role == 'learner'"), ('directory.py', "user.role == 'admin'")}
        def role_reference(node):
            return any((isinstance(part, ast.Attribute) and part.attr == 'role')
                       or (isinstance(part, ast.Name) and part.id == 'role')
                       or (isinstance(part, ast.Subscript) and isinstance(part.slice, ast.Constant) and part.slice.value == 'role')
                       for part in ast.walk(node))
        for path in root.rglob('*.py'):
            if path.name in ('access.py', 'models.py') or path.name.startswith('test') or 'migrations' in path.parts:
                continue
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Compare) and role_reference(node):
                    expression = ast.unparse(node)
                    if (path.name, expression) not in exceptions:
                        failures.append(f'{path.relative_to(root)}:{node.lineno}: {expression}')
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ('filter', 'exclude', 'get'):
                    for keyword in node.keywords:
                        if keyword.arg == 'role' and isinstance(keyword.value, ast.Constant) and keyword.value.value in EXPECTED:
                            failures.append(f'{path.relative_to(root)}:{node.lineno}: raw role equality query')
                if isinstance(node, ast.keyword) and node.arg and node.arg.startswith('role__'):
                    failures.append(f'{path.relative_to(root)}:{node.lineno}: raw role query')
        frontend = root.parent.parent / 'frontend' / 'src'
        pattern = re.compile(r'\b(?:\w+\.)?role\s*(?:[!=]==?|\bin\b)|(?:[!=]==?)\s*[\w.]*\brole\b|\[[^\n]*[\'"](?:admin|instructor|learner)[\'"][^\n]*\]\.includes\([^\n]*role')
        for path in (p for p in frontend.rglob('*') if p.suffix in ('.ts', '.tsx')):
            for number, line in enumerate(path.read_text().splitlines(), 1):
                if pattern.search(line):failures.append(f'{path.name}:{number}: raw frontend role comparison')
        self.assertEqual(failures, [], '\n'.join(failures))


@override_settings(DEBUG=True)
class PersonalOverviewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.actor = User.objects.create_user('overview-actor')
        self.other = User.objects.create_user('overview-other', role='instructor')
        self.client = APIClient()
        self.client.force_authenticate(self.actor)

    def assert_personal_scores(self, role):
        self.actor.role = role
        self.actor.save(update_fields=['role'])
        # Personal success belongs to someone else's exam; ownership must not hide it.
        exam = make_exam(self.other)
        personal = start_attempt(exam.pk, identity_for_user(self.actor))
        personal.answers = {str(q['id']): q['solution'][0] for q in personal.snapshot}
        finalize(personal)
        self.assertEqual(personal.status, 'graded')
        self.assertTrue(personal.passed)
        # Someone else's failure on an owned exam must not enter personal aggregates.
        owned_exam = make_exam(self.actor)
        finalize(start_attempt(owned_exam.pk, identity_for_user(self.other)))
        # Nor may another person's pending essay appear as personal pending work.
        essay_exam = make_exam(self.actor, essay=True)
        finalize(start_attempt(essay_exam.pk, identity_for_user(self.other)))

        response = self.client.get('/api/dashboard/')
        self.assertEqual(response.status_code, 200)
        data = response.data
        self.assertEqual(data['graded_count'], 1)
        self.assertEqual(data['pass_rate'], 100)
        self.assertEqual(data['average_score'], 100)
        self.assertEqual(data['pending'], 0)
        self.assertEqual(data['distribution'], [0, 0, 0, 0, 1])
        self.assertEqual(len(data['trend']), 1)
        self.assertEqual(data['trend'][0]['count'], 1)
        self.assertEqual(data['trend'][0]['average'], 100)

    def test_learner_overview_keeps_personal_scores(self):
        self.assert_personal_scores('learner')

    def test_course_creator_overview_excludes_other_people_even_on_owned_exams(self):
        self.assert_personal_scores('course_creator')

    def test_training_scheduler_overview_keeps_only_personal_scores(self):
        self.assert_personal_scores('training_scheduler')
