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
