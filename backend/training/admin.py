from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
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


@admin.register(User)
class EnterpriseUserAdmin(UserAdmin):
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
