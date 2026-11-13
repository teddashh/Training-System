from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APIClient

from .attempt_rounds import round_status
from .course_sessions import save_session
from .enrollments import can_learn, enroll
from .models import Attempt, AttemptBudget, Course, CourseSession, Enrollment, Invitation, ScormPackage, User
from .services import apply_manual_grades, finalize, hash_token, identity_for_user, start_attempt
from .tests import make_exam


@override_settings(DEBUG=True)
class AttemptRoundTests(TestCase):
    def setUp(self):
        self.owner=User.objects.create_user('round-owner',role='instructor')
        self.user=User.objects.create_user('round-learner')
        self.identity=identity_for_user(self.user)
        self.exam=make_exam(self.owner,limit=2)
        self.exam.attempt_reset_minutes=60;self.exam.save()
        self.client=APIClient();self.client.force_authenticate(self.user)

    def finish(self, invitation=None):
        attempt=start_attempt(self.exam.pk,self.identity,invitation)
        finalize(attempt)
        return attempt

    def test_failed_round_renews_at_boundary_without_erasing_history(self):
        first=self.finish();second=self.finish()
        budget=AttemptBudget.objects.get()
        when=second.graded_at+timedelta(minutes=60)
        with patch('django.utils.timezone.now',return_value=when-timedelta(microseconds=1)):
            with self.assertRaises(PermissionDenied):start_attempt(self.exam.pk,self.identity)
            data=self.client.get(f'/api/exams/{self.exam.pk}/').data
            self.assertEqual(data['attempts_remaining'],0)
            self.assertEqual(data['round_number'],1)
        with patch('django.utils.timezone.now',return_value=when):
            data=self.client.get(f'/api/exams/{self.exam.pk}/').data
            self.assertEqual(data['attempts_remaining'],2)
            self.assertEqual(data['round_attempts_used'],0)
            self.assertEqual(data['round_number'],2)
            budget.refresh_from_db();self.assertEqual(budget.used,2)
            third=start_attempt(self.exam.pk,self.identity)
            self.assertEqual(third.number,3)
            self.assertEqual(start_attempt(self.exam.pk,self.identity).pk,third.pk)
            finalize(third);fourth=self.finish()
        budget.refresh_from_db();self.assertEqual((budget.used,budget.round_start_used,budget.round_number),(4,2,2))
        with patch('django.utils.timezone.now',return_value=fourth.graded_at+timedelta(minutes=60)):
            self.assertEqual(start_attempt(self.exam.pk,self.identity).number,5)
        first.refresh_from_db();self.assertFalse(first.passed)
        self.assertEqual(list(Attempt.objects.order_by('number').values_list('number',flat=True)),[1,2,3,4,5])

    def test_course_assessment_keeps_failed_round_retry_information(self):
        course=Course.objects.create(owner=self.owner,title='Retry details',published=True)
        self.exam.courses.add(course)
        Enrollment.objects.create(user=self.user,course=course)
        self.finish();last=self.finish()
        row=self.client.get(f'/api/courses/{course.pk}/').data['assessments'][0]
        self.assertEqual(row['attempts_remaining'],0)
        self.assertEqual(row['attempts_used'],2)
        self.assertEqual(row['next_round_at'],(last.graded_at+timedelta(minutes=60)).isoformat())
        self.assertEqual(row['next_attempt_at'],row['next_round_at'])
        self.assertFalse(row['round_awaiting_grading'])
        self.assertTrue(row['server_time'])

    def test_passed_or_pending_results_do_not_renew(self):
        self.finish();second=self.finish()
        Attempt.objects.filter(pk=second.pk).update(passed=True,score=100)
        with patch('django.utils.timezone.now',return_value=timezone.now()+timedelta(days=2)):
            with self.assertRaises(PermissionDenied):start_attempt(self.exam.pk,self.identity)
        Attempt.objects.filter(pk=second.pk).update(passed=None,status='pending_review',graded_at=None)
        state=round_status(self.exam,AttemptBudget.objects.get())
        self.assertTrue(state['round_awaiting_grading']);self.assertIsNone(state['next_round_at'])
        second.refresh_from_db()
        graded=timezone.now()+timedelta(days=3)
        with patch('django.utils.timezone.now',return_value=graded):apply_manual_grades(second,{})
        self.assertEqual(round_status(self.exam,AttemptBudget.objects.get())['next_round_at'],graded+timedelta(minutes=60))

    def test_disabled_policy_and_per_start_wait_remain_enforced(self):
        self.finish();last=self.finish()
        self.exam.attempt_reset_minutes=0;self.exam.save()
        with patch('django.utils.timezone.now',return_value=timezone.now()+timedelta(days=3)):
            with self.assertRaises(PermissionDenied):start_attempt(self.exam.pk,self.identity)
        self.exam.attempt_reset_minutes=60;self.exam.retry_interval_minutes=180;self.exam.save()
        with patch('django.utils.timezone.now',return_value=last.graded_at+timedelta(minutes=61)):
            with self.assertRaises(PermissionDenied) as failure:start_attempt(self.exam.pk,self.identity)
            self.assertEqual(failure.exception.detail['code'],'retry_wait')
            self.assertEqual(self.client.get(f'/api/exams/{self.exam.pk}/').data['next_attempt_at'],(last.started_at+timedelta(minutes=180)).isoformat())

    def test_invitation_limit_does_not_renew_with_account_round(self):
        invitation=Invitation.objects.create(exam=self.exam,identity=self.identity,created_by=self.owner,token_hash=hash_token('round-test'),max_attempts=3,expires_at=timezone.now()+timedelta(days=3))
        self.finish(invitation);last=self.finish(invitation)
        with patch('django.utils.timezone.now',return_value=last.graded_at+timedelta(minutes=61)):
            self.client.force_authenticate(self.owner)
            available=self.client.get('/api/invitations/',{'status':'active','exam':self.exam.pk})
            self.assertEqual(available.status_code,200)
            self.assertEqual(available.data[0]['remaining_new_attempts'],1)
            self.finish(invitation)
            with self.assertRaises(PermissionDenied):start_attempt(self.exam.pk,self.identity,invitation)
            self.assertEqual(start_attempt(self.exam.pk,self.identity).number,4)
        invitation.refresh_from_db();self.assertEqual(invitation.used,3)

    def test_validation_and_authorization(self):
        url=f'/api/exams/{self.exam.pk}/'
        self.assertEqual(self.client.patch(url,{'attempt_reset_minutes':10},format='json').status_code,403)
        self.client.force_authenticate(self.owner)
        for bad in (-1,525601,True,1.2,None):
            self.assertEqual(self.client.patch(url,{'attempt_reset_minutes':bad},format='json').status_code,400)
        self.assertEqual(self.client.patch(url,{'attempt_reset_minutes':1440},format='json').data['attempt_reset_minutes'],1440)


