"""Shared application messages, localized with Django's request language."""

import json
import re
from pathlib import Path

from django.conf import settings
from django.utils.translation import get_language

_MESSAGES = json.loads((Path(settings.LOCALE_ROOT) / "messages.json").read_text())


def current_locale():
    from .languages import frontend_locale
    locale = frontend_locale(get_language())
    from .runtime_settings import allowed_languages
    allowed = allowed_languages()
    return locale if locale in allowed else allowed[0]


def translate(key, *, locale=None, **values):
    locale = locale or current_locale()
    template = _MESSAGES.get(key, {}).get(locale, key)
    return re.sub(
        r"\{(\w+)\}", lambda match: str(values.get(match[1], match[0])), template
    )


# Locale-aware date lines without platform locale data, shared by mail and printouts.
_WEEKDAYS = {
    "en": ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"),
    "zh-TW": ("星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"),
    "es": ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"),
}
_MONTHS = {
    "en": ("January", "February", "March", "April", "May", "June", "July", "August",
           "September", "October", "November", "December"),
    "es": ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
           "septiembre", "octubre", "noviembre", "diciembre"),
}


def _date(value, locale):
    weekday = _WEEKDAYS[locale][value.weekday()]
    if locale == "zh-TW":
        return f"{value.year}年{value.month}月{value.day}日（{weekday}）"
    if locale == "es":
        return f"{weekday}, {value.day} de {_MONTHS['es'][value.month - 1]} de {value.year}"
    return f"{weekday}, {_MONTHS['en'][value.month - 1]} {value.day}, {value.year}"


def _clock(value, locale, meridiem=True):
    if locale == "es":
        return f"{value.hour}:{value:%M}"
    hour = value.hour % 12 or 12
    if locale == "zh-TW":
        return ("上午" if value.hour < 12 else "下午") + f"{hour}:{value:%M}" if meridiem else f"{hour}:{value:%M}"
    return f"{hour}:{value:%M}" + (" AM" if value.hour < 12 else " PM") * meridiem


def format_when(start, end, zone, locale=None):
    """'Tuesday, January 12, 2027 · 9:00–10:30 AM CST' in the given zone and locale."""
    locale = locale or current_locale()
    start, end = start.astimezone(zone), end.astimezone(zone)
    abbreviation = start.strftime("%Z")
    if start.date() != end.date():
        return (f"{_date(start, locale)} · {_clock(start, locale)} – "
                f"{_date(end, locale)} · {_clock(end, locale)} {abbreviation}")
    same_half = (start.hour < 12) == (end.hour < 12)
    if locale == "zh-TW":
        span = f"{_clock(start, locale)}–{_clock(end, locale, meridiem=not same_half)}"
    else:
        span = f"{_clock(start, locale, meridiem=not same_half)}–{_clock(end, locale)}"
    return f"{_date(start, locale)} · {span} {abbreviation}"
