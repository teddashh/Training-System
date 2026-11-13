"""Offline, synthetic contracts for the organizer's complete on-site workflow."""
from .brand import BRAND, BRAND_PATH

import io
import json
from itertools import chain, repeat
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, timezone as dt_timezone
from unittest.mock import patch

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, connections
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from openpyxl import Workbook, load_workbook
from pypdf import PdfReader
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from .course_sessions import save_session
from .models import (Attempt, AttemptBudget, AuditEvent, Course, CourseAssessment, CourseSession, Enrollment,
                     Exam, LearningAssignment, OutboundEmail, ReminderBatch, TrainingGroup,
                     TrainingGroupMembership, TrainingRequest, User)
from .reminders import produce_reminders
from .roster_import import forget_answers, heading, import_roster
from .services import finalize, identity_for_user, start_attempt
from .tests import make_exam


class TrainingFixture:
    def setUp(self):
        cache.clear()
        forget_answers()
        self.owner = User.objects.create_user('roster-organizer', role='training_scheduler')
        self.other = User.objects.create_user('other-organizer', role='training_scheduler')
        self.user = self.person('alex', display_name='Alex Rivera', employee_id='E100', department='Practice')
        self.now = timezone.now()
        self.course = Course.objects.create(owner=self.owner, title='Synthetic safety training', published=True,
                                            delivery_mode='scheduled', venue='onsite')
        self.session = self.make_session()
        self.second = self.make_session(title='Afternoon', starts_at=self.now + timedelta(days=3),
                                        ends_at=self.now + timedelta(days=3, hours=1))
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.root = f'/api/courses/{self.course.pk}/'

    def person(self, name, **extra):
        return User.objects.create_user(name, email=f'{name}@example.com', **extra)

    def make_session(self, **extra):
        return CourseSession.objects.create(**{'course': self.course, 'title': 'Morning',
            'starts_at': self.now + timedelta(days=2), 'ends_at': self.now + timedelta(days=2, hours=1),
            'location': 'Building C, Room 12', **extra})

    def roster(self, **extra):
        return self.client.post(self.root + 'roster/', {'session': self.session.pk, 'people': [self.user.pk], **extra}, format='json')

    def seat(self, person=None, **extra):
        return Enrollment.objects.create(**{'course': self.course, 'session': self.session, 'user': person or self.user,
            'status': 'approved', 'requested_at': self.now - timedelta(days=1), **extra})

    def quiz(self, **extra):
        exam = make_exam(self.owner)
        for field, value in {'audience': 'course', **extra}.items():
            setattr(exam, field, value)
        exam.save()
        CourseAssessment.objects.create(course=self.course, exam=exam, release='after_session')
        return exam

    def training_payload(self, **extra):
        return {'request_id': str(uuid.uuid4()), 'title': 'Forklift refresher', 'sessions': [
            {'title': '', 'starts_at': self.session.starts_at.isoformat(), 'ends_at': self.session.ends_at.isoformat(),
             'location': 'Building C, Room 12'},
            {'title': '', 'starts_at': self.second.starts_at.isoformat(), 'ends_at': self.second.ends_at.isoformat(),
             'location': 'Building C, Room 12', 'capacity': 30}], **extra}

    def ended(self, hours=1):
        self.session.starts_at = self.now - timedelta(hours=hours + 1)
        self.session.ends_at = self.now - timedelta(hours=hours)
        self.session.save()


