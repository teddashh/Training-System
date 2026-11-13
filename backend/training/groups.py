"""Reusable training groups. Membership affects targeting, never existing records."""
import hashlib
import logging

from django.core import signing
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response

from . import directory, entra_groups
from .i18n import translate
from .models import TrainingGroup, TrainingGroupMembership, User
from .people import departments, filter_people, page_people
from .serializers import UserSerializer
from .services import audit
from .access import people_access, system_admin


class GroupInput(serializers.ModelSerializer):
    class Meta:
        model = TrainingGroup
        fields = ['name', 'description']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise ValidationError(translate('Enter a group name.'))
        qs = TrainingGroup.objects.filter(name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise ValidationError(translate('A group with this name already exists.'))
        return value


class MemberInput(serializers.Serializer):
    user_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1, max_length=1000)


class EntraInput(serializers.Serializer):
    entra_id = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    apply = serializers.BooleanField(default=False)
    preview = serializers.CharField(required=False, allow_blank=True)


class MatchingInput(serializers.Serializer):
    filters = serializers.DictField(child=serializers.CharField(allow_blank=True), default=dict)
    apply = serializers.BooleanField(default=False)
    preview = serializers.CharField(required=False, allow_blank=True)

    def validate_filters(self, value):
        if set(value) - {'search', 'department', 'status', 'signed_in', 'role', 'group'}:
            raise ValidationError(translate('Invalid people query.'))
        if value.get('status', '') not in ('', 'all', 'active', 'inactive', 'disabled') or value.get('signed_in', '') not in ('', 'all', 'yes', 'no'):
            raise ValidationError(translate('Invalid people query.'))
        return value


def group_data(group):
    return {'id': group.pk, 'name': group.name, 'description': group.description,
            'created_by': group.created_by_id, 'created_at': group.created_at, 'updated_at': group.updated_at,
            'entra_group_id': group.entra_group_id, 'entra_display_name': group.entra_display_name,
            'entra_last_synced_at': group.entra_last_synced_at, 'entra_sync_result': group.entra_sync_result,
            'member_count': group.member_count, 'active_member_count': group.active_member_count}


def group_query():
    return TrainingGroup.objects.annotate(member_count=Count('memberships'), active_member_count=Count('memberships', filter=Q(memberships__user__is_active=True))).order_by('name', 'id')


def lock_groups(ids):
    """Call inside a transaction before setting an exam audience or expanding targets."""
    ids = set(ids)
    rows = list(TrainingGroup.objects.select_for_update().filter(pk__in=ids).order_by('pk'))
    if not ids or len(rows) != len(ids):
        raise ValidationError(translate('Select valid groups.'))
    return rows


def active_group_people(ids):
    members = TrainingGroupMembership.objects.filter(group_id__in=ids).values('user_id')
    # IN de-duplicates overlaps without DISTINCT, allowing row locks on recipients.
    return User.objects.filter(is_active=True, pk__in=members)


