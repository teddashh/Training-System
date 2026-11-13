"""Application-level administration using the same records as learner workflows."""

from .access import system_admin

from django.conf import settings
from django.db.models import Count, Q
from django.http import HttpResponseRedirect
from django.views.decorators.http import require_GET
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import Attempt, AuditEvent, Course, Enrollment, Exam, User


@require_GET
def administration_entry(request):
    return HttpResponseRedirect(settings.APP_BASE_PATH + "/manage")


def activity_rows(limit=200):
    events = list(AuditEvent.objects.select_related("actor").order_by("-created_at", "-id")[:limit])
    models = {"course": Course, "exam": Exam, "user": User, "auth": User}
    records = {}
    for kind, model in models.items():
        ids = {int(e.target) for e in events if e.action.split(".")[0] == kind
               and e.target.isascii() and e.target.isdecimal() and len(e.target) < 19}
        records[kind] = model.objects.in_bulk(ids)
    rows = []
    for event in events:
        kind = event.action.split(".")[0]
        target = records.get(kind, {}).get(int(event.target)) if event.target.isascii() and event.target.isdecimal() and len(event.target) < 19 else None
        label, path = "", ""
        if isinstance(target, Course):
            label, path = target.title, f"/authoring?course={target.pk}&action=edit"
        elif isinstance(target, Exam):
            label, path = target.title, f"/exams?exam={target.pk}&action=edit"
        elif isinstance(target, User):
            label = target.display_name or target.email or target.username
            path = "/people"
        actor = event.actor
        rows.append({
            "id": event.pk, "actor__display_name": actor.display_name if actor else "",
            "actor_label": (actor.display_name or actor.email or actor.username) if actor else "",
            "action": event.action, "target": event.target, "detail": event.detail,
            "target_label": label, "target_path": path, "created_at": event.created_at,
        })
    return rows


@api_view(["GET"])
def overview(request):
    if not system_admin(request.user):
        raise PermissionDenied()
    courses = Course.objects.aggregate(total=Count("id"), published=Count("id", filter=Q(published=True)))
    exams = Exam.objects.aggregate(total=Count("id"), published=Count("id", filter=Q(published=True)))
    people = User.objects.aggregate(total=Count("id"), active=Count("id", filter=Q(is_active=True)))
    pending = Enrollment.objects.filter(status="pending")
    requests = list(pending.values("course_id", "course__title").annotate(count=Count("id")).order_by("-count", "course_id")[:5])
    drafts = [
        {"kind": kind, "id": obj.pk, "title": obj.title, "created_at": obj.created_at}
        for kind, model in (("course", Course), ("exam", Exam))
        for obj in model.objects.filter(published=False).order_by("-created_at", "-pk")[:5]
    ]
    drafts.sort(key=lambda row: row["created_at"], reverse=True)
    return Response({
        "courses": courses, "exams": exams, "people": people,
        "pending_enrollments": pending.count(),
        "pending_reviews": Attempt.objects.filter(status="pending_review").count(),
        "enrollment_requests": requests, "drafts": drafts[:5], "activity": activity_rows(6),
    })
