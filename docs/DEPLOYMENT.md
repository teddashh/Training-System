# Install and maintain Training System

Start with [the first-hour guide](GETTING-STARTED.md). This guide covers server setup and recovery. Use [Operations](OPERATIONS.md) for daily training tasks.

## Check requirements

Use Docker Engine with Compose v2. The images use Python 3.13, Node.js 24 for builds, PostgreSQL 17 and Nginx. The Python lockfile pins Django 5.2.19 and Django REST Framework 3.18.3. The frontend declares React 19.2 and Vite 7.2 version ranges. See [Dockerfile](../Dockerfile), [Dockerfile.web](../Dockerfile.web), [requirements.txt](../backend/requirements.txt) and [package.json](../frontend/package.json).

Provide persistent storage for the `postgres` and `media` volumes. The readiness check requires writable media storage with more than 1 GiB free. Size resources and test concurrent use for your workload. The repository does not establish a production capacity guarantee. SQLite is for local development.

## Start Docker Compose

From the repository root:

```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env`. Replace `SECRET_KEY` and `POSTGRES_PASSWORD` with separate random values from your secret manager. Use a URL-safe database password because Compose embeds it in a database URL. Keep `.env` out of source control.

For a local trial, keep `DEBUG=true` and set `DEMO_MODE=false`. The latter hides demonstration controls. Leave sign-in and e-mail credentials empty to configure them later in Settings.

```bash
docker compose config --quiet
docker compose up --build -d --wait
docker compose exec api python manage.py createsuperuser --username training-admin
docker compose exec api python manage.py shell -c "from training.models import User; u=User.objects.get(username='training-admin'); u.role='admin'; u.save(update_fields=['role'])"
```

Supply the administrator's e-mail and a strong password at the prompts. The second command gives that specific account the platform **Super administrator** role. Django superuser status and the platform role are separate.

Open <http://localhost:8080>. Sign in with the local password. Open **Settings → Settings**, or `/settings`. The content listener is <http://localhost:8081>; course launches supply the required access credentials. Compose binds both listeners to loopback. The API applies migrations before it starts.

For HTTPS production, set `DEBUG=false` and `DEMO_MODE=false` before opening access. Do not use demonstration data in a live deployment.

## Configure environment variables

[.env.example](../.env.example) lists the variables passed by [compose.yaml](../compose.yaml). Local Python commands do not load that file automatically.

### Server and storage

| Variables | Purpose |
| --- | --- |
| `DEBUG`, `DEMO_MODE` | Development behavior and demonstration controls. Both should be false in production. |
| `SECRET_KEY`, `POSTGRES_PASSWORD` | Django signing/encryption root and database password. Store separately from the repository. |
| `ALLOWED_HOSTS` | Comma-separated accepted request hosts. Include the deployment hosts and internal service hosts needed by health checks. |
| `APP_ORIGIN`, `APP_BASE_PATH` | Public application origin and optional path, such as `https://training.example.com` and `/training`. |
| `SCORM_ORIGIN`, `SCORM_TRUSTED_SAME_ORIGIN` | Content origin and explicit trusted-content mode. Keep the latter false for isolated packages. |
| `SETTINGS_ENCRYPTION_KEY` | Optional Fernet key for credentials stored in Settings. |
| `BRAND` | Pack directory name; defaults to `default`. Rebuild backend and web images after changes. |
| `INTERFACE_LANGUAGES` | Allowed languages in default-first order: `en`, `zh-TW`, `es`. Empty delegates to Settings. |

Compose constructs `DATABASE_URL` and mounts media at `/app/media`. Direct Python deployments can set `DATABASE_URL`, `MEDIA_ROOT` and `LOCALE_ROOT`; those are not additional pass-through variables in the bundled Compose file.

### Sign-in and e-mail

| Variables | Settings equivalent |
| --- | --- |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Sign-in: Microsoft Entra ID |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_WORKSPACE_DOMAINS` | Sign-in: Google Workspace, with comma-separated exact domains |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL` | Email: SMTP server. Server configuration uses STARTTLS when `EMAIL_USE_TLS=true`. |
| `EMAIL_BACKEND` | Explicit Django transport. For Microsoft 365 use `training.mail.GraphEmailBackend`. |
| `GRAPH_MAIL_TENANT_ID`, `GRAPH_MAIL_CLIENT_ID`, `GRAPH_MAIL_CLIENT_SECRET`, `GRAPH_MAIL_SENDER` | Email: Microsoft 365 mailbox. Set the server's `DEFAULT_FROM_EMAIL` to the same mailbox. |

Environment configuration wins and the UI shows **Set by the server**:

