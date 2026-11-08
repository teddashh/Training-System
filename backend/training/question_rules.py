"""Shared numeric and text rules for assessment configuration and grading."""

from decimal import Decimal, InvalidOperation, localcontext
import re

NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
INTEGER = re.compile(r"[+-]?[0-9]+\Z")
NUMBER_ERROR = "Use a finite number with a decimal point, up to 100 significant digits and an exponent from -100 to 100."
TEXT_MATCHING_MODES = ("normalized", "lower", "exact")


def text_matching_modes(question):
    # Missing/empty rules retain the behavior of pre-migration questions and
    # frozen attempts. Explicit malformed rules must never silently downgrade.
    modes = question.get("answer_matching", [])
    return ["normalized"] * len(question["solution"]) if modes == [] else modes


def text_matches(question, answer):
    if not isinstance(answer, str) or not answer.strip():
        return False
    expected = question.get("solution", [])
    modes = text_matching_modes(question)
    if (
        not isinstance(expected, list)
        or not isinstance(modes, list)
        or len(modes) != len(expected)
        or any(mode not in TEXT_MATCHING_MODES for mode in modes)
        or any(not isinstance(value, str) or not value.strip() for value in expected)
    ):
        return False
    for value, mode in zip(expected, modes):
        if mode == "normalized":
            matches = answer.strip().casefold() == value.strip().casefold()
        elif mode == "lower":
            # Yaksh compares lower().splitlines(), not Unicode casefold. Keep
            # spaces and blank lines; line separators and one final newline are
            # equivalent under its documented source behavior.
            matches = answer.lower().splitlines() == value.lower().splitlines()
        else:
            matches = answer.splitlines() == value.splitlines()
        if matches:
            return True
    return False


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
