import hashlib
import math
import secrets
from datetime import timedelta

import msal
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.http import HttpResponseRedirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import Throttled, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .runtime_settings import verification_brand, verification_heading, sign_in_config, organization, allowed_languages, from_email, mail_enabled
from .access import access_for
from .i18n import translate
from .models import AuthRate, EmailCode, User
from .services import audit, find_user, identity_for_user
from .notifications import record_verification
from . import directory


def user_data(user):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "display_name": user.display_name or user.username,
        "role": user.role,
        "access": access_for(user),
        "is_staff": user.is_staff,
        "department": user.department,
        "employment": user.employment,
        "employee_id": user.employee_id,
    }


def rate_limit(request, identifier=None):
    now = timezone.now()
    # Do not trust an arbitrary X-Forwarded-For header supplied by a client.
    account = find_user(identifier) if identifier is not None else None
    identity = (
        f"user:{account.pk}"
        if account
        else "identifier:" + str(identifier).strip().casefold()
    )
    for scope, item, limit in [
        ("network", request.META.get("REMOTE_ADDR", ""), settings.AUTH_NETWORK_LIMIT),
        ("account", identity, settings.AUTH_ACCOUNT_LIMIT),
    ]:
        if scope == "account" and identifier is None:
            continue
        key = hashlib.sha256(f"{scope}:{item}".encode()).hexdigest()
        with transaction.atomic():
            row, _ = AuthRate.objects.get_or_create(key=key, defaults={"window": now})
            row = AuthRate.objects.select_for_update().get(pk=key)
            if row.window < now - timedelta(minutes=10):
                row.count, row.window = 0, now
            blocked = row.count >= limit
            if not blocked:
                row.count += 1
                row.save()
            wait = max(
                1, math.ceil((row.window + timedelta(minutes=10) - now).total_seconds())
            )
        if blocked:
            raise Throttled(
                wait=wait,
                detail=translate("Too many sign-in attempts. Please try again later."),
            )


@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([AllowAny])
def session(request):
    return Response(
        {
            "user": user_data(request.user) if request.user.is_authenticated else None,
            "languages": allowed_languages(),
            "organization": organization(),
            "sign_in": {
                **{p: sign_in_config()["configured"] and sign_in_config()["provider"] == p for p in ("entra", "google")},
                "password": settings.PASSWORD_SIGN_IN,
            },
            "email_enabled": mail_enabled(),
            "demo_mode": settings.DEBUG
            and __import__("os").getenv("DEMO_MODE") == "true",
            "entra_enabled": sign_in_config()['configured'] and sign_in_config()['provider'] == 'entra',
        }
    )


@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def password_login(request):
    if not settings.PASSWORD_SIGN_IN:
        return Response({"detail": translate("Password sign-in is off.")}, status=403)
    identifier = str(request.data.get("identifier", ""))
    rate_limit(request, identifier)
    existing = find_user(identifier)
    user = authenticate(
        request,
        username=existing.username if existing else identifier,
        password=str(request.data.get("password", "")),
    )
    if not user:
        return Response(
            {"detail": translate("Incorrect account or password.")}, status=400
        )
    identity_for_user(user)
    login(request, user)
    audit(user, "auth.password", user.id)
    return Response({"user": user_data(user)})


def email_code_allowed(user):
    return bool(user and user.is_active and (
        not user.entra_subject or settings.EMAIL_CODE_FOR_ENTRA_USERS
        # Deliberately unchanged: email-code eligibility is learners only.
        or (user.role == 'learner' and not user.is_staff and not user.is_superuser
            and directory.email_code_domain(user.email))
    ))


@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def email_request(request):
    if not mail_enabled():
        raise ValidationError(translate("Email is off."))
    email = str(request.data.get("email", "")).strip().casefold()
    rate_limit(request, email)
    user = (
        User.objects.filter(email__iexact=email, is_active=True).first()
        if email
        else None
    )
    if not user:
        user = directory.provision_email_user(email)
    if email_code_allowed(user):
        code = f"{secrets.randbelow(1000000):06d}"
        digest = hashlib.sha256(
            (settings.SECRET_KEY + email + code).encode()
        ).hexdigest()
        EmailCode.objects.update_or_create(
            email=email,
            defaults={
                "digest": digest,
                "expires_at": timezone.now() + timedelta(minutes=10),
                "failures": 0,
            },
        )
        try:
            send_mail(
                translate("{organization} sign-in code", organization=verification_brand(), locale="en"),
                verification_heading() + "Your verification code: "
                + code
                + "\n"
                + "Valid for 10 minutes.",
                from_email(),
                [email],
            )
        except Exception as error:
            EmailCode.objects.filter(email=email, digest=digest).delete()
            record_verification("sign_in_code", email, user=user, error=error)
            # Same response prevents disclosing whether the account exists.
        else:
            record_verification("sign_in_code", email, user=user)
    return Response(
        {
            "detail": translate(
                "If an administrator has created an account for this email, you will receive a sign-in code."
            )
        }
    )


