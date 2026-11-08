"""Bounded decimal parsing for assessment configuration and grading."""

from decimal import Decimal, InvalidOperation, localcontext
import re

NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
INTEGER = re.compile(r"[+-]?[0-9]+\Z")
NUMBER_ERROR = "Use a finite number with a decimal point, up to 100 significant digits and an exponent from -100 to 100."


def parse_number(value, *, integer=False):
    # Never evaluate expressions or use binary floating point for grade boundaries.
    if not isinstance(value, str) or len(value) > 128:
        raise ValueError("Invalid number")
    text = value.strip()
    if not (INTEGER if integer else NUMBER).fullmatch(text):
        raise ValueError("Invalid number")
    try:
        number = Decimal(text)
    except InvalidOperation as error:
        raise ValueError("Invalid number") from error
    if number.is_zero():
        return Decimal(0)
    if (
        not number.is_finite()
        or len(number.as_tuple().digits) > 100
        or not -100 <= number.adjusted() <= 100
    ):
        raise ValueError("Number exceeds supported precision or exponent")
    return number


def numeric_matches(question, answer):
    try:
        integer = question["type"] == "integer"
        submitted = parse_number(answer, integer=integer)
        expected = [
            parse_number(value, integer=integer) for value in question["solution"]
        ]
        tolerances = (
            [Decimal(0)] * len(expected)
            if integer
            else [
                parse_number(value) for value in question.get("answer_tolerances", [])
            ]
        )
        if len(tolerances) != len(expected) or any(value < 0 for value in tolerances):
            return False
    except (ValueError, IndexError, KeyError, TypeError):
        return False
    # The parser bounds coefficients and exponents. This precision retains every
    # possible digit in the difference, including opposite signs and tiny margins.
    with localcontext() as context:
        context.prec = 400
        return any(
            abs(submitted - value) <= tolerance
            for value, tolerance in zip(expected, tolerances)
        )
