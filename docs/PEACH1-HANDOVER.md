# Peach1 handover

This repository contains the company training platform. Peach1 is the target for company infrastructure configuration and Microsoft Entra / Graph integration. No tenant credentials, live directory data or email passwords belong in this public repository.

**The application is not yet feature-complete against all four source repositories.** The [upstream audit](UPSTREAM-AUDIT.md) records implemented, partial, missing and unverified workflows. The working capabilities listed below are a subset of that scope; the remaining platform implementation must not be mistaken for deployment-only Entra/Graph work.

## What is ready in the application

- English-default interface, with Traditional Chinese and Spanish throughout the workspace and authoring studio.
- Employee/contractor accounts, administrator/instructor/learner permissions, email codes, local passwords and employee ID sign-in. CSV onboarding previews all rows and imports atomically; profile and password changes are available in the UI.
- Single-tenant Entra OIDC sign-in, with stable `tenant-id:object-id` subjects and explicit linking for existing local accounts.
- Courses, block lessons, Scormly authoring, SCORM import/publication, isolated course execution, saved progress and editable authoring source downloads.
- Required training assignments, deadlines, learner worklists, instructor-scoped completion reports and CSV exports. A passing exam or completed course fulfills the requirement, including prior completion. Reassignment updates the requirement; it does not reset progress or attempt budgets.
- Independent and course-linked exams, seven question types, question banks, question/option shuffling, random subsets, audience restrictions, timing, automatic/manual grading and review feedback. Integer, numeric-with-tolerance and ordering questions work in authoring, guest/account attempts and reporting.
- Personal guest links with email/account-bound identity, expiry, revocation, optional email verification and per-link plus per-identity attempt limits.
- CSV invitation cohorts with preview validation, atomic issuance, retry recovery, link download and searchable, paginated history. Disabling a linked account blocks its guest links and active guest attempts.
- Performance dashboards, filtered results pagination and matching exports, assessment/question insights, individual attempt-budget preflight, audit history, expiry scheduler, Docker deployment and backup/restore tooling.

The system does not yet perform Microsoft Graph directory synchronization. Entra OIDC and Graph provisioning are separate integrations. Company packages, tenant controls, email delivery, infrastructure and expected concurrency need acceptance testing on Peach1.

## Deploy a clean company workspace

1. Clone `https://github.com/teddashh/Training-System.git` and record the tested commit or release tag. Install Docker Engine, Compose v2 and Python 3.11+ for the backup tool.
2. Copy `.env.example` to `.env`, set long random secrets, `DEBUG=false`, `DEMO_MODE=false`, production `ALLOWED_HOSTS`, and two HTTPS origins such as `learn.company.example` and `content.company.example`. Keep the origins within the same registrable site. Store secrets locally or in a secret manager.
3. Route the two domains through a trusted TLS reverse proxy to loopback ports 8080 and 8081. Follow [deployment details](DEPLOYMENT.md), including forwarding HTTPS information correctly. The content origin must not expose application APIs or administration.
4. Run `docker compose up --build -d --wait`. Database migrations run before the API becomes healthy.
5. Run `docker compose exec api python manage.py createsuperuser` to create an operator. In Django administration, set the intended application administrator's **Enterprise → role** to **Administrator**. Django superuser privileges and platform roles are separate. Keep a tested local recovery account.
6. Do **not** run `seed_demo` on a company installation. If moving a real existing workspace, use the restore procedure below. Existing demo installations do not become clean company workspaces by changing `DEMO_MODE`.
7. Configure SMTP, verify real email-code delivery, and provision local participants through **People & permissions**. CSV headers are documented in [operations](OPERATIONS.md).
8. Run `docker compose exec api python manage.py check_deployment --strict`. Review **Settings & audit → Deployment readiness**. These checks inspect local configuration; they do not verify DNS, certificates, SMTP delivery, scheduler health or tenant access.
9. Connect Entra and Graph following the contract below, then complete the acceptance table. Entra configuration can remain deferred during local platform validation.

## Changes after v1.3

