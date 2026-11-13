# Set up your first training

This guide is for the system administrator of a new workspace. Start with a local trial. Complete [HTTPS and provider setup](DEPLOYMENT.md) before inviting people to a live service.

## 1. Start the stack

Follow [Start Docker Compose](DEPLOYMENT.md#start-docker-compose): copy `.env.example`, set separate secrets and start the stack. Open <http://localhost:8080>. You now have a workspace with persistent database and media volumes.

## 2. Create the first administrator

Run the `createsuperuser` and role-assignment commands in [the deployment guide](DEPLOYMENT.md#start-docker-compose). Use the same username in both commands. Sign in with that local password.

The account needs the platform **Super administrator** role (`admin`), in addition to Django operator privileges. This unlocks People and Settings.

## 3. Open Settings

In the sidebar, click **Settings**, then the **Settings** tab (`/settings`). In **Organization → Change**, set the organization name, upload a logo and choose interface languages. Removing the name/logo restores the brand pack defaults.

In **Sign-in → Change**, choose Microsoft Entra ID, Google Workspace or None. Register the displayed callback before testing a provider. None keeps local password accounts; e-mail codes need working e-mail.

In **Email → Change**, choose SMTP server, Microsoft 365 mailbox or Off. Save, then choose **Send test email to me**. Check the inbox for your administrator account. **Set by the server** means the deployment environment controls that section.

You now have the organization identity and access settings. See [Settings limits](OPERATIONS.md#configure-the-organization) and [provider setup](DEPLOYMENT.md#register-microsoft-entra-id-sign-in).

## 4. Add people

Click **People → Import participants**. Follow the CSV format, preview the rows, then import. New people are learners. Use **Edit person** to give managers the appropriate role or set a local password.

Alternatively, share the workspace URL with allowed directory users. They choose **Sign in with Microsoft** or **Sign in with Google** on the sign-in page. Microsoft Entra directory sync can provision people before their first sign-in. Google Workspace sign-in can link a matching active e-mail account. These are different identity-linking rules.

You now have people who can receive training. See [CSV onboarding](OPERATIONS.md#bulk-onboarding), [directory sync](OPERATIONS.md#directory-provisioning-operators) and [Google sign-in](DEPLOYMENT.md#register-google-workspace-sign-in).

## 5. Create and publish a course

Click **Training → Trainings → More → Create course**. Choose **Interactive content** to open Studio. Add a lesson, preview it, then choose **Publish to course**. Choose **Make available to learners** to release the draft.

For an existing package, create a course and use its menu's **Upload SCORM**, then **Publish course**. Uploading content and releasing the course are separate actions.

You now have a course in the learner catalog. See [course authoring](OPERATIONS.md#create-and-publish-a-course). The optional [starter library](course-library-sources.md) imports drafts for review.

## 6. Schedule a session

Click **Training → New training** for an on-site event. Add the title, date, start/end time, place and seats. Add people now or share **Copy link** from the resulting training page. The form publishes the course and creates registration.

At session time, open **Attendance** and mark Present or Absent. Under **Sign-in sheet**, choose **PDF** for printing or **Excel** for a spreadsheet. You now have registration and attendance records. See [sessions and attendance](OPERATIONS.md#schedule-sessions-and-mark-attendance), including online sessions.

## 7. Create an exam

Click **Exams → Exams → New exam**. Add questions, set duration and passing score, and choose the audience. Save, preview and publish. To attach it to a course, use **Course assessment** in course settings or **Linked courses** in the exam editor.

You now have a published assessment. Publication does not automatically assign it. See [exam setup](OPERATIONS.md#create-an-exam) and [shared assessments](OPERATIONS.md#shared-course-assessments-0025).

## 8. Assign required training

Click **Training → Assignments → Assign training**. Choose a published course or exam and its recipients. Set an optional due date and instructions. Decide whether to send assignment e-mail, then submit.

People now see required work in My training or My exams. See [assignment rules](OPERATIONS.md#assign-required-training).

## 9. Read reports

Click **Reports → Overview** for totals and trends, **Results** for attempts and CSV export, or **Insights** for exam/question analysis. Open an assignment report for completion and overdue status.

Reports reflect your permission scope and saved evidence. Essays wait for manual grading. See [reports](OPERATIONS.md#read-reports) and [grading](OPERATIONS.md#assessment-results-and-insights).
