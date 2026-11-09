import hashlib
import secrets
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from .i18n import translate
from .question_rules import numeric_matches, text_matches
from .models import (
    Attempt,
    AttemptBudget,
    AuditEvent,
    Exam,
    Identity,
    Invitation,
    LearningAssignment,
    User,
)


def audit(actor, action, target, detail=None):
    AuditEvent.objects.create(
        actor=actor if actor and actor.is_authenticated else None,
        action=action,
        target=str(target),
        detail=detail or {},
    )


def find_user(identifier):
    identifier = str(identifier).strip()
    if not identifier:
        return None
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
        raise ValidationError(
            translate(
                "This account has multiple historical guest identities. Ask an administrator to merge the assessment records first."
            )
        )
    if matches:
        identity = matches[0]
        if identity.user_id not in (None, user.id):
            raise ValidationError(
                translate(
                    "This participant identity is already linked to another account."
                )
            )
        identity.user = user
        identity.save(update_fields=["user"])
        return identity
    return Identity.objects.create(
        key=keys[0], user=user, label=user.display_name or user.username
    )


def resolve_identity(key):
    key = str(key).strip().casefold()
    if not key or len(key) > 254:
        raise ValidationError(translate("Provide a valid email or account."))
    user = find_user(key)
    if user:
        return identity_for_user(user)
    if "@" in key:
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.core.validators import validate_email

        try:
            validate_email(key)
        except DjangoValidationError:
            raise ValidationError(translate("Invalid email format."))
    identity, _ = Identity.objects.get_or_create(
        key=("email:" if "@" in key else "account:") + key, defaults={"label": key}
    )
    return identity


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def check_invite(invitation):
    if invitation.identity.user_id and not invitation.identity.user.is_active:
        raise PermissionDenied(translate("This participant account is disabled."))
    if invitation.revoked or invitation.expires_at <= timezone.now():
        raise PermissionDenied(translate("This invitation is expired or disabled."))


def invitation_from_token(token):
    invitation = (
        Invitation.objects.select_related("exam", "identity")
        .filter(token_hash=hash_token(str(token)))
        .first()
    )
    if not invitation:
        raise PermissionDenied(translate("This invitation link is invalid."))
    check_invite(invitation)
    return invitation


def in_exam_audience(exam, user):
    """Audience rules govern account starts; an invitation is an explicit grant."""
    if not user or not user.is_active:
        return False
    if LearningAssignment.objects.filter(
        exam=exam, user=user, cancelled_at=None
    ).exists():
        return True
    if exam.audience == "all":
        return True
    if exam.audience == "employees":
        return user.employment == "employee"
    if exam.audience == "contractors":
        return user.employment == "contractor"
    if exam.audience == "departments":
        return bool(user.department) and user.department in exam.allowed_departments
    if exam.audience == "people":
        return any(person.pk == user.pk for person in exam.allowed_users.all())
    return False


def next_attempt_at(exam, last_started_at):
    """Yaksh measures retry spacing from the previous start, not submission."""
    if not last_started_at or not exam.retry_interval_minutes:
        return None
    return last_started_at + timedelta(minutes=exam.retry_interval_minutes)


@transaction.atomic
def start_attempt(exam_id, identity, invitation=None):
    # Lock the exam first, including first-ever budgets. PostgreSQL serializes
    # account and guest starts, even when two workers race on an absent budget.
    exam = Exam.objects.select_for_update().get(pk=exam_id)
    now = timezone.now()
    if not exam.published:
        raise PermissionDenied(translate("This exam is not open or has ended."))
    if invitation:
        invitation = Invitation.objects.select_for_update().get(pk=invitation.pk)
        check_invite(invitation)
        if invitation.exam_id != exam.id or invitation.identity_id != identity.id:
            raise PermissionDenied(
                translate("This invitation does not apply to this exam.")
            )
    active = (
        Attempt.objects.select_for_update()
        .filter(exam=exam, identity=identity, status="in_progress")
        .first()
    )
    # Lock waits can cross a deadline. Extensions and resumption use the same
    # attempt lock; a granted deadline may outlive the exam's new-start window.
    now = timezone.now()
    if active and active.deadline > now:
        return active
    if active:
        finalize(active)
    if (exam.starts_at and now < exam.starts_at) or (
        exam.ends_at and now >= exam.ends_at
    ):
        raise PermissionDenied(translate("This exam is not open or has ended."))
    if not invitation and not in_exam_audience(exam, identity.user):
        raise PermissionDenied(translate("You are not assigned to this exam."))
    budget, _ = AttemptBudget.objects.get_or_create(exam=exam, identity=identity)
    budget = AttemptBudget.objects.select_for_update().get(pk=budget.pk)
    limit = budget.limit_override or exam.max_attempts
    if budget.used >= limit:
        raise PermissionDenied(
            translate("This participant has reached the exam attempt limit.")
        )
    if invitation and invitation.used >= invitation.max_attempts:
        raise PermissionDenied(translate("This invitation has no remaining attempts."))
    last_started_at = (
        Attempt.objects.filter(exam=exam, identity=identity)
        .order_by("-number")
        .values_list("started_at", flat=True)
        .first()
    )
    eligible_at = next_attempt_at(exam, last_started_at)
    if eligible_at and now < eligible_at:
        raise PermissionDenied(
            {
                "code": "retry_wait",
                "detail": translate(
                    "The waiting period for your next attempt has not ended."
                ),
                "next_attempt_at": eligible_at.isoformat(),
                "server_time": now.isoformat(),
            }
        )
    questions = question_snapshot(exam)
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
        allow_skip=exam.allow_skip,
        deadline=deadline,
        last_seen_at=now,
    )
    audit(
        identity.user,
        "attempt.started",
        attempt.id,
        {"exam": exam.id, "number": budget.used},
    )
    return attempt