@override_settings(DEBUG=True)
class CourseSessionTests(TestCase):
    def setUp(self):
        self.owner=User.objects.create_user('session-owner',role='instructor')
        self.user=User.objects.create_user('session-learner')
        self.other=User.objects.create_user('second-learner')
        self.course=Course.objects.create(owner=self.owner,title='Scheduled training',published=True,delivery_mode='scheduled',blocks=[{'type':'text','text':'Scheduled lesson'}])
        self.start=timezone.now()+timedelta(days=1)
        self.session=CourseSession.objects.create(course=self.course,title='Morning',starts_at=self.start,ends_at=self.start+timedelta(hours=1),capacity=1)
        self.root=f'/api/courses/{self.course.pk}/'
        self.client=APIClient();self.client.force_authenticate(self.user)
        self.manager=APIClient();self.manager.force_authenticate(self.owner)

    def request(self,**extra):
        return self.client.post(self.root+'enroll/',{'session':self.session.pk,**extra},format='json')

    def test_library_draft_cannot_schedule_or_accept_registrations(self):
        self.course.published=False; self.course.save()
        response=self.manager.post(self.root+'sessions/',{'title':'New session','starts_at':self.start.isoformat(),'ends_at':(self.start+timedelta(hours=1)).isoformat(),'capacity':10},format='json')
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.request().status_code,404)
        self.assertEqual(CourseSession.objects.filter(course=self.course).count(),1)
        self.assertFalse(Enrollment.objects.filter(course=self.course).exists())

    def test_release_registration_learning_and_end_boundaries(self):
        self.course.release_at=timezone.now()+timedelta(hours=1);self.course.save()
        self.assertEqual(self.client.get(self.root).status_code,404)
        self.assertEqual(self.client.get('/api/courses/').data,[])
        self.assertEqual(self.request().status_code,404)
        with patch('django.utils.timezone.now',return_value=self.course.release_at):
            data=self.client.get(self.root).data
            self.assertEqual(data['blocks'],[]);self.assertFalse(data['can_learn'])
            self.assertEqual(data['sessions'][0]['state'],'open')
            self.assertEqual(self.request().status_code,200)
        with patch('django.utils.timezone.now',return_value=self.course.release_at):
            self.assertEqual(self.client.post(self.root+'complete/').status_code,403)
        with patch('django.utils.timezone.now',return_value=self.start):
            self.assertTrue(self.client.get(self.root).data['can_learn'])
            self.assertEqual(self.client.post(self.root+'complete/').status_code,200)
        with patch('django.utils.timezone.now',return_value=self.session.ends_at):
            self.assertFalse(self.client.get(self.root).data['can_learn'])
            self.assertEqual(self.client.post(self.root+'complete/').status_code,403)
        self.assertEqual(Enrollment.objects.get(user=self.user).progress,100)

    def test_capacity_idempotency_cancellation_and_rebooking(self):
        first=self.request();self.assertEqual(first.status_code,200)
        self.assertEqual(self.request().data['revision'],first.data['revision'])
        self.client.force_authenticate(self.other);self.assertEqual(self.request().status_code,400)
        self.client.force_authenticate(self.user)
        cancellation=self.client.post(self.root+'cancel-registration/',{'revision':first.data['revision']},format='json')
        self.assertEqual(cancellation.status_code,200)
        self.assertEqual(self.client.get(self.root).data['sessions'][0]['remaining'],1)
        self.client.force_authenticate(self.other);self.assertEqual(self.request().status_code,200)
        self.client.force_authenticate(self.user)
        later=CourseSession.objects.create(course=self.course,title='Afternoon',starts_at=self.start+timedelta(hours=3),ends_at=self.start+timedelta(hours=4),capacity=1)
        self.assertEqual(self.request(session=later.pk,revision=cancellation.data['revision']).status_code,200)
        self.assertEqual(Enrollment.objects.filter(user=self.user).count(),1)
        self.assertEqual(Enrollment.objects.get(user=self.user).session_id,later.pk)

    def test_pending_requests_reserve_seats_and_reviews_cannot_overbook(self):
        self.course.requires_approval=True;self.course.save()
        row=self.request().data;self.assertEqual(row['status'],'pending')
        self.client.force_authenticate(self.other);self.assertEqual(self.request().status_code,400)
        url=self.root+f"enrollments/{row['id']}/review/"
        rejected=self.manager.post(url,{'decision':'rejected','revision':row['revision'],'note':'Try a later session'},format='json')
        self.assertEqual(rejected.status_code,200)
        self.assertEqual(self.request().status_code,200)
        result=self.manager.post(url,{'decision':'approved','revision':rejected.data['revision'],'note':''},format='json')
        self.assertEqual(result.status_code,400)
        self.assertEqual(self.client.get(self.root).data['sessions'][0]['remaining'],0)

    def test_session_validation_ownership_capacity_and_stale_edits(self):
        data={'title':'Next','starts_at':self.start.isoformat(),'ends_at':self.session.ends_at.isoformat(),'capacity':0}
        self.assertEqual(self.manager.post(self.root+'sessions/',data,format='json').status_code,400)
        data['capacity']=10
        self.assertEqual(self.client.post(self.root+'sessions/',data,format='json').status_code,403)
        self.assertEqual(self.manager.post(self.root+'sessions/',data,format='json').status_code,201)
        bad={**data,'registration_closes_at':(self.start+timedelta(minutes=1)).isoformat()}
        self.assertEqual(self.manager.post(self.root+'sessions/',bad,format='json').status_code,400)
        url=self.root+f'sessions/{self.session.pk}/'
        self.assertEqual(self.manager.patch(url,{'capacity':2,'revision':0},format='json').status_code,200)
        self.assertEqual(self.manager.patch(url,{'capacity':3,'revision':0},format='json').status_code,409)
        self.request();self.client.force_authenticate(self.other);self.request()
        self.assertEqual(self.manager.patch(url,{'capacity':1,'revision':1},format='json').status_code,400)
        self.assertEqual(self.manager.get(self.root+'enrollments/',{'status':'all','session':self.session.pk}).data['count'],2)

    def test_cancelled_session_blocks_learning_and_removed_enrollment_cannot_reapply(self):
        row=self.request().data
        self.session.cancelled=True;self.session.save()
        with patch('django.utils.timezone.now',return_value=self.start):self.assertFalse(can_learn(self.user,self.course))
        Enrollment.objects.filter(pk=row['id']).update(status='removed')
        self.assertEqual(self.request().status_code,403)

    def test_scorm_end_flush_grace_does_not_grant_content_access(self):
        self.request()
        package=ScormPackage.objects.create(course=self.course,title='Scheduled SCORM',version='2004',launch_path='index.html')
        with patch('django.utils.timezone.now',return_value=self.start):
            launched=self.client.post(f'/api/scorm/{package.pk}/launch/',{},format='json').data
        with patch('django.utils.timezone.now',return_value=self.session.ends_at+timedelta(seconds=30)):
            self.assertEqual(self.client.post(f'/api/scorm/{package.pk}/launch/',{},format='json').status_code,403)
            saved=self.client.post(f'/api/scorm/{package.pk}/commit/',{'nonce':launched['nonce'],'cmi':{'cmi.progress_measure':'.4'}},format='json')
            self.assertEqual(saved.status_code,200)
            Enrollment.objects.filter(user=self.user).update(status='removed')
            self.assertEqual(self.client.post(f'/api/scorm/{package.pk}/commit/',{'nonce':launched['nonce'],'cmi':{}},format='json').status_code,403)