@override_settings(DEBUG=True)
class RoundSevenTests(TrainingFixture, TestCase):
    def attempt(self, exam, person=None, **extra):
        return Attempt.objects.create(**{'exam': exam, 'identity': identity_for_user(person or self.user),
            'number': 1, 'pass_score': 80, 'deadline': self.now, 'status': 'graded', 'score': 91, 'passed': True, **extra})

    def test_localized_template_round_trip_and_identifier_precedence(self):
        blair = self.person('blair', employee_id='E101')
        for language, labels in (
            ('en', ['Email', 'Employee ID', 'Name']),
            ('zh-hant', ['電子郵件', '員工編號', '姓名']),
            ('es', ['Correo electrónico', 'ID de empleado', 'Nombre']),
        ):
            with self.subTest(language=language):
                response = self.client.get('/api/trainings/people-template/', HTTP_ACCEPT_LANGUAGE=language)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response['Content-Disposition'],
                    'attachment; filename="people-template.xlsx"; filename*=UTF-8\'\'people-template.xlsx')
                self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
                self.assertIn('spreadsheetml', response['Content-Type'])
                book = load_workbook(io.BytesIO(response.content))
                self.assertEqual(len(book.worksheets), 1)
                sheet = book.active
                self.assertEqual(sheet.max_row, 1)
                self.assertEqual([cell.value for cell in sheet[1]], labels)
                self.assertEqual(heading([labels[0]]), (0, 'email'))
                self.assertEqual(heading([labels[1].upper()]), (0, 'employee_id'))
                self.assertIsNone(heading([labels[2]]))
                self.assertEqual(sheet.freeze_panes, 'A2')
                self.assertTrue(all(cell.font.bold for cell in sheet[1]))
                self.assertTrue(all(sheet.column_dimensions[c].width >= 24 for c in 'ABC'))
                sheet.append([self.user.email, '', 'Synthetic name'])
                sheet.append(['', blair.employee_id, 'Synthetic name'])
                sheet.append([self.user.email, blair.employee_id, 'Synthetic name'])
                # Name is never read as evidence; a row without Email or Employee ID comes back with what it
                # holds, so the organizer sees it in the box instead of losing it.
                sheet.append(['', '', blair.email])
                sheet.append(['invalid address', blair.employee_id, 'Synthetic name'])
                output = io.BytesIO(); book.save(output)
                checked = self.client.post('/api/trainings/check-people/',
                    {'file': SimpleUploadedFile('people-template.xlsx', output.getvalue())}, format='multipart')
                self.assertEqual(checked.status_code, 200, checked.data)
                rows = checked.data['rosters'][0]['rows']
                self.assertEqual([(r['input'], r['user'], r['outcome']) for r in rows], [
                    (self.user.email, self.user.pk, 'added'), (blair.employee_id, blair.pk, 'added'),
                    (self.user.email, self.user.pk, 'duplicate'), (blair.email, None, 'not_found'),
                    ('invalid address', None, 'not_found')])
                self.assertFalse(Enrollment.objects.exists())

    def test_template_uses_check_people_permission(self):
        for user, expected in ((self.owner, 200), (self.other, 200), (self.user, 403), (None, 403)):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get('/api/trainings/people-template/').status_code, expected)

    def test_roster_passes_require_every_published_quiz_and_only_graded_attempts(self):
        self.seat()
        other = self.person('blair'); self.seat(other)
        ungraded = self.person('sam'); self.seat(ungraded)
        first, second = self.quiz(), self.quiz()
        self.quiz(published=False)
        self.attempt(first)
        self.attempt(first, number=2, passed=False, score=30)
        self.attempt(second)
        self.attempt(first, other, passed=False, score=30)
        self.attempt(second, other, status='pending_review', passed=None, score=None)
        self.attempt(first, ungraded, status='in_progress')
        response = self.client.get(self.root + 'enrollments/', {'status': 'all'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual({row['user_id']: row['quiz'] for row in response.data['results']},
                         {self.user.pk: 'passed', other.pk: 'not_passed', ungraded.pk: 'not_started'})
        self.assertEqual(response.data['counts']['passed'], 1)
        # Passing one of two quizzes still means not passed overall.
        self.attempt(first, other, number=2)
        rows = self.client.get(self.root + 'enrollments/', {'status': 'all'}).data['results']
        self.assertEqual(next(row for row in rows if row['user_id'] == other.pk)['quiz'], 'not_passed')
        serialized = json.dumps(response.data, default=str)
        for private in ('score', 'answers', 'attempt', 'identity'):
            self.assertNotIn(private, serialized)

    def test_roster_one_attempt_query_and_whole_course_counts_before_filters(self):
        from django.test.utils import CaptureQueriesContext
        from .enrollments import roster
        exam = self.quiz()
        for index in range(25):
            person = self.person(f'page-person-{index}')
            self.seat(person, session=self.second if index == 24 else self.session)
            self.attempt(exam, person)
        for params, size in (({'page': 1}, 20), ({'page': 2}, 5),
                             ({'search': 'page-person-24', 'session': self.second.pk}, 1)):
            with CaptureQueriesContext(connection) as queries:
                data = roster(self.owner, self.course, {'status': 'all', **params})
            self.assertEqual(len(data['results']), size)
            self.assertEqual(data['counts']['passed'], 25)
            evidence = [q['sql'] for q in queries if 'FROM "training_attempt"' in q['sql']]
            self.assertEqual(len(evidence), 1)
            self.assertIn('GROUP BY', evidence[0])

    def test_no_published_link_means_no_quiz_or_pass_count(self):
        self.seat()
        # Unlinked published exams do not contribute even when the participant passed.
        self.attempt(make_exam(self.owner))
        for _ in range(2):
            response = self.client.get(self.root + 'enrollments/', {'status': 'all'})
            self.assertIsNone(response.data['results'][0]['quiz'])
            self.assertNotIn('passed', response.data['counts'])
            self.attempt(self.quiz(published=False))

    def test_overview_counts_only_approved_people_of_this_course_for_every_manager(self):
        self.seat()
        exam = self.quiz()
        self.attempt(exam); self.attempt(exam, number=2)
        in_progress = self.person('in-progress'); self.seat(in_progress)
        self.attempt(exam, in_progress, status='pending_review', passed=None, score=None)
        self.seat(self.person('without-session'), session=None)
        for status in ('pending', 'cancelled', 'removed', 'rejected'):
            person = self.person('status-' + status); self.seat(person, status=status); self.attempt(exam, person)
        elsewhere = Course.objects.create(owner=self.other, title='Other course', published=True)
        exam.courses.add(elsewhere)
        outsider = self.person('outsider')
        Enrollment.objects.create(course=elsewhere, user=outsider, status='approved')
        self.attempt(exam, outsider)
        roster = self.client.get(self.root + 'enrollments/', {'status': 'approved'}).data
        self.assertEqual(roster['count'], 3)
        # Counts cover all course enrollments, including four unapproved people, but not the outsider.
        self.assertEqual(roster['counts']['passed'], 5)
        for role in ('training_scheduler', 'training_admin'):
            self.owner.role = role; self.owner.save()
            response = self.client.get(self.root + 'training/')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['people'], 3)
            self.assertEqual(response.data['quizzes'][0]['participation'], {'started': 2, 'passed': 1})
            for private in ('score', 'answers', 'attempt', 'identity', 'outsider'):
                self.assertNotIn(private, json.dumps(response.data, default=str))

    def test_scheduler_export_has_pass_status_only_and_ownership_is_required(self):
        from .access import scope
        self.assertEqual(scope(self.owner, 'results'), 'none')
        self.ended(); self.seat()
        failed = self.person('failed'); self.seat(failed)
        waiting = self.person('waiting'); self.seat(waiting)
        exam = self.quiz(title='Published quiz')
        draft = self.quiz(title='Private draft', published=False)
        self.attempt(exam); self.attempt(exam, number=2, passed=False)
        self.attempt(exam, failed, passed=False, score=30)
        self.attempt(exam, waiting, status='pending_review', passed=None, score=None)
        self.attempt(draft)
        export = self.root + f'sessions/{self.session.pk}/export/?kind=attendance'
        response = self.client.get(export)
        self.assertEqual(response.status_code, 200)
        sheet = load_workbook(io.BytesIO(response.content)).active
        rows = list(sheet.values)
        header_index = next(i for i, row in enumerate(rows) if row[0] == 'Name')
        self.assertEqual(sheet.max_column, 11)
        self.assertEqual(rows[header_index][-1], 'Published quiz — Passed')
        self.assertEqual({row[0]: row[-1] for row in rows[header_index + 1:]},
                         {'Alex Rivera': 'Passed', 'failed': 'Not passed', 'waiting': 'Not started'})
        for private in ('score', 'Private draft', 'answers'):
            self.assertNotIn(private, str(rows))
        self.assertFalse(any(isinstance(value, (int, float)) for row in rows for value in row))
        self.client.force_authenticate(self.other)
        for path in (self.root + 'enrollments/', self.root + 'training/', export):
            self.assertEqual(self.client.get(path).status_code, 403)


@override_settings(DEBUG=True, EMAIL_NOTIFICATIONS_ENABLED=True)
class SimpleTrainingTests(TrainingFixture, TestCase):
    def test_roster_outcome_table_and_replay(self):
        expected = ['added', 'added', 'added', 'added', 'already', 'approved', 'moved', 'moved', 'inactive']
        people = [self.user] + [self.person(f'person{i}') for i in range(8)]
        for person, state, session in zip(people[1:8], ['cancelled', 'rejected', 'removed', 'approved', 'pending', 'approved', 'pending'],
                                         [self.session] * 5 + [self.second] * 2):
            self.seat(person, status=state, session=session)
        people[-1].is_active = False
        people[-1].save()
        self.course.requires_approval = True
        self.course.save()
        response = self.roster(people=[p.pk for p in people] + [self.user.pk], text='Missing Person')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([r['outcome'] for r in response.data['rows']], ['not_found'] + expected + ['duplicate'])
        self.assertEqual(set(response.data['rows'][1]), {'input', 'outcome', 'user', 'name', 'email', 'department'})
        self.assertEqual(Enrollment.objects.filter(course=self.course, status='approved', session=self.session).count(), 8)
        self.assertEqual(Enrollment.objects.filter(reviewed_by=self.owner).count(), 7)
        mails = OutboundEmail.objects.count()
        replay = self.roster(people=[p.pk for p in people])
        self.assertEqual(replay.data['counts'], {'already': 8, 'inactive': 1})
        self.assertEqual(OutboundEmail.objects.count(), mails)
        self.assertEqual(OutboundEmail.objects.filter(kind='registered').count(), 4)
        moved = OutboundEmail.objects.filter(kind='session_changed').first()
        # Two open sessions: the name is shown, and the old and new times are one line each.
        self.assertIn('\n\nSession: Morning\n\n', moved.body_text)
        self.assertIn('\n\nWas: ', moved.body_text); self.assertIn('\n\nNow: ', moved.body_text)
        self.assertTrue(moved.subject.startswith('Changed: Synthetic safety training, now '))

    def test_resolution_order_headers_ambiguity_and_groups(self):
        other = self.person('blair', employee_id='E101')
        group = TrainingGroup.objects.create(name='Synthetic team', created_by=self.owner)
        inactive = self.person('inactive', is_active=False)
        for person in (other, inactive):
            TrainingGroupMembership.objects.create(group=group, user=person, added_by=self.owner)
        # Comma heading in pasted text is not a table heading; the address is the only evidence of its line.
        response = self.roster(text='Name,Email\nAlex <ALEX@EXAMPLE.COM>, E101\nBlair\tE101\nE100\tE101',
                               people=[self.user.pk], groups=[group.pk])
        self.assertEqual([r['outcome'] for r in response.data['rows']],
                         ['not_found', 'added', 'added', 'ambiguous', 'duplicate', 'duplicate'])
        self.assertEqual(response.data['rows'][1]['user'], self.user.pk)
        self.assertFalse(Enrollment.objects.filter(user=inactive).exists())

    def test_address_is_the_only_evidence_then_whole_cells(self):
        other = self.person('blair', employee_id='E101')
        response = self.roster(people=[], text='unknown@example.com\tE100\nE100\nblair\nAlex Rivera E100')
        self.assertEqual([row['user'] for row in response.data['rows']], [None, self.user.pk, other.pk, None])
        self.assertEqual(response.data['counts'], {'added': 2, 'not_found': 2})

    def test_full_does_not_move_or_approve_over_capacity(self):
        self.session.capacity = 1
        self.session.save()
        occupant = self.person('occupant')
        self.seat(occupant, status='pending')
        old = self.seat(session=self.second)
        result = self.roster()
        self.assertEqual(result.data['counts'], {'full': 1})
        old.refresh_from_db()
        self.assertEqual(old.session_id, self.second.pk)
        self.assertEqual(self.roster(people=[occupant.pk]).data['counts'], {'approved': 1})

    def test_dry_run_simulates_seats_and_changes_nothing(self):
        self.session.capacity = 1
        self.session.save()
        other = self.person('blair')
        before = (Enrollment.objects.count(), AuditEvent.objects.count(), User.objects.count(), OutboundEmail.objects.count())
        data = dict(people=[self.user.pk, other.pk, self.user.pk])
        preview = self.roster(dry_run=True, **data)
        self.assertEqual(preview.data['counts'], {'added': 1, 'full': 1, 'duplicate': 1})
        self.assertEqual(before, (Enrollment.objects.count(), AuditEvent.objects.count(), User.objects.count(), OutboundEmail.objects.count()))
        self.assertEqual(preview.data['notified'], 0)
        real = self.roster(**data).data
        self.assertEqual(real['notified'], 1)
        self.assertEqual({**real, 'notified': 0}, preview.data)

    def test_limit_rejected_before_any_writes(self):
        User.objects.bulk_create([User(username=f'bulk{i}', email=f'bulk{i}@example.com') for i in range(501)])
        ids = list(User.objects.filter(username__startswith='bulk').values_list('pk', flat=True))
        self.assertEqual(self.roster(people=ids).status_code, 400)
        self.assertFalse(Enrollment.objects.exists())
        self.assertFalse(OutboundEmail.objects.exists())

    def test_files_use_same_resolution_and_reject_invalid_or_large(self):
        csv = SimpleUploadedFile('roster.csv', b'Name,Email\nAlex,alex@example.com\n')
        response = self.client.post(self.root + 'roster/', {'session': self.session.pk, 'file': csv}, format='multipart')
        self.assertEqual(response.status_code, 200, response.data)
        # The heading row names the e-mail column: it is dropped and only that column is read.
        self.assertEqual(response.data['counts'], {'added': 1})
        book = Workbook(); book.active.append(['Name', 'Email']); book.active.append(['Alex', self.user.email])
        output = io.BytesIO(); book.save(output)
        response = self.client.post(self.root + 'roster/', {'session': self.session.pk,
            'file': SimpleUploadedFile('roster.xlsx', output.getvalue())}, format='multipart')
        self.assertEqual(response.data['counts'], {'already': 1})
        for name, content in [('roster.pdf', b'wrong'), ('roster.xlsx', b'wrong'), ('roster.csv', b'x' * (1024 * 1024 + 1))]:
            response = self.client.post(self.root + 'roster/', {'session': self.session.pk,
                'file': SimpleUploadedFile(name, content)}, format='multipart')
            self.assertEqual(response.status_code, 400)

    def test_manager_scope_and_no_extra_rights(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.roster().status_code, 403)
        self.assertEqual(self.client.get(self.root + 'training/').status_code, 403)
        self.assertEqual(self.client.patch(self.root + 'assessments/', {'exam': self.quiz().pk, 'release': 'immediate'}, format='json').status_code, 403)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.post('/api/trainings/', self.training_payload(), format='json').status_code, 403)
        self.client.force_authenticate(self.owner)
        for endpoint in ('/api/administration/', '/api/invitations/'):
            self.assertEqual(self.client.get(endpoint).status_code, 403)
        self.assertEqual(self.client.post('/api/assignments/', {}, format='json').status_code, 403)

    def test_roster_requires_scheduled_course_and_own_session(self):
        self.course.delivery_mode = 'self_paced'; self.course.save()
        self.assertEqual(self.roster().status_code, 400)
        self.course.delivery_mode = 'scheduled'; self.course.save()
        other_course = Course.objects.create(owner=self.owner, title='Other', published=True, delivery_mode='scheduled')
        self.second.course = other_course; self.second.save()
        self.assertEqual(self.roster(session=self.second.pk).status_code, 404)
        self.session.cancelled = True; self.session.save()
        self.assertEqual(self.roster().status_code, 400)

    def test_notify_false_and_transaction_rolls_back_on_queue_failure(self):
        with patch('training.notifications.enqueue', side_effect=RuntimeError('synthetic')):
            with self.assertRaises(RuntimeError): self.roster()
        self.assertFalse(Enrollment.objects.exists())
        self.assertFalse(AuditEvent.objects.exists())
        self.assertEqual(self.roster(notify=False).status_code, 200)
        self.assertFalse(OutboundEmail.objects.exists())

    def test_roster_listing_counts_and_attendance_without_results(self):
        row = self.seat(attendance='present')
        other = self.person('blair'); self.seat(other, status='pending', session=self.second)
        data = self.client.get(self.root + 'enrollments/', {'status': 'all'}).data
        self.assertEqual(data['counts'], {'all': 2, 'registered': 1, 'pending': 1, 'attended': 1, 'absent': 0, 'cancelled': 0})
        self.assertEqual(data['results'][0]['session']['id'], row.session_id)
        self.assertEqual(data['results'][0]['effective_attendance'], 'present')
        self.assertNotIn('score', json.dumps(data, default=str))

    def test_switch_keeps_one_seat_status_and_replay(self):
        for state in ('approved', 'pending'):
            Enrollment.objects.all().delete(); OutboundEmail.objects.all().delete()
            row = self.seat(status=state, revision=3)
            self.client.force_authenticate(self.user)
            response = self.client.post(self.root + 'enroll/', {'session': self.second.pk, 'revision': 3}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual((response.data['status'], response.data['revision']), (state, 4))
            self.assertEqual(self.session.enrollments.count(), 0)
            self.assertEqual(self.second.enrollments.count(), 1)
            replay = self.client.post(self.root + 'enroll/', {'session': self.second.pk, 'revision': 3}, format='json')
            self.assertEqual(replay.data['revision'], 4)
            self.assertEqual(OutboundEmail.objects.filter(kind='session_changed').count(), 1)

    def test_switch_refusals_leave_current_seat(self):
        row = self.seat(revision=1)
        self.client.force_authenticate(self.user)
        def switch():
            response = self.client.post(self.root + 'enroll/', {'session': self.second.pk, 'revision': 1}, format='json')
            self.assertEqual(response.status_code, 400)
            row.refresh_from_db(); self.assertEqual(row.session_id, self.session.pk)
        self.second.capacity = 1; self.second.save()
        occupied = self.seat(self.person('occupant'), session=self.second)
        switch(); occupied.delete()
        self.second.registration_opens_at = self.now + timedelta(hours=1); self.second.save(); switch()
        self.second.registration_opens_at = None; self.second.cancelled = True; self.second.save(); switch()
        self.second.cancelled = False; self.second.save()
        with patch('django.utils.timezone.now', return_value=self.session.starts_at): switch()

    def test_public_lookup_adds_only_signed_in_own_enrollment(self):
        self.session.capacity = 1; self.session.save(); self.seat()
        self.course.registration_key = 's' * 43; self.course.save()
        self.client.force_authenticate(None)
        anon = self.client.post('/api/registration/lookup/', {'key': self.course.registration_key}, format='json').data
        self.assertNotIn('enrollment', anon)
        self.assertNotIn(self.session.pk, [r['id'] for r in anon['sessions']])
        self.client.force_authenticate(self.user)
        own = self.client.post('/api/registration/lookup/', {'key': self.course.registration_key}, format='json').data
        self.assertEqual(own['enrollment'], {'status': 'approved', 'session': self.session.pk})
        self.assertIn(self.session.pk, [r['id'] for r in own['sessions']])
        self.assertNotIn('email', json.dumps(own, default=str))

    def test_gated_admission_and_effective_start_everywhere(self):
        self.seat(); exam = self.quiz()
        self.client.force_authenticate(self.user)
        for data in (self.client.get(f'/api/exams/{exam.pk}/').data,
                     self.client.get('/api/exams/').data[0],
                     self.client.get(self.root).data['assessments'][0],
                     self.client.get(f'/api/exams/{exam.pk}/budget/').data):
            self.assertEqual(timezone.datetime.fromisoformat(str(data['starts_at']).replace('Z', '+00:00')), self.session.ends_at)
        with self.assertRaises(PermissionDenied): start_attempt(exam.pk, identity_for_user(self.user))
        with patch('django.utils.timezone.now', return_value=self.session.ends_at):
            attempt = start_attempt(exam.pk, identity_for_user(self.user))
        self.session.cancelled = True; self.session.save()
        # Existing attempts retain their resume rule even when a course grant is revoked.
        with patch('django.utils.timezone.now', return_value=self.session.ends_at + timedelta(seconds=1)):
            self.assertEqual(start_attempt(exam.pk, identity_for_user(self.user)).pk, attempt.pk)
        Attempt.objects.filter(pk=attempt.pk).update(status='graded', passed=False)
        with self.assertRaises(PermissionDenied): start_attempt(exam.pk, identity_for_user(self.user))

    def test_manager_participation_exposes_gate_without_overwriting_editable_window(self):
        self.seat(self.owner); exam = self.quiz()
        data = self.client.get(f'/api/exams/{exam.pk}/').data
        self.assertIsNone(data['starts_at'])
        self.assertEqual(timezone.datetime.fromisoformat(data['next_attempt_at']), self.session.ends_at)
        summary = self.client.get(self.root).data['assessments'][0]
        self.assertEqual(timezone.datetime.fromisoformat(summary['next_attempt_at']), self.session.ends_at)
        preflight = self.client.get(f'/api/exams/{exam.pk}/budget/').data
        self.assertEqual(preflight['starts_at'], self.session.ends_at)
        with self.assertRaises(PermissionDenied): start_attempt(exam.pk, identity_for_user(self.owner))

    def test_later_exam_window_and_independent_grants(self):
        self.seat(); exam = self.quiz(starts_at=self.session.ends_at + timedelta(hours=2))
        from .services import exam_opens_for, in_exam_audience
        self.assertEqual(exam_opens_for(exam, self.user), exam.starts_at)
        exam.starts_at = None; exam.save()
        for audience in ('all', 'employees'):
            exam.audience = audience; exam.save()
            self.assertTrue(in_exam_audience(exam, self.user))
            self.assertIsNone(exam_opens_for(exam, self.user))
        exam.audience = 'course'; exam.save()
        assignment = LearningAssignment.objects.create(user=self.user, exam=exam, created_by=self.owner)
        self.assertTrue(in_exam_audience(exam, self.user)); self.assertIsNone(exam_opens_for(exam, self.user))
        assignment.delete()
        other = Course.objects.create(owner=self.owner, title='Independent course', published=True)
        Enrollment.objects.create(course=other, user=self.user)
        CourseAssessment.objects.create(course=other, exam=exam)
        self.assertTrue(in_exam_audience(exam, self.user)); self.assertIsNone(exam_opens_for(exam, self.user))

    def test_cancelled_missing_and_pending_session_do_not_grant_quiz(self):
        row = self.seat(); exam = self.quiz(); self.ended()
        from .services import in_exam_audience
        self.assertTrue(in_exam_audience(exam, self.user))
        self.session.cancelled = True; self.session.save()
        self.assertFalse(in_exam_audience(exam, self.user))
        row.session = None; row.save()
        self.assertFalse(in_exam_audience(exam, self.user))
        row.session = self.second; row.status = 'pending'; row.save()
        self.assertFalse(in_exam_audience(exam, self.user))

    def test_publish_attach_patch_and_fail_atomic(self):
        exam = make_exam(self.owner); exam.published = False; exam.save()
        data = {'exam': exam.pk, 'release': 'after_session', 'publish': True}
        response = self.client.post(self.root + 'assessments/', data, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        exam.refresh_from_db(); self.assertTrue(exam.published); self.assertEqual(exam.audience, 'course')
        self.assertEqual(CourseAssessment.objects.get(exam=exam).release, 'after_session')
        count = AuditEvent.objects.count()
        self.client.post(self.root + 'assessments/', data, format='json')
        self.assertEqual(AuditEvent.objects.count(), count)
        response = self.client.patch(self.root + 'assessments/', {'exam': exam.pk, 'release': 'immediate'}, format='json')
        self.assertEqual(response.status_code, 200)
        for owner, with_questions, audience in [(self.other, True, 'all'), (self.owner, False, 'all'), (self.owner, True, 'invitation')]:
            draft = make_exam(owner); draft.published = False; draft.audience = audience; draft.save()
            if not with_questions: draft.questions.all().delete()
            response = self.client.post(self.root + 'assessments/', {'exam': draft.pk, 'publish': True}, format='json')
            self.assertEqual(response.status_code, 400)
            self.assertFalse(CourseAssessment.objects.filter(exam=draft).exists())
            draft.refresh_from_db(); self.assertFalse(draft.published)

    def test_course_manager_can_patch_release_of_any_existing_link(self):
        exam = make_exam(self.other); exam.audience = 'invitation'; exam.save()
        CourseAssessment.objects.create(course=self.course, exam=exam)
        response = self.client.patch(self.root + 'assessments/', {'exam': exam.pk, 'release': 'after_session'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(CourseAssessment.objects.get(exam=exam).release, 'after_session')
        self.seat(); self.ended()
        from .services import in_exam_audience
        self.assertFalse(in_exam_audience(exam, self.user))

    def test_quiz_chooser_is_one_step_safe(self):
        published = make_exam(self.other)
        own = make_exam(self.owner); own.published = False; own.save()
        empty = Exam.objects.create(owner=self.owner, title='Empty draft')
        foreign = make_exam(self.other); foreign.published = False; foreign.save()
        invitation = make_exam(self.owner); invitation.audience = 'invitation'; invitation.save()
        data = self.client.get('/api/exams/link-options/', {'quizzes': '1'}).data
        self.assertEqual({item['id'] for item in data}, {published.pk, own.pk})
        self.assertNotIn('questions', data[0])
        # The caller's own quiz leads the list, whatever the titles are.
        published.title, own.title = 'A company quiz', 'Z my quiz'; published.save(); own.save()
        data = self.client.get('/api/exams/link-options/', {'quizzes': '1'}).data
        self.assertEqual([item['id'] for item in data], [own.pk, published.pk])

    def test_create_defaults_receipt_overview_and_no_results(self):
        exam = make_exam(self.owner); exam.published = False; exam.save()
        payload = self.training_payload(exam=exam.pk, rosters=[{'session': 1, 'people': [self.user.pk]}])
        response = self.client.post('/api/trainings/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        course = Course.objects.get(pk=response.data['course'])
        self.assertEqual((course.venue, course.delivery_mode, course.reminders, course.published, course.requires_approval, course.duration_minutes),
                         ('onsite', 'scheduled', True, True, False, 60))
        sessions = list(course.sessions.all())
        self.assertEqual([s.title for s in sessions], ['Session 1', 'Session 2'])
        self.assertEqual([s.capacity for s in sessions], [100, 30])
        self.assertEqual(response.data['registration_url'], '/register#' + course.registration_key)
        self.assertEqual([report['session'] for report in response.data['rosters']], [sessions[1].pk])
        self.assertNotIn('roster', response.data)
        self.assertTrue(course.cover.startswith('scene-'))
        counts = (Course.objects.count(), OutboundEmail.objects.count(), AuditEvent.objects.count())
        replay = self.client.post('/api/trainings/', payload, format='json')
        self.assertEqual(replay.status_code, 200); self.assertEqual(response.data, replay.data)
        self.assertEqual(counts, (Course.objects.count(), OutboundEmail.objects.count(), AuditEvent.objects.count()))
        overview = self.client.get(f'/api/courses/{course.pk}/training/').data
        self.assertEqual(overview['sessions'][1]['counts']['registered'], 1)
        self.assertEqual(len(overview['sessions'][0]['emails']), 3)
        self.assertEqual(overview['quizzes'][0]['participation'], {'started': 0, 'passed': 0})
        self.assertEqual(self.client.patch(f'/api/courses/{course.pk}/', {'reminders': False}, format='json').status_code, 200)
        course.refresh_from_db(); self.assertFalse(course.reminders)

    def test_create_validation_names_fields_and_rolls_back(self):
        payload = self.training_payload(); payload['sessions'][1]['ends_at'] = payload['sessions'][1]['starts_at']
        response = self.client.post('/api/trainings/', payload, format='json')
        self.assertIn('sessions[1].ends_at', response.data)
        payload['sessions'][1]['ends_at'] = 'invalid'
        self.assertIn('sessions[1].ends_at', self.client.post('/api/trainings/', payload, format='json').data)
        draft = Exam.objects.create(owner=self.owner, title='No questions')
        before = Course.objects.count()
        payload = self.training_payload(exam=draft.pk, rosters=[{'people': [self.user.pk]}])
        self.assertEqual(self.client.post('/api/trainings/', payload, format='json').status_code, 400)
        self.assertEqual(Course.objects.count(), before)
        self.assertFalse(TrainingRequest.objects.exists()); self.assertFalse(OutboundEmail.objects.exists())

    def test_reminders_default_off_and_tomorrow_once_old_registration_only(self):
        self.session.starts_at = self.now + timedelta(hours=23); self.session.ends_at = self.now + timedelta(hours=24); self.session.save()
        self.seat(); recent = self.person('recent'); self.seat(recent, requested_at=self.now)
        self.seat(self.person('pending'), status='pending')
        produce_reminders(); self.assertFalse(OutboundEmail.objects.exists())
        self.course.reminders = True; self.course.save()
        produce_reminders(); produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(kind='session_tomorrow').count(), 1)
        self.assertEqual(ReminderBatch.objects.count(), 1)
        message = OutboundEmail.objects.get(); self.assertEqual(message.expires_at, self.session.starts_at)
        self.assertEqual(message.recipient_user_id, self.user.pk)
        self.assertEqual(message.body_html.count('>View my session</a>'), 1)
        with self.assertNumQueries(4): produce_reminders()

    def test_reminders_cancelled_rescheduled_and_no_old_flood(self):
        self.course.reminders = True; self.course.save(); self.seat()
        self.session.starts_at = self.now + timedelta(hours=23); self.session.ends_at = self.now + timedelta(hours=24); self.session.save()
        produce_reminders()
        save_session(self.owner, self.course.pk, {'revision': 0, 'starts_at': (self.now + timedelta(hours=22)).isoformat(),
                     'ends_at': (self.now + timedelta(hours=23)).isoformat()}, self.session.pk)
        produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(kind='session_tomorrow').count(), 2)
        self.session.refresh_from_db(); self.session.cancelled = True; self.session.save()
        produce_reminders(); self.assertEqual(ReminderBatch.objects.count(), 2)
        from .reminders import valid_queued_reminder
        self.assertTrue(all(not valid_queued_reminder(mail) for mail in OutboundEmail.objects.filter(kind='session_tomorrow')))
        self.session.cancelled = False; self.session.save(); self.ended(hours=24 * 8); self.quiz()
        produce_reminders(); self.assertFalse(OutboundEmail.objects.filter(kind__startswith='quiz_').exists())
        overview = self.client.get(self.root + 'training/').data
        current = next(item for item in overview['sessions'] if item['id'] == self.session.pk)
        self.assertTrue(all(event['state'] == 'disabled' for event in current['emails'] if not event['produced_at']))

    def test_quiz_ready_late_roster_and_reminder_eligibility(self):
        self.course.reminders = True; self.course.save(); self.ended(); exam = self.quiz()
        response = self.roster()
        self.assertEqual(response.data['counts'], {'added': 1})
        self.assertEqual(list(OutboundEmail.objects.values_list('kind', flat=True)), ['quiz_ready'])
        mail = OutboundEmail.objects.get(); self.assertIn(f'/exams?exam={exam.pk}&action=start', mail.body_text)
        self.assertGreater(mail.expires_at, self.now)
        produce_reminders(); produce_reminders()
        self.assertEqual(OutboundEmail.objects.count(), 1)
        # The reminder counts from the produced ready batch, not from the session end.
        with patch('django.utils.timezone.now', return_value=self.session.ends_at + timedelta(hours=72)):
            produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(kind='quiz_reminder').count(), 0)
        with patch('django.utils.timezone.now', return_value=self.now + timedelta(hours=73)):
            produce_reminders(); produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(kind='quiz_reminder').count(), 1)

    def test_reminders_exclude_started_passed_exhausted_and_closed(self):
        self.course.reminders = True; self.course.save(); self.ended(hours=74); self.seat()
        exam = self.quiz(max_attempts=1)
        attempt = start_attempt(exam.pk, identity_for_user(self.user)); finalize(attempt)
        produce_reminders()
        self.assertFalse(OutboundEmail.objects.exists())
        # A new after-session quiz with a later opening waits for that opening.
        later = self.quiz(starts_at=self.now + timedelta(hours=2))
        produce_reminders(); self.assertFalse(OutboundEmail.objects.exists())
        # Opening more than 72 hours after the session: ready now, the reminder 72 hours later, never both at once.
        with patch('django.utils.timezone.now', return_value=later.starts_at): produce_reminders(); produce_reminders()
        self.assertEqual(list(OutboundEmail.objects.filter(context__exam_id=later.pk).values_list('kind', flat=True)), ['quiz_ready'])
        with patch('django.utils.timezone.now', return_value=later.starts_at + timedelta(hours=71)): produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(context__exam_id=later.pk).count(), 1)
        with patch('django.utils.timezone.now', return_value=later.starts_at + timedelta(hours=72, minutes=1)): produce_reminders()
        self.assertEqual(list(OutboundEmail.objects.filter(context__exam_id=later.pk).order_by('pk').values_list('kind', flat=True)),
                         ['quiz_ready', 'quiz_reminder'])

    def test_multiple_quizzes_do_not_cross_filter_or_repeat_batches(self):
        self.course.reminders = True; self.course.save(); self.ended(); self.seat()
        first = self.quiz(); second = self.quiz(); invitation = self.quiz(audience='invitation')
        draft = self.quiz(published=False)
        produce_reminders(); produce_reminders()
        self.assertEqual(set(OutboundEmail.objects.values_list('context__exam_id', flat=True)), {first.pk, second.pk})
        with self.assertNumQueries(4): produce_reminders()

    def test_idle_queries_are_constant_even_with_many_future_sessions(self):
        with self.assertNumQueries(4): produce_reminders()
        for index in range(30): self.make_session(title=f'Future {index}')
        self.course.reminders = True; self.course.save()
        with self.assertNumQueries(4): produce_reminders()
        from .management.commands.run_scheduler import scheduler_tick
        with patch('training.management.commands.run_scheduler.call_command'), patch('training.management.commands.run_scheduler.deliver_queued'), \
             patch('training.management.commands.run_scheduler.scheduled_sync'), self.assertNumQueries(4): scheduler_tick()

    def test_session_seen_while_recent_can_send_quiz_when_it_opens_later(self):
        self.course.reminders = True; self.course.save(); self.ended(); self.seat()
        exam = self.quiz(starts_at=self.now + timedelta(days=10))
        produce_reminders()
        self.session.refresh_from_db(); self.assertIsNotNone(self.session.reminders_seen_at)
        self.assertFalse(OutboundEmail.objects.exists())
        with patch('django.utils.timezone.now', return_value=exam.starts_at):
            produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(kind='quiz_ready').count(), 1)

    def test_end_only_reschedule_produces_new_tomorrow_and_switch_off_revokes_queued(self):
        self.course.reminders = True; self.course.save(); self.seat()
        self.session.starts_at = self.now + timedelta(hours=23)
        self.session.ends_at = self.now + timedelta(hours=24); self.session.save()
        produce_reminders()
        save_session(self.owner, self.course.pk, {'revision': 0,
            'ends_at': (self.now + timedelta(hours=25)).isoformat()}, self.session.pk)
        produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(kind='session_tomorrow').count(), 2)
        from .reminders import valid_queued_reminder
        old, new = list(OutboundEmail.objects.filter(kind='session_tomorrow').order_by('pk'))
        self.assertFalse(valid_queued_reminder(old)); self.assertTrue(valid_queued_reminder(new))
        self.course.reminders = False; self.course.save()
        self.assertFalse(valid_queued_reminder(new))

    def test_passed_and_inactive_people_do_not_get_quiz_reminders(self):
        self.course.reminders = True; self.course.save(); self.ended(hours=74); self.seat()
        exam = self.quiz()
        attempt = start_attempt(exam.pk, identity_for_user(self.user)); finalize(attempt)
        Attempt.objects.filter(pk=attempt.pk).update(passed=True)
        self.seat(self.person('disabled', is_active=False))
        self.seat(self.person('pending'), status='pending')
        produce_reminders()
        self.assertFalse(OutboundEmail.objects.exists())

    def test_pending_review_with_attempts_left_remains_eligible_for_reminder(self):
        self.course.reminders = True; self.course.save(); self.ended(hours=74); self.seat()
        exam = self.quiz()
        attempt = start_attempt(exam.pk, identity_for_user(self.user))
        Attempt.objects.filter(pk=attempt.pk).update(status='pending_review')
        produce_reminders()
        self.assertFalse(OutboundEmail.objects.exists())
        with patch('django.utils.timezone.now', return_value=self.now + timedelta(hours=73)): produce_reminders()
        self.assertEqual(list(OutboundEmail.objects.values_list('kind', flat=True)), ['quiz_reminder'])

    def test_pdf_multilingual_escaped_names_pagination_and_blank_rows(self):
        self.user.display_name = 'Alex <b>Rivera</b>'; self.user.save(); self.seat()
        self.seat(self.person('ines', display_name='Inés Muñoz'))
        self.seat(self.person('lin', display_name='林小明'))
        for index in range(24): self.seat(self.person(f'print{index}', display_name=f'Print {index:02}'))
        response = self.client.get(self.root + f'sessions/{self.session.pk}/export/', {'kind': 'sign-in-pdf', 'timezone': 'America/New_York'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        reader = PdfReader(io.BytesIO(response.content)); self.assertGreater(len(reader.pages), 1)
        text = '\n'.join(page.extract_text() for page in reader.pages)
        for expected in ('Alex <b>Rivera</b>', 'Inés Muñoz', '林小明', 'Building C, Room 12', 'E100'):
            self.assertIn(expected, text)
        for index, page in enumerate(reader.pages, 1):
            self.assertIn(f'Page {index} of {len(reader.pages)}', page.extract_text())
            self.assertIn('Signature', page.extract_text())
            self.assertEqual(float(page.mediabox.width), 612)
        self.assertIn('32', text)  # 27 people and five numbered walk-in rows.
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.root + f'sessions/{self.session.pk}/export/?kind=sign-in-pdf').status_code, 403)


