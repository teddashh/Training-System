import { appPath } from "./paths";
import { useEffect, useState } from "react";
import { Download, Upload } from "lucide-react";
import { api, ApiError } from "./api";
import { t, useLocale } from "./i18n";
import { Badge, ErrorBox, Modal, Spinner, statusLabel } from "./ui";

type Outcome = { status: string; score: number | null; passed: boolean | null };
type ImportRecord = {
  id: string;
  actor: string;
  reason: string;
  status: string;
  created_at: string;
  expires_at: string;
  applied_at: string | null;
  row_count: number;
  attempt_count: number;
  skipped: number;
  can_apply: boolean;
};
type ImportDetail = ImportRecord & {
  changes: {
    line: number;
    attempt_id: string;
    person: string;
    number: number;
    question_id: number;
    question: string;
    maximum_points: number;
    before_points: number | null;
    after_points: number | null;
    before_feedback: string;
    after_feedback: string;
  }[];
  outcomes: {
    attempt_id: string;
    person: string;
    number: number;
    before: Outcome;
    after: Outcome;
  }[];
};
type History = {
  results: ImportRecord[];
  count: number;
  page: number;
  pages: number;
};
type Preview =
  | ({ valid: true } & ImportDetail)
  | { valid: false; errors: { line: number; message: string }[] };
const MAX_BYTES = 256 * 1024;

