import hashlib
import secrets
from datetime import timedelta
import msal
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.mail import send_mail
from django.db import transaction
from django.http import HttpResponseRedirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, Throttled
from .models import User, EmailCode, AuthRate
from .services import find_user, identity_for_user, audit


def user_data(user):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "display_name": user.display_name or user.username,
        "role": user.role,
        "department": user.department,
        "employment": user.employment,
        "employee_id": user.employee_id,
    }


def rate_limit(request, identifier):
    now = timezone.now()
    # Do not trust an arbitrary X-Forwarded-For header supplied by a client.
    for item in [
        request.META.get("REMOTE_ADDR", ""),
        str(identifier).strip().casefold(),
    ]:
        key = hashlib.sha256(item.encode()).hexdigest()
        with transaction.atomic():
            row, _ = AuthRate.objects.get_or_create(key=key, defaults={"window": now})
            row = AuthRate.objects.select_for_update().get(pk=key)
            if row.window < now - timedelta(minutes=10):
                row.count, row.window = 0, now
            row.count += 1
            row.save()
            blocked = row.count > 20
        if blocked:
            raise Throttled(detail="登入嘗試過於頻繁，請稍後再試。")


@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([AllowAny])
def session(request):
    return Response(
        {
            "user": user_data(request.user) if request.user.is_authenticated else None,
            "demo_mode": settings.DEBUG
            and __import__("os").getenv("DEMO_MODE") == "true",
            "entra_enabled": bool(
                settings.ENTRA_TENANT_ID
                and settings.ENTRA_CLIENT_ID
                and settings.ENTRA_CLIENT_SECRET
            ),
        }
    )


@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def password_login(request):
    identifier = str(request.data.get("identifier", ""))
    rate_limit(request, identifier)
    existing = find_user(identifier)
    user = authenticate(
        request,
        username=existing.username if existing else identifier,
        password=str(request.data.get("password", "")),
    )
    if not user:
        return Response({"detail": "帳號或密碼不正確。"}, status=400)
    identity_for_user(user)
    login(request, user)
    audit(user, "auth.password", user.id)
    return Response({"user": user_data(user)})


@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def email_request(request):
    email = str(request.data.get("email", "")).strip().casefold()
    rate_limit(request, email)
    user = User.objects.filter(email__iexact=email, is_active=True).first()
    if user:
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
                "Evitina Learn 登入驗證碼",
                f"您的驗證碼：{code}\n10 分鐘內有效。",
                settings.DEFAULT_FROM_EMAIL,
                [email],
            )
        except Exception:
            EmailCode.objects.filter(email=email).delete()
            # Same response prevents disclosing whether the account exists.
    return Response({"detail": "若此 E-mail 已由管理員建立帳號，您將收到登入驗證碼。"})


@csrf_protect
@api_view(["POST"])
@permission_classes([AllowAny])
def email_verify(request):
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
        if valid
        else None
    )
    if not user:
        raise ValidationError("驗證碼無效、已使用或已過期。")
    identity_for_user(user)
    login(request, user)
    audit(user, "auth.email", user.id)
    return Response({"user": user_data(user)})


@api_view(["POST"])
def sign_out(request):
    logout(request)
    return Response({"ok": True})


def entra_client():
    if not all(
        [
            settings.ENTRA_TENANT_ID,
            settings.ENTRA_CLIENT_ID,
            settings.ENTRA_CLIENT_SECRET,
        ]
    ):
        raise ValidationError("尚未設定公司 Microsoft Entra ID。")
    return msal.ConfidentialClientApplication(
        settings.ENTRA_CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{settings.ENTRA_TENANT_ID}",
        client_credential=settings.ENTRA_CLIENT_SECRET,
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
        raise ValidationError("SSO 工作階段已過期，請重新登入。")
    try:
        result = entra_client().acquire_token_by_auth_code_flow(
            flow, request.GET.dict()
        )
    except ValueError:
        raise ValidationError("SSO 狀態驗證失敗。")
    claims = result.get("id_token_claims", {})
    if (
        not claims.get("oid")
        or claims.get("tid", "").casefold() != settings.ENTRA_TENANT_ID.casefold()
    ):
        raise ValidationError("SSO 登入失敗或租用戶不符。")
    subject = f"{claims['tid']}:{claims['oid']}"
    user = User.objects.filter(entra_subject=subject).first()
    if not user:
        email = str(claims.get("preferred_username", "")).casefold()
        if find_user(email):
            raise ValidationError(
                "此 E-mail 已存在，請管理員先設定 Entra subject 以連結帳號。"
            )
        user = User.objects.create_user(
            username="entra_" + claims["oid"],
            email=email if "@" in email else "",
            display_name=claims.get("name", ""),
            entra_subject=subject,
        )
    if not user.is_active:
        raise ValidationError("帳號已停用。")
    identity_for_user(user)
    login(request, user)
    audit(user, "auth.entra", user.id)
    return HttpResponseRedirect(settings.APP_ORIGIN + "/")
