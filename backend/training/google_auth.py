"""Google Workspace authorization code flow. Provider responses never reach the UI."""
import base64
import hashlib
import secrets
import threading
import time
from urllib.parse import urlencode

import jwt
import requests
from django.conf import settings
from django.contrib.auth import login
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.http import HttpResponseRedirect
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny

from .auth_views import rate_limit
from .i18n import translate
from .models import User
from .runtime_settings import sign_in_config
from .services import audit, identity_for_user

KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
_keys = None
_keys_until = 0
_keys_lock = threading.Lock()


def signing_key(kid):
    global _keys, _keys_until
    with _keys_lock:
        if _keys is None or time.monotonic() >= _keys_until:
            response = requests.get(KEYS_URL, timeout=10)
            response.raise_for_status()
            _keys = response.json()['keys']
            _keys_until = time.monotonic() + 3600
        for key in _keys:
            if key.get('kid') == kid and key.get('kty') == 'RSA' and key.get('use', 'sig') == 'sig':
                return jwt.PyJWK.from_dict(key, algorithm='RS256').key
    raise ValueError('Unknown signing key')


def configuration():
    config = sign_in_config()
    if config['provider'] != 'google' or not config['configured']:
        raise ValidationError(translate('Google Workspace has not been configured.'))
    return config


@api_view(['GET'])
@permission_classes([AllowAny])
def start(request):
    config = configuration()
    rate_limit(request)
    verifier, state, nonce = secrets.token_urlsafe(48), secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    request.session['google_flow'] = {'verifier': verifier, 'state': state, 'nonce': nonce,
                                      'created_at': time.time(), 'client_id': config['client_id']}
    query = urlencode({'client_id': config['client_id'], 'redirect_uri': settings.GOOGLE_REDIRECT_URI,
        'response_type': 'code', 'scope': 'openid email profile', 'state': state, 'nonce': nonce,
        'code_challenge': base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode(),
        'code_challenge_method': 'S256', 'hd': config['domains'][0]})
    return HttpResponseRedirect('https://accounts.google.com/o/oauth2/v2/auth?' + query)


@api_view(['GET'])
@permission_classes([AllowAny])
def callback(request):
    flow = request.session.pop('google_flow', None)
    if not flow or time.time() - flow.get('created_at', 0) > 600:
        raise ValidationError(translate('Your SSO session expired. Please sign in again.'))
    if not secrets.compare_digest(flow['state'].encode(), request.GET.get('state', '').encode()):
        raise ValidationError(translate('SSO state validation failed.'))
    config = configuration()
    try:
        if flow['client_id'] != config['client_id'] or not request.GET.get('code'):
            raise ValueError()
        response = requests.post(TOKEN_URL, data={'code': request.GET['code'],
            'client_id': config['client_id'], 'client_secret': config['client_secret'],
            'redirect_uri': settings.GOOGLE_REDIRECT_URI, 'grant_type': 'authorization_code',
            'code_verifier': flow['verifier']}, timeout=10)
        response.raise_for_status()
        token = response.json()['id_token']
        header = jwt.get_unverified_header(token)
        claims = jwt.decode(token, signing_key(header['kid']), algorithms=['RS256'],
            audience=config['client_id'], issuer=['https://accounts.google.com', 'accounts.google.com'],
            options={'require': ['exp', 'iat', 'sub', 'aud', 'iss', 'nonce', 'email', 'email_verified', 'hd']})
        subject = claims['sub']
        if (not isinstance(subject, str) or not subject or len(subject) > 128 or
                not isinstance(claims['nonce'], str) or not secrets.compare_digest(claims['nonce'], flow['nonce']) or
                claims['email_verified'] is not True or claims['hd'].lower() not in config['domains']):
            raise ValueError()
        email = claims['email'].strip().casefold()
        validate_email(email)
    except Exception:
        raise ValidationError(translate('SSO sign-in failed or the tenant did not match.')) from None
    rate_limit(request, email)
    try:
        with transaction.atomic():
            user = User.objects.select_for_update().filter(google_subject=subject).first()
            linked = False
            if not user:
                user = User.objects.select_for_update().filter(email__iexact=email).first()
                if user:
                    if not user.is_active:
                        raise ValidationError(translate('This account is disabled.'))
                    if user.google_subject:
                        raise ValidationError(translate('SSO sign-in failed or the tenant did not match.'))
                    user.google_subject = subject
                    user.save(update_fields=['google_subject'])
                    linked = True
                else:
                    user = User.objects.create_user(username='google_' + subject, email=email,
                        display_name=str(claims.get('name', ''))[:100], google_subject=subject)
            if not user.is_active:
                raise ValidationError(translate('This account is disabled.'))
            if linked:
                audit(user, 'auth.google.link', user.id)
    except IntegrityError:
        raise ValidationError(translate('SSO sign-in failed or the tenant did not match.')) from None
    identity_for_user(user)
    login(request, user)
    audit(user, 'auth.google', user.id)
    return HttpResponseRedirect(settings.APP_ORIGIN + settings.APP_BASE_PATH + '/')
