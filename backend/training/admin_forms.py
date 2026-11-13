"""Signed original-value hashes let admin edits survive concurrent directory writes."""
import json
from datetime import datetime, timezone

from django import forms
from django.contrib.auth.forms import UserChangeForm
from django.core import signing
from django.core.serializers.json import DjangoJSONEncoder
from django.utils.crypto import salted_hmac

from .i18n import translate
from .access import role_access


def value_digest(field, value):
    if not isinstance(field, forms.ModelChoiceField):
        value = field.to_python(value)
    value = field.prepare_value(value)
    if isinstance(value, datetime):
        # GET model values may be UTC while POST values use the admin timezone.
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc)
        if not field.widget.supports_microseconds:
            value = value.replace(microsecond=0)
    if isinstance(value, (list, tuple)):
        value = sorted(value, key=str)
    encoded = json.dumps(value, cls=DjangoJSONEncoder, sort_keys=True)
    return salted_hmac('training.admin.original-value', encoded).hexdigest()


class DirectoryUserChangeForm(UserChangeForm):
    edit_snapshot = forms.CharField(widget=forms.HiddenInput, required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk and not self.is_bound:
            hashes = {name: value_digest(field, self[name].value())
                      for name, field in self.fields.items()
                      if name not in ('edit_snapshot', 'password') and not field.disabled}
            self.initial['edit_snapshot'] = signing.dumps(
                {'user': self.instance.pk, 'fields': hashes}, salt='training.admin.user-edit', compress=True)

    def clean(self):
        data = super().clean()
        self.admin_changed_fields = set()
        actor = getattr(self, 'actor', None)
        if actor and actor.pk == self.instance.pk and (
            not role_access(data.get('role', self.instance.role))['system_admin']
            or data.get('is_active') is False
        ):
            raise forms.ValidationError(translate('You cannot disable yourself or remove your own administrator role.'))
        if 'role' in data and not role_access(data['role'])['system_admin']:
            data['is_staff'] = False
            data['is_superuser'] = False
        if self.instance.pk:
            try:
                baseline = signing.loads(data.get('edit_snapshot', ''), salt='training.admin.user-edit', max_age=86400)
                if baseline['user'] != self.instance.pk:
                    raise signing.BadSignature()
                for name, digest in baseline['fields'].items():
                    if name in data and name in self.fields and value_digest(self.fields[name], data[name]) != digest:
                        self.admin_changed_fields.add(name)
            except (signing.BadSignature, KeyError, TypeError, ValueError):
                raise forms.ValidationError(translate('This edit form expired or is invalid. Reopen the account and try again.')) from None
        return data

    @property
    def changed_data(self):
        if hasattr(self, 'admin_changed_fields'):
            return sorted(self.admin_changed_fields)
        return super().changed_data

    def _save_m2m(self):
        # An unchanged stale permission selection must not undo a concurrent edit.
        original = self.cleaned_data
        if self.instance.pk:
            self.cleaned_data = {key: value for key, value in original.items() if key in self.admin_changed_fields}
        try:
            super()._save_m2m()
        finally:
            self.cleaned_data = original
