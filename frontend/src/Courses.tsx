import { t, useLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Plus,
  Search,
  Clock3,
  Users,
  ArrowRight,
  Upload,
  Layers3,
  ExternalLink,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  FileText,
  Play,
  Download,
} from "lucide-react";
import type { Course, Block, User } from "./types";
import { api } from "./api";
import { Modal, Badge, Empty, ErrorBox } from "./ui";
export function CourseEditor({
  course,
  onClose,
  onSaved,
}: {
  course: Course | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  useLocale();
  const [title, setTitle] = useState(course?.title || ""),
    [description, setDescription] = useState(course?.description || ""),
    [category, setCategory] = useState(
      course?.category || t("General training"),
    ),
    [duration, setDuration] = useState(course?.duration_minutes || 30),
    [published, setPublished] = useState(course?.published || false),
    [blocks, setBlocks] = useState<Block[]>(
      course?.blocks || [
        { type: "heading", text: t("Learning objectives") },
        { type: "text", text: "" },
      ],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        course ? `courses/${course.id}/` : "courses/",
        course ? "PATCH" : "POST",
        {
          title,
          description,
          category,
          duration_minutes: duration,
          published,
          blocks,
        },
      );
      onSaved();
      onClose();
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
        course ? t("Edit course & content") : t("Create a learning course")
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={save} className="modal-form">
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
          <label>
            {t("Course category") + " "}
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              maxLength={50}
            />
          </label>
          <label>
            {t("Estimated duration (minutes)") + " "}
            <input
              type="number"
              min={1}
              max={10000}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
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
        <div className="form-section">
          <h3>
            {t("Learning content")}
            <span className="muted">{" " + t("\u00B7 Block editor")}</span>
          </h3>
          <p>
            {t(
              "Text lessons are saved on the company platform. Use Scormly for video, quizzes and interactive SCORM content.",
            ) + " "}
          </p>
        </div>
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
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          {t("Publish this course so learners can start") + " "}
        </label>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button className="btn" type="button" onClick={onClose}>
            {t("Cancel") + " "}
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? t("Saving\u2026") : t("Save course")}
          </button>
        </div>
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
    } | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Preparing content\u2026");
  const frame = useRef<HTMLIFrameElement>(null),
    queue = useRef(Promise.resolve());
  const pendingLaunch = useRef<{
    packageId: string;
    promise: Promise<{ url: string; nonce: string; origin: string }>;
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
  useEffect(() => {
    if (!launch) return;
    const receive = (e: MessageEvent) => {
      if (
        e.source !== frame.current?.contentWindow ||
        e.origin !== launch.origin ||
        e.data?.type !== "scorm.commit" ||
        e.data?.nonce !== launch.nonce
      )
        return;
      const message = e.data;
      setStatus("Saving learning progress\u2026");
      queue.current = queue.current.then(async () => {
        try {
          const result = await api<{
            completed: boolean;
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
          setStatus(
            result.completed
              ? "Course completed and progress saved"
              : "Learning progress saved",
          );
          onSaved();
        } catch (err) {
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
    <Modal title={course.title} onClose={onClose} wide>
      <div className="player-status">
        <CheckCircle2 size={15} />
        {t(status)}
      </div>
      <ErrorBox message={error} />
      {launch && (
        <iframe
          ref={frame}
          className="scorm-frame"
          src={launch.url}
          title={t("SCORM course player")}
          allow="fullscreen"
          referrerPolicy="no-referrer"
        />
      )}
    </Modal>
  );
}
export default function Courses({
  courses,
  user,
  onSaved,
  studio = false,
}: {
  courses: Course[];
  user: User;
  onSaved: () => void;
  studio?: boolean;
}) {
  useLocale();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All courses"),
    [editing, setEditing] = useState<Course | null | undefined>(undefined),
    [viewing, setViewing] = useState<Course | null>(null),
    [uploading, setUploading] = useState<Course | null>(null),
    [playing, setPlaying] = useState<Course | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const manage = user.role !== "learner";
  const filtered = courses.filter(
    (c) =>
      (c.title + c.category).includes(search) &&
      (filter !== "My learning" || c.progress !== null) &&
      (filter !== "Draft" || !c.published),
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
  async function open(c: Course) {
    setError("");
    try {
      await api(`courses/${c.id}/enroll/`, "POST", {});
      if (c.package) setPlaying(c);
      else setViewing(c);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function complete() {
    if (!viewing) return;
    setBusy(true);
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
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {studio ? t("CONTENT STUDIO") : t("LEARNING LIBRARY")}
          </div>
          <h1>{studio ? t("Authoring studio") : t("Learning courses")}</h1>
          <p>
            {studio
              ? t("Turn an idea into a learning experience that lasts.")
              : t("Discover new ways to move your team forward.")}
          </p>
        </div>
        {manage && (
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus size={17} />
            {t("Create course") + " "}
          </button>
        )}
      </div>
      {studio && (
        <div className="studio-banner">
          <div className="studio-icon">
            <Layers3 size={38} />
          </div>
          <div>
            <Badge tone="teal">{t("SCORMLY · OPEN SOURCE")}</Badge>
            <h2>{t("Bring your learning content to life.")}</h2>
            <p>
              {t(
                "Build with drag-and-drop blocks, video, scenarios and quizzes. Publish a SCORM package directly to your company course.",
              ) + " "}
            </p>
            <small>
              {t(
                "Choose English, Traditional Chinese or Spanish. Projects stay in your browser or on your device until you use Publish to LMS, which uploads the package and an editable backup to the company platform.",
              ) + " "}
            </small>
          </div>
          <a
            className="btn primary"
            href="/studio/#/app"
            target="_blank"
            rel="noreferrer"
          >
            {t("Open Scormly") + " "}
            <ExternalLink size={16} />
          </a>
        </div>
      )}
      <ErrorBox message={error} />
      <div className="toolbar">
        <div className="tabs">
          {["All courses", "My learning", ...(manage ? ["Draft"] : [])].map(
            (tab) => (
              <button
                key={tab}
                className={filter === tab ? "active" : ""}
                onClick={() => setFilter(tab)}
              >
                {t(tab)}
                {tab === "All courses" && <span>{courses.length}</span>}
              </button>
            ),
          )}
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Search course titles and categories\u2026")}
            aria-label={t("Search courses")}
          />
        </div>
      </div>
      {filtered.length ? (
        <div className="course-grid">
          {filtered.map((c, i) => (
            <article className="course-card" key={c.id}>
              <div className={"course-cover cover-" + (i % 4)}>
                <span className="cover-grid" />
                <div className="cover-orb" />
                <span className="cover-icon">
                  {i % 2 ? <Layers3 size={47} /> : <BookOpen size={47} />}
                </span>
                <span className="cover-caption">
                  {
                    [
                      "BUILD YOUR FOUNDATION",
                      "KEEP EXPLORING",
                      "GROW TOGETHER",
                      "MAKE AN IMPACT",
                    ][i % 4]
                  }
                </span>
                <Badge tone={c.published ? "white" : "amber"}>
                  {c.published ? t("Published") : t("Draft")}
                </Badge>
              </div>
              <div className="course-body">
                <div className="course-meta">
                  <span>{c.category}</span>
                  <span>
                    {c.package
                      ? "SCORM " + c.package.version
                      : t("Digital lesson")}
                  </span>
                </div>
                <h2>{c.title}</h2>
                <p>
                  {c.description ||
                    t(
                      "Practical learning experiences for teams that keep growing.",
                    )}
                </p>
                <div className="course-details">
                  <span>
                    <Clock3 size={14} />
                    {c.duration_minutes}
                    {" " + t("min") + " "}
                  </span>
                  <span>
                    <Users size={14} />
                    {c.enrolled_count}
                    {" " + t("enrolled") + " "}
                  </span>
                </div>
                {c.progress !== null && (
                  <div className="course-progress">
                    <div className="progress">
                      <i style={{ width: c.progress + "%" }} />
                    </div>
                    <small>{c.progress}%</small>
                  </div>
                )}
                <div className="course-actions">
                  <button className="text-btn" onClick={() => open(c)}>
                    {c.progress === 100
                      ? t("Learn again")
                      : c.progress !== null
                        ? t("Continue learning")
                        : t("Start learning")}
                    <ArrowRight size={16} />
                  </button>
                  {manage && (
                    <div>
                      {c.package?.has_source && (
                        <a
                          className="icon-btn"
                          href={`/api/courses/${c.id}/source/`}
                          title={t("Download Scormly source project")}
                          aria-label={t("Download Scormly source project")}
                        >
                          <Download size={16} />
                        </a>
                      )}
                      <button
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
                      </button>
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
        <Empty
          title={t("No matching courses")}
          description={t("Adjust your search or create a new course.")}
        />
      )}
      {editing !== undefined && (
        <CourseEditor
          course={editing}
          onClose={() => setEditing(undefined)}
          onSaved={onSaved}
        />
      )}{" "}
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
                {t("Exported from Scormly or another authoring tool")}
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
        <Modal title={viewing.title} onClose={() => setViewing(null)} wide>
          <div className="lesson-content">
            <div className="lesson-kicker">
              <FileText size={16} />
              {viewing.category} · {viewing.duration_minutes}
              {" " + t("min") + " "}
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
                description={t(
                  "Please return later or contact your training administrator.",
                )}
              />
            )}
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
          onClose={() => setPlaying(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
