"""System administrator configuration; never serialize credentials or audit values."""
import hashlib
import re
from io import BytesIO
from uuid import UUID

from PIL import Image, UnidentifiedImageError
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.http import HttpResponse, Http404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .email_views import EmailAdministrator
from .i18n import translate
from .models import SystemSettings
from . import runtime_settings as config
from .services import audit


def public_config(value):
    source = value
    value = {key: source[key] for key in (
        'provider', 'server', 'configured', 'secret_required', 'tenant_id', 'client_id', 'domains',
        'from_email', 'host', 'port', 'security', 'username',
    ) if key in source}
    for key in ('client_secret', 'password'):
        value[key + '_set'] = bool(source.get(key))
    if value['server']:
        for key in ('tenant_id', 'client_id'):
            if value.get(key):
                value[key] = '…' + value[key][-4:]
    return value


def payload():
    row = config.stored()
    return {'organization': {**config.organization(), 'organization_name': row.organization_name,
                'languages': config.allowed_languages(), 'languages_server': config.languages_server()},
            'sign_in': {**public_config(config.sign_in_config()),
                'entra_redirect_uri': settings.ENTRA_REDIRECT_URI, 'google_redirect_uri': settings.GOOGLE_REDIRECT_URI},
            'email': public_config(config.mail_config())}


def invalid():
    raise ValidationError(translate('Check the required fields.'))


def text(data, key, maximum=320):
    value = data.get(key, '')
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 for c in value):
        invalid()
    return value.strip()


def credentials(data, previous, keys):
    result = {}
    for key in keys:
        value = data.get(key, '')
        if not isinstance(value, str) or len(value) > 4096:
            invalid()
        try:
            result[key] = config.encrypt(value) if value else previous.get(key, '')
        except (ValueError, TypeError):
            raise ValidationError(translate('The encryption key is invalid.')) from None
    return result


@api_view(['GET'])
@permission_classes([EmailAdministrator])
def settings_detail(request):
    return Response(payload())


@api_view(['PUT'])
@permission_classes([EmailAdministrator])
@transaction.atomic
def settings_update(request, section):
    if section not in ('organization', 'sign_in', 'email'):
        raise Http404
    if ((section == 'sign_in' and config.sign_in_server()) or
            (section == 'email' and config.mail_server()) or
            (section == 'organization' and 'languages' in request.data and config.languages_server())):
        return Response({'detail': translate('Set by the server')}, status=409)
    row, _ = SystemSettings.objects.get_or_create(pk=1)
    row = SystemSettings.objects.select_for_update().get(pk=row.pk)
    data = request.data
    if section == 'organization':
        if 'organization_name' in data:
            row.organization_name = text(data, 'organization_name', 80)
        if 'languages' in data:
            languages = data['languages']
            if (not isinstance(languages, list) or not languages or
                    any(code not in ('en', 'zh-TW', 'es') for code in languages)):
                raise ValidationError(translate('Choose at least one interface language.'))
            row.languages = list(dict.fromkeys(languages))
    elif section == 'sign_in':
        provider = data.get('provider')
        if provider not in ('none', 'entra', 'google'):
            invalid()
        # A credential is retained for its provider, never forwarded to a different provider.
        saved_secrets = dict(row.sign_in_fields.get('provider_secrets', {}))
        if row.sign_in_provider in ('entra', 'google'):
            saved_secrets[row.sign_in_provider] = row.sign_in_fields.get('client_secret', '')
        fields = credentials(data, {'client_secret': saved_secrets.get(provider, '')}, ['client_secret'])
        if provider in ('entra', 'google'):
            saved_secrets[provider] = fields['client_secret']
        fields['provider_secrets'] = saved_secrets
        if provider != 'none':
            fields['client_id'] = text(data, 'client_id')
            if not fields['client_id'] or not config.decrypt(fields['client_secret']):
                raise ValidationError(translate('Enter the client ID and secret.'))
            if provider == 'entra':
                try:
                    fields['tenant_id'] = str(UUID(text(data, 'tenant_id')))
                    fields['client_id'] = str(UUID(fields['client_id']))
                except ValueError:
                    invalid()
            else:
                domains = data.get('domains')
                if not isinstance(domains, list) or not domains or len(domains) > 100:
                    invalid()
                fields['domains'] = []
                for domain in domains:
                    if not isinstance(domain, str) or not re.fullmatch(r'(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}', domain.strip()):
                        invalid()
                    fields['domains'].append(domain.strip().lower())
        row.sign_in_provider, row.sign_in_fields = provider, fields
    else:
        provider = data.get('provider')
        if provider not in ('off', 'smtp', 'graph'):
            invalid()
        fields = credentials(data, row.email_fields, ['password', 'client_secret'])
        if provider != 'off':
            fields['from_email'] = text(data, 'from_email')
            try:
                validate_email(fields['from_email'])
            except DjangoValidationError:
                invalid()
        if provider == 'smtp':
            fields.update(host=text(data, 'host', 253), username=text(data, 'username'), security=data.get('security'))
            port = data.get('port')
            if not fields['host'] or fields['security'] not in ('starttls', 'ssl', 'none') or type(port) is not int or not 1 <= port <= 65535:
                invalid()
            fields['port'] = port
            if row.email_fields.get('password') and not config.decrypt(fields['password']):
                raise ValidationError(translate('Enter the password again.'))
        if provider == 'graph':
            try:
                fields['tenant_id'] = str(UUID(text(data, 'tenant_id')))
                fields['client_id'] = str(UUID(text(data, 'client_id')))
            except ValueError:
                invalid()
            if not config.decrypt(fields['client_secret']):
                raise ValidationError(translate('Enter the client ID and secret.'))
        row.email_provider, row.email_fields = provider, fields
    row.updated_by = request.user
    row.save()
    config.invalidate()
    audit(request.user, 'settings.' + section, '')
    return Response(payload())


