"""Deletion boundaries and transactional cancellation using synthetic records only."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (AuditEvent, Course, CourseAssessment, CourseSession, Enrollment,
                     Exam, Invitation, InvitationBatch, LearningAssignment, OutboundEmail,
                     ScormPackage, ScormState, User)
from .services import identity_for_user, start_attempt
from .tests import make_exam


@override_settings(DEBUG=True, EMAIL_NOTIFICATIONS_ENABLED=True)
class TrainingLifecycleTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('lifecycle-owner', role='training_scheduler')
        self.other = User.objects.create_user('lifecycle-other', role='training_scheduler')
        self.learner = User.objects.create_user('lifecycle-learner', email='synthetic@example.test')
        self.course = Course.objects.create(owner=self.owner, title='Synthetic course', published=True,
                                            delivery_mode='scheduled', venue='onsite')
        self.session = CourseSession.objects.create(course=self.course, title='Future', location='Room',
            starts_at=timezone.now()+timedelta(days=1), ends_at=timezone.now()+timedelta(days=1, hours=1))
        self.enrollment = Enrollment.objects.create(course=self.course, user=self.learner, session=self.session)
        self.exam = make_exam(self.owner)
        CourseAssessment.objects.create(course=self.course, exam=self.exam)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def delete(self, target, title=None):
        kind = 'courses' if isinstance(target, Course) else 'exams'
        return self.client.delete(f'/api/{kind}/{target.pk}/',
                                 {'confirm_title': target.title if title is None else title}, format='json')

    def cancel(self, sessions=None):
        return self.client.post(f'/api/courses/{self.course.pk}/cancel-training/', {
            'sessions': sessions if sessions is not None else [{'id': self.session.pk, 'revision': self.session.revision}],
        }, format='json')

    def test_only_managers_can_preview_delete_or_cancel(self):
        for user in [self.learner, self.other]:
            self.client.force_authenticate(user)
            for kind, target in [('courses', self.course), ('exams', self.exam)]:
                self.assertEqual(self.client.get(f'/api/{kind}/{target.pk}/deletion-preview/').status_code, 403)
                self.assertEqual(self.delete(target).status_code, 403)
            self.assertEqual(self.cancel().status_code, 403)
        self.assertTrue(Course.objects.filter(pk=self.course.pk).exists())
        self.assertFalse(OutboundEmail.objects.exists())

    def test_exact_title_required_and_current_preview(self):
        for target in [self.course, self.exam]:
            self.assertEqual(self.delete(target, 'wrong title').status_code, 400)
        preview = self.client.get(f'/api/courses/{self.course.pk}/deletion-preview/').data
        self.assertEqual(preview['counts'], {'sessions': 1, 'enrollments': 1, 'assignments': 0})
        self.assertEqual(preview['title'], self.course.title)

    def test_course_delete_cleans_dependencies_but_preserves_exam_results(self):
        attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        LearningAssignment.objects.create(course=self.course, user=self.learner, created_by=self.owner)
        package = ScormPackage.objects.create(course=self.course, version='1', launch_path='index.html')
        ScormState.objects.create(package=package, user=self.learner)
        another = Course.objects.create(owner=self.other, title='Unrelated course')
        CourseAssessment.objects.create(course=another, exam=self.exam)
        queued = OutboundEmail.objects.create(kind='assigned', recipient_user=self.learner,
            to_email=self.learner.email, context={'course_id': self.course.pk})
        self.assertEqual(self.delete(self.course).status_code, 204)
        self.assertFalse(Course.objects.filter(pk=self.course.pk).exists())
        self.assertFalse(Enrollment.objects.exists())
        self.assertFalse(ScormState.objects.exists())
        self.assertFalse(LearningAssignment.objects.exists())
        self.exam.refresh_from_db(); attempt.refresh_from_db(); queued.refresh_from_db()
        self.assertEqual(self.exam.course_id, another.pk)
        self.assertEqual(queued.status, 'cancelled')
        self.assertTrue(AuditEvent.objects.filter(action='course.deleted', target=str(self.course.pk)).exists())

    def test_exam_without_attempts_can_be_deleted_with_invitations_and_assignments(self):
        identity = identity_for_user(self.learner)
        batch = InvitationBatch.objects.create(id=uuid.uuid4(), exam=self.exam, created_by=self.owner, fingerprint='synthetic')
        invitation = Invitation.objects.create(exam=self.exam, batch=batch, identity=identity,
            token_hash='synthetic', expires_at=timezone.now()+timedelta(days=1), created_by=self.owner)
        LearningAssignment.objects.create(exam=self.exam, user=self.learner, created_by=self.owner)
        self.assertEqual(self.delete(self.exam).status_code, 204)
        self.assertFalse(Exam.objects.filter(pk=self.exam.pk).exists())
        self.assertFalse(Invitation.objects.filter(pk=invitation.pk).exists())
        self.assertFalse(InvitationBatch.objects.filter(pk=batch.pk).exists())
        self.course.refresh_from_db(); self.enrollment.refresh_from_db()
        self.assertFalse(self.course.assessment_links.exists())
        self.assertTrue(AuditEvent.objects.filter(action='exam.deleted').exists())

    def test_exam_started_after_preview_is_protected_even_from_admin(self):
        preview = self.client.get(f'/api/exams/{self.exam.pk}/deletion-preview/').data
        self.assertEqual(preview['counts']['attempts'], 0)
        attempt = start_attempt(self.exam.pk, identity_for_user(self.learner))
        admin = User.objects.create_user('lifecycle-admin', role='admin')
        self.client.force_authenticate(admin)
        for status in ['in_progress', 'graded']:
            attempt.status = status; attempt.save()
            response = self.delete(self.exam)
            self.assertEqual(response.status_code, 400)
            self.assertIn('Unpublish', str(response.data))
            self.exam.refresh_from_db(); attempt.refresh_from_db()
        self.assertFalse(AuditEvent.objects.filter(action='exam.deleted').exists())

    def test_delete_rolls_back_when_audit_fails(self):
        with patch('training.lifecycle.audit', side_effect=RuntimeError('synthetic failure')):
            with self.assertRaises(RuntimeError): self.delete(self.course)
        self.course.refresh_from_db(); self.enrollment.refresh_from_db(); self.session.refresh_from_db()

    def test_cancel_unfinished_sessions_keeps_history_and_notifies_once(self):
        past = CourseSession.objects.create(course=self.course, title='Past', location='Room',
            starts_at=timezone.now()-timedelta(days=2), ends_at=timezone.now()-timedelta(days=1))
        response = self.cancel()
        self.assertEqual(response.status_code, 200)
        self.session.refresh_from_db(); past.refresh_from_db(); self.enrollment.refresh_from_db()
        self.assertTrue(self.session.cancelled)
        self.assertFalse(past.cancelled)
        self.assertEqual(self.enrollment.status, 'approved')
        self.assertEqual(OutboundEmail.objects.filter(kind='session_cancelled').count(), 1)
        self.assertEqual(self.cancel().status_code, 409)
        self.assertEqual(OutboundEmail.objects.filter(kind='session_cancelled').count(), 1)
        newcomer = User.objects.create_user('lifecycle-newcomer')
        self.client.force_authenticate(newcomer)
        response = self.client.post(f'/api/courses/{self.course.pk}/enroll/', {'session': self.session.pk}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_cancel_checks_entire_session_snapshot_before_changes(self):
        added = CourseSession.objects.create(course=self.course, title='Added later', location='Room',
            starts_at=timezone.now()+timedelta(days=2), ends_at=timezone.now()+timedelta(days=2, hours=1))
        self.assertEqual(self.cancel().status_code, 409)
        self.assertFalse(self.course.sessions.filter(cancelled=True).exists())
        self.assertFalse(OutboundEmail.objects.exists())
        self.assertEqual(self.cancel([{'id': self.session.pk, 'revision': 9}, {'id': added.pk, 'revision': 0}]).status_code, 409)

    def test_unpublished_training_can_still_cancel_existing_sessions(self):
        self.course.published = False; self.course.save()
        self.assertEqual(self.cancel().status_code, 200)
        self.session.refresh_from_db()
        self.assertTrue(self.session.cancelled)


@override_settings(DEBUG=True, EMAIL_NOTIFICATIONS_ENABLED=True)
class ConcurrentLifecycleTests(TransactionTestCase):
    def test_simultaneous_cancellations_commit_once(self):
        if connection.vendor != 'postgresql':
            self.skipTest('PostgreSQL row locks required')
        from .lifecycle import cancel_training
        from .enrollments import EnrollmentConflict
        owner = User.objects.create_user('cancel-owner', role='training_scheduler')
        learner = User.objects.create_user('cancel-learner', email='synthetic@example.test')
        course = Course.objects.create(owner=owner, title='Concurrent cancellation', published=True, delivery_mode='scheduled')
        start = timezone.now()+timedelta(days=1)
        session = CourseSession.objects.create(course=course, title='Session', starts_at=start, ends_at=start+timedelta(hours=1))
        Enrollment.objects.create(user=learner, course=course, session=session)
        def cancel(_):
            try:
                try:
                    cancel_training(owner, course.pk, {'sessions': [{'id': session.pk, 'revision': 0}]})
                    return True
                except EnrollmentConflict:
                    return False
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(cancel, range(4))), 1)
        session.refresh_from_db()
        self.assertEqual(session.revision, 1)
        self.assertEqual(OutboundEmail.objects.filter(kind='session_cancelled').count(), 1)
