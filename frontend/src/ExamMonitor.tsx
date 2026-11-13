import { useEffect, useState } from "react";
import { Activity, Clock3, RefreshCw } from "lucide-react";
import { api, ApiError } from "./api";
import { t, useLocale } from "./i18n";
import { Badge, Empty, ErrorBox, Modal, Spinner, statusLabel } from "./ui";
import { ReviewModal } from "./Management";
import AttemptEvidence from "./AttemptEvidence";
import AttemptReopening from "./AttemptReopening";
import MarksImport from "./MarksImport";

export type MonitoredAttempt = {
  id: string;
  person: string;
  key: string;
  department: string;
  number: number;
  answer_revision: number;
  reopen_count: number;
  status: string;
  deadline: string;
  started_at: string;
  submitted_at: string | null;
  last_seen_at: string | null;
  last_saved_at: string | null;
  recent: boolean;
  extra_time_minutes: number;
  answered: number;
  question_count: number;
};
type Page<T> = { results: T[]; count: number; page: number; pages: number };
type Monitor = Page<MonitoredAttempt> & {
  exam: { id: number; title: string };
  server_time: string;
  summary: {
    total: number;
    in_progress: number;
    pending_review: number;
    graded: number;
    recent: number;
  };
};
type Extension = {
  id: string;
  minutes: number;
  reason: string;
  actor: string;
  created_at: string;
  previous_deadline: string;
  new_deadline: string;
};
type Grant = { request_id: string; minutes: number; reason: string };

