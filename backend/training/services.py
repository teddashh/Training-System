import hashlib
import secrets
from datetime import timedelta
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied
from .models import User, Identity, Exam, AttemptBudget, Invitation, Attempt, AuditEvent


def audit(actor, action, target, detail=None):
    AuditEvent.objects.create(
        actor=actor if actor and actor.is_authenticated else None,
        action=action,
        target=str(target),
        detail=detail or {},
    )


def find_user(identifier):
    identifier = str(identifier).strip()
    return User.objects.filter(
        Q(email__iexact=identifier)
        | Q(username__iexact=identifier)
        | Q(employee_id__iexact=identifier)
    ).first()


def identity_for_user(user):
    identity = Identity.objects.filter(user=user).first()
    if identity:
        return identity
    keys = [f"account:{user.username.casefold()}"]
    if user.employee_id:
        keys.append(f"account:{user.employee_id.casefold()}")
    if user.email:
        keys.insert(0, f"email:{user.email.casefold()}")
    matches = list(Identity.objects.filter(key__in=keys))
    if len(matches) > 1:
        raise ValidationError("此帳號有多個歷史訪客身分，請管理員先合併評量紀錄。")
    if matches:
        identity = matches[0]
        if identity.user_id not in (None, user.id):
            raise ValidationError("受測者身分已綁定其他帳號。")
        identity.user = user
        identity.save(update_fields=["user"])
        return identity
    return Identity.objects.create(
        key=keys[0], user=user, label=user.display_name or user.username
    )


def resolve_identity(key):
    key = str(key).strip().casefold()
    if not key or len(key) > 254:
        raise ValidationError("請提供有效的 E-mail 或帳號。")
    user = find_user(key)
    if user:
        return identity_for_user(user)
    if "@" in key:
        from django.core.validators import validate_email
        from django.core.exceptions import ValidationError as DjangoValidationError

        try:
            validate_email(key)
        except DjangoValidationError:
            raise ValidationError("E-mail 格式不正確。")
    identity, _ = Identity.objects.get_or_create(
        key=("email:" if "@" in key else "account:") + key, defaults={"label": key}
    )
    return identity


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def check_invite(invitation):
    if invitation.revoked or invitation.expires_at <= timezone.now():
        raise PermissionDenied("邀請已過期或停用。")


def invitation_from_token(token):
    invitation = (
        Invitation.objects.select_related("exam", "identity")
        .filter(token_hash=hash_token(str(token)))
        .first()
    )
    if not invitation:
        raise PermissionDenied("邀請連結無效。")
    check_invite(invitation)
    return invitation


@transaction.atomic
def start_attempt(exam_id, identity, invitation=None):
    # Lock the exam first, including first-ever budgets. PostgreSQL serializes
    # account and guest starts, even when two workers race on an absent budget.
    exam = Exam.objects.select_for_update().get(pk=exam_id)
    now = timezone.now()
    if (
        not exam.published
        or (exam.starts_at and now < exam.starts_at)
        or (exam.ends_at and now >= exam.ends_at)
    ):
        raise PermissionDenied("此考試尚未開放或已結束。")
    if invitation:
        invitation = Invitation.objects.select_for_update().get(pk=invitation.pk)
        check_invite(invitation)
        if invitation.exam_id != exam.id or invitation.identity_id != identity.id:
            raise PermissionDenied("邀請不適用此考試。")
    active = Attempt.objects.filter(
        exam=exam, identity=identity, status="in_progress"
    ).first()
    if active and active.deadline > now:
        return active
    if active:
        finalize(active)
    budget, _ = AttemptBudget.objects.get_or_create(exam=exam, identity=identity)
    budget = AttemptBudget.objects.select_for_update().get(pk=budget.pk)
    limit = budget.limit_override or exam.max_attempts
    if budget.used >= limit:
        raise PermissionDenied("已達此受測者的考試次數上限。")
    if invitation and invitation.used >= invitation.max_attempts:
        raise PermissionDenied("此邀請連結的考試次數已用完。")
    questions = list(
        exam.questions.values(
            "id", "description", "type", "options", "solution", "points"
        )
    )
    if not questions:
        raise ValidationError("考試尚未設定題目。")
    deadline = now + timedelta(minutes=exam.duration_minutes)
    if exam.ends_at:
        deadline = min(deadline, exam.ends_at)
    budget.used += 1
    budget.save(update_fields=["used"])
    if invitation:
        invitation.used += 1
        invitation.save(update_fields=["used"])
    attempt = Attempt.objects.create(
        exam=exam,
        identity=identity,
        invitation=invitation,
        number=budget.used,
        snapshot=questions,
        pass_score=exam.pass_score,
        deadline=deadline,
    )
    audit(
        identity.user,
        "attempt.started",
        attempt.id,
        {"exam": exam.id, "number": budget.used},
    )
    return attempt


def grade(attempt):
    earned, total, pending = 0, 0, False
    for q in attempt.snapshot:
        total += q["points"]
        answer = attempt.answers.get(str(q["id"]))
        if q["type"] == "essay":
            mark = attempt.manual_grades.get(str(q["id"]))
            if mark is None:
                pending = True
            else:
                earned += mark["points"]
        elif q["type"] in ("single", "multiple"):
            submitted = (
                answer
                if isinstance(answer, list)
                else [answer]
                if answer is not None
                else []
            )
            if set(str(v) for v in submitted) == set(str(v) for v in q["solution"]):
                earned += q["points"]
        elif q["type"] == "short" and isinstance(answer, str):
            if answer.strip().casefold() in [
                str(v).strip().casefold() for v in q["solution"]
            ]:
                earned += q["points"]
    attempt.score = round(earned / total * 100, 2) if total else 0
    attempt.status = "pending_review" if pending else "graded"
    attempt.passed = None if pending else attempt.score >= attempt.pass_score


def finalize(attempt):
    if attempt.status != "in_progress":
        return attempt
    grade(attempt)
    attempt.submitted_at = timezone.now()
    attempt.save()
    audit(
        attempt.identity.user, "attempt.submitted", attempt.id, {"score": attempt.score}
    )
    return attempt


def validate_answers(answers, snapshot):
    if not isinstance(answers, dict) or len(answers) > len(snapshot):
        raise ValidationError("答案格式不正確。")
    valid = {str(q["id"]): q for q in snapshot}
    for key, value in answers.items():
        if key not in valid:
            raise ValidationError("答案包含非本次試卷題目。")
        q = valid[key]
        if q["type"] in ("short", "essay"):
            if not isinstance(value, str) or len(value) > 20000:
                raise ValidationError("文字答案超過限制。")
        else:
            values = value if isinstance(value, list) else [value]
            if q["type"] == "single" and len(values) > 1:
                raise ValidationError("單選題只能選一個答案。")
            if any(
                type(v) is not int or v < 0 or v >= len(q["options"]) for v in values
            ):
                raise ValidationError("選項不存在。")
    return answers


def public_attempt(attempt):
    return {
        "id": str(attempt.id),
        "exam_id": attempt.exam_id,
        "title": attempt.exam.title,
        "number": attempt.number,
        "status": attempt.status,
        "deadline": attempt.deadline,
        "server_time": timezone.now(),
        "answers": attempt.answers,
        "questions": [
            {k: v for k, v in q.items() if k != "solution"} for q in attempt.snapshot
        ],
        "score": attempt.score if attempt.status == "graded" else None,
        "passed": attempt.passed,
        "pass_score": attempt.pass_score,
        "manual_grades": attempt.manual_grades,
    }