Managers now have live account/guest attempt monitoring, saved-progress/contact indicators, filtered pagination, submitted-paper review links and audited time extensions. Extension requests recover after lost responses without double-applying minutes. The learner timer synchronizes with the server and preserves drafts across delayed requests; PostgreSQL coverage checks duplicate/concurrent grants, submission races and expiry workers waiting on a newly extended deadline. This remains progress monitoring, with no attention/proctoring claim. Reopening completed papers and inspecting individual active answers remain unsupported. See [monitor operations](OPERATIONS.md#live-exam-monitoring-and-extra-time).

Migration `0012_attempt_monitoring` adds nullable contact/save timestamps, a zero-default extra-time total and a protected extension-history table with limits. Existing deadlines, snapshots, responses, scores, identities, budgets and course progress are preserved. Back up database/media, deploy matching web/API/worker images outside active exams, and reload existing tabs. Old players can submit at the original timer boundary, and old expiry workers do not recheck an extension after waiting for a row lock, so do not mix versions. Compose applies migrations through 0012. A full rollback requires a matching pre-upgrade backup and application version.

Instructors now have a saved question-paper preview, timed learner simulation and untimed draft testing. Private test sessions support autosave/resume, all seven question types and test grading without changing participant budgets, results or assignment completion. Previews are creator-scoped, limited to 20 retained sessions per exam, and expire after seven days. See [preview operations](OPERATIONS.md#instructor-exam-previews).

Migration `0011_exampreview` adds a separate preview table and its timing/unlock constraints; it does not rewrite existing exam, attempt or learning records. Back up database/media and deploy matching API, web and scheduler images. Compose applies migrations through 0011. Keep the scheduler running for timed-preview finalization and seven-day cleanup. Reload open tabs. Restore a matching pre-upgrade backup and application version for a full rollback.

Exam organizers can now disable question skipping and completed-response review independently. Sequential attempts release question content only after preceding answers are saved, preserve unlocked progress and frozen navigation rules, and require complete answers for manual submission. Timeouts still finalize saved responses. Completed review visibility remains a live exam policy; authorized instructors retain full review access, and participants can refresh results after feedback is released. See [navigation and review operations](OPERATIONS.md#navigation-and-completed-response-review).

Migration `0010_exam_navigation_and_review` adds compatible defaults (`allow_skip=true`, `allow_response_review=true`) and an attempt unlock counter bounded to 1–200. Existing attempts remain freely navigable and historical responses, grades and budgets are preserved. Back up database/media and deploy matching API/web images outside active examinations; Compose applies migrations through 0010. Reload open tabs. Clients must use `question_count` for the total because sequential/hidden responses intentionally contain fewer question objects. Older code does not enforce these policies; use the matching pre-upgrade backup for a full rollback.

Short answers now support per-alternative text matching: the existing normalization default, Yaksh case-insensitive matching with preserved spacing, and case-sensitive matching. Multiline authoring, bank reuse, frozen account/guest grading, instructor review and rule-aware insights share these semantics. Reviewed Yaksh `string` records import with each testcase's explicit mode. See [text answer operations](OPERATIONS.md#text-answer-matching).

Migration `0009_text_answer_matching` adds an empty `answer_matching` list to existing bank and exam questions. Empty or absent rules preserve the previous normalization behavior, including historical attempt snapshots. The migration does not rewrite responses, grades or budgets. Deploy matching API/web images after backing up database/media; Compose applies migrations through 0009 during startup. Reload open tabs. Once strict text rules are configured, rolling back to older application code would change their grading semantics: use the matching pre-upgrade backup for restoration.

Main also supports a configurable waiting period between attempt starts, shared by account and guest access. Fresh start dialogs show the next eligible time in English, Traditional Chinese or Spanish. Reissued links and additional attempt allowances do not bypass the interval; active attempts still resume. [Operations](OPERATIONS.md#waiting-periods-between-exam-attempts) explains the timing and policy-change behavior.

Migration `0008_exam_retry_interval` adds `retry_interval_minutes` with default 0 and a database upper bound of 525600 minutes. Existing exams retain immediate retry behavior, and historical attempts, grades and budgets are not rewritten. Back up before upgrading, deploy matching API/web images outside active exams, and reload open tabs. Compose applies migration 0007 followed by 0008 as needed. If rolling back to code without retry enforcement, restore the matching pre-upgrade backup rather than silently dropping configured waiting periods.

Current main adds integer, numeric-with-tolerance and ordering questions throughout authoring, bank reuse, account/guest attempts, autosave, reviews and analytics. The Yaksh draft importer also accepts reviewed integer, float and arrange records. See [question operations](OPERATIONS.md#integer-numeric-and-ordering-questions) for accepted formats and limits.

Back up database and media, then rebuild matching application/content and web images outside active examinations. Migration `0007_numeric_and_ordering_questions` adds an empty `answer_tolerances` list to existing exam and bank questions and expands the allowed question types. It does not rewrite existing attempt snapshots, answers, grades or attempt budgets. Compose applies it during API startup. Reload open application tabs after upgrading. Rolling back to v1.3 application code after creating new question types is unsupported; retain the pre-upgrade backup for a full restoration if needed.

Main also adds the upstream feature inventory and corrects SCORM integration: authors can publish either SCORM 1.2 or 2004, the course picker shows only manageable destinations, new imports recognize CAM 1.3 as 2004, and launches supply current learner names. Deactivated accounts cannot redeem a previously issued launch ticket. Those SCORM corrections require no additional migration; existing packages and saved learning states remain stored. The v1.3 release tag predates these changes.

## Upgrade from v1.2

Back up database and media, then deploy the matching v1.3 frontend and API outside active examination hours. Migration `0006_invitation_batches` creates batch request records and adds a nullable batch reference to invitations. Existing invitation tokens, attempts and budgets remain valid; existing invitations have no batch reference. Compose applies the migration during API startup. Reload open organizer tabs after upgrading.

The new cohort workflow accepts up to 200 CSV recipients, validates aliases and issues all links atomically. The creator can recover a lost response by retrying the identical request within ten minutes. Only token hashes are stored; link recovery derives tokens using the server secret, so changing `SECRET_KEY` prevents recovery of earlier batch responses. Already issued links still validate against their saved hashes. Keep downloaded link files private and follow [invitation operations](OPERATIONS.md#guest-invitation-cohorts).

Account deactivation now also blocks guest access through every identity linked to that account, including existing guest sessions and active attempts. Saved answers and attempt usage remain intact. Re-enabling an account restores eligible links; revoke a link to disable it independently. Rehearse this behavior, CSV errors, response loss, repeated issuance and link downloads before company rollout. No invitation email is sent automatically.

## Upgrade from v1.1

Back up database and media before upgrading. v1.2 adds migration `0005_attempt_answer_revision`; Compose applies it during API startup. Deploy matching frontend and API images together and schedule the upgrade outside active examinations. Existing attempt answers and budgets are preserved, with the revision initialized to zero. Existing tabs should reload before taking an exam after the upgrade.

This release adds ordered autosave, multi-tab conflict recovery, learner response/feedback review, confirmed SCORM saves on close and improved question-picker keyboard navigation. Dashboard chart code now loads when needed. All new interface strings support English, Traditional Chinese and Spanish.

Review the [sign-in limits and recovery behavior](OPERATIONS.md#shared-office-sign-in-limits). The account limit stays at 20 requests per ten minutes across aliases; the shared direct-peer network allowance defaults to 300 and is configurable with `AUTH_NETWORK_LIMIT`. The new namespaced counter keys begin fresh windows once at upgrade. Rehearse a slow/failed save, two windows on one attempt, a failed SCORM close and a simultaneous group sign-in during Peach1 acceptance. Live Entra and Graph work remains separate from this upgrade.

## Entra sign-in contract

Register a single-tenant **Web** application. Configure the redirect URI as `APP_ORIGIN/api/auth/entra/callback/` and set `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET` on the backend. Apply the company's assignment, MFA and Conditional Access policies in Entra.

The durable key is `User.entra_subject = tenant_id + ':' + object_id`. A new valid OIDC subject creates a learner; email, display name or group name must never grant administration. A disabled platform account remains disabled. Verify an existing local account's ownership before assigning its subject through Django administration; do not silently attach directory accounts by matching email or employee ID.

The platform's `Identity` links account and invitation assessment history. Preserve that identity, historical attempts and budgets during provisioning changes. The normal participant API intentionally keeps username, email and employee ID immutable after creation. For email changes or merges, design an audited operator migration rather than bypassing these protections with bulk updates.

## Graph provisioning contract for Peach1

Use a separate daemon application/credential where practical, so Graph directory permissions are independent of interactive sign-in. Reading users through application permissions requires at least `User.Read.All` with tenant admin consent. Additional features, such as group synchronization, need their own reviewed permissions; this platform does not require directory write permissions. See [Microsoft: list users](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0).

A user import should select only required properties, for example:

```http
GET https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName,employeeId,department,employeeType,accountEnabled,userType
```

| Directory field | Platform mapping | Required behavior |
| --- | --- | --- |
| Tenant ID + `id` | `entra_subject` | Stable unique key; validate the configured tenant |
| `displayName` | `display_name` | Update display values; enforce field length |
| `department` | `department` | Use a documented company department mapping |
| `employeeId` | `employee_id` | Check collisions against all existing login identifiers |
| `mail` / approved UPN | `email` at provisioning | Use a verified deliverable address; UPN is not always a mailbox |
| `employeeType` | `employment` | Explicit company mapping to `employee` or `contractor` |
| `userType` | Directory metadata | `Guest` is a directory classification, not an employment classification |
| `accountEnabled` | `is_active` | Deactivation preserves attempts, enrollments and audit history |
| Groups / app roles | Separate authorization mapping | Default to learner; never infer platform administration from a display name |

This is the intended adapter contract, not an active synchronization service. Build a dry-run plan before applying changes, show collisions and ambiguous links, and record audit events without tokens or unnecessary personal data. Treat local recovery/operator accounts as separately managed. Preserve deliberate local deactivation instead of blindly re-enabling accounts on each sync.

For full synchronization, follow every opaque `@odata.nextLink`. Never deactivate users merely because they are absent from a partial or failed page. For incremental synchronization, store the completed `@odata.deltaLink`, process changed/deleted objects, and checkpoint only after the batch commits. Keep query selection consistent, handle retries/backoff and token expiry, and surface failures to an operator. See [Microsoft: users delta query](https://learn.microsoft.com/en-us/graph/delta-query-users) and the [user resource](https://learn.microsoft.com/en-us/graph/api/resources/user?view=graph-rest-1.0).

Before enabling scheduled sync, test: create, duplicate email/employee ID, explicit link to a local account, renamed user, department move, contractor mapping, disable/delete, pagination failure, rate limiting, duplicate delivery and operator recovery. Role changes and identity linking need audit records. Do not delete historical training records when someone leaves.

## Backup and transfer

Use [the backup tool](../scripts/backup.py) with a trusted backup directory outside Git:

```bash
# Consistent backup: briefly stops API/web/content/scheduler, then restarts them.
python3 scripts/backup.py create /secure/backups/training-2026-11-06
python3 scripts/backup.py verify /secure/backups/training-2026-11-06

# On Peach1: choose a NEW project name with no existing containers or volumes.
python3 scripts/backup.py restore /secure/backups/training-2026-11-06 --project peach1-training
```

The tool checks SHA-256 digests and media paths. It restores PostgreSQL and course/source files into an isolated Compose project, applies migrations and runs Django checks. It refuses to overwrite an existing destination. API, web, content and scheduler stay stopped after restore; inspect the restored records and media before starting them. PostgreSQL dumps contain executable SQL: use only trusted operator backups.

Supply `.env`/secret-manager values separately. The backup does not include secrets, TLS certificates, reverse-proxy settings or external directory configuration. Transfer these through company-approved channels. Protect and encrypt backups because they contain participant records, grading data, password hashes and course material. Keep the original `SECRET_KEY` only if session continuity is intended; rotating it invalidates existing signed sessions/tickets.

After reviewing the restored project:

```bash
docker compose --project-name peach1-training run --rm --no-deps api python manage.py check_deployment --strict
# Ensure ports 8080/8081 are available before starting this project.
docker compose --project-name peach1-training up -d --wait
```

## Acceptance on Peach1

| Workflow | Pass condition |
| --- | --- |
| Three languages | English on first visit; all three selections persist; unsaved editor/exam input survives switching |
| Access | Employee, contractor, local email and employee ID can use their intended sign-in methods |
| Entra | Correct tenant/MFA/assignment policy works; wrong tenant, disabled user and unapproved link are rejected |
| Graph | Dry-run reconciliation matches expectations; repeat sync is idempotent; failed pagination never deactivates unrelated people |
| Required training | Assignment appears only for intended people; course completion or passing grade updates the report; CSV matches records |
| Authoring / SCORM | Create, publish, launch, commit, close/reopen and download editable source using representative company packages |
| Exams | Independent and linked exams, random snapshots, attempt caps, autosave, expiry and manual review work under expected concurrency |
| Exam monitoring | Owner scope holds for account/guest attempts; lost-response retries grant time once; visible and suspended tabs recover the authoritative timer; late answers stay rejected; expired/submitted papers stay closed |
| Assessment reporting | Filtered totals and CSV agree across pages; only fully graded attempts contribute to question statistics; ownership restrictions apply to reports and exports |
| Guests | Named recipient verifies email; link expiry/revocation works; reissued links cannot reset the shared identity budget |
| Invitation cohorts | CSV aliases resolve correctly; one invalid row creates no links; a lost response recovers the same links; pagination/filter counts agree; disabled accounts lose existing guest access |
| Recovery | Restore a current database/media backup in isolation, compare record counts and launch restored content |
| Operations | Monitor DB/storage, TLS, SMTP, scheduler, backup age and application errors; define retention and support ownership |

SCORM support is the documented single-SCO 1.2/2004 subset, not full SCORM 2004 sequencing certification. Required training uses current completion evidence; recurring recertification cycles and certificate issuance are not part of this release. The audit log is application history, not an immutable external compliance archive. Validate company acceptance criteria before declaring an organizational rollout complete.
