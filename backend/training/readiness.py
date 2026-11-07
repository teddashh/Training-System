"""Local deployment checks. Never return secrets or claim tenant connectivity."""

import shutil
import tempfile
from urllib.parse import urlparse

from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from .models import User


def deployment_readiness():
    checks = []

    def add(key, label, passed, detail):
        checks.append(
            {
                "key": key,
                "label": label,
                "status": "ready" if passed else "action_required",
                "detail": detail,
            }
        )

    add(
        "production",
        "Production configuration",
        not settings.DEBUG
        and not __import__("os").getenv("DEMO_MODE", "false").lower() == "true",
        "Set DEBUG=false and DEMO_MODE=false for company deployment.",
    )
    app, content = urlparse(settings.APP_ORIGIN), urlparse(settings.SCORM_ORIGIN)
    add(
        "origins",
        "HTTPS and isolated course content",
        app.scheme == content.scheme == "https" and app.netloc != content.netloc,
        "Use separate HTTPS origins on the same registrable site; verify the reverse proxy and browser cookies.",
    )
    add(
        "database",
        "PostgreSQL database",
        connection.vendor == "postgresql",
        "PostgreSQL is required for concurrent attempt protection in deployment.",
    )
    try:
        executor = MigrationExecutor(connection)
        pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
        add(
            "migrations",
            "Database migrations",
            not pending,
            "Apply all database migrations before accepting traffic.",
        )
        add(
            "administrator",
            "Active platform administrator",
            User.objects.filter(role="admin", is_active=True).exists(),
            "Provision at least one administrator and a separate operator recovery account.",
        )
    except Exception:
        add(
            "migrations",
            "Database migrations",
            False,
            "Database checks failed. Check database connectivity and run migrations.",
        )
    try:
        with tempfile.TemporaryFile(dir=settings.MEDIA_ROOT) as probe:
            probe.write(b"readiness")
        free = shutil.disk_usage(settings.MEDIA_ROOT).free
        add(
            "storage",
            "Writable course storage",
            free > 1024**3,
            "Course storage must be writable with more than 1 GiB available. Monitor capacity separately.",
        )
    except OSError:
        add(
            "storage",
            "Writable course storage",
            False,
            "Create and mount writable persistent media storage for the API.",
        )
    smtp = (
        settings.EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend"
        and settings.EMAIL_HOST not in ("", "localhost")
        and not settings.DEFAULT_FROM_EMAIL.endswith("@example.com")
    )
    add(
        "email",
        "Company email configuration",
        smtp,
        "Configuration check only. Test a real sign-in code and a verified guest invitation after deployment.",
    )
    configured = all(
        (
            settings.ENTRA_TENANT_ID,
            settings.ENTRA_CLIENT_ID,
            settings.ENTRA_CLIENT_SECRET,
        )
    )
    checks.append(
        {
            "key": "entra",
            "label": "Microsoft Entra configuration",
            "status": "configured" if configured else "deferred",
            "detail": "Tenant connectivity, consent and Graph synchronization must be verified on Peach1. No tenant API was called.",
        }
    )
    return {
        "checks": checks,
        "ready": all(c["status"] == "ready" for c in checks if c["key"] != "entra"),
        "entra_configured": configured,
    }
