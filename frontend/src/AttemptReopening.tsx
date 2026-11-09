import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { t, useLocale } from "./i18n";
import { ErrorBox, Modal, Spinner, statusLabel } from "./ui";
import AttemptEvidence from "./AttemptEvidence";
import type { MonitoredAttempt } from "./ExamMonitor";

type Grant = {
  request_id: string;
  minutes: number;
  reason: string;
  answer_revision: number;
  submitted_at: string;
};
type Reopening = {
  id: string;
  minutes: number;
  reason: string;
  actor: string;
  created_at: string;
  new_deadline: string;
  previous_status: string;
  previous_score: number | null;
  previous_submitted_at: string;
};
type History = {
  results: Reopening[];
  count: number;
  page: number;
  pages: number;
};

export default function AttemptReopening({
  attempt,
  userId,
  onClose,
  onSaved,
}: {
  attempt: MonitoredAttempt;
  userId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const locale = useLocale();
  const storageKey = `training-reopening:${userId}:${attempt.id}`;
  const [pending, setPending] = useState<Grant | null>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      return value &&
        typeof value.request_id === "string" &&
        Number.isInteger(value.minutes) &&
        typeof value.reason === "string" &&
        Number.isInteger(value.answer_revision) &&
        typeof value.submitted_at === "string"
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const [minutes, setMinutes] = useState(pending?.minutes || 10);
  const [reason, setReason] = useState(pending?.reason || "");
  const [history, setHistory] = useState<History | null>(null);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Reopening | null>(null);
  const [record, setRecord] = useState<string | null>(null);
  const endpoint = `attempts/${attempt.id}/reopenings/`;
  const date = (value: string) => new Date(value).toLocaleString(locale);
  useEffect(() => {
    let alive = true;
    api<History>(`${endpoint}?page=${page}&page_size=10`)
      .then((data) => {
        if (alive) {
          setHistory(data);
          setHistoryError("");
        }
      })
      .catch((e) => {
        if (alive) setHistoryError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [endpoint, page, version]);
  async function reopen(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const request = pending || {
        request_id: crypto.randomUUID(),
        minutes,
        reason: reason.trim(),
        answer_revision: attempt.answer_revision,
        submitted_at: attempt.submitted_at!,
      };
      sessionStorage.setItem(storageKey, JSON.stringify(request));
      setPending(request);
      const result = await api<Reopening>(endpoint, "POST", request, 20000);
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setSaved(result);
      setPage(1);
      setVersion((v) => v + 1);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && [400, 409].includes(e.status)) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("Reopen & history")} onClose={onClose}>
      <div className="modal-form">
        <h3>
          {attempt.person} · {t("Attempt {number}", { number: attempt.number })}
        </h3>
        <ErrorBox message={error} />
        {saved ? (
          <p className="notice" role="status">
            {t(
              "Submission reopened until {deadline}. Ask the participant to resume or reload the attempt.",
              { deadline: date(saved.new_deadline) },
            )}
          </p>
        ) : (
          (attempt.status !== "in_progress" || pending) && (
            <form onSubmit={reopen} className="extension-form">
              <p className="notice">
                {t(
                  "Reopening withdraws the current score and completion until resubmission and review. A read-only copy of the submitted answers, grades and feedback is preserved. The same attempt and budget are reused; invitation expiry and access rules still apply.",
                )}
              </p>
              <p>
                {t(
                  "Only the latest submission can be reopened. Grant 1–240 minutes starting now, within the combined 1,440-minute extra-time limit.",
                )}
              </p>
              {pending && (
                <p className="notice">
                  {t(
                    "This request is awaiting confirmation. Retry the same request to check its outcome without adding time twice.",
                  )}
                </p>
              )}
              <label>
                {t("Extra minutes")}
                <input
                  type="number"
                  required
                  min="1"
                  max="240"
                  value={minutes}
                  disabled={busy || !!pending}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </label>
              <label>
                {t("Reason for reopening")}
                <textarea
                  required
                  maxLength={500}
                  value={reason}
                  disabled={busy || !!pending}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button className="btn primary" disabled={busy || !reason.trim()}>
                {busy
                  ? t("Saving…")
                  : pending
                    ? t("Retry reopening request")
                    : t("Reopen submission")}
              </button>
            </form>
          )
        )}
        <h3>{t("Reopening history")}</h3>
        <ErrorBox message={historyError} />
        {historyError && (
          <button className="btn" onClick={() => setVersion((v) => v + 1)}>
            {t("Retry")}
          </button>
        )}
        {!history && !historyError && <Spinner />}
        {history && !history.count && (
          <p>{t("No submissions have been reopened.")}</p>
        )}
        {history?.results.map((item) => (
          <article className="extension-record" key={item.id}>
            <strong>
              {t("Extra time granted: {minutes} minutes.", {
                minutes: item.minutes,
              })}
            </strong>
            <p>{item.reason}</p>
            <small>
              {item.actor} · {date(item.created_at)}
            </small>
            <small>
              {t("Deadline")}: {date(item.new_deadline)}
            </small>
            <small>
              {statusLabel()[item.previous_status] || item.previous_status}
              {item.previous_score !== null &&
                ` · ${item.previous_score}%`} ·{" "}
              {date(item.previous_submitted_at)}
            </small>
            <button className="btn" onClick={() => setRecord(item.id)}>
              {t("View preserved submission")}
            </button>
          </article>
        ))}
        {history && history.pages > 1 && (
          <div className="pagination">
            <button
              className="btn"
              disabled={history.page <= 1}
              onClick={() => setPage(history.page - 1)}
            >
              {t("Previous")}
            </button>
            <span>
              {t("Page {page} of {pages}", {
                page: history.page,
                pages: history.pages,
              })}
            </span>
            <button
              className="btn"
              disabled={history.page >= history.pages}
              onClick={() => setPage(history.page + 1)}
            >
              {t("Next")}
            </button>
          </div>
        )}
      </div>
      {record && (
        <AttemptEvidence
          key={record}
          id={attempt.id}
          recordId={record}
          onClose={() => setRecord(null)}
        />
      )}
    </Modal>
  );
}