@override_settings(DEBUG=True, EMAIL_CODE_DOMAINS=['example.com'],
    ENTRA_TENANT_ID='11111111-1111-1111-1111-111111111111',
    GRAPH_DIRECTORY_TENANT_ID='11111111-1111-1111-1111-111111111111',
    GRAPH_DIRECTORY_CLIENT_ID='22222222-2222-2222-2222-222222222222', GRAPH_DIRECTORY_CLIENT_SECRET='synthetic')
class RosterDirectoryTests(TrainingFixture, TestCase):
    def record(self):
        return {'id': '33333333-3333-3333-3333-333333333333', 'displayName': 'Casey Chen',
                'mail': 'casey@example.com', 'userPrincipalName': 'casey@example.com',
                'userType': 'Member', 'accountEnabled': True, 'employeeId': 'D100',
                'department': 'Practice', 'jobTitle': 'Technician', 'assignedLicenses': []}

    def test_directory_preview_provision_and_replay(self):
        with patch('training.directory.graph_email_lookup', return_value=[self.record()]) as lookup:
            before = (User.objects.count(), AuditEvent.objects.count())
            preview = self.roster(people=[], text='Casey <casey@example.com>', dry_run=True)
            self.assertEqual(preview.data['counts'], {'added': 1})
            self.assertIsNone(preview.data['rows'][0]['user'])
            self.assertEqual(before, (User.objects.count(), AuditEvent.objects.count()))
            response = self.roster(people=[], text='Casey <casey@example.com>')
            self.assertEqual(response.data['counts'], {'added': 1})
            user = User.objects.get(email='casey@example.com')
            self.assertEqual(user.role, 'learner'); self.assertFalse(user.has_usable_password())
            self.assertEqual(self.roster(people=[], text='casey@example.com').data['counts'], {'already': 1})
            # The check, the import and the replay share one remembered answer.
            self.assertEqual(lookup.call_count, 1)

    def test_directory_ineligible_ambiguous_disabled_and_unconfigured(self):
        for record in ({**self.record(), 'userType': 'Guest'}, {**self.record(), 'accountEnabled': False}):
            forget_answers()
            with patch('training.directory.graph_email_lookup', return_value=[record]):
                self.assertEqual(self.roster(people=[], text='casey@example.com').data['counts'], {'not_found': 1})
        forget_answers()
        with patch('training.directory.graph_email_lookup', return_value=[self.record(), self.record()]):
            self.assertEqual(self.roster(people=[], text='casey@example.com').data['counts'], {'ambiguous': 1})
        with patch('training.directory.configured', return_value=False), patch('training.directory.graph_email_lookup') as lookup:
            self.assertEqual(self.roster(people=[], text='casey@example.com').data['counts'], {'not_found': 1})
            lookup.assert_not_called()

    def test_lookups_run_concurrently_bounded_and_answers_are_remembered(self):
        import threading
        from time import perf_counter, sleep as pause
        state = {'active': 0, 'peak': 0}
        guard = threading.Lock()

        def lookup(email):
            with guard:
                state['active'] += 1; state['peak'] = max(state['peak'], state['active'])
            pause(0.1)
            with guard:
                state['active'] -= 1
            if email.startswith('broken'):
                raise RuntimeError('synthetic outage')
            return [{**self.record(), 'mail': email, 'userPrincipalName': email,
                     'id': str(uuid.uuid5(uuid.NAMESPACE_DNS, email))}] if email.startswith('found') else []
        text = '\n'.join([f'found{index}@example.com' for index in range(6)] + ['gone@example.com', 'broken@example.com'])
        with patch('training.directory.graph_email_lookup', side_effect=lookup) as mocked:
            started = perf_counter()
            rows = self.client.post('/api/trainings/check-people/', {'rosters': [{'text': text}]},
                                    format='json').data['rosters'][0]['rows']
            self.assertLess(perf_counter() - started, 0.6)  # sequential would take 0.8 s
            self.assertEqual(mocked.call_count, 8)
            self.assertTrue(2 <= state['peak'] <= 4, state)
            self.assertEqual([row['outcome'] for row in rows], ['added'] * 6 + ['not_found', 'not_checked'])
            # Found and not-found answers are remembered; the error is asked again.
            again = self.roster(people=[], text=text, dry_run=True)
            self.assertEqual(mocked.call_count, 9)
            self.assertEqual(again.data['counts'], {'added': 6, 'not_found': 1, 'not_checked': 1})
        self.assertFalse(User.objects.filter(email__startswith='found').exists())

    def test_waiting_for_a_lookup_slot_until_the_deadline(self):
        from .roster_import import _LOOKUPS
        for _ in range(4):
            _LOOKUPS.acquire()
        from time import monotonic as real, perf_counter
        calls = []

        def clock():
            # The request's 20 s budget, with all but 0.3 s already used after it was set.
            calls.append(1)
            return real() + (0 if len(calls) == 1 else 19.7)
        try:
            with patch('training.directory.graph_email_lookup') as lookup, \
                 patch('training.roster_import.monotonic', side_effect=clock):
                started = perf_counter()
                response = self.roster(people=[], text='casey@example.com')
                waited = perf_counter() - started
            lookup.assert_not_called()
            self.assertTrue(0.2 < waited < 3, waited)  # waited for a slot instead of answering at once
        finally:
            for _ in range(4):
                _LOOKUPS.release()
        self.assertEqual(response.data['counts'], {'not_checked': 1})

    def test_directory_budget_unreached_is_not_checked(self):
        with patch('training.roster_import.monotonic', side_effect=chain([0], repeat(21))):
            response = self.roster(people=[], text='casey@example.com')
        self.assertEqual(response.data['counts'], {'not_checked': 1})
        self.assertFalse(User.objects.filter(email='casey@example.com').exists())

    def test_check_people_directory_match_creates_no_account(self):
        with patch('training.directory.graph_email_lookup', return_value=[self.record()]) as lookup:
            before = (User.objects.count(), AuditEvent.objects.count())
            response = self.client.post('/api/trainings/check-people/', {'rosters': [
                {'text': 'Casey <casey@example.com>'}, {'text': 'casey@example.com'}]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        first, second = response.data['rosters']
        self.assertEqual(first['rows'][0]['outcome'], 'added'); self.assertIsNone(first['rows'][0]['user'])
        self.assertEqual(first['rows'][0]['email'], 'casey@example.com')
        self.assertEqual(second['counts'], {'duplicate': 1})
        self.assertEqual(lookup.call_count, 1)
        self.assertEqual(before, (User.objects.count(), AuditEvent.objects.count()))
        forget_answers()
        with patch('training.roster_import.monotonic', side_effect=chain([0], repeat(21))):
            response = self.client.post('/api/trainings/check-people/', {'rosters': [{'text': 'casey@example.com'}]}, format='json')
        self.assertEqual(response.data['rosters'][0]['counts'], {'not_checked': 1})

    def test_directory_resolution_is_before_creation_transaction_and_failure_rolls_back_profile(self):
        draft = Exam.objects.create(owner=self.owner, title='Empty')
        payload = self.training_payload(exam=draft.pk, rosters=[{'text': 'casey@example.com'}])
        with patch('training.directory.graph_email_lookup', return_value=[self.record()]):
            self.assertEqual(self.client.post('/api/trainings/', payload, format='json').status_code, 400)
        self.assertFalse(User.objects.filter(email='casey@example.com').exists())
        self.assertFalse(TrainingRequest.objects.exists())


@override_settings(DEBUG=True, EMAIL_NOTIFICATIONS_ENABLED=True)
class SimpleTrainingRoundTwoTests(TrainingFixture, TestCase):
    """Round 2: checking people before a course exists, rosters per session, pasted lists,
    the public seat hint, absent people, short mails, the sign-in sheet and the catalogue guard."""

    def check(self, *rosters, **extra):
        return self.client.post('/api/trainings/check-people/', {'rosters': list(rosters), **extra}, format='json')

    def writes(self):
        return (User.objects.count(), Enrollment.objects.count(), AuditEvent.objects.count(),
                OutboundEmail.objects.count(), Course.objects.count())

    # 1. Check people before a course exists
    def test_check_people_resolves_across_rosters_and_writes_nothing(self):
        blair = self.person('blair', employee_id='E101', display_name='Blair Stone')
        gone = self.person('gone', is_active=False)
        group = TrainingGroup.objects.create(name='Synthetic crew', created_by=self.owner)
        TrainingGroupMembership.objects.create(group=group, user=blair, added_by=self.owner)
        before = self.writes()
        response = self.check({'text': 'alex@example.com\nE101\nNobody Known', 'people': [gone.pk], 'groups': [group.pk]},
                              {'text': '', 'people': [self.user.pk, 999999]}, {})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response['Cache-Control'], 'no-store')
        first, second, third = response.data['rosters']
        self.assertEqual([row['outcome'] for row in first['rows']], ['added', 'added', 'not_found', 'inactive', 'duplicate'])
        self.assertEqual(first['counts'], {'added': 2, 'not_found': 1, 'inactive': 1, 'duplicate': 1})
        self.assertEqual([row['outcome'] for row in second['rows']], ['duplicate', 'not_found'])
        self.assertEqual(third, {'counts': {}, 'rows': []})
        self.assertEqual(first['rows'][1], {'input': 'E101', 'outcome': 'added', 'user': blair.pk, 'name': 'Blair Stone',
                                            'email': 'blair@example.com', 'department': ''})
        self.assertEqual(first['rows'][2]['user'], None)
        self.assertEqual(before, self.writes())

    def test_check_people_permissions_and_bounds(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.check({'text': 'alex@example.com'}).status_code, 403)
        self.client.force_authenticate(None)
        self.assertIn(self.check({'text': 'alex@example.com'}).status_code, (401, 403))
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post('/api/trainings/check-people/', {'rosters': []}, format='json').status_code, 400)
        self.assertEqual(self.check(*[{}] * 11).status_code, 400)
        self.assertIn('rosters[0].groups', self.check({'groups': [987654]}).data)
        self.assertEqual(self.check(*[{}] * 10).status_code, 200)

    def test_check_people_limit_is_for_the_whole_request(self):
        User.objects.bulk_create([User(username=f'bulk{i}', email=f'bulk{i}@example.com') for i in range(501)])
        ids = list(User.objects.filter(username__startswith='bulk').values_list('pk', flat=True))
        self.assertEqual(self.check({'people': ids[:300]}, {'people': ids[:300]}).status_code, 200)
        response = self.check({'people': ids[:300]}, {'people': ids[300:]})
        self.assertEqual(response.status_code, 400)
        self.assertIn('rosters[1]', response.data)

    def test_check_people_multipart_file_reports_lines_as_read(self):
        upload = SimpleUploadedFile('people.csv', b'Name,ID,Email\nAlex Rivera,E100,alex@example.com\n')
        before = self.writes()
        response = self.client.post('/api/trainings/check-people/', {'file': upload, 'people': [self.user.pk]},
                                    format='multipart')
        self.assertEqual(response.status_code, 200, response.data)
        rows = response.data['rosters'][0]['rows']
        # The Email heading picks that column; the heading row is dropped.
        self.assertEqual([(row['input'], row['outcome']) for row in rows], [
            ('alex@example.com', 'added'), (str(self.user.pk), 'duplicate')])
        self.assertEqual(before, self.writes())
        response = self.client.post('/api/trainings/check-people/', {'file': SimpleUploadedFile('people.pdf', b'x')},
                                    format='multipart')
        self.assertEqual(response.status_code, 400); self.assertIn('file', response.data)

    # 2. One roster per session
    def test_create_with_one_roster_per_session_first_list_wins(self):
        blair = self.person('blair')
        payload = self.training_payload(rosters=[{'session': 1, 'text': 'alex@example.com', 'people': [], 'groups': []},
                                                 {'session': 0, 'text': '', 'people': [self.user.pk, blair.pk], 'groups': []}])
        response = self.client.post('/api/trainings/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        course = Course.objects.get(pk=response.data['course'])
        sessions = list(course.sessions.order_by('pk'))
        self.assertEqual([report['session'] for report in response.data['rosters']], [sessions[1].pk, sessions[0].pk])
        self.assertEqual([row['outcome'] for row in response.data['rosters'][1]['rows']], ['duplicate', 'added'])
        self.assertEqual(Enrollment.objects.get(course=course, user=self.user).session_id, sessions[1].pk)
        self.assertEqual(Enrollment.objects.get(course=course, user=blair).session_id, sessions[0].pk)
        none = self.client.post('/api/trainings/', self.training_payload(), format='json')
        self.assertEqual(none.data['rosters'], [])

    def test_create_roster_errors_name_their_list_and_write_nothing(self):
        before = self.writes()
        for rosters, key in (([{'people': []}, {'session': 2}], 'rosters[1].session'),
                             ([{'dry_run': True}], 'rosters[0].dry_run'),
                             ([{}, {'groups': [987654]}], 'rosters[1].groups')):
            response = self.client.post('/api/trainings/', self.training_payload(rosters=rosters), format='json')
            self.assertEqual(response.status_code, 400)
            self.assertIn(key, response.data)
        response = self.client.post('/api/trainings/', self.training_payload(cover='not-a-cover'), format='json')
        self.assertIn('cover', response.data)
        self.assertEqual(before, self.writes())
        self.assertFalse(TrainingRequest.objects.exists())

    def test_create_people_limit_spans_all_rosters(self):
        User.objects.bulk_create([User(username=f'bulk{i}', email=f'bulk{i}@example.com') for i in range(501)])
        ids = list(User.objects.filter(username__startswith='bulk').values_list('pk', flat=True))
        payload = self.training_payload(rosters=[{'session': 0, 'people': ids[:250]}, {'session': 1, 'people': ids[250:]}])
        self.assertEqual(self.client.post('/api/trainings/', payload, format='json').status_code, 400)
        self.assertFalse(Course.objects.filter(title='Forklift refresher').exists())

    # 3. Pasted lists in the wild
    def test_mail_program_line_becomes_one_entry_per_address(self):
        jo = self.person('jo', display_name='Jo Doe')
        line = 'Alex Rivera <alex@example.com>, Jo Doe <jo@example.com> Sam Lee <sam@example.com>'
        rows = self.check({'text': line}).data['rosters'][0]['rows']
        self.assertEqual([(row['input'], row['outcome'], row['user'], row['name']) for row in rows], [
            ('Alex Rivera <alex@example.com>', 'added', self.user.pk, 'Alex Rivera'),
            ('Jo Doe <jo@example.com>', 'added', jo.pk, 'Jo Doe'),
            ('Sam Lee <sam@example.com>', 'not_found', None, 'Sam Lee')])
        rows = self.check({'text': 'alex@example.com jo@example.com'}).data['rosters'][0]['rows']
        self.assertEqual([row['user'] for row in rows], [self.user.pk, jo.pk])
        # The same address twice on one line is still one person.
        rows = self.check({'text': 'Alex <alex@example.com> alex@example.com'}).data['rosters'][0]['rows']
        self.assertEqual([row['outcome'] for row in rows], ['added'])

    def test_username_matches_only_a_whole_single_token_line(self):
        lee = self.person('lee', employee_id='10492')
        rows = self.check({'text': 'Lee Wong\nlee\nAlex Rivera 10492\nLEE'}).data['rosters'][0]['rows']
        # An ID inside a space-separated line is never used: the person fixes the line.
        self.assertEqual([(row['outcome'], row['user']) for row in rows], [
            ('not_found', None), ('added', lee.pk), ('not_found', None), ('duplicate', lee.pk)])
        # Two different people in one line stay ambiguous; nobody is picked.
        rows = self.check({'text': 'E100\t10492'}).data['rosters'][0]['rows']
        self.assertEqual([(row['outcome'], row['user']) for row in rows], [('ambiguous', None)])
        response = self.roster(people=[], text='Lee Wong')
        self.assertEqual(response.data['counts'], {'not_found': 1})
        self.assertFalse(Enrollment.objects.exists())

    def test_pasted_spreadsheet_row(self):
        blair = self.person('blair', employee_id='E101')
        text = 'Alex Rivera\tE100\talex@example.com\r\nBlair Stone\tE101\tblair.other@example.org\nNo Match\tZ999\tnobody@example.com'
        rows = self.check({'text': text}).data['rosters'][0]['rows']
        # A line with an address is decided by the address alone, even when another cell is an employee ID.
        self.assertEqual([(row['outcome'], row['user']) for row in rows], [
            ('added', self.user.pk), ('not_found', None), ('not_found', None)])
        self.assertEqual(rows[2]['name'], 'No Match\tZ999')

    # 4. Public registration lookup
    def test_public_lookup_seats_left_and_upcoming_opening(self):
        self.course.registration_key = 'k' * 43; self.course.save()
        self.session.capacity = 6; self.session.save()
        self.seat()
        opens = self.now + timedelta(hours=5)
        self.second.registration_opens_at = opens; self.second.capacity = 50; self.second.save()
        self.client.force_authenticate(None)
        data = self.client.post('/api/registration/lookup/', {'key': self.course.registration_key}, format='json').data
        sessions = {item['id']: item for item in data['sessions']}
        self.assertEqual(sessions[self.session.pk]['seats_left'], 5)
        self.assertNotIn('registration_opens_at', sessions[self.session.pk])
        self.assertIsNone(sessions[self.second.pk]['seats_left'])
        self.assertEqual(sessions[self.second.pk]['state'], 'upcoming')
        self.assertEqual(sessions[self.second.pk]['registration_opens_at'], opens)
        self.session.capacity = 7; self.session.save()
        data = self.client.post('/api/registration/lookup/', {'key': self.course.registration_key}, format='json').data
        self.assertIsNone(next(item for item in data['sessions'] if item['id'] == self.session.pk)['seats_left'])
        self.assertNotIn('capacity', json.dumps(data, default=str))
        self.assertNotIn('reserved', json.dumps(data, default=str))

    # 5. People marked absent
    def test_absent_person_gets_no_after_session_access_until_corrected(self):
        row = self.seat(); exam = self.quiz(); self.ended()
        self.client.force_authenticate(self.user)
        def access():
            from .services import in_exam_audience
            listed = [item['id'] for item in self.client.get('/api/exams/').data]
            rows = self.client.get(self.root).data['assessments']
            budget = self.client.get(f'/api/exams/{exam.pk}/budget/').data
            detail = self.client.get(f'/api/exams/{exam.pk}/')
            return (in_exam_audience(exam, self.user), exam.pk in listed, bool(rows and rows[0]['available_to_me']),
                    bool(budget.get('available_to_me')), detail.status_code == 200)
        self.assertEqual(access(), (True,) * 5)
        row.attendance = 'absent'; row.save()
        self.assertEqual(access(), (False,) * 5)
        with self.assertRaises(PermissionDenied): start_attempt(exam.pk, identity_for_user(self.user))
        row.attendance = 'present'; row.save()
        self.assertEqual(access(), (True,) * 5)
        attempt = start_attempt(exam.pk, identity_for_user(self.user))
        # An attempt already running keeps the resume rule even after a later absent mark.
        row.attendance = 'absent'; row.save()
        self.assertEqual(start_attempt(exam.pk, identity_for_user(self.user)).pk, attempt.pk)

    def test_absent_only_affects_after_session_release(self):
        row = self.seat(attendance='absent'); exam = self.quiz(); self.ended()
        CourseAssessment.objects.filter(exam=exam).update(release='immediate')
        from .services import in_exam_audience
        self.assertTrue(in_exam_audience(exam, self.user))

    def test_absent_people_get_no_quiz_mail_and_queued_ones_are_dropped(self):
        self.course.reminders = True; self.course.save(); self.ended(); exam = self.quiz()
        present = self.seat(); absent_person = self.person('blair'); absent = self.seat(absent_person, attendance='absent')
        produce_reminders()
        self.assertEqual(list(OutboundEmail.objects.values_list('recipient_user_id', flat=True)), [self.user.pk])
        from .reminders import valid_queued_reminder
        mail = OutboundEmail.objects.get()
        self.assertTrue(valid_queued_reminder(mail))
        present.attendance = 'absent'; present.save()
        self.assertFalse(valid_queued_reminder(mail))
        present.attendance = ''; present.save()
        self.assertTrue(valid_queued_reminder(mail))
        with patch('django.utils.timezone.now', return_value=self.session.ends_at + timedelta(hours=72)):
            produce_reminders()
        self.assertFalse(OutboundEmail.objects.filter(recipient_user=absent_person).exists())

    # 6. Short session and quiz mails
    def test_session_mails_are_short_and_describe_only_the_first(self):
        self.course.description = 'Synthetic description. ' * 40; self.course.category = 'Synthetic category'
        self.course.duration_minutes = 45; self.course.venue = 'onsite'; self.course.save()
        self.second.cancelled = True; self.second.save()
        self.roster()
        mail = OutboundEmail.objects.get(kind='registered')
        self.assertRegex(mail.subject, r'^Registered: Synthetic safety training, \w{3} \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M$')
        text = mail.body_text
        self.assertTrue(text.startswith(BRAND['title'] + '\n\nYou are registered.\n\nSynthetic safety training\n\nWhen: '))
        self.assertRegex(text, r'\nWhen: \w+day, \w+ \d{1,2}, \d{4} · \d{1,2}:\d{2}( [AP]M)?–\d{1,2}:\d{2} [AP]M E[SD]T\n')
        self.assertIn('\n\nWhere: Building C, Room 12\n\n', text)
        for label in ('By:', 'Due:', 'Format:', 'Duration:', 'Category:', 'Session:', 'Starts:', 'Ends:'):
            self.assertNotIn(label, text)
        about = text.split('About this training: ')[1].split('\n\n')[0]
        self.assertLessEqual(len(about), 301); self.assertTrue(about.endswith('…'))
        self.assertEqual(mail.body_html.count('</a>'), 1)
        # Later mails for the same course carry no description.
        Enrollment.objects.filter(user=self.user).update(status='cancelled')
        self.roster()
        self.assertEqual(OutboundEmail.objects.filter(kind='registered').count(), 2)
        self.assertNotIn('About this training', OutboundEmail.objects.filter(kind='registered').latest('pk').body_text)

    def test_session_name_only_with_several_open_sessions_and_changed_place(self):
        self.course.venue = 'onsite'; self.course.save()
        from .notifications import session_changed
        row = self.seat(session=self.second)
        moved = CourseSession(title='Morning', starts_at=self.second.starts_at, ends_at=self.second.ends_at, location='Hall A')
        session_changed(row, self.owner, moved)
        text = OutboundEmail.objects.get().body_text
        self.assertIn('\n\nSession: Afternoon\n\n', text)
        self.assertIn('\n\nWas: Hall A\n\nNow: Building C, Room 12\n\nWhen: ', text)
        self.session.cancelled = True; self.session.save(); row.revision += 1; row.save()
        session_changed(row, self.owner, moved)
        self.assertNotIn('Session:', OutboundEmail.objects.latest('pk').body_text)

    def test_reschedule_and_tomorrow_subjects(self):
        self.course.venue = 'onsite'; self.course.reminders = True; self.course.save(); self.seat()
        save_session(self.owner, self.course.pk, {'revision': 0, 'starts_at': (self.session.starts_at + timedelta(hours=1)).isoformat(),
                     'ends_at': (self.session.ends_at + timedelta(hours=1)).isoformat()}, self.session.pk)
        mail = OutboundEmail.objects.get(kind='session_rescheduled')
        self.assertTrue(mail.subject.startswith('Changed: Synthetic safety training, now '))
        self.assertIn('\n\nWas: ', mail.body_text); self.assertIn('\n\nWhere: Building C, Room 12', mail.body_text)
        self.assertNotIn('Updated by', mail.body_html)
        self.session.refresh_from_db()
        self.session.starts_at = self.now + timedelta(hours=23); self.session.ends_at = self.now + timedelta(hours=24); self.session.save()
        produce_reminders()
        mail = OutboundEmail.objects.get(kind='session_tomorrow')
        self.assertRegex(mail.subject, r'^Tomorrow: Synthetic safety training, \d{1,2}:\d{2} [AP]M$')

    def test_quiz_mails_have_quiz_facts_and_no_description(self):
        from .notifications import message_content
        exam = Exam(pk=5, title='Synthetic quiz', description='Long synthetic description', duration_minutes=15,
                    questions_per_attempt=8, pass_score=70, ends_at=self.now + timedelta(days=9))
        for event, lead in (('Your quiz is ready', 'Your session is over. Take the quiz.'),
                            ('Quiz reminder', 'Your quiz is still open.')):
            subject, text, html = message_content(event, exam)
            self.assertTrue(text.startswith(f"{BRAND['title']}" + f'\n\n{lead}\n\nSynthetic quiz\n\nTime limit: 15 min\n\n'
                                            'Questions: 8\n\nPassing score: 70\n\nCloses: '))
            self.assertNotIn('Long synthetic description', text + html)
            self.assertIn(', closes ', subject)
            self.assertIn('>Take the quiz</a>', html)
        exam.ends_at = None
        subject, text, _ = message_content('Quiz reminder', exam)
        self.assertNotIn('Closes', text); self.assertEqual(subject, 'Quiz reminder: Synthetic quiz')

    def test_session_mail_escapes_user_text(self):
        from .notifications import message_content
        dangerous = '<script>alert("x")</script> & \'quoted\''
        self.course.title = self.session.location = dangerous; self.course.venue = 'onsite'
        subject, text, html = message_content('You are registered', self.course, session=self.session)
        self.assertIn('\n\n' + dangerous + '\n\n', text)
        self.assertNotIn('<script>', html); self.assertGreaterEqual(html.count('&lt;script&gt;'), 2)
        self.assertNotIn('\n', subject)

    # 7. Sign-in sheet
    def test_sign_in_sheet_header_logo_date_and_file_names(self):
        self.course.title = 'Forklift refresher'; self.course.save()
        self.session.title = 'Session 1'
        self.session.starts_at = timezone.datetime(2027, 1, 12, 15, 0, tzinfo=dt_timezone.utc)
        self.session.ends_at = timezone.datetime(2027, 1, 12, 16, 30, tzinfo=dt_timezone.utc); self.session.save()
        for index in range(11): self.seat(self.person(f'sheet{index}', display_name=f'Sheet {index:02}'))
        response = self.client.get(self.root + f'sessions/{self.session.pk}/export/', {'kind': 'sign-in-pdf', 'timezone': 'America/Chicago'})
        self.assertEqual(response['Content-Disposition'], 'attachment; filename="Forklift refresher - Session 1 - sign-in.pdf"; '
                         "filename*=UTF-8''Forklift%20refresher%20-%20Session%201%20-%20sign-in.pdf")
        reader = PdfReader(io.BytesIO(response.content))
        first = reader.pages[0].extract_text()
        self.assertLess(first.index('Sign-in sheet'), first.index('Forklift refresher'))
        self.assertIn('Tuesday, January 12, 2027 · 9:00–10:30 AM CST', first)
        self.assertEqual(len(reader.pages), 1)  # 34 pt rows: 11 people and 5 walk-in rows fit on one Letter page.
        images = list(reader.pages[0].images)
        if '<image' in (BRAND_PATH / 'logo-horizontal.svg').read_text():
            self.assertEqual(len(images), 1)
            self.assertGreater(images[0].image.width, images[0].image.height)
        else:
            self.assertIn(BRAND['organization'], first)
        response = self.client.get(self.root + f'sessions/{self.session.pk}/export/', {'kind': 'sign-in-pdf'},
                                   HTTP_ACCEPT_LANGUAGE='zh-TW')
        text = PdfReader(io.BytesIO(response.content)).pages[0].extract_text()
        self.assertIn('點名單', text); self.assertIn('2027年1月12日（星期二）', text)
        response = self.client.get(self.root + f'sessions/{self.session.pk}/export/', {'kind': 'sign-in'})
        self.assertIn('filename="Forklift refresher - Session 1 - sign-in.xlsx"', response['Content-Disposition'])

    def test_file_names_are_ascii_safe_with_utf8_form(self):
        self.course.title = '林小明 "安全"/訓練'; self.course.save(); self.session.title = 'Sesión 1'; self.session.save()
        response = self.client.get(self.root + f'sessions/{self.session.pk}/export/', {'kind': 'sign-in-pdf'})
        header = response['Content-Disposition']
        fallback = header.split('filename="')[1].split('"')[0]
        self.assertTrue(fallback.isascii()); self.assertEqual(fallback, 'Sesion 1 - sign-in.pdf')
        from urllib.parse import unquote
        self.assertEqual(unquote(header.split("filename*=UTF-8''")[1]), '林小明 安全 訓練 - Sesión 1 - sign-in.pdf')
        self.course.title = '測試'; self.course.save(); self.session.title = '第一場'; self.session.save()
        header = self.client.get(self.root + f'sessions/{self.session.pk}/export/', {'kind': 'sign-in'})
        self.assertIn(f'filename="session-{self.session.pk} - sign-in.xlsx"', header['Content-Disposition'])


@override_settings(DEBUG=True, EMAIL_NOTIFICATIONS_ENABLED=True)
class ReviewFindingsTests(TrainingFixture, TestCase):
    """Section 10: identity evidence, bounded work, attendance kept, quiz mail windows, gated quizzes."""

    def check(self, *rosters):
        return self.client.post('/api/trainings/check-people/', {'rosters': list(rosters)}, format='json')

    def rows(self, text):
        return self.check({'text': text}).data['rosters'][0]['rows']

    def upload(self, name, content, **extra):
        return self.client.post('/api/trainings/check-people/', {'file': SimpleUploadedFile(name, content), **extra},
                                format='multipart').data['rosters'][0]['rows']

    def xlsx(self, *sheets, hidden_first=False):
        book = Workbook()
        book.remove(book.active)
        for index, rows in enumerate(sheets):
            sheet = book.create_sheet(f'Sheet{index}')
            for row in rows:
                sheet.append(row)
        if hidden_first:
            book.worksheets[0].sheet_state = 'hidden'
        output = io.BytesIO(); book.save(output)
        return output.getvalue()

    # A. Never guess who a line means
    def test_address_line_never_matches_the_manager_or_a_username(self):
        manager = self.person('morgan', employee_id='E900')
        casey = self.person('casey')
        rows = self.rows('Taylor Quinn, taylor@example.com, E555, E900, 1234\nCasey Chen <casey.chen@example.com>')
        self.assertEqual([(row['outcome'], row['user']) for row in rows], [('not_found', None), ('not_found', None)])
        self.assertEqual(rows[1]['name'], 'Casey Chen')
        response = self.roster(people=[], text='Taylor Quinn, taylor@example.com, E555, E900')
        self.assertEqual(response.data['counts'], {'not_found': 1})
        self.assertFalse(Enrollment.objects.filter(user__in=[manager, casey]).exists())

    def test_quotes_around_an_address_are_not_part_of_it(self):
        obrien = self.person("o'brien")
        rows = self.rows("'alex@example.com'\n`alex@example.com`, \"O'Brien\" <o'brien@example.com>")
        self.assertEqual([(row['outcome'], row['user']) for row in rows],
                         [('added', self.user.pk), ('duplicate', self.user.pk), ('added', obrien.pk)])

    def test_ids_count_only_as_whole_cells(self):
        seven = self.person('seven', employee_id='7')
        rows = self.rows('Room 7 Building C\nRoom 7, Building C\n"7"\nAlex Rivera 10492')
        self.assertEqual([(row['outcome'], row['user']) for row in rows],
                         [('not_found', None), ('not_found', None), ('added', seven.pk), ('not_found', None)])
        self.assertEqual(rows[1]['input'], 'Room 7\tBuilding C')

    def test_headings_choose_one_column(self):
        blair = self.person('blair', employee_id='E101')
        manager = self.person('morgan', employee_id='E900')
        rows = self.rows('Name\tEmployee ID\tManager\nAlex Rivera\tE100\tE900\nBlair\tE101\tE900')
        self.assertEqual([(row['input'], row['user']) for row in rows], [('E100', self.user.pk), ('E101', blair.pk)])
        rows = self.rows('Name\tE-mail\tManager ID\nBlair\tnobody@example.com\tE900\nAlex\talex@example.com\tE900')
        self.assertEqual([(row['outcome'], row['user']) for row in rows], [('not_found', None), ('added', self.user.pk)])
        # A comma-separated first pasted line is no heading: every row is read by rules 1 and 2.
        rows = self.rows('Name,ID\nAlex Rivera,E100')
        self.assertEqual([row['outcome'] for row in rows], ['not_found', 'added'])
        rows = self.upload('people.csv', 'Name,電子郵件,ID\nAlex,alex@example.com,E900\n'.encode())
        self.assertEqual([(row['input'], row['user']) for row in rows], [('alex@example.com', self.user.pk)])
        self.assertFalse(Enrollment.objects.filter(user=manager).exists())

    def test_spreadsheet_floats_first_visible_sheet_and_csv_encodings(self):
        lee = self.person('lee', employee_id='10492')
        rows = self.upload('people.xlsx', self.xlsx([['Name', '員工編號'], ['Lee Wong', 10492.0]]))
        self.assertEqual([(row['input'], row['user']) for row in rows], [('10492', lee.pk)])
        rows = self.upload('people.xlsx', self.xlsx([['alex@example.com']], [['Lee Wong', 10492.0]], hidden_first=True))
        self.assertEqual([(row['input'], row['user']) for row in rows], [('Lee Wong\t10492', lee.pk)])
        ines = self.person('ines', display_name='Inés Muñoz')
        for encoded in ('﻿Name,Email\nInés Muñoz,ines@example.com\n'.encode('utf-16'),
                        'Name,Email\nInés Muñoz,ines@example.com\n'.encode('cp1252'),
                        '﻿Name,Email\nInés Muñoz,ines@example.com\n'.encode('utf-8')):
            rows = self.upload('people.csv', encoded)
            self.assertEqual([(row['input'], row['user']) for row in rows], [('ines@example.com', ines.pk)])
        rows = self.upload('people.csv', 'Inés Muñoz\tE100\n'.encode('cp1252'))
        self.assertEqual([(row['input'], row['user']) for row in rows], [('Inés Muñoz\tE100', self.user.pk)])

    def test_inputs_sent_back_resolve_to_the_same_people(self):
        blair = self.person('blair', employee_id='E101')
        first = self.upload('people.csv', b'Alex Rivera,E100\nBlair Stone,E101\nSam <sam@example.com>, E100\nNobody,Z1\n')
        again = self.rows('\n'.join(row['input'] for row in first))
        self.assertEqual([row['user'] for row in first], [self.user.pk, blair.pk, None, None])
        self.assertEqual([(row['input'], row['user']) for row in again], [(row['input'], row['user']) for row in first])

    # B. Bounded work
    def test_long_and_many_lines_are_fast_and_bounded(self):
        from django.db import connection as db
        from django.test.utils import CaptureQueriesContext
        from time import perf_counter
        for text in ('word ' * 20000, 'a@b ' * 25000, 'x' * 100000 + '@example.com',
                     '\n'.join(f'Unknown Person {index}' for index in range(2000)),
                     '\n'.join(f'unknown{index}@example.org' for index in range(2000))):
            started = perf_counter()
            with CaptureQueriesContext(db) as queries:
                response = self.check({'text': text})
            self.assertEqual(response.status_code, 200)
            self.assertLess(perf_counter() - started, 1.0)
            self.assertLessEqual(len(queries), 6)
            self.assertNotIn('added', response.data['rosters'][0]['counts'])
        row = self.rows('y' * 300)[0]
        self.assertEqual((row['outcome'], row['input']), ('not_found', 'y' * 200 + '…'))

    def test_line_and_text_limits(self):
        response = self.check({'text': '\n'.join(f'P{index}' for index in range(2001))})
        self.assertEqual(response.status_code, 400)
        self.assertIn('Use at most 2,000 lines at a time.', json.dumps(response.data))
        self.assertEqual(self.check({'text': '\n'.join(f'P{index}' for index in range(2000))}).status_code, 200)
        # Pasted text and file rows count together.
        upload = SimpleUploadedFile('people.csv', '\n'.join(f'P{index}' for index in range(1000)).encode())
        response = self.client.post('/api/trainings/check-people/', {'file': upload,
            'text': '\n'.join(f'Q{index}' for index in range(1001))}, format='multipart')
        self.assertEqual(response.status_code, 400)
        response = self.check({'text': 'z' * 200001})
        self.assertEqual(response.status_code, 400); self.assertIn('rosters[0].text', response.data)
        self.assertEqual(self.roster(people=[], text='z' * 200001).status_code, 400)

    # D. An import must not erase attendance
    def started(self):
        self.session.starts_at = self.now - timedelta(hours=1); self.session.ends_at = self.now + timedelta(hours=1)
        self.session.save()

    def to_second(self, **extra):
        return self.client.post(self.root + 'roster/', {'session': self.second.pk, 'people': [self.user.pk], **extra}, format='json')

    def test_started_session_keeps_people_unless_asked(self):
        self.started(); row = self.seat(progress=50)
        response = self.to_second()
        self.assertEqual(response.data['counts'], {'already': 1})
        row.refresh_from_db(); self.assertEqual((row.session_id, row.progress), (self.session.pk, 50))
        response = self.to_second(move_started=True)
        self.assertEqual(response.data['counts'], {'moved': 1})
        row.refresh_from_db(); self.assertEqual((row.session_id, row.progress), (self.second.pk, 0))
        event = AuditEvent.objects.filter(action='enrollment.roster_moved').latest('pk')
        self.assertEqual({key: event.detail[key] for key in ('previous_session', 'previous_attendance', 'previous_progress')},
                         {'previous_session': self.session.pk, 'previous_attendance': '', 'previous_progress': 50})

    def test_present_never_moved_absent_always_movable(self):
        self.started(); row = self.seat(attendance='present')
        self.assertEqual(self.to_second(move_started=True).data['counts'], {'already': 1})
        Enrollment.objects.filter(pk=row.pk).update(attendance='', attended_at=self.now)
        self.assertEqual(self.to_second(move_started=True).data['counts'], {'already': 1})
        Enrollment.objects.filter(pk=row.pk).update(attendance='absent', attended_at=None)
        self.assertEqual(self.to_second().data['counts'], {'moved': 1})
        event = AuditEvent.objects.get(action='enrollment.roster_moved')
        self.assertEqual(event.detail['previous_attendance'], 'absent')

    def test_moved_into_an_ended_session_gets_the_quiz_ready_decision(self):
        self.course.reminders = True; self.course.save()
        self.seat(session=self.second); self.ended(); self.quiz()
        response = self.roster()
        self.assertEqual((response.data['counts'], response.data['notified']), ({'moved': 1}, 1))
        self.assertEqual(list(OutboundEmail.objects.values_list('kind', flat=True)), ['quiz_ready'])

    def test_added_to_an_ended_session_without_a_quiz_gets_no_mail(self):
        self.ended()
        response = self.roster()
        self.assertEqual((response.data['counts'], response.data['notified']), ({'added': 1}, 0))
        self.assertTrue(Enrollment.objects.filter(user=self.user, session=self.session, status='approved').exists())
        self.assertFalse(OutboundEmail.objects.exists())

    # E. Quiz mails: never twice, never to old sessions
    def emails(self):
        overview = self.client.get(self.root + 'training/').data
        return next(item for item in overview['sessions'] if item['id'] == self.session.pk)['emails']

    def test_quiz_linked_long_after_the_session_mails_nobody(self):
        self.course.reminders = True; self.course.save(); self.ended(hours=24 * 60); self.seat(); self.quiz()
        produce_reminders()
        with patch('django.utils.timezone.now', return_value=self.now + timedelta(hours=73)): produce_reminders()
        self.assertFalse(OutboundEmail.objects.exists())
        self.assertEqual({event['kind']: event['state'] for event in self.emails() if event['kind'] != 'session_tomorrow'},
                         {'quiz_ready': 'disabled', 'quiz_reminder': 'disabled'})

    def test_editing_a_finished_session_does_not_repeat_and_reschedule_into_future_does(self):
        self.course.reminders = True; self.course.save(); self.ended(hours=2); self.seat(); self.quiz()
        produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(kind='quiz_ready').count(), 1)
        self.session.refresh_from_db()
        save_session(self.owner, self.course.pk, {'revision': self.session.revision,
                     'ends_at': (self.session.ends_at + timedelta(minutes=30)).isoformat()}, self.session.pk)
        produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(kind='quiz_ready').count(), 1)
        self.session.refresh_from_db()
        save_session(self.owner, self.course.pk, {'revision': self.session.revision,
                     'starts_at': (self.now + timedelta(hours=1)).isoformat(),
                     'ends_at': (self.now + timedelta(hours=2)).isoformat()}, self.session.pk)
        produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(kind='quiz_ready').count(), 1)
        with patch('django.utils.timezone.now', return_value=self.now + timedelta(hours=3)): produce_reminders()
        self.assertEqual(OutboundEmail.objects.filter(kind='quiz_ready').count(), 2)

    def test_tomorrow_mail_says_today_on_the_day(self):
        from zoneinfo import ZoneInfo
        from .notifications import session_content
        zone = ZoneInfo('America/New_York')
        morning = timezone.datetime(2026, 11, 12, 8, 0, tzinfo=zone)
        self.session.starts_at = morning + timedelta(hours=7); self.session.ends_at = morning + timedelta(hours=8)
        with override_settings(NOTIFICATION_TIME_ZONE='America/New_York'), \
             patch('django.utils.timezone.now', return_value=morning):
            subject, text, _ = session_content('Session tomorrow', self.course, self.session)
            self.assertTrue(subject.startswith('Today: '), subject); self.assertIn('Your session is today.', text)
            self.session.starts_at += timedelta(days=1); self.session.ends_at += timedelta(days=1)
            subject, text, _ = session_content('Session tomorrow', self.course, self.session)
            self.assertTrue(subject.startswith('Tomorrow: '), subject); self.assertIn('Your session is tomorrow.', text)

    # F. "After the session" must be true or the interface must know
    def test_link_options_and_overview_say_whether_the_quiz_is_gated(self):
        course_only, everybody = self.quiz(), make_exam(self.owner)
        everybody.audience = 'all'; everybody.save()
        draft = make_exam(self.owner); draft.published = False; draft.audience = 'all'; draft.save()
        rows = {row['id']: row for row in self.client.get('/api/exams/link-options/?quizzes=1').data}
        self.assertEqual({key: (rows[key]['audience'], rows[key]['gated']) for key in (course_only.pk, everybody.pk, draft.pk)},
                         {course_only.pk: ('course', True), everybody.pk: ('all', False), draft.pk: ('all', True)})
        CourseAssessment.objects.create(course=self.course, exam=everybody, release='after_session')
        quizzes = {item['id']: item['gated'] for item in self.client.get(self.root + 'training/').data['quizzes']}
        self.assertEqual(quizzes, {course_only.pk: True, everybody.pk: False})
        options = {item['id']: item['gated'] for item in self.client.get(self.root + 'assessments/').data['linked']}
        self.assertEqual(options, {course_only.pk: True, everybody.pk: False})
        response = self.client.post('/api/trainings/', self.training_payload(exam=draft.pk), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((response.data['quiz']['release'], response.data['quiz']['gated']), ('after_session', True))

    def test_after_session_needs_scheduled_sessions_and_otherwise_acts_immediate(self):
        from .assessments import attach_quiz
        from .services import exam_audience_sets
        from rest_framework.exceptions import ValidationError
        exam = self.quiz(); self.seat()
        self.assertNotIn(exam.pk, exam_audience_sets(self.user)['participation'])
        Course.objects.filter(pk=self.course.pk).update(delivery_mode='self_paced')
        self.course.refresh_from_db()
        # An old "after the session" link now opens immediately instead of never.
        self.assertIn(exam.pk, exam_audience_sets(self.user)['participation'])
        other = make_exam(self.owner)
        for method in ('post', 'patch'):
            response = getattr(self.client, method)(self.root + 'assessments/', {'exam': exam.pk if method == 'patch' else other.pk,
                                                                               'release': 'after_session'}, format='json')
            self.assertEqual(response.status_code, 400); self.assertIn('release', response.data)
        self.assertFalse(CourseAssessment.objects.filter(exam=other).exists())
        with self.assertRaises(ValidationError):
            attach_quiz(self.owner, self.course, other, release='after_session')
        self.assertEqual(self.client.post(self.root + 'assessments/', {'exam': other.pk, 'release': 'immediate'},
                                          format='json').status_code, 200)

    # G. Mail only for a course people can open
    def test_no_roster_mail_before_release_and_notified_counts(self):
        for change in ({'published': False}, {'release_at': self.now + timedelta(days=1)}):
            Course.objects.filter(pk=self.course.pk).update(**{'published': True, 'release_at': None, **change})
            Enrollment.objects.all().delete()
            response = self.roster()
            self.assertEqual((response.data['counts'], response.data['notified']), ({'added': 1}, 0))
        self.assertFalse(OutboundEmail.objects.exists())
        Course.objects.filter(pk=self.course.pk).update(published=True, release_at=None)
        Enrollment.objects.all().delete()
        self.assertEqual(self.roster(notify=False).data['notified'], 0)
        Enrollment.objects.all().delete()
        blair = self.person('blair')
        response = self.roster(people=[self.user.pk, blair.pk])
        self.assertEqual(response.data['notified'], 2)
        with override_settings(EMAIL_NOTIFICATIONS_ENABLED=False):
            Enrollment.objects.all().delete()
            self.assertEqual(self.roster().data['notified'], 0)

    # H. Smaller
    def test_inactive_rows_carry_the_input_only(self):
        gone = self.person('gone', display_name='Gone Person', department='Practice', is_active=False)
        row = self.rows('gone@example.com')[0]
        self.assertEqual(row, {'input': 'gone@example.com', 'outcome': 'inactive', 'user': None, 'name': '',
                               'email': '', 'department': ''})
        self.assertEqual(self.roster(people=[gone.pk]).data['rows'][0]['user'], None)

    def test_create_training_lock_on_the_owner_is_no_key(self):
        from django.db.models.query import QuerySet
        calls, original = [], QuerySet.select_for_update

        def record(queryset, *args, **kwargs):
            calls.append((queryset.model, kwargs.get('no_key', False)))
            return original(queryset, *args, **kwargs)
        with patch.object(QuerySet, 'select_for_update', autospec=True, side_effect=record):
            self.assertEqual(self.client.post('/api/trainings/', self.training_payload(), format='json').status_code, 201)
        self.assertIn((User, True), calls)
        self.assertNotIn((User, False), calls)


class CatalogueGuardTests(TestCase):
    def test_backend_translate_literals_are_in_the_catalogue(self):
        """Walk backend source (not migrations or tests) for literal translate()/t() keys."""
        import ast
        from pathlib import Path
        from django.conf import settings
        messages = json.loads((Path(settings.LOCALE_ROOT) / 'messages.json').read_text())
        root = Path(settings.BASE_DIR)
        missing, seen = [], 0
        for path in sorted(root.rglob('*.py')):
            if 'migrations' in path.parts or path.name.startswith('test') or path.name == 'tests.py':
                continue
            for node in ast.walk(ast.parse(path.read_text(), str(path))):
                if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                        and node.func.id in ('translate', 't') and node.args):
                    continue
                first = node.args[0]
                for value in ([first.body, first.orelse] if isinstance(first, ast.IfExp) else [first]):
                    if isinstance(value, ast.Constant) and isinstance(value.value, str):
                        seen += 1
                        if value.value not in messages:
                            missing.append(f'{path.relative_to(root)}:{node.lineno}: {value.value}')
        self.assertGreater(seen, 100)
        self.assertEqual(missing, [])


class SceneCoverCommandTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('cover-organizer', role='training_scheduler')
        self.forklift = Course.objects.create(owner=self.owner, title='Forklift refresher', cover='learning-skills')
        self.scene = Course.objects.create(owner=self.owner, title='Already illustrated', cover='scene-plant-skyline')
        self.blank = Course.objects.create(owner=self.owner, title='Quarterly synthetic update', cover='', category='Zzz')
        self.other = Course.objects.create(owner=self.owner, title='Another synthetic update', cover='learning-skills', category='Zzz')

    def run_command(self, *args):
        from django.core.management import call_command
        output = io.StringIO()
        call_command('apply_scene_covers', *args, stdout=output)
        return json.loads(output.getvalue())

    def test_dry_run_apply_and_restore(self):
        from .covers import scene_for, scenes
        before = AuditEvent.objects.count()
        plan = self.run_command()
        self.assertEqual(plan['unchanged'], 1)
        self.assertEqual([item['id'] for item in plan['changes']], [self.forklift.pk, self.blank.pk, self.other.pk])
        self.assertEqual({item['from'] for item in plan['changes']}, {'learning-skills', ''})
        self.assertTrue(all(item['to'].startswith('scene-') for item in plan['changes']))
        self.assertNotIn('Forklift', json.dumps(plan))
        self.assertEqual(AuditEvent.objects.count(), before)
        self.forklift.refresh_from_db(); self.assertEqual(self.forklift.cover, 'learning-skills')
        forklift = next(item['to'] for item in plan['changes'] if item['id'] == self.forklift.pk)
        self.assertIn('forklift', next(item for item in scenes() if item['id'] == forklift)['keywords'])
        fallback = [item['to'] for item in plan['changes'] if item['id'] in (self.blank.pk, self.other.pk)]
        self.assertNotEqual(fallback[0], fallback[1])
        self.assertTrue(all(cover.startswith(('scene-learning-', 'scene-office-')) for cover in fallback))
        self.assertEqual(scene_for(1, 'x', 'Forklift operations'), forklift)

        applied = self.run_command('--apply')
        self.assertEqual(applied, plan)
        self.assertEqual(AuditEvent.objects.filter(action='course.cover_scene').count(), 3)
        self.assertEqual(self.run_command()['changes'], [])
        self.other.cover = 'scene-plant-skyline'; self.other.save()  # chosen by the owner afterwards
        import tempfile
        with tempfile.NamedTemporaryFile('w', suffix='.json') as file:
            json.dump(applied, file); file.flush()
            restored = self.run_command('--restore', file.name)
        self.assertEqual(restored, {'restored': [self.forklift.pk, self.blank.pk], 'skipped': 1})
        for course, cover in ((self.forklift, 'learning-skills'), (self.blank, ''), (self.other, 'scene-plant-skyline')):
            course.refresh_from_db(); self.assertEqual(course.cover, cover)

    def test_restore_rejects_foreign_files(self):
        import tempfile
        from django.core.management.base import CommandError
        for content in ('not json', '{"changes": [{"id": 1}]}',
                        json.dumps({'changes': [{'id': self.forklift.pk, 'from': 'x', 'to': 'learning-skills'}]})):
            with tempfile.NamedTemporaryFile('w', suffix='.json') as file:
                file.write(content); file.flush()
                with self.assertRaises(CommandError): self.run_command('--restore', file.name)
        self.forklift.refresh_from_db(); self.assertEqual(self.forklift.cover, 'learning-skills')


