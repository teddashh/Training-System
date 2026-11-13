from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Attempt, AuditEvent, Course, Enrollment, Exam, User
from .services import identity_for_user


@override_settings(DEBUG=True)
class AdministrationTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user('manager', role='admin', is_staff=True)
        self.instructor = User.objects.create_user('teacher', role='instructor')
        self.learner = User.objects.create_user('learner', display_name='Taylor')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_management_data_is_admin_only(self):
        for user in (None, self.learner, self.instructor):
            self.client.force_authenticate(user)
            for path in ('/api/administration/', '/api/audit/'):
                with self.subTest(user=user, path=path):
                    self.assertEqual(self.client.get(path).status_code, 403)

    def test_overview_counts_the_same_records_as_learning_and_review(self):
        course = Course.objects.create(title='Published course', owner=self.instructor, published=True)
        draft = Course.objects.create(title='Draft course', owner=self.instructor)
        exam = Exam.objects.create(title='Published exam', owner=self.instructor, published=True)
        exam_draft = Exam.objects.create(title='Draft exam', owner=self.instructor)
        Enrollment.objects.create(course=course, user=self.learner, status='pending')
        Enrollment.objects.create(course=course, user=self.admin, status='approved')
        Attempt.objects.create(exam=exam, identity=identity_for_user(self.learner), number=1,
                               status='pending_review', pass_score=70, deadline=timezone.now())
        data = self.client.get('/api/administration/').data
        self.assertEqual(data['courses'], {'total': 2, 'published': 1})
        self.assertEqual(data['exams'], {'total': 2, 'published': 1})
        self.assertEqual(data['people'], {'total': 3, 'active': 3})
        self.assertEqual((data['pending_enrollments'], data['pending_reviews']), (1, 1))
        self.assertEqual(data['enrollment_requests'], [{'course_id': course.pk, 'course__title': course.title, 'count': 1}])
        self.assertEqual({(r['kind'], r['id']) for r in data['drafts']}, {('course', draft.pk), ('exam', exam_draft.pk)})
        self.assertEqual(Course.objects.get(pk=draft.pk).enrollments.count(), 0)

    def test_empty_overview_and_disabled_people(self):
        self.learner.is_active = False
        self.learner.save()
        data = self.client.get('/api/administration/').data
        self.assertEqual(data['courses']['total'], 0)
        self.assertEqual(data['exams']['total'], 0)
        self.assertEqual(data['people']['active'], 2)
        self.assertEqual(data['drafts'], [])
        self.assertEqual(data['enrollment_requests'], [])

    def test_activity_resolves_names_and_safe_editor_links_without_changing_audit(self):
        course = Course.objects.create(title='Safety training', owner=self.admin)
        event = AuditEvent.objects.create(actor=self.admin, action='course.created', target=str(course.pk), detail={'published': False})
        AuditEvent.objects.create(actor=self.learner, action='auth.entra', target=str(self.learner.pk))
        AuditEvent.objects.create(action='course.updated', target='99999999999999999999999')
        AuditEvent.objects.create(action='course.updated', target='not-an-id')
        data = self.client.get('/api/audit/').data
        row = next(r for r in data if r['id'] == event.pk)
        self.assertEqual(row['target_label'], course.title)
        self.assertEqual(row['target_path'], f'/authoring?course={course.pk}&action=edit')
        self.assertEqual(row['actor_label'], self.admin.username)
        self.assertEqual(row['detail'], {'published': False})
        self.assertEqual(data[2]['target_label'], 'Taylor')
        self.assertEqual(data[0]['target_path'], '')
        course.delete()
        data = self.client.get('/api/audit/').data
        self.assertEqual(next(r for r in data if r['id'] == event.pk)['target_label'], '')
        self.assertEqual(AuditEvent.objects.count(), 4)

    def test_old_admin_entry_redirects_to_native_workspace_with_prefix(self):
        for prefix in ('', '/training'):
            with self.subTest(prefix=prefix), override_settings(APP_BASE_PATH=prefix):
                response = self.client.get('/admin/')
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response['Location'], prefix + '/manage')
        self.assertEqual(reverse('admin:index'), '/admin/data/')

    def test_data_maintenance_still_requires_staff_session(self):
        self.client.force_authenticate(None)
        response = self.client.get('/admin/data/')
        self.assertEqual(response.status_code, 302)
        self.assertIn('/admin/data/login/', response['Location'])
        self.client.force_login(self.learner)
        self.assertEqual(self.client.get('/admin/data/').status_code, 302)
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get('/admin/data/').status_code, 200)
