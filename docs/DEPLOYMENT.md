# Deployment, identity and operations

## Domains and storage

Use separate origins such as `learn.example.com` and `content.example.com`, with HTTPS terminated by a trusted reverse proxy or Azure Application Gateway. Keep them on the same registrable site so the content service's SameSite=Lax cookies work. Never serve uploaded SCORM HTML under the application origin or expose `/api/` and `/admin/` through the content origin.

Compose defaults to a loopback-only environment. For production, set `DEBUG=false`, `DEMO_MODE=false`, a random `SECRET_KEY`, a separate database password, `ALLOWED_HOSTS`, `APP_ORIGIN` and `SCORM_ORIGIN`. Restrict access to the database and internal services. If a proxy terminates TLS, configure Nginx and the trusted proxy to supply the correct `X-Forwarded-Proto`; do not accept a client-supplied value as trusted evidence of HTTPS.

Production session and CSRF cookies are Secure, host-only and use `__Host-` names; session cookies are HttpOnly. The signed SCORM launch ticket lasts 120 seconds. Content cookies grant access to one package for up to eight hours. Launch query strings are excluded from the content proxy access log. Rotating `SECRET_KEY` invalidates signed credentials.

Use PostgreSQL 17 for deployment; SQLite is for development. Uploaded packages and editable project backups live in the `media` volume. Persistent Azure Files can replace that volume after validating permissions and performance. Back up PostgreSQL and media together and rehearse restoration.

