"""Shared application messages, localized with Django's request language."""

import json
import re
from pathlib import Path

from django.conf import settings
from django.utils.translation import get_language

_MESSAGES = json.loads((Path(settings.LOCALE_ROOT) / "messages.json").read_text())


def translate(key, **values):
    language = (get_language() or "en").lower()
    locale = (
        "zh-TW"
        if language in ("zh-hant", "zh-tw")
        else "es"
        if language.startswith("es")
        else "en"
    )
    template = _MESSAGES.get(key, {}).get(locale, key)
    return re.sub(
        r"\{(\w+)\}", lambda match: str(values.get(match[1], match[0])), template
    )