def question_snapshot(exam):
    """Freeze one randomized paper for participant and instructor trials alike."""
    questions = list(
        exam.questions.values(
            "id",
            "description",
            "type",
            "options",
            "solution",
            "answer_tolerances",
            "answer_matching",
            "points",
        )
    )
    if not questions:
        raise ValidationError(translate("This exam has no questions yet."))
    random = secrets.SystemRandom()
    if exam.questions_per_attempt is not None:
        if not 1 <= exam.questions_per_attempt <= len(questions):
            raise ValidationError(
                translate(
                    "Questions per attempt must be between 1 and the question pool size."
                )
            )
        selected = set(random.sample(range(len(questions)), exam.questions_per_attempt))
        questions = [q for index, q in enumerate(questions) if index in selected]
    if exam.shuffle_questions:
        random.shuffle(questions)
    for question in questions:
        if question["type"] == "ordering" or (
            exam.shuffle_options and question["type"] in ("single", "multiple")
        ):
            order = list(range(len(question["options"])))
            random.shuffle(order)
            question["options"] = [question["options"][i] for i in order]
            question["solution"] = [order.index(i) for i in question["solution"]]
    return questions


def question_points(question, answer, manual_grade=None):
    """One grading rule shared by attempt scoring and reporting."""
    if manual_grade is not None and manual_grade.get("points") is not None:
        return manual_grade["points"]
    if question["type"] == "essay":
        return None
    if question["type"] in ("integer", "numeric"):
        return question["points"] if numeric_matches(question, answer) else 0
    if question["type"] == "ordering":
        return (
            question["points"]
            if (
                isinstance(answer, list)
                and all(type(value) is int for value in answer)
                and answer == question["solution"]
            )
            else 0
        )
    if question["type"] in ("single", "multiple"):
        submitted = (
            answer
            if isinstance(answer, list)
            else [answer]
            if answer is not None
            else []
        )
        if set(str(value) for value in submitted) == set(
            str(value) for value in question["solution"]
        ):
            return question["points"]
    elif question["type"] == "short":
        return question["points"] if text_matches(question, answer) else 0
    return 0


def grade(attempt):
    earned, total, pending = 0, 0, False
    for question in attempt.snapshot:
        total += question["points"]
        key = str(question["id"])
        points = question_points(
            question, attempt.answers.get(key), attempt.manual_grades.get(key)
        )
        if points is None:
            pending = True
        else:
            earned += points
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


def finalize_if_expired(attempt):
    """Recheck under the caller's row lock, including after any lock wait."""
    if attempt.status == "in_progress" and attempt.deadline <= timezone.now():
        finalize(attempt)
        return True
    return False


