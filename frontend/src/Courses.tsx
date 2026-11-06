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
  const [title, setTitle] = useState(course?.title || ""),
    [description, setDescription] = useState(course?.description || ""),
    [category, setCategory] = useState(course?.category || "通識培訓"),
    [duration, setDuration] = useState(course?.duration_minutes || 30),
    [published, setPublished] = useState(course?.published || false),
    [blocks, setBlocks] = useState<Block[]>(
      course?.blocks || [
        { type: "heading", text: "學習目標" },
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
      title={course ? "編輯課程與教材" : "建立學習課程"}
      onClose={onClose}
      wide
    >
      <form onSubmit={save} className="modal-form">
        <div className="form-grid">
          <label className="span-2">
            課程名稱
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              placeholder="例如：資訊安全與個資保護"
            />
          </label>
          <label>
            課程類別
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              maxLength={50}
            />
          </label>
          <label>
            預估時間（分鐘）
            <input
              type="number"
              min={1}
              max={10000}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </label>
          <label className="span-2">
            課程簡介
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        <div className="form-section">
          <h3>
            教材內容<span className="muted"> · 區塊編輯器</span>
          </h3>
          <p>
            文字教材儲存在公司平台。需要影片、測驗或互動內容，可使用 Scormly
            製作並上傳 SCORM。
          </p>
        </div>
        <div className="block-editor">
          {blocks.map((block, i) => (
            <div className="editor-block" key={i}>
              <div className="block-toolbar">
                <select
                  aria-label={`區塊 ${i + 1} 類型`}
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
                  <option value="heading">標題</option>
                  <option value="text">段落</option>
                  <option value="callout">重點提示</option>
                </select>
                <span />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="上移區塊"
                  onClick={() => move(i, -1)}
                  disabled={!i}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="下移區塊"
                  onClick={() => move(i, 1)}
                  disabled={i === blocks.length - 1}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn danger-text"
                  aria-label="刪除區塊"
                  onClick={() => setBlocks(blocks.filter((_, n) => n !== i))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <textarea
                aria-label={`區塊 ${i + 1} 內容`}
                value={block.text}
                rows={block.type === "heading" ? 1 : 3}
                onChange={(e) =>
                  setBlocks(
                    blocks.map((b, n) =>
                      n === i ? { ...b, text: e.target.value } : b,
                    ),
                  )
                }
                placeholder="輸入教材內容…"
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
          新增內容區塊
        </button>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          發布課程，讓學員可以開始學習
        </label>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button className="btn" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "儲存中…" : "儲存課程"}
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
  const [launch, setLaunch] = useState<{
      url: string;
      nonce: string;
      origin: string;
    } | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState("正在準備教材…");
  const frame = useRef<HTMLIFrameElement>(null),
    queue = useRef(Promise.resolve());
  useEffect(() => {
    let alive = true;
    api<{ url: string; nonce: string; origin: string }>(
      `scorm/${course.package!.id}/launch/`,
      "POST",
      {},
    )
      .then((v) => {
        if (alive) {
          setLaunch(v);
          setStatus("學習進度會自動儲存");
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
      setStatus("正在儲存學習紀錄…");
      queue.current = queue.current.then(async () => {
        try {
          const result = await api<{ completed: boolean }>(
            `scorm/${course.package!.id}/commit/`,
            "POST",
            { nonce: launch.nonce, cmi: message.cmi },
          );
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
            result.completed ? "課程已完成，紀錄已儲存" : "學習紀錄已儲存",
          );
          onSaved();
        } catch (err) {
          setError((err as Error).message);
          setStatus("儲存失敗，請保持播放器開啟並稍後重試");
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
        {status}
      </div>
      <ErrorBox message={error} />
      {launch && (
        <iframe
          ref={frame}
          className="scorm-frame"
          src={launch.url}
          title="SCORM 課程播放器"
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
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("全部課程"),
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
      (filter !== "我的學習" || c.progress !== null) &&
      (filter !== "草稿" || !c.published),
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
            {studio ? "CONTENT STUDIO" : "LEARNING LIBRARY"}
          </div>
          <h1>{studio ? "教材工作室" : "學習課程"}</h1>
          <p>
            {studio
              ? "從一個想法開始，打造讓知識留下來的學習體驗。"
              : "在每一次探索中，找到團隊前進的新方向。"}
          </p>
        </div>
        {manage && (
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus size={17} />
            建立課程
          </button>
        )}
      </div>
      {studio && (
        <div className="studio-banner">
          <div className="studio-icon">
            <Layers3 size={38} />
          </div>
          <div>
            <Badge tone="teal">SCORMLY · OPEN SOURCE</Badge>
            <h2>讓教材，變得更有互動感。</h2>
            <p>
              運用拖曳區塊、影片、情境對話與測驗製作教材，匯出 SCORM 1.2／2004
              後直接發布到課程。
            </p>
            <small>
              Scormly
              原版介面提供英文／烏克蘭文；專案保存在您的瀏覽器或本機，可使用
              Publish to LMS 直接發布，並備份原始專案到公司平台。
            </small>
          </div>
          <a
            className="btn primary"
            href="/studio/#/app"
            target="_blank"
            rel="noreferrer"
          >
            開啟 Scormly
            <ExternalLink size={16} />
          </a>
        </div>
      )}
      <ErrorBox message={error} />
      <div className="toolbar">
        <div className="tabs">
          {["全部課程", "我的學習", ...(manage ? ["草稿"] : [])].map((t) => (
            <button
              key={t}
              className={filter === t ? "active" : ""}
              onClick={() => setFilter(t)}
            >
              {t}
              {t === "全部課程" && <span>{courses.length}</span>}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋課程名稱、類別…"
            aria-label="搜尋課程"
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
                  {c.published ? "已發布" : "草稿"}
                </Badge>
              </div>
              <div className="course-body">
                <div className="course-meta">
                  <span>{c.category}</span>
                  <span>
                    {c.package ? "SCORM " + c.package.version : "數位教材"}
                  </span>
                </div>
                <h2>{c.title}</h2>
                <p>
                  {c.description || "為持續成長的團隊，打造實用的學習體驗。"}
                </p>
                <div className="course-details">
                  <span>
                    <Clock3 size={14} />
                    {c.duration_minutes} 分鐘
                  </span>
                  <span>
                    <Users size={14} />
                    {c.enrolled_count} 人學習中
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
                      ? "再次學習"
                      : c.progress !== null
                        ? "繼續學習"
                        : "開始學習"}
                    <ArrowRight size={16} />
                  </button>
                  {manage && (
                    <div>
                      {c.package?.has_source && (
                        <a
                          className="icon-btn"
                          href={`/api/courses/${c.id}/source/`}
                          title="下載 Scormly 原始專案"
                          aria-label="下載 Scormly 原始專案"
                        >
                          <Download size={16} />
                        </a>
                      )}
                      <button
                        className="icon-btn"
                        title="上傳 SCORM"
                        aria-label={"上傳 " + c.title + " 的 SCORM"}
                        onClick={() => {
                          setError("");
                          setUploading(c);
                        }}
                      >
                        <Upload size={16} />
                      </button>
                      <button
                        className="icon-btn"
                        title="編輯課程"
                        aria-label={"編輯 " + c.title}
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
          title="找不到符合的課程"
          description="調整搜尋條件，或建立新的課程。"
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
        <Modal title="上傳 SCORM 教材" onClose={() => setUploading(null)}>
          <div className="modal-form">
            <h3>{uploading.title}</h3>
            <p className="muted">
              支援單一 SCO 的 SCORM 1.2／2004 套件，最多 100
              MB。新版套件會保留舊版學習紀錄。
            </p>
            <label className="upload-zone">
              <Upload size={34} />
              <strong>
                {busy ? "正在驗證與上傳…" : "選擇 SCORM ZIP 套件"}
              </strong>
              <span>由 Scormly 或其他教材工具匯出</span>
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
              {viewing.category} · {viewing.duration_minutes} 分鐘
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
                title="教材尚在準備中"
                description="請稍後回來，或聯絡訓練管理員。"
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
                {viewing.progress === 100 ? "已完成學習" : "標記為已完成"}
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
