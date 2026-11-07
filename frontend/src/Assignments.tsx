import { useEffect, useState } from "react";
import {
  ClipboardList,
  Plus,
  Download,
  Search,
  ArrowRight,
  CheckCircle2,
  Clock3,
  AlertCircle,
} from "lucide-react";
import { api } from "./api";
import { t, useLocale } from "./i18n";
import { Badge, Empty, ErrorBox, Modal } from "./ui";
import type { Attempt, Course, Exam, User } from "./types";

type Assignment = {
  id: number;
  user_id: number;
  person: string;
  username: string;
  department: string;
  kind: "course" | "exam";
  target_id: number;
  title: string;
  available: boolean;
  due_at: string | null;
  notes: string;
  status: string;
  overdue: boolean;
  progress: number;
  score: number | null;
  completed_at: string | null;
};
const statusLabel = (status: string) =>
  ({
    not_started: t("Not started"),
    in_progress: t("In progress"),
    pending_review: t("Pending review"),
    completed: t("Completed"),
    cancelled: t("Cancelled"),
  })[status] || status;

export default function Assignments({
  user,
  courses,
  exams,
  go,
  onSaved,
}: {
  user: User;
  courses: Course[];
  exams: Exam[];
  go: (path: string) => void;
  onSaved: () => void;
}) {
  useLocale();
  const manage = user.role !== "learner";
  const [report, setReport] = useState(false),
    [rows, setRows] = useState<Assignment[]>([]);
  const [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [version, setVersion] = useState(0);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [starting, setStarting] = useState<Assignment | null>(null);
  const [busy, setBusy] = useState(false),
    [cancelling, setCancelling] = useState<Assignment | null>(null);
  useEffect(() => {
    let alive = true;
    api<Assignment[]>("assignments/" + (report ? "?report=1" : ""))
      .then((data) => {
        if (alive) {
          setRows(data);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [report, version]);
  const visible = rows.filter(
    (r) =>
      (r.title + r.person + r.department)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "overdue" ? r.overdue : r.status === filter)),
  );
  async function start() {
    if (!starting) return;
    setBusy(true);
    setError("");
    try {
      const attempt = await api<Attempt>(
        `exams/${starting.target_id}/start/`,
        "POST",
        {},
      );
      onSaved();
      go("/attempt/" + attempt.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    setError("");
    try {
      await api(`assignments/${cancelling.id}/cancel/`, "POST", {});
      setCancelling(null);
      setVersion((v) => v + 1);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = rows.filter((r) => r.status !== "cancelled");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("YOUR NEXT STEP")}</div>
          <h1>{t("Assigned training")}</h1>
          <p>
            {t(
              "Keep required learning and assessments on track, with clear deadlines and completion records.",
            )}
          </p>
        </div>
        {manage && (
          <button className="btn primary" onClick={() => setOpen(true)}>
            <Plus size={17} />
            {t("Assign training")}
          </button>
        )}
      </div>
      <div className="assignment-metrics">
        {[
          {
            label: t("Assigned"),
            value: active.length,
            icon: ClipboardList,
            tone: "blue",
          },
          {
            label: t("Completed"),
            value: active.filter((r) => r.status === "completed").length,
            icon: CheckCircle2,
            tone: "teal",
          },
          {
            label: t("Overdue"),
            value: active.filter((r) => r.overdue).length,
            icon: AlertCircle,
            tone: "amber",
          },
          {
            label: t("Pending review"),
            value: active.filter((r) => r.status === "pending_review").length,
            icon: Clock3,
            tone: "purple",
          },
        ].map((item) => (
          <section
            className={"panel assignment-metric " + item.tone}
            key={item.label}
          >
            <item.icon size={23} />
            <div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          </section>
        ))}
      </div>
      <div className="toolbar">
        <div className="tabs">
          <button
            className={!report ? "active" : ""}
            onClick={() => setReport(false)}
          >
            {t("My worklist")}
          </button>
          {manage && (
            <button
              className={report ? "active" : ""}
              onClick={() => setReport(true)}
            >
              {t("Completion report")}
            </button>
          )}
        </div>
        {report && (
          <a className="btn" href="/api/assignments/export/">
            <Download size={16} />
            {t("Export CSV")}
          </a>
        )}
      </div>
      <div className="toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label={t("Search assignments")}
            placeholder={t("Search assignments")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label={t("Assignment status")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">{t("All statuses")}</option>
          <option value="overdue">{t("Overdue")}</option>
          {[
            "not_started",
            "in_progress",
            "pending_review",
            "completed",
            ...(report ? ["cancelled"] : []),
          ].map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox message={error} />
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {report && <th>{t("Person")}</th>}
                <th>{t("Training")}</th>
                <th>{t("Due date")}</th>
                <th>{t("Status")}</th>
                <th>{t("Completion evidence")}</th>
                <th>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  {report && (
                    <td>
                      <strong>{row.person}</strong>
                      <small className="cell-note">
                        {row.department || row.username}
                      </small>
                    </td>
                  )}
                  <td>
                    <strong>{row.title}</strong>
                    <small className="cell-note">
                      {row.kind === "course" ? t("Course") : t("Assessment")}
                    </small>
                    {row.notes && (
                      <small className="cell-note assignment-note">
                        {row.notes}
                      </small>
                    )}
                  </td>
                  <td>
                    {row.due_at
                      ? new Date(row.due_at).toLocaleString()
                      : t("No deadline")}
                    {row.overdue && (
                      <div>
                        <Badge tone="amber">{t("Overdue")}</Badge>
                      </div>
                    )}
                  </td>
                  <td>
                    <Badge
                      tone={
                        row.status === "completed"
                          ? "teal"
                          : row.status === "pending_review"
                            ? "purple"
                            : "neutral"
                      }
                    >
                      {statusLabel(row.status)}
                    </Badge>
                  </td>
                  <td>
                    {row.kind === "course"
                      ? `${row.progress}%`
                      : row.score === null
                        ? "—"
                        : `${row.score}%`}
                    {row.completed_at && (
                      <small className="cell-note">
                        {new Date(row.completed_at).toLocaleDateString()}
                      </small>
                    )}
                  </td>
                  <td>
                    {report ? (
                      row.status !== "cancelled" && (
                        <button
                          className="text-btn"
                          onClick={() => {
                            setError("");
                            setCancelling(row);
                          }}
                        >
                          {t("Cancel assignment")}
                        </button>
                      )
                    ) : row.available ? (
                      <button
                        className="text-btn"
                        onClick={() =>
                          row.kind === "course"
                            ? go(`/courses?course=${row.target_id}`)
                            : setStarting(row)
                        }
                      >
                        {row.kind === "course"
                          ? t("Open course")
                          : t("Open assessment")}
                        <ArrowRight size={14} />
                      </button>
                    ) : (
                      t("Unavailable")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <Empty
            title={t("No assignments to show")}
            description={
              report
                ? t(
                    "Assign published courses or exams to start tracking required training.",
                  )
                : t("Your assigned training will appear here.")
            }
          />
        )}
      </div>
      <p className="notice">
        {t(
          "Course completion or a passing exam result fulfills an assignment. Existing completion counts. Due dates track timeliness; exam opening times and attempt limits still apply.",
        )}
      </p>
      {open && (
        <AssignmentEditor
          courses={courses}
          exams={exams}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setVersion((v) => v + 1);
            onSaved();
            setReport(true);
          }}
        />
      )}
      {starting && (
        <Modal title={t("Open assessment")} onClose={() => setStarting(null)}>
          <div className="modal-form">
            <h3>{starting.title}</h3>
            <p>
              {t(
                "Starting a new attempt uses one attempt and starts the exam timer. An active attempt resumes with its remaining time.",
              )}
            </p>
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="btn" onClick={() => setStarting(null)}>
                {t("Cancel")}
              </button>
              <button className="btn primary" disabled={busy} onClick={start}>
                {t("Start / resume exam")}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {cancelling && (
        <Modal
          title={t("Cancel assignment")}
          onClose={() => setCancelling(null)}
        >
          <div className="modal-form">
            <p>
              {cancelling.person} · {cancelling.title}
            </p>
            <p>
              {t(
                "Remove this requirement from the learner worklist? Learning progress and assessment results are retained.",
              )}
            </p>
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="btn" onClick={() => setCancelling(null)}>
                {t("Keep assignment")}
              </button>
              <button className="btn primary" disabled={busy} onClick={cancel}>
                {t("Cancel assignment")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function AssignmentEditor({
  courses,
  exams,
  onClose,
  onSaved,
}: {
  courses: Course[];
  exams: Exam[];
  onClose: () => void;
  onSaved: () => void;
}) {
  useLocale();
  const [kind, setKind] = useState("course"),
    [target, setTarget] = useState(""),
    [audience, setAudience] = useState("people");
  const [people, setPeople] = useState<number[]>([]),
    [departments, setDepartments] = useState<string[]>([]),
    [due, setDue] = useState(""),
    [notes, setNotes] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const [options, setOptions] = useState<{
    departments: string[];
    people: Pick<User, "id" | "username" | "display_name" | "department">[];
  }>({ departments: [], people: [] });
  useEffect(() => {
    api<typeof options>("exams/audience-options/")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  const targets = (kind === "course" ? courses : exams).filter(
    (item) => item.can_manage && item.published,
  );
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("assignments/", "POST", {
        kind,
        target_id: Number(target),
        audience,
        people,
        departments,
        due_at: due ? new Date(due).toISOString() : null,
        notes,
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
    <Modal title={t("Assign training")} onClose={onClose} wide>
      <form className="modal-form" onSubmit={save}>
        <div className="form-grid">
          <label>
            {t("Training type")}
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setTarget("");
              }}
            >
              <option value="course">{t("Course")}</option>
              <option value="exam">{t("Assessment")}</option>
            </select>
          </label>
          <label>
            {t("Training")}
            <select
              required
              aria-label={t("Training")}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">{t("Select published training")}</option>
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Assign to")}
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            >
              {[
                ["people", "Selected people"],
                ["departments", "Selected departments"],
                ["employees", "Employees"],
                ["contractors", "Contractors"],
                ["all", "Everyone with an account"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Due date (optional)")}
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
        </div>
        {audience === "people" && (
          <>
            <input
              aria-label={t("Search people")}
              placeholder={t("Search people")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <fieldset className="audience-options">
              <legend>
                {t("Selected people")} ({people.length})
              </legend>
              {options.people
                .filter((p) =>
                  (p.display_name + p.username + p.department)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((p) => (
                  <label className="checkbox" key={p.id}>
                    <input
                      type="checkbox"
                      checked={people.includes(p.id)}
                      onChange={(e) =>
                        setPeople(
                          e.target.checked
                            ? [...people, p.id]
                            : people.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.display_name || p.username} ·{" "}
                    {p.department || p.username}
                  </label>
                ))}
            </fieldset>
          </>
        )}
        {audience === "departments" && (
          <fieldset className="audience-options">
            <legend>{t("Selected departments")}</legend>
            {options.departments.map((dept) => (
              <label className="checkbox" key={dept}>
                <input
                  type="checkbox"
                  checked={departments.includes(dept)}
                  onChange={(e) =>
                    setDepartments(
                      e.target.checked
                        ? [...departments, dept]
                        : departments.filter((d) => d !== dept),
                    )
                  }
                />
                {dept}
              </label>
            ))}
          </fieldset>
        )}
        <label>
          {t("Instructions for participants")}
          <textarea
            maxLength={1000}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <p className="notice">
          {t(
            "Assignments grant exam access. Assigning the same training again updates its deadline and notes; it does not reset progress or attempt limits. Maximum 500 active participants per batch.",
          )}
        </p>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? t("Saving…") : t("Assign training")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