export default function MarksImport({
  examId,
  userId,
  filters,
  onClose,
  onSaved,
}: {
  examId: number;
  userId: number;
  filters: { search: string; number: string; status: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const locale = useLocale();
  const endpoint = `exams/${examId}/marks/`;
  const storageKey = `training-marks-import:${userId}:${examId}`;
  const [csv, setCsv] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [page, setPage] = useState(1);
  const [changePage, setChangePage] = useState(1);
  const [version, setVersion] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const date = (value: string) => new Date(value).toLocaleString(locale);
  const importStatus = (value: string) =>
    ({
      preview: t("Preview ready"),
      applied: t("Applied"),
      expired: t("Expired"),
      stale: t("Stale preview"),
    })[value] || value;
  function remember(id: string | null) {
    // The server history also recovers receipts when browser storage is unavailable.
    try {
      if (id) sessionStorage.setItem(storageKey, id);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* server history remains available */
    }
  }
  useEffect(() => {
    let alive = true;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(storageKey);
    } catch {
      /* optional convenience */
    }
    if (id) {
      setBusy(true);
      api<ImportDetail>(`${endpoint}imports/${id}/`)
        .then((data) => {
          if (alive) setDetail(data);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }
    return () => {
      alive = false;
    };
  }, [endpoint, storageKey]);
  useEffect(() => {
    let alive = true;
    api<History>(`${endpoint}imports/?page=${page}&page_size=10`)
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
  async function download() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        search: filters.search,
        status: filters.status,
      });
      if (filters.number) params.set("number", filters.number);
      const response = await fetch(appPath(`/api/${endpoint}template/?${params}`), {
        credentials: "same-origin",
        headers: { "Accept-Language": locale === "zh-TW" ? "zh-hant" : locale },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(
          typeof data === "string"
            ? data
            : Array.isArray(data)
              ? data.join(" ")
              : data.detail || t("Request failed"),
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `exam-${examId}-marks.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function readFile(file?: File) {
    if (!file) return;
    setError("");
    setErrors([]);
    setBusy(true);
    try {
      if (file.size > MAX_BYTES)
        throw new Error(t("Marks CSV must be UTF-8 and at most 256 KiB."));
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      setCsv(text);
    } catch {
      setError(t("Marks CSV must be UTF-8 and at most 256 KiB."));
      setCsv("");
    } finally {
      setBusy(false);
    }
  }
  async function preview(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setErrors([]);
    try {
      const data = await api<Preview>(
        `${endpoint}imports/`,
        "POST",
        { csv, reason },
        20000,
      );
      if (data.valid) {
        remember(data.id);
        setDetail(data);
        setChangePage(1);
        setUncertain(false);
        setPage(1);
        setVersion((v) => v + 1);
      } else setErrors(data.errors);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function select(id: string) {
    setBusy(true);
    setError("");
    setErrors([]);
    try {
      const data = await api<ImportDetail>(`${endpoint}imports/${id}/`);
      remember(id);
      setDetail(data);
      setChangePage(1);
      setUncertain(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!detail || busy) return;
    setBusy(true);
    setError("");
    remember(detail.id);
    try {
      const data = await api<ImportDetail>(
        `${endpoint}imports/${detail.id}/`,
        "POST",
        {},
        20000,
      );
      setDetail(data);
      setUncertain(false);
      setVersion((v) => v + 1);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.code === "stale_marks_preview") {
        setDetail({ ...detail, status: "stale", can_apply: false });
        setUncertain(false);
        setVersion((v) => v + 1);
      } else setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  function newImport() {
    remember(null);
    setDetail(null);
    setErrors([]);
    setError("");
    setUncertain(false);
  }
  function outcome(value: Outcome) {
    return `${statusLabel()[value.status] || value.status}${value.score === null ? "" : ` · ${value.score}%`}`;
  }
  return (
    <Modal title={t("Import marks")} onClose={onClose} wide>
      <div className="modal-form marks-import">
        <p className="notice">
          {t(
            "Import scores and feedback for submitted account or guest attempts in this exam. Review every change before applying. Scores can override automatic grading and update training completion; answers and attempt quotas stay unchanged.",
          )}
        </p>
        <ErrorBox message={error} />
        {detail ? (
          <section aria-label={t("Reviewed marks import")}>
            <div className="marks-import-heading">
              <Badge tone={detail.status === "applied" ? "green" : "neutral"}>
                {importStatus(detail.status)}
              </Badge>
              <button className="btn" disabled={busy} onClick={newImport}>
                {t("New import")}
              </button>
            </div>
            <h3>{detail.reason}</h3>
            <p>
              {detail.actor} · {date(detail.created_at)}
            </p>
            <p>
              {t(
                "{rows} question changes across {attempts} attempts; {skipped} unchanged rows skipped.",
                {
                  rows: detail.row_count,
                  attempts: detail.attempt_count,
                  skipped: detail.skipped,
                },
              )}
            </p>
            {detail.status === "preview" && (
              <p>
                {t("Preview expires: {date}", {
                  date: date(detail.expires_at),
                })}
              </p>
            )}
            {detail.status === "applied" && (
              <p className="notice" role="status">
                {t(
                  "Marks applied. This receipt preserves the changes made at that time; later grading may differ.",
                )}
              </p>
            )}
            {uncertain && (
              <p className="notice">
                {t(
                  "The outcome is not confirmed. Retry this saved import or refresh its status; it will never apply twice.",
                )}
              </p>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("Participant")}</th>
                    <th>{t("Before")}</th>
                    <th>{t("After")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.outcomes.map((item) => (
                    <tr key={item.attempt_id}>
                      <td>
                        {item.person}
                        <small>
                          {t("Attempt {number}", { number: item.number })}
                        </small>
                      </td>
                      <td>{outcome(item.before)}</td>
                      <td>{outcome(item.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>{t("Question changes")}</h3>
            <div className="marks-changes">
              {detail.changes
                .slice((changePage - 1) * 25, changePage * 25)
                .map((item) => (
                  <article
                    className="review-question"
                    key={`${item.attempt_id}:${item.question_id}`}
                  >
                    <small>
                      {t("CSV line {line}", { line: item.line })} ·{" "}
                      {item.person} ·{" "}
                      {t("Attempt {number}", { number: item.number })}
                    </small>
                    <h3>{item.question}</h3>
                    <p>
                      {t("Score")}: {item.before_points ?? "—"} →{" "}
                      {item.after_points ?? "—"} / {item.maximum_points}
                    </p>
                    <div className="marks-feedback">
                      <div>
                        <strong>{t("Previous feedback")}</strong>
                        <p className="review-answer">
                          {item.before_feedback || t("No feedback")}
                        </p>
                      </div>
                      <div>
                        <strong>{t("New feedback")}</strong>
                        <p className="review-answer">
                          {item.after_feedback || t("No feedback")}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
            {detail.changes.length > 25 && (
              <div className="pagination">
                <button
                  className="btn"
                  disabled={changePage === 1}
                  onClick={() => setChangePage((v) => v - 1)}
                >
                  {t("Previous")}
                </button>
                <span>
                  {t("Page {page} of {pages}", {
                    page: changePage,
                    pages: Math.ceil(detail.changes.length / 25),
                  })}
                </span>
                <button
                  className="btn"
                  disabled={changePage * 25 >= detail.changes.length}
                  onClick={() => setChangePage((v) => v + 1)}
                >
                  {t("Next")}
                </button>
              </div>
            )}
            <div className="marks-import-heading">
              <button
                className="btn"
                disabled={busy}
                onClick={() => select(detail.id)}
              >
                {t("Refresh import status")}
              </button>
              {detail.can_apply && (
                <button className="btn primary" disabled={busy} onClick={apply}>
                  {busy
                    ? t("Saving…")
                    : uncertain
                      ? t("Retry saved import")
                      : t("Apply reviewed marks")}
                </button>
              )}
            </div>
          </section>
        ) : (
          <form className="extension-form" onSubmit={preview}>
            <div className="marks-import-heading">
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={download}
              >
                <Download size={16} />
                {t("Download marks template")}
              </button>
            </div>
            <p>
              {t(
                "The template follows the monitor’s search, attempt-number and status filters and includes submitted attempts only. Limit each file to 500 question rows, 100 attempts and 256 KiB.",
              )}
            </p>
            {(filters.search || filters.number || filters.status) && (
              <p className="muted">
                {t("Template filters")}:{" "}
                {[
                  filters.search,
                  filters.number &&
                    t("Attempt {number}", { number: filters.number }),
                  filters.status && statusLabel()[filters.status],
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <p>
              {t(
                "Edit only points, feedback and clear_feedback. Blank cells keep existing values. To remove feedback, set clear_feedback to true and leave feedback blank. Keep the IDs and revisions unchanged; use a decimal point for scores.",
              )}
            </p>
            <label>
              {t("Marks CSV file")}
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(e) => {
                  void readFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <label>
              {t("Marks CSV content")}
              <textarea
                rows={7}
                required
                value={csv}
                disabled={busy}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setErrors([]);
                }}
              />
            </label>
            <label>
              {t("Reason for marks import")}
              <textarea
                required
                maxLength={500}
                value={reason}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {errors.length > 0 && (
              <div role="alert">
                <strong>
                  {t(
                    "No marks were changed. Correct every error and preview again.",
                  )}
                </strong>
                <ul>
                  {errors.map((item, i) => (
                    <li key={i}>
                      {t("CSV line {line}", { line: item.line })}:{" "}
                      {item.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              className="btn primary"
              disabled={busy || !csv.trim() || !reason.trim()}
            >
              <Upload size={16} />
              {busy ? t("Loading…") : t("Preview mark changes")}
            </button>
          </form>
        )}
        <h3>{t("Marks import history")}</h3>
        <ErrorBox message={historyError} />
        {historyError && (
          <button className="btn" onClick={() => setVersion((v) => v + 1)}>
            {t("Retry")}
          </button>
        )}
        {!history && !historyError && <Spinner />}
        {history && !history.count && <p>{t("No marks imports yet.")}</p>}
        {history?.results.map((item) => (
          <article className="extension-record" key={item.id}>
            <strong>{item.reason}</strong>
            <p>
              {importStatus(item.status)} · {item.actor} ·{" "}
              {date(item.created_at)}
            </p>
            <button
              className="btn"
              disabled={busy}
              onClick={() => select(item.id)}
            >
              {t("View import")}
            </button>
          </article>
        ))}
        {history && history.pages > 1 && (
          <div className="pagination">
            <button
              className="btn"
              disabled={busy || history.page <= 1}
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
              disabled={busy || history.page >= history.pages}
              onClick={() => setPage(history.page + 1)}
            >
              {t("Next")}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