- Any nonempty Entra tenant/client/secret or Google client/secret locks the whole Sign-in section. If both providers have credentials, Entra takes precedence. Set only the intended provider.
- Nonempty `EMAIL_HOST` or `EMAIL_BACKEND` locks Email. Other e-mail fields alone do not select the server transport.
- Nonempty `INTERFACE_LANGUAGES` locks the language list. Unknown codes are ignored; a list with no valid codes falls back to English.

Leave those selector variables empty to use Settings. Name and logo remain editable. `DEFAULT_FROM_EMAIL` is used by server-configured e-mail, not as the saved Settings sender.

### Directory and authentication policy

| Variables | Behavior |
| --- | --- |
| `GRAPH_DIRECTORY_TENANT_ID`, `GRAPH_DIRECTORY_CLIENT_ID`, `GRAPH_DIRECTORY_CLIENT_SECRET` | Directory app credentials. Each blank value falls back to its `GRAPH_MAIL_*` counterpart. |
| `DIRECTORY_REQUIRE_LICENSE` | Default true: require an assigned license for bulk provisioning. |
| `DIRECTORY_EMAIL_DOMAINS` | Comma-separated exact allowed domains; empty means no domain filter. |
| `DIRECTORY_SYNC_INTERVAL_HOURS` | Default 0: manual sync only. Positive hours enable scheduled sync. |
| `EMAIL_CODE_FOR_ENTRA_USERS` | Default false: directory-linked users use Microsoft sign-in for passwordless access unless the domain exception applies. |
| `EMAIL_CODE_DOMAINS` | Exact domains allowed for eligible learner codes and on-demand directory provisioning. Empty disables the exception. |
| `PASSWORD_SIGN_IN` | Default true. False turns off password sign-in, password changes and the password fields for people, including the password form of the data maintenance tool. Company sign-in and e-mail codes remain: keep one of them working first. To recover access, set it to true and restart the API. |
| `AUTH_NETWORK_LIMIT` | Default 300 requests per direct peer per ten minutes. Account limit remains 20. |

