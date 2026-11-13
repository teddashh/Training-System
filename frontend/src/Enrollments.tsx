import { formatDateTime } from "./datetime";
import CourseIntro from "./CourseIntro";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import { t, useLocale, getLocale } from "./i18n";
import { Badge, Empty, ErrorBox, Modal, Spinner } from "./ui";
import type { Course, Enrollment } from "./types";
import SessionAttendance from './SessionAttendance';
import {SessionEnrollment} from './CourseSessions';

export const enrollmentLabel = (status: string) =>
  ({
    pending: t("Awaiting approval"),
    approved: t("Enrollment approved"),
    rejected: t("Enrollment rejected"),
    removed: t("Enrollment removed"),
    cancelled: t('Registration cancelled'),
  })[status] || t("Approval required");

export function EnrollmentAccess({
  course: initial,
  onClose,
  onSaved,
  onReady,
}: {
  course: Course;
  onClose: () => void;
  onSaved: () => void;
  onReady: (course: Course) => void;
}) {
  return courseOrSession({course:initial,onClose,onSaved,onReady});
}

function courseOrSession(props:{course:Course;onClose:()=>void;onSaved:()=>void;onReady:(course:Course)=>void}){
  return props.course.delivery_mode==='scheduled'?<SessionEnrollment {...props}/>:<ApprovalEnrollment {...props}/>;
}

function ApprovalEnrollment({course:initial,onClose,onSaved,onReady}:{course:Course;onClose:()=>void;onSaved:()=>void;onReady:(course:Course)=>void}) {
  useLocale();
  const [course, setCourse] = useState(initial);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const row = course.enrollment;
  const requestable = !row || row.status === "rejected";
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const fresh = await api<Course>(`courses/${course.id}/`);
      setCourse(fresh);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function request(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`courses/${course.id}/enroll/`, "POST", {
        note,
        revision: row?.revision || 0,
      });
      setCourse(await api<Course>(`courses/${course.id}/`));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("Course enrollment")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="modal-form" onSubmit={request}>
        <CourseIntro course={course} dialog/>
        <div role="status">
          <Badge tone={course.can_learn ? "teal" : "amber"}>
            {enrollmentLabel(row?.status || "")}
          </Badge>
        </div>
        {row?.request_note && (
          <div className="enrollment-note">
            <strong>{t("Your request")}</strong>
            <p>{row.request_note}</p>
          </div>
        )}
        {row?.review_note && (
          <div className="enrollment-note">
            <strong>{t("Organizer response")}</strong>
            <p>{row.review_note}</p>
          </div>
        )}
        {row?.status === "pending" && (
          <p>
            {t(
              "Waiting for approval",
            )}
          </p>
        )}
        {row?.status === "removed" && (
          <p>{t("Enrollment was removed. Contact the course organizer.")}</p>
        )}
        {!course.can_learn && requestable && (
          <label>
            {t("Request note")}
            <textarea
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={refresh}
          >
            <RefreshCw size={16} />
            {t("Refresh status")}
          </button>
          {course.can_learn ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => onReady(course)}
            >
              <CheckCircle2 size={16} />
              {t("Start learning")}
            </button>
          ) : (
            requestable && (
              <button className="btn primary" disabled={busy}>
                {busy
                  ? t("Saving…")
                  : row
                    ? t("Request enrollment again")
                    : t("Request enrollment")}
              </button>
            )
          )}
        </div>
      </form>
    </Modal>
  );
}