The bundled Nginx configuration resolves API/content names through Docker DNS and refreshes them after container replacement. If deploying Nginx outside Docker, set an appropriate trusted resolver. See [Nginx resolver behavior](https://nginx.org/en/docs/http/ngx_http_core_module.html#resolver).

## Microsoft Entra ID

1. Register a single-tenant application in the company tenant, using the **Web** platform.
2. Set the redirect URI to `https://learn.example.com/api/auth/entra/callback/`.
3. Set `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID` to their GUIDs.
4. Supply `ENTRA_CLIENT_SECRET` through the deployment environment or Key Vault and establish secret rotation. It is never sent to the frontend.
5. Apply user assignment, MFA and Conditional Access according to company policy.
6. Test allowed staff, directory guests, deactivated users, the wrong tenant, sign-out and session expiry.

MSAL manages the authorization-code flow, state, nonce and PKCE. The callback also validates the tenant and uses `tenant-id:object-id` as the stable subject. A valid new SSO user receives the learner role; email or display name cannot grant administrative rights.

An existing local email is not automatically linked to a new Entra subject. After verifying ownership, a Django administrator can set that user's `entra_subject` to `tenant-id:object-id`. The next SSO login preserves the existing identity and attempt budgets. Platform administrators and Django superusers are separate permissions; reserve superuser access for operators.

References: [Microsoft OIDC documentation](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc) and [authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

## Email and employee ID access

Administrators provision local accounts. Login identifiers are checked for collisions across username, email and employee ID. These identifiers cannot be changed through the general editing API, to protect identity and budget matching. Accounts without email can use a username or employee ID with a password.

Email sign-in uses a six-digit code valid for ten minutes, with at most five incorrect entries. Codes are hashed and deleted after successful verification. Unknown email addresses receive the same API response and do not create accounts. SMTP delivery failure also returns the generic sign-in response to avoid account enumeration; add delivery monitoring and operational alerts.

Set `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` and `DEFAULT_FROM_EMAIL`. The normal backend is SMTP. The file email backend used in browser tests must not be used for company mail.

Authentication rate counters are stored in PostgreSQL and apply across API workers. DRF's general API throttles use process-local memory; larger deployments should configure a shared cache and gateway rate limits. Passwords use Django hashing and configured password validation. Authorized Django administrators can reset provisioned users' passwords.

## Exam audiences and budgets

Choose an audience in the exam editor: all accounts, employees, contractors, selected departments, selected people or invitation only. Rules use the current active account's employment type, exact department value or ID. They are enforced when listing exams and starting an attempt. Administrators can manage every exam; instructors can manage their own exams. Learners cannot inspect assignment lists or answer keys.

An invitation grants access to its named identity independently of the account audience. Existing attempts remain available if the audience changes; an excluded participant cannot start a new account attempt. Publishing, exam opening/closing times and attempt limits still apply to invitations.

The total identity budget uses an individual override when present, otherwise the exam default. A guest link has an additional cap. Starting locks the exam and budget in a PostgreSQL transaction and consumes one slot only when creating an attempt. Refreshing resumes an unexpired attempt. Multiple links and a linked account share the same identity budget.

## Guest links and email verification

A 256-bit random token is placed in the URL fragment and exchanged for a CSRF-protected server session, then removed from the URL. Only its SHA-256 hash is stored. The full link is returned once at creation. The participant cannot replace the identity key to reset usage.

The organizer form enables **Require recipient email verification** by default. For email keys, delivery uses that address; for known accounts, it uses the account email. For an external account key without a mailbox, the organizer must provide a recipient email. The address is fixed at issue time and guests see only a masked hint.

After opening a protected link, the guest requests a code and verifies it before seeing the invitation details or starting an attempt. Codes are session-bound, hashed, expire after ten minutes and lock after five incorrect entries. Resending invalidates the previous code in that session. Verification consumes no exam attempt. Expired/revoked invitations cannot request or verify a code; revocation also denies later guest access. SMTP failures return a clear delivery error and remove the unusable challenge.

The API defaults `require_email_verification` to `false` for compatibility with existing integrations. API clients should send `true` explicitly for verified access. Existing links remain unchanged. A link with verification disabled is a bearer credential: its holder can act as the named participant.

## Languages and content

English is the initial language even when the browser prefers another language. The interface offers `en`, `zh-TW` and `es`. The choice is stored in that browser's `training-language` localStorage entry and shared between the platform and `/studio/`; it is not a user-profile setting. The `django_language` cookie and API request header select matching server messages (`zh-hant` for Django). Cross-tab changes update open interfaces.

The shared catalog is `shared/locales/messages.json`. Language changes preserve unsaved form values and active answers. Authored content is never automatically translated. New demonstration data is English; existing demo records remain unchanged. Scormly's upstream sample course remains authored English, with its retained Ukrainian source variant. The exported player supports Traditional Chinese in addition to its existing languages and receives the current UI language through the LMS preference fields when automatic language selection is enabled.

## Submission and operations

Starting an exam snapshots questions, solutions, points and the pass threshold. Learner/guest responses never include solution keys. Answers arriving after the deadline are not accepted. The scheduler finalizes expired attempts every minute; reading an attempt or results also finalizes overdue work. PostgreSQL locks protect submission and grading.

Before organizational rollout:

1. Run CI and build deployment images; apply migrations.
2. Deploy API, web, content and one scheduler with health monitoring.
3. Provision operators and assign platform roles.
4. Configure Entra/SMTP and complete real sign-in, verified invitation and SCORM acceptance tests.
5. Validate company course packages and load-test the expected concurrency.
6. Maintain backups and retention. The audit API is read-only, but the database audit table is not a tamper-proof external log store.

GitHub Actions builds and tests the code. It does not automatically publish company data or deploy the service to the internet.

## Required training and question banks

The v1.0 migration adds required training assignments and reusable question banks. Active assignments grant their participants exam access in addition to the exam audience. Instructor reports and question banks are scoped to owned content; administrator reports span the workspace. Read [training operations](OPERATIONS.md) for deadline semantics, cancellation, question copying and random exam snapshots.

The participant import creates new learner accounts atomically and never overwrites existing people. Profile editing and local password changes are available in the workspace. Existing Entra identities and attempt budgets remain unchanged by these additions.

For company rollout, use the [Peach1 handover](PEACH1-HANDOVER.md). `scripts/backup.py` creates a consistent database/media backup and only restores into a fresh isolated Compose project. The CI container job rehearses restoration and checks that an existing destination cannot be overwritten. `check_deployment --strict` checks local prerequisites without contacting Microsoft Graph or the tenant.
