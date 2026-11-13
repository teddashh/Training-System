"""Synthetic contracts for shared assessments, personal learning and image rollback."""
from datetime import timedelta
from io import StringIO
from django.core.management import call_command

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (Attempt, AuditEvent, Course, CourseAssessment, Enrollment, Exam, Identity, Invitation, LearningAssignment,
                     TrainingGroup, TrainingGroupMembership, User)
from .services import finalize, hash_token, identity_for_user, start_attempt
from .tests import make_exam


@override_settings(DEBUG=True)
class CourseAssessmentTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('assessment-owner', role='training_scheduler')
        self.admin = User.objects.create_user('assessment-admin', role='admin')
        self.learner = User.objects.create_user('assessment-learner')
        self.course = Course.objects.create(owner=self.owner, title='Synthetic online course', published=True)
        self.other = Course.objects.create(owner=self.admin, title='Synthetic on-site course', published=True)
        self.exam = make_exam(self.admin)
        self.exam.audience = 'people'
        self.exam.save()
        self.exam.allowed_users.add(self.admin)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def link(self, course=None, attach=True):
        return self.client.post(f'/api/courses/{(course or self.course).pk}/assessments/', {'exam': self.exam.pk, 'attach': attach}, format='json')

    def test_course_audience_serializer_needs_no_members(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/exams/', {'title': 'Course-only draft', 'audience': 'course'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['audience'], 'course')
        self.assertFalse(response.data['published'])
        self.assertFalse(response.data['available_to_me'])
        exam = Exam.objects.get(pk=response.data['id'])
        self.assertFalse(exam.allowed_users.exists())
        self.assertFalse(exam.allowed_groups.exists())
        self.assertEqual(exam.allowed_departments, [])

    def test_course_audience_participation_list_start_and_course_payloads(self):
        self.exam.audience = 'course'
        self.exam.save()
        self.client.force_authenticate(self.learner)
        cases = [
            (None, True, None, True, True, False),
            ('pending', True, None, True, True, False),
            ('approved', False, None, True, True, False),
            ('approved', True, timezone.now() + timedelta(days=1), True, True, False),
            ('approved', True, None, False, True, False),
            ('approved', True, None, True, False, False),
            ('approved', True, None, True, True, True),
        ]
        for status, course_published, release, linked, exam_published, allowed in cases:
            with self.subTest(status=status, published=course_published, release=release, linked=linked, exam_published=exam_published):
                if status:
                    Enrollment.objects.update_or_create(user=self.learner, course=self.course, defaults={'status': status})
                Course.objects.filter(pk=self.course.pk).update(published=course_published, release_at=release)
                Exam.objects.filter(pk=self.exam.pk).update(published=exam_published)
                if linked:
                    self.exam.courses.add(self.course)
                else:
                    self.exam.courses.clear()
                listed = self.client.get('/api/exams/').data
                self.assertEqual([e['id'] for e in listed], [self.exam.pk] if allowed else [])
                self.assertEqual(self.client.post(f'/api/exams/{self.exam.pk}/start/', {}, format='json').status_code, 200 if allowed else 404)
                for course in self.client.get('/api/courses/').data + self.client.get('/api/courses/mine/').data:
                    self.assertEqual([e['id'] for e in course['assessments']], [self.exam.pk] if allowed and course['id'] == self.course.pk else [])
                    self.assertTrue(all(e['available_to_me'] for e in course['assessments']))
                self.client.force_authenticate(self.owner)
                rows = self.client.get(f'/api/courses/{self.course.pk}/assessments/').data['linked']
                if linked:
                    self.assertFalse(rows[0]['available_to_me'])
                self.client.force_authenticate(self.learner)

    def test_course_audience_assignment_and_guest_without_participation(self):
        self.exam.audience = 'course'
        self.exam.save()
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.get('/api/exams/').data, [])
        LearningAssignment.objects.create(user=self.learner, exam=self.exam, created_by=self.admin)
        self.assertTrue(self.client.get('/api/exams/').data[0]['available_to_me'])
        self.assertEqual(self.client.post(f'/api/exams/{self.exam.pk}/start/', {}, format='json').status_code, 200)
        guest = Identity.objects.create(key='course-only-guest@example.test', label='Synthetic guest')
        invitation = Invitation.objects.create(exam=self.exam, identity=guest,
            token_hash=hash_token('synthetic-course-only-token'), created_by=self.admin,
            expires_at=timezone.now() + timedelta(days=1))
        client = APIClient()
        self.assertEqual(client.post('/api/guest/exchange/', {'token': 'synthetic-course-only-token'}, format='json').status_code, 200)
        response = client.post('/api/guest/exam/', {}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Attempt.objects.get(pk=response.data['id']).invitation_id, invitation.pk)

    def test_model_migrations_are_current(self):
        call_command('makemigrations', check=True, dry_run=True, stdout=StringIO(), verbosity=0)

    def test_multiple_links_primary_and_safe_picker(self):
        self.exam.courses.add(self.other)
        response = self.link()
        self.assertEqual(response.status_code, 200)
        row = response.data['linked'][0]
        self.assertEqual(row['other_courses'], 1)
        self.assertFalse(row['can_manage'])
        self.assertEqual(row['question_count'], 1)
        self.assertEqual(AuditEvent.objects.get(action='course.assessment_linked').detail, {'exam': self.exam.pk})
        self.assertEqual(set(row), {'id', 'title', 'published', 'question_count', 'other_courses', 'can_manage', 'starts_at', 'ends_at', 'window_state', 'audience', 'available_to_me', 'release', 'gated'})
        self.exam.refresh_from_db()
        self.assertEqual(self.exam.course_id, self.other.pk)
        self.exam.course = None
        self.exam.save(update_fields=['title'])
        self.exam.refresh_from_db()
        self.assertEqual(self.exam.course_id, self.other.pk)
        self.assertEqual(self.link(attach=False).status_code, 200)
        self.assertEqual(list(self.exam.courses.values_list('pk', flat=True)), [self.other.pk])
        self.link()
        self.other.delete()
        self.exam.refresh_from_db()
        self.assertEqual(self.exam.course_id, self.course.pk)
        self.link(attach=False)
        self.exam.refresh_from_db()
        self.assertIsNone(self.exam.course_id)

    def test_serializer_preserves_inaccessible_links_and_legacy_never_removes(self):
        self.exam.owner = self.owner
        self.exam.save()
        self.exam.courses.add(self.other, self.course)
        url = f'/api/exams/{self.exam.pk}/'
        response = self.client.patch(url, {'courses': []}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['courses'], [self.other.pk])
        self.assertFalse(response.data['available_to_me'])
        self.assertFalse(response.data['course_links'][0]['can_remove'])
        response = self.client.patch(url, {'course': self.course.pk}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['courses'], [self.other.pk, self.course.pk])
        response = self.client.patch(url, {'course': None}, format='json')
        self.assertEqual(response.data['courses'], [self.other.pk, self.course.pk])
        restricted = Course.objects.create(owner=self.admin, title='Restricted')
        self.assertEqual(self.client.patch(url, {'courses': [restricted.pk]}, format='json').status_code, 400)
        self.client.force_authenticate(self.admin)
        response = self.client.patch(url, {'courses': [self.course.pk]}, format='json')
        self.assertEqual(response.data['courses'], [self.course.pk])

    def test_legacy_course_save_preserves_existing_link_without_link_permission(self):
        self.exam.owner = self.owner
        self.exam.save()
        self.exam.courses.add(self.other)
        self.exam.courses.add(self.course)
        url = f'/api/exams/{self.exam.pk}/'
        before = list(self.exam.assessment_links.values_list('id', 'course_id', 'created_at'))
        response = self.client.patch(url, {'title': 'Cached bundle save', 'course': self.other.pk}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['title'], 'Cached bundle save')
        self.assertEqual(response.data['courses'], [self.other.pk, self.course.pk])
        self.assertEqual(list(self.exam.assessment_links.values_list('id', 'course_id', 'created_at')), before)
        restricted = Course.objects.create(owner=self.admin, title='New forbidden link')
        self.assertEqual(self.client.patch(url, {'course': restricted.pk}, format='json').status_code, 400)
        self.assertEqual(list(self.exam.assessment_links.values_list('id', 'course_id', 'created_at')), before)

    def test_invitation_only_rejects_participation_but_allows_assignment_and_guest(self):
        self.exam.audience = 'invitation'
        self.exam.save()
        self.exam.courses.add(self.course)
        self.client.force_authenticate(self.learner)
        for status in (None, 'pending', 'approved'):
            with self.subTest(enrollment=status):
                if status:
                    Enrollment.objects.update_or_create(user=self.learner, course=self.course, defaults={'status': status})
                self.assertEqual(self.client.get('/api/exams/').data, [])
                self.assertEqual(self.client.post(f'/api/exams/{self.exam.pk}/start/', {}, format='json').status_code, 404)
                self.assertEqual(self.client.get(f'/api/courses/{self.course.pk}/').data['assessments'], [])
                for course in self.client.get('/api/courses/').data + self.client.get('/api/courses/mine/').data:
                    self.assertEqual(course['assessments'], [])
        # Course managers retain metadata, without receiving learner eligibility.
        Enrollment.objects.create(user=self.owner, course=self.course, status='approved')
        self.client.force_authenticate(self.owner)
        for endpoint in ('/api/courses/', '/api/courses/mine/'):
            row = next(c for c in self.client.get(endpoint).data if c['id'] == self.course.pk)
            self.assertFalse(row['assessments'][0]['available_to_me'])
            self.assertEqual(row['assessments'][0]['audience'], 'invitation')
        row = self.client.get(f'/api/courses/{self.course.pk}/assessments/').data['linked'][0]
        self.assertFalse(row['available_to_me'])
        self.assertEqual(row['audience'], 'invitation')
        self.client.force_authenticate(self.learner)
        assignment = LearningAssignment.objects.create(user=self.learner, exam=self.exam, created_by=self.admin)
        self.assertTrue(self.client.get('/api/exams/').data[0]['available_to_me'])
        self.assertTrue(self.client.get(f'/api/courses/{self.course.pk}/').data['assessments'][0]['available_to_me'])
        self.assertEqual(self.client.post(f'/api/exams/{self.exam.pk}/start/', {}, format='json').status_code, 200)
        assignment.cancelled_at = timezone.now()
        assignment.save()
        self.assertEqual(self.client.get('/api/exams/').data, [])
        guest = Identity.objects.create(key='synthetic-course-guest@example.test', label='Synthetic guest')
        invitation = Invitation.objects.create(exam=self.exam, identity=guest,
            token_hash=hash_token('synthetic-course-invitation'), created_by=self.admin,
            expires_at=timezone.now() + timedelta(days=1))
        client = APIClient()
        self.assertEqual(client.post('/api/guest/exchange/', {'token': 'synthetic-course-invitation'}, format='json').status_code, 200)
        response = client.post('/api/guest/exam/', {}, format='json')
        self.assertEqual(response.status_code, 200)
        attempt = Attempt.objects.get(pk=response.data['id'])
        self.assertEqual(attempt.invitation_id, invitation.pk)
        self.assertEqual(attempt.identity_id, guest.pk)

    def test_invitation_only_picker_attach_and_detach_permissions(self):
        self.exam.audience = 'invitation'
        self.exam.save()
        self.exam.courses.add(self.other)
        for role in ('course_creator', 'training_scheduler'):
            with self.subTest(role=role):
                self.owner.role = role
                self.owner.save()
                options = self.client.get(f'/api/courses/{self.course.pk}/assessments/').data
                self.assertEqual(options['available'], [])
                response = self.link()
                self.assertEqual(response.status_code, 400)
                self.assertEqual(str(response.data[0]), 'Only the exam owner or an exam administrator can attach an invitation-only quiz.')
                self.assertFalse(CourseAssessment.objects.filter(course=self.course, exam=self.exam).exists())
                self.assertFalse(AuditEvent.objects.filter(action='course.assessment_linked').exists())
                # Existing links remain visible and detachable by course managers.
                self.exam.courses.add(self.course)
                self.assertEqual(self.client.get(f'/api/courses/{self.course.pk}/assessments/').data['linked'][0]['audience'], 'invitation')
                self.assertEqual(self.link(attach=False).status_code, 200)
                self.assertEqual(list(self.exam.courses.values_list('pk', flat=True)), [self.other.pk])

    def test_exam_managers_can_attach_invitation_only_quiz(self):
        self.exam.audience = 'invitation'
        self.exam.owner = self.owner
        self.exam.save()
        for role in ('training_scheduler', 'training_admin', 'admin'):
            with self.subTest(role=role):
                self.owner.role = role
                self.owner.save()
                options = self.client.get(f'/api/courses/{self.course.pk}/assessments/').data
                self.assertEqual(options['available'][0]['audience'], 'invitation')
                self.assertTrue(options['available'][0]['can_manage'])
                self.assertEqual(self.link().status_code, 200)
                self.assertEqual(self.link(attach=False).status_code, 200)

    def test_create_with_many_courses_and_legacy(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/exams/', {'title': 'Shared draft', 'courses': [self.other.pk], 'course': self.course.pk}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['courses'], [self.other.pk, self.course.pk])
        self.assertEqual(Exam.objects.get(pk=response.data['id']).course_id, self.other.pk)

    def test_course_manager_sees_draft_but_learner_never_does(self):
        self.exam.published = False
        self.exam.save()
        self.link()
        Enrollment.objects.create(user=self.learner, course=self.course, status='approved')
        response = self.client.get(f'/api/courses/{self.course.pk}/')
        self.assertEqual(len(response.data['assessments']), 1)
        self.assertFalse(response.data['assessments'][0]['can_manage'])
        self.assertNotIn('questions', response.data['assessments'][0])
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.get(f'/api/courses/{self.course.pk}/').data['assessments'], [])
        self.assertEqual(self.client.get(f'/api/courses/{self.course.pk}/assessments/').status_code, 403)

    def test_participant_list_and_start_matrix(self):
        self.exam.courses.add(self.course)
        self.client.force_authenticate(self.learner)
        now = timezone.now()
        cases = [
            ('approved', True, None, True, None, None, True, True),
            ('pending', True, None, True, None, None, False, False),
            ('cancelled', True, None, True, None, None, False, False),
            ('rejected', True, None, True, None, None, False, False),
            ('removed', True, None, True, None, None, False, False),
            ('waitlisted', True, None, True, None, None, False, False),
            ('approved', False, None, True, None, None, False, False),
            ('approved', True, now + timedelta(days=1), True, None, None, False, False),
            ('approved', True, None, False, None, None, False, False),
            ('approved', True, None, True, now + timedelta(days=1), None, True, False),
            ('approved', True, None, True, None, now - timedelta(days=1), True, False),
        ]
        for status, published, release, exam_published, start, end, visible, allowed in cases:
            with self.subTest(status=status, published=published, release=release, exam_published=exam_published, start=start, end=end):
                Enrollment.objects.update_or_create(user=self.learner, course=self.course, defaults={'status': status})
                Course.objects.filter(pk=self.course.pk).update(published=published, release_at=release)
                Exam.objects.filter(pk=self.exam.pk).update(published=exam_published, starts_at=start, ends_at=end)
                response = self.client.get('/api/exams/')
                self.assertEqual(bool(response.data), visible)
                if visible:
                    self.assertTrue(response.data[0]['available_to_me'])
                    self.assertEqual(response.data[0]['courses'], [self.course.pk])
                response = self.client.post(f'/api/exams/{self.exam.pk}/start/', {}, format='json')
                self.assertEqual(response.status_code == 200, allowed)
                if allowed:
                    finalize(Attempt.objects.get(pk=response.data['id']))

    def test_course_participation_overrides_each_audience(self):
        self.exam.courses.add(self.course)
        Enrollment.objects.create(user=self.learner, course=self.course, status='approved')
        self.client.force_authenticate(self.learner)
        for audience in ('all', 'people', 'groups', 'departments', 'contractors', 'employees'):
            Exam.objects.filter(pk=self.exam.pk).update(audience=audience)
            with self.subTest(audience=audience):
                self.assertTrue(self.client.get('/api/exams/').data[0]['available_to_me'])
                self.assertEqual(self.client.post(f'/api/exams/{self.exam.pk}/start/', {}, format='json').status_code, 200)

    def test_revoked_participation_hides_new_admission_but_keeps_owned_attempt(self):
        self.exam.courses.add(self.course)
        row = Enrollment.objects.create(user=self.learner, course=self.course, status='approved')
        attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        row.status = 'cancelled'; row.save()
        self.client.force_authenticate(self.learner)
        self.assertIn(self.client.post(f'/api/exams/{self.exam.pk}/start/', {}, format='json').status_code, (403, 404))
        self.assertEqual(start_attempt(self.exam.pk, identity_for_user(self.learner)).pk, attempt.pk)
        self.assertEqual(self.client.get(f'/api/attempts/{attempt.pk}/').status_code, 200)
        # Historical results are owned records and remain accessible after admission changes.
        finalize(attempt)
        self.assertEqual(self.client.get(f'/api/attempts/{attempt.pk}/').status_code, 200)

    def test_personal_training_includes_assignments_and_progress(self):
        Enrollment.objects.create(user=self.learner, course=self.course, status='pending')
        LearningAssignment.objects.create(user=self.learner, course=self.other, created_by=self.admin)
        rejected = Course.objects.create(owner=self.admin, title='Rejected')
        Enrollment.objects.create(user=self.learner, course=rejected, status='rejected')
        progressed = Course.objects.create(owner=self.admin, title='Historical progress', published=True)
        Enrollment.objects.create(user=self.learner, course=progressed, status='cancelled', progress=30)
        self.client.force_authenticate(self.learner)
        self.assertEqual({c['id'] for c in self.client.get('/api/courses/mine/').data}, {self.course.pk, self.other.pk, progressed.pk})

    def test_unpublished_training_hides_from_mine_without_removing_history(self):
        for user in (self.learner, self.owner, self.admin):
            row = Enrollment.objects.create(user=user, course=self.course, status='approved', progress=100,
                                            completed_at=timezone.now())
            assignment = LearningAssignment.objects.create(user=user, course=self.course, created_by=self.admin)
            self.client.force_authenticate(user)
            self.assertIn(self.course.pk, {c['id'] for c in self.client.get('/api/courses/mine/').data})
            Course.objects.filter(pk=self.course.pk).update(published=False)
            self.assertNotIn(self.course.pk, {c['id'] for c in self.client.get('/api/courses/mine/').data})
            row.refresh_from_db(); assignment.refresh_from_db()
            self.assertEqual(row.progress, 100)
            self.assertIsNotNone(row.completed_at)
            self.assertIsNone(assignment.cancelled_at)
            Course.objects.filter(pk=self.course.pk).update(published=True)
            returned = next(c for c in self.client.get('/api/courses/mine/').data if c['id'] == self.course.pk)
            self.assertEqual(returned['progress'], 100)

    def test_manager_personal_eligibility_is_independent_of_exam_scope(self):
        self.exam.courses.add(self.course)
        Enrollment.objects.create(user=self.owner, course=self.course, status='approved')
        rows = self.client.get('/api/exams/').data
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]['available_to_me'])
        self.assertFalse(rows[0]['can_manage'])
        self.client.force_authenticate(self.admin)
        self.exam.allowed_users.clear()
        self.assertFalse(self.client.get('/api/exams/').data[0]['available_to_me'])
        LearningAssignment.objects.create(user=self.admin, exam=self.exam, created_by=self.admin)
        self.assertTrue(self.client.get('/api/exams/').data[0]['available_to_me'])

    def test_personal_score_waits_for_grading_and_respects_review_policy(self):
        exam = make_exam(self.admin, essay=True)
        exam.allow_response_review = False
        exam.save()
        attempt = start_attempt(exam.pk, identity_for_user(self.learner))
        finalize(attempt)
        self.client.force_authenticate(self.learner)
        row = self.client.get(f'/api/exams/{exam.pk}/').data
        self.assertEqual(row['last_result']['status'], 'pending_review')
        self.assertIsNone(row['last_result']['score'])
        self.assertIsNone(row['last_result']['passed'])
        Attempt.objects.filter(pk=attempt.pk).update(status='graded', score=80, passed=True)
        row = self.client.get(f'/api/exams/{exam.pk}/').data
        self.assertEqual(row['last_result']['score'], 80)
        self.assertTrue(row['last_result']['passed'])
        result = self.client.get(f'/api/attempts/{attempt.pk}/').data
        self.assertFalse(result['review_available'])
        self.assertEqual(result['questions'], [])

    def test_expired_attempt_offers_result_without_charging_another_start(self):
        exam = make_exam(self.admin)
        attempt = start_attempt(exam.pk, identity_for_user(self.learner))
        Attempt.objects.filter(pk=attempt.pk).update(deadline=timezone.now() - timedelta(seconds=1))
        self.client.force_authenticate(self.learner)
        summary = self.client.get(f'/api/exams/{exam.pk}/').data
        self.assertIsNone(summary['active_attempt_id'])
        self.assertEqual(summary['last_result']['id'], str(attempt.pk))
        self.assertIsNone(summary['last_result']['score'])
        response = self.client.get(f'/api/attempts/{attempt.pk}/')
        self.assertEqual(response.data['status'], 'graded')
        self.assertEqual(exam.attempt_set.count(), 1)

    def test_exam_list_query_bound_including_rounds_and_audiences(self):
        group = TrainingGroup.objects.create(name='Synthetic participants', created_by=self.admin)
        TrainingGroupMembership.objects.create(group=group, user=self.learner, added_by=self.admin)
        Enrollment.objects.create(user=self.learner, course=self.course, status='approved')
        def add_exam(index):
            exam = make_exam(self.admin, limit=1)
            exam.audience = ['groups', 'people', 'departments'][index % 3]
            exam.attempt_reset_minutes = 1
            exam.save()
            exam.allowed_groups.add(group)
            exam.allowed_users.add(self.learner)
            exam.courses.add(self.course)
            LearningAssignment.objects.create(user=self.learner, exam=exam, created_by=self.admin)
            finalize(start_attempt(exam.pk, identity_for_user(self.learner)))
        add_exam(0)
        self.client.force_authenticate(self.learner)
        with CaptureQueriesContext(connection) as small:
            self.assertEqual(self.client.get('/api/exams/').status_code, 200)
        self.client.force_authenticate(self.admin)
        with CaptureQueriesContext(connection) as manager_small:
            self.assertEqual(self.client.get('/api/exams/').status_code, 200)
        self.client.force_authenticate(self.learner)
        for index in range(12):
            add_exam(index)
        with CaptureQueriesContext(connection) as large:
            response = self.client.get('/api/exams/')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.data), 13)
        self.assertEqual(len(small), len(large))
        self.assertLessEqual(len(large), 12)
        self.assertTrue(all('questions' not in row and 'allowed_users' not in row for row in response.data))
        self.client.force_authenticate(self.admin)
        with CaptureQueriesContext(connection) as manager_large:
            self.assertEqual(self.client.get('/api/exams/').status_code, 200)
        self.assertEqual(len(manager_small), len(manager_large))
        self.assertLessEqual(len(manager_large), 16)


class AssessmentMigrationTests(TransactionTestCase):
    def test_forward_and_reverse_preserve_primary_fk(self):
        before = [('training', '0024_course_registration_key')]
        after = [('training', '0025_course_assessments')]
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        try:
            executor.migrate(before)
            old = executor.loader.project_state(before).apps
            user = old.get_model('training', 'User').objects.create(username='migration-owner')
            course = old.get_model('training', 'Course').objects.create(title='Legacy course', owner_id=user.pk)
            exam = old.get_model('training', 'Exam').objects.create(title='Legacy exam', owner_id=user.pk, course_id=course.pk)
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            current = executor.loader.project_state(after).apps
            Link = current.get_model('training', 'CourseAssessment')
            self.assertEqual(list(Link.objects.values_list('exam_id', 'course_id')), [(exam.pk, course.pk)])
            extra = current.get_model('training', 'Course').objects.create(title='Second course', owner_id=user.pk)
            Link.objects.create(exam_id=exam.pk, course_id=extra.pk)
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            self.assertNotIn('training_courseassessment', connection.introspection.table_names())
            self.assertEqual(old.get_model('training', 'Exam').objects.get(pk=exam.pk).course_id, course.pk)
        finally:
            MigrationExecutor(connection).migrate(latest)