def validate_answers(answers, snapshot):
    if not isinstance(answers, dict) or len(answers) > len(snapshot):
        raise ValidationError(translate("Invalid answer format."))
    valid = {str(q["id"]): q for q in snapshot}
    for key, value in answers.items():
        if key not in valid:
            raise ValidationError(
                translate("The answers contain questions outside this attempt.")
            )
        q = valid[key]
        if q["type"] in ("integer", "numeric"):
            # Preserve incomplete input (e.g. '-' or '1e') during autosave.
            # Invalid numeric expressions receive zero credit when submitted.
            if not isinstance(value, str) or len(value) > 128:
                raise ValidationError(
                    translate("Numeric answers must be text of at most 128 characters.")
                )
        elif q["type"] in ("short", "essay"):
            if not isinstance(value, str) or len(value) > 20000:
                raise ValidationError(
                    translate("The text answer exceeds the length limit.")
                )
        else:
            values = value if isinstance(value, list) else [value]
            if q["type"] == "single" and len(values) > 1:
                raise ValidationError(
                    translate("Select only one answer for a single-choice question.")
                )
            if any(
                type(v) is not int or v < 0 or v >= len(q["options"]) for v in values
            ):
                raise ValidationError(translate("This option does not exist."))
            if q["type"] == "ordering" and (
                not isinstance(value, list)
                or (value and sorted(value) != list(range(len(q["options"]))))
            ):
                raise ValidationError(
                    translate(
                        "An ordering answer must contain every item exactly once."
                    )
                )
    return answers


def answer_provided(value):
    # Presence is separate from correctness. Invalid numeric drafts still grade
    # as zero; a selection at index zero must count as an answer.
    return (
        bool(value.strip())
        if isinstance(value, str)
        else bool(value)
        if isinstance(value, list)
        else type(value) is int
    )


def available_question_count(attempt):
    return (
        len(attempt.snapshot)
        if attempt.allow_skip
        else min(attempt.unlocked_question_count, len(attempt.snapshot))
    )


def record_answers(attempt, answers, *, submitting=False):
    """Caller holds the attempt lock. Validate before changing any saved state."""
    available = available_question_count(attempt)
    answers = validate_answers(answers, attempt.snapshot[:available])
    if (
        submitting
        and not attempt.allow_skip
        and any(
            not answer_provided(answers.get(str(question["id"])))
            for question in attempt.snapshot
        )
    ):
        raise ValidationError(
            {
                "code": "answers_required",
                "detail": translate(
                    "Answer every question before submitting this exam."
                ),
            }
        )
    attempt.answers = answers
    attempt.answer_revision += 1
    if not attempt.allow_skip and all(
        answer_provided(answers.get(str(question["id"])))
        for question in attempt.snapshot[:available]
    ):
        attempt.unlocked_question_count = min(available + 1, len(attempt.snapshot))
    fields = ["answers", "answer_revision", "unlocked_question_count"]
    if isinstance(attempt, Attempt):
        attempt.last_saved_at = attempt.last_seen_at = timezone.now()
        fields += ["last_saved_at", "last_seen_at"]
    attempt.save(update_fields=fields)


def public_attempt(attempt, *, for_review=False):
    active = attempt.status == "in_progress"
    review_available = not active and (for_review or attempt.exam.allow_response_review)
    visible = active or review_available
    questions = (
        attempt.snapshot
        if not active
        else attempt.snapshot[: available_question_count(attempt)]
    )
    return {
        "id": str(attempt.id),
        "exam_id": attempt.exam_id,
        "title": attempt.exam.title,
        "number": attempt.number,
        "status": attempt.status,
        "deadline": attempt.deadline,
        "extra_time_minutes": getattr(attempt, "extra_time_minutes", 0),
        "server_time": timezone.now(),
        "allow_skip": attempt.allow_skip,
        "review_available": review_available,
        "question_count": len(attempt.snapshot),
        "answers": attempt.answers if visible else {},
        "answer_revision": attempt.answer_revision,
        "grading_revision": getattr(attempt, "grading_revision", 0),
        "questions": [
            {
                k: v
                for k, v in q.items()
                if k not in ("solution", "answer_tolerances", "answer_matching")
            }
            for q in questions
        ]
        if visible
        else [],
        "score": attempt.score if attempt.status == "graded" else None,
        "passed": attempt.passed,
        "pass_score": attempt.pass_score,
        "manual_grades": attempt.manual_grades if visible else {},
    }


def apply_manual_grades(attempt, marks):
    if not isinstance(marks, dict):
        raise ValidationError(translate("Invalid grading format."))
    essay = {str(q["id"]): q for q in attempt.snapshot if q["type"] == "essay"}
    for key, mark in marks.items():
        if (
            key not in essay
            or not isinstance(mark, dict)
            or type(mark.get("points")) not in (int, float)
            or not 0 <= mark["points"] <= essay[key]["points"]
            or len(str(mark.get("feedback", ""))) > 5000
        ):
            raise ValidationError(
                translate(
                    "The written-response score exceeds its points or the question does not exist."
                )
            )
    attempt.manual_grades.update(
        {
            key: {"points": mark["points"], "feedback": str(mark.get("feedback", ""))}
            for key, mark in marks.items()
        }
    )
    if isinstance(attempt, Attempt):
        attempt.grading_revision += 1
    grade(attempt)
    attempt.save()