class SimpleTrainingMigrationTests(TransactionTestCase):
    def test_one_leaf_existing_rows_and_previous_release_inserts(self):
        before = [('training', '0026_exam_course_audience')]
        after = [('training', '0028_system_settings')]
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        self.assertEqual(executor.loader.graph.leaf_nodes('training'), after)
        try:
            executor.migrate(before)
            old = executor.loader.project_state(before).apps
            owner = old.get_model('training', 'User').objects.create(username='migration-organizer')
            CourseOld = old.get_model('training', 'Course'); LinkOld = old.get_model('training', 'CourseAssessment')
            course = CourseOld.objects.create(title='Existing synthetic course', owner_id=owner.pk)
            exam = old.get_model('training', 'Exam').objects.create(title='Synthetic quiz', owner_id=owner.pk)
            link = LinkOld.objects.create(course_id=course.pk, exam_id=exam.pk)
            executor = MigrationExecutor(connection); executor.migrate(after)
            current = executor.loader.project_state(after).apps
            CourseNew = current.get_model('training', 'Course'); LinkNew = current.get_model('training', 'CourseAssessment')
            self.assertFalse(CourseNew.objects.get(pk=course.pk).reminders)
            self.assertEqual(LinkNew.objects.get(pk=link.pk).release, 'immediate')
            rollback_course = CourseOld.objects.create(title='Rollback insertion', owner_id=owner.pk)
            rollback_link = LinkOld.objects.create(course_id=rollback_course.pk, exam_id=exam.pk)
            now = timezone.now()
            session = old.get_model('training', 'CourseSession').objects.create(course_id=rollback_course.pk,
                title='Rollback session', starts_at=now, ends_at=now + timedelta(hours=1))
            self.assertIsNone(current.get_model('training', 'CourseSession').objects.get(pk=session.pk).reminders_seen_at)
            self.assertFalse(CourseNew.objects.get(pk=rollback_course.pk).reminders)
            self.assertEqual(LinkNew.objects.get(pk=rollback_link.pk).release, 'immediate')
            self.assertFalse(current.get_model('training', 'OutboundEmail').objects.exists())
            self.assertFalse(current.get_model('training', 'SystemSettings').objects.exists())
            self.assertIsNone(current.get_model('training', 'User').objects.get(pk=owner.pk).google_subject)
            previous_user = old.get_model('training', 'User').objects.create(username='previous-release-user')
            self.assertIsNone(current.get_model('training', 'User').objects.get(pk=previous_user.pk).google_subject)
        finally:
            MigrationExecutor(connection).migrate(latest)


