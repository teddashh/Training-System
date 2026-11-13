import { appPath } from "./paths";
import { t, useLocale } from "./i18n";
import { date, Empty } from "./ui";

export type ActivityEntry = {
  id: number;
  actor_label: string;
  action: string;
  target: string;
  target_label: string;
  target_path: string;
  created_at: string;
};

const labels: Record<string, string> = {
  "course.created": "Created a course",
  "course.updated": "Updated a course",
  "exam.created": "Created an exam",
  "exam.import": "Imported an exam bundle",
  "question_figure.upload": "Uploaded a question figure",
  "exam.updated": "Updated an exam",
  "user.created": "Added a person",
  "user.updated": "Updated a person",
  "user.imported": "Imported a person",
  "user.admin_access_granted": "Granted administrator access",
  "user.password_changed": "Changed a local password",
  "auth.google": "Signed in with Google",
  "auth.google.link": "Linked a Google account",
  "settings.organization": "Updated organization settings",
  "settings.logo": "Updated the organization logo",
  "settings.sign_in": "Updated sign-in settings",
  "settings.email": "Updated email settings",
  "auth.entra": "Signed in with Microsoft",
  "auth.password": "Signed in with a password",
  "auth.email": "Signed in with an email code",
  "attempt.reviewed": "Reviewed exam answers",
  "invitation.created": "Created a guest invitation",
  "invitation.revoked": "Disabled a guest invitation",
  "invitation.email_verified": "Verified a guest email",
  "assignment.created": "Assigned training",
  "assignment.cancelled": "Cancelled assigned training",
  "enrollment.requested": "Requested course access",
  "enrollment.enrolled": "Enrolled in a course",
  "enrollment.approved": "Approved course access",
  "enrollment.rejected": "Declined course access",
  "enrollment.removed": "Removed course access",
  "question_bank.created": "Added a question to the bank",
  "question_bank.updated": "Updated a question in the bank",
};

export function activityLabel(action: string) {
  return t(labels[action] || "Training activity");
}

export default function Activity({ rows, go, compact = false }: {
  rows: ActivityEntry[];
  go: (path: string) => void;
  compact?: boolean;
}) {
  useLocale();
  if (!rows.length) return <Empty title={t("No activity yet")} />;
  return <ol className="management-activity">
    {rows.map(row => <li key={row.id}>
      <div>
        <strong>{activityLabel(row.action)}</strong>
        <p>{row.actor_label || t("Guest / system")}</p>
        {row.target_label && row.target_label !== row.actor_label && (row.target_path
          ? <a className="management-record-link" href={appPath(row.target_path)} onClick={event => { event.preventDefault(); go(row.target_path); }}>{row.target_label}</a>
          : <span>{row.target_label}</span>)}
        {!compact && <details className="activity-details">
          <summary>{t("Record details")}</summary>
          <code>{row.action} · {row.target}</code>
        </details>}
      </div>
      <time dateTime={row.created_at}>{date(row.created_at)}</time>
    </li>)}
  </ol>;
}
