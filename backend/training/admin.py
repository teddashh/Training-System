from .i18n import translate
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.conf import settings
from django.db import transaction
from .brand import BRAND
from .admin_forms import DirectoryUserChangeForm
from .models import (
    User,
    Course,
    Exam,
    Question,
    AttemptBudget,
    Invitation,
    Attempt,
    AuditEvent,
)

from .access import system_admin


def has_system_admin_permission(request):
    return request.user.is_active and request.user.is_staff and system_admin(request.user)


admin.site.has_permission = has_system_admin_permission
admin.site.site_header = translate("{organization} data maintenance", organization=BRAND["organization"], locale="en")
admin.site.site_title = translate("{organization} administration", organization=BRAND["organization"], locale="en")
admin.site.index_title = "Advanced data tools"
admin.site.site_url = settings.APP_BASE_PATH + "/manage"


@admin.register(User)
class EnterpriseUserAdmin(UserAdmin):
    form = DirectoryUserChangeForm

    def get_form(self, request, obj=None, **kwargs):
        base = super().get_form(request, obj, **kwargs)
        class ActorForm(base):
            actor = request.user
        return ActorForm

    @transaction.atomic
    def save_model(self, request, obj, form, change):
        if not change:
            return super().save_model(request, obj, form, change)
        current = User.objects.select_for_update().get(pk=obj.pk)
        changed = form.admin_changed_fields
        fields = []
        for field in obj._meta.concrete_fields:
            if field.name in changed and field.editable and not field.primary_key:
                setattr(current, field.attname, getattr(obj, field.attname))
                fields.append(field.name)
        if 'is_active' in fields:
            current.directory_disabled_at = None
            fields.append('directory_disabled_at')
        if fields:
            current.save(update_fields=fields)
        # Keep the form and related-save hooks attached to the current values.
        for field in obj._meta.concrete_fields:
            setattr(obj, field.attname, getattr(current, field.attname))

    fieldsets = UserAdmin.fieldsets + (
        (
            "Enterprise",
            {
                "fields": (
                    "display_name",
                    "employee_id",
                    "department",
                    "employment",
                    "role",
                    "entra_subject",
                    "edit_snapshot",
                )
            },
        ),
    )


for model in [Course, Exam, Question, AttemptBudget, Invitation, Attempt]:
    admin.site.register(model)


@admin.register(AuditEvent)
class AuditAdmin(admin.ModelAdmin):
    readonly_fields = ["actor", "action", "target", "detail", "created_at"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
