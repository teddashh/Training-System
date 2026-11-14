import OrganizationSettings from "./OrganizationSettings";
import { roleInfo, roleLabel, rolesFor } from "./access";
import { formatDateTime } from "./datetime";
import { GradingGuide } from "./GradingGuide";
import { QuestionContent } from "./QuestionFigure";
import { AddToGroup, GroupFilter, GroupsView } from "./Groups";
import { DirectorySync, PeoplePagination, usePeoplePage } from "./PeopleDirectory";
import { appPath } from "./paths";
import Readiness from "./Readiness";
import Activity, { activityLabel, type ActivityEntry } from "./Activity";
import { answerText, acceptedAnswerText } from "./questionTypes";
import InvitationBatch from "./InvitationBatch";
import { PeopleImport, PersonEditor } from "./PeopleTools";
import { getLocale, t, useLocale } from "./i18n";
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
  FileCheck2,
  ExternalLink,
} from "lucide-react";
import { api } from "./api";
import { signIn } from "./brand";
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

          <h1>{t("Guest exam invitations")}</h1>

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
                  <td>{row.expires_at ? formatDateTime(row.expires_at, getLocale()) : "—"}</td>
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
                    "To increase the total attempt budget, use Exams \u2192 Individual attempt limits. Creating another link does not reset usage.",
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
    let alive = true;
    api<Attempt>(`${preview ? "previews" : "results"}/${id}/review/`)
      .then((a) => {
        if (!alive) return;
        setAttempt(a);
        setMarks(
          Object.fromEntries(
            a.questions
              .filter(
                (q) => q.type === "essay" && a.manual_grades[String(q.id)],
              )
              .map((q) => [String(q.id), a.manual_grades[String(q.id)]]),
          ),
        );
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => { alive = false; };
  }, [id, preview]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`${preview ? "previews" : "results"}/${id}/review/`, "POST", {
        grades: marks,
        answer_revision: attempt?.answer_revision,
        grading_revision: attempt?.grading_revision,
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
                  <QuestionContent question={q} />
                  <GradingGuide question={q} />
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
                              points: marks[String(q.id)]?.points ?? null,
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
                    {attempt.manual_grades[String(q.id)] && (
                      <div className="instructor-feedback">
                        <strong>
                          {t("Imported review")}
                          {attempt.manual_grades[String(q.id)].points !==
                            null &&
                            ` · ${attempt.manual_grades[String(q.id)].points} / ${q.points}`}
                        </strong>
                        <p className="review-answer">
                          {attempt.manual_grades[String(q.id)].feedback}
                        </p>
                      </div>
                    )}
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
  const [group, setGroup] = useState<number | null>(null);
  const [data, setData] = useState<ResultsPage | null>(null),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(new URLSearchParams(window.location.search).get("status") === "pending_review" ? "pending_review" : ""),
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
  if (group) params.set("group", String(group));
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

          <h1>{t("Results")}</h1>

        </div>
        {user.access.results !== "none" && <a className="btn" href={appPath("/api/results/export/?" + parameters)}>
          <Download size={17} />
          {t("Export results CSV") + " "}
        </a>}
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
        {user.access.people && <GroupFilter value={group} onChange={id => { setGroup(id); setPage(1); }} />}
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
        {user.access.results !== "none" && (
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
                    {r.can_view_results && r.status !== "in_progress" ? (
                      <button
                        className="text-btn"
                        onClick={() => setReview(r.id)}
                      >
                        {r.status === "pending_review"
                          ? t("Grade attempt")
                          : t("View attempt")}
                      </button>
                    ) : !r.can_view_results ? (
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
export function People({ currentUser }: { currentUser: User }) {
  useLocale();
  const [view, setView] = useState('people');
  return <><div className="tabs people-views" aria-label={t('People views')}>
    <button className={view === 'people' ? 'active' : ''} onClick={() => setView('people')}>{t('People')}</button>
    <button className={view === 'groups' ? 'active' : ''} onClick={() => setView('groups')}>{t('Groups')}</button>
  </div>{view === 'people' ? <PeopleTable currentUser={currentUser} /> : <GroupsView />}</>;
}
function PeopleTable({ currentUser }: { currentUser: User }) {
  useLocale();
  const [editingPerson, setEditingPerson] = useState<User | null>(null),
    [importing, setImporting] = useState(false),
    [search, setSearch] = useState(""),
    [roleFilter, setRoleFilter] = useState("all"),
    [statusFilter, setStatusFilter] = useState("all"),
    [confirming, setConfirming] = useState<User | null>(null),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1), [signedIn, setSignedIn] = useState('all'), [department, setDepartment] = useState('');
  const [group, setGroup] = useState<number | null>(null), [selected, setSelected] = useState<number[]>([]), [addingToGroup, setAddingToGroup] = useState(false);
  const { data, loading, error: loadError, reload: load } = usePeoplePage('users/', {
    search, role: roleFilter, status: statusFilter, signed_in: signedIn, department, page, group: group || '',
  });
  const matching = data.results;
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
    setBusy(true);
    try {
      await api(`users/${user.id}/`, "PATCH", { is_active: !user.is_active });
      await load();
      setConfirming(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>

          <h1>{t("People")}</h1>

        </div>
        <div className="heading-actions">
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
      </div>
      <DirectorySync onApplied={load} />
      <div className="toolbar people-toolbar">
        <h2>
          {t("All people") + " "}
          <span className="count">{data.total}</span>
        </h2>
        <div className="search-field">
          <Search size={16} />
          <input
            placeholder={t("Search names, email or departments\u2026")}
            aria-label={t("Search people")}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <label className="people-filter">{t("Role")}
          <select aria-label={t("Filter people by role")} value={roleFilter} onChange={event => { setRoleFilter(event.target.value); setPage(1); }}>
            <option value="all">{t("All roles")}</option>
            {(Object.keys(roleInfo) as User["role"][]).map(key => <option key={key} value={key}>{roleLabel(key)}</option>)}
          </select>
        </label>
        <label className="people-filter">{t("Status")}
          <select aria-label={t("Filter people by status")} value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}>
            <option value="all">{t("All statuses")}</option>
            <option value="active">{t("Active")}</option>
            <option value="disabled">{t("Disabled")}</option>
          </select>
        </label>
        <label className="people-filter">{t('Sign-in')}
          <select value={signedIn} onChange={e => { setSignedIn(e.target.value); setPage(1); }}>
            <option value="all">{t('All people')}</option><option value="yes">{t('Signed in')}</option><option value="no">{t('Not signed in yet')}</option>
          </select>
        </label>
        <label className="people-filter">{t('Department')}
          <select value={department} onChange={e => { setDepartment(e.target.value); setPage(1); }}>
            <option value="">{t('All departments')}</option>{data.departments.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
      <div className="toolbar people-toolbar">
        <GroupFilter value={group} onChange={id => { setGroup(id); setPage(1); }} />
        <label className="checkbox"><input type="checkbox" disabled={loading || !matching.length || new Set([...selected, ...matching.map(u => u.id)]).size > 1000} checked={!!matching.length && matching.every(u => selected.includes(u.id))} onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...matching.map(u => u.id)])] : selected.filter(id => !matching.some(u => u.id === id)))} />{t('Select this page')}</label>
        <span>{t('{count} people selected', { count: selected.length })}</span>
        <button className="btn" disabled={!selected.length} onClick={() => setAddingToGroup(true)}>{t('Add to group')}</button>
        <button className="text-btn" disabled={!selected.length} onClick={() => setSelected([])}>{t('Clear selection')}</button>
      </div>
      {addingToGroup && <AddToGroup userIds={selected} onClose={() => setAddingToGroup(false)} onSaved={() => { setSelected([]); load(); }} />}
      <ErrorBox message={error || loadError} />
      {loading && <p role="status">{t("Loading…")}</p>}
      <div className="panel table-panel people-table">
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
              {matching
                .map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="cell-person">
                        <input type="checkbox" aria-label={t('Select {name}', { name: u.display_name || u.username })} disabled={loading || selected.length >= 1000 && !selected.includes(u.id)} checked={selected.includes(u.id)} onChange={e => setSelected(e.target.checked ? [...selected, u.id] : selected.filter(id => id !== u.id))} />
                        <div className="avatar soft">
                          {u.display_name?.slice(0, 1) || "U"}
                        </div>
                        <div>
                          <strong>{u.display_name || u.username}</strong>
                          <small>{u.email || u.username}</small>
                          <small>{u.directory_linked ? t("Microsoft sign-in linked") : t("Local account")}</small>
                          {!u.has_signed_in && <small>{t('Not signed in yet')}</small>}
                          {u.job_title && <small>{u.job_title}</small>}
                        </div>
                      </div>
                    </td>
                    <td data-label={t("Employee ID")}>{u.employee_id || "—"}</td>
                    <td data-label={t("Department")}>{u.department || "—"}</td>
                    <td data-label={t("Employment type")}>
                      <Badge
                        tone={u.employment === "employee" ? "blue" : "purple"}
                      >
                        {u.employment === "employee"
                          ? t("Employees")
                          : t("Contractors")}
                      </Badge>
                    </td>
                    <td data-label={t("Role")}>
                      {roleLabel(u.role)}
                    </td>
                    <td data-label={t("Status")}>
                      <Badge tone={u.is_active ? "teal" : "neutral"}>
                        {u.is_active ? t("Active") : u.directory_disabled ? t("Disabled by directory sync") : t("Disabled")}
                      </Badge>
                    </td>
                    <td className="people-row-actions">
                      <button
                        className="text-btn"
                        onClick={() => setEditingPerson(u)}
                      >
                        {t("Edit person")}
                      </button>
                      <button className="text-btn" disabled={u.id === currentUser.id} onClick={() => { setError(""); setConfirming(u); }}>
                        {u.is_active ? t("Disable") : t("Enable")}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!matching.length && <Empty title={t("No people match these filters.")} />}
      </div>
      <PeoplePagination page={page} total={data.total} loading={loading} onPage={setPage} />
      {confirming && <Modal className="management-dialog" title={confirming.is_active ? t("Disable account") : t("Enable account")} onClose={() => { if (!busy) setConfirming(null); }}>
        <div className="modal-form">
          <p><strong>{confirming.display_name || confirming.email || confirming.username}</strong></p>
          <p>{confirming.is_active ? t("This person will lose access to training. Their courses, attempts and results will be retained.") : t("This person will be able to sign in and access training with their existing role.")}</p>
          <ErrorBox message={error} />
          <div className="modal-footer"><button className="btn" disabled={busy} onClick={() => setConfirming(null)}>{t("Cancel")}</button><button className="btn primary" disabled={busy} onClick={() => toggle(confirming)}>{confirming.is_active ? t("Disable account") : t("Enable account")}</button></div>
        </div>
      </Modal>}
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
          className="management-dialog"
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
                  {rolesFor().map(key => <option key={key} value={key}>{roleLabel(key)}</option>)}
                </select>
              </label>
              {signIn.password && (
                <label className="span-2">
                  {t("Initial password (optional, at least 12 characters)") + " "}
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    autoComplete="new-password"
                  />
                </label>
              )}
            </div>
            <p className="notice">
              {t(signIn.password
                ? "Sync Microsoft users from Entra before assigning training. This form creates local accounts for password or email-code access."
                : "Sync Microsoft users from Entra before assigning training. This form creates local accounts for email-code access.") + " "}
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
export function Settings({ user, go }: { user: User; go: (path: string) => void }) {
  useLocale();
  const [rows, setRows] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [maintenance, setMaintenance] = useState(false);
  useEffect(() => {
    let alive = true;
    api<ActivityEntry[]>("audit/")
      .then(value => { if (alive) setRows(value); })
      .catch(e => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const matching = rows.filter(row => [activityLabel(row.action), row.actor_label, row.target_label, row.action].join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="management-settings">
    <div className="page-heading">
      <div>
        <h1>{t("Settings")}</h1>

      </div>
      <button className="btn" onClick={() => go("/manage")}>{t("Management center")}</button>
    </div>
    {user.access.system_admin && <OrganizationSettings />}
    <section className="panel management-history" aria-labelledby="activity-heading" aria-busy={loading}>
      <div className="management-section-heading"><div><h2 id="activity-heading">{t("Activity history")}</h2><p>{t("Latest 200 entries")}</p></div>
        <div className="search-field"><Search size={16} /><input aria-label={t("Search activity")} placeholder={t("Search people, actions or training")} value={search} onChange={event => setSearch(event.target.value)} /></div>
      </div>
      <ErrorBox message={error} />
      {loading ? <Spinner /> : matching.length ? <Activity rows={matching} go={go} /> : <Empty title={search ? t("No activity matches this search.") : t("No activity yet")} />}
    </section>
    <details className="panel management-maintenance" onToggle={event => setMaintenance(event.currentTarget.open)}>
      <summary>{t("Advanced maintenance")}</summary>
      <p>{t("Technical configuration checks and direct data tools for system operators. Manage everyday training through the management center.")}</p>
      {user.access.system_admin && user.is_staff && <a className="btn small" href={appPath("/admin/data/")} target="_blank" rel="noreferrer">{t("Open data maintenance")}<ExternalLink size={16} /></a>}
      {maintenance && <Readiness />}
    </details>
  </div>;
}
