# Use the training and Settings APIs

All routes below are relative to the configured app mount. JSON timestamps are ISO 8601.
Course-manager scope is unchanged: courses `all`, or courses `own` plus ownership.
These course-manager endpoints do not grant assignment, invitation, administration, score, answer or attempt-detail access.
Course managers may see participant quiz pass status, including training schedulers with results scope `none`.

1. **Roster:** pasted text, CSV/XLSX, account IDs and active group members resolve in that order.
   Evidence, nothing else: a line with addresses is one entry per address and only the address counts (its
   name is the text in front of it); otherwise the line is split into cells on tabs and commas and a whole cell
   equal to an employee ID (case-insensitive), or a single-cell line equal to a username, names the account.
   `Alex Rivera 10492` (spaces only) is `not_found`; two accounts in one line are `ambiguous`.
   Imports approve seats, move seats atomically, report each outcome and audit changes. A person seated in a
   session that has started stays there (`already`) unless they are marked absent, or `move_started` is sent
   and they have no mark; someone marked present (or with `attended_at`) is never moved by an import.
   Directory reads share a 20-second deadline; only eligible profiles are saved inside admission.
   Dry runs write no accounts, enrollments, audits or mail. Import retries leave approved seats unchanged.
2. **Switching:** `enroll` switches before the current session starts, preserving approval status.
   Destination window/capacity and optimistic revision checks still apply. Replay to the same session is harmless.
   Signed-in registration lookup includes only the caller's enrollment; anonymous output stays unchanged.
3. **Quiz:** links support `immediate` / `after_session`; only the latter course-derived grant is gated.
   `after_session` is accepted only for courses with scheduled sessions; an existing one on a course that is
   no longer scheduled acts as `immediate` in every access and mail decision.
   Someone marked absent gets no after-session grant through that enrollment; unmarked counts as attended.
   Independent audiences, assignments, invitations and active-attempt resume rules remain unchanged.
   Publish-and-link is atomic; an Everyone draft becomes course-only. Published quizzes retain their audience.
4. **Creation/overview:** one creation transaction includes publication, sessions, key, quiz and roster.
   `(organizer, request_id)` receipts serialize concurrent retries and return the original response.
   The overview includes per-session seats/attendance and scheduled/produced mail, without unauthorized results.
5. **Mail:** registered, request received, session changed, participant cancellation, tomorrow, quiz ready,
   and quiz reminder messages use the shared layout/outbox, one button, expiry and dedupe keys.
   Session mails: subject with what and when, one lead, When/Where (Was/Now on changes), description only first.
   The reminder duty runs immediately before delivery; an idle run uses four database statements.
   First-observation markers prevent old-mail floods while allowing a recent session's quiz to open much later.
   Quiz ready is produced only until 7 days after the later of session end and quiz start, and only for a link
   created within 7 days of the session end; the reminder 72 hours after its ready batch was produced (never
   without one), within 7 days of that time. A quiz batch repeats only when the session end moved later than
   the previous batch. "Session tomorrow" says "Today" when produced on the session day (NOTIFICATION_TIME_ZONE).
   Roster mail is sent only while the course is released (published, release time reached).
   Rescheduling renews tomorrow reminders; cancellation, removal and disabling reminders invalidate queued reminders.
6. **PDF:** Letter portrait, embedded Noto Sans TC, escaped paragraphs, repeated column headings,
   34 pt handwriting rows, five numbered walk-in rows and localized “Page x of y”. XLSX remains available.
   Header: configured organization logo top right, “Sign-in sheet”, title, one localized date line in the requested zone.
