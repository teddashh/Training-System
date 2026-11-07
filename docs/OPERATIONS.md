# Training operations

## Assign required training

Open **Assigned training → Assign training**. Choose one published course or assessment, select people, departments, employees, contractors or all active accounts, and optionally set a due date and instructions. Each batch accepts 1–500 people. Instructors can assign only content they own; administrators can manage all assignments.

An explicit exam assignment grants account access even when the general exam audience excludes that person. Publication, exam opening/closing times and identity attempt budgets still apply. Cancelling an assignment removes that access grant and the requirement from the learner worklist. Other audience/invitation grants and existing attempt access remain intact.

Assigning the same target again updates its deadline and instructions and reactivates a cancelled requirement. It preserves the original assignment date, previous learning and attempt usage. Existing course completion or a passed graded exam fulfills the requirement. This release tracks one requirement per person/target; it does not model recurring certification periods.

Use **My worklist** to open a course or start/resume an assessment. Starting a new attempt starts the timer and consumes one attempt. Instructors/admins use **Completion report** for people, departments, progress, best graded score, due date and completion date. Overdue means incomplete past the due date; the deadline is advisory and does not itself block learning. Pending manual review can remain overdue. The expiry worker updates timed-out exams every minute.

CSV exports include all assignments within the manager's ownership scope, including cancelled requirements. Exports are UTF-8 with BOM and protect cells beginning with spreadsheet formula characters. The on-screen search/status filter does not narrow the exported report.

## Question bank and exam variation

Create single-choice, multiple-choice, short-answer or written-response questions in **Question bank**. Set the category, points and accepted answers. Instructors see their own bank; administrators see all. Archive a question to remove it from future selection without affecting existing exams.

In the exam editor, **Add from question bank** copies selected questions into the exam. Changes to the source bank never mutate those copies. The editor can shuffle question order, shuffle choice options, or select a random number of questions per attempt. Leave the count empty to use all questions. Ensure every random combination has an appropriate difficulty and point distribution for the assessment.

Question sampling and option permutation occur once at attempt creation. The frozen snapshot includes remapped correct answers, weights and the pass threshold. Resuming keeps the same questions and ordering. Later bank/exam edits cannot change an active or completed attempt's grading.

## Assessment results and insights

**Results & reviews** searches all accessible attempt history and paginates it on the server. Filter by assessment, grading status, passed/not passed, rolling reporting period or a search across people, exams and current departments. Summary counts and average scores cover all matching records. **Export results CSV** uses the same filters and includes every matching page. Administrators can report on all attempts; instructors on their own exams; learners on their own identity's attempts.

**Assessment insights** is available to administrators and instructors. Choose an assessment and reporting period to see graded attempts, unique participants, average score, attempt pass rate, score distribution and department performance. Participants include identities with active or pending attempts; score and question statistics include only fully graded attempts. Repeated attempts count separately. Department attribution uses the account's current department, not its historical department at exam time.

Question analysis shows response count, answer rate, full-credit rate and average points, sorted by the lowest full-credit rate. Each saved question version is analyzed separately from its frozen attempt snapshot. Shuffled choice ordering is normalized; sampled questions count only when presented. Written responses contribute after all manual grading is complete. Saving exam questions creates new versions even when some wording is unchanged. **Export question analysis** exports all analyzed question versions for the selected assessment and period; the question-table search only narrows the on-screen table. Aggregate exports contain neither answer keys nor participant responses.

Reporting periods use submission time, falling back to start time for active attempts. Opening reports finalizes expired attempts within the selected scope before applying status and date filters. These synchronous reports have no fixed history truncation in the UI, but large installations should validate response time with their expected attempt volume.

Exam confirmation and assigned-assessment confirmation show the participant's effective individual budget, including overrides, used/remaining attempts, and opening/closing times. An active attempt can resume when no new attempts remain. Resuming does not consume another attempt; the API still checks current availability and access.

### Reporting API compatibility

`GET /api/results/?page=1&page_size=25` returns `{results,count,page,pages,page_size,summary}`. Page size is limited to 100. An excessive page number resolves to the last page. Omitting `page` preserves the v1.0 array response capped at 1,000 records; new clients should always request pagination.

The results endpoint and `/api/results/export/` share optional `exam`, `search`, `department`, `status`, `outcome` and `days` parameters. Status values are `in_progress`, `pending_review` and `graded`; outcomes are `passed` and `not_passed`; periods are `all`, `7`, `30`, `90` and `365`. Empty status/outcome means all. Export ignores pagination when selecting rows. Existing result CSV columns are preserved, with `Department` appended.

