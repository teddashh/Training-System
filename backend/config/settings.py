import os
import re
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
SECRET_KEY = os.getenv("SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("SECRET_KEY must be set outside development.")
    SECRET_KEY = "local-development-only-never-use-in-production"
ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
APP_ORIGIN = os.getenv("APP_ORIGIN", "http://localhost:5173").rstrip("/")
SCORM_ORIGIN = os.getenv("SCORM_ORIGIN", "http://localhost:8001").rstrip("/")
SCORM_TRUSTED_SAME_ORIGIN = os.getenv("SCORM_TRUSTED_SAME_ORIGIN", "false").lower() == "true"
APP_BASE_PATH = os.getenv("APP_BASE_PATH", "").rstrip("/")
if not re.fullmatch(r"(?:/[A-Za-z0-9_-]+)*", APP_BASE_PATH):
    raise ImproperlyConfigured("APP_BASE_PATH must be empty or a simple URL path such as /training.")
for origin in (APP_ORIGIN, SCORM_ORIGIN):
    parsed = urlsplit(origin)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname
            or parsed.path or parsed.query or parsed.fragment or parsed.username):
        raise ImproperlyConfigured("Origins must contain only scheme and host; set APP_BASE_PATH separately.")
SCORM_BASE_PATH = APP_BASE_PATH + "/content" if SCORM_TRUSTED_SAME_ORIGIN else ""
if SCORM_TRUSTED_SAME_ORIGIN and APP_ORIGIN != SCORM_ORIGIN:
    raise ImproperlyConfigured("Trusted same-origin content requires SCORM_ORIGIN=APP_ORIGIN.")
if APP_ORIGIN == SCORM_ORIGIN and not SCORM_TRUSTED_SAME_ORIGIN:
    raise ImproperlyConfigured("SCORM_ORIGIN must be isolated from APP_ORIGIN.")
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "training",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "training.runtime_settings.SettingsContextMiddleware",
    "training.locale_middleware.InterfaceLocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "training.brand.brand_context",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR}/db.sqlite3", conn_max_age=60
    )
}
AUTH_USER_MODEL = "training.User"
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
from training.languages import parse_interface_languages, DJANGO_CODES, LABELS
from training.brand import BRAND_PATH

INTERFACE_LANGUAGES_SERVER = bool(os.getenv("INTERFACE_LANGUAGES", "").strip())
SETTINGS_ENCRYPTION_KEY = os.getenv("SETTINGS_ENCRYPTION_KEY", "")
INTERFACE_LANGUAGES = parse_interface_languages(os.getenv("INTERFACE_LANGUAGES", ""))
LANGUAGE_CODE = DJANGO_CODES[INTERFACE_LANGUAGES[0]]
LANGUAGES = [(DJANGO_CODES[code], LABELS[code]) for code in INTERFACE_LANGUAGES]
LOCALE_ROOT = Path(os.getenv("LOCALE_ROOT", BASE_DIR.parent / "shared" / "locales"))
TIME_ZONE = "Asia/Taipei"
USE_I18N = True
USE_TZ = True
FORCE_SCRIPT_NAME = APP_BASE_PATH or None
STATIC_URL = APP_BASE_PATH + "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [("brand", BRAND_PATH)]
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", str(BASE_DIR / "media")))
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
CSRF_TRUSTED_ORIGINS = [APP_ORIGIN]
SESSION_COOKIE_NAME = "training_session" if DEBUG else "__Host-training_session"
CSRF_COOKIE_NAME = "training_csrf" if DEBUG else "__Host-training_csrf"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 8 * 60 * 60
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_HSTS_SECONDS = 0 if DEBUG else 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = False
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "training.authentication.CsrfSessionAuthentication"
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {"anon": "600/min", "user": "600/min"},
    "NUM_PROXIES": 0,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}