function ExtensionDialog({
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
  const storageKey = `training-extension:${userId}:${attempt.id}`;
  const [pending, setPending] = useState<Grant | null>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      return value &&
        typeof value.request_id === "string" &&
        Number.isInteger(value.minutes) &&
        typeof value.reason === "string"
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const [minutes, setMinutes] = useState(pending?.minutes || 10),
    [reason, setReason] = useState(pending?.reason || ""),
    [history, setHistory] = useState<Page<Extension> | null>(null),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [historyError, setHistoryError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<Extension | null>(null);
  const endpoint = `attempts/${attempt.id}/extensions/`;
  const date = (value: string) => new Date(value).toLocaleString(locale);
  useEffect(() => {
    let alive = true;
    api<Page<Extension>>(`${endpoint}?page=${page}&page_size=10`)
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
  async function grant(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const request = pending || {
        request_id: crypto.randomUUID(),
        minutes,
        reason: reason.trim(),
      };
      // Persist before sending. Closing or reloading after a lost response must
      // reuse the same key, never silently grant the time a second time.
      sessionStorage.setItem(storageKey, JSON.stringify(request));
      setPending(request);
      const result = await api<Extension>(endpoint, "POST", request, 20000);
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
    <Modal title={t("Time extensions")} onClose={onClose}>
      <div className="modal-form">
        <h3>{attempt.person}</h3>
        <p>
          {t("Attempt {number}", { number: attempt.number })} · {t("Deadline")}:{" "}
          {date(saved?.new_deadline || attempt.deadline)}
        </p>
        <ErrorBox message={error} />
        {saved ? (
          <p className="notice" role="status">
            {t("Extra time granted: {minutes} minutes.", {
              minutes: saved.minutes,
            })}
          </p>
        ) : (
          (attempt.status === "in_progress" || pending) && (
            <form onSubmit={grant} className="extension-form">
              <p className="notice">
                {t(
                  "Grant 1–240 minutes per request, up to 1,440 extra minutes per attempt. Expired and submitted attempts stay closed. Invitation validity is unchanged.",
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
                {t("Reason for extension")}
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
                    ? t("Retry extension request")
                    : t("Grant extra time")}
              </button>
            </form>
          )
        )}
        <h3>{t("Extension history")}</h3>
        <ErrorBox message={historyError} />
        {!history && !historyError && <Spinner />}
        {history && !history.count && (
          <p>{t("No time extensions have been granted.")}</p>
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
              {date(item.previous_deadline)} → {date(item.new_deadline)}
            </small>
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
    </Modal>
  );
}

export default function ExamMonitor({
  id,
  userId,
  onClose,
}: {
  id: number;
  userId: number;
  onClose: () => void;
}) {
  const locale = useLocale();
  const [data, setData] = useState<Monitor | null>(null),
    [error, setError] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [number, setNumber] = useState(""),
    [attemptNumber, setAttemptNumber] = useState(""),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    [extension, setExtension] = useState<MonitoredAttempt | null>(null),
    [reopening, setReopening] = useState<MonitoredAttempt | null>(null),
    [inspection, setInspection] = useState<string | null>(null),
    [importing, setImporting] = useState(false),
    [review, setReview] = useState<string | null>(null),
    [paused, setPaused] = useState(document.hidden);
  const refresh = () => setVersion((v) => v + 1);
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : t("Not yet reported");
  useEffect(() => {
    let alive = true,
      flight = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (!alive || flight) return;
      clearTimeout(timer);
      flight = true;
      setRefreshing(true);
      try {
        const params = new URLSearchParams({
          search: query,
          status,
          page: String(page),
          page_size: "25",
        });
        if (attemptNumber) params.set("number", attemptNumber);
        const result = await api<Monitor>(
          `exams/${id}/monitor/?${params}`,
          "GET",
          undefined,
          15000,
        );
        if (alive) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        flight = false;
        if (alive) {
          setRefreshing(false);
          if (!document.hidden) timer = setTimeout(load, 5000);
        }
      }
    }
    function visibility() {
      setPaused(document.hidden);
      clearTimeout(timer);
      if (!document.hidden) void load();
    }
    document.addEventListener("visibilitychange", visibility);
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [id, query, status, attemptNumber, page, version]);
  return (
    <Modal title={t("Live exam monitor")} onClose={onClose} wide>
      <div className="modal-form exam-monitor">
        <div className="monitor-heading">
          <div>
            <h3>{data?.exam.title}</h3>
            <p>
              <Activity size={14} aria-hidden="true" />{" "}
              {paused
                ? t("Updates paused while this tab is hidden.")
                : t("Updates every 5 seconds.")}
            </p>
            {data && (
              <small>
                {t("Last updated")}: {date(data.server_time)}
              </small>
            )}
          </div>
          <button className="btn" disabled={refreshing} onClick={refresh}>
            <RefreshCw size={15} />
            {t("Refresh")}
          </button>
        </div>
        <p className="notice">
          {t(
            "Recent contact means the participant connected within 60 seconds. It does not prove attention or continuous connectivity. Progress counts saved answers only.",
          )}
        </p>
        <button className="btn" onClick={() => setImporting(true)}>
          {t("Import marks")}
        </button>
        <form
          className="monitor-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
            setAttemptNumber(number);
            setPage(1);
            refresh();
          }}
        >
          <label>
            {t("Search participants")}
            <input
              type="search"
              value={search}
              maxLength={200}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            {t("Attempt number")}
            <input
              type="number"
              min="1"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </label>
          <label>
            {t("Status")}
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("All statuses")}</option>
              {Object.entries(statusLabel()).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            {t("Apply filters")}
          </button>
        </form>
        <ErrorBox
          message={
            error
              ? `${t("Monitor update failed. Displayed data may be out of date.")} ${error}`
              : ""
          }
        />
        {!data && !error && <Spinner />}
        {data && (
          <>
            <div className="monitor-stats" aria-label={t("Attempt summary")}>
              {(
                [
                  ["Total attempts", data.summary.total],
                  ["In progress", data.summary.in_progress],
                  ["Recent contact", data.summary.recent],
                  ["Awaiting manual review", data.summary.pending_review],
                  ["Graded", data.summary.graded],
                ] as const
              ).map(([label, count]) => (
                <div key={label}>
                  <strong>{count}</strong>
                  <span>{t(label)}</span>
                </div>
              ))}
            </div>
            <p className="muted">
              {t(
                "Summary follows participant and attempt-number filters, across all statuses.",
              )}
            </p>
            {!data.count && (
              <Empty
                title={t("No matching attempts")}

              />
            )}
            <div className="monitor-attempts">
              {data.results.map((attempt) => (
                <article
                  className="monitor-attempt"
                  key={attempt.id}
                  aria-label={t("{person}, attempt {number}", {
                    person: attempt.person,
                    number: attempt.number,
                  })}
                >
                  <header>
                    <div>
                      <strong>{attempt.person}</strong>
                      <small>
                        {attempt.key}
                        {attempt.department ? ` · ${attempt.department}` : ""}
                      </small>
                    </div>
                    <Badge>{statusLabel()[attempt.status]}</Badge>
                  </header>
                  <div className="monitor-details">
                    <div>
                      <small>{t("Attempt number")}</small>
                      <strong>{attempt.number}</strong>
                    </div>
                    <div>
                      <small>{t("Saved progress")}</small>
                      <strong>
                        {t("{answered} / {total} answered", {
                          answered: attempt.answered,
                          total: attempt.question_count,
                        })}
                      </strong>
                      <progress
                        max={attempt.question_count || 1}
                        value={attempt.answered}
                        aria-label={t("Saved progress")}
                      />
                    </div>
                    <div>
                      <small>{t("Deadline")}</small>
                      <strong>{date(attempt.deadline)}</strong>
                      {attempt.extra_time_minutes > 0 && (
                        <small>
                          {t("Extra time granted: {minutes} minutes.", {
                            minutes: attempt.extra_time_minutes,
                          })}
                        </small>
                      )}
                    </div>
                    <div>
                      <small>{t("Last contact")}</small>
                      <strong>{date(attempt.last_seen_at)}</strong>
                      {attempt.status === "in_progress" && (
                        <span
                          className={`monitor-contact ${attempt.recent ? "recent" : ""}`}
                        >
                          {attempt.recent
                            ? t("Recent contact")
                            : t("No recent contact")}
                        </span>
                      )}
                    </div>
                    <div>
                      <small>{t("Last answer save")}</small>
                      <strong>{date(attempt.last_saved_at)}</strong>
                    </div>
                  </div>
                  <footer>
                    <button
                      className="btn"
                      onClick={() => setInspection(attempt.id)}
                    >
                      {t("Inspect saved answers")}
                    </button>
                    <button
                      className="btn"
                      onClick={() => setExtension(attempt)}
                    >
                      <Clock3 size={16} />
                      {t("Time extensions")}
                    </button>
                    {attempt.status !== "in_progress" && (
                      <button
                        className="btn"
                        onClick={() => setReview(attempt.id)}
                      >
                        {t("Review submission")}
                      </button>
                    )}
                    {(attempt.status !== "in_progress" ||
                      attempt.reopen_count > 0) && (
                      <button
                        className="btn"
                        onClick={() => setReopening(attempt)}
                      >
                        {t("Reopen & history")}
                      </button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
            <div className="pagination">
              <button
                className="btn"
                disabled={data.page <= 1 || refreshing}
                onClick={() => setPage(data.page - 1)}
              >
                {t("Previous")}
              </button>
              <span>
                {t("Page {page} of {pages}", {
                  page: data.page,
                  pages: data.pages,
                })}{" "}
                · {data.count}
              </span>
              <button
                className="btn"
                disabled={data.page >= data.pages || refreshing}
                onClick={() => setPage(data.page + 1)}
              >
                {t("Next")}
              </button>
            </div>
          </>
        )}
      </div>
      {extension && (
        <ExtensionDialog
          attempt={extension}
          userId={userId}
          onClose={() => setExtension(null)}
          onSaved={refresh}
        />
      )}
      {review && (
        <ReviewModal
          id={review}
          onClose={() => setReview(null)}
          onSaved={refresh}
        />
      )}
      {inspection && (
        <AttemptEvidence
          key={inspection}
          id={inspection}
          onClose={() => setInspection(null)}
        />
      )}
      {importing && (
        <MarksImport
          examId={id}
          userId={userId}
          filters={{ search: query, number: attemptNumber, status }}
          onClose={() => setImporting(false)}
          onSaved={refresh}
        />
      )}
      {reopening && (
        <AttemptReopening
          key={reopening.id}
          attempt={reopening}
          userId={userId}
          onClose={() => setReopening(null)}
          onSaved={refresh}
        />
      )}
    </Modal>
  );
}