@override_settings(DEBUG=True)
class ConcurrentRoundSessionTests(TransactionTestCase):
    def test_last_seat_has_one_winner(self):
        if connection.vendor!='postgresql':self.skipTest('PostgreSQL row locks required')
        owner=User.objects.create_user('seat-owner',role='admin')
        users=[User.objects.create_user(f'seat-{i}') for i in range(4)]
        course=Course.objects.create(title='Last seat',owner=owner,published=True,delivery_mode='scheduled')
        start=timezone.now()+timedelta(days=1)
        session=CourseSession.objects.create(course=course,title='Only seat',starts_at=start,ends_at=start+timedelta(hours=1),capacity=1)
        def reserve(user):
            try:
                try:enroll(user,course.pk,{'session':session.pk});return True
                except ValidationError:return False
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=4) as pool:self.assertEqual(sum(pool.map(reserve,users)),1)
        self.assertEqual(Enrollment.objects.filter(status='approved').count(),1)

    def test_simultaneous_round_renewal_creates_one_attempt(self):
        if connection.vendor!='postgresql':self.skipTest('PostgreSQL row locks required')
        owner=User.objects.create_user('renew-owner',role='admin');identity=identity_for_user(owner)
        exam=make_exam(owner,limit=2);exam.attempt_reset_minutes=1;exam.save()
        for _ in range(2):finalize(start_attempt(exam.pk,identity))
        Attempt.objects.update(graded_at=timezone.now()-timedelta(minutes=2))
        def start(_):
            try:return str(start_attempt(exam.pk,identity).pk)
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(start,range(4)))
        self.assertEqual(len(set(results)),1)
        budget=AttemptBudget.objects.get();self.assertEqual((budget.used,budget.round_number,budget.round_start_used),(3,2,2))
