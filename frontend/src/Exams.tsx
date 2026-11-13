import ActionMenu from "./ActionMenu";
import { DeleteTraining } from "./TrainingLifecycle";
import { AssessmentWindow } from "./AssessmentBlock";
import { GradingGuideEditor } from "./GradingGuide";
import QuestionFigureEditor from "./QuestionFigureEditor";
import { questionPayload } from "./QuestionFigure";
import { GroupPicker } from "./Groups";
import { PeoplePicker } from "./PeopleDirectory";
import ExamBudget from "./ExamBudget";
import { useExamPreflight } from "./useExamPreflight";
import { RetryNotice, useRetryAvailability } from "./RetryAvailability";
import { countLabel, t, useLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Search,
  Clock3,
  Target,
  FileQuestion,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import type { Exam, Course, Question, User, Attempt } from "./types";
import { Modal, Badge, ErrorBox, Empty } from "./ui";
import { BankPicker } from "./QuestionBank";
import { questionTypes, questionTypeDefaults } from "./questionTypes";
import StructuredQuestionFields from "./StructuredQuestionFields";
import TextAnswerFields from "./TextAnswerFields";
import ExamPreview from "./ExamPreview";
import ExamMonitor from "./ExamMonitor";
export function ExamEditor({
  exam,
  initialCourseId,
  courses,
  onSaved,
  onClose,
}: {
  exam: Exam | null;
  initialCourseId?: number;
  courses: Course[];
  onSaved: (published?: boolean) => void;
  onClose: () => void;
}) {
  useLocale();
  const [linkOptions, setLinkOptions] = useState<Pick<Course, "id" | "title" | "published">[]>(courses.filter(c => c.can_manage));
  useEffect(() => { api<typeof linkOptions>("exams/link-options/").then(setLinkOptions).catch(e => setError(e.message)); }, []);
  const [audience, setAudience] = useState<Exam["audience"]>(
    exam?.audience || (initialCourseId ? "course" : "all"),
  );
  const [departments, setDepartments] = useState(
    exam?.allowed_departments || [],
  );
  const [people, setPeople] = useState<number[]>(exam?.allowed_users || []);
  const [groups, setGroups] = useState<number[]>(exam?.allowed_groups || []);
  const [shuffleQuestions, setShuffleQuestions] = useState(
    exam?.shuffle_questions || false,
  );
  const [shuffleOptions, setShuffleOptions] = useState(
    exam?.shuffle_options || false,
  );
  const [sample, setSample] = useState(
    exam?.questions_per_attempt?.toString() || "",
  );
  const [renew, setRenew] = useState(!!exam?.attempt_reset_minutes);
  const [renewUnit, setRenewUnit] = useState(!exam?.attempt_reset_minutes || exam.attempt_reset_minutes % 1440 === 0 ? 1440 : exam.attempt_reset_minutes % 60 === 0 ? 60 : 1);
  const [renewValue, setRenewValue] = useState(exam?.attempt_reset_minutes ? exam.attempt_reset_minutes / renewUnit : 1);
  const [options, setOptions] = useState<{
    departments: string[];
    people: Pick<User, "id" | "display_name" | "username" | "department">[];
  }>({ departments: [], people: [] });
  useEffect(() => {
    api<typeof options>("exams/audience-options/?page_size=1")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  const [uploads, setUploads] = useState(0);
  const [title, setTitle] = useState(exam?.title || ""),
    [description, setDescription] = useState(exam?.description || ""),
    [linkedCourses, setLinkedCourses] = useState<number[]>(exam?.courses || (initialCourseId ? [initialCourseId] : [])),
    [minutes, setMinutes] = useState(exam?.duration_minutes || 30),
    [limit, setLimit] = useState(exam?.max_attempts || 2),
    [retryInterval, setRetryInterval] = useState(
      exam?.retry_interval_minutes || 0,
    ),
    [pass, setPass] = useState(exam?.pass_score ?? 70),
    [published, setPublished] = useState(exam?.published || false),
    [allowSkip, setAllowSkip] = useState(exam?.allow_skip ?? true),
    [allowReview, setAllowReview] = useState(
      exam?.allow_response_review ?? true,
    ),
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
    setQuestions(current => current.map((q, j) => (i === j ? { ...q, ...p } : q)));
  }
  const [optionsOpen, setOptionsOpen] = useState(() => !!initialCourseId || !!exam && (
    exam.duration_minutes !== 30 || exam.max_attempts !== 2 || !!exam.retry_interval_minutes || !!exam.attempt_reset_minutes ||
    !!exam.starts_at || !!exam.ends_at || !exam.allow_skip || !exam.allow_response_review || exam.audience !== 'all' ||
    exam.shuffle_questions || exam.shuffle_options || !!exam.questions_per_attempt || !!exam.description || !!exam.courses.length
  ));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    // This editor can be a portal inside the course form.
    e.stopPropagation();
    if (uploads) return;
    setBusy(true);
    setError("");
    try {
      await api(
        exam ? `exams/${exam.id}/` : "exams/",
        exam ? "PATCH" : "POST",
        {
          title,
          description,
          courses: linkedCourses,
          duration_minutes: minutes,
          max_attempts: limit,
          retry_interval_minutes: retryInterval,
          attempt_reset_minutes: renew ? renewValue * renewUnit : 0,
          allow_skip: allowSkip,
          allow_response_review: allowReview,
          pass_score: pass,
          published,
          audience,
          allowed_departments: departments,
          allowed_users: people,
          allowed_groups: groups,
          shuffle_questions: shuffleQuestions,
          shuffle_options: shuffleOptions,
          questions_per_attempt: sample ? Number(sample) : null,
          starts_at: start ? new Date(start).toISOString() : null,
          ends_at: end ? new Date(end).toISOString() : null,
          questions: questions.map((q, i) => ({
            ...questionPayload(q),
            id: undefined,
            position: i,
          })),
        },
      );
      onSaved(published);
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
        exam ? t("Edit exam") : t("Create exam")
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
          <label>
            {t("Passing score") + " "}
            <input
              type="number"
              min={0}
              max={100}
              required
              value={pass}
              onChange={(e) => setPass(Number(e.target.value))}
            />
          </label>
        </div>
        <details className="course-options" open={optionsOpen} onToggle={e => setOptionsOpen(e.currentTarget.open)}>
          <summary>{t("More options")}</summary>
          <div className="form-grid">
          <label className="span-2">
            {t("Instructions") + " "}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </label>
          <div className="span-2">
            <span className="field-label">{t("Linked courses")}</span>
            <div className="heading-actions linked-course-chips">
              {linkedCourses.map(id => {
                const course = linkOptions.find(c => c.id === id) || exam?.course_links.find(c => c.id === id) || courses.find(c => c.id === id);
                return <span className="badge neutral" key={id}>{course?.title || t("Current linked course")}
                  {linkOptions.some(c => c.id === id) && <button type="button" className="icon-btn" aria-label={t("Remove {title}", {title: course?.title || String(id)})} onClick={() => setLinkedCourses(ids => ids.filter(value => value !== id))}>×</button>}
                </span>;
              })}
            </div>
            {linkedCourses.length > 0 && <p className="muted">{t(audience === "invitation" ? "Invitation only: participants of linked courses can't take this exam." : audience === "course" ? "Approved participants of linked courses can take this exam." : audience === "all" ? "Everyone with an account can take this exam once it is published, not only course participants." : "Approved participants of linked courses can also take this exam.")}</p>}
            <label>{t("Add course")}
              <select value="" onChange={e => { if (e.target.value) setLinkedCourses(ids => [...ids, Number(e.target.value)]); }}>
                <option value="">{t("Choose a course")}</option>
                {linkOptions.filter(c => !linkedCourses.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
          </div>
          <label>
            {t("Minutes allowed") + " "}
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
            {t(renew ? "Attempts per round" : "Attempts allowed") + " "}
            <input
              type="number"
              min={1}
              max={100}
              required
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            />
          </label>

          <label className="span-2">
            {t("Retry wait (minutes)")}
            <input
              type="number"
              min={0}
              max={525600}
              step={1}
              required
              value={retryInterval}
              onChange={(e) => setRetryInterval(Number(e.target.value))}
            />
            <span className="field-hint">
              {t(
                "Wait from the last start; 0 means no wait.",
              )}
            </span>
          </label>
          <div className="form-section span-2">
            <label className="checkbox-label"><input type="checkbox" checked={renew} onChange={e => setRenew(e.target.checked)} />{t("Renew failed rounds")}</label>
            {renew && <><div className="form-grid"><label>{t("Renewal wait")}<input type="number" min={1} max={Math.floor(525600/renewUnit)} step={1} required value={renewValue} onChange={e => setRenewValue(Number(e.target.value))} /></label><label>{t("Waiting period unit")}<select value={renewUnit} onChange={e => {setRenewUnit(Number(e.target.value));setRenewValue(1);}}><option value={1}>{t("Minutes")}</option><option value={60}>{t("Hours")}</option><option value={1440}>{t("Days")}</option></select></label></div><p className="field-hint">{t("After {count} graded failures, renew in {duration} {unit}; results stay saved.", {count: limit, duration: renewValue, unit: t(renewUnit === 1440 ? "Days" : renewUnit === 60 ? "Hours" : "Minutes")})}</p></>}
          </div>
          <label>
            {t("Opens at") + " "}
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            {t("Closes at") + " "}
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <div className="exam-randomization">
          <h3>{t("Navigation and review")}</h3>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={allowSkip}
              onChange={(event) => setAllowSkip(event.target.checked)}
            />
            {t("Allow skipping")}
          </label>
          {!allowSkip && <p className="field-hint">
            {t(
              "New attempts require each answer before the next question.",
            )}
          </p>}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={allowReview}
              onChange={(event) => setAllowReview(event.target.checked)}
            />
            {t("Allow response review")}
          </label>
          {!allowReview && <p className="field-hint">
            {t(
              "Hides responses from learners; scores and instructor access remain.",
            )}
          </p>}
        </div>
        <div className="form-section">
          <h3>{t("Exam audience")}</h3>
          <p>
            {t(
              "Applies to new attempts; invitations and active attempts keep access.",
            )}
          </p>
        </div>
        <label>
          {t("Audience")}
          <select
            aria-label={t("Audience")}
            value={audience}
            onChange={(e) => setAudience(e.target.value as Exam["audience"])}
          >
            {(
              [
                ["all", "Everyone with an account"],
                ["course", "Linked course participants only"],
                ["employees", "Employees"],
                ["contractors", "Contractors"],
                ["departments", "Selected departments"],
                ["people", "Selected people"],
                ["groups", "Groups"],
                ["invitation", "Invitation only"],
              ] as const
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        {audience === "course" && <>
          <p className="field-hint">{t("Approved participants of the linked courses can take it, plus anyone you assign or invite.")}</p>
          {!linkedCourses.length && <p className="field-hint">{t("Link a course, or only people you assign or invite can take it.")}</p>}
        </>}
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
        {audience === "people" && <PeoplePicker selected={people} onChange={setPeople} />}
        {audience === 'groups' && <><GroupPicker selected={groups} onChange={setGroups} /><p className="muted">{t('Active group members and assigned people can take this exam.')}</p></>}

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
            {t("Questions per attempt")}
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
              "Leave blank for all questions; resumed attempts keep their order.",
            )}
          </p>
        </div>
        </details>
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
              "Only essays need manual grading.",
            )}
          </p>
        </div>
        <BankPicker
          disabled={uploads > 0}
          onAdd={(items) =>
            setQuestions((current) =>
              current.length === 1 && !current[0].description
                ? items
                : [...current, ...items],
            )
          }
        />
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
                  patch(i, questionTypeDefaults(type));
                }}
              >
                {questionTypes().map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
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
                disabled={uploads > 0}
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
            <QuestionFigureEditor question={q} onChange={values => patch(i, values)}
              onBusyChange={delta => setUploads(current => current + delta)} />
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
              <TextAnswerFields
                question={q}
                onChange={(values) => patch(i, values)}
              />
            )}
            <StructuredQuestionFields
              question={q}
              onChange={(values) => patch(i, values)}
            />
            <GradingGuideEditor question={q} onChange={values => patch(i, values)} />
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
          <button className="btn primary" disabled={busy || uploads > 0}>
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
    [previewing, setPreviewing] = useState<number | null>(null),
    [monitoring, setMonitoring] = useState<number | null>(null),
    [starting, setStarting] = useState<Exam | null>(null),
    [budget, setBudget] = useState<Exam | null>(null),
    [key, setKey] = useState(""),
    [limit, setLimit] = useState(3),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const courseParam = new URLSearchParams(window.location.search).get("course") || "";
  const linkedCourseId = /^[1-9]\d*$/.test(courseParam) ? Number(courseParam) : null;
  if (linkedCourseId) exams = exams.filter(e => e.courses.includes(linkedCourseId));
  const manage = user.access.exams !== "none";
  const openedLink = useRef(false);
  useEffect(() => {
    const destination = new URLSearchParams(window.location.search);
    const selected = exams.find(exam => exam.id === Number(destination.get("exam")));
    if (openedLink.current) return;
    if (selected && !destination.get("action")) {
      if (!selected.can_manage && selected.available_to_me) {
        openedLink.current = true;
        if (!selected.active_attempt_id && selected.last_result) go(`/attempt/${selected.last_result.id}`);
        else setStarting(selected);
      }
      return;
    }
    if (selected?.available_to_me && destination.get("action") === "start") {
      openedLink.current = true; setStarting(selected); return;
    }
    if (selected?.can_manage && destination.get("action") === "preview") {
      openedLink.current = true; setPreviewing(selected.id); return;
    }
    const params = new URLSearchParams(window.location.search);
    if (manage && params.get("action") === "create") {
      openedLink.current = true;
      setEditing(null);
      return;
    }
    const target = exams.find(exam => exam.id === Number(params.get("exam")));
    if (target?.can_manage && params.get("action") === "edit") {
      openedLink.current = true;
      setEditing(target);
    }
  }, [exams, manage]);
  const visibleExams = exams.filter(e => manage ? e.can_manage : e.published);
  const preflight = useExamPreflight(starting?.id);
  const waiting = useRetryAvailability(preflight.exam);
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
      preflight.refresh();
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
      {monitoring !== null && (
        <ExamMonitor
          id={monitoring}
          userId={user.id}
          onClose={() => setMonitoring(null)}
        />
      )}
      {previewing !== null && (
        <ExamPreview
          id={previewing}
          onClose={() => setPreviewing(null)}
          go={go}
        />
      )}
      <div className="page-heading">
        <div>

          <h1>{t(linkedCourseId ? "Course assessment" : "Exams")}</h1>

        </div>
        {manage && (
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus size={17} />
            {t("New exam")}
          </button>
        )}
      </div>
      {linkedCourseId && <button className="text-btn" onClick={() => go("/courses")}>{t("Back to courses")}</button>}
      {visibleExams.length > 8 && <div className="toolbar">
        <div className="search-field">
          <Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} aria-label={t('Search exams')} placeholder={t('Search exam titles…')}/>
        </div>
      </div>}
      <ErrorBox message={error} />
      {visibleExams.filter((e) => e.title.toLowerCase().includes(search.toLowerCase())).length ? (
        <div className={manage ? "exam-list exam-manage-list" : "exam-list"}>
          {visibleExams
            .filter((e) => e.title.toLowerCase().includes(search.toLowerCase()))
            .map((exam) => (
              <article className="exam-card" key={exam.id}>
                <div className="exam-main">
                  <div className="exam-title"><h2>{exam.title}</h2>
                    {!exam.published && <Badge tone="neutral">{t('Draft')}</Badge>}
                  </div>
                  <div className="exam-details">{countLabel(exam.question_count, '{count} question', '{count} questions')}</div>
                  {exam.published && <AssessmentWindow exam={exam}/>}
                  {!manage && exam.available_to_me && <RetryNotice value={exam}/>}
                </div>
                <div className="exam-actions">
                  {!manage && exam.available_to_me && <button className="btn" disabled={!exam.published || (exam.attempts_remaining === 0 && !exam.active_attempt_id && !exam.next_round_at && !exam.round_awaiting_grading)} onClick={() => {setError(''); setStarting(exam);}}>{t('Start / resume')}</button>}
                  {exam.can_manage && <>
                    <button className="btn" aria-label={t("Edit ") + exam.title} onClick={() => setEditing(exam)}>{t('Edit')}</button>
                    <ActionMenu title={exam.title}>
                      {!exam.published && <button type="button" disabled={busy || !exam.question_count} onClick={async () => {
                        setBusy(true); setError('');
                        try {await api(`exams/${exam.id}/`, 'PATCH', {published: true}); onSaved();}
                        catch (e) {setError((e as Error).message);} finally {setBusy(false);}
                      }}>{t('Publish exam')}</button>}
                      <button type="button" onClick={() => setPreviewing(exam.id)}>{t('Preview exam')}</button>
                      {exam.published && exam.can_view_results && <button type="button" onClick={() => setMonitoring(exam.id)}>{t('Live exam monitor')}</button>}
                      {exam.published && <button type="button" onClick={() => {setError(''); setBudget(exam);}}>{t('Individual attempt limits')}</button>}
                      {exam.published && user.access.invitations && <button type="button" onClick={() => go('/invitations')}>{t('Invite guest')}</button>}
                      <DeleteTraining kind="exam" target={exam} onDeleted={onSaved} />
                    </ActionMenu>
                  </>}
                </div>
              </article>
            ))}
        </div>
      ) : (
        <Empty title={t("No matching exams")} description="" />
      )}
      {editing !== undefined && (
        <ExamEditor
          exam={editing}
          initialCourseId={courses.find(c => c.can_manage && c.id === Number(new URLSearchParams(window.location.search).get("course")))?.id}
          courses={courses}
          onSaved={() => onSaved()}
          onClose={() => setEditing(undefined)}
        />
      )}{" "}
      {starting && (
        <Modal title={t("Ready to start?")} onClose={() => setStarting(null)}>
          <div className="modal-form">
            <h3>{starting.title}</h3>
            {starting.description && <p className="preserve-lines">{starting.description}</p>}
            <div className="preflight">
              <div>
                <Clock3 />
                <strong>
                  {countLabel(starting.duration_minutes, "{count} minute", "{count} minutes")}
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
                  {countLabel(starting.question_count, "{count} question", "{count} questions")}
                </strong>
                <span>{t("Total questions")}</span>
              </div>
            </div>
            {preflight.exam && <><ExamBudget exam={preflight.exam} /><AssessmentWindow exam={preflight.exam}/></>}
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
            <p className="notice">
              {t(
                "Starting uses one attempt; returning resumes it. The timer never pauses. Saved answers submit when time ends.",
              ) + " "}
            </p>
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="btn" onClick={() => setStarting(null)}>
                {t("Take it later") + " "}
              </button>
              <button
                className="btn primary"
                disabled={
                  busy ||
                  preflight.loading ||
                  !preflight.exam ||
                  !preflight.exam.available_to_me ||
                  (!preflight.exam.active_attempt_id && (
                    (!!preflight.exam.starts_at && Date.parse(preflight.exam.starts_at) > Date.now()) ||
                    (!!preflight.exam.ends_at && Date.parse(preflight.exam.ends_at) <= Date.now())
                  )) ||
                  waiting ||
                  (preflight.exam.attempts_remaining === 0 &&
                    !preflight.exam.active_attempt_id)
                }
                onClick={start}
              >
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
