"""Shared bounded directory queries for People and training audience pickers."""

from .access import system_admin
from django.db.models import Q
from rest_framework.exceptions import ValidationError
from .i18n import translate
from .models import User


def filter_people(qs, params):
    search = params.get('search', '').strip()[:200]
    if search:
        qs = qs.filter(Q(display_name__icontains=search) | Q(email__icontains=search)
                       | Q(department__icontains=search) | Q(employee_id__icontains=search)
                       | Q(username__icontains=search))
    if params.get('status') in ('active', 'inactive', 'disabled'):
        qs = qs.filter(is_active=params['status'] == 'active')
    if params.get('signed_in') in ('yes', 'no'):
        qs = qs.filter(last_login__isnull=params['signed_in'] == 'no')
    if params.get('department'):
        qs = qs.filter(department=params['department'])
    if params.get('role') in User.Role.values:
        qs = qs.filter(role=params['role'])
    if params.get('group'):
        try:
            group_id = int(params['group'])
            if group_id < 1:
                raise ValueError()
        except (ValueError, TypeError):
            raise ValidationError(translate('Invalid people query.')) from None
        qs = qs.filter(training_group_memberships__group_id=group_id)
    if params.get('ids'):
        try:
            ids = params['ids'].split(',')
            if len(ids) > 100:
                raise ValueError()
            qs = qs.filter(pk__in=[int(value) for value in ids])
        except ValueError:
            raise ValidationError(translate('Invalid people query.')) from None
    return qs


def filter_audience_people(qs, params, user):
    """Instructor picker queries can reveal only the fields returned by that picker."""
    if system_admin(user):
        return filter_people(qs, params)
    if set(params) - {'search', 'department', 'page', 'page_size'}:
        raise ValidationError(translate('Invalid people query.'))
    search = params.get('search', '').strip()[:200]
    if search:
        qs = qs.filter(Q(display_name__icontains=search) | Q(username__icontains=search)
                       | Q(department__icontains=search))
    if params.get('department'):
        qs = qs.filter(department=params['department'])
    return qs


def page_people(qs, params):
    try:
        page = max(1, int(params.get('page', 1)))
        page_size = min(100, max(1, int(params.get('page_size', 50))))
    except (ValueError, TypeError):
        raise ValidationError(translate('Invalid people query.')) from None
    total = qs.count()
    offset = (page - 1) * page_size
    return qs[offset:offset + page_size], {'total': total, 'page': page, 'page_size': page_size}


def departments(active_only=False):
    qs = User.objects.filter(is_active=True) if active_only else User.objects.all()
    return list(qs.exclude(department='').order_by('department').values_list('department', flat=True).distinct())