class TrainingGroups(viewsets.ViewSet):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not people_access(request.user):
            raise PermissionDenied()
        if self.action not in ('list', 'retrieve') and not system_admin(request.user):
            raise PermissionDenied()

    def list(self, request):
        qs = group_query()
        if request.query_params.get('manual') == 'true':
            qs = qs.filter(entra_group_id=None)
        if request.query_params.get('search'):
            qs = qs.filter(name__icontains=request.query_params['search'][:200])
        rows, pagination = page_people(qs, request.query_params)
        return Response({**pagination, 'results': [group_data(g) for g in rows]})

    def retrieve(self, request, pk=None):
        return Response(group_data(get_object_or_404(group_query(), pk=pk)))

    @transaction.atomic
    def create(self, request):
        serializer = GroupInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                group = serializer.save(created_by=request.user)
        except IntegrityError:
            raise ValidationError(translate('A group with this name already exists.')) from None
        audit(request.user, 'group.created', group.pk, {'created': 1})
        return Response(group_data(group_query().get(pk=group.pk)), status=201)

    @transaction.atomic
    def partial_update(self, request, pk=None):
        group = get_object_or_404(TrainingGroup.objects.select_for_update(), pk=pk)
        serializer = GroupInput(group, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            raise ValidationError(translate('A group with this name already exists.')) from None
        audit(request.user, 'group.updated', group.pk, {'updated': 1})
        return Response(group_data(group_query().get(pk=pk)))

    @transaction.atomic
    def destroy(self, request, pk=None):
        group = get_object_or_404(TrainingGroup.objects.select_for_update(), pk=pk)
        exams = list(group.exams.filter(audience='groups').order_by('id').values('id', 'title'))
        if exams:
            return Response({'detail': translate('This group is used by these exams: {exams}. Change their audience before deleting the group.', exams=', '.join(e['title'] for e in exams)), 'exams': exams}, status=409)
        count = group.memberships.count()
        audit(request.user, 'group.deleted', group.pk, {'deleted': 1, 'members_removed': count})
        group.delete()
        return Response(status=204)

    @action(detail=True, methods=['get', 'post'])
    @transaction.atomic
    def members(self, request, pk=None):
        group = get_object_or_404(TrainingGroup.objects.select_for_update(), pk=pk)
        if request.method == 'GET':
            qs = filter_people(group.members.all(), request.query_params).order_by('display_name', 'id')
            rows, pagination = page_people(qs, request.query_params)
            return Response({**pagination, 'results': UserSerializer(rows, many=True).data, 'departments': departments()})
        if group.entra_group_id:
            raise entra_groups.LinkConflict(entra_groups.MANUAL_MESSAGE)
        serializer = MemberInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = set(serializer.validated_data['user_ids'])
        if User.objects.filter(pk__in=ids).count() != len(ids):
            raise ValidationError(translate('Select valid people.'))
        added = self.add_members(group, ids, request.user)
        return Response({'added': added, 'requested': len(ids)})

    @staticmethod
    def add_members(group, ids, actor):
        existing = set(group.memberships.filter(user_id__in=ids).values_list('user_id', flat=True))
        new = set(ids) - existing
        TrainingGroupMembership.objects.bulk_create([
            TrainingGroupMembership(group=group, user_id=pk, added_by=actor) for pk in sorted(new)
        ], batch_size=500)
        if new:
            group.updated_at = timezone.now()
            group.save(update_fields=['updated_at'])
        audit(actor, 'group.members_added', group.pk, {'added': len(new), 'requested': len(ids)})
        return len(new)

    @action(detail=True, methods=['post'], url_path='remove-members')
    @transaction.atomic
    def remove_members(self, request, pk=None):
        group = get_object_or_404(TrainingGroup.objects.select_for_update(), pk=pk)
        if group.entra_group_id:
            raise entra_groups.LinkConflict(entra_groups.MANUAL_MESSAGE)
        serializer = MemberInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = set(serializer.validated_data['user_ids'])
        removed, _ = group.memberships.filter(user_id__in=ids).delete()
        if removed:
            group.updated_at = timezone.now()
            group.save(update_fields=['updated_at'])
        audit(request.user, 'group.members_removed', group.pk, {'removed': removed, 'requested': len(ids)})
        return Response({'removed': removed})

    @action(detail=True, methods=['post'], url_path='matching-members')
    @transaction.atomic
    def matching_members(self, request, pk=None):
        group = get_object_or_404(TrainingGroup.objects.select_for_update(), pk=pk)
        if group.entra_group_id:
            raise entra_groups.LinkConflict(entra_groups.MANUAL_MESSAGE)
        serializer = MatchingInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        ids = list(filter_people(User.objects.all(), data['filters']).order_by('pk').values_list('pk', flat=True))
        existing = set(group.memberships.values_list('user_id', flat=True))
        new = set(ids) - existing
        digest = hashlib.sha256(','.join(map(str, sorted(new))).encode()).hexdigest()
        receipt = {'group': group.pk, 'actor': request.user.pk, 'filters': data['filters'], 'digest': digest, 'matching': len(ids)}
        if not data['apply']:
            return Response({'matching': len(ids), 'to_add': len(new), 'preview': signing.dumps(receipt, salt='group-members')})
        try:
            previous = signing.loads(data.get('preview', ''), salt='group-members', max_age=900)
        except signing.BadSignature:
            previous = None
        if previous != receipt:
            return Response({'detail': translate('The matching people changed or the preview expired. Preview again.')}, status=409)
        added = self.add_members(group, ids, request.user)
        return Response({'matching': len(ids), 'added': added})

    @action(detail=False, methods=['get'], url_path='entra-search')
    def entra_search(self, request):
        try:
            return Response({'results': entra_groups.search_groups(request.query_params.get('search', ''))})
        except directory.DirectoryError as exc:
            return self.entra_error(exc)
        except Exception:
            logging.getLogger(__name__).warning('Entra group search failed: failed')
            return self.entra_error(directory.DirectoryError('failed'))

    @staticmethod
    def entra_error(exc):
        return Response({'code': exc.code, 'detail': translate(str(exc))},
                        status=503 if exc.code in ('not_configured', 'throttled') else 502)

    def entra_change(self, request, pk=None, mode='link'):
        serializer = EntraInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        group = get_object_or_404(TrainingGroup, pk=pk) if pk else None
        oid = group.entra_group_id if mode == 'sync' else data.get('entra_id')
        if not oid:
            raise ValidationError(translate('Select an Entra group.'))
        try:
            result = entra_groups.preview_or_apply(actor=request.user, group=group, mode=mode,
                oid=oid, name=data.get('name', ''), apply=data['apply'], preview=data.get('preview', ''))
            return Response(result, status=201 if not pk and data['apply'] else 200)
        except directory.DirectoryError as exc:
            return self.entra_error(exc)
        except IntegrityError:
            # Concurrent new-group links are arbitrated by database constraints.
            other = TrainingGroup.objects.filter(entra_group_id__iexact=str(oid)).first()
            if other:
                raise entra_groups.LinkConflict('This Entra group is already linked to training group {name}.', name=other.name) from None
            raise entra_groups.LinkConflict() from None
        except APIException:
            raise
        except Exception:
            logging.getLogger(__name__).warning('Entra group sync failed: failed')
            try:
                entra_groups.record_failure(group, entra_groups.revision(group), request.user, 'failed')
            except Exception:
                pass
            return self.entra_error(directory.DirectoryError('failed'))

    @action(detail=False, methods=['post'], url_path='entra-create')
    def entra_create(self, request):
        return self.entra_change(request)

    @action(detail=True, methods=['post'], url_path='entra-link')
    def entra_link(self, request, pk=None):
        return self.entra_change(request, pk)

    @action(detail=True, methods=['post'], url_path='entra-sync')
    def entra_sync(self, request, pk=None):
        return self.entra_change(request, pk, mode='sync')

    @action(detail=True, methods=['post'], url_path='entra-unlink')
    @transaction.atomic
    def entra_unlink(self, request, pk=None):
        group = get_object_or_404(TrainingGroup.objects.select_for_update(), pk=pk)
        if not group.entra_group_id:
            raise entra_groups.LinkConflict()
        group.entra_group_id = group.entra_display_name = None
        group.entra_last_synced_at = group.entra_sync_result = None
        group.save(update_fields=['entra_group_id', 'entra_display_name', 'entra_last_synced_at', 'entra_sync_result', 'updated_at'])
        audit(request.user, 'group.entra_unlinked', group.pk, {'members_kept': group.memberships.count()})
        return Response(group_data(group_query().get(pk=pk)))
