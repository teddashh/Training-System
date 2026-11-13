# Security scope

## Review the supported runtime

The supported runtime is `backend/`, `frontend/`, integrated `vendor/scormly/` and the Compose deployment. Dependency manifests and lockfiles define the active packages. The upstream audit does not certify security or complete feature parity.

`legacy/yaksh/` is unsupported archival source. Its old dependencies are not part of the modern deployment. Do not install or deploy those requirements. `vendor/scorm-reference/` is also retained source, not a running service.

## Protect content and identities

The editor sanitizes imported and pasted rich HTML with DOMPurify. ZIP validation checks package paths and expansion limits. Neither control makes an uploaded SCORM package trusted executable code.

By default, packages run on a separate content origin. Signed launches and package-scoped cookies control access. Do not serve application APIs, administration or unprotected media on that origin.

`SCORM_TRUSTED_SAME_ORIGIN=true` serves reviewed packages at `APP_BASE_PATH/content` and limits uploads to system administrators. Package scripts then have application-origin privileges, including access to other services on the same hostname. Review every package before enabling this mode. Untrusted packages need the isolated origin.

Roles and ownership govern management and result access. Exam audiences govern new attempts. Account and guest aliases share identity budgets. Invitations can require a session-bound e-mail code; organizer forms enable verification by default. A link without verification is a bearer credential. Neither option provides proctoring.

Settings stores provider secrets encrypted with Fernet. Preserve the effective encryption key with your recovery materials. Secrets are not returned by the settings API. Read [key rotation behavior](docs/DEPLOYMENT.md#preserve-settings-encryption-keys) before changing `SECRET_KEY`.

## Prepare a deployment

Configure HTTPS, trusted proxy headers, least-privilege provider applications and restricted infrastructure access. Test sign-in, rejected identities, mail, package access and restore in your environment. Define retention for results, audit records and e-mail snapshots.

Use [Deployment](docs/DEPLOYMENT.md) for setup and [Operations](docs/OPERATIONS.md) for access and queue controls. Automated tests do not replace deployment acceptance checks.

## Report a vulnerability

Use GitHub private vulnerability reporting when available, or contact the repository owner privately. Include affected code and reproducible steps with synthetic data. Do not publish credentials, invitation links or personal records in a public issue.
