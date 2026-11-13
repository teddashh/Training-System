"""Progress is independent of assessment scores and completion status."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


def progress_percent(cmi):
    value = cmi.get("cmi.progress_measure", "")
    try:
        measure = Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not measure.is_finite() or not 0 <= measure <= 1:
        return None
    return int((measure * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
