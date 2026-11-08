import Readiness from "./Readiness";
import { answerText, acceptedAnswerText } from "./questionTypes";
import InvitationBatch from "./InvitationBatch";
import { PeopleImport, PersonEditor } from "./PeopleTools";
import { t, useLocale } from "./i18n";
import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Download,
  Link2,
  Copy,
  Check,
  Ban,
  Users as UsersIcon,
  ShieldCheck,
  Mail,
  KeyRound,
  FileCheck2,
  ExternalLink,
} from "lucide-react";
import { api } from "./api";
import type { User, Exam, Invitation, ResultsPage, Attempt } from "./types";
import {
  Modal,
  Badge,
  ErrorBox,
  Empty,
  Spinner,
  date,
  statusLabel,
} from "./ui";
export function Invitations({ exams }: { exams: Exam[] }) {
  const locale = useLocale();
  const [batch, setBatch] = useState(false);
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [state, setState] = useState(""),
    [filterExam, setFilterExam] = useState("");
  const [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [count, setCount] = useState(0),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const states: Record<Invitation["state"], string> = {
    active: t("Active"),
    resume_only: t("Resume only"),
    exhausted: t("No attempts remaining"),
    revoked: t("Disabled"),
    expired: t("Expired"),
    blocked: t("Account disabled"),
  };
  const [rows, setRows] = useState<Invitation[]>([]),
    [open, setOpen] = useState(false),
    [exam, setExam] = useState(
      exams.find((e) => e.can_manage)?.id.toString() || "",
    ),
    [key, setKey] = useState(""),
    [limit, setLimit] = useState(1),
    [days, setDays] = useState(7),
    [verifyEmail, setVerifyEmail] = useState(true),
    [recipientEmail, setRecipientEmail] = useState(""),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const load = () => setRefresh((value) => value + 1);
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  const params = new URLSearchParams({
    page: String(page),
    page_size: "25",
    search: query,
    status: state,
  });
  if (filterExam) params.set("exam", filterExam);
  const parameters = params.toString();
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<{ results: Invitation[]; count: number; page: number; pages: number }>(
      "invitations/?" + parameters,
    )
      .then((data) => {
        if (alive) {
          setRows(data.results);
          setCount(data.count);
          setPages(data.pages);
          setPage(data.page);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [parameters, locale, refresh]);
  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const row = await api<Invitation>("invitations/issue/", "POST", {
        exam: Number(exam),
        key,
        max_attempts: limit,
        days,
        require_email_verification: verifyEmail,
        verification_email: recipientEmail,
      });
      setUrl(row.url!);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(`invitations/${id}/revoke/`, "POST", {});
      setRevoking(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError(t("Clipboard unavailable. Select and copy the link manually."));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("GUEST ACCESS")}</div>
          <h1>{t("Guest exam invitations")}</h1>
          <p>
            {t(
              "A personal link for each participant, including people without accounts.",
            )}
          </p>
        </div>
        <div className="heading-actions">
          <button className="btn" onClick={() => setBatch(true)}>
            <UsersIcon size={17} />
            {t("Create invitation batch")}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              setOpen(true);
              setUrl("");
              setCopied(false);
              setError("");
            }}
          >
            <Plus size={17} />
            {t("Create personal link") + " "}
          </button>
        </div>
      </div>
      <div className="info-banner">
        <ShieldCheck size={25} />
        <div>
          <strong>{t("Every invitation has a clear scope.")}</strong>
          <p>
            {t(
              "Bind each participant to an email or account and set an expiry and attempt limit. Multiple links share the same participant's total budget.",
            ) + " "}
          </p>
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="report-filters invitation-filters">
        <label>
          {t("Search invitations")}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Search participant or exam")}
          />
        </label>
        <label>
          {t("Filter by exam")}
          <select
            value={filterExam}
            onChange={(e) => {
              setFilterExam(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("All exams")}</option>
            {exams
              .filter((e) => e.can_manage)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t("Invitation status")}
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("All statuses")}</option>
            {Object.entries(states).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p role="status">{t("{count} matching invitations", { count })}</p>
      <div className="panel table-panel" aria-busy={loading}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("Participant")}</th>
                <th>{t("Exam")}</th>
                <th>{t("Link attempts used")}</th>
                <th>{t("Expires")}</th>
                <th>{t("Status")}</th>
                <th>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="cell-person">
                      <div className="avatar soft">
                        <Mail size={16} />
                      </div>
                      <strong>
                        {row.identity_key.replace(/^(email|account):/, "")}
                      </strong>
                    </div>
                  </td>
                  <td>{row.exam_title}</td>
                  <td>
                    {row.used} / {row.max_attempts}
                    <small className="cell-note">
                      {t("{count} new attempts available", {
                        count: row.remaining_new_attempts,
                      })}
                    </small>
                  </td>
                  <td>{date(row.expires_at)}</td>
                  <td>
                    <Badge
                      tone={
                        row.state === "active" || row.state === "resume_only"
                          ? "teal"
                          : "neutral"
                      }
                    >
                      {states[row.state]}
                    </Badge>
                    {row.require_email_verification && (
                      <small className="cell-note">
                        {t("Email verification required")}
                      </small>
                    )}
                  </td>
                  <td>
                    <button
                      className="text-btn danger-text"
                      disabled={row.revoked}
                      onClick={() => {
                        setError("");
                        setRevoking(row);
                      }}
                    >
                      <Ban size={14} />
                      {t("Disable") + " "}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <Spinner />}
        {!loading && !rows.length && (
          <Empty
            title={
              query || state || filterExam
                ? t("No matching invitations")
                : t("No invitations yet")
            }
            description={t(
              query || state || filterExam
                ? "Try another search or change the filters."
                : "Create a link and share it with the intended participant.",
            )}
          />
        )}
      </div>
      <div className="pagination">
        <button
          className="btn"
          disabled={loading || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          {t("Previous page")}
        </button>
        <span>{t("Page {page} of {pages}", { page, pages })}</span>
        <button
          className="btn"
          disabled={loading || page >= pages}
          onClick={() => setPage(page + 1)}
        >
          {t("Next page")}
        </button>
      </div>
      {batch && (
        <InvitationBatch
          exams={exams}
          onClose={() => setBatch(false)}
          onSaved={load}
        />
      )}
      {revoking && (
        <Modal
          title={t("Disable invitation?")}
          onClose={() => {
            if (!busy) setRevoking(null);
          }}
        >
          <div className="modal-form">
            <p>
              {revoking.identity_key.replace(/^(email|account):/, "")} ·{" "}
              {revoking.exam_title}
            </p>
            <p>
              {t(
                "This link will stop working immediately, including for an active guest attempt. Saved answers and shared attempt usage are retained.",
              )}
            </p>
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button
                className="btn"
                disabled={busy}
                onClick={() => setRevoking(null)}
              >
                {t("Keep invitation")}
              </button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => revoke(revoking.id)}
              >
                {t("Disable invitation")}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {open && (
        <Modal
          title={url ? t("Personal link created") : t("Create exam invitation")}
          onClose={() => setOpen(false)}
        >
          <form className="modal-form" onSubmit={issue}>
            {url ? (
              <>
                <div className="success-icon">
                  <Check size={28} />
                </div>
                <p>
                  {t(
                    "Copy and share with the intended participant. For security, this full link is shown only once.",
                  ) + " "}
                </p>
                <label>
                  {t("Personal exam link") + " "}
                  <input
                    readOnly
                    value={url}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <button
                  type="button"
                  className="btn primary full"
                  onClick={copy}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                  {copied ? t("Link copied") : t("Copy link")}
                </button>
                <p className="notice">
                  {t(
                    "This link is an access credential. Do not post it publicly.",
                  )}
                </p>
              </>
            ) : (
              <>
                <label>
                  {t("Select exam") + " "}
                  <select
                    required
                    value={exam}
                    onChange={(e) => setExam(e.target.value)}
                  >
                    <option value="">{t("Please select")}</option>
                    {exams
                      .filter((e) => e.can_manage)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {t("Participant email, username or employee ID") + " "}
                  <input
                    required
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="person@example.com"
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={verifyEmail}
                    onChange={(e) => setVerifyEmail(e.target.checked)}
                  />
                  {t("Require recipient email verification")}
                </label>
                {verifyEmail && (
                  <label>
                    {t("Verification email (optional override)")}
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="person@example.com"
                    />
                    <span className="field-hint">
                      {t(
                        "Leave blank to use the invited email or the account's email. The recipient must enter a code before accessing the exam.",
                      )}
                    </span>
                  </label>
                )}
                {!verifyEmail && (
                  <p className="notice">
                    {t(
                      "Anyone holding this link can act as its named participant.",
                    )}
                  </p>
                )}
                <div className="form-grid">
                  <label>
                    {t("Maximum attempts with this link") + " "}
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    {t("Valid for (days)") + " "}
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                    />
                  </label>
                </div>
                <p className="notice">
                  {t(
                    "To increase the total attempt budget, use Exams & assessments \u2192 Individual attempt limits. Creating another link does not reset usage.",
                  ) + " "}
                </p>
                <div className="modal-footer">
                  <button className="btn primary" disabled={busy}>
                    {busy ? t("Creating\u2026") : t("Create personal link")}
                    <Link2 size={16} />
                  </button>
                </div>
              </>
            )}
            <ErrorBox message={error} />
          </form>
        </Modal>
      )}
    </>
  );
}
export function ReviewModal({
  id,
  preview = false,
  onClose,
  onSaved,
}: {
  id: string;
  preview?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  useLocale();
  const [attempt, setAttempt] = useState<Attempt | null>(null),
    [marks, setMarks] = useState<Attempt["manual_grades"]>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Attempt>(`${preview ? "previews" : "results"}/${id}/review/`)
      .then((a) => {
        setAttempt(a);
        setMarks(a.manual_grades);
      })
      .catch((e) => setError(e.message));
  }, [id, preview]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`${preview ? "previews" : "results"}/${id}/review/`, "POST", {
        grades: marks,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={preview ? t("Inspect test result") : t("Review attempt")}
      onClose={onClose}
      wide
    >
      <form className="modal-form" onSubmit={save}>
        {preview && (
          <p className="notice exam-policy-notice">
            {t(
              "Test grading affects this preview only. Participant records remain unchanged.",
            )}
          </p>
        )}
        <ErrorBox message={error} />
        {attempt ? (
          <>
            <h3>
              {attempt.title} · {attempt.person}
            </h3>
            {attempt.questions.map((q, i) => (
              <div className="review-question" key={q.id}>
                <div>
                  <Badge tone="neutral">
                    {t("Question") + " "}
                    {i + 1} · {q.points}
                    {" " + t("points") + " "}
                  </Badge>
                  <h3>{q.description}</h3>
                  <p className="review-answer">
                    {answerText(q, attempt.answers[String(q.id)]) ||
                      t("(Unanswered)")}
                  </p>
                </div>
                {q.type === "essay" ? (
                  <div className="form-grid">
                    <label>
                      {t("Score") + " "}
                      <input
                        type="number"
                        min={0}
                        max={q.points}
                        step={0.5}
                        required
                        value={marks[String(q.id)]?.points ?? ""}
                        onChange={(e) =>
                          setMarks({
                            ...marks,
                            [String(q.id)]: {
                              ...marks[String(q.id)],
                              points: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      {t("Feedback") + " "}
                      <input
                        value={marks[String(q.id)]?.feedback || ""}
                        onChange={(e) =>
                          setMarks({
                            ...marks,
                            [String(q.id)]: {
                              points: marks[String(q.id)]?.points ?? 0,
                              feedback: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <div>
                    <small className="muted">
                      {t("Auto-graded \u00B7 Accepted answer:")}
                    </small>
                    <p className="review-answer accepted-answer">
                      {acceptedAnswerText(q)}
                    </p>
                  </div>
                )}
              </div>
            ))}
            <div className="modal-footer">
              <button type="button" className="btn" onClick={onClose}>
                {t("Close") + " "}
              </button>
              {attempt.questions.some((q) => q.type === "essay") && (
                <button className="btn primary" disabled={busy}>
                  {busy ? t("Saving\u2026") : t("Save grades & feedback")}
                </button>
              )}
            </div>
          </>
        ) : (
          !error && <Spinner />
        )}
      </form>
    </Modal>
  );
}
export function Results({
  user,
  exams,
  refreshKey,
  onSaved,
  go,
}: {
  user: User;
  exams: Exam[];
  refreshKey: number;
  onSaved: () => void;
  go: (p: string) => void;
}) {
  const locale = useLocale();
  const [data, setData] = useState<ResultsPage | null>(null),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [exam, setExam] = useState(""),
    [outcome, setOutcome] = useState(""),
    [days, setDays] = useState("all"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [review, setReview] = useState(""),
    [page, setPage] = useState(1);
  useEffect(() => {
    if (search === query) return;
    const timer = window.setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, query]);
  const params = new URLSearchParams({
    search: query,
    status,
    outcome,
    days,
    page: String(page),
    page_size: "25",
  });
  if (exam) params.set("exam", exam);
  const parameters = params.toString();
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api<ResultsPage>("results/?" + parameters)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, parameters, locale]);
  const rows = data?.results || [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("PERFORMANCE & INSIGHTS")}</div>
          <h1>{t("Results & reviews")}</h1>
          <p>{t("Use each assessment to guide the next improvement.")}</p>
        </div>
        <a className="btn" href={"/api/results/export/?" + parameters}>
          <Download size={17} />
          {t("Export results CSV") + " "}
        </a>
      </div>
      <div className="summary-strip">
        <div>
          <FileCheck2 size={23} />
          <strong>{data?.count ?? "—"}</strong>
          <span>{t("attempt records")}</span>
        </div>
        <div>
          <Check size={23} />
          <strong>{data?.summary.average_score ?? "—"}</strong>
          <span>{t("Average score")}</span>
        </div>
        <div>
          <ClockIcon />
          <strong>{data?.summary.pending ?? "—"}</strong>
          <span>{t("awaiting review")}</span>
        </div>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {[
            ["", t("All records")],
            ["pending_review", t("Awaiting manual review")],
            ["graded", t("Graded")],
            ["in_progress", t("In progress")],
          ].map(([value, label]) => (
            <button
              className={status === value ? "active" : ""}
              key={value}
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            placeholder={t("Search people, exams or departments\u2026")}
            aria-label={t("Search results")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <div className="report-filters">
        <label>
          {t("Exam")}
          <select
            aria-label={t("Filter by exam")}
            value={exam}
            onChange={(e) => {
              setExam(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("All exams")}</option>
            {exams.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Outcome")}
          <select
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("All outcomes")}</option>
            <option value="passed">{t("Passed")}</option>
            <option value="not_passed">{t("Not passed")}</option>
          </select>
        </label>
        <label>
          {t("Reporting period")}
          <select
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{t("All time")}</option>
            {[7, 30, 90, 365].map((value) => (
              <option key={value} value={value}>
                {t("Last {days} days", { days: value })}
              </option>
            ))}
          </select>
        </label>
        {user.role !== "learner" && (
          <button
            className="btn"
            onClick={() => go("/insights" + (exam ? "?exam=" + exam : ""))}
          >
            {t("Assessment insights")}
          </button>
        )}
      </div>
      <p className="notice">
        {t(
          "Totals and CSV exports cover every matching attempt. Date filters use submission time, or start time for active attempts.",
        )}
      </p>
      <ErrorBox message={error} />
      <div className="panel table-panel" aria-busy={loading}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("Participant")}</th>
                <th>{t("Exam title")}</th>
                <th>{t("Attempt number")}</th>
                <th>{t("Result")}</th>
                <th>{t("Status")}</th>
                <th>{t("Submitted at")}</th>
                <th>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="cell-person">
                      <div className="avatar soft">{r.person.slice(0, 1)}</div>
                      <div>
                        <strong>{r.person}</strong>
                        <small>
                          {r.department || t("No department assigned")}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{r.exam}</td>
                  <td>{t("Attempt {number}", { number: r.number })}</td>
                  <td>
                    <strong className={r.passed ? "teal-text" : ""}>
                      {r.score === null ? "—" : r.score}
                    </strong>
                    {r.score !== null && (
                      <small className="muted"> / 100</small>
                    )}
                  </td>
                  <td>
                    <Badge
                      tone={
                        r.status === "pending_review"
                          ? "amber"
                          : r.passed
                            ? "teal"
                            : r.status === "graded"
                              ? "red"
                              : "blue"
                      }
                    >
                      {r.status === "graded"
                        ? r.passed
                          ? t("Passed")
                          : t("Not passed")
                        : statusLabel()[r.status]}
                    </Badge>
                  </td>
                  <td>{date(r.submitted_at)}</td>
                  <td>
                    {user.role !== "learner" && r.status !== "in_progress" ? (
                      <button
                        className="text-btn"
                        onClick={() => setReview(r.id)}
                      >
                        {r.status === "pending_review"
                          ? t("Grade attempt")
                          : t("View attempt")}
                      </button>
                    ) : user.role === "learner" ? (
                      <button
                        className="text-btn"
                        onClick={() => go("/attempt/" + r.id)}
                      >
                        {t("View") + " "}
                      </button>
                    ) : (
                      <span className="muted">{t("Not yet submitted")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !rows.length && (
          <Empty title={t("No matching assessment records")} />
        )}
        <div className="table-footer">
          <span>
            {t("Total") + " "}
            {data?.count ?? 0}
            {" " + t("records") + " "}
            {loading && t("Loading…")}
          </span>
          <div>
            <button
              className="btn small"
              disabled={loading || !data || data.page <= 1}
              onClick={() => setPage((data?.page || 1) - 1)}
            >
              {t("Previous page") + " "}
            </button>
            <span>
              {data?.page || 1} / {data?.pages || 1}
            </span>
            <button
              className="btn small"
              disabled={loading || !data || data.page >= data.pages}
              onClick={() => setPage((data?.page || 1) + 1)}
            >
              {t("Next page") + " "}
            </button>
          </div>
        </div>
      </div>
      {review && (
        <ReviewModal
          id={review}
          onClose={() => setReview("")}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
function ClockIcon() {
  useLocale();
  return <FileCheck2 size={23} />;
}
export function People() {
  useLocale();
  const [users, setUsers] = useState<User[]>([]),
    [editingPerson, setEditingPerson] = useState<User | null>(null),
    [importing, setImporting] = useState(false),
    [search, setSearch] = useState(""),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<User[]>("users/")
      .then(setUsers)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await api("users/", "POST", Object.fromEntries(form));
      setOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(user: User) {
    try {
      await api(`users/${user.id}/`, "PATCH", { is_active: !user.is_active });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("PEOPLE DIRECTORY")}</div>
          <h1>{t("People & permissions")}</h1>
          <p>
            {t("Connect employees and partners in a shared learning space.")}
          </p>
        </div>
        <button className="btn" onClick={() => setImporting(true)}>
          {t("Import participants")}
        </button>
        <button
          className="btn primary"
          onClick={() => {
            setOpen(true);
            setError("");
          }}
        >
          <Plus size={17} />
          {t("Add person") + " "}
        </button>
      </div>
      <div className="toolbar">
        <h2>
          {t("All people") + " "}
          <span className="count">{users.length}</span>
        </h2>
        <div className="search-field">
          <Search size={16} />
          <input
            placeholder={t("Search names, email or departments\u2026")}
            aria-label={t("Search people")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("Person")}</th>
                <th>{t("Employee ID")}</th>
                <th>{t("Department")}</th>
                <th>{t("Employment type")}</th>
                <th>{t("Role")}</th>
                <th>{t("Status")}</th>
                <th>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users
                .filter((u) =>
                  (u.display_name + u.email + u.department).includes(search),
                )
                .map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="cell-person">
                        <div className="avatar soft">
                          {u.display_name?.slice(0, 1) || "U"}
                        </div>
                        <div>
                          <strong>{u.display_name || u.username}</strong>
                          <small>{u.email || u.username}</small>
                        </div>
                      </div>
                    </td>
                    <td>{u.employee_id || "—"}</td>
                    <td>{u.department || "—"}</td>
                    <td>
                      <Badge
                        tone={u.employment === "employee" ? "blue" : "purple"}
                      >
                        {u.employment === "employee"
                          ? t("Employees")
                          : t("Contractors")}
                      </Badge>
                    </td>
                    <td>
                      {
                        {
                          admin: t("Administrator"),
                          instructor: t("Instructor"),
                          learner: t("Learner"),
                        }[u.role]
                      }
                    </td>
                    <td>
                      <Badge tone={u.is_active ? "teal" : "neutral"}>
                        {u.is_active ? t("Enable") : t("Disable")}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="text-btn"
                        onClick={() => setEditingPerson(u)}
                      >
                        {t("Edit person")}
                      </button>
                      <button className="text-btn" onClick={() => toggle(u)}>
                        {u.is_active ? t("Disable") : t("Enable")}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {editingPerson && (
        <PersonEditor
          user={editingPerson}
          onClose={() => setEditingPerson(null)}
          onSaved={load}
        />
      )}
      {importing && (
        <PeopleImport onClose={() => setImporting(false)} onSaved={load} />
      )}
      {open && (
        <Modal
          title={t("Add training participant")}
          onClose={() => setOpen(false)}
        >
          <form className="modal-form" onSubmit={create}>
            <div className="form-grid">
              <label>
                {t("Display name") + " "}
                <input name="display_name" required maxLength={100} />
              </label>
              <label>
                {t("Username") + " "}
                <input name="username" required maxLength={100} />
              </label>
              <label className="span-2">
                {t("Email (optional, for code sign-in)") + " "}
                <input name="email" type="email" />
              </label>
              <label>
                {t("Employee ID (optional)") + " "}
                <input name="employee_id" />
              </label>
              <label>
                {t("Department") + " "}
                <input name="department" />
              </label>
              <label>
                {t("Employment type") + " "}
                <select name="employment">
                  <option value="employee">{t("Employees")}</option>
                  <option value="contractor">{t("Contractors")}</option>
                </select>
              </label>
              <label>
                {t("System role") + " "}
                <select name="role">
                  <option value="learner">{t("Learner")}</option>
                  <option value="instructor">{t("Instructor")}</option>
                  <option value="admin">{t("Administrator")}</option>
                </select>
              </label>
              <label className="span-2">
                {t("Initial password (optional, at least 12 characters)") + " "}
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                />
              </label>
            </div>
            <p className="notice">
              {t(
                "Accounts without passwords can sign in with an email code if an email is configured. Entra account linking is available in Django administration.",
              ) + " "}
            </p>
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="btn primary" disabled={busy}>
                {busy ? t("Creating\u2026") : t("Create person")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Settings({ entra }: { entra: boolean }) {
  useLocale();
  const [rows, setRows] = useState<
      {
        id: number;
        actor__display_name: string;
        action: string;
        target: string;
        created_at: string;
      }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    api<typeof rows>("audit/")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("WORKSPACE SETTINGS")}</div>
          <h1>{t("Settings & audit")}</h1>
          <p>{t("Review authentication settings and system activity.")}</p>
        </div>
        <a className="btn" href="/admin/" target="_blank" rel="noreferrer">
          {t("Advanced administration") + " "}
          <ExternalLink size={16} />
        </a>
      </div>
      <div className="settings-grid">
        {[
          [
            ShieldCheck,
            "Microsoft Entra ID",
            entra
              ? t("Enterprise SSO configured")
              : t("Awaiting Tenant ID, Client ID and server-side secret"),
          ],
          [
            Mail,
            t("Email verification code"),
            t(
              "One-time sign-in codes for accounts created by an administrator",
            ),
          ],
          [
            KeyRound,
            t("Username / employee ID"),
            t("Sign in with a username, email or employee ID and password"),
          ],
        ].map(([Icon, title, body]) => {
          const C = Icon as typeof ShieldCheck;
          return (
            <section className="panel setting-card" key={String(title)}>
              <C size={26} />
              <h2>{String(title)}</h2>
              <p>{String(body)}</p>
            </section>
          );
        })}
      </div>
      <Readiness />
      <div className="toolbar">
        <h2>{t("Recent activity")}</h2>
        <Badge tone="neutral">{t("Latest 200 entries")}</Badge>
      </div>
      <ErrorBox message={error} />
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("Actor")}</th>
                <th>{t("Action")}</th>
                <th>{t("Target ID")}</th>
                <th>{t("Time")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.actor__display_name || t("Guest / system")}</td>
                  <td>
                    <code>{r.action}</code>
                  </td>
                  <td className="muted truncate">{r.target}</td>
                  <td>{date(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty title={t("No activity yet")} />}
      </div>
    </>
  );
}
