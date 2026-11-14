# Run training and administer the workspace

Use [Getting started](GETTING-STARTED.md) for the first setup. Sidebar areas and tabs depend on your role. Routes below are relative to `APP_BASE_PATH`.

## Configure the organization

Open **Settings → Settings** (`/settings`). Choose **Change** next to Organization, Sign-in or Email.

Organization accepts a name up to 80 characters and a PNG, JPEG or WebP logo up to 2 MiB and 2048 pixels per side. The server re-encodes the image as PNG. Clearing the name or removing the logo restores the pack default.

Choose at least one interface language: English, Traditional Chinese or Spanish. Sign-in offers **None**, **Microsoft Entra ID** or **Google Workspace**. None keeps local password accounts; e-mail codes also need working e-mail. E-mail offers **Off**, **SMTP server** or **Microsoft 365 mailbox**.

Save before choosing **Send test email to me**. The test uses your own account address. Server-controlled sections show **Set by the server**. Ask the deployment operator to change those values. See [provider setup and environment rules](DEPLOYMENT.md#configure-environment-variables).

## Choose roles

Only **Super administrator** manages system settings, people, groups, directory sync, mail and audit/readiness. Django data maintenance also requires `is_staff` and Django model permissions. A platform role does not grant those flags.

| Role | Courses | Exams and results | Other rights |
| --- | --- | --- | --- |
| Super administrator (`admin`) | All | All | Assign, invite, administer |
| Training administrator (`training_admin`) | All | All | Assign and invite |
| Course creator (`course_creator`) | Own | None | Assign owned courses |
| Exam administrator (`exam_admin`) | None | All | Assign exams and invite |
| Training scheduler (`training_scheduler`) | Own | Own exams, no scores/results | Schedule and see linked quiz pass status |
| Instructor (`instructor`, legacy) | Own | Own | Assign and invite for owned items |
| Learner (`learner`) | Personal access | Personal access | Take assigned or available training |

SCORM upload and editable-source access remain limited to super administrators and legacy instructors managing their own courses. Trusted same-origin mode permits uploads only by super administrators. Other course authors can use native lessons and document text imports. See [the role policy](../backend/training/access.py).

## Bulk onboarding

Open **People → Import participants**. Upload or paste UTF-8 CSV, up to 1 MB and 500 rows. Required header: `username`. Optional headers: `email,employee_id,display_name,department,employment`.

```csv
username,email,employee_id,display_name,department,employment
alex.rivera,alex@example.com,E1042,Alex Rivera,Operations,employee
morgan.lee,morgan@example.com,C102,Morgan Lee,Quality,contractor
```

Preview, correct errors, then import. Import creates the whole batch or none. It never overwrites people or accepts roles, passwords or directory subjects. New accounts are learners with unusable passwords. They can use e-mail codes after mail is configured. Use **Edit person** to set a local password if needed.

**Edit person** also changes display name, department, employment, role and active status. Login identifiers are not editable through this API. You cannot disable yourself or remove your own administrator role. Disabling an account also blocks linked guest access and preserves learning records.

The account menu's **Change password** requires the current local password. New passwords must meet Django validation, including at least 12 characters. It preserves the current session and invalidates other local sessions. Provider passwords remain managed by the identity provider. When the server sets `PASSWORD_SIGN_IN=false`, password sign-in, **Change password** and the password fields for people are absent: people use company sign-in or an e-mail code.

## Create and publish a course

Open **Training → Trainings → More → Create course**. Choose interactive content to open **Training Content Studio**, a text lesson, or **PDF / PowerPoint** text import. An administrator can also use the course menu's **Upload SCORM** for a ZIP package.

Document import accepts PDF/PPTX text, not slide layouts, images, animation or OCR. Limits are 20 MB, 50 pages, 20,000 characters per page and 500,000 overall. Review the extracted text before creating lessons. Import does not publish the course.

In Studio, use **Publish to course** to upload content and its editable backup. Use **Make available to learners** afterward, or **Publish course** in Training, to release the course. Uploading replacement content preserves its current visibility. **Download backup** keeps an editable copy; browser drafts alone do not move between devices.

Open a scheduled training by its title, then choose **Course settings** for category, duration, cover, enrollment approval and release time. Self-paced courses keep their settings dialog. Learners see published courses whose release time has arrived. The [starter library](course-library-sources.md) provides optional draft content.

## Schedule sessions and mark attendance

For an on-site event, choose **Training → New training**. Enter a title and one to ten future sessions with date, start, end and place. Add seats and people as needed. **Create and notify** appears when people are listed. Creation publishes the course and creates its registration link.

Paste e-mail addresses or employee IDs, use **Pick people**, or upload CSV/XLSX. **Download template** provides Email, Employee ID and Name columns. Each row uses Email when present, otherwise Employee ID; Name never identifies a person. Limits are 1 MiB per file, 2,000 input lines and 500 unique people per request. Resolve skipped lines before creating the event.

The training page has **Overview** and **People**. Overview contains the registration link, sessions, quiz state and **E-mail reminders**. People supports adding, moving, approving and removing participants. **Add people** adds participants directly; organizers with assignment rights also see **Assign training** for published trainings. A confirmed or pending registration reserves a seat. Learners can switch before their current session starts, subject to the destination window and capacity.

For online sessions, select **Scheduled online sessions** in **Course settings** and save. Open the training page and choose **Add session** on Overview. Scheduled drafts can have sessions too. On-site courses require a place; scheduled sessions can have an HTTPS meeting link. Only managers and the learner's approved session expose that link.

From a session, choose **Attendance** after it starts. Mark **Present** or **Absent**; press the selected choice again to clear it. **Mark all present** marks the approved roster. Canceled sessions cannot be marked. Under **Sign-in sheet**, choose **PDF** for printing or **Excel** for the same roster as a spreadsheet. Attendance results are available from session start.

On-site presence completes the course. Marking absent or clearing presence removes that completion. Online content access within the learner's session provides automatic attendance evidence; manual marks override it. Online attendance does not itself complete the content. Moving sessions clears the old attendance evidence.

Add scheduled-course **Materials** as HTTPS links or PDF, PPTX, PPT, DOCX or XLSX files, up to 100 MiB. Approved learners can access them before or after the session. File validation is not malware scanning. Back up material files with media.

## Course enrollment approval

Enable approval in **Course settings**. Learners request access, then see the decision. Open the training's **People** tab to approve, reject, remove or restore enrollment. A self-paced row's **People** opens its enrollment dialog after publication. Pending approval reserves a scheduled seat.

Removal blocks learning and SCORM files while preserving progress and completion history. Publication, release time and session timing still apply. Assignment does not bypass admission rules. Migration `0015_course_enrollment_approval` defaults old courses to open enrollment and old enrollments to approved.

## Shareable course registration links

Use **Copy link** on the training page's Overview tab. **Open page** opens the same registration page in a new tab. The public page shows course/session facts and registration availability, not the participant roster. The recipient signs in to register. The link does not bypass capacity, approval or account checks.

Choose **Create new link** from the registration section's menu and confirm to replace the link. The old link stops working immediately. For self-paced courses, registration links remain under **Course settings → More options**. Numeric course links remain separate. See the [registration API](SIMPLE-TRAINING-API.md#request-and-response-contracts).

## Create an exam

Open **Exams → Exams → New exam**. Set the title, questions, duration, passing score and audience. More options include timing, attempt rules and navigation/review policy. Save the draft, preview it, then publish it explicitly.

The seven types are single choice, multiple choice, short answer, essay, integer, numeric and ordering. Essays require manual review. Multiple choice is all-or-nothing unless a manager imports a manual score. There are no file-upload answers or proctoring controls.

Use **Question bank** for reusable questions. Select a random subset or shuffle questions/options in an exam. Attempts freeze their question paper, so later edits do not rewrite existing attempts.

## Shared course assessments (0025)

Use **Course assessment** in course settings or **Linked courses** in the exam editor to attach an exam. One exam can serve several courses. Linking does not grant permission to edit the other item. Exam publication stays separate.

Approved learners in a released course can take its published linked exam, except invitation-only exams still require an invitation or assignment. Course-only audience restricts access to course-derived admission. Other audience grants and existing attempts remain independent.

Choose **After the session** for a scheduled course to gate that course-derived access until the person's session ends. A person marked absent has no after-session grant through that enrollment. Unmarked participants retain access. A published exam with a broader audience can still admit someone through that other audience.

## Assign required training

Open **Training → Assignments → Assign training**. Choose a published course or exam, then people, departments, employment types or training groups. Add a due date and instructions under assignment options. Review the selected people before submitting.

The assignment is a snapshot, not a live directory rule. Learners see it in **My training** or **My exams**. Uncheck **Email the people I assign** to suppress assignment mail. Completion and overdue counts appear in the assignment report and CSV export.

Cancelling an assignment removes the requirement without deleting learning evidence. Reactivating it can enqueue a new notification. Changing group membership later does not rewrite existing assignments.

## Question bank and exam variation

Use **Exams → Question bank** to add and reuse questions. Copies are independent; exam edits do not change the bank.

## Text answer matching

Short answers accept several alternatives. Choose a rule for each:

| Rule | Comparison |
| --- | --- |
| Ignore case and extra spaces | Unicode case folding, trimmed edges and collapsed whitespace |
| Ignore case; preserve spacing | Yaksh `lower`, lowercase comparison with spaces and blank lines preserved |
| Match case and spacing | Yaksh `exact`, case and spacing preserved |

Yaksh modes treat CRLF and LF alike and ignore one final line break. An extra blank line matters. Empty answers earn zero. There is no regular-expression or substring matching. Explain required formatting in the question.

Attempts freeze alternatives and rules. Editing a question does not regrade earlier papers. API `answer_matching` aligns one rule per `solution` entry; omitted rules default to `normalized`. Yaksh imports require explicit `lower` or `exact` for every string testcase.

## Integer, numeric and ordering questions

**Integer answer** accepts 1-20 alternative whole numbers. Signs and surrounding spaces are allowed; decimal points and scientific notation are not. Values stay as strings to preserve large integers.

**Numeric answer** accepts 1-20 alternative values with individual nonnegative absolute tolerances. For example, 12.5 ± 0.05 accepts 12.45 through 12.55. Use a decimal point or scientific notation, not commas or expressions. Values use decimal arithmetic with at most 100 coefficient digits, normalized exponent -100 through 100 and 128 input characters.

**Ordering** accepts 2-20 distinct items entered in the correct order. Attempts shuffle them independently of choice-option settings. Learners reorder them or choose **Use this order**. Resume preserves the saved order.

All three auto-grade. A complete match earns full credit; incomplete or invalid submissions earn zero. API numeric solutions and tolerances are strings. Ordering answers use zero-based option indexes.

## Live exam monitoring and extra time

Open an exam's **Monitor** from **Exams → Exams**. Monitoring, grading and answer inspection require result access for that exam. Training schedulers do not have that access. The monitor excludes private previews and refreshes every five seconds while visible.

Filter by participant, attempt number and status. Progress means saved answers, not correctness. **Recent contact** means a start, heartbeat or accepted write arrived within 60 seconds. The player sends a heartbeat every 15 seconds while visible. Contact is not evidence of attention, attendance or cheating.

Choose **Time extensions** and **Grant extra time** for an active, unexpired attempt. Enter 1-240 whole minutes and a reason. Combined extensions and reopenings are limited to 1,440 extra minutes. History records the actor and deadline change.

If the response is lost, use **Retry extension request** in the same tab. It reuses the stored request and does not add time twice. A new request ID means a separate grant.

**Inspect saved answers** is read-only. It shows the frozen paper and server-saved answers, not unsaved typing. **Review submission** opens grading after submission.

**Reopen & history → Reopen submission** reopens only the latest submitted attempt for that identity/exam, with no other active attempt. Enter 1-240 minutes and a reason. The exam, linked account and original invitation must remain eligible.

Reopening keeps the attempt number, questions, saved answers and quota usage. It preserves the previous submission as read-only evidence, then clears the current result until resubmission and grading. Essays need fresh grading. Other passing attempts can still satisfy a requirement.

Use **Retry reopening request** after a lost response. Reload stale learner/review tabs. Reopening does not send mail. Extra time can extend an active attempt beyond the exam's closing window, but it does not extend guest-link validity or permit new starts after closing.

## Instructor exam previews

Use an exam's preview actions to inspect its paper, run a timed learner simulation or test a draft without a timer. Preview sessions belong to their creator and do not consume participant attempts, affect reports or complete assignments.

Previews support saving, resume and test grading. Each creator can retain at most 20 preview sessions per exam; they expire after seven days. Use a real synthetic participant in a test deployment to verify actual admission and reporting.

## Navigation and completed-response review

Exam settings can require sequential answers and control completed-response review. In sequential mode, the server releases later questions after earlier answers are saved. Manual submission requires answers; time expiry still finalizes the last saved state.

Navigation rules are frozen for each attempt. Completed-response visibility is a live exam policy, so an organizer can release review later without changing grades. Result-authorized managers retain review access.

## Waiting periods between exam attempts

A retry interval sets the minimum time between starts for the same identity/exam. Account access and every invitation share it. Extra attempt allowance or a new link does not bypass the wait. An eligible active attempt can resume.

Failed rounds can renew after all attempts in the round are graded and failed, followed by the configured wait. Pending manual grading delays renewal. The interface shows the next permitted time and remaining wait; the server checks again on start.

## Assessment results and insights

Open **Reports → Results** to filter by exam, participant, department, status, outcome or period. Export uses the same filters. **Reports → Insights** shows score distribution, departments and question analysis from frozen attempt snapshots.

Use **Review submission** for essay scores and participant-visible feedback. A final grade waits until all essays are reviewed. Feedback follows the exam's completed-response visibility rule.

### Marks CSV imports

Open an exam's **Monitor → Import marks**. This requires result access for that exam. **Download marks template** follows the monitor filters and includes submitted account/guest papers, excluding previews and active attempts.

Keep `attempt_id`, `question_id`, `answer_revision` and `grading_revision` unchanged. These identify the exact frozen question and revisions. Required headers also include `points` and `feedback`. Reference columns do not change identity or score limits.

Edit `points` to a finite value from zero to the question maximum, with at most six decimal places. Blank retains the current grade. All seven question types can receive explicit manual scores. `feedback` allows up to 5,000 characters; blank retains it. To remove feedback, use `clear_feedback=true` with blank feedback.

Limits are 256 KiB, 500 question rows and 100 attempts per file. Duplicate/unknown headers, changed revisions, invalid scores or wrong question IDs reject the preview. Use normal CSV quoting for commas and line breaks.

Enter a reason, choose **Preview mark changes**, review the proposed outcomes, then **Apply reviewed marks**. A preview expires after 30 minutes. Only its creator can apply it while still authorized. Any stale paper rejects the whole batch. Answers, submission times and quotas stay unchanged.

After a lost response, use **Retry saved import** or **Refresh import status**. The same import ID returns its original receipt without grading twice. Applied receipts are retained. There is no automatic undo; create a new reviewed correction.

Each manager can hold 20 unexpired pending previews per exam. The scheduler removes unapplied previews seven days after expiry. Imports do not send notification mail. A changed pass result can change assignment completion; another passing attempt can still satisfy it.

### Reporting API compatibility

`GET /api/results/?page=1&page_size=25` returns `{results,count,page,pages,page_size,summary}`. Maximum page size is 100. Omitting `page` keeps the legacy array response, capped at 1,000 records. New clients should use pagination.

Results and CSV export share `exam`, `search`, `department`, `status`, `outcome` and `days`. Supported periods are `all`, `7`, `30`, `90` and `365`. Insights use `GET /api/exams/{id}/insights/?days=90`; add `export=csv` for question analysis.

Review writes should send both answer and grading revisions. After the first grading revision, omitting it returns a conflict. Reload the paper before retrying a stale review.

## Answer saving and learner feedback

The player sends one answer save at a time. Submission waits for pending saves and includes the latest answers. Connection failures keep the tab's draft in memory and retry. **Retry saving** requests another attempt. Closing or reloading can lose unsaved edits.

Another tab's newer revision causes a conflict. Copy any local text before **Reload saved answers** replaces the draft. The timer continues through network failures. At expiry, only the server's last accepted answers count.

Use the current `answer_revision` with API saves and submissions. Stale writes return HTTP 409 with `answer_conflict`. Repeating a completed submission returns the existing result. Legacy writes without a revision remain accepted but lack conflict protection.

Learners can review responses and recorded feedback when the exam permits completed-response review. Avoid placing confidential answer keys in participant-visible feedback.

## Closing SCORM lessons

Use **Save and close**. The player waits for server acknowledgment before closing. If persistence fails, it stays open for another try. **Close without saving** becomes available after failure and can lose recent progress.

A browser crash or shutdown cannot guarantee a final save. Reopening restores the last confirmed state. Progress comes from package completion/progress evidence, not from an exam score.

## Read reports

Open **Reports → Overview** for training totals and trends. **Results** filters attempts and exports the same selection to CSV. **Insights** shows exam score distributions, departments and question analysis. Managers see only records allowed by their result scope. Training schedulers see linked quiz pass status in the training page, without scores or answer details.

Use the assignment report for required-training completion and overdue status. Learners see their own results under **My training → Results**. A pending essay keeps the final result awaiting review.

## Guest invitation cohorts

Open **Exams → Guest invitations → Create invitation batch**. Choose a published exam and paste/upload UTF-8 CSV with required `key` and optional `verification_email` headers. A batch accepts 1-200 recipients and up to 256 KB. Set a per-link limit of 1-100 attempts and validity of 1-90 days.

```csv
key,verification_email
E1042,alex@example.com
morgan@example.com,
```

Choose **Validate recipients**, then issue the batch. Aliases resolve to the same retained identity; duplicate or invalid recipients reject the batch. Unknown keys create guest identities, not login accounts. Account and guest attempts share the identity's exam budget; the link also has its own cap.

Recipient e-mail verification is on by default in the organizer forms. Without it, anyone holding the link can use the named identity. Verification requires working e-mail. The system does not automatically send invitation links; distribute them through your approved channel.

**Download invitation links CSV** before closing. Full links live in the dialog's memory; history retains metadata. If the response is lost, **Retry batch request** can recover the same request within ten minutes. Keep the dialog open. Reissuing links never resets attempt budgets.

History supports search, filters and pagination. **Disable** rejects later guest requests, including saves from an active attempt. It retains answers and used attempts. Treat downloaded links as credentials.

## Shared-office sign-in limits

Password login and code requests/verification share 20 requests per account per ten minutes. Username, e-mail and employee ID aliases share the counter. Guest verification uses an invitation counter. The separate direct-peer limit defaults to 300 per ten minutes, controlled by `AUTH_NETWORK_LIMIT`. HTTP 429 includes `Retry-After`.

The bundled Nginx peer is shared by users, so that limit is a deployment-wide allowance. Enforce real client-IP limits at the trusted outer proxy. General API throttles allow 600 requests per minute per authenticated user or anonymous direct peer. These are traffic controls, not a capacity promise.

Sign-in codes have six digits, expire after ten minutes, allow at most five incorrect entries and are consumed on success. Unknown addresses receive the same response. Mail failures do not prove whether an account exists.

## Directory provisioning operators

Configure [the directory app](DEPLOYMENT.md#microsoft-entra-directory-provisioning), then open **People → Sync from Microsoft Entra**. Preview counts and samples before applying. Apply fetches a new complete listing. CLI dry-run and apply are also available:

```bash
DEBUG=true .venv/bin/python backend/manage.py sync_directory --help
```

In a deployment, run `python manage.py sync_directory` inside the API container for a dry run. Add `--apply` to write. `--from-file` accepts a complete Graph-shaped JSON listing with no next-page link. Never use a partial export: absence can mean a leaver.

Eligibility requires Member, enabled status, a usable mail address or UPN, a license by default, and an allowed domain when configured. New people are learners with unusable passwords. Existing roles/employment remain. Nonempty directory fields can update linked profiles; blank values do not erase local values.

Identifier collisions are reported, not merged. Directory subjects link identities; matching e-mail alone does not. Keep retained identities and learning evidence while resolving conflicts.

Only explicit disablement or absence from a complete listing deactivates a linked account. Local, other-tenant, admin, staff and superuser accounts are protected. A local enable/disable clears directory ownership so sync cannot undo a local suspension.

If deactivation candidates exceed `max(20, 10% of active linked accounts)`, no deactivations apply. Other safe changes can proceed. The CLI-only `--allow-mass-deactivation` override needs a reviewed complete source. Failed scheduled runs wait at least an hour; manual preview remains available.

### Email codes for selected domains

`EMAIL_CODE_DOMAINS` lists exact domains, such as `example.com`. With the global Entra code override false, only active directory-linked learners without staff/superuser flags can use this exception.

For an unknown address in that list, an exact Graph mail lookup can create a learner only if one enabled Member matches and no identity collision exists. Bulk-sync license/domain filters do not govern this lookup. Explicit disablement or removal still affects these accounts.

Empty the domain list to disable the exception. Previously issued codes for those directory users can no longer be verified. Their accounts and history remain.

## Outside-company profile refresh at sign-in

Members outside `DIRECTORY_EMAIL_DOMAINS` can refresh directory profile fields during Entra or e-mail-code sign-in. Refresh is limited to once per 24 hours with a 4.5-second deadline. E-mail comes from `mail`, not an external-guest UPN. Conflicting identifiers are skipped.

Explicitly disabled Members cannot sign in. Guest objects are unchanged. Graph errors in profile refresh do not block sign-in. This does not widen bulk synchronization or pre-create outside-domain people.

## Training groups

Under **People**, manage groups and their members. Use manual groups for a selected roster. Course/exam assignments take a snapshot of the active members at assignment time. Groups can also define an exam audience, where current membership governs new access.

System administrators can link a group to Microsoft Entra using a reviewed preview. Configure `GroupMember.Read.All` in addition to `User.Read.All`. Transitive user membership includes nested groups; devices, contacts and service principals are excluded. Unknown users are not created by group sync. Provision people separately.

Linked memberships are read-only locally. Unlinking retains the current members and makes the group manual. A preview expires after 15 minutes and is rechecked on apply. Automatic sync refuses removals exceeding half of a group with at least ten members; use a fresh reviewed Sync now preview to resolve it. See [the group implementation](../backend/training/entra_groups.py).

## Email notifications and delivery log

Open **Settings → Email** (`/email`) for sender status, queued/failed counts and delivery history. **Send test email to me** allows three requests per rolling ten minutes, including failures. It sends only to your own address. Accepted means the service accepted the message, not that it reached the inbox.

Notifications are English text/HTML with organization identity, event facts, an action link and a plain fallback URL. Meeting links appear only for approved recipients. The sender comes from the effective e-mail settings.

Assignment, enrollment decisions, scheduled registration, pending requests, participant cancellation, session changes and session cancellation can enqueue mail. New one-step training enables reminders. Existing courses keep reminders off until enabled. Publication, grading and invitation-link creation do not send those links or results automatically.

**E-mail reminders** controls session-tomorrow, quiz-ready and one quiz reminder. The quiz reminder is due 72 hours after the ready batch was produced and only for eligible people who have not passed. A person marked absent receives no after-session quiz mail. Disabling reminders cancels eligibility for queued reminders too. See [the exact reminder windows](SIMPLE-TRAINING-API.md).

The scheduler claims messages before network I/O. Event keys prevent duplicate enqueueing. Messages use event-time address/content snapshots, and delivery rechecks recipient activity. Directory synchronization itself sends no mail.

Mailbox rejection pauses the whole queue, including later additions. HTTP 429/503 can use Retry-After, clamped to one minute through one hour. Other retry pauses grow through 1, 2, 4, 8 and 15 minutes. A successful send, including a test, clears the pause. Queued mail resumes on a later scheduler tick.

Ambiguous failures, including timeouts and HTTP 500/502/504, fail without automatic resend. The message may already have arrived. Review before choosing **Retry**. **Cancel** applies only to queued rows. Codes and test messages cannot be retried from this queue.

The daily limit counts accepted platform messages in a rolling 24 hours. Codes and tests count but bypass the limit. Mail sent outside the platform is not counted. `EMAIL_NOTIFICATIONS_ENABLED=false` pauses notifications while preserving queued rows; synchronous codes/tests remain separate.

Queue snapshots contain personal information. Define retention and restrict access to the delivery log and backups. Logs use sanitized reasons, not raw provider responses or credentials.

## Cancel training or delete courses and exams

Use the training menu's **Cancel training** to cancel unfinished sessions while preserving enrollment and attendance history. **Cancel session** affects one session and uses the existing cancellation notices.

**Delete course** previews affected records and requires the exact title. It deletes course learning records but preserves linked exams/results. It does not physically purge all retained media files.

**Delete exam** also requires the title. Any participant attempt, even in progress, blocks deletion. Unpublish the exam instead. Private previews alone do not block deletion. Unpublishing preserves results and attempt budgets.

## Question figures and exam bundles

Question figures support PNG, JPEG and WebP uploads. Use the question editor to upload and preview them. Figures travel with frozen attempt snapshots; do not replace historical evidence by editing a live file.

The `import_exam_bundle` management command imports reviewed exam-bundle/1 JSON files as draft exams. Inspect its options before use:

```bash
DEBUG=true .venv/bin/python backend/manage.py import_exam_bundle --help
```

Keep source bundles outside public assets when they contain answer keys. Review all questions and figures before publishing.

## Operator checks and recovery

Open **Settings → Settings → Advanced maintenance → Deployment readiness**, or run `python manage.py check_deployment --strict` in the API container. The checks report local configuration, not live provider acceptance. Email **Off** is listed as Off and does not fail the strict check.

Use [the backup and restore procedure](DEPLOYMENT.md#back-up-and-restore). Keep database, media and effective encryption keys together in the recovery plan. Restore into a fresh isolated project before routing traffic.

## Migrations and rollback

Deploy matching web, API, content and scheduler images. Keep the previous environment, images and consistent database/media backup. The [migration files](../backend/training/migrations/) are the schema record.

| Migration | Upgrade or rollback concern |
| --- | --- |
| `0005` answer revision | Reload old attempt tabs after deployment. Saves use revisions to avoid overwriting another tab. |
| `0007` numeric questions | Adds numeric tolerances without rewriting existing results. Old clients cannot author the new types. |
| `0008` retry interval | Existing exams default to zero wait. |
| `0009` text matching | Preserves existing matching defaults and frozen attempt rules. |
| `0010` navigation/review | Existing behavior remains; new attempts freeze navigation rules. Review visibility stays a live policy. |
| `0011` previews | Private preview state is separate from participant evidence. Keep it during image rollback. |
| `0012` monitoring, `0013` reopening | Preserve extension and submission history. Deploy matching player/API/worker code and reload old tabs. |
| `0014` grading revision/imports | Adds grading revisions and protected import receipts. Reload review tabs. Preserve applied receipts. |
| `0015` enrollment approval | Existing courses stay open, enrollments approved. Upgrade content service with API; reopen SCORM to replace old participant-bound content cookies. |
| `0016` covers/progress, `0017` rounds/sessions | Preserve covers, progress, rounds and session records. Old images cannot enforce the new session/round behavior. |
| `0018` outbound e-mail | Migrate before starting the scheduler. No old assignments/enrollments are backfilled. |
| `0019` directory/groups | Check case-equivalent subjects before the unique constraint. Disable scheduling for image rollback; keep people and schema. |
| `0020` question figures | Keep schema applied. Before pre-feature image rollback, remove frozen grading guides as described below to avoid exposing them. |
| `0021` linked groups | Leave applied for image rollback. Old images can modify memberships without respecting links; pause those operations. Reversing to `0020` drops link metadata but keeps groups/members. |
| `0022` roles | Field-choice change with no SQL schema change. Before old-image rollback, record and map new role values to learner, or block their sign-in. Old dashboard behavior can expose aggregates to unknown roles. |
| `0023` on-site courses | Keep migration applied. Old images hide material/attendance controls and cannot enforce venue rules. Do not edit those records through old code. |
| `0024` registration keys | Keep migration applied. Old images ignore public registration keys; unrotated keys work again after redeployment. |
| `0025` shared assessments | Keep migration applied. Old images see only the earliest surviving `Exam.course` link. Reversing to `0024` discards extra links. Avoid link edits through old images. |
| `0026` course audience | Old images do not understand course-only audience. Review affected exams before rollback. |
| `0027` simple training | Existing rows keep reminders off and immediate quiz release. Keep additive schema during image rollback. Old code ignores after-session gating and reminder revocation. Pause queue delivery and unpublish affected quizzes before rollback if early access must stay blocked. |
| `0028` settings | Adds optional settings and nullable unique Google subject. Keep schema and encryption key; old images do not use saved provider settings. Restore environment configuration before reverting. |

Do not reverse migrations as a routine image rollback. Reversal can discard evidence or metadata. See [deployment recovery](DEPLOYMENT.md#upgrade-and-roll-back).

### Roll back question figures safely

Before returning to images from before `0020_question_figures`, pause incoming requests and attempt creation. Back up and verify the database. While the current image is still running:

```bash
docker compose exec -T api python manage.py remove_snapshot_grading_guides --dry-run
docker compose exec -T api python manage.py remove_snapshot_grading_guides
```

Then restore the old images, leave 0020 applied and resume traffic. The command removes only frozen `grading_guide` keys from active/finished attempt snapshots. Answers, figure references and question order remain. Question and bank guides stay stored. Staff lose frozen guides on those attempts.

Reversing 0020 drops stored figures and grading-guide columns but does not scrub historical snapshot JSON. It is not a substitute for the command. Use reversal only when deliberately removing the feature, with a verified backup.