type RosterRow = Enrollment & {
  person: string;
  username: string;
  department: string;
  active: boolean;
  reviewer: string;
};
type Roster = {
  results: RosterRow[];
  count: number;
  page: number;
  page_size: number;
};
export type Decision = "approved" | "rejected" | "removed";
/** The organizer's decision on one enrollment, shared by the roster dialog and the training page. */
export function EnrollmentDecision({ course, row, decision, cancelLabel, onCancel, onDone, onBusy }: {
  course: Pick<Course, "id">; row: Pick<RosterRow, "id" | "revision" | "person" | "request_note">; decision: Decision;
  cancelLabel: string; onCancel: () => void; onDone: () => void; onBusy?: (busy: boolean) => void;
}) {
  useLocale();
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); onBusy?.(true);
    setError("");
    try {
      await api(`courses/${course.id}/enrollments/${row.id}/review/`, "POST", { revision: row.revision, decision, note });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false); onBusy?.(false);
    }
  }
  return (
    <form onSubmit={save} className="enrollment-review">
      <h3>{row.person}</h3>
      <Badge tone={decision === "approved" ? "teal" : "amber"}>
        {enrollmentLabel(decision)}
      </Badge>
      <p>
        {decision === "removed"
          ? t("Removal blocks access but keeps learning history.")
          : decision === "approved"
            ? t("The participant will be able to open this course.")
            : t("They can read your response and reapply.")}
      </p>
      {row.request_note && (
        <div className="enrollment-note">
          <strong>{t("Request note")}</strong>
          <p>{row.request_note}</p>
        </div>
      )}
      <label>
        {t("Decision note")}
        <textarea rows={3} maxLength={1000} required={decision !== "approved"} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ErrorBox message={error} />
      <div className="modal-footer">
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button className="btn primary" disabled={busy}>{busy ? t("Saving…") : t("Save decision")}</button>
      </div>
    </form>
  );
}
export function EnrollmentManager({
  course,
  onClose,
  onSaved,
}: {
  course: Course;
  onClose: () => void;
  onSaved: () => void;
}) {
  useLocale();
  const [status, setStatus] = useState("pending");
  const [session,setSession]=useState('');
  const [attendanceView,setAttendanceView]=useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<{
    row: RosterRow;
    decision: Decision;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        status,
        search,
        page: String(page),
        session,
      });
      api<Roster>(`courses/${course.id}/enrollments/?${params}`)
        .then((value) => {
          if (alive) setData(value);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [course.id, status, search, page, version, session]);
  function choose(row: RosterRow, decision: Decision) {
    setSelected({ row, decision });
    setError("");
    setMessage("");
  }
  return (
    <Modal
      title={t("Manage enrollments")}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="modal-form">
        <div className="enrollment-intro">
          <ShieldCheck size={28} />
          <div>
            <h3>{course.title}</h3>

          </div>
        </div>
        {selected ? (
          <EnrollmentDecision course={course} row={selected.row} decision={selected.decision} cancelLabel={t("Back to enrollments")}
            onBusy={setBusy} onCancel={() => { setSelected(null); setVersion((v) => v + 1); }}
            onDone={() => { setMessage("Enrollment decision saved."); setSelected(null); setVersion((v) => v + 1); onSaved(); }} />
        ) : (
          <>
            {course.delivery_mode==='scheduled'&&<div className="heading-actions">
              <button type="button" className="btn" aria-pressed={!attendanceView} onClick={()=>setAttendanceView(false)}>{t('Enrollments')}</button>
              <button type="button" className="btn" aria-pressed={attendanceView} onClick={()=>{setAttendanceView(true);if(!session&&course.sessions.length)setSession(String(course.sessions[0].id));}}>{t('Attendance')}</button>
            </div>}
            <div className="enrollment-filters">
              {!attendanceView&&<label>
                {t("Enrollment status")}
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">{t("All enrollments")}</option>
                  {["pending", "approved", "rejected", "removed", "cancelled"].map(
                    (value) => (
                      <option key={value} value={value}>
                        {enrollmentLabel(value)}
                      </option>
                    ),
                  )}
                </select>
              </label>}
              {course.delivery_mode==='scheduled'&&<label>{t('Session')}<select value={session} onChange={e=>{setSession(e.target.value);setPage(1);}}><option value="">{t(attendanceView?'Choose a session':'All sessions')}</option>{course.sessions.map(s=><option key={s.id} value={s.id}>{s.title}{s.location?` · ${s.location}`:''}</option>)}</select></label>}
              {!attendanceView&&<label>
                {t("Search participants")}
                <div className="search-field">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              </label>}
              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={() => setVersion((v) => v + 1)}
              >
                <RefreshCw size={16} />
                {t("Refresh")}
              </button>
            </div>
            {attendanceView&&course.sessions.find(s=>String(s.id)===session)&&<SessionAttendance refreshKey={version} course={course} session={course.sessions.find(s=>String(s.id)===session)!} onSaved={()=>{setVersion(v=>v+1);onSaved();}}/>}
            <div role="status">{message && t(message)}</div>
            <ErrorBox message={error} />
            {!attendanceView && (loading ? (
              <Spinner />
            ) : (
              data &&
              !error && (
                <>
                  {data.results.length ? (
                    <div className="enrollment-list">
                      {data.results.map((row) => (
                        <article className="enrollment-row" key={row.id}>
                          <div className="enrollment-person">
                            <strong>{row.person}</strong>
                            {row.session&&<span>{row.session.title}{row.session.location?` · ${row.session.location}`:''} · {formatDateTime(row.session.starts_at, getLocale())}</span>}
                            <span className="muted">
                              {row.username}
                              {row.department ? ` · ${row.department}` : ""}
                            </span>
                            <Badge
                              tone={
                                row.status === "approved" ? "teal" : "amber"
                              }
                            >
                              {enrollmentLabel(row.status)}
                            </Badge>
                            {!row.active && (
                              <Badge tone="amber">{t("Inactive")}</Badge>
                            )}
                          </div>
                          {row.request_note && (
                            <div className="enrollment-note">
                              <strong>{t("Request note")}</strong>
                              <p>{row.request_note}</p>
                            </div>
                          )}
                          {row.review_note && (
                            <div className="enrollment-note">
                              <strong>{t("Organizer response")}</strong>
                              <p>{row.review_note}</p>
                            </div>
                          )}
                          <div className="enrollment-row-footer">
                            <small className="muted">
                              <Clock3 size={14} />
                              {row.requested_at
                                ? new Date(row.requested_at).toLocaleString(
                                    getLocale(),
                                  )
                                : t("Existing enrollment")}
                              {" · "}
                              {t("Progress")}: {row.progress_known === false ? t("In progress") : `${row.progress}%`}{" · "}
                              {row.reviewer || t("No decision yet")}
                            </small>
                            <div className="enrollment-buttons">
                              {row.status !== "approved" && (
                                <button
                                  className="btn"
                                  disabled={!row.active}
                                  onClick={() => choose(row, "approved")}
                                >
                                  {t("Approve enrollment")}
                                </button>
                              )}
                              {row.status === "pending" && (
                                <button
                                  className="btn"
                                  onClick={() => choose(row, "rejected")}
                                >
                                  {t("Reject enrollment")}
                                </button>
                              )}
                              {row.status === "approved" && (
                                <button
                                  className="btn danger-text"
                                  onClick={() => choose(row, "removed")}
                                >
                                  {t("Remove enrollment")}
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title={t("No matching enrollments")}

                    />
                  )}
                  <div className="enrollment-pagination">
                    <span>{t("{v0} enrollments", { v0: data.count })}</span>
                    <div className="enrollment-buttons">
                      <button
                        className="btn"
                        disabled={data.page <= 1}
                        onClick={() => setPage(data.page - 1)}
                      >
                        {t("Previous")}
                      </button>
                      <span>
                        {data.page} /{" "}
                        {Math.max(1, Math.ceil(data.count / data.page_size))}
                      </span>
                      <button
                        className="btn"
                        disabled={data.page * data.page_size >= data.count}
                        onClick={() => setPage(data.page + 1)}
                      >
                        {t("Next")}
                      </button>
                    </div>
                  </div>
                </>
              )
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