7. **Schema/operations:** one additive migration, `0027_simple_training`; legacy rows retain reminders off
   and immediate quiz release. See [migration and rollback guidance](OPERATIONS.md#migrations-and-rollback).

## Request and response contracts

`POST /api/courses/{id}/roster/` (JSON or multipart; multipart list fields repeat their field name):
```json
{"session":12,"text":"Alex Rivera <alex@example.com>","people":[34],"groups":[],"dry_run":false,"notify":true,"move_started":false}
```
`session` is required; the other fields default to empty / false / true / false as shown. Multipart may add `file`.
CSV: UTF-8 (BOM optional), UTF-16 with BOM, otherwise Windows-1252; tab/semicolon/comma delimiter from the first
line. XLSX: the first visible worksheet only; whole-number floats (`10492.0`) read as `10492`. File limit 1 MiB.
Heading row (first file row, or a tab-separated first pasted line): a known e-mail heading (`email`, `e-mail`,
`email address`, `work email`, `mail`, `電子郵件`, `電子信箱`, `信箱`, `correo electrónico`, …) or employee-ID heading
(`employee id`, `employee no`, `emp id`, `id`, `員工編號`, `工號`, `員編`, `id de empleado`, …) selects that column.
When both headings exist, each row uses its nonempty e-mail cell, otherwise its employee-ID cell. An invalid
nonempty e-mail never falls back to an ID. Headings are case-insensitive; Name is never evidence. A two-column
identifier row with neither value is `not_found`; its `input` is the row's non-empty cells joined by a tab. Single-heading and
unheaded files retain their existing behavior. The heading row is dropped. `input` is the chosen cell,
otherwise the row's non-empty cells joined by a tab, so
sending the inputs back as text resolves the same people. Limits: `text` ≤ 200,000 characters; ≤ 2,000 lines
(pasted lines plus file rows) per request, else 400 "Use at most 2,000 lines at a time."; ≤ 500 unique people.
A line without an address longer than 200 characters is `not_found` without lookup; its `input` is cut to 200 + `…`.
```json
{"session":12,"counts":{"added":1,"duplicate":1},"rows":[{"input":"Alex Rivera <alex@example.com>","outcome":"added","user":34,"name":"Alex Rivera","email":"alex@example.com","department":"Practice"},{"input":"34","outcome":"duplicate","user":34,"name":"Alex Rivera","email":"alex@example.com","department":"Practice"}],"notified":1}
```
`notified` is the number of people a mail was queued for: 0 with `notify:false`, in a dry run, while the course is
not released, or with mail switched off. `inactive` rows carry the input only (`user:null`, empty name/email/department).
Moved or approved into a session that is already over gets the added-person decision (quiz ready), not "Session
changed". A move's audit row records `previous_session`, `previous_attendance`, `previous_attended_at`,
`previous_progress` and `previous_completed_at`.
Only outcomes present in the response appear in `counts`. Outcomes: `added`, `approved`, `already`, `moved`,
`inactive`, `full`, `duplicate`, `not_found`, `ambiguous`, `not_checked`. Unresolved `user` is null.
A directory dry-run profile also has `user:null`; its real ID exists only after creation. Outcomes simulate the same snapshot.

`GET /api/courses/{id}/enrollments/?status=all&page=1&session=12&search=Alex` retains existing pagination:
`{count,page,page_size:20,counts:{all,registered,pending,attended,absent,cancelled[,passed]},results:[EnrollmentRow]}`.
Tile counts cover the entire course before filters; `registered` means approved and `cancelled` means canceled.
EnrollmentRow contains `{id,status,revision,request_note,requested_at,review_note,reviewed_at,progress,progress_known,
completed_at,attended_at,attendance,attendance_marked_at,effective_attendance,session,user_id,person,username,department,active,reviewer,quiz}`.
Its `session` is null or `{id,title,starts_at,ends_at,cancelled,location}`. `quiz` is null without a published linked
quiz, otherwise `passed` when every published linked quiz has a passed graded attempt, `not_passed` when there
is graded evidence but not all passed, or `not_started` when there is no graded evidence. Draft quizzes and
ungraded attempts do not contribute. `counts.passed` appears only with a published linked quiz and counts
passed people across the whole course before search, status, session or pagination. One grouped attempt query
serves both the page and this count. No scores, answers or attempt details are returned.

`POST /api/courses/{id}/enroll/`: `{session:13,revision:1,note:""}`; returns the existing enrollment payload
(the EnrollmentRow fields above, excluding user_id/person/username/department/active/reviewer/quiz).
`POST /api/courses/{id}/cancel-registration/`: `{revision:2}`; same enrollment payload.
`POST /api/registration/lookup/`: `{key:"<registration key>"}`; existing public course/session projection,
plus `enrollment:null|{status,session:<id|null>}` only when signed in. Own active seat stays visible when full/closed.
Each public session is `{id,title,starts_at,ends_at,state,seats_remain,seats_left[,location][,registration_opens_at]}`:
`seats_left` is the free-seat count when five or fewer remain, else null; `registration_opens_at` only while `upcoming`.

`POST /api/courses/{id}/assessments/`: `{exam:15,attach:true,release:"after_session",publish:true}`.
`attach` defaults true, `publish` false; omitted release preserves an existing link or defaults to immediate.
`PATCH /api/courses/{id}/assessments/`: `{exam:15,release:"immediate"}`; release is required and the link must exist.
Both return `{linked:[QuizOption],available:[QuizOption]}` as before, with `release` added.
QuizOption is `{id,title,published,audience,available_to_me,question_count,other_courses,can_manage,starts_at,ends_at,window_state,release,gated}`;
release is null for unlinked options. `gated` is true only when the link is `after_session` on a scheduled course and
the quiz audience is `course` (nobody gets in before their session). `release:"after_session"` on a course whose
delivery mode is not `scheduled` is 400 `{release:[…]}` (POST, PATCH and publish-and-link).
Publishing a draft requires exam-management permission and questions.
`GET /api/exams/link-options/?quizzes=1`: `[{id,title,published,audience,question_count,gated}]` for published
non-invitation quizzes and the caller's manageable, nonempty own drafts; `gated` is true for a published `course`
quiz or an Everyone draft (linking turns it course-only). The caller's own quizzes come first, then the others,
each by title. Without the filter, the existing course chooser is unchanged.

**“Opens for me” uses `starts_at`** in participant exam detail/list/My exams, course assessment rows and
`GET /api/exams/{id}/budget/`. It is the later of the exam start and the earliest eligible linked session end,
unless an independent grant already provides access. An enrollment marked `absent` gives no after-session
grant (start, list, detail, budget and course assessment rows agree) and no quiz-ready/reminder mail; queued
ones are canceled at delivery. Correcting the mark restores access; an unmarked person counts as attended. Future participants remain visible with `available_to_me:true`;
server admission still denies an early start. Management exam editing retains the actual exam window;
`next_attempt_at` also carries the personal session gate, including for managers participating in My exams.
Budget GET returns `{id,starts_at,ends_at,available_to_me,attempts_remaining,active_attempt_id,next_attempt_at,next_round_at,server_time}`.
Existing budget POST retains its management-only contract. Guest invitation access is not session-gated.

`GET /api/trainings/people-template/` (courses capability, like check-people; 403 otherwise):
returns `people-template.xlsx`, one sheet with only bold Email / Employee ID / Name headings, frozen first
row and readable widths. Headings follow Accept-Language (en, zh-hant for Traditional Chinese, es); all three
localizations are accepted by the parser. No example data. Content-Disposition is
`attachment; filename="people-template.xlsx"; filename*=UTF-8''people-template.xlsx`; response includes
`X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`.

`POST /api/trainings/check-people/` (courses capability, like creation; JSON or multipart):
```json
{"rosters":[{"text":"alex@example.com\n10492","people":[34],"groups":[7]},{"text":"","people":[35],"groups":[]}]}
```
1-10 rosters; every roster field is optional. Multipart is one roster: `text`, repeated `people`, repeated `groups`
and `file` (same CSV/XLSX limits as the roster import). Response 200:
```json
{"rosters":[{"counts":{"added":17,"not_found":1},"rows":[{"input":"…","outcome":"added","user":34,"name":"…","email":"…","department":"…"}]}]}
```
Outcomes: `added`, `duplicate` (earlier in this request, in this or an earlier roster), `inactive`, `not_found`,
`ambiguous`, `not_checked`. Nothing is written: no account, enrollment, audit row or mail; a directory match has
`user:null`. One 500-people limit, the 2,000-line limit and one 20-second directory deadline cover the whole
request; parsing, headings and `input` are those of the roster import. Unknown addresses go to the directory at
most four at a time (shared by all requests; a request waits for a slot until its deadline, then `not_checked`).
Found and not-found answers are remembered in process memory for 10 minutes (≤ 2,000 addresses), so the next check
and the creation do not ask again; errors and timeouts are not remembered. Errors (400): JSON uses `rosters[i].<field>` (or `rosters[i]` for the
people limit), multipart uses plain field names (`file`, `groups`). Non-course users get 403.

`POST /api/trainings/`:
```json
{"request_id":"11111111-2222-4333-8444-555555555555","title":"Forklift refresher","description":"","cover":"","sessions":[{"title":"","starts_at":"2027-01-12T14:00:00Z","ends_at":"2027-01-12T15:00:00Z","location":"Building C, Room 12","capacity":30},{"title":"","starts_at":"2027-01-12T18:00:00Z","ends_at":"2027-01-12T19:00:00Z","location":"Building C, Room 12"}],"rosters":[{"session":0,"text":"alex@example.com","people":[],"groups":[]},{"session":1,"text":"","people":[35],"groups":[]}],"exam":15,"notify":true}
```
Requires request_id, title and 1-10 future sessions with starts_at/ends_at/location. Capacity defaults 100;
blank title becomes localized “Session N”; duration rounds the first session up to whole minutes.
Description defaults empty. A non-empty `cover` must be a library ID (`cover` error otherwise); an empty cover
becomes an illustrated `scene-…` chosen from the title. `exam` is optional; `rosters` is optional (at most 10),
each `session` a zero-based index (default 0). A person in more than one list gets the first; later occurrences
are `duplicate`. All lists resolve before the transaction with one deadline and one 500-people limit.
Top-level notify controls initial roster mail; reminders remain enabled. Validation keys include
`sessions[1].ends_at`, `rosters[1].session`, `rosters[0].groups`. The singular `roster` key no longer exists.
Success 201, replay 200: `{course:<id>,registration_url:"/register#…",sessions:[12,13],rosters:[RosterReport],quiz:null|{id,published,release,gated}}`;
`rosters` is in request order and `[]` when none was sent. RosterReport is the roster-import response.
Registration paths include APP_BASE_PATH when configured. A replay returns the first receipt even if the submitted payload differs.

`GET /api/courses/{id}/training/`:
`{id,title,published,release_at,reminders,registration_url,people,sessions:[SessionOverview],quizzes:[QuizOverview]}`.
`people` is the number of approved participants of this course, including those without a session.
SessionOverview is `{id,title,revision,location,meeting_url,registration_opens_at,registration_closes_at,starts_at,ends_at,
capacity,reserved,remaining,cancelled,state,counts:{registered,pending,present,absent,seats},emails:[MailEvent]}`.
MailEvent is `{kind,exam:<id|null>,scheduled_at,produced_at:<time|null>,state,delivery:{<outbox status>:<count>}}`;
state is `scheduled`, `disabled` (switched off, or outside the 7-day windows above), `produced`, or `superseded`.
A quiz reminder's `scheduled_at` is the ready batch's production time + 72 h (before that, planned ready + 72 h). Delivery distinguishes `queued`/`sent`/`failed`/`cancelled` messages.
QuizOverview is `{id,title,published,release,question_count,gated,participation:{started,passed}}` for every course
manager. Participation counts distinct approved participants of this course only: started means any attempt,
passed means any passed graded attempt. Shared quizzes never contribute people from another course.
The Overview shows “{passed} of {people} passed” for published quizzes after any pass or the first session ends.
Existing courses without a key return a null URL.
`PATCH /api/courses/{id}/` accepts `{reminders:false}` alongside existing editable fields.

`GET /api/courses/{id}/sessions/{sid}/export/?kind=sign-in-pdf&timezone=America/New_York` returns an attachment
`Forklift refresher - Session 1 - sign-in.pdf` (header `attachment; filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded>`;
`session-{sid}` when nothing ASCII remains); use the existing Accept-Language header for headings and the date line.
Existing `kind=sign-in` / `attendance` return XLSX, named `… - sign-in.xlsx` / `… - attendance.xlsx` the same way.
For attendance, result viewers retain best graded score and Yes/No pass columns per authorized exam.
Other course managers receive one Passed / Not passed / Not started column per published linked quiz,
without scores, answers or attempt details. Inaccessible drafts remain omitted. Export participants remain
limited to the session's approved and pending registrations.

`manage.py apply_scene_covers [--apply | --restore FILE]`: dry run by default; prints
`{"changes":[{"id":12,"from":"learning-skills","to":"scene-…"}],"unchanged":3}` (IDs only). Restore prints
`{"restored":[12],"skipped":0}`. See [Operations](OPERATIONS.md).

## Handle implementation limits

PDF export uses `kind`, not DRF's reserved `format` parameter. Dry-run directory IDs are null because no account is created. XLSX parsing caps expanded archives at 20 MiB. Roster previews do not send mail.

Session mail includes a meeting link only for approved seats. Moving a session end to a future time clears its first-observation marker; editing an already past session does not create another reminder batch. Creation locks the organizer row with `FOR NO KEY UPDATE` on PostgreSQL.

Live directory access, mail delivery and PostgreSQL locking require acceptance tests in the target environment. SQLite does not verify those paths. See [development checks](DEPLOYMENT.md#develop-locally).

## Runtime settings API

Migration `0028_system_settings` adds an optional singleton settings row and nullable, unique
`User.google_subject`; it neither populates settings nor changes existing users.

- `GET /api/settings/`: system administrators only. Returns `organization`, `sign_in`, `email`.
  Secrets are absent; `client_secret_set` / `password_set` indicate usable saved credentials.
  `secret_required` requests re-entry when ciphertext cannot be decrypted.
  Server-controlled sections have `server: true`; tenant/client IDs expose only the last four characters.
- `PUT /api/settings/organization/`: `organization_name` (empty or ≤80 characters), optional `languages`
  (nonempty subset of `en`, `zh-TW`, `es`). Omit languages when `languages_server` is true.
- `PUT /api/settings/sign_in/`: `provider` (`none`, `entra`, `google`), `client_id`, `client_secret`,
  and either `tenant_id` or `domains` (array of exact Workspace domains). Response includes the redirect URIs.
- `PUT /api/settings/email/`: `provider` (`off`, `smtp`, `graph`); SMTP takes `host`, integer `port`,
  `security` (`starttls`, `ssl`, `none`), `username`, `password`, `from_email`;
  Graph takes `tenant_id`, `client_id`, `client_secret`, `from_email`.
- `POST /api/settings/logo/`: multipart `logo`, PNG/JPEG/WebP, ≤2 MiB, ≤2048 pixels per side.
  Re-encodes to PNG and stores bytes, SHA-256, byte size and dimensions. `DELETE` restores the pack logo.
- `GET /api/organization/logo/{sha256}/`: public PNG, immutable one-year cache and `nosniff`.
- `POST /api/email/test/`: existing administrator-only endpoint and rolling limits; sends to the current administrator.

Mutations return the updated settings. Empty/omitted secrets retain saved ciphertext; a key change
requires a replacement secret. Validation returns 400, non-system-administrators get 403,
and writes to server-controlled sections get 409. Audit events are `settings.organization`,
`settings.logo`, `settings.sign_in`, `settings.email`, with no settings values.

`GET /api/auth/session/` adds `organization: {name, title, logo_url}`, `sign_in: {entra, google}`,
and `email_enabled`; `entra_enabled` remains. `languages` now reflects the effective request-time list.
`logo_url` is null when the pack logo applies. All public entry points and Studio use this session identity.

Google endpoints: `GET /api/auth/google/start/` and `GET /api/auth/google/callback/` use authorization code
with S256 PKCE and single-use session state/nonce (ten-minute lifetime). ID tokens require RS256,
Google issuer, client audience, expiry, nonce, verified email and an allowed hosted domain. Existing
Google subjects sign in; matching active email accounts link with `auth.google.link`; otherwise a learner
is created. Successful login records `auth.google` and returns to the application root, where the existing
registration return state resumes the selected registration. Disabled accounts cannot sign in or link.

When email is Off, no new notification is queued, queued delivery pauses, and sign-in codes, guest
verification and test email return “Email is off.” Existing verification requirements are never bypassed.
