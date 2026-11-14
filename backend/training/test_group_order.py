"""Ordering of API lists backed by aggregate querysets."""
from datetime import timedelta

from django.db import connection
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Course, CourseAssessment, CourseSession, Enrollment, Exam, User


class GroupOrderTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('order-owner', role='admin')
        self.now = timezone.now()
        self.course = Course.objects.create(
            owner=self.owner, title='Ordered training', published=True,
            delivery_mode='scheduled', registration_key='x' * 43,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def make_sessions(self):
        early = self.now + timedelta(days=2)
        late = self.now + timedelta(days=3)
        sessions = [
            CourseSession.objects.create(course=self.course, title=title, starts_at=start,
                                         ends_at=start + timedelta(hours=1))
            for title, start in [('Late', late), ('Early', early), ('Early tie', early)]
        ]
        return [sessions[1].pk, sessions[2].pk, sessions[0].pk]

    def test_course_detail_sessions_follow_start_then_id(self):
        expected = self.make_sessions()
        response = self.client.get(f'/api/courses/{self.course.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data['sessions']], expected)

    def test_public_registration_sessions_follow_start_then_id(self):
        expected = self.make_sessions()
        self.client.force_authenticate(None)
        response = self.client.post('/api/registration/lookup/', {'key': 'x' * 43}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data['sessions']], expected)

    def test_training_overview_sessions_follow_start_then_id(self):
        expected = self.make_sessions()
        response = self.client.get(f'/api/courses/{self.course.pk}/training/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data['sessions']], expected)

    def test_training_overview_quizzes_follow_link_creation_then_id(self):
        exams = [Exam.objects.create(owner=self.owner, title=title)
                 for title in ('Late', 'Early', 'Early tie')]
        links = [CourseAssessment.objects.create(course=self.course, exam=exam) for exam in exams]
        CourseAssessment.objects.filter(pk__in=[links[1].pk, links[2].pk]).update(
            created_at=self.now - timedelta(days=1),
        )
        response = self.client.get(f'/api/courses/{self.course.pk}/training/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data['quizzes']],
                         [exams[1].pk, exams[2].pk, exams[0].pk])

    def test_dashboard_departments_are_alphabetical(self):
        for department in ('Zulu', 'Echo', 'Delta', 'Charlie', 'Bravo', 'Alpha'):
            user = User.objects.create_user('order-' + department, department=department)
            Enrollment.objects.create(course=self.course, user=user)

        seen = []

        def unordered_groups_may_be_reversed(execute, sql, params, many, context):
            # SQLite usually sorts GROUP BY keys; emulate another legal database order
            # only when this department query does not specify an order of its own.
            if ('GROUP BY' in sql.upper() and 'FROM "training_enrollment"' in sql
                    and '"training_user"."department"' in sql):
                seen.append(True)
                if 'ORDER BY' not in sql.upper():
                    sql += ' ORDER BY 1 DESC'
            return execute(sql, params, many, context)

        with connection.execute_wrapper(unordered_groups_may_be_reversed):
            response = self.client.get('/api/dashboard/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(seen), 1)
        self.assertEqual([row['user__department'] for row in response.data['departments']],
                         ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Zulu'])