# DB-backed limiter in auth_views additionally works across multiple gunicorn workers.
EMAIL_SERVER = bool(os.getenv("EMAIL_BACKEND", "") or os.getenv("EMAIL_HOST", ""))
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "") or "training.mail.ConfiguredEmailBackend"
EMAIL_FILE_PATH = os.getenv("EMAIL_FILE_PATH", str(BASE_DIR / "test-mail"))
EMAIL_TIMEOUT = 10
AUTH_ACCOUNT_LIMIT = 20
AUTH_NETWORK_LIMIT = max(1, int(os.getenv("AUTH_NETWORK_LIMIT", "300")))
EMAIL_HOST = os.getenv("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "true") == "true"
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "training@example.com")
GRAPH_MAIL_TENANT_ID = os.getenv("GRAPH_MAIL_TENANT_ID", "")
GRAPH_MAIL_CLIENT_ID = os.getenv("GRAPH_MAIL_CLIENT_ID", "")
GRAPH_MAIL_CLIENT_SECRET = os.getenv("GRAPH_MAIL_CLIENT_SECRET", "")
GRAPH_MAIL_SENDER = os.getenv("GRAPH_MAIL_SENDER", "")
EMAIL_NOTIFICATIONS_ENABLED = os.getenv("EMAIL_NOTIFICATIONS_ENABLED", "true").lower() == "true"
EMAIL_QUEUE_BATCH = max(1, int(os.getenv("EMAIL_QUEUE_BATCH", "20")))
EMAIL_DAILY_LIMIT = max(0, int(os.getenv("EMAIL_DAILY_LIMIT", "5000")))
NOTIFICATION_TIME_ZONE = os.getenv("NOTIFICATION_TIME_ZONE", "America/New_York")
try:
    ZoneInfo(NOTIFICATION_TIME_ZONE)
except (ValueError, ZoneInfoNotFoundError):
    raise ImproperlyConfigured("NOTIFICATION_TIME_ZONE must be a valid IANA time zone.") from None

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"mail": {"format": "{asctime} {levelname} {name} {message}", "style": "{"}},
    "handlers": {"mail_console": {"class": "logging.StreamHandler", "formatter": "mail"}},
    "loggers": {"training.notifications": {
        "handlers": ["mail_console"], "level": "WARNING", "propagate": False,
    }},
}
ENTRA_TENANT_ID = os.getenv("ENTRA_TENANT_ID", "")
ENTRA_CLIENT_ID = os.getenv("ENTRA_CLIENT_ID", "")
ENTRA_CLIENT_SECRET = os.getenv("ENTRA_CLIENT_SECRET", "")
ENTRA_REDIRECT_URI = os.getenv(
    "ENTRA_REDIRECT_URI", APP_ORIGIN + APP_BASE_PATH + "/api/auth/entra/callback/"
)

# Directory credentials fall back individually to the mail application's values.
GRAPH_DIRECTORY_TENANT_ID = os.getenv("GRAPH_DIRECTORY_TENANT_ID", "")
GRAPH_DIRECTORY_CLIENT_ID = os.getenv("GRAPH_DIRECTORY_CLIENT_ID", "")
GRAPH_DIRECTORY_CLIENT_SECRET = os.getenv("GRAPH_DIRECTORY_CLIENT_SECRET", "")
DIRECTORY_REQUIRE_LICENSE = os.getenv("DIRECTORY_REQUIRE_LICENSE", "true").lower() == "true"
DIRECTORY_EMAIL_DOMAINS = [d.strip() for d in os.getenv("DIRECTORY_EMAIL_DOMAINS", "").split(",") if d.strip()]
DIRECTORY_SYNC_INTERVAL_HOURS = max(0, float(os.getenv("DIRECTORY_SYNC_INTERVAL_HOURS", "0")))
EMAIL_CODE_FOR_ENTRA_USERS = os.getenv("EMAIL_CODE_FOR_ENTRA_USERS", "false").lower() == "true"
EMAIL_CODE_DOMAINS = [d.strip() for d in os.getenv("EMAIL_CODE_DOMAINS", "").split(",") if d.strip()]

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_WORKSPACE_DOMAINS = [d.strip().lower() for d in os.getenv("GOOGLE_WORKSPACE_DOMAINS", "").split(",") if d.strip()]
GOOGLE_REDIRECT_URI = APP_ORIGIN + APP_BASE_PATH + "/api/auth/google/callback/"
