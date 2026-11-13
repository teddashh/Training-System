"""Training group contracts, using invented people only."""
import csv
import io
from datetime import timedelta
from unittest.mock import patch

from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from .models import AuditEvent, Course, Enrollment, Exam, LearningAssignment, TrainingGroup, TrainingGroupMembership, User
from .services import finalize, identity_for_user, in_exam_audience, start_attempt
from .tests import make_exam


@override_settings(DEBUG=True)
class TrainingGroupTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user('synthetic-manager', role='admin')
        self.teacher = User.objects.create_user('synthetic-teacher', role='instructor')
        self.first = User.objects.create_user('fiction-arden', email='arden@example.test', display_name='Arden Example', department='Imaginary Lab', employee_id='SYN-1')
        self.second = User.objects.create_user('fiction-blair', email='blair@example.test', display_name='Blair Example', department='Imaginary Lab', last_login=timezone.now())
        self.inactive = User.objects.create_user('fiction-cove', display_name='Cove Example', department='Imaginary Lab', is_active=False)
        self.group = TrainingGroup.objects.create(name='Imaginary onboarding', description='Synthetic cohort', created_by=self.admin)
        self.course = Course.objects.create(title='Invented safety lesson', owner=self.teacher, published=True)
        self.exam = make_exam(self.teacher)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def members(self, group, *people):
        TrainingGroupMembership.objects.bulk_create([TrainingGroupMembership(group=group, user=p, added_by=self.admin) for p in people])

    def add(self, ids, group=None):
        return self.client.post(f'/api/groups/{(group or self.group).pk}/members/', {'user_ids': ids}, format='json')

    def remove(self, ids):
        return self.client.post(f'/api/groups/{self.group.pk}/remove-members/', {'user_ids': ids}, format='json')

    def matching(self, filters, **extra):
        return self.client.post(f'/api/groups/{self.group.pk}/matching-members/', {'filters': filters, **extra}, format='json')

    def assign(self, groups=None, **extra):
        return self.client.post('/api/assignments/', {
            'kind': 'course', 'target_id': self.course.pk, 'audience': 'groups',
            'groups': groups if groups is not None else [self.group.pk], **extra,
        }, format='json')

    def test_crud_and_counts_only_audits(self):
        created = self.client.post('/api/groups/', {'name': '  Practice cohort  ', 'description': 'Invented description'}, format='json')
        self.assertEqual(created.status_code, 201)
        group = TrainingGroup.objects.get(pk=created.data['id'])
        self.assertEqual((group.name, group.created_by_id), ('Practice cohort', self.admin.pk))
        old_time = group.updated_at
        response = self.client.patch(f'/api/groups/{group.pk}/', {'name': 'Renamed cohort', 'description': 'Changed'}, format='json')
        self.assertEqual(response.status_code, 200)
        group.refresh_from_db()
        self.assertGreaterEqual(group.updated_at, old_time)
        self.assertEqual(group.description, 'Changed')
        self.assertEqual(self.client.get(f'/api/groups/{group.pk}/').data['member_count'], 0)
        self.assertEqual(self.client.delete(f'/api/groups/{group.pk}/').status_code, 204)
        events = list(AuditEvent.objects.filter(action__startswith='group.'))
        self.assertEqual({e.action for e in events}, {'group.created', 'group.updated', 'group.deleted'})
        self.assertTrue(all(type(v) is int for e in events for v in e.detail.values()))
        self.assertFalse(TrainingGroup.objects.filter(pk=group.pk).exists())
        self.assertEqual(User.objects.count(), 5)

    def test_unique_name_is_case_insensitive_in_api_and_database(self):
        response = self.client.post('/api/groups/', {'name': 'IMAGINARY ONBOARDING'}, format='json')
        self.assertEqual(response.status_code, 400)
        other = TrainingGroup.objects.create(name='Other', created_by=self.admin)
        self.assertEqual(self.client.patch(f'/api/groups/{other.pk}/', {'name': 'imaginary onboarding'}, format='json').status_code, 400)
        with self.assertRaises(IntegrityError), transaction.atomic():
            TrainingGroup.objects.create(name='IMAGINARY ONBOARDING', created_by=self.admin)
        self.assertEqual(TrainingGroup.objects.count(), 2)

    def test_group_name_and_description_validation(self):
        for data in ({'name': ''}, {'name': ' '}, {'name': 'X' * 101}, {'name': 'Valid', 'description': 'X' * 2001}):
            self.assertEqual(self.client.post('/api/groups/', data, format='json').status_code, 400)

    def test_manager_reads_and_admin_only_writes_and_members(self):
        for user in (None, self.first, self.teacher):
            self.client.force_authenticate(user)
            expected = 200 if user == self.teacher else 403
            self.assertEqual(self.client.get('/api/groups/').status_code, expected)
            self.assertEqual(self.client.get(f'/api/groups/{self.group.pk}/').status_code, expected)
            self.assertEqual(self.client.post('/api/groups/', {'name': 'Denied'}, format='json').status_code, 403)
            self.assertEqual(self.client.patch(f'/api/groups/{self.group.pk}/', {'name': 'Denied'}, format='json').status_code, 403)
            self.assertEqual(self.client.delete(f'/api/groups/{self.group.pk}/').status_code, 403)
            self.assertEqual(self.add([self.first.pk]).status_code, 403)
            self.assertEqual(self.remove([self.first.pk]).status_code, 403)
            self.assertEqual(self.matching({}).status_code, 403)
            self.assertEqual(self.client.get(f'/api/groups/{self.group.pk}/members/').status_code, 403)
        self.assertEqual(TrainingGroup.objects.count(), 1)

    def test_list_search_counts_and_bounded_pages(self):
        self.members(self.group, self.first, self.inactive)
        TrainingGroup.objects.bulk_create([TrainingGroup(name=f'Fixture group {i:03}', created_by=self.admin) for i in range(55)])
        first = self.client.get('/api/groups/').data
        second = self.client.get('/api/groups/', {'page': 2}).data
        self.assertEqual((first['total'], len(first['results']), len(second['results'])), (56, 50, 6))
        self.assertFalse({g['id'] for g in first['results']} & {g['id'] for g in second['results']})
        result = self.client.get('/api/groups/', {'search': 'IMAGINARY'}).data
        self.assertEqual(result['total'], 1)
        self.assertEqual((result['results'][0]['member_count'], result['results'][0]['active_member_count']), (2, 1))

    def test_bulk_add_is_idempotent_preserves_actor_and_membership_key(self):
        response = self.add([self.first.pk, self.first.pk, self.inactive.pk])
        self.assertEqual(response.data, {'added': 2, 'requested': 2})
        member = self.group.memberships.get(user=self.first)
        original = (member.pk, member.added_at, member.added_by_id)
        self.assertEqual(self.add([self.first.pk, self.second.pk]).data, {'added': 1, 'requested': 2})
        member.refresh_from_db()
        self.assertEqual((member.pk, member.added_at, member.added_by_id), original)
        self.assertEqual(self.group.members.count(), 3)
        self.assertEqual(AuditEvent.objects.filter(action='group.members_added').last().detail, {'added': 1, 'requested': 2})
        with self.assertRaises(IntegrityError), transaction.atomic():
            TrainingGroupMembership.objects.create(group=self.group, user=self.first, added_by=self.admin)

    def test_add_validation_is_atomic_and_bounds_one_thousand(self):
        self.assertEqual(self.add([self.first.pk, 999999]).status_code, 400)
        self.assertFalse(self.group.members.exists())
        self.assertEqual(self.add([self.first.pk] * 1001).status_code, 400)
        self.assertEqual(self.add([]).status_code, 400)
        self.assertEqual(self.add([self.first.pk] * 1000).data['added'], 1)

    def test_thousand_member_add_has_bounded_queries(self):
        people = User.objects.bulk_create([User(username=f'invented-bulk-{i}') for i in range(1000)])
        with CaptureQueriesContext(connection) as queries:
            response = self.add([p.pk for p in people])
        self.assertEqual(response.data['added'], 1000)
        self.assertLess(len(queries), 20)
        self.assertEqual(self.add([p.pk for p in people]).data['added'], 0)

    def test_paged_member_search_uses_people_fields_and_includes_inactive(self):
        self.members(self.group, self.first, self.second, self.inactive)
        page = self.client.get(f'/api/groups/{self.group.pk}/members/', {'page_size': 2, 'page': 2}).data
        self.assertEqual((page['total'], len(page['results'])), (3, 1))
        for term in ('Arden', 'arden@example', 'SYN-1', 'fiction-arden'):
            data = self.client.get(f'/api/groups/{self.group.pk}/members/', {'search': term}).data
            self.assertEqual(data['total'], 1)
            self.assertEqual(data['results'][0]['id'], self.first.pk)
        data = self.client.get(f'/api/groups/{self.group.pk}/members/', {'status': 'inactive'}).data
        self.assertEqual(data['results'][0]['id'], self.inactive.pk)

    def test_remove_is_idempotent_keeps_people_and_records(self):
        self.members(self.group, self.first, self.second)
        identity = identity_for_user(self.first)
        assignment = LearningAssignment.objects.create(user=self.first, course=self.course, created_by=self.teacher)
        response = self.remove([self.first.pk, self.first.pk, self.inactive.pk])
        self.assertEqual(response.data, {'removed': 1})
        self.assertEqual(self.remove([self.first.pk]).data, {'removed': 0})
        self.assertEqual(list(self.group.members.values_list('pk', flat=True)), [self.second.pk])
        identity.refresh_from_db(); assignment.refresh_from_db(); self.first.refresh_from_db()
        self.assertEqual(AuditEvent.objects.filter(action='group.members_removed').first().detail, {'removed': 1, 'requested': 2})

    def test_filter_preview_count_then_exact_apply(self):
        self.members(self.group, self.first)
        filters = {'department': 'Imaginary Lab', 'status': 'active', 'signed_in': 'yes', 'search': 'blair'}
        preview = self.matching(filters)
        self.assertEqual((preview.data['matching'], preview.data['to_add']), (1, 1))
        self.assertEqual(self.group.members.count(), 1)
        self.assertFalse(AuditEvent.objects.filter(action='group.members_added').exists())
        applied = self.matching(filters, apply=True, preview=preview.data['preview'])
        self.assertEqual(applied.data, {'matching': 1, 'added': 1})
        self.assertEqual(set(self.group.members.values_list('pk', flat=True)), {self.first.pk, self.second.pk})
        preview = self.matching({'department': 'Imaginary Lab'})
        self.assertEqual((preview.data['matching'], preview.data['to_add']), (3, 1))
        self.assertEqual(self.matching({'department': 'Imaginary Lab'}, apply=True, preview=preview.data['preview']).data['added'], 1)
        self.assertTrue(self.group.members.filter(pk=self.inactive.pk).exists())

    def test_filter_apply_requires_unchanged_preview(self):
        filters = {'search': 'fiction-', 'status': 'active'}
        preview = self.matching(filters).data['preview']
        self.second.is_active = False; self.second.save()
        response = self.matching(filters, apply=True, preview=preview)
        self.assertEqual(response.status_code, 409)
        self.assertFalse(self.group.members.exists())
        for token in ('', 'invalid'):
            self.assertEqual(self.matching(filters, apply=True, preview=token).status_code, 409)
        fresh = self.matching(filters).data['preview']
        self.assertEqual(self.matching({}, apply=True, preview=fresh).status_code, 409)
        with patch('training.groups.signing.loads', side_effect=__import__('django.core.signing', fromlist=['SignatureExpired']).SignatureExpired()):
            self.assertEqual(self.matching(filters, apply=True, preview=fresh).status_code, 409)

    def test_filter_preview_cannot_be_reused_for_another_group_or_actor(self):
        preview = self.matching({}).data['preview']
        other = TrainingGroup.objects.create(name='Second cohort', created_by=self.admin)
        response = self.client.post(f'/api/groups/{other.pk}/matching-members/', {'filters': {}, 'apply': True, 'preview': preview}, format='json')
        self.assertEqual(response.status_code, 409)
        replacement = User.objects.create_user('other-synthetic-admin', role='admin')
        self.client.force_authenticate(replacement)
        self.assertEqual(self.matching({}, apply=True, preview=preview).status_code, 409)
        self.assertFalse(TrainingGroupMembership.objects.exists())

    def test_invalid_matching_filters_do_not_broaden_selection(self):
        for filters in ({'unknown': 'value'}, {'status': 'typo'}, {'signed_in': 'typo'}, {'group': 'bad'}):
            self.assertEqual(self.matching(filters).status_code, 400)

    def test_users_api_group_filter_combines_with_other_filters(self):
        self.members(self.group, self.first, self.inactive)
        data = self.client.get('/api/users/', {'group': self.group.pk}).data
        self.assertEqual(data['total'], 2)
        data = self.client.get('/api/users/', {'group': self.group.pk, 'department': 'Imaginary Lab', 'status': 'active', 'signed_in': 'no', 'search': 'Arden'}).data
        self.assertEqual([u['id'] for u in data['results']], [self.first.pk])
        self.assertEqual(self.client.get('/api/users/', {'group': 'bad'}).status_code, 400)

    def test_assignment_groups_overlap_inactive_and_idempotence(self):
        second = TrainingGroup.objects.create(name='Another cohort', created_by=self.admin)
        self.members(self.group, self.first, self.inactive)
        self.members(second, self.first, self.second)
        ids = [self.group.pk, second.pk, self.group.pk]
        self.client.force_authenticate(self.teacher)
        preview = self.client.post('/api/assignments/group-preview/', {'groups': ids}, format='json')
        self.assertEqual(preview.data, {'people': 2, 'within_limit': True})
        self.assertEqual(self.assign(ids).data, {'assigned': 2, 'emails_queued': 2, 'people_without_email': 0})
        self.assertEqual(self.assign(ids).data, {'assigned': 2, 'emails_queued': 0, 'people_without_email': 0})
        self.assertEqual(set(LearningAssignment.objects.values_list('user_id', flat=True)), {self.first.pk, self.second.pk})
        self.assertEqual(LearningAssignment.objects.count(), 2)

    def test_assignment_snapshot_survives_membership_and_group_removal(self):
        self.members(self.group, self.first)
        self.assertEqual(self.assign().status_code, 201)
        self.remove([self.first.pk]); self.add([self.second.pk])
        self.assertEqual(list(LearningAssignment.objects.values_list('user_id', flat=True)), [self.first.pk])
        enrollment = Enrollment.objects.create(user=self.first, course=self.course, progress=100, completed_at=timezone.now())
        self.assertEqual(self.client.delete(f'/api/groups/{self.group.pk}/').status_code, 204)
        self.assertEqual(LearningAssignment.objects.count(), 1)
        enrollment.refresh_from_db(); self.assertEqual(enrollment.progress, 100)

    def test_assignment_fresh_membership_recomputed_after_preview(self):
        self.members(self.group, self.first)
        self.assertEqual(self.client.post('/api/assignments/group-preview/', {'groups': [self.group.pk]}, format='json').data['people'], 1)
        self.members(self.group, self.second)
        self.assertEqual(self.assign().data['assigned'], 2)

    def test_assignment_limit_zero_and_five_hundred_one(self):
        self.assertEqual(self.assign().status_code, 400)
        people = User.objects.bulk_create([User(username=f'large-cohort-{i}') for i in range(501)])
        self.members(self.group, *people)
        preview = self.client.post('/api/assignments/group-preview/', {'groups': [self.group.pk]}, format='json')
        self.assertEqual(preview.data, {'people': 501, 'within_limit': False})
        self.assertEqual(self.assign().status_code, 400)
        self.assertFalse(LearningAssignment.objects.exists())
        # Exact limit is accepted with the same individual record behavior.
        self.group.memberships.filter(user=people[-1]).delete()
        self.assertEqual(self.assign().data['assigned'], 500)
        self.assertEqual(LearningAssignment.objects.count(), 500)

    def test_assignment_group_validation_and_owner_permissions(self):
        self.members(self.group, self.first)
        for groups in ([], [999999]):
            self.assertEqual(self.assign(groups).status_code, 400)
        stranger = User.objects.create_user('other-instructor', role='instructor')
        self.client.force_authenticate(stranger)
        self.assertEqual(self.assign().status_code, 403)
        self.client.force_authenticate(self.first)
        self.assertEqual(self.assign().status_code, 403)
        self.assertEqual(self.client.post('/api/assignments/group-preview/', {'groups': [self.group.pk]}, format='json').status_code, 403)
        self.client.force_authenticate(self.teacher)
        self.course.published = False; self.course.save()
        self.assertEqual(self.assign().status_code, 400)

    def test_exam_group_audience_api_create_edit_and_validation(self):
        self.client.force_authenticate(self.teacher)
        response = self.client.patch(f'/api/exams/{self.exam.pk}/', {'audience': 'groups', 'allowed_groups': [self.group.pk]}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['allowed_groups'], [self.group.pk])
        self.assertEqual(self.client.patch(f'/api/exams/{self.exam.pk}/', {'allowed_groups': []}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(f'/api/exams/{self.exam.pk}/', {'allowed_groups': [999999]}, format='json').status_code, 400)
        response = self.client.post('/api/exams/', {'title': 'New fictional exam', 'audience': 'groups', 'allowed_groups': [self.group.pk]}, format='json')
        self.assertEqual(response.status_code, 201)
        created = Exam.objects.get(pk=response.data['id'])
        self.assertEqual(list(created.allowed_groups.all()), [self.group])
        self.assertEqual(self.client.patch(f'/api/exams/{self.exam.pk}/', {'audience': 'all', 'allowed_groups': []}, format='json').status_code, 200)

    def test_exam_live_membership_member_nonmember_removed_and_inactive(self):
        self.exam.audience = 'groups'; self.exam.save(); self.exam.allowed_groups.add(self.group)
        self.members(self.group, self.first, self.inactive)
        self.assertTrue(in_exam_audience(self.exam, self.first))
        self.assertFalse(in_exam_audience(self.exam, self.second))
        self.assertFalse(in_exam_audience(self.exam, self.inactive))
        self.client.force_authenticate(self.first)
        self.assertEqual(self.client.get(f'/api/exams/{self.exam.pk}/').status_code, 200)
        self.assertNotIn('allowed_groups', self.client.get(f'/api/exams/{self.exam.pk}/').data)
        self.client.force_authenticate(self.second)
        self.assertEqual(self.client.get(f'/api/exams/{self.exam.pk}/').status_code, 404)
        self.assertEqual(self.client.post(f'/api/exams/{self.exam.pk}/start/').status_code, 404)
        self.group.memberships.filter(user=self.first).delete()
        self.assertFalse(in_exam_audience(self.exam, self.first))
        self.client.force_authenticate(self.first)
        self.assertEqual(self.client.get(f'/api/exams/{self.exam.pk}/').status_code, 404)

    def test_exam_assignment_remains_an_explicit_grant_after_membership_removal(self):
        self.exam.audience = 'groups'; self.exam.save(); self.exam.allowed_groups.add(self.group)
        self.members(self.group, self.first)
        self.assertEqual(self.assign(kind='exam', target_id=self.exam.pk).data['assigned'], 1)
        self.remove([self.first.pk])
        self.assertTrue(in_exam_audience(self.exam, self.first))
        self.first.is_active = False; self.first.save()
        self.assertFalse(in_exam_audience(self.exam, self.first))

    def test_delete_blocked_names_draft_and_published_exams(self):
        self.exam.audience = 'groups'; self.exam.save(); self.exam.allowed_groups.add(self.group)
        draft = Exam.objects.create(title='Draft fictional audience', owner=self.teacher, audience='groups')
        draft.allowed_groups.add(self.group)
        response = self.client.delete(f'/api/groups/{self.group.pk}/')
        self.assertEqual(response.status_code, 409)
        self.assertIn(self.exam.title, response.data['detail'])
        self.assertIn(draft.title, response.data['detail'])
        self.assertEqual({e['id'] for e in response.data['exams']}, {self.exam.pk, draft.pk})
        self.assertTrue(TrainingGroup.objects.filter(pk=self.group.pk).exists())
        self.assertFalse(AuditEvent.objects.filter(action='group.deleted').exists())

    def test_unused_saved_group_selection_does_not_block_delete(self):
        self.exam.allowed_groups.add(self.group)
        self.assertEqual(self.exam.audience, 'all')
        self.assertEqual(self.client.delete(f'/api/groups/{self.group.pk}/').status_code, 204)
        self.exam.refresh_from_db()
        self.assertEqual(self.exam.audience, 'all')
        self.assertTrue(in_exam_audience(self.exam, self.first))

    def test_results_group_filter_summary_export_and_scope(self):
        self.members(self.group, self.first)
        first = start_attempt(self.exam.pk, identity_for_user(self.first)); finalize(first)
        second = start_attempt(self.exam.pk, identity_for_user(self.second)); finalize(second)
        hidden_exam = make_exam(self.admin)
        hidden = start_attempt(hidden_exam.pk, identity_for_user(self.first)); finalize(hidden)
        self.client.force_authenticate(self.teacher)
        params = {'page': 1, 'group': self.group.pk, 'department': 'Imaginary Lab'}
        response = self.client.get('/api/results/', params)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['summary']['total'], 1)
        self.assertEqual(response.data['results'][0]['id'], str(first.pk))
        output = self.client.get('/api/results/export/', params)
        self.assertEqual(len(list(csv.reader(io.StringIO(output.content.decode('utf-8-sig'))))), 2)
        self.assertNotIn(str(hidden.pk), str(response.data))
        self.client.force_authenticate(self.admin); self.remove([self.first.pk])
        self.assertEqual(self.client.get('/api/results/', params).data['count'], 0)
        self.assertEqual(self.client.get('/api/results/', {'page': 1, 'group': 'bad'}).status_code, 400)

    def test_group_operations_do_not_restrict_course_enrollment(self):
        self.members(self.group, self.first)
        self.client.force_authenticate(self.second)
        response = self.client.post(f'/api/courses/{self.course.pk}/enroll/', {}, format='json')
        self.assertEqual(response.status_code, 200)
