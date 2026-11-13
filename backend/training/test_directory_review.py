"""Regressions for the directory review. All people and transports are synthetic."""
from datetime import timedelta
from unittest.mock import Mock, patch

from django import forms
from django.contrib.admin import AdminSite
from django.contrib.auth.models import Group
from django.db import DatabaseError, IntegrityError, OperationalError, transaction
from django.test import Client, RequestFactory, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from . import directory
from .admin import EnterpriseUserAdmin
from .models import AuditEvent, DirectorySyncState, Identity, TrainingGroup, TrainingGroupMembership, User
from .test_directory import CLIENT, OTHER_TENANT, person

TENANT = 'abcdefff-abcd-4abc-8abc-abcdefabcdef'
OID = 'fedcbaaa-abcd-4abc-8abc-fedcbafedcba'


@override_settings(ENTRA_TENANT_ID=TENANT, GRAPH_DIRECTORY_TENANT_ID=TENANT,
                   GRAPH_DIRECTORY_CLIENT_ID=CLIENT, GRAPH_DIRECTORY_CLIENT_SECRET='synthetic',
                   DIRECTORY_REQUIRE_LICENSE=True, DIRECTORY_EMAIL_DOMAINS=[], DIRECTORY_SYNC_INTERVAL_HOURS=0)
