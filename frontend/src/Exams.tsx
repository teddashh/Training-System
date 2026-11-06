import { useState } from "react";
import {
  Plus,
  Search,
  Clock3,
  Target,
  FileQuestion,
  ArrowRight,
  Pencil,
  Link2,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import type { Exam, Course, Question, User, Attempt } from "./types";
import { Modal, Badge, ErrorBox, Empty } from "./ui";

function ExamEditor({
  exam,
  courses,
  onSaved,
  onClose,
}: {
  exam: Exam | null;
  courses: Course[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(exam?.title || ""),
    [description, setDescription] = useState(exam?.description || ""),
    [course, setCourse] = useState(exam?.course?.toString() || ""),
    [minutes, setMinutes] = useState(exam?.duration_minutes || 30),
    [limit, setLimit] = useState(exam?.max_attempts || 2),
    [pass, setPass] = useState(exam?.pass_score || 70),
    [published, setPublished] = useState(exam?.published || false),
    [start, setStart] = useState(
      exam?.starts_at
        ? new Date(
            new Date(exam.starts_at).getTime() -
              new Date().getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : "",
    ),
    [end, setEnd] = useState(
      exam?.ends_at
        ? new Date(
            new Date(exam.ends_at).getTime() -
              new Date().getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : "",
    ),
    [questions, setQuestions] = useState<Question[]>(
      exam?.questions || [
        {
          description: "",
          type: "single",
          options: ["", ""],
          solution: [0],
          points: 10,
        },
      ],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function patch(i: number, p: Partial<Question>) {
    setQuestions(questions.map((q, j) => (i === j ? { ...q, ...p } : q)));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        exam ? `exams/${exam.id}/` : "exams/",
        exam ? "PATCH" : "POST",
        {
          title,
          description,
          course: course ? Number(course) : null,
          duration_minutes: minutes,
          max_attempts: limit,
          pass_score: pass,
          published,
          starts_at: start ? new Date(start).toISOString() : null,
          ends_at: end ? new Date(end).toISOString() : null,
          questions: questions.map((q, i) => ({
            ...q,
            id: undefined,
            position: i,
          })),
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
  return (
    <Modal
      title={exam ? "編輯考試" : "建立獨立考試／課程評量"}
      onClose={onClose}
      wide
    >
      <form className="modal-form" onSubmit={save}>
        <div className="form-grid">
          <label className="span-2">
            考試名稱
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </label>
          <label className="span-2">
            作答說明
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </label>
          <label>
            關聯課程
            <select value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">獨立考試（不綁定課程）</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            作答時間（分鐘）
            <input
              type="number"
              min={1}
              max={1440}
              required
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
          <label>
            每位受測者預設次數
            <input
              type="number"
              min={1}
              max={100}
              required
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            />
          </label>
          <label>
            及格標準（百分制）
            <input
              type="number"
              min={0}
              max={100}
              required
              value={pass}
              onChange={(e) => setPass(Number(e.target.value))}
            />
          </label>
          <label>
            開放時間（選填）
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            結束時間（選填）
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <div className="form-section">
          <h3>
            試卷題目 <Badge tone="neutral">{questions.length} 題</Badge>
          </h3>
          <p>單選、複選與簡答自動評分；申論題交由講師評閱。</p>
        </div>
        {questions.map((q, i) => (
          <div className="question-editor" key={i}>
            <div className="question-toolbar">
              <strong>題目 {i + 1}</strong>
              <select
                aria-label={`題目 ${i + 1} 題型`}
                value={q.type}
                onChange={(e) => {
                  const type = e.target.value as Question["type"];
                  patch(i, {
                    type,
                    solution:
                      type === "short" ? [""] : type === "essay" ? [] : [0],
                    options:
                      type === "single" || type === "multiple" ? ["", ""] : [],
                  });
                }}
              >
                <option value="single">單選題</option>
                <option value="multiple">複選題</option>
                <option value="short">簡答題</option>
                <option value="essay">申論題</option>
              </select>
              <label className="inline-label">
                配分
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={q.points}
                  onChange={(e) => patch(i, { points: Number(e.target.value) })}
                />
              </label>
              <button
                type="button"
                className="icon-btn"
                aria-label={`刪除題目 ${i + 1}`}
                onClick={() =>
                  setQuestions(questions.filter((_, j) => i !== j))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <textarea
              required
              aria-label={`題目 ${i + 1} 內容`}
              value={q.description}
              onChange={(e) => patch(i, { description: e.target.value })}
              placeholder="請輸入題目內容"
              rows={2}
            />
            {["single", "multiple"].includes(q.type) && (
              <>
                <p className="field-hint">勾選正確答案</p>
                {q.options.map((option, j) => (
                  <div className="option-editor" key={j}>
                    <input
                      aria-label={`題目 ${i + 1} 選項 ${j + 1} 為正確答案`}
                      type={q.type === "single" ? "radio" : "checkbox"}
                      name={"solution-" + i}
                      checked={q.solution?.includes(j) || false}
                      onChange={() =>
                        patch(i, {
                          solution:
                            q.type === "single"
                              ? [j]
                              : q.solution?.includes(j)
                                ? q.solution.filter((s) => s !== j)
                                : [...(q.solution || []), j],
                        })
                      }
                    />
                    <input
                      required
                      aria-label={`題目 ${i + 1} 選項 ${j + 1}`}
                      value={option}
                      onChange={(e) =>
                        patch(i, {
                          options: q.options.map((v, n) =>
                            n === j ? e.target.value : v,
                          ),
                        })
                      }
                      placeholder={`選項 ${j + 1}`}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => patch(i, { options: [...q.options, ""] })}
                >
                  <Plus size={14} />
                  新增選項
                </button>
              </>
            )}
            {q.type === "short" && (
              <label>
                可接受的標準答案（每行一個）
                <textarea
                  required
                  value={q.solution?.join("\n")}
                  onChange={(e) =>
                    patch(i, { solution: e.target.value.split("\n") })
                  }
                />
              </label>
            )}
            {q.type === "essay" && (
              <p className="notice">這一題需要人工評分，可輸入得分及回饋。</p>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn dashed full"
          onClick={() =>
            setQuestions([
              ...questions,
              {
                description: "",
                type: "single",
                options: ["", ""],
                solution: [0],
                points: 10,
              },
            ])
          }
        >
          <Plus size={16} />
          新增題目
        </button>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          發布考試
        </label>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "儲存中…" : "儲存考試"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Exams({
  exams,
  courses,
  user,
  onSaved,
  go,
}: {
  exams: Exam[];
  courses: Course[];
  user: User;
  onSaved: () => void;
  go: (p: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [editing, setEditing] = useState<Exam | null | undefined>(),
    [starting, setStarting] = useState<Exam | null>(null),
    [budget, setBudget] = useState<Exam | null>(null),
    [key, setKey] = useState(""),
    [limit, setLimit] = useState(3),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const manage = user.role !== "learner";
  async function start() {
    if (!starting) return;
    setBusy(true);
    setError("");
    try {
      const a = await api<Attempt>(`exams/${starting.id}/start/`, "POST", {});
      onSaved();
      go("/attempt/" + a.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveBudget(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`exams/${budget!.id}/budget/`, "POST", { key, limit });
      setBudget(null);
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
          <div className="eyebrow">ASSESSMENT CENTER</div>
          <h1>考試與評量</h1>
          <p>獨立規劃每一場評量，讓能力與成果清楚呈現。</p>
        </div>
        {manage && (
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus size={17} />
            建立考試
          </button>
        )}
      </div>
      <div className="summary-strip">
        <div>
          <FileQuestion size={22} />
          <strong>{exams.length}</strong>
          <span>場考試</span>
        </div>
        <div>
          <Target size={22} />
          <strong>{exams.filter((e) => !e.course).length}</strong>
          <span>場獨立評量</span>
        </div>
        <div>
          <Clock3 size={22} />
          <strong>{exams.filter((e) => e.published).length}</strong>
          <span>場已發布</span>
        </div>
      </div>
      <div className="toolbar">
        <h2>
          所有考試 <span className="count">{exams.length}</span>
        </h2>
        <div className="search-field">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="搜尋考試"
            placeholder="搜尋考試名稱…"
          />
        </div>
      </div>
      <ErrorBox message={error} />
      {exams.filter((e) => e.title.includes(search)).length ? (
        <div className="exam-list">
          {exams
            .filter((e) => e.title.includes(search))
            .map((exam) => (
              <article className="exam-card" key={exam.id}>
                <div className="exam-card-icon">
                  <FileQuestion size={26} />
                </div>
                <div className="exam-main">
                  <div className="exam-title">
                    <h2>{exam.title}</h2>
                    <Badge tone={exam.published ? "teal" : "neutral"}>
                      {exam.published ? "已發布" : "草稿"}
                    </Badge>
                    <Badge tone="blue">
                      {exam.course ? "課程評量" : "獨立考試"}
                    </Badge>
                  </div>
                  <p>
                    {exam.description || "請在開始前確認考試時間與作答次數。"}
                  </p>
                  <div className="exam-details">
                    <span>{exam.question_count} 題</span>
                    <span>{exam.duration_minutes} 分鐘</span>
                    <span>及格 {exam.pass_score} 分</span>
                    <span>預設 {exam.max_attempts} 次</span>
                    <span>已使用 {exam.attempts_used} 次</span>
                  </div>
                </div>
                <div className="exam-actions">
                  <button
                    className="btn primary-soft"
                    disabled={!exam.published}
                    onClick={() => {
                      setError("");
                      setStarting(exam);
                    }}
                  >
                    開始／繼續
                    <ArrowRight size={15} />
                  </button>
                  {manage && (
                    <div className="exam-tools">
                      <button
                        title="編輯試卷"
                        aria-label={"編輯 " + exam.title}
                        className="icon-btn"
                        onClick={() => setEditing(exam)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        title="個別次數設定"
                        aria-label={"設定 " + exam.title + " 個別次數"}
                        className="icon-btn"
                        onClick={() => {
                          setError("");
                          setBudget(exam);
                        }}
                      >
                        <Target size={16} />
                      </button>
                      <button
                        title="邀請訪客"
                        aria-label={"邀請 " + exam.title + " 訪客"}
                        className="icon-btn"
                        onClick={() => go("/invitations")}
                      >
                        <Link2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
        </div>
      ) : (
        <Empty title="尚無符合的考試" />
      )}
      {editing !== undefined && (
        <ExamEditor
          exam={editing}
          courses={courses}
          onSaved={onSaved}
          onClose={() => setEditing(undefined)}
        />
      )}{" "}
      {starting && (
        <Modal title="準備開始考試" onClose={() => setStarting(null)}>
          <div className="modal-form">
            <h3>{starting.title}</h3>
            <div className="preflight">
              <div>
                <Clock3 />
                <strong>{starting.duration_minutes} 分鐘</strong>
                <span>作答時間</span>
              </div>
              <div>
                <Target />
                <strong>{starting.pass_score} 分</strong>
                <span>及格標準</span>
              </div>
              <div>
                <FileQuestion />
                <strong>{starting.question_count} 題</strong>
                <span>題目總數</span>
              </div>
            </div>
            <p className="notice">
              開始即使用一次額度。重新整理或返回可繼續未到期的作答；計時不會暫停，到期將依已儲存答案交卷。
            </p>
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="btn" onClick={() => setStarting(null)}>
                稍後再考
              </button>
              <button className="btn primary" disabled={busy} onClick={start}>
                {busy ? "準備中…" : "開始／繼續作答"}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {budget && (
        <Modal title="受測者個別次數" onClose={() => setBudget(null)}>
          <form className="modal-form" onSubmit={saveBudget}>
            <h3>{budget.title}</h3>
            <p className="muted">
              這是該身分的總次數上限，包含帳號登入與所有訪客連結。
            </p>
            <label>
              E-mail、帳號或員工編號
              <input
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <label>
              總次數上限
              <input
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </label>
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="btn primary" disabled={busy}>
                儲存設定
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
