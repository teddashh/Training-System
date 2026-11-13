"""Read-only allowance calculation; renewal is committed by the locked start path."""

from datetime import timedelta
from django.utils import timezone
from .models import Attempt


def round_status(exam, budget, now=None, history=None):
    now = now or timezone.now()
    limit = (budget.limit_override if budget else None) or exam.max_attempts
    used = budget.used - budget.round_start_used if budget else 0
    number = budget.round_number if budget else 1
    renew_at = None
    awaiting_grading = False
    if budget and used >= limit and exam.attempt_reset_minutes:
        attempts = [a for a in history if a.number > budget.round_start_used] if history is not None else list(Attempt.objects.filter(
            exam=exam, identity_id=budget.identity_id,
            number__gt=budget.round_start_used,
        ).order_by('number'))
        awaiting_grading = any(a.status in ('in_progress', 'pending_review') for a in attempts)
        if (len(attempts) == used and attempts
                and all(a.status == 'graded' and a.passed is False and a.graded_at for a in attempts)
                and not (any(a.passed for a in history) if history is not None else Attempt.objects.filter(exam=exam, identity_id=budget.identity_id, passed=True).exists())):
            renew_at = max(a.graded_at for a in attempts) + timedelta(minutes=exam.attempt_reset_minutes)
    ready = bool(renew_at and now >= renew_at)
    return {
        'round_number': number + int(ready),
        'round_attempts_used': 0 if ready else used,
        'attempts_remaining': limit if ready else max(0, limit-used),
        'effective_attempt_limit': limit,
        'next_round_at': renew_at,
        'round_awaiting_grading': awaiting_grading,
        'renew_ready': ready,
    }
