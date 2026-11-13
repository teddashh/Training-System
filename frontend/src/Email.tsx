import { appPath } from "./paths";
import { useEffect, useState } from "react";
import { api } from "./api";
import { t, useLocale } from "./i18n";
import { Badge, ErrorBox, Modal, Spinner } from "./ui";

type Entry = {
  id: number; kind: string; to_email: string; subject: string; status: string;
  attempts: number; last_error: string; created_at: string; can_retry: boolean;
};
type Log = {
  off: boolean; sender: string; configured: boolean; enabled: boolean; queued: number; failed: number;
  count: number; page: number; page_size: number; results: Entry[];
  paused_until: string | null; pause_reason: string;
  sent_last_24_hours: number; daily_limit: number; daily_limit_reached: boolean;
};
const statusLabels: Record<string, string> = {
  queued: "Queued", sending: "Sending", sent: "Accepted", failed: "Failed", cancelled: "Cancelled",
};
const kindLabels: Record<string, string> = {
  assignment: "Training assignment", enrollment_approved: "Enrollment approved",
  enrollment_rejected: "Enrollment rejected", enrollment_removed: "Enrollment removed",
  session_rescheduled: "Session rescheduled",
  session_cancelled: "Session cancelled", sign_in_code: "Sign-in code",
  guest_verification: "Guest verification", test: "Test email",
};
function errorLabel(message: string) {
  const match = message.match(/^Graph mail request failed \(HTTP (\d+)\)\.$/);
  if (match) return t("Graph mail request failed (HTTP {status}).", { status: match[1] });
  const unknown = message.match(/^delivery result unknown \(HTTP (\d+)\)\.$/);
  return unknown ? t("delivery result unknown (HTTP {status}).", { status: unknown[1] }) : t(message);
}

export default function Email() {
  const locale = useLocale();
  const [data, setData] = useState<Log | null>(null);
  const [status, setStatus] = useState("all"), [page, setPage] = useState(1);
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [retry, setRetry] = useState<Entry | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<Log>(`email/?status=${status}&page=${page}`)
      .then(value => { if (alive) setData(value); })
      .catch(e => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [status, page, reload, locale]);
  async function act(id: number, action: "retry" | "cancel") {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`email/${id}/${action}/`, "POST", {});
      setRetry(null); setReload(value => value + 1);
      setNotice(action === "retry" ? "Email queued for retry." : "Email cancelled.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError(""); setNotice("");
    try {
      await api("email/test/", "POST", {});
      setNotice("Test email accepted. Check your inbox.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setReload(value => value + 1); }
  }
  const headings = ["Time", "Recipient", "Type", "Subject", "Status", "Attempts", "Error", "Actions"];
  return <div className="email-page">
    <div className="page-heading"><div><h1>{t("Email")}</h1></div>
      <button className="btn" disabled={busy || loading} onClick={() => { setError(""); setReload(value => value + 1); }}>{t("Refresh")}</button>
    </div>
    <ErrorBox message={errorLabel(error)} />
    {notice && <p className="notice" role="status">{t(notice)}</p>}
    {data && <>
      {data.off ? <section className="panel"><p>{t("Email is off.")}</p><a className="btn" href={appPath('/settings')}>{t("Settings")}</a></section> : <section className="panel email-status" aria-label={t("Email delivery")}>
        <div><h2>{t("Email delivery")}</h2><p>{t("Sender")}: <strong>{data.sender}</strong></p>
          <p><Badge tone={data.configured ? "teal" : "amber"}>{data.configured ? t("Configuration present") : t("Not configured")}</Badge></p>
          <p>{t("Queued")}: {data.queued} · {t("Failed")}: {data.failed}</p>
          <p>{t("Accepted in the last 24 hours: {count} / {limit}", {
            count: data.sent_last_24_hours, limit: data.daily_limit || t("No limit"),
          })}</p>
          {!data.enabled && <p className="notice">{t("Notifications are paused. Verification codes and test emails still work.")}</p>}
          {data.enabled && data.daily_limit_reached && <p className="notice" role="status">{t("Daily sending limit reached. Notifications wait and resume automatically as older messages leave the 24-hour window. Verification codes and test emails still work.")}</p>}
          {data.enabled && data.paused_until && <p className="notice" role="status">{t("Email queue paused: {reason} Next try: {time}. Sending resumes automatically.", {
            reason: errorLabel(data.pause_reason), time: new Date(data.paused_until).toLocaleString(),
          })}</p>}
          <p className="muted">{t("Accepted means the mail service accepted the message, not confirmed inbox delivery.")}</p>
        </div>
        <button className="btn primary" disabled={busy} onClick={test}>{busy ? t("Working…") : t("Send test email to me")}</button>
      </section>}
      <div className="toolbar"><h2>{t("Delivery log")}</h2><label>{t("Email status")}
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="all">{t("All statuses")}</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </label></div>
      <div className="panel table-panel email-log" aria-busy={loading}>
        <table><thead><tr>{headings.map(label => <th key={label}>{t(label)}</th>)}</tr></thead>
          <tbody>{data.results.map(row => <tr key={row.id}>
            <td data-label={t("Time")}>{new Date(row.created_at).toLocaleString()}</td>
            <td data-label={t("Recipient")}>{row.to_email}</td>
            <td data-label={t("Type")}>{t(kindLabels[row.kind] || row.kind)}</td>
            <td data-label={t("Subject")}>{row.subject || "—"}</td>
            <td data-label={t("Status")}><Badge tone={row.status === "failed" ? "amber" : row.status === "sent" ? "teal" : "neutral"}>{t(statusLabels[row.status])}</Badge></td>
            <td data-label={t("Attempts")}>{row.attempts}</td>
            <td data-label={t("Error")}>{row.last_error ? errorLabel(row.last_error) : "—"}</td>
            <td data-label={t("Actions")}>
              {row.can_retry && <button className="btn small" disabled={busy || !data.enabled} onClick={() => { setError(""); setRetry(row); }}>{t("Retry")}</button>}
              {row.status === "queued" && <button className="btn small" disabled={busy} onClick={() => act(row.id, "cancel")}>{t("Cancel")}</button>}
            </td>
          </tr>)}</tbody>
        </table>
        {!data.results.length && <p className="management-empty">{t("No emails to show.")}</p>}
      </div>
      <div className="toolbar email-pagination">
        <button className="btn small" disabled={busy || loading || data.page <= 1} onClick={() => setPage(data.page - 1)}>{t("Previous")}</button>
        <span>{t("Page {page} of {pages}", { page: data.page, pages: Math.max(1, Math.ceil(data.count / data.page_size)) })}</span>
        <button className="btn small" disabled={busy || loading || data.page * data.page_size >= data.count} onClick={() => setPage(data.page + 1)}>{t("Next")}</button>
      </div>
    </>}
    {loading && !data && <Spinner />}
    {retry && <Modal title={t("Retry email")} closeDisabled={busy} onClose={() => setRetry(null)}>
      <div className="modal-form"><p>{retry.to_email}</p><p>{t("If the previous delivery result was unknown, retrying may send a duplicate. Retry this email?")}</p>
        <ErrorBox message={errorLabel(error)} />
        <div className="modal-footer"><button className="btn" disabled={busy} onClick={() => setRetry(null)}>{t("Cancel")}</button>
          <button className="btn primary" disabled={busy} onClick={() => act(retry.id, "retry")}>{t("Retry")}</button></div>
      </div>
    </Modal>}
  </div>;
}
