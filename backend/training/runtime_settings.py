"""Effective configuration. Only this module reads stored values and deployment overrides."""
import base64
from contextvars import ContextVar
from contextlib import contextmanager
from functools import wraps

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from django.conf import settings
from django.db import OperationalError, ProgrammingError

from .brand import BRAND
from .models import SystemSettings

_cache = ContextVar('system_settings_cache', default=None)


class SettingsContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _cache.set({})
        try:
            return self.get_response(request)
        finally:
            _cache.reset(token)


@contextmanager
def settings_snapshot(row=None):
    """Bound a job's reads, or supply an unsaved row for offline synthetic previews."""
    token = _cache.set({'row': row} if row is not None else {})
    try:
        yield
    finally:
        _cache.reset(token)


def invalidate():
    cache = _cache.get()
    if cache is not None:
        cache.clear()


def stored():
    cache = _cache.get()
    if cache is not None and 'row' in cache:
        return cache['row']
    try:
        row = SystemSettings.objects.filter(pk=1).first() or SystemSettings()
    except (OperationalError, ProgrammingError):
        # Startup checks and migration commands must work before the additive table exists.
        row = SystemSettings()
    if cache is not None:
        cache['row'] = row
    return row


def cipher():
    key = settings.SETTINGS_ENCRYPTION_KEY
    if not key:
        key = base64.urlsafe_b64encode(HKDF(algorithm=hashes.SHA256(), length=32,
            salt=None, info=b'training.system-settings.v1').derive(settings.SECRET_KEY.encode()))
    return Fernet(key)


def encrypt(value):
    return cipher().encrypt(value.encode()).decode()


def decrypt(value):
    if not value:
        return ''
    try:
        return cipher().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError, TypeError, UnicodeError):
        return ''


def request_cached(function):
    @wraps(function)
    def resolve():
        cache = _cache.get()
        if cache is None:
            return function()
        key = function.__name__
        if key not in cache:
            cache[key] = function()
        return cache[key]
    return resolve


def sign_in_server():
    return any((settings.ENTRA_TENANT_ID, settings.ENTRA_CLIENT_ID, settings.ENTRA_CLIENT_SECRET,
                settings.GOOGLE_CLIENT_ID, settings.GOOGLE_CLIENT_SECRET))


def mail_server():
    return settings.EMAIL_SERVER or settings.EMAIL_BACKEND != 'training.mail.ConfiguredEmailBackend'


def languages_server():
    return settings.INTERFACE_LANGUAGES_SERVER or settings.INTERFACE_LANGUAGES != ['en', 'zh-TW', 'es']


@request_cached
def allowed_languages():
    return settings.INTERFACE_LANGUAGES if languages_server() else (stored().languages or settings.INTERFACE_LANGUAGES)


@request_cached
def organization():
    row = stored()
    return {'name': row.organization_name or BRAND['organization'],
            'title': row.organization_name + ' Training' if row.organization_name else BRAND['title'],
            'logo_url': settings.APP_BASE_PATH + '/api/organization/logo/' + row.logo_hash + '/' if row.logo_hash else None}


@request_cached
def sign_in_config():
    server = sign_in_server()
    if server:
        entra = any((settings.ENTRA_TENANT_ID, settings.ENTRA_CLIENT_ID, settings.ENTRA_CLIENT_SECRET))
        config = {'provider': 'entra' if entra else 'google', 'tenant_id': settings.ENTRA_TENANT_ID,
                  'client_id': settings.ENTRA_CLIENT_ID if entra else settings.GOOGLE_CLIENT_ID,
                  'client_secret': settings.ENTRA_CLIENT_SECRET if entra else settings.GOOGLE_CLIENT_SECRET,
                  'domains': settings.GOOGLE_WORKSPACE_DOMAINS}
    else:
        row = stored()
        config = {'provider': row.sign_in_provider, **row.sign_in_fields}
        encrypted = config.get('client_secret', '')
        config['client_secret'] = decrypt(encrypted)
        config['secret_required'] = bool(encrypted and not config['client_secret'])
    provider = config['provider']
    config['server'] = bool(server)
    config['configured'] = bool(provider in ('entra', 'google') and config.get('client_id') and config.get('client_secret')
        and (config.get('tenant_id') if provider == 'entra' else config.get('domains')))
    return config


@request_cached
def mail_config():
    server = mail_server()
    if server:
        graph = settings.EMAIL_BACKEND == 'training.mail.GraphEmailBackend'
        backend = settings.EMAIL_BACKEND if settings.EMAIL_BACKEND != 'training.mail.ConfiguredEmailBackend' else 'django.core.mail.backends.smtp.EmailBackend'
        config = {'provider': 'graph' if graph else 'smtp', 'backend': backend,
                  'from_email': settings.DEFAULT_FROM_EMAIL,
                  'tenant_id': settings.GRAPH_MAIL_TENANT_ID, 'client_id': settings.GRAPH_MAIL_CLIENT_ID,
                  'client_secret': settings.GRAPH_MAIL_CLIENT_SECRET, 'sender': settings.GRAPH_MAIL_SENDER,
                  'host': settings.EMAIL_HOST, 'port': settings.EMAIL_PORT,
                  'security': 'ssl' if settings.EMAIL_USE_SSL else 'starttls' if settings.EMAIL_USE_TLS else 'none',
                  'username': settings.EMAIL_HOST_USER, 'password': settings.EMAIL_HOST_PASSWORD}
    else:
        row = stored()
        config = {'provider': row.email_provider, **row.email_fields}
        for key in ('password', 'client_secret'):
            config[key] = decrypt(config.get(key, ''))
        secret_key = 'password' if row.email_provider == 'smtp' else 'client_secret'
        config['secret_required'] = bool(row.email_provider != 'off' and row.email_fields.get(secret_key) and not config[secret_key])
    provider = config['provider']
    config['server'] = bool(server)
    if provider == 'graph':
        configured = all(config.get(key) for key in ('tenant_id', 'client_id', 'client_secret', 'from_email'))
        if server:
            configured = configured and config['sender'].casefold() == config['from_email'].casefold()
    elif provider == 'smtp':
        configured = bool(config.get('host') and config.get('from_email'))
        if not server and stored().email_fields.get('password') and not config['password']:
            configured = False
        if server:
            configured = (config['backend'] == 'django.core.mail.backends.smtp.EmailBackend'
                          and config['host'] not in ('', 'localhost') and not config['from_email'].endswith('@example.com'))
    else:
        configured = False
    config['configured'] = bool(configured)
    return config


def mail_enabled():
    return mail_config()['provider'] != 'off'


def from_email():
    return mail_config().get('from_email', '')


def verification_brand():
    """Keep legacy verification subjects unchanged when the organization is unset."""
    return organization()['title'] if stored().organization_name else BRAND['organization']


def verification_heading():
    return organization()['title'] + '\n\n' if stored().organization_name else ''
