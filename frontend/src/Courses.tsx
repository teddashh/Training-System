import { formatDateTime } from "./datetime";
import AssessmentBlock from "./AssessmentBlock";
import { useAccess } from "./access";
import DocumentImport, { type DocumentPages } from "./DocumentImport";
import CourseCover, { DEFAULT_COVER, CourseArtwork } from "./CourseCover";
import CourseMaterials from './CourseMaterials';
import CourseAssessments from "./CourseAssessments";
import {SessionEnrollment,RegistrationLink,localDate} from './CourseSessions';
import { appPath } from "./paths";
import { countLabel, getLocale, t, useLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Plus,
  Search,
  Clock3,
  Users,
  ArrowRight,
  Upload,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  FileText,
  Play,
  Download,
} from "lucide-react";
import type { Course, Block, User, Exam } from "./types";
import { api } from "./api";
import { Modal, Badge, Empty, ErrorBox } from "./ui";
import { EnrollmentAccess, EnrollmentManager, enrollmentLabel } from "./Enrollments";
import CourseManagement, { opensTrainingPage } from "./CourseManagement";
import ActionMenu from "./ActionMenu";
import { sortTrainings } from "./simpleTraining";
export function CourseEditor({
  course,
  onClose,
  onSaved,
  onTrainingPage = false,
  go,
}: {
  course: Course | null;
  onClose: () => void;
  onSaved: (saved?: Course) => void;
  onTrainingPage?: boolean;
  go?: (path: string, replace?: boolean) => void;
}) {
  useLocale();
  const access = useAccess();
  const [contentType, setContentType] = useState<"interactive" | "text" | "document">(!access.scorm_upload || (course && !course.package) ? "text" : "interactive");
  const [document, setDocument] = useState<DocumentPages | null>(null);
  const [deliveryMode,setDeliveryMode]=useState<Course['delivery_mode']>(course?.delivery_mode||'self_paced');
  const [venue,setVenue]=useState<Course['venue']>(course?.venue||'online');
  const [release,setRelease]=useState(localDate(course?.release_at));
  const [title, setTitle] = useState(course?.title || ""),
    [cover, setCover] = useState(course?.cover || DEFAULT_COVER),
    [description, setDescription] = useState(course?.description || ""),
    [category, setCategory] = useState(
      course?.category || t("General training"),
    ),
    [duration, setDuration] = useState(course?.duration_minutes || 30),
    [published, setPublished] = useState(course?.published || false),
    [requiresApproval, setRequiresApproval] = useState(course?.requires_approval || false),
    [blocks, setBlocks] = useState<Block[]>(
      course?.blocks || [
        { type: "heading", text: "" },
        { type: "text", text: "" },
      ],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: React.SyntheticEvent, publishNow = published) {
    e.preventDefault();
    if (busy || (venue !== "onsite" && !course && contentType === "document" && !document)) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api<Course>(
        course ? `courses/${course.id}/` : "courses/",
        course ? "PATCH" : "POST",
        {
          title,
          description,
          cover,
          category: category.trim() || t("General training"),
          duration_minutes: duration,
          published: venue !== "onsite" && !course && contentType !== "text" ? false : publishNow,
          requires_approval: requiresApproval,
          delivery_mode: deliveryMode,
          venue,
          release_at: release ? new Date(release).toISOString() : null,
          blocks: venue === "onsite" ? [] : !course && contentType === "document" ? document!.pages.flatMap(p => [{ type: "heading", text: `Page ${p.number}`, source_page: p.number }, { type: "text", text: p.text }]) : !course && contentType === "interactive" ? blocks.filter(block => block.text.trim()) : blocks,
        },
      );
      if (venue !== "onsite" && !course && contentType !== "text" && access.scorm_upload) {
        window.location.assign(appPath(`/studio/?course=${saved.id}#/app`));
        return;
      }
      onSaved(saved);
      onClose();
      // The Training area (list, new training, training page) already shows drafts.
      if (!saved.published && !window.location.pathname.includes("/authoring")) window.location.assign(appPath("/authoring"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function move(i: number, delta: number) {
    const next = [...blocks],
      j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  }
  return (
    <Modal
      title={
        course ? t("Course settings") : t("Create course")
      }
      onClose={onClose}
      closeDisabled={busy}
      wide={!!course || contentType === "text"}
    >
      <form onSubmit={e => void save(e)} className="modal-form" aria-busy={busy}>
        <fieldset className="course-editor-fields" disabled={busy}>
        <div className="form-grid"><label>{t('Course type')}<select value={venue==='onsite'?'onsite':deliveryMode} onChange={e=>{setVenue(e.target.value==='onsite'?'onsite':'online');setDeliveryMode(e.target.value==='self_paced'?'self_paced':'scheduled');}}><option value="self_paced">{t('Self-paced')}</option><option value="scheduled">{t('Scheduled online sessions')}</option><option value="onsite">{t('On-site sessions')}</option></select></label></div>
        {!course && venue !== "onsite" && <fieldset className="course-format" disabled={busy}>
          <legend>{t("Content type")}</legend>
          {access.scorm_upload && <label><input type="radio" name="content-type" value="interactive" checked={contentType === "interactive"} onChange={() => setContentType("interactive")} />{t("Interactive content")}</label>}
          <label><input type="radio" name="content-type" value="text" checked={contentType === "text"} onChange={() => setContentType("text")} />{t("Text lesson")}</label>
          <label><input type="radio" name="content-type" value="document" checked={contentType === "document"} onChange={() => setContentType("document")} />{t("PDF / PowerPoint")}</label>
        </fieldset>}
        {!course && venue !== "onsite" && contentType === "document" && <DocumentImport onBusy={setBusy} onLoaded={(doc, name) => { setDocument(doc); if (!title && name) setTitle(name); }} />}
        <div className="form-grid">
          <label className="span-2">
            {t("Course title") + " "}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              placeholder={t("For example: Information security and privacy")}
            />
          </label>
          <label className="span-2">
            {t("Course description") + " "}
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        <CourseCover value={cover} title={title} onChange={setCover} />
        {venue === "onsite" ? <p className="muted">{t("Attendance completes on-site training.")}</p> : course?.package ? <div className="form-section">
          <h3>{t("Learning content")}</h3>
          {access.scorm_source && course.package.has_source && <a className="btn" href={appPath(`/studio/?course=${course.id}#/app`)}>{t("Edit content")}<ArrowRight size={16} /></a>}

        </div> : contentType === "text" ? <div className="course-text-editor">
          <h3>{t("Text lesson")}</h3>
        <div className="block-editor">
          {blocks.map((block, i) => (
            <div className="editor-block" key={i}>
              <div className="block-toolbar">
                <select
                  aria-label={t("Block {v0} type", { v0: i + 1 })}
                  value={block.type}
                  onChange={(e) =>
                    setBlocks(
                      blocks.map((b, n) =>
                        n === i
                          ? { ...b, type: e.target.value as Block["type"] }
                          : b,
                      ),
                    )
                  }
                >
                  <option value="heading">{t("Heading")}</option>
                  <option value="text">{t("Paragraph")}</option>
                  <option value="callout">{t("Callout")}</option>
                </select>
                <span />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t("Move block up")}
                  onClick={() => move(i, -1)}
                  disabled={!i}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t("Move block down")}
                  onClick={() => move(i, 1)}
                  disabled={i === blocks.length - 1}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn danger-text"
                  aria-label={t("Delete block")}
                  onClick={() => setBlocks(blocks.filter((_, n) => n !== i))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <textarea
                aria-label={t("Block {v0} content", { v0: i + 1 })}
                value={block.text}
                rows={block.type === "heading" ? 1 : 3}
                onChange={(e) =>
                  setBlocks(
                    blocks.map((b, n) =>
                      n === i ? { ...b, text: e.target.value } : b,
                    ),
                  )
                }
                placeholder={t("Enter learning content\u2026")}
              />
            </div>
          ))}
        </div>
        <button
          className="btn dashed full"
          type="button"
          onClick={() => setBlocks([...blocks, { type: "text", text: "" }])}
        >
          <Plus size={16} />
          {t("Add content block") + " "}
        </button>
        </div> : <p className="muted">{t("Next: edit your draft in Studio.")}</p>}
        {course && <CourseAssessments course={course} onSaved={onSaved} />}
        {((deliveryMode !== 'scheduled' && !course?.published) || (deliveryMode === 'scheduled' &&
          (!onTrainingPage || course?.delivery_mode !== 'scheduled' || course.venue !== venue))) &&
          <section className="form-section"><h3>{t('Delivery and release')}</h3>
            {deliveryMode !== 'scheduled' ? <p className="muted">{t('Publish before scheduling or assigning.')}</p>
              : course?.delivery_mode === 'scheduled' && course.venue === venue
                ? <a className="btn small" href={appPath(`/authoring/${course.id}`)} onClick={go ? event => { event.preventDefault(); go(`/authoring/${course.id}`); } : undefined}>{t('Open training page')}</a>
                : <p className="muted">{t('Save the course as Scheduled sessions first.')}</p>}
          </section>}
        {course?.delivery_mode==='scheduled'&&<CourseMaterials course={course} edit/>}
        {(course || venue === "onsite" || contentType === "text") && <label className="checkbox-label">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          {t("Visible to learners") + " "}
        </label>}
        <details className="course-options">
          <summary>{t("More options")}</summary>
          {course?.published && course.delivery_mode !== 'scheduled' && deliveryMode !== 'scheduled' && <RegistrationLink course={course} />}
          {course?.published && <label>{t('Release time')}<input type="datetime-local" value={release} onChange={e=>setRelease(e.target.value)}/><span className="field-hint">{t('Leave blank to release immediately.')}</span></label>}
          <div className="form-grid">
            <label>{t("Course category")}<input value={category} onChange={e => setCategory(e.target.value)} maxLength={50} /></label>
            <label>{t("Duration (minutes)")}<input type="number" min={1} max={10000} value={duration} onChange={e => setDuration(Number(e.target.value))} /></label>
          </div>
        <label className="checkbox-label">
          <input type="checkbox" checked={requiresApproval} onChange={e => setRequiresApproval(e.target.checked)} />
          {t("Require approval")}
        </label>
        {requiresApproval && <p className="muted">{t("Assignments still require approval; existing access stays.")}</p>}
        </details>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            {t("Cancel") + " "}
          </button>
          <button className={"btn" + (course && !published ? "" : " primary")} disabled={busy || (venue !== "onsite" && !course && contentType === "document" && !document)}>
            {busy ? t("Saving\u2026") : venue !== "onsite" && !course && contentType !== "text" ? t("Create and edit") : t("Save course")}
          </button>
          {course && !published && <button type="button" className="btn primary" disabled={busy || (venue !== "onsite" && !course.package && !blocks.some(b => b.text.trim()))} onClick={e => void save(e, true)}>{t(release&&new Date(release).getTime()>Date.now()?"Schedule release":"Publish course")}</button>}
        </div>
        </fieldset>
      </form>
    </Modal>
  );
}
export function ScormPlayer({
  course,
  onClose,
  onSaved,
}: {
  course: Course;
  onClose: () => void;
  onSaved: () => void;
}) {
  useLocale();
  const [launch, setLaunch] = useState<{
      url: string;
      nonce: string;
      origin: string;
      ticket?: string;
      access_ends_at?: string | null;
      server_time?: string;
    } | null>(null),
    [error, setError] = useState(""),
    [closing, setClosing] = useState(false),
    [closeFailed, setCloseFailed] = useState(false),
    [savedProgress, setSavedProgress] = useState<number | null>(null),
    [status, setStatus] = useState("Preparing content\u2026");
  const frame = useRef<HTMLIFrameElement>(null),
    queue = useRef(Promise.resolve());
  const closeRequest = useRef<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const assessmentDestination = useRef<string | null>(null);
  const savedToLeave = useRef(false);
  const finishClose = useRef(onClose);
  finishClose.current = () => {
    savedToLeave.current = true;
    if (assessmentDestination.current) window.location.assign(assessmentDestination.current);
    else onClose();
  };
  function cancelClose() {
    clearTimeout(closeTimer.current);
    closeRequest.current = null;
    setClosing(false);
    setCloseFailed(true);
  }
  function requestClose() {
    if (closeRequest.current) return;
    if (!launch) {
      finishClose.current();
      return;
    }
    closeRequest.current = crypto.randomUUID();
    setClosing(true);
    setCloseFailed(false);
    setError("");
    setStatus("Saving learning progress…");
    frame.current?.contentWindow?.postMessage(
      {
        type: "scorm.flush",
        nonce: launch.nonce,
        close_request: closeRequest.current,
      },
      launch.origin,
    );
    closeTimer.current = setTimeout(() => {
      cancelClose();
      setError(
        t(
          "The player did not confirm a save. Keep it open and retry, or close without saving.",
        ),
      );
    }, 15000);
  }
  const scheduledClose = useRef(requestClose);
  scheduledClose.current = requestClose;
  useEffect(() => {
    if (!launch?.access_ends_at || !launch.server_time) return;
    const deadline = performance.now() + Date.parse(launch.access_ends_at) - Date.parse(launch.server_time);
    let timer:ReturnType<typeof setTimeout>;
    const check=()=>{const remaining=deadline-performance.now();if(remaining<=0)scheduledClose.current();else timer=setTimeout(check,Math.min(remaining,2147483647));};
    check();
    return () => clearTimeout(timer);
  }, [launch]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (savedToLeave.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      clearTimeout(closeTimer.current);
      window.removeEventListener("beforeunload", warn);
    };
  }, []);
  const pendingLaunch = useRef<{
    packageId: string;
    promise: Promise<{ url: string; nonce: string; origin: string; ticket?: string }>;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    const packageId = course.package!.id;
    // StrictMode replays effects. Reuse the launch so a second response cannot
    // overwrite the session nonce while the first player is already running.
    if (pendingLaunch.current?.packageId !== packageId) {
      pendingLaunch.current = {
        packageId,
        promise: api(`scorm/${packageId}/launch/`, "POST", {}),
      };
    }
    pendingLaunch.current.promise
      .then((v) => {
        if (alive) {
          setLaunch(v);
          setStatus("Your learning progress saves automatically");
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [course.package?.id]);
  const submittedLaunch = useRef<typeof launch>(null);
  useEffect(() => {
    if (!launch?.ticket || submittedLaunch.current === launch || !frame.current) return;
    submittedLaunch.current = launch;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = launch.url;
    form.target = frame.current.name;
    form.hidden = true;
    const ticket = document.createElement("input");
    ticket.name = "ticket"; ticket.type = "hidden"; ticket.value = launch.ticket;
    form.append(ticket); document.body.append(form);
    try { form.submit(); } finally { form.remove(); }
  }, [launch]);
  useEffect(() => {
    if (!launch) return;
    const receive = (e: MessageEvent) => {
      if (
        e.source !== frame.current?.contentWindow ||
        e.origin !== launch.origin ||
        !["scorm.commit", "scorm.flushed"].includes(e.data?.type) ||
        e.data?.nonce !== launch.nonce
      )
        return;
      const message = e.data;
      if (message.type === "scorm.flushed") {
        if (
          message.close_request &&
          message.close_request === closeRequest.current
        ) {
          clearTimeout(closeTimer.current);
          finishClose.current();
        }
        return;
      }
      setStatus("Saving learning progress\u2026");
      queue.current = queue.current.then(async () => {
        try {
          const result = await api<{
            completed: boolean;
            progress: number;
            progress_known: boolean;
          }>(`scorm/${course.package!.id}/commit/`, "POST", {
            nonce: launch.nonce,
            cmi: message.cmi,
          });
          frame.current?.contentWindow?.postMessage(
            {
              type: "scorm.ack",
              nonce: launch.nonce,
              sequence: message.sequence,
              ok: true,
            },
            launch.origin,
          );
          setError("");
          setSavedProgress(result.progress_known ? result.progress : null);
          setStatus(
            result.completed
              ? "Course completed and progress saved"
              : "Learning progress saved",
          );
          onSaved();
          if (
            message.close_request &&
            message.close_request === closeRequest.current
          ) {
            clearTimeout(closeTimer.current);
            finishClose.current();
          }
        } catch (err) {
          if (
            message.close_request &&
            message.close_request === closeRequest.current
          )
            cancelClose();
          setError((err as Error).message);
          setStatus("Save failed. Keep the player open and try again shortly.");
          frame.current?.contentWindow?.postMessage(
            {
              type: "scorm.ack",
              nonce: launch.nonce,
              sequence: message.sequence,
              ok: false,
            },
            launch.origin,
          );
        }
      });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [launch, course.package?.id, onSaved]);
  return (
    <Modal title={course.title} onClose={requestClose} closeDisabled={closing} fullViewport className="learning-player">
      <ErrorBox message={error} />
      {launch && (
        <iframe
          ref={frame}
          className="scorm-frame"
          name={`scorm-player-${course.package!.id}`}
          src={launch.ticket ? undefined : launch.url}
          title={t("SCORM course player")}
          allow="fullscreen"
          referrerPolicy="no-referrer"
        />
      )}
      {!!course.assessments?.length && <details className="player-assessments"><summary>{t("Course assessment")}</summary><AssessmentBlock course={course} onNavigate={path => {assessmentDestination.current = path; requestClose();}}/></details>}
      <div className="modal-footer">
        <div className="player-status" role="status" aria-live="polite">
          <CheckCircle2 size={15} />
          {t(status)}{savedProgress !== null && status === "Learning progress saved" ? ` · ${savedProgress}%` : ""}
        </div>
        {closeFailed && (
          <button className="btn" onClick={onClose}>
            {t("Close without saving")}
          </button>
        )}
        <button
          className="btn primary"
          disabled={closing}
          onClick={requestClose}
        >
          {closing ? t("Saving…") : t("Save and close")}
        </button>
      </div>
    </Modal>
  );
}
export default function Courses({
  courses,
  exams = [],
  user,
  onSaved,
  studio = false,
  registrationMessage,
  go = (path, replace = false) => replace ? window.location.replace(appPath(path)) : window.location.assign(appPath(path)),
}: {
  courses: Course[];
  exams?: Exam[];
  user: User;
  onSaved: () => void;
  studio?: boolean;
  registrationMessage?: string;
  go?: (path: string, replace?: boolean) => void;
}) {
  useLocale();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All courses"),
    [editing, setEditing] = useState<Course | null | undefined>(undefined),
    [viewing, setViewing] = useState<Course | null>(null),
    [enrolling, setEnrolling] = useState<Course | null>(null),
    [roster, setRoster] = useState<Course | null>(null),
    [uploading, setUploading] = useState<Course | null>(null),
    [playing, setPlaying] = useState<Course | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [categoryFilter,setCategoryFilter]=useState('');
  const manage = user.access.courses !== "none";
  function closeLearning() {
    setViewing(null); setPlaying(null); setEnrolling(null);
    const from = new URLSearchParams(window.location.search).get("from");
    if (from === "assignments" || from === "my-training") window.location.assign(appPath(`/${from}`));
  }
  const openedLink = useRef(false);
  useEffect(()=>{
    if(!viewing?.enrollment?.session || viewing.can_manage)return;
    const deadline=performance.now()+Date.parse(viewing.enrollment.session.ends_at)-Date.parse(viewing.server_time);
    let timer:ReturnType<typeof setTimeout>;
    const check=()=>{const remaining=deadline-performance.now();if(remaining<=0){setViewing(null);onSaved();}else timer=setTimeout(check,Math.min(remaining,2147483647));};
    check();
    return()=>clearTimeout(timer);
  },[viewing]);
  useEffect(() => {
    if (openedLink.current) return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    if (manage && action === "create") {
      openedLink.current = true;
      setEditing(null);
      return;
    }
    const id = Number(params.get("course"));
    const target = courses.find((course) => course.id === id);
    if (target) {
      openedLink.current = true;
      if (action === "register" && target.published) setEnrolling(target);
      else if (action === "learn" && target.can_learn) void open(target, false, true);
      else if (target.can_manage && action === "preview") void open(target, true);
      else if (target.can_manage && action === "edit") {
        if (opensTrainingPage(target)) go(`/authoring/${target.id}?settings=1`, true);
        else setEditing(target);
      }
      else if (target.can_manage && action === "enrollments") {
        if (opensTrainingPage(target)) go(`/authoring/${target.id}?tab=people&status=pending`, true);
        else setRoster(target);
      }
      else if (!action && target.published) void open(target);
    }
  }, [courses, manage, go]);
  // One list of everything the person manages: upcoming sessions first, then the latest.
  const available = studio ? sortTrainings(courses.filter(course => course.can_manage)) : courses.filter(course => course.published);
  const filtered = available.filter(
    (c) =>
      (studio || !categoryFilter || c.category === categoryFilter) &&
      (c.title + " " + c.category + " " + c.description).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
      (studio || filter !== "Scheduled training" || c.delivery_mode === "scheduled"),
  );
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.[0] || !uploading) return;
    setBusy(true);
    setError("");
    const data = new FormData();
    data.append("file", e.target.files[0]);
    try {
      await api(`courses/${uploading.id}/upload/`, "POST", data);
      setUploading(null);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(c: Course, preview = false, enterSession = false) {
    setError("");
    setOpening(true);
    try {
      const fresh = await api<Course>(`courses/${c.id}/`);
      if (fresh.venue === "onsite" || (fresh.delivery_mode === "scheduled" && !preview && !enterSession)) { setEnrolling(fresh); return; }
      if (!fresh.can_learn) {
        setEnrolling(fresh);
        return;
      }
      if (!preview) await api(`courses/${c.id}/enroll/`, "POST", {});
      // Refetch content after admission; the catalog may predate an approval.
      const admitted = await api<Course>(`courses/${c.id}/content/`, "POST", {});
      if (!admitted.can_learn) setEnrolling(admitted);
      else if (admitted.package) setPlaying(admitted);
      else setViewing(admitted);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally { setOpening(false); }
  }
  async function complete() {
    if (!viewing) return;
    setBusy(true);
    setError("");
    try {
      await api(`courses/${viewing.id}/complete/`, "POST", {});
      setViewing({ ...viewing, progress: 100 });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function sessionSummary(course: Course) {
    const own = course.enrollment && ['approved', 'pending'].includes(course.enrollment.status) && course.enrollment.session;
    if (own && !own.cancelled) return t('Your session: {time}', {time: formatDateTime(own.starts_at, getLocale(), {weekday: true})});
    const upcoming = course.sessions.filter(s => ['open', 'upcoming'].includes(s.state) && !s.cancelled && s.remaining > 0 && Date.parse(s.starts_at) > Date.now()).sort((a,b) => Date.parse(a.starts_at)-Date.parse(b.starts_at));
    if (!upcoming.length) return t(course.sessions.some(s => !s.cancelled && Date.parse(s.starts_at) > Date.now()) ? 'No sessions are open for registration right now.' : 'No upcoming sessions');
    return `${t('Next session: {time}', {time: formatDateTime(upcoming[0].starts_at, getLocale(), {weekday: true})})} · ${countLabel(course.sessions.length, '{count} session', '{count} sessions')} · ${t(course.sessions.some(s=>s.state==='open') ? 'Registration open' : 'View sessions')}`;
  }
  return (
    <>
      {studio ? <div className="page-heading">
        <h1>{t("Training")}</h1>
        <div className="heading-actions">
          <ActionMenu title={t("Training")} label={t("More")}>
            <button type="button" onClick={() => setEditing(null)}><Plus size={16} />{t("Create course")}</button>
            {user.access.scorm_upload && <a href={appPath("/studio/#/app")}><Pencil size={16} />{t("Open Studio")}</a>}
          </ActionMenu>
          <a className="btn primary" href={appPath("/authoring/new")} onClick={event => { event.preventDefault(); go("/authoring/new"); }}><Plus size={17} />{t("New training")}</a>
        </div>
      </div> : <div className="page-heading">
        <div>
          <h1>{t("Courses")}</h1>

        </div>
        {manage && (
          <div className="heading-actions">
          <a className="btn" href={appPath("/authoring")}>{t("Open library")}</a>
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus size={17} />
            {t("Create course") + " "}
          </button>
          </div>
        )}
      </div>}
      {registrationMessage && <p className="notice" role="status">{courses.find(course => String(course.id) === new URLSearchParams(window.location.search).get('course'))?.title}: {registrationMessage}</p>}
      <ErrorBox message={error} />
      {studio ? available.length > 8 && <div className="toolbar course-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search")} aria-label={t("Search courses")} />
        </div>
      </div> : <div className="toolbar course-toolbar">
        <div className="tabs">
          {["All courses", "Scheduled training"].map(
            (tab) => (
              <button
                key={tab}
                className={filter === tab ? "active" : ""}
                aria-pressed={filter === tab}
                onClick={() => setFilter(tab)}
              >
                {t(tab)}
                {tab === "All courses" && <span>{available.length}</span>}
              </button>
            ),
          )}
        </div>
        <select aria-label={t('Filter course category')} value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">{t('All categories')}</option>{[...new Set(available.map(c=>c.category))].sort().map(category=><option key={category}>{category}</option>)}</select>
        <div className="search-field">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Search course titles and categories\u2026")}
            aria-label={t("Search courses")}
          />
        </div>
      </div>}
      {filtered.length ? (
        studio ? <div className="training-list">
          {filtered.map(course => <CourseManagement key={course.id} course={course}
            onOpen={() => opensTrainingPage(course) ? go(`/authoring/${course.id}`) : setEditing(course)}
            onSaved={onSaved} onSettings={() => opensTrainingPage(course) ? go(`/authoring/${course.id}?settings=1`) : setEditing(course)}
            onEnrollments={() => opensTrainingPage(course) ? go(`/authoring/${course.id}?tab=people`) : setRoster(course)}
            onUpload={() => { setError(""); setUploading(course); }} />)}
        </div> : <div className="course-grid">
          {filtered.map(c => (
            <article className="course-card" key={c.id}>
              <CourseArtwork cover={c.cover} title={c.title} heading>
                {c.can_manage && <Badge tone={c.published ? "white" : "amber"}>
                  {c.published ? t(c.release_at&&Date.parse(c.release_at)>Date.now()?"Scheduled":"Published") : t("Draft")}
                </Badge>}
              </CourseArtwork>
              <div className="course-body">
                <div className="course-meta">
                  <span>{c.category}</span>
                  <span>
                    {c.venue === "onsite" ? <Badge tone="neutral">{t("On-site course")}</Badge> : c.package
                      ? t("Interactive content")
                      : t("Text lesson")}
                  </span>
                </div>
                {c.description && <p>{c.description}</p>}
                {c.delivery_mode === "scheduled" && <p className="session-summary">{sessionSummary(c)}</p>}
                <div className="course-details">
                  <span>
                    <Clock3 size={14} />
                    {countLabel(c.duration_minutes, "{count} minute", "{count} minutes")}
                  </span>
                  {c.can_manage && <span>
                    <Users size={14} />
                    {c.enrolled_count}
                    {" " + t("enrolled") + " "}
                  </span>}
                </div>
                {!c.can_learn && <Badge tone="amber">{c.delivery_mode==='scheduled'?t(c.enrollment?.status==='approved'?'Registered':'Scheduled sessions'):enrollmentLabel(c.enrollment?.status || "")}</Badge>}
                {c.progress !== null && c.progress_known === false ? <p className="muted">{t("In progress")}</p> : c.progress !== null && (
                  <div className="course-progress">
                    <div className="progress">
                      <i style={{ width: c.progress + "%" }} />
                    </div>
                    <small>{c.progress}%</small>
                  </div>
                )}
                <AssessmentBlock course={c} variant="compact" onManage={() => setEditing(c)}/>
                {c.can_manage && c.venue !== "onsite" && <button className="text-btn" onClick={()=>void open(c,true)}>{t("Preview content")}</button>}
                <div className="course-actions">
                  <button className="text-btn" disabled={opening} onClick={() => void open(c)}>
                    {c.delivery_mode === "scheduled" ? t("View sessions") : !c.can_learn ? c.enrollment ? t("View enrollment") : t("Request enrollment") : c.progress === 100
                      ? t("Learn again")
                      : c.progress !== null
                        ? t("Continue learning")
                        : t("Start learning")}
                    <ArrowRight size={16} />
                  </button>
                  {c.can_manage && (
                    <div>
                      <button className="icon-btn" title={t("Manage enrollments")} aria-label={t("Manage enrollments for {v0}", { v0: c.title })} onClick={() => setRoster(c)}><Users size={16} /></button>
                      {user.access.scorm_source && c.package?.has_source && (
                        <a
                          className="icon-btn"
                          href={appPath(`/api/courses/${c.id}/source/`)}
                          title={t("Content backup")}
                          aria-label={t("Content backup")}
                        >
                          <Download size={16} />
                        </a>
                      )}
                      {c.venue !== "onsite" && user.access.scorm_upload && <button
                        className="icon-btn"
                        title={t("Upload SCORM")}
                        aria-label={
                          t("Upload ") + c.title + t(" SCORM package")
                        }
                        onClick={() => {
                          setError("");
                          setUploading(c);
                        }}
                      >
                        <Upload size={16} />
                      </button>}
                      <button
                        className="icon-btn"
                        title={t("Edit course")}
                        aria-label={t("Edit ") + c.title}
                        onClick={() => setEditing(c)}
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="course-empty">
          <Empty title={t(available.length ? "No matching courses" : studio ? "No trainings yet" : "No courses yet")}
             />
          {available.length > 0 && <button className="btn" onClick={() => { setSearch(""); setFilter("All courses"); }}>{t("Clear filters")}</button>}
        </div>
      )}
      {editing !== undefined && (
        <CourseEditor
          course={editing}
          go={go}
          onClose={() => setEditing(undefined)}
          onSaved={() => onSaved()}
        />
      )}{" "}
      {enrolling && (enrolling.delivery_mode==='scheduled'?<SessionEnrollment message={registrationMessage} course={enrolling} onClose={closeLearning} onSaved={onSaved} onReady={course => {setEnrolling(null);void open(course,false,true);}}/>:<EnrollmentAccess course={enrolling} onClose={closeLearning} onSaved={onSaved} onReady={course => { setEnrolling(null); void open(course); }} />)}
      {roster && <EnrollmentManager course={roster} onClose={() => setRoster(null)} onSaved={onSaved} />}
      {uploading && (
        <Modal
          title={t("Upload SCORM content")}
          onClose={() => setUploading(null)}
        >
          <div className="modal-form">
            <h3>{uploading.title}</h3>
            <p className="muted">
              {t(
                "Single-SCO SCORM 1.2 / 2004 packages, up to 100 MB. Uploading a new version preserves previous learning records.",
              ) + " "}
            </p>
            <label className="upload-zone">
              <Upload size={34} />
              <strong>
                {busy
                  ? t("Validating and uploading\u2026")
                  : t("Choose SCORM ZIP package")}
              </strong>
              <span>
                {t("Exported from Training Content Studio or another authoring tool")}
              </span>
              <input
                type="file"
                accept=".zip"
                disabled={busy}
                onChange={upload}
              />
            </label>
            <ErrorBox message={error} />
          </div>
        </Modal>
      )}
      {viewing && (
        <Modal title={viewing.title} onClose={closeLearning} closeDisabled={busy} fullViewport>
          <div className="lesson-content">
            <div className="lesson-kicker">
              <FileText size={16} />
              {viewing.category} · {countLabel(viewing.duration_minutes, "{count} minute", "{count} minutes")}
            </div>
            {viewing.blocks.length ? (
              viewing.blocks.map((b, i) =>
                b.type === "heading" ? (
                  <h2 key={i}>{b.text}</h2>
                ) : (
                  <p
                    key={i}
                    className={b.type === "callout" ? "lesson-callout" : ""}
                  >
                    {b.text}
                  </p>
                ),
              )
            ) : (
              <Empty
                title={t("Content is being prepared")}

              />
            )}
            <AssessmentBlock course={viewing}/>
            <ErrorBox message={error} />
            {viewing.blocks.length > 0 && (
              <button
                className="btn primary"
                disabled={busy || viewing.progress === 100}
                onClick={complete}
              >
                <CheckCircle2 size={16} />
                {viewing.progress === 100
                  ? t("Learning completed")
                  : t("Mark as completed")}
              </button>
            )}
          </div>
        </Modal>
      )}
      {playing && (
        <ScormPlayer
          course={playing}
          onClose={closeLearning}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
