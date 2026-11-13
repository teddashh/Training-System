"""A disallowed requested locale selects the deployment default, including DRF."""
from django.conf import settings
from django.middleware.locale import LocaleMiddleware
from django.utils import translation
from django.utils.translation.trans_real import parse_accept_lang_header

from .languages import DJANGO_CODES, frontend_locale


class InterfaceLocaleMiddleware(LocaleMiddleware):
    def process_request(self, request):
        requested = request.COOKIES.get(settings.LANGUAGE_COOKIE_NAME)
        if not requested:
            preferences = parse_accept_lang_header(request.META.get('HTTP_ACCEPT_LANGUAGE', ''))
            requested = next((code for code, quality in preferences if quality > 0), '')
        locale = frontend_locale(requested)
        from .runtime_settings import allowed_languages
        allowed = allowed_languages()
        language = DJANGO_CODES[locale if locale in allowed else allowed[0]]
        translation.activate(language)
        request.LANGUAGE_CODE = language