@override_settings(DEBUG=True)
class RosterConcurrencyTests(TransactionTestCase):
    def test_last_seat_serialized_writers_and_replay(self):
        owner = User.objects.create_user('seat-organizer', role='training_scheduler')
        users = [User.objects.create_user(f'seat{i}', email=f'seat{i}@example.com') for i in range(4)]
        course = Course.objects.create(owner=owner, title='Synthetic last seat', published=True, delivery_mode='scheduled')
        now = timezone.now()
        session = CourseSession.objects.create(course=course, title='Only seat', starts_at=now+timedelta(days=1),
                                                ends_at=now+timedelta(days=1, hours=1), capacity=1)
        def reserve(user):
            try:
                return import_roster(owner, course.pk, {'session': session.pk, 'people': [user.pk]})['counts']
            finally:
                if connection.vendor == 'postgresql': connections.close_all()
        if connection.vendor == 'postgresql':
            with ThreadPoolExecutor(max_workers=4) as pool: results = list(pool.map(reserve, users))
        else:
            # SQLite has no SELECT FOR UPDATE; exercise the same writers sequentially.
            results = [reserve(user) for user in users]
        self.assertEqual(sum(result.get('added', 0) for result in results), 1)
        self.assertEqual(sum(result.get('full', 0) for result in results), 3)
        self.assertEqual(Enrollment.objects.filter(status='approved').count(), 1)

    def test_simultaneous_create_receipt(self):
        if connection.vendor != 'postgresql':
            self.skipTest('PostgreSQL row locks required')
        owner = User.objects.create_user('receipt-organizer', role='training_scheduler')
        now = timezone.now()
        payload = {'request_id': str(uuid.uuid4()), 'title': 'Synthetic receipt training', 'sessions': [
            {'starts_at': (now + timedelta(days=1)).isoformat(), 'ends_at': (now + timedelta(days=1, hours=1)).isoformat(),
             'location': 'Room 12'}]}
        def create(_):
            try:
                client = APIClient(); client.force_authenticate(owner)
                response = client.post('/api/trainings/', payload, format='json')
                self.assertIn(response.status_code, (200, 201))
                return response.data
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool: responses = list(pool.map(create, range(2)))
        self.assertEqual(responses[0], responses[1])
        self.assertEqual(Course.objects.count(), 1)
        self.assertEqual(TrainingRequest.objects.count(), 1)

    def test_simultaneous_scheduler_batches(self):
        if connection.vendor != 'postgresql':
            self.skipTest('PostgreSQL row locks required')
        owner = User.objects.create_user('batch-organizer', role='training_scheduler')
        user = User.objects.create_user('batch-person', email='batch@example.com')
        now = timezone.now()
        course = Course.objects.create(owner=owner, title='Synthetic reminder training', published=True,
                                       delivery_mode='scheduled', reminders=True)
        session = CourseSession.objects.create(course=course, title='Tomorrow', starts_at=now+timedelta(hours=23),
                                               ends_at=now+timedelta(hours=24))
        Enrollment.objects.create(course=course, session=session, user=user, requested_at=now-timedelta(days=1))
        def produce(_):
            try:
                produce_reminders()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(produce, range(2)))
        self.assertEqual(ReminderBatch.objects.count(), 1)
        self.assertEqual(OutboundEmail.objects.count(), 1)
