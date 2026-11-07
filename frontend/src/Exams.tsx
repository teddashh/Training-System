import { t, useLocale } from "./i18n";
import { useEffect, useState } from "react";
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
import { BankPicker } from "./QuestionBank";
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
  useLocale();
  const [audience, setAudience] = useState<Exam["audience"]>(
    exam?.audience || "all",
  );
  const [departments, setDepartments] = useState(
    exam?.allowed_departments || [],
  );
  const [people, setPeople] = useState<number[]>(exam?.allowed_users || []);
  const [shuffleQuestions, setShuffleQuestions] = useState(
    exam?.shuffle_questions || false,
  );
  const [shuffleOptions, setShuffleOptions] = useState(
    exam?.shuffle_options || false,
  );
  const [sample, setSample] = useState(
    exam?.questions_per_attempt?.toString() || "",
  );
  const [options, setOptions] = useState<{
    departments: string[];
    people: Pick<User, "id" | "display_name" | "username" | "department">[];
  }>({ departments: [], people: [] });
  useEffect(() => {
    api<typeof options>("exams/audience-options/")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
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
          audience,
          allowed_departments: departments,
          allowed_users: people,
          shuffle_questions: shuffleQuestions,
          shuffle_options: shuffleOptions,
          questions_per_attempt: sample ? Number(sample) : null,
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
      title={
        exam ? t("Edit exam") : t("Create standalone exam / course assessment")
      }
      onClose={onClose}
      wide
    >
      <form className="modal-form" onSubmit={save}>
        <div className="form-grid">
          <label className="span-2">
            {t("Exam title") + " "}
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </label>
          <label className="span-2">
            {t("Instructions") + " "}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </label>
          <label>
            {t("Linked course") + " "}
            <select value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">{t("Standalone exam (no course)")}</option>
              {courses
                .filter((c) => c.can_manage)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("Time allowed (minutes)") + " "}
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
            {t("Default attempts per participant") + " "}
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
            {t("Passing score (out of 100)") + " "}
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
            {t("Opens at (optional)") + " "}
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            {t("Closes at (optional)") + " "}
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <div className="form-section">
          <h3>{t("Exam audience")}</h3>
          <p>
            {t(
              "Audience rules apply to new account attempts. Personal invitations grant access separately; existing attempts remain available.",
            )}
          </p>
        </div>
        <label>
          {t("Who can take this exam?")}
          <select
            aria-label={t("Who can take this exam?")}
            value={audience}
            onChange={(e) => setAudience(e.target.value as Exam["audience"])}
          >
            {(
              [
                ["all", "Everyone with an account"],
                ["employees", "Employees"],
                ["contractors", "Contractors"],
                ["departments", "Selected departments"],
                ["people", "Selected people"],
                ["invitation", "Invitation only"],
              ] as const
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        {audience === "departments" && (
          <fieldset className="audience-options">
            <legend>{t("Selected departments")}</legend>
            {[...new Set([...options.departments, ...departments])].map(
              (name) => (
                <label className="checkbox" key={name}>
                  <input
                    type="checkbox"
                    checked={departments.includes(name)}
                    onChange={(e) =>
                      setDepartments(
                        e.target.checked
                          ? [...departments, name]
                          : departments.filter((d) => d !== name),
                      )
                    }
                  />
                  {name}
                </label>
              ),
            )}
            {!options.departments.length && !departments.length && (
              <p>
                {t("Assign departments to people before using this audience.")}
              </p>
            )}
          </fieldset>
        )}
        {audience === "people" && (
          <fieldset className="audience-options">
            <legend>{t("Selected people")}</legend>
            {options.people.map((person) => (
              <label className="checkbox" key={person.id}>
                <input
                  type="checkbox"
                  checked={people.includes(person.id)}
                  onChange={(e) =>
                    setPeople(
                      e.target.checked
                        ? [...people, person.id]
                        : people.filter((id) => id !== person.id),
                    )
                  }
                />
                {person.display_name || person.username}{" "}
                {person.department && `· ${person.department}`}
              </label>
            ))}
          </fieldset>
        )}
        <div className="form-section">
          <h3>
            {t("Exam questions") + " "}
            <Badge tone="neutral">
              {questions.length}
              {" " + t("questions")}
            </Badge>
          </h3>
          <p>
            {t(
              "Choice and short-answer questions are graded automatically. Written responses are reviewed by an instructor.",
            )}
          </p>
        </div>
        <BankPicker
          onAdd={(items) =>
            setQuestions((current) =>
              current.length === 1 && !current[0].description
                ? items
                : [...current, ...items],
            )
          }
        />
        <div className="exam-randomization">
          <h3>{t("Exam variation")}</h3>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={shuffleQuestions}
              onChange={(e) => setShuffleQuestions(e.target.checked)}
            />
            {t("Shuffle question order")}
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={shuffleOptions}
              onChange={(e) => setShuffleOptions(e.target.checked)}
            />
            {t("Shuffle answer options")}
          </label>
          <label>
            {t("Questions per attempt (blank uses all)")}
            <input
              type="number"
              min={1}
              max={questions.length}
              value={sample}
              onChange={(e) => setSample(e.target.value)}
            />
          </label>
          <p className="notice">
            {t(
              "A random subset is selected when an attempt starts. Its questions and option order stay fixed when resumed.",
            )}
          </p>
        </div>
        {questions.map((q, i) => (
          <div className="question-editor" key={i}>
            <div className="question-toolbar">
              <strong>
                {t("Question") + " "}
                {i + 1}
              </strong>
              <select
                aria-label={t("Question {v0} type", { v0: i + 1 })}
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
                <option value="single">{t("Single choice")}</option>
                <option value="multiple">{t("Multiple choice")}</option>
                <option value="short">{t("Short answer")}</option>
                <option value="essay">{t("Written response")}</option>
              </select>
              <label className="inline-label">
                {t("Points") + " "}
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
                aria-label={t("Delete question {v0}", { v0: i + 1 })}
                onClick={() =>
                  setQuestions(questions.filter((_, j) => i !== j))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <textarea
              required
              aria-label={t("Question {v0} content", { v0: i + 1 })}
              value={q.description}
              onChange={(e) => patch(i, { description: e.target.value })}
              placeholder={t("Enter the question")}
              rows={2}
            />
            {["single", "multiple"].includes(q.type) && (
              <>
                <p className="field-hint">{t("Select the correct answers")}</p>
                {q.options.map((option, j) => (
                  <div className="option-editor" key={j}>
                    <input
                      aria-label={t("Question {v0} option {v1} is correct", {
                        v0: i + 1,
                        v1: j + 1,
                      })}
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
                      aria-label={t("Question {v0} option {v1}", {
                        v0: i + 1,
                        v1: j + 1,
                      })}
                      value={option}
                      onChange={(e) =>
                        patch(i, {
                          options: q.options.map((v, n) =>
                            n === j ? e.target.value : v,
                          ),
                        })
                      }
                      placeholder={t("Option {v0}", { v0: j + 1 })}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => patch(i, { options: [...q.options, ""] })}
                >
                  <Plus size={14} />
                  {t("Add option") + " "}
                </button>
              </>
            )}
            {q.type === "short" && (
              <label>
                {t("Accepted answers (one per line)") + " "}
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
              <p className="notice">
                {t(
                  "This question needs manual grading, with points and feedback.",
                )}
              </p>
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
          {t("Add question") + " "}
        </button>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          {t("Publish exam") + " "}
        </label>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel") + " "}
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? t("Saving\u2026") : t("Save exam")}
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
  useLocale();
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
          <div className="eyebrow">{t("ASSESSMENT CENTER")}</div>
          <h1>{t("Exams & assessments")}</h1>
          <p>
            {t("Plan assessments independently and make progress visible.")}
          </p>
        </div>
        {manage && (
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus size={17} />
            {t("Create exam") + " "}
          </button>
        )}
      </div>
      <div className="summary-strip">
        <div>
          <FileQuestion size={22} />
          <strong>{exams.length}</strong>
          <span>{t("exams")}</span>
        </div>
        <div>
          <Target size={22} />
          <strong>{exams.filter((e) => !e.course).length}</strong>
          <span>{t("standalone assessments")}</span>
        </div>
        <div>
          <Clock3 size={22} />
          <strong>{exams.filter((e) => e.published).length}</strong>
          <span>{t("published")}</span>
        </div>
      </div>
      <div className="toolbar">
        <h2>
          {t("All exams") + " "}
          <span className="count">{exams.length}</span>
        </h2>
        <div className="search-field">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("Search exams")}
            placeholder={t("Search exam titles\u2026")}
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
                      {exam.published ? t("Published") : t("Draft")}
                    </Badge>
                    <Badge tone="blue">
                      {exam.course
                        ? t("Course assessment")
                        : t("Standalone exam")}
                    </Badge>
                  </div>
                  <p>
                    {exam.description ||
                      t(
                        "Check the time limit and available attempts before starting.",
                      )}
                  </p>
                  <div className="exam-details">
                    <span>
                      {exam.question_count}
                      {" " + t("questions")}
                    </span>
                    <span>
                      {exam.duration_minutes}
                      {" " + t("min")}
                    </span>
                    <span>
                      {t("Pass") + " "}
                      {exam.pass_score}
                      {" " + t("points")}
                    </span>
                    <span>
                      {t("Default") + " "}
                      {exam.max_attempts}
                      {" " + t("attempts")}
                    </span>
                    <span>
                      {t("Used") + " "}
                      {exam.attempts_used}
                      {" " + t("attempts")}
                    </span>
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
                    {t("Start / resume") + " "}
                    <ArrowRight size={15} />
                  </button>
                  {exam.can_manage && (
                    <div className="exam-tools">
                      <button
                        title={t("Edit questions")}
                        aria-label={t("Edit ") + exam.title}
                        className="icon-btn"
                        onClick={() => setEditing(exam)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        title={t("Individual attempt limits")}
                        aria-label={
                          t("Set ") + exam.title + t(" attempt limit")
                        }
                        className="icon-btn"
                        onClick={() => {
                          setError("");
                          setBudget(exam);
                        }}
                      >
                        <Target size={16} />
                      </button>
                      <button
                        title={t("Invite guest")}
                        aria-label={t("Invite ") + exam.title + t(" guests")}
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
        <Empty title={t("No matching exams")} />
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
        <Modal title={t("Ready to start?")} onClose={() => setStarting(null)}>
          <div className="modal-form">
            <h3>{starting.title}</h3>
            <div className="preflight">
              <div>
                <Clock3 />
                <strong>
                  {starting.duration_minutes}
                  {" " + t("min")}
                </strong>
                <span>{t("Time allowed")}</span>
              </div>
              <div>
                <Target />
                <strong>
                  {starting.pass_score}
                  {" " + t("points")}
                </strong>
                <span>{t("Passing score")}</span>
              </div>
              <div>
                <FileQuestion />
                <strong>
                  {starting.question_count}
                  {" " + t("questions")}
                </strong>
                <span>{t("Total questions")}</span>
              </div>
            </div>
            <p className="notice">
              {t(
                "Starting uses one attempt. Refreshing or returning resumes an active attempt. The timer does not pause; saved answers are submitted when time runs out.",
              ) + " "}
            </p>
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="btn" onClick={() => setStarting(null)}>
                {t("Take it later") + " "}
              </button>
              <button className="btn primary" disabled={busy} onClick={start}>
                {busy ? t("Preparing\u2026") : t("Start / resume attempt")}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {budget && (
        <Modal
          title={t("Participant attempt limit")}
          onClose={() => setBudget(null)}
        >
          <form className="modal-form" onSubmit={saveBudget}>
            <h3>{budget.title}</h3>
            <p className="muted">
              {t(
                "This is the total limit for this identity, including account access and all guest links.",
              ) + " "}
            </p>
            <label>
              {t("Email, username or employee ID") + " "}
              <input
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <label>
              {t("Total attempt limit") + " "}
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
                {t("Save settings") + " "}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