@api_view(['POST', 'DELETE'])
@permission_classes([EmailAdministrator])
@transaction.atomic
def settings_logo(request):
    data, width, height = b'', 0, 0
    if request.method == 'POST':
        upload = request.FILES.get('logo')
        if not upload or upload.size > 2 * 1024 * 1024 or upload.content_type not in ('image/png', 'image/jpeg', 'image/webp'):
            raise ValidationError(translate('Use a PNG, JPEG or WebP image up to 2 MiB and 2048 pixels per side.'))
        try:
            raw = upload.read()
            image = Image.open(BytesIO(raw))
            if image.format not in ('PNG', 'JPEG', 'WEBP') or Image.MIME[image.format] != upload.content_type:
                raise ValueError()
            width, height = image.size
            if max(width, height) > 2048:
                raise ValueError()
            image.verify()
            image = Image.open(BytesIO(raw)).convert('RGBA')
            image.info.clear()
            output = BytesIO()
            image.save(output, format='PNG')
            data = output.getvalue()
        except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError):
            raise ValidationError(translate('Use a PNG, JPEG or WebP image up to 2 MiB and 2048 pixels per side.')) from None
    row, _ = SystemSettings.objects.get_or_create(pk=1)
    row = SystemSettings.objects.select_for_update().get(pk=row.pk)
    row.logo, row.logo_width, row.logo_height = data, width, height
    row.logo_hash, row.logo_size = hashlib.sha256(data).hexdigest() if data else '', len(data)
    row.updated_by = request.user
    row.save()
    config.invalidate()
    audit(request.user, 'settings.logo', '')
    return Response(payload())


@api_view(['GET'])
@permission_classes([AllowAny])
def organization_logo(request, digest):
    row = config.stored()
    if not row.logo or digest != row.logo_hash:
        raise Http404
    response = HttpResponse(bytes(row.logo), content_type='image/png')
    response['Cache-Control'] = 'public, max-age=31536000, immutable'
    response['X-Content-Type-Options'] = 'nosniff'
    response['ETag'] = '"' + digest + '"'
    return response