class DirectoryReviewTests(TestCase):
    def setUp(self):
        graph = patch('training.directory.graph_fetch', return_value=person(id=OID, userType='Guest'))
        graph.start()
        self.addCleanup(graph.stop)
        self.admin = User.objects.create_user('review-admin', role='admin', is_staff=True, is_superuser=True)
        self.client = APIClient(); self.client.force_authenticate(self.admin)

    def sync(self, records, **kwargs):
        with patch('training.directory.graph_listing', return_value=records):
            return directory.sync_directory(**kwargs)

    def linked(self, subject=None, **kwargs):
        return User.objects.create_user('existing-oid', email='fiction1@example.test',
            entra_subject=subject or f'{TENANT}:{OID}', **kwargs)

    def callback(self, email='fiction1@example.test', tenant=TENANT.upper(), oid=OID.upper()):
        self.client.force_authenticate(None)
        session = self.client.session; session['entra_flow'] = {'state': 'synthetic'}; session.save()
        with patch('training.auth_views.entra_client') as client:
            client.return_value.acquire_token_by_auth_code_flow.return_value = {'id_token_claims': {
                'tid': tenant, 'oid': oid, 'preferred_username': email}}
            return self.client.get('/api/auth/entra/callback/', {'state': 'synthetic', 'code': 'synthetic'})

    def test_01_mixed_case_sync_never_replaces_or_disables_listed_account(self):
        user = self.linked(subject=f'{TENANT.upper()}:{OID.upper()}')
        result = self.sync([person(id=OID)], apply=True)
        user.refresh_from_db()
        self.assertEqual((result['counts']['conflicts'], result['counts']['deactivate']), (0, 0))
        self.assertTrue(user.is_active)
        self.assertEqual(user.entra_subject, f'{TENANT.upper()}:{OID.upper()}')
        self.assertEqual(User.objects.count(), 2)
        self.assertIsNotNone(user.directory_seen_at)

    def test_01_mixed_case_absent_account_is_a_leaver(self):
        user = self.linked(subject=f'{TENANT.upper()}:{OID.upper()}')
        self.assertEqual(self.sync([], apply=True)['counts']['deactivate'], 1)
        user.refresh_from_db(); self.assertFalse(user.is_active)

    def test_01_mixed_case_signin_adopts_existing_account(self):
        user = self.linked()
        self.assertEqual(self.callback().status_code, 302)
        user.refresh_from_db(); self.assertIsNotNone(user.last_login)
        self.assertEqual(User.objects.count(), 2)

    def test_01_case_insensitive_subject_constraint_prevents_replacements(self):
        self.linked()
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user('replacement-name', entra_subject=f'{TENANT.upper()}:{OID.upper()}')

    def test_01_signin_race_recovers_mixed_case_subject(self):
        user = self.linked(subject=f'{TENANT.upper()}:{OID.upper()}')
        original = User.objects.filter
        first = True
        def missed_lookup(*args, **kwargs):
            nonlocal first
            if any(k.startswith('entra_subject') for k in kwargs) and first:
                first = False
                missed = Mock(); missed.first.return_value = None
                return missed
            return original(*args, **kwargs)
        with patch.object(User.objects, 'filter', side_effect=missed_lookup):
            response = self.callback(email='unclaimed@example.test', tenant=TENANT, oid=OID)
        self.assertEqual(response.status_code, 302)
        user.refresh_from_db(); self.assertIsNotNone(user.last_login)
        self.assertEqual(User.objects.count(), 2)

    def test_01_sync_race_reloads_case_insensitive_ownership(self):
        records = [person(id=OID)]
        stale = directory.plan(records, TENANT, timezone.now())
        user = self.linked(subject=f'{TENANT.upper()}:{OID.upper()}')
        original = directory.plan
        attempts = iter([stale])
        with patch('training.directory.plan', side_effect=lambda *a, **k: next(attempts, None) or original(*a, **k)):
            result = self.sync(records, apply=True)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertEqual(result['counts']['conflicts'], 0)
        self.assertEqual(User.objects.count(), 2)

    def test_02_instructor_search_cannot_probe_private_identifiers(self):
        user = self.linked(display_name='Invented Willow', employee_id='PRIVATE-EMPLOYEE-91')
        teacher = User.objects.create_user('review-instructor', role='instructor')
        self.client.force_authenticate(teacher)
        for search in ('PRIVATE-EMPLOYEE', 'fiction1@', 'unknown-fragment'):
            data = self.client.get('/api/exams/audience-options/', {'search': search}).data
            self.assertEqual(data['total'], 0)
        for query in ({'ids': user.pk}, {'role': 'learner'}, {'signed_in': 'no'}, {'status': 'inactive'}):
            self.assertEqual(self.client.get('/api/exams/audience-options/', query).status_code, 400)
        for search in ('Willow', 'existing-oid'):
            self.assertEqual(self.client.get('/api/exams/audience-options/', {'search': search}).data['total'], 1)

    def test_02_instructor_picker_cannot_enumerate_group_rosters(self):
        user = self.linked()
        teacher = User.objects.create_user('review-instructor', role='instructor')
        group = TrainingGroup.objects.create(name='Private cohort', created_by=self.admin)
        TrainingGroupMembership.objects.create(group=group, user=user, added_by=self.admin)
        self.client.force_authenticate(teacher)
        for group_id in (group.pk, 999999):
            self.assertEqual(self.client.get('/api/exams/audience-options/', {'group': group_id}).status_code, 400)
        self.assertEqual(self.client.get('/api/users/', {'group': group.pk}).status_code, 403)
        self.assertEqual(self.client.get(f'/api/groups/{group.pk}/members/').status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/exams/audience-options/', {'group': group.pk, 'search': 'fiction1@'}).data['total'], 1)

    def admin_form(self, user):
        request = RequestFactory().get('/admin/data/training/user/'); request.user = self.admin
        model_admin = EnterpriseUserAdmin(User, AdminSite())
        form_class = model_admin.get_form(request, user)
        form = form_class(instance=user)
        data = {}
        for name, field in form.fields.items():
            if name == 'password':
                continue
            value = form[name].value()
            if isinstance(field.widget, forms.MultiWidget):
                for index, part in enumerate(field.widget.decompress(value)):
                    data[f'{name}_{index}'] = part
            else:
                data[name] = value
        return request, model_admin, form_class, data

    def test_03_stale_admin_post_preserves_directory_access_and_other_fields(self):
        user = self.linked(display_name='Before', department='Original')
        request, model_admin, form_class, data = self.admin_form(user)
        disabled_at = timezone.now()
        User.objects.filter(pk=user.pk).update(is_active=False, directory_disabled_at=disabled_at, department='Synced department')
        data['display_name'] = 'Edited by operator'
        bound = form_class(data=data, instance=User.objects.get(pk=user.pk))
        self.assertTrue(bound.is_valid(), bound.errors)
        edited = bound.save(commit=False)
        model_admin.save_model(request, edited, bound, True)
        model_admin.save_related(request, bound, [], True)
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertEqual(user.directory_disabled_at, disabled_at)
        self.assertEqual(user.department, 'Synced department')
        self.assertEqual(user.display_name, 'Edited by operator')

    def test_03_stale_admin_m2m_does_not_erase_concurrent_permissions(self):
        user = self.linked()
        request, model_admin, form_class, data = self.admin_form(user)
        permission_group = Group.objects.create(name='Invented permissions')
        user.groups.add(permission_group)
        data['display_name'] = 'Only this changed'
        bound = form_class(data=data, instance=User.objects.get(pk=user.pk))
        self.assertTrue(bound.is_valid(), bound.errors)
        model_admin.save_model(request, bound.save(commit=False), bound, True)
        model_admin.save_related(request, bound, [], True)
        self.assertTrue(user.groups.filter(pk=permission_group.pk).exists())

    def test_04_other_tenants_do_not_weaken_deactivation_guard(self):
        people = [User(username=f'current-{i}', entra_subject=f'{TENANT}:{person(i + 1)["id"]}') for i in range(21)]
        people += [User(username=f'foreign-{i}', entra_subject=f'{OTHER_TENANT}:{person(i + 1)["id"]}') for i in range(300)]
        User.objects.bulk_create(people)
        result = self.sync([], apply=True)
        self.assertTrue(result['mass_deactivation_guard'])
        self.assertEqual(result['counts']['deactivate'], 0)
        self.assertEqual(User.objects.filter(is_active=False).count(), 0)

    def test_05_old_identity_email_remains_reserved_for_its_owner(self):
        owner = User.objects.create_user('previous-owner', email='new-address@example.test')
        identity = Identity.objects.create(user=owner, key='email:FICTION1@EXAMPLE.TEST')
        result = self.sync([person(id=OID)], apply=True)
        self.assertEqual(result['counts']['create'], 0)
        self.assertEqual(result['counts']['conflicts'], 1)
        self.assertEqual(User.objects.count(), 2)
        identity.refresh_from_db(); self.assertEqual(identity.user_id, owner.pk)

    @override_settings(DIRECTORY_SYNC_INTERVAL_HOURS=4)
    def test_06_failed_schedule_waits_an_hour_but_manual_remains_immediate(self):
        now = timezone.now()
        with patch('training.directory.graph_listing', side_effect=directory.DirectoryError('network')) as fetch, patch('training.directory.timezone.now', return_value=now) as clock:
            with self.assertLogs('training.directory', level='WARNING'):
                directory.scheduled_sync()
            # A fresh scheduler invocation must read persisted failure state.
            clock.return_value = now + timedelta(minutes=59)
            directory.scheduled_sync()
            self.assertEqual(fetch.call_count, 1)
            with self.assertRaises(directory.DirectoryError):
                directory.sync_directory(apply=True)
            self.assertEqual(fetch.call_count, 2)
            clock.return_value = now + timedelta(hours=1)
            with self.assertLogs('training.directory', level='WARNING'):
                directory.scheduled_sync()
            self.assertEqual(fetch.call_count, 3)
        self.assertFalse(AuditEvent.objects.filter(action='directory.sync').exists())

    def test_07_reactivation_is_one_outcome_even_when_profile_changes(self):
        user = self.linked(is_active=False, directory_disabled_at=timezone.now())
        preview = self.sync([person(id=OID)])
        result = self.sync([person(id=OID)], apply=True)
        self.assertEqual(preview, result)
        counts = result['counts']
        self.assertEqual(counts['reactivate'], 1)
        self.assertEqual(sum(counts[k] for k in ('create', 'update', 'unchanged', 'reactivate')), 1)
        self.assertEqual(counts['update'], 0)
        user.refresh_from_db(); self.assertEqual(user.department, 'Imaginary Operations')

    def test_07_blocked_creation_is_unchanged_with_conflict_flag(self):
        User.objects.create_user('local-owner', email='fiction1@example.test')
        counts = self.sync([person(id=OID)])['counts']
        self.assertEqual(counts['conflicts'], 1)
        self.assertEqual(counts['unchanged'], 1)
        self.assertEqual(sum(counts[k] for k in ('create', 'update', 'unchanged', 'reactivate')), 1)

    def test_08_database_write_failure_rolls_back_and_logs_only_class(self):
        with patch('training.directory.graph_listing', return_value=[person(id=OID)]), patch('training.directory.audit', side_effect=OperationalError('secret SQL or person data')):
            with self.assertLogs('training.directory', level='ERROR') as logs:
                response = self.client.post('/api/directory/run/', {'apply': True}, format='json')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.data['code'], 'failed')
        self.assertEqual(logs.records[0].getMessage(), 'OperationalError')
        self.assertNotIn('secret', str(response.data))
        self.assertEqual(User.objects.count(), 1)
        self.assertIsNone(DirectorySyncState.objects.get(pk=1).last_run_at)

    def test_08_non_lock_failure_acquiring_state_is_not_busy(self):
        with patch.object(DirectorySyncState.objects, 'select_for_update', side_effect=DatabaseError('private database failure')):
            with self.assertLogs('training.directory', level='ERROR') as logs:
                response = self.client.post('/api/directory/run/', {'apply': True}, format='json')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.data['code'], 'failed')
        self.assertEqual(logs.records[0].getMessage(), 'DatabaseError')

    def test_09_upstream_denial_and_throttling_are_server_failures(self):
        for code in ('permission', 'throttled'):
            with patch('training.directory.graph_listing', side_effect=directory.DirectoryError(code)):
                response = self.client.post('/api/directory/run/', {}, format='json')
            self.assertGreaterEqual(response.status_code, 500)
            self.assertLess(response.status_code, 600)
            self.assertEqual(response.data['code'], code)

    def test_03_admin_form_rejects_missing_or_tampered_snapshot(self):
        user = self.linked()
        _, _, form_class, data = self.admin_form(user)
        for token in ('', 'tampered'):
            form = form_class(data={**data, 'edit_snapshot': token}, instance=user)
            self.assertFalse(form.is_valid())
            self.assertIn('Reopen', str(form.non_field_errors()))

    def test_03_deliberate_admin_access_and_permission_edits_are_applied(self):
        user = self.linked(is_active=False, directory_disabled_at=timezone.now())
        request, model_admin, form_class, data = self.admin_form(user)
        permission_group = Group.objects.create(name='Chosen permissions')
        data.update(is_active=True, groups=[permission_group.pk])
        form = form_class(data=data, instance=user)
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(set(form.changed_data), {'is_active', 'groups'})
        model_admin.save_model(request, form.save(commit=False), form, True)
        model_admin.save_related(request, form, [], True)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertIsNone(user.directory_disabled_at)
        self.assertTrue(user.groups.filter(pk=permission_group.pk).exists())

    def test_03_actual_admin_get_post_preserves_concurrent_sync_disable(self):
        user = self.linked(display_name='Before')
        client = Client(); client.force_login(self.admin)
        path = f'/admin/data/training/user/{user.pk}/change/'
        page = client.get(path)
        self.assertEqual(page.status_code, 200)
        snapshot = page.context['adminform'].form['edit_snapshot'].value()
        _, _, _, data = self.admin_form(user)
        data['edit_snapshot'] = snapshot
        data['display_name'] = 'Changed in browser form'
        data = {key: value if value is not None else '' for key, value in data.items()}
        stamp = timezone.now()
        User.objects.filter(pk=user.pk).update(is_active=False, directory_disabled_at=stamp)
        response = client.post(path, data)
        self.assertEqual(response.status_code, 302)
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertEqual(user.directory_disabled_at, stamp)
        self.assertEqual(user.display_name, 'Changed in browser form')

    def test_05_identity_reservations_preserve_own_and_unbound_identity_flows(self):
        user = self.linked()
        Identity.objects.create(user=user, key='email:fiction1@example.test')
        Identity.objects.create(key='email:fiction2@example.test')
        result = self.sync([person(id=OID), person(2)], apply=True)
        self.assertEqual(result['counts']['conflicts'], 0)
        self.assertEqual(result['counts']['create'], 1)

    @override_settings(DIRECTORY_SYNC_INTERVAL_HOURS=0.25)
    def test_06_successful_schedule_keeps_short_configured_interval(self):
        now = timezone.now()
        with patch('training.directory.timezone.now', return_value=now) as clock, patch('training.directory.graph_listing', return_value=[]) as fetch:
            directory.scheduled_sync()
            self.assertIsNone(DirectorySyncState.objects.get(pk=1).next_scheduled_attempt_at)
            clock.return_value = now + timedelta(minutes=14)
            directory.scheduled_sync()
            self.assertEqual(fetch.call_count, 1)
            clock.return_value = now + timedelta(minutes=15)
            directory.scheduled_sync()
            self.assertEqual(fetch.call_count, 2)

    def test_08_only_postgres_nowait_contention_is_busy(self):
        class LockNotAvailable(Exception):
            sqlstate = '55P03'
        error = OperationalError('private lock message')
        error.__cause__ = LockNotAvailable()
        with patch.object(DirectorySyncState.objects, 'select_for_update', side_effect=error), self.assertNoLogs('training.directory', level='ERROR'):
            response = self.client.post('/api/directory/run/', {'apply': True}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'busy')

    def test_08_preview_database_failure_and_non_unique_integrity_error_are_failed(self):
        for apply in (False, True):
            with patch('training.directory.graph_listing', return_value=[person(id=OID)]), patch('training.directory.plan', side_effect=IntegrityError('private constraint details')):
                with self.assertLogs('training.directory', level='ERROR') as logs:
                    response = self.client.post('/api/directory/run/', {'apply': apply}, format='json')
            self.assertEqual(response.status_code, 500)
            self.assertEqual(response.data['code'], 'failed')
            self.assertEqual(logs.records[0].getMessage(), 'IntegrityError')