`GET /api/exams/{id}/insights/?days=90` returns exam metadata, summary, distribution, departments and question analysis. Add `export=csv` for the question analysis file. This endpoint enforces current administrator/owner-instructor authority. Both CSV exports use localized headers, UTF-8 with BOM, and spreadsheet formula escaping.

## Answer saving and learner feedback

The assessment player sends one save at a time. Edits made during a slow save remain local until the next save; submission waits for the pending save and then sends the latest answers. Connection failures retain the current tab's draft and retry with backoff. **Retry saving** requests an immediate retry. Unsaved answers are held in memory, so keep the tab open during a connection failure. Closing or reloading the browser can discard them.

Every saved attempt has an `answer_revision`. Another tab's newer save causes a conflict instead of overwriting answers. Copy any local text you need before selecting **Reload saved answers**, which replaces that tab's draft with the server copy. The timer continues during failures and conflicts. At the deadline the server grades the last answers it received before expiry; offline edits cannot extend the deadline.

`GET /api/attempts/{id}/` returns the revision. New clients must include that integer with each `PATCH` save and `POST` submission. A stale revision receives HTTP 409 with `code: answer_conflict`. Omitting the revision remains supported for legacy clients, whose writes still advance the revision; those clients do not get conflict protection. Repeating a completed submission returns the existing result without changing answers. The endpoint never includes solution keys.

After submission, learners and invited recipients can review their own responses. Instructor marks and written feedback appear once recorded; the final score waits for all manual grading. Refresh the result after the instructor reviews it. Feedback is visible to the participant, so instructors should avoid copying confidential answer keys into it.

## Closing SCORM lessons

**Save and close**, the close button and Escape all request the runtime's latest buffered values and wait for the API to acknowledge persistence. If saving fails, the player stays open for another attempt. **Close without saving** becomes available after a failed close; choosing it can lose recent progress. Use the player controls before leaving the page. Browser shutdown, a crash or a lost connection cannot guarantee a final save. Reopening a lesson restores the last confirmed state.

## Shared-office sign-in limits

Password login and email-code requests/verification share a persistent limit of 20 requests per account per ten-minute window. Username, email and employee ID aliases share the same counter. Guest verification uses an invitation counter. A separate network counter defaults to 300 requests per ten minutes; `AUTH_NETWORK_LIMIT` configures that network allowance. HTTP 429 includes `Retry-After` in seconds. A failed earlier email delivery does not invalidate a newer code; SMTP operations time out after ten seconds.

The API uses the direct connection's address, ignoring client-supplied forwarding headers. In the bundled deployment, the Nginx peer is shared by participants, so the network counter is a deployment-wide budget. Size it for scheduled training groups and enforce actual client-IP limits at the trusted outer proxy. General API throttles allow 600 requests per minute for an authenticated user or anonymous direct peer. These are traffic controls, not a concurrency capacity guarantee; validate company usage on Peach1.

## Guest invitation cohorts

Open **Guest exam invitations → Create invitation batch**. Select a published assessment, set the per-link attempt limit (1–100) and validity (1–90 days), then paste or upload UTF-8 CSV. Each batch accepts 1–200 recipients and at most 256 KB. Required header: `key`; optional header: `verification_email`. Header names must be unique and exact. Quote values containing commas or newlines.

```csv
key,verification_email
employee-1042,
partner.sofia@example.com,
contractor-027,contractor027@example.com
```

Keys resolve by email, username or employee ID to the same participant identity used by account sign-in. Unknown keys create guest identities, without creating login accounts. Duplicate recipients within a batch are rejected even when different aliases are used. Disabled linked accounts are rejected. **Validate recipients** shows each identity, verification mailbox, remaining new attempts and row errors without persisting identities or links. Issuance revalidates everything and commits all recipients or none. Administrators can issue for any exam; instructors only for their own.

Email verification is enabled by default. Leave `verification_email` empty to use the account's email or the guest's email key. For an account-only key without a mailbox, supply the intended recipient's email. Disabling verification allows anyone holding the link to use its bound identity. The platform does not email the invitation automatically; distribute each personal link through an approved channel. Verification codes are sent only when a recipient requests them.

**Download invitation links CSV** exports the issued links, expiry, per-link limit, remaining attempts and verification settings. The file uses stable English column names, UTF-8 with BOM and spreadsheet formula escaping. Treat it as a credential file. Full links are held in this dialog's memory; history shows metadata. Download before closing. The dialog warns before discarding un-downloaded links. Browser failure or reload loses the in-memory request and links.

