"""Selective Entra links. Only account IDs and counts reach plans and audit events."""
import hashlib
import json
import logging
import re
import time
from urllib.parse import urlencode
from uuid import UUID

from django.core import signing
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import APIException

from . import directory
from .i18n import translate
from .models import TrainingGroup, TrainingGroupMembership, User
from .services import audit

GROUP_FIELDS = 'id,displayName,description,groupTypes,securityEnabled,mailEnabled'
MANUAL_MESSAGE = "This group's members come from Microsoft Entra. Change membership in Entra, or unlink the group first."
PREVIEW_MESSAGE = 'The Entra group, accounts or training group changed, or the preview expired. Preview again.'


class LinkConflict(APIException):
    status_code = 409
    default_code = 'conflict'

    def __init__(self, message=PREVIEW_MESSAGE, **values):
        super().__init__(translate(message, **values))


def object_id(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise directory.DirectoryError('invalid_listing') from None


def group_record(record):
    if not isinstance(record, dict):
        raise directory.DirectoryError('invalid_listing')
    oid = object_id(record.get('id'))
    if (not isinstance(record.get('displayName'), str) or not record['displayName'].strip()
            or len(record['displayName']) > 256
            or record.get('description') is not None and not isinstance(record['description'], str)
            or not isinstance(record.get('groupTypes'), list)
            or any(not isinstance(kind, str) for kind in record['groupTypes'])
            or type(record.get('securityEnabled')) is not bool
            or type(record.get('mailEnabled')) is not bool):
        raise directory.DirectoryError('invalid_listing')
    kind = ('Microsoft 365 group' if 'Unified' in record['groupTypes'] else
            'Mail-enabled security group' if record['securityEnabled'] and record['mailEnabled'] else
            'Security group' if record['securityEnabled'] else 'Distribution list')
    return {'id': oid, 'name': record['displayName'], 'description': (record.get('description') or '')[:2000], 'kind': kind}


def fetch(path, params, **kwargs):
    return directory.graph_fetch('https://graph.microsoft.com' + path + '?' + urlencode(params),
        path=path, headers={'ConsistencyLevel': 'eventual'},
        permission_code='group_permission', missing_code='group_missing', **kwargs)


def read_group(oid, **transport):
    oid = object_id(oid)
    result = group_record(fetch('/v1.0/groups/' + oid, {'$select': GROUP_FIELDS}, single=True, **transport))
    if result['id'] != oid:
        raise directory.DirectoryError('invalid_listing')
    return result


def search_groups(query, **transport):
    query = query.strip()[:200]
    try:
        oid = str(UUID(query))
    except ValueError:
        # Search syntax is never accepted from the caller. Keep Unicode letters,
        # numbers and spaces; strip operators, quotes, slashes and control chars.
        query = ' '.join(re.sub(r'[^\w\s]', ' ', query, flags=re.UNICODE).split())
        if len(query) < 2:
            return []
        records = fetch('/v1.0/groups', {'$search': '"displayName:' + query + '"',
            '$select': GROUP_FIELDS, '$top': 20}, limit=20, truncate=True, **transport)
        groups = [group_record(record) for record in records]
        if len({g['id'] for g in groups}) != len(groups):
            raise directory.DirectoryError('invalid_listing')
        return sorted(groups, key=lambda g: (g['name'].casefold(), g['id']))
    return [read_group(oid, **transport)]


def member_ids(oid, **transport):
    path = '/v1.0/groups/' + object_id(oid) + '/transitiveMembers/microsoft.graph.user'
    records = fetch(path, {'$select': 'id', '$top': 999, '$count': 'true'}, limit=50000, **transport)
    ids = set()
    for record in records:
        if not isinstance(record, dict):
            raise directory.DirectoryError('invalid_listing')
        # Ignore explicitly typed non-users; the cast endpoint normally excludes them.
        kind = record.get('@odata.type', '#microsoft.graph.user')
        if kind in ('#microsoft.graph.device', '#microsoft.graph.orgContact',
                    '#microsoft.graph.servicePrincipal', '#microsoft.graph.group'):
            continue
        if kind != '#microsoft.graph.user':
            raise directory.DirectoryError('invalid_listing')
        oid = object_id(record.get('id'))
        if oid in ids:
            raise directory.DirectoryError('invalid_listing')
        ids.add(oid)
    return ids


def membership_plan(ids, tenant, group=None):
    subjects = {f'{tenant}:{oid}'.casefold() for oid in ids}
    desired = {pk for pk, subject in User.objects.exclude(entra_subject=None).values_list('pk', 'entra_subject')
               if subject.casefold() in subjects}
    current = set(group.memberships.values_list('user_id', flat=True)) if group else set()
    counts = {'entra_members': len(ids), 'with_account': len(desired), 'to_add': len(desired - current),
              'to_remove': len(current - desired), 'without_account': len(ids) - len(desired),
              'current_members': len(current)}
    return counts, desired, current


def revision(group):
    return [group.entra_group_id, group.updated_at.isoformat()] if group else None


def check_link(group, oid, mode):
    if mode == 'link' and group and group.entra_group_id:
        raise LinkConflict('This training group is already linked to Microsoft Entra.')
    if mode == 'sync' and (not group or not group.entra_group_id or group.entra_group_id.casefold() != oid):
        raise LinkConflict()
    other = TrainingGroup.objects.filter(entra_group_id__iexact=oid)
    if group:
        other = other.exclude(pk=group.pk)
    other = other.first()
    if other:
        raise LinkConflict('This Entra group is already linked to training group {name}.', name=other.name)


def receipt(actor, group, name, info, ids, tenant, counts, desired, current):
    # A signed token is readable: hash all identity sets, including unknown IDs.
    digest = hashlib.sha256(json.dumps([sorted(ids), sorted(desired), sorted(current)], separators=(',', ':')).encode()).hexdigest()
    return {'actor': actor.pk, 'group': group.pk if group else None, 'name': name,
            'entra': info, 'tenant': tenant, 'revision': revision(group), 'digest': digest, 'counts': counts}


def save_result(group, status, counts, actor, code=None, *, linked=False):
    now = timezone.now()
    group.entra_sync_result = {'status': status, 'code': code, 'counts': counts, 'at': now.isoformat()}
    if status == 'ok':
        group.entra_last_synced_at = now
    group.save(update_fields=['entra_group_id', 'entra_display_name', 'entra_last_synced_at', 'entra_sync_result', 'updated_at'])
    action = 'group.entra_linked' if linked else 'group.entra_' + status
    detail = {**counts, 'code': code} if status == 'error' else counts
    audit(actor, action, group.pk, detail)
    return group.entra_sync_result


def record_failure(group, before, actor, code):
    if not group or not group.entra_group_id:
        return
    from .groups import lock_groups
    with transaction.atomic():
        rows = TrainingGroup.objects.filter(pk=group.pk)
        if not rows.exists():
            return
        locked = lock_groups([group.pk])[0]
        if revision(locked) == before:
            save_result(locked, 'error', {'current_members': locked.memberships.count()}, actor, code)


def apply_members(group, desired, current, actor):
    group.memberships.filter(user_id__in=current - desired).delete()
    TrainingGroupMembership.objects.bulk_create([
        TrainingGroupMembership(group=group, user_id=pk, added_by=actor) for pk in sorted(desired - current)
    ], batch_size=500)


def preview_or_apply(*, actor, oid, group=None, name='', mode='link', apply=False, preview='', **transport):
    from .groups import GroupInput, lock_groups
    deadline = time.monotonic() + 90
    transport['deadline'] = min(deadline, transport['deadline']) if transport.get('deadline') is not None else deadline
    oid = object_id(oid)
    check_link(group, oid, mode)
    before = revision(group)
    try:
        info = read_group(oid, **transport)
        ids = member_ids(oid, **transport)
        tenant = directory.tenant_id()
    except directory.DirectoryError as exc:
        record_failure(group, before, actor, exc.code)
        raise
    if not group:
        serializer = GroupInput(data={'name': name or info['name'][:100]})
        if not serializer.is_valid():
            if apply:
                raise LinkConflict()
            serializer.is_valid(raise_exception=True)
        name = serializer.validated_data['name']
    with transaction.atomic():
        if group:
            group = lock_groups([group.pk])[0]
            if revision(group) != before:
                raise LinkConflict()
        check_link(group, oid, mode)
        counts, desired, current = membership_plan(ids, tenant, group)
        expected = receipt(actor, group, name, info, ids, tenant, counts, desired, current)
        if not apply:
            return {'counts': counts, 'entra': info, 'name': name, 'preview': signing.dumps(expected, salt='entra-group')}
        try:
            previous = signing.loads(preview, salt='entra-group', max_age=900)
        except signing.BadSignature:
            previous = None
        if previous != expected:
            raise LinkConflict()
        if not group:
            group = TrainingGroup.objects.create(name=name, created_by=actor)
            audit(actor, 'group.created', group.pk, {'created': 1})
        group.entra_group_id, group.entra_display_name = oid, info['name']
        apply_members(group, desired, current, actor)
        result = save_result(group, 'ok', counts, actor, linked=mode == 'link')
        return {'id': group.pk, **result}


def sync_one(group, *, actor=None, dry_run=False, deadline=None, **transport):
    from .groups import lock_groups
    before = revision(group)
    try:
        info = read_group(group.entra_group_id, deadline=deadline, **transport)
        ids = member_ids(group.entra_group_id, deadline=deadline, **transport)
        tenant = directory.tenant_id()
        with transaction.atomic():
            locked = lock_groups([group.pk])[0]
            if revision(locked) != before:
                raise LinkConflict()
            counts, desired, current = membership_plan(ids, tenant, locked)
            guarded = len(current) >= 10 and counts['to_remove'] > len(current) / 2
            status = 'guard' if guarded else 'ok'
            if not dry_run:
                if not guarded:
                    apply_members(locked, desired, current, actor or locked.created_by)
                locked.entra_display_name = info['name']
                save_result(locked, status, counts, actor)
            return 'guarded' if guarded else 'synced' if current != desired else 'unchanged'
    except Exception as exc:
        if isinstance(exc, directory.GraphDeadlineExceeded) and deadline is not None and exc.deadline == deadline:
            return 'deferred'
        code = exc.code if isinstance(exc, directory.DirectoryError) else 'conflict' if isinstance(exc, LinkConflict) else 'failed'
        # Do not log exceptions or provider/SQL messages, even in DEBUG.
        if not dry_run:
            try:
                record_failure(group, before, actor, code)
            except Exception:
                pass  # A broken database must not fail the directory run.
        logging.getLogger(__name__).warning('Entra group sync failed: %s', code)
        return 'failed'


def sync_all(*, actor=None, group_ids=None, dry_run=False, deadline=None, **transport):
    counts = dict(synced=0, unchanged=0, failed=0, guarded=0, deferred=0)
    try:
        groups = TrainingGroup.objects.exclude(entra_group_id=None).select_related('created_by').order_by(F('entra_last_synced_at').asc(nulls_first=True), 'pk')
        if group_ids is not None:
            groups = groups.filter(pk__in=group_ids)
        for group in groups:
            if deadline is not None and deadline - time.monotonic() < 10:
                counts['deferred'] += 1
                continue
            counts[sync_one(group, actor=actor, dry_run=dry_run, deadline=deadline, **transport)] += 1
    except Exception:
        counts['failed'] += 1
        logging.getLogger(__name__).warning('Entra group sync failed: failed')
    return counts
