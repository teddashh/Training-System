"""Scoped invitation history and atomic, retryable cohort issuance."""

import csv
import hashlib
import io
import json
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError as InvalidEmail
from django.core.paginator import Paginator
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import (
    Case,
    CharField,
    DateTimeField,
    DurationField,
    ExpressionWrapper,
    IntegerField,
    Exists,
    F,
    OuterRef,
    Q,
    Subquery,
    Value,
    When,
)
from django.db.models.functions import Cast, Coalesce, Greatest, Least
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from .i18n import translate
from .models import Attempt, AttemptBudget, Exam, Invitation, InvitationBatch
from .serializers import InvitationSerializer
from .services import audit, hash_token, resolve_identity
from .access import can_invite, require_invite, scope_q


class InvitationOptions(serializers.Serializer):
    exam = serializers.IntegerField(min_value=1)
    max_attempts = serializers.IntegerField(min_value=1, max_value=100, default=1)
    days = serializers.IntegerField(min_value=1, max_value=90, default=7)
    require_email_verification = serializers.BooleanField(default=False)


class BatchInput(InvitationOptions):
    require_email_verification = serializers.BooleanField(default=True)
    csv = serializers.CharField(max_length=262144, trim_whitespace=False)
    apply = serializers.BooleanField(default=False)
    request_id = serializers.UUIDField(required=False)

    def validate(self, values):
        if values["apply"] and not values.get("request_id"):
            raise ValidationError(
                translate("A request ID is required to issue a batch.")
            )
        return values


class InvitationFilters(serializers.Serializer):
    search = serializers.CharField(max_length=200, allow_blank=True, default="")
    exam = serializers.IntegerField(min_value=1, required=False)
    status = serializers.ChoiceField(
        choices=[
            "",
            "active",
            "resume_only",
            "exhausted",
            "revoked",
            "expired",
            "blocked",
        ],
        default="",
    )
    page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=25)


def recipient(key, required, override=""):
    identity = resolve_identity(key)
    if identity.user_id and not identity.user.is_active:
        raise ValidationError(translate("This participant account is disabled."))
    email = ""
    if required:
        email = str(override).strip().casefold()
        if not email:
            email = (
                identity.user.email
                if identity.user_id
                else identity.key.removeprefix("email:")
                if identity.key.startswith("email:")
                else ""
            )
        try:
            validate_email(email)
        except InvalidEmail:
            raise ValidationError(
                translate("A valid recipient email is required for verification.")
            )
    return identity, email


def batch_rows(content):
    if len(content.encode("utf-8")) > 262144:
        raise ValidationError(
            translate("The invitation CSV must be 256 KB or smaller.")
        )
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")), strict=True)
    try:
        headers = reader.fieldnames or []
        if (
            "key" not in headers
            or len(headers) != len(set(headers))
            or set(headers) - {"key", "verification_email"}
        ):
            raise ValidationError(
                translate(
                    "Use key and optional verification_email as unique CSV headers."
                )
            )
        rows = []
        for row in reader:
            rows.append(row)
            if len(rows) > 200:
                break
    except csv.Error:
        raise ValidationError(translate("The CSV file is malformed."))
    if not 1 <= len(rows) <= 200:
        raise ValidationError(
            translate("Issue invitations for 1 to 200 participants at a time.")
        )
    return rows


def batch_token(batch, invitation):
    # Replay needs the creator's authenticated session, exact request UUID and
    # matching payload within ten minutes. Only token hashes persist in storage.
    return salted_hmac(
        "training.invitation.batch.v1",
        f"{batch.pk}:{invitation.pk}",
        algorithm="sha256",
    ).hexdigest()


def new_invitation(exam, identity, email, options, actor, batch=None):
    item = Invitation(
        id=uuid.uuid4(),
        batch=batch,
        exam=exam,
        identity=identity,
        max_attempts=options["max_attempts"],
        expires_at=timezone.now() + timedelta(days=options["days"]),
        created_by=actor,
        require_email_verification=options["require_email_verification"],
        verification_email=email,
    )
    token = batch_token(batch, item) if batch else secrets.token_urlsafe(32)
    item.token_hash = hash_token(token)
    item.save()
    audit(actor, "invitation.created", item.pk, {"exam": exam.pk})
    return item, token