If the creation response is lost, keep the dialog open and use **Retry batch request** within ten minutes. The browser reuses the original request UUID and exact payload. The authenticated creator receives the same links without issuing duplicates. Another creator, changed payload, expired recovery window or changed server secret cannot recover that response. Check invitation history before creating another batch after an uncertain result. Reissuing links does not reset the shared participant/exam attempt budget. A participant with no new attempts may still resume an eligible active attempt.

History supports participant/exam search, exam/status filters and pagination. Search includes account email, username, employee ID and display name. **Disable** asks for confirmation and immediately rejects later guest requests, including saves/submission from an active attempt. Account deactivation likewise blocks linked guest identities. Saved answers and used attempts remain recorded.

| Status | Meaning |
| --- | --- |
| Active | Link is unrevoked, unexpired and has a new attempt available |
| Resume only | No new attempts remain, but a timed active attempt exists |
| No attempts remaining | Neither a new attempt nor a timed active attempt is available |
| Disabled | An organizer revoked the link |
| Expired | The link's expiry time has passed |
| Account disabled | The linked platform account is inactive |

These statuses describe link and budget state. Assessment publication, opening/closing dates and verification still apply when accessing the exam. Remaining counts are current snapshots, not reserved attempts; starting an attempt enforces the budget transactionally.

### Invitation API compatibility

`GET /api/invitations/?page=1&page_size=25` returns `{results,count,page,pages}`. Page size is capped at 100; excessive page numbers resolve to the last page. Optional filters are `search`, `exam` and `status` (`active`, `resume_only`, `exhausted`, `revoked`, `expired`, `blocked`). Omitting `page` preserves the array response, capped at 1,000 records. History never returns full tokens or access URLs.

`POST /api/invitations/bulk/` takes `exam`, `csv`, `max_attempts` (default 1), `days` (default 7), `require_email_verification` (default true), and `apply` (default false). Set `apply: true` and a client-generated UUID `request_id` to issue. A preview or row-validation failure returns `{valid,applied:false,count,rows}`; invalid rows never create a partial batch. Success returns HTTP 201 with `{valid:true,applied:true,replayed:false,count,invitations}`, including personal URLs. Exact retries within ten minutes return HTTP 200 with `replayed:true`. Conflicting/expired request IDs return HTTP 409. Responses containing links have `Cache-Control: no-store`.

The existing `/api/invitations/issue/` endpoint remains available for single recipients and retains its API default of verification disabled; both organizer forms explicitly enable verification by default. Batch and single-link creation audit metadata excludes access tokens. Successful retries do not add issuance audit events.

## Bulk onboarding

**People & permissions → Import participants** accepts UTF-8 CSV up to 1 MB and 500 rows. Required header: `username`. Optional headers: `email,employee_id,display_name,department,employment`. Use `employee` or `contractor` for employment; an empty value defaults to employee. Quote commas/newlines according to CSV rules.

```csv
username,email,employee_id,display_name,department,employment
alex.chen,alex.chen@example.com,E1042,Alex Chen,Operations,employee
partner.sofia,sofia@example.com,,Sofia Garcia,Quality,contractor
```

Preview validates every row against existing accounts and other rows in the batch. Import revalidates and either creates all accounts or none. Imported accounts are learners with unusable local passwords; the import never overwrites existing accounts or accepts roles, passwords or Entra subjects. Email codes can be used once SMTP is configured. For accounts with only an employee ID/username, use **Edit person** to set a password.

Administrators can edit display name, department, employment, role and password, and enable/disable accounts. Login identifiers are immutable through this API to preserve historical identity ownership. Administrators cannot remove their own admin role or disable themselves. Platform permissions are separate from Django superuser/operator privileges.

The profile menu offers **Change password**, requiring the current local password and a new password of at least 12 characters. It preserves the current browser session and invalidates other local authenticated sessions. Microsoft passwords are managed by the company identity service.

## Operator checks and recovery

**Settings & audit → Deployment readiness** shows local prerequisites without exposing credentials or calling a tenant API. Run `python manage.py check_deployment --strict` inside the API container for the same checks and a failing exit status when work is needed. Add `--require-entra` to require the three Entra settings. Configured settings are not evidence of successful tenant or email connectivity.

See [Peach1 handover](PEACH1-HANDOVER.md) for installation, Microsoft Graph contract, backup/restore commands and organizational acceptance tests. Backups require a maintenance window because the tool stops application writers while copying PostgreSQL and media. The application services that were running are restarted even if the backup fails; a failed/incomplete backup has no valid manifest and must not be used.
