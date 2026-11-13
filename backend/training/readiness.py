"""Local deployment checks. Never return secrets or claim tenant connectivity."""

import shutil
import tempfile
from urllib.parse import urlparse

from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from .runtime_settings import mail_config, sign_in_config
from .access import system_admin_users


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
        "HTTPS and trusted company content" if settings.SCORM_TRUSTED_SAME_ORIGIN else "HTTPS and isolated course content",
        app.scheme == content.scheme == "https" and (
            app.netloc == content.netloc if settings.SCORM_TRUSTED_SAME_ORIGIN else app.netloc != content.netloc
        ),
        "Same-origin mode: only administrators may upload reviewed company packages. Content scripts have application-origin privileges."
        if settings.SCORM_TRUSTED_SAME_ORIGIN else
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
            system_admin_users().exists(),
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
    mail = mail_config()
    if mail["provider"] == "off":
        # Off is a supported choice, not missing setup: it does not hold back readiness.
        checks.append({"key": "email", "label": "Company email configuration", "status": "off", "detail": "Email is off."})
    else:
        add(
            "email",
            "Company email configuration",
            mail["configured"],
            "Configuration check only. Test a real sign-in code and a verified guest invitation after deployment.",
        )
    configured = sign_in_config()['configured']
    checks.append(
        {
            "key": "entra",
            "label": "Google Workspace configuration" if sign_in_config()["provider"] == "google" else "Microsoft Entra configuration",
            "status": "configured" if configured else "deferred",
            "detail": "Tenant connectivity, consent and Graph synchronization require separate verification. No tenant API was called.",
        }
    )
    return {
        "checks": checks,
        "ready": all(c["status"] in ("ready", "off") for c in checks if c["key"] != "entra"),
        "entra_configured": configured and sign_in_config()["provider"] == "entra",
        "sign_in_configured": configured,
    }