class Invitations(viewsets.ReadOnlyModelViewSet):
    serializer_class = InvitationSerializer

    def get_queryset(self):
        if not can_invite(self.request.user):
            raise PermissionDenied()
        now = timezone.now()
        budget = AttemptBudget.objects.filter(
            exam_id=OuterRef("exam_id"), identity_id=OuterRef("identity_id")
        )
        active = Attempt.objects.filter(
            exam_id=OuterRef("exam_id"),
            identity_id=OuterRef("identity_id"),
            status="in_progress",
            deadline__gt=now,
        )
        participant_attempts = Attempt.objects.filter(exam_id=OuterRef('exam_id'), identity_id=OuterRef('identity_id'))
        unfinished_round = participant_attempts.filter(number__gt=OuterRef('budget_round_start')).exclude(status='graded', passed=False, graded_at__isnull=False)
        qs = (
            Invitation.objects.select_related("exam", "identity", "identity__user")
            .annotate(
                budget_round_start=Coalesce(Subquery(budget.values('round_start_used')[:1]), Value(0)),
                budget_used=Coalesce(Subquery(budget.values("used")[:1]), Value(0)) - Coalesce(Subquery(budget.values('round_start_used')[:1]), Value(0)),
                budget_limit=Coalesce(
                    Subquery(budget.values("limit_override")[:1]),
                    F("exam__max_attempts"),
                ),
                can_resume=Exists(active),
            )
            .annotate(
                round_unfinished=Exists(unfinished_round),
                has_passed=Exists(participant_attempts.filter(passed=True)),
                last_graded=Subquery(participant_attempts.order_by('-graded_at').values('graded_at')[:1]),
            )
            # SQLite's duration arithmetic recognizes IntegerField, not its
            # PositiveIntegerField subclass. Cast explicitly for both backends.
            .annotate(round_wait=ExpressionWrapper(
                Cast('exam__attempt_reset_minutes', IntegerField()) * timedelta(minutes=1),
                output_field=DurationField(),
            ))
            .annotate(round_opens=ExpressionWrapper(
                F('last_graded') + F('round_wait'), output_field=DateTimeField(),
            ))
            .annotate(budget_available=Case(
                When(exam__attempt_reset_minutes__gt=0, budget_used__gte=F('budget_limit'), round_unfinished=False, has_passed=False, round_opens__lte=now, then=F('budget_limit')),
                default=F('budget_limit')-F('budget_used'),
                output_field=IntegerField(),
            ))
            .annotate(
                remaining_new_attempts=Greatest(
                    Value(0),
                    Least(
                        F("max_attempts") - F("used"),
                        F('budget_available'),
                    ),
                )
            )
            .annotate(
                state=Case(
                    When(revoked=True, then=Value("revoked")),
                    When(identity__user__is_active=False, then=Value("blocked")),
                    When(expires_at__lte=now, then=Value("expired")),
                    When(
                        remaining_new_attempts=0,
                        can_resume=True,
                        then=Value("resume_only"),
                    ),
                    When(remaining_new_attempts=0, then=Value("exhausted")),
                    default=Value("active"),
                    output_field=CharField(),
                )
            )
            .order_by("-created_at", "-pk")
        )
        return qs.filter(scope_q(self.request.user, 'exams', 'exam__'))

    def list(self, request):
        filters = InvitationFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        values = filters.validated_data
        qs = self.get_queryset()
        if values.get("exam"):
            qs = qs.filter(exam_id=values["exam"])
        if values["search"]:
            term = values["search"]
            qs = qs.filter(
                Q(identity__key__icontains=term)
                | Q(identity__label__icontains=term)
                | Q(identity__user__display_name__icontains=term)
                | Q(identity__user__username__icontains=term)
                | Q(identity__user__email__icontains=term)
                | Q(identity__user__employee_id__icontains=term)
                | Q(exam__title__icontains=term)
                | Q(verification_email__icontains=term)
            )
        if values["status"]:
            qs = qs.filter(state=values["status"])
        # Keep the existing array shape for clients that have not adopted paging.
        if "page" not in request.query_params:
            return Response(self.get_serializer(qs[:1000], many=True).data)
        page = Paginator(qs, values["page_size"]).get_page(values["page"])
        return Response(
            {
                "results": self.get_serializer(page.object_list, many=True).data,
                "count": page.paginator.count,
                "page": page.number,
                "pages": page.paginator.num_pages,
            }
        )

    @action(detail=False, methods=["post"])
    def issue(self, request):
        serializer = InvitationOptions(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            exam = get_object_or_404(Exam.objects.select_for_update(), pk=data["exam"])
            require_invite(request.user, exam)
            identity, email = recipient(
                request.data.get("key", ""),
                data["require_email_verification"],
                request.data.get("verification_email", ""),
            )
            inv, token = new_invitation(exam, identity, email, data, request.user)
        response = Response(
            {
                **self.get_serializer(self.get_queryset().get(pk=inv.pk)).data,
                "url": settings.APP_ORIGIN + settings.APP_BASE_PATH + "/invite#" + token,
                "note": translate(
                    "This link is also subject to the participant's total attempt limit."
                ),
            },
            status=201,
        )
        response["Cache-Control"] = "no-store"
        return response

    def issued_batch(self, batch, replayed):
        rows = list(
            self.get_queryset().filter(batch=batch).order_by("created_at", "pk")
        )
        output = []
        for item in rows:
            token = batch_token(batch, item)
            if not secrets.compare_digest(hash_token(token), item.token_hash):
                return Response(
                    {
                        "detail": translate(
                            "The batch can no longer be recovered. Review invitation history before issuing new links."
                        )
                    },
                    status=409,
                )
            output.append(
                {
                    **self.get_serializer(item).data,
                    "url": settings.APP_ORIGIN + settings.APP_BASE_PATH + "/invite#" + token,
                }
            )
        response = Response(
            {
                "valid": True,
                "applied": True,
                "replayed": replayed,
                "count": len(output),
                "invitations": output,
            },
            status=200 if replayed else 201,
        )
        response["Cache-Control"] = "no-store"
        return response

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        serializer = BatchInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        rows = batch_rows(data["csv"])
        fingerprint = hashlib.sha256(
            json.dumps(
                {k: v for k, v in data.items() if k not in ("apply", "request_id")},
                sort_keys=True,
            ).encode()
        ).hexdigest()
        with transaction.atomic():
            exam = get_object_or_404(Exam.objects.select_for_update(), pk=data["exam"])
            require_invite(request.user, exam)
            if not exam.published:
                raise ValidationError(
                    translate("Publish the exam before issuing a batch.")
                )
            batch = None
            if data["apply"]:
                batch, created = InvitationBatch.objects.get_or_create(
                    pk=data["request_id"],
                    defaults={
                        "created_by": request.user,
                        "exam": exam,
                        "fingerprint": fingerprint,
                    },
                )
                if not created:
                    if (
                        batch.created_by_id != request.user.pk
                        or batch.fingerprint != fingerprint
                        or batch.created_at < timezone.now() - timedelta(minutes=10)
                    ):
                        return Response(
                            {
                                "detail": translate(
                                    "This request ID was already used or its recovery window has expired. Review invitation history before issuing new links."
                                )
                            },
                            status=409,
                        )
                    return self.issued_batch(batch, True)
            preview, seen = [], set()
            for number, row in enumerate(rows, start=2):
                item = {"row": number, "key": row.get("key") or "", "error": ""}
                try:
                    with transaction.atomic():
                        if None in row or any(value is None for value in row.values()):
                            raise ValidationError(
                                translate(
                                    "The number of CSV values does not match the header."
                                )
                            )
                        identity, email = recipient(
                            row["key"],
                            data["require_email_verification"],
                            row.get("verification_email", ""),
                        )
                        if identity.pk in seen:
                            raise ValidationError(
                                translate(
                                    "This participant appears more than once, possibly under another sign-in identifier."
                                )
                            )
                        seen.add(identity.pk)
                        budget = AttemptBudget.objects.filter(
                            exam=exam, identity=identity
                        ).first()
                        from .attempt_rounds import round_status
                        remaining = round_status(exam, budget)['attempts_remaining']
                        item.update(
                            identity_key=identity.key,
                            participant=identity.user.display_name
                            or identity.user.username
                            if identity.user_id
                            else identity.label,
                            verification_email=email,
                            remaining_new_attempts=max(
                                0, min(data["max_attempts"], remaining)
                            ),
                        )
                        if batch:
                            new_invitation(
                                exam, identity, email, data, request.user, batch
                            )
                except ValidationError as error:
                    item["error"] = (
                        " ".join(str(v) for v in error.detail)
                        if isinstance(error.detail, list)
                        else str(error.detail)
                    )
                preview.append(item)
            valid = not any(item["error"] for item in preview)
            if not valid or not data["apply"]:
                transaction.set_rollback(True)
                return Response(
                    {
                        "valid": valid,
                        "applied": False,
                        "count": len(rows),
                        "rows": preview,
                    }
                )
            audit(
                request.user,
                "invitation.batch_created",
                batch.pk,
                {"exam": exam.pk, "count": len(rows)},
            )
            return self.issued_batch(batch, False)

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        inv = self.get_object()
        if not inv.revoked:
            inv.revoked = True
            inv.save(update_fields=["revoked"])
            audit(request.user, "invitation.revoked", inv.pk)
        return Response({"ok": True})
