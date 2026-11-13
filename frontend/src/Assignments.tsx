import { formatDateTime } from "./datetime";
import { GroupPicker } from "./Groups";
import { PeoplePicker } from "./PeopleDirectory";
import { appPath } from "./paths";
import ExamBudget from "./ExamBudget";
import { useExamPreflight } from "./useExamPreflight";
import { useRetryAvailability } from "./RetryAvailability";
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
import { countLabel, getLocale, t, useLocale } from "./i18n";
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
  progress_known?: boolean;
  score: number | null;
  completed_at: string | null;
};
type AssignmentReceipt = { emails_queued: number; people_without_email: number };
const statusLabel = (status: string) =>
  ({
    not_started: t("Not started"),
    in_progress: t("In progress"),
    pending_review: t("Pending review"),
    awaiting_approval: t("Awaiting approval"),
    enrollment_rejected: t("Enrollment rejected"),
    enrollment_removed: t("Enrollment removed"),
    registration_cancelled: t('Registration cancelled'),
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
  const manage = user.access.assign;
  const params = new URLSearchParams(window.location.search);
  const linkedCourse = params.get("action") === "assign" && manage
    ? courses.find(course => course.id === Number(params.get("course")) && course.can_manage && course.published)
    : undefined;
  const [assigned, setAssigned] = useState(false);
  const [receipt, setReceipt] = useState<AssignmentReceipt | null>(null);
  const [report, setReport] = useState(manage && new URLSearchParams(window.location.search).get("report") === "1"),
    [rows, setRows] = useState<Assignment[]>([]);
  const [error, setError] = useState(""),
    [open, setOpen] = useState(!!linkedCourse),
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
      preflight.refresh();
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
  const preflight = useExamPreflight(starting?.target_id);
  const startingExam = preflight.exam;
  const waiting = useRetryAvailability(startingExam);
  const active = rows.filter((r) => r.status !== "cancelled");
  return (
    <>
      <div className="page-heading">
        <div>

          <h1>{t("Assigned training")}</h1>

        </div>
        {manage && (
          <button className="btn primary" onClick={() => { setAssigned(false); setOpen(true); }}>
            <Plus size={17} />
            {t("Assign training")}
          </button>
        )}
      </div>
      {assigned && <p className="notice" role="status">{t("Training assigned. Track completion below.")}</p>}
      {assigned && receipt && <p className="notice" role="status">{t("{queued} emails queued; {missing} newly assigned people have no email address.", { queued: receipt.emails_queued, missing: receipt.people_without_email })}</p>}
      {params.get("action") === "assign" && !linkedCourse && <ErrorBox message={t("This course is unavailable for assignment. Choose a published course you manage.")} />}
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
          <a className="btn" href={appPath("/api/assignments/export/")}>
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
            "awaiting_approval",
            "enrollment_rejected",
            "enrollment_removed",
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
                      ? formatDateTime(row.due_at, getLocale())
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
                      ? row.progress_known === false ? t("In progress") : `${row.progress}%`
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
                            ? go(`/courses?course=${row.target_id}&from=assignments`)
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
          initialCourse={linkedCourse}
          courses={courses}
          exams={exams}
          onClose={() => setOpen(false)}
          onSaved={(result) => {
            setReceipt(result);
            setAssigned(true);
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
            {startingExam && (
              <>
                <p>
                  {countLabel(startingExam.duration_minutes, "{count} minute", "{count} minutes")} ·{" "}
                  {t("Passing score")}: {startingExam.pass_score}
                </p>
                <ExamBudget exam={startingExam} />
              </>
            )}
            <ErrorBox message={preflight.error} />
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setError("");
                preflight.refresh();
              }}
              disabled={busy || preflight.loading}
            >
              {preflight.loading
                ? t("Checking availability…")
                : t("Refresh availability")}
            </button>
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
              <button
                className="btn primary"
                disabled={
                  busy ||
                  preflight.loading ||
                  !startingExam ||
                  waiting ||
                  !!(
                    startingExam &&
                    startingExam.attempts_remaining === 0 &&
                    !startingExam.active_attempt_id
                  )
                }
                onClick={start}
              >
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
  initialCourse,
  courses,
  exams,
  onClose,
  onSaved,
}: {
  initialCourse?: Course;
  courses: Course[];
  exams: Exam[];
  onClose: () => void;
  onSaved: (result: AssignmentReceipt) => void;
}) {
  useLocale();
  const [notify, setNotify] = useState(true);
  const [kind, setKind] = useState("course"),
    [target, setTarget] = useState(initialCourse ? String(initialCourse.id) : ""),
    [audience, setAudience] = useState("people");
  const [people, setPeople] = useState<number[]>([]),
    [departments, setDepartments] = useState<string[]>([]),
    [due, setDue] = useState(""),
    [notes, setNotes] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<number[]>([]);
  const [groupPreview, setGroupPreview] = useState<{ key: string; people: number; within_limit: boolean } | null>(null);
  const groupKey = groups.join(',');
  useEffect(() => {
    let active = true; setGroupPreview(null);
    if (audience !== 'groups' || !groups.length) return;
    const timer = setTimeout(() => {
      api<{ people: number; within_limit: boolean }>('assignments/group-preview/', 'POST', { groups })
        .then(result => { if (active) setGroupPreview({ ...result, key: groupKey }); })
        .catch(e => { if (active) setError(e.message); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [audience, groupKey]);
  const validGroups = groupPreview?.key === groupKey && groupPreview?.within_limit;
  const [options, setOptions] = useState<{
    departments: string[];
    people: Pick<User, "id" | "username" | "display_name" | "department">[];
  }>({ departments: [], people: [] });
  useEffect(() => {
    api<typeof options>("exams/audience-options/?page_size=1")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  const targets = (kind === "course" ? courses : exams).filter(
    (item) => item.can_manage && item.published,
  );
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (audience === 'groups' && !validGroups) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<AssignmentReceipt>("assignments/", "POST", {
        kind,
        target_id: Number(target),
        audience,
        people,
        groups,
        departments,
        due_at: due ? new Date(due).toISOString() : null,
        notes,
        notify,
      });
      onSaved(result);
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
        </div>
        <label>
          {t("Assign to")}
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          >
            {[
              ["people", "Selected people"],
              ["groups", "Groups"],
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
        {audience === "people" && <PeoplePicker selected={people} onChange={setPeople} />}

        {audience === 'groups' && <><GroupPicker selected={groups} onChange={setGroups} disabled={busy} />
          <p role="status">{groupPreview?.key === groupKey ? t('{count} active people will receive this training.', { count: groupPreview.people }) : groups.length ? t('Loading…') : t('Select at least one group.')}</p>
          <p className="muted">{t('People in more than one selected group are counted once. Membership is checked again when saving.')}</p>
          {groupPreview?.key === groupKey && !groupPreview.within_limit && <p className="notice">{t('Assign between 1 and 500 active participants at a time.')}</p>}
        </>}
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
        <label className="checkbox-label">
          <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
          {t("Email the people I assign")}
        </label>
        <details className="course-options">
          <summary>{t("Assignment options")}</summary>
          <div className="form-grid">
            <label className="span-2">
              {t("Due date (optional)")}
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <label className="span-2">
              {t("Instructions for participants")}
              <textarea maxLength={1000} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <p className="muted span-2">{t("Existing progress is kept. Up to 500 people per assignment.")}</p>
          </div>
        </details>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button className="btn primary" disabled={busy || audience === "groups" && !validGroups}>
            {busy ? t("Saving…") : t("Assign training")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
