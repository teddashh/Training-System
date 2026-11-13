"""Deployment language configuration, shared by settings and request handling."""
CODES = {'en': 'en', 'zh-tw': 'zh-TW', 'es': 'es'}
DJANGO_CODES = {'en': 'en', 'zh-TW': 'zh-hant', 'es': 'es'}
LABELS = {'en': 'English', 'zh-TW': 'Traditional Chinese', 'es': 'Spanish'}


def parse_interface_languages(value):
    if not value or not value.strip():
        return list(CODES.values())
    return list(dict.fromkeys(CODES[code] for part in value.split(',')
                             if (code := part.strip().lower()) in CODES)) or ['en']


def frontend_locale(value):
    value = (value or '').lower()
    if value in ('zh-tw', 'zh-hant') or value.startswith('zh-hant-'):
        return 'zh-TW'
    if value.split('-')[0] in ('en', 'es'):
        return value.split('-')[0]
    return None