Directory provisioning is separate from sign-in and mail. See [directory setup](#microsoft-entra-directory-provisioning) and [operator safeguards](OPERATIONS.md#directory-provisioning-operators).

### Scheduler and notifications

| Variable | Default and effect |
| --- | --- |
| `EMAIL_NOTIFICATIONS_ENABLED` | `true`; false pauses enqueueing and queued delivery. Codes and administrator tests are separate. |
| `EMAIL_QUEUE_BATCH` | `20` real send attempts per tick, subject to a roughly 30-second admission budget. |
| `EMAIL_DAILY_LIMIT` | `5000` accepted platform messages in a rolling 24 hours; 0 disables the cap. Codes and tests count but bypass it. |
| `NOTIFICATION_TIME_ZONE` | `America/New_York`; IANA time zone for notification timestamps. |

Run one `scheduler` service. Each loop expires attempts, produces reminders, delivers queued mail and checks directory scheduling, then sleeps 60 seconds. Failures in one duty do not skip later duties. Apply migrations before starting the scheduler.

[Queue operations](OPERATIONS.md#email-notifications-and-delivery-log) cover retry, pause and ambiguous delivery. Turning e-mail Off removes code entry points and prevents new mail. It does not provide an alternate delivery channel.

## Add HTTPS and a mount path

Use a trusted reverse proxy in front of the loopback listeners. For example:

```dotenv
APP_ORIGIN=https://training.example.com
APP_BASE_PATH=/training
SCORM_ORIGIN=https://content.example.com
SCORM_TRUSTED_SAME_ORIGIN=false
```

Origins contain only a scheme and host, with an optional port. `APP_BASE_PATH` contains the path, without a trailing slash. Rebuild the web image when it changes; both frontend builds receive this argument.

At the outer proxy, forward `/training/` to the application listener and strip that prefix. The bundled container serves application routes at `/`; the builds and Django generate public URLs with the prefix. Preserve the separate content origin at its root.

The bundled [Nginx config](../deploy/nginx.conf) sets `X-Forwarded-Proto` from its own connection scheme. If TLS ends at an outer proxy, adapt the private proxy chain to pass trusted HTTPS information to Django. Overwrite client-supplied forwarding headers. Do not expose a listener that accepts spoofed HTTPS headers.

Production cookies are Secure and require HTTPS for sign-in. Verify password login, CSRF-protected saves, provider callbacks and SCORM save/resume through the final proxy. Configuration checks do not perform those acceptance tests.

## Check static-file caching

The bundled Nginx config compresses eligible static text responses of at least 1,024 bytes when the client accepts gzip. Hashed application `/assets/` files use a one-year immutable cache. `/covers/` files use a one-day cache. Missing files return 404 without the public cache header.

Application and Studio HTML shells use `no-cache`, including SPA fallbacks. Studio assets have no added long-lived cache policy. Proxied API/content responses are not compressed by this container. Preserve these distinctions when adapting your proxy.

## Isolate SCORM packages

Use a separate HTTPS origin on the same registrable site, such as `content.example.com`, so SameSite=Lax content cookies work. The content origin must not serve `/api/` or `/admin/`. Do not expose `media` as a static directory.

A signed launch ticket lasts 120 seconds. A package-scoped content cookie lasts up to eight hours. The content service checks admission and serves package files; the application stores progress. Uploaded HTML is executable content, even when ZIP validation succeeds.

`SCORM_TRUSTED_SAME_ORIGIN=true` is an explicit alternative for administrator-reviewed packages. It requires `SCORM_ORIGIN=APP_ORIGIN`, serves packages under `APP_BASE_PATH/content`, and restricts uploads to system administrators. It gives package scripts application-origin privileges. It is not origin isolation. See [Security](../SECURITY.md).

## Register Microsoft Entra ID sign-in

In the tenant, register a single-tenant application using the **Web** platform. Register the exact URI shown in **Settings → Settings → Sign-in → Change → Redirect URI**. With the example mount it is:

```text
https://training.example.com/training/api/auth/entra/callback/
```

Choose **Microsoft Entra ID**, then enter Tenant ID, Client ID and Client secret. Save. Store real values only in Settings or the protected environment. Apply tenant assignment, MFA and Conditional Access policies as needed.

A new valid subject creates a learner. Existing local e-mail addresses are not silently linked to Entra subjects. After verifying ownership, an authorized Django operator can set `entra_subject` to `tenant-id:object-id`. This preserves the existing user's identity and attempt budget.

## Register Google Workspace sign-in

In Google Cloud, configure the OAuth consent screen and create an OAuth client of type **Web application**. Add the displayed redirect URI to **Authorized redirect URIs**:

```text
https://training.example.com/training/api/auth/google/callback/
```

Choose **Google Workspace** in Sign-in. Enter Client ID, Client secret and the allowed Workspace domains, such as `example.com`. Domains are exact matches, not wildcard suffixes. The callback requires a verified e-mail and an allowed hosted domain.

An existing active account with the same verified e-mail is linked. Otherwise the callback creates a learner. Test both allowed and rejected domains. Provider registration and actual tenant sign-in must be verified in your environment.

## Configure e-mail

Under **Settings → Settings → Email → Change**, select **SMTP server**, **Microsoft 365 mailbox**, or **Off**. Off is the default. Save before choosing **Send test email to me**. The test targets the signed-in administrator's address and is rate limited.

SMTP needs a reachable host, port, accepted sender and any required credentials. Settings supports **STARTTLS**, **SSL** and **None**. Use the transport required by your mail server. Production readiness rejects an example sender in server-configured SMTP; replace examples with your verified sender when deploying.

Microsoft 365 needs a tenant, application credentials and a sender mailbox. Use a separate mail app with **Application Mail.Send** through Exchange Online Application RBAC, scoped to the sender mailbox. Avoid an additional tenant-wide Graph Mail.Send grant because grants are additive. The mail application does not need mailbox-reading or directory-management rights.

Check the allowed mailbox and an out-of-scope mailbox with `Test-ServicePrincipalAuthorization` in your Exchange administration environment. Then test real delivery. This repository implements the Graph client, not tenant or mailbox provisioning.

Graph sends MIME messages over HTTPS and honors proxy environment settings. It rejects other senders and redirects. It does not automatically retry an ambiguous send POST. A 202 response means accepted for processing, not confirmed delivery. See [mail implementation](../backend/training/mail.py).

## Preserve settings encryption keys

Stored provider secrets use Fernet. Without `SETTINGS_ENCRYPTION_KEY`, the encryption key is derived from `SECRET_KEY` using HKDF. Supply a dedicated Fernet key if settings encryption must survive Django signing-key rotation.

Back up the effective key separately from the database. Changing either effective key makes old ciphertext unreadable. Re-enter saved secrets after the change; affected providers cannot use undecryptable credentials. Blank secret fields retain the previous ciphertext and do not repair it.

Changing `SECRET_KEY` also invalidates signed sessions/capabilities and prevents recovery of earlier invitation-batch responses. Already issued invitation tokens are checked against stored hashes. Logos are re-encoded PNG bytes in the database, so database backups include them.

## Microsoft Entra directory provisioning

Use a directory app with Microsoft Graph application `User.Read.All` and tenant administrator consent. The directory tenant must match the effective Entra sign-in tenant. Linked Entra training groups also require `GroupMember.Read.All`. Keep directory permissions separate from mail scope.

Leave scheduling at zero until you review a complete preview under the intended license/domain filters. **People → Sync from Microsoft Entra** previews and applies the current listing. Apply fetches again, so the preview is not a frozen authorization. Collisions and protected accounts need review. See [directory operations](OPERATIONS.md#directory-provisioning-operators).

Migration `0019_directory_and_groups` follows `0018_outbound_email`. Check for case-equivalent Entra subjects before the unique constraint is applied. Keep scheduling disabled during rollback. Do not reverse the additive migration or delete provisioned people as a rollback method.

## Back up and restore

Use [scripts/backup.py](../scripts/backup.py) from the repository root:

```bash
python3 scripts/backup.py --help
python3 scripts/backup.py create /private/backups/training-YYYYMMDD --project training
python3 scripts/backup.py verify /private/backups/training-YYYYMMDD
python3 scripts/backup.py restore /private/backups/training-YYYYMMDD --project training-restore
```

Replace paths and project names with your own. The source project must match the running Compose project. The destination must be new, with no existing containers or volumes. The backup directory must not already exist for `create`.

Creation stops running web, scheduler, API and content services while dumping PostgreSQL and archiving media. It restarts those services in `finally`, including after failure. Schedule a maintenance window. Accept only a backup with a valid manifest and matching checksums.

The archive excludes `.env` and environment credentials. Back them up separately, including the settings encryption key. Restrict access to database dumps, which contain personal data and encrypted Settings credentials. Restore only trusted archives because database dumps contain executable SQL.

Restore verifies the archive, starts only the destination database, restores database/media, applies migrations and runs Django checks. It leaves web, API, content and scheduler stopped. Inspect the restored records and files before routing traffic. Use matching code/images and an isolated environment for a rehearsal.

## Upgrade and roll back

Back up database and media together. Retain the previous code revision, image IDs and protected environment. Deploy matching web, API, content and scheduler images, then check migrations and readiness:

```bash
docker compose up --build -d --wait
docker compose exec api python manage.py migrate --check
docker compose exec api python manage.py check_deployment --strict
```

Add `--require-entra` only when Entra is required. Readiness checks configuration presence and local prerequisites. It does not prove provider connectivity or delivery. Email **Off** is a supported choice: readiness lists it as Off and it does not fail `--strict`.

Review [migration and rollback notes](OPERATIONS.md#migrations-and-rollback) before restoring an older image. Keep additive schema/data in place unless a reviewed migration plan requires otherwise. Restore a complete backup into a new project when data recovery is needed. Do not reset the live database or replay seed/import commands.

## Choose branding and languages

`BRAND=default` uses [the default pack](../shared/brand/default/brand.json). Packs contain tokens, two logo shapes and identity metadata. To add one, follow [DESIGN.md](../DESIGN.md#brand-packs). Compose passes `BRAND` as a build argument to both images and as a runtime variable to backend services.

Settings changes the organization name and logo without rebuilding. It also chooses the allowed interface languages when `INTERFACE_LANGUAGES` is empty. English, Traditional Chinese and Spanish are available. The first allowed language is the fallback. A one-language deployment hides the picker. Authored lessons and questions are not translated.

## Develop locally

Use Python 3.13 and Node.js 24. From the repository root:

```bash
python3.13 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm ci --prefix frontend
npm ci --prefix vendor/scormly
DEBUG=true .venv/bin/python backend/manage.py migrate
DEBUG=true .venv/bin/python backend/manage.py createsuperuser --username training-admin
DEBUG=true .venv/bin/python backend/manage.py shell -c "from training.models import User; u=User.objects.get(username='training-admin'); u.role='admin'; u.save(update_fields=['role'])"
```

Run each service in a separate terminal:

```bash
DEBUG=true .venv/bin/python backend/manage.py runserver 127.0.0.1:8000
DEBUG=true DJANGO_SETTINGS_MODULE=config.content_settings .venv/bin/python backend/manage.py runserver 127.0.0.1:8001
npm run dev --prefix frontend
npm run dev --prefix vendor/scormly -- --base=/studio/ --port 5174 --host 127.0.0.1
```

Open <http://localhost:5173>. Set environment variables explicitly for local commands. The Vite configurations proxy API and Studio requests.

Run checks for the paths you change:

```bash
DEBUG=true .venv/bin/python backend/manage.py check
DEBUG=true .venv/bin/python backend/manage.py test training
npm run test:unit --prefix frontend
npm run build --prefix frontend
npm run build --prefix vendor/scormly -- --base=/studio/
npm test --prefix vendor/scormly
python3 scripts/check_upstream_audit.py
```

SQLite skips PostgreSQL locking tests. Run the backend suite against an isolated PostgreSQL test deployment before shipping changes to concurrency behavior. Browser workflows use [the Playwright configuration](../frontend/playwright.config.ts); they need running services and synthetic accounts. Do not run mutating browser tests against a live deployment.