@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def email_verify(request):
    if not mail_enabled():
        raise ValidationError(translate("Email is off."))
    email = str(request.data.get("email", "")).strip().casefold()
    rate_limit(request, email)
    digest = hashlib.sha256(
        (settings.SECRET_KEY + email + str(request.data.get("code", ""))).encode()
    ).hexdigest()
    valid = False
    with transaction.atomic():
        row = EmailCode.objects.select_for_update().filter(email=email).first()
        if row and row.expires_at > timezone.now() and row.failures < 5:
            if secrets.compare_digest(row.digest, digest):
                valid = True
                row.delete()
            else:
                row.failures += 1
                row.save(update_fields=["failures"])
    user = (
        User.objects.filter(email__iexact=email, is_active=True).first()
        if valid and email
        else None
    )
    if not email_code_allowed(user):
        raise ValidationError(
            translate("The code is invalid, already used or expired.")
        )
    # Bulk directory sync scope/behavior stays unchanged; outside Members refresh only here.
    if not directory.refresh_signin_profile(user):
        raise ValidationError(translate("This account is disabled."))
    identity_for_user(user)
    login(request, user)
    audit(user, "auth.email", user.id)
    return Response({"user": user_data(user)})


@api_view(["POST"])
def sign_out(request):
    logout(request)
    return Response({"ok": True})


def entra_client():
    config = sign_in_config()
    if config['provider'] != 'entra' or not config['configured']:
        raise ValidationError(translate("Company Microsoft Entra ID has not been configured."))
    return msal.ConfidentialClientApplication(
        config['client_id'], authority=f"https://login.microsoftonline.com/{config['tenant_id']}",
        client_credential=config['client_secret'],
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def entra_start(request):
    flow = entra_client().initiate_auth_code_flow(
        scopes=[], redirect_uri=settings.ENTRA_REDIRECT_URI
    )
    request.session["entra_flow"] = flow
    return HttpResponseRedirect(flow["auth_uri"])


@api_view(["GET"])
@permission_classes([AllowAny])
def entra_callback(request):
    flow = request.session.pop("entra_flow", None)
    if not flow:
        raise ValidationError(
            translate("Your SSO session expired. Please sign in again.")
        )
    try:
        result = entra_client().acquire_token_by_auth_code_flow(
            flow, request.GET.dict()
        )
    except ValueError:
        raise ValidationError(translate("SSO state validation failed."))
    claims = result.get("id_token_claims", {})
    if (
        not claims.get("oid")
        or claims.get("tid", "").casefold() != sign_in_config().get('tenant_id', '').casefold()
    ):
        raise ValidationError(
            translate("SSO sign-in failed or the tenant did not match.")
        )
    subject = f"{claims['tid']}:{claims['oid']}".casefold()
    user = User.objects.filter(entra_subject__iexact=subject).first()
    if not user:
        email = str(claims.get("preferred_username", "")).casefold()
        try:
            with transaction.atomic():
                if find_user(email):
                    # A sync may have inserted this exact subject after our first read.
                    user = User.objects.filter(entra_subject__iexact=subject).first()
                    if not user:
                        raise ValidationError(translate(
                            "This email already exists. Ask an administrator to link the account using its Entra subject."
                        ))
                else:
                    user = User.objects.create_user(
                        username="entra_" + claims["oid"].casefold(), email=email if "@" in email else "",
                        display_name=claims.get("name", ""), entra_subject=subject,
                    )
        except IntegrityError:
            user = User.objects.filter(entra_subject__iexact=subject).first()
            if not user:
                raise ValidationError(translate(
                    "This email already exists. Ask an administrator to link the account using its Entra subject."
                )) from None
    # Bulk directory sync scope/behavior stays unchanged; outside Members refresh only here.
    if not user.is_active or not directory.refresh_signin_profile(user):
        raise ValidationError(translate("This account is disabled."))
    identity_for_user(user)
    login(request, user)
    audit(user, "auth.entra", user.id)
    return HttpResponseRedirect(settings.APP_ORIGIN + settings.APP_BASE_PATH + "/")
