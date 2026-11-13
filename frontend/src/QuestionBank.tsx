import { GradingGuideEditor } from "./GradingGuide";
import QuestionFigureEditor from "./QuestionFigureEditor";
import QuestionFigure, { QuestionContent, questionPayload } from "./QuestionFigure";
import { useEffect, useState } from "react";
import { Plus, Search, Pencil, LibraryBig } from "lucide-react";
import { api } from "./api";
import { t, useLocale } from "./i18n";
import type { Question } from "./types";
import { Badge, Empty, ErrorBox, Modal } from "./ui";
import { questionTypes, questionTypeDefaults } from "./questionTypes";
import StructuredQuestionFields from "./StructuredQuestionFields";
import TextAnswerFields from "./TextAnswerFields";
export type BankQuestion = Question & {
  id: number;
  category: string;
  archived: boolean;
};

export function BankPicker({
  onAdd,
  disabled = false,
}: {
  onAdd: (questions: Question[]) => void;
  disabled?: boolean;
}) {
  useLocale();
  const [rows, setRows] = useState<BankQuestion[]>([]),
    [selected, setSelected] = useState<number[]>([]),
    [search, setSearch] = useState("");
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setOpen(!open);
    if (!open)
      try {
        setRows(
          (await api<BankQuestion[]>("question-bank/")).filter(
            (q) => !q.archived,
          ),
        );
      } catch (e) {
        setError((e as Error).message);
      }
  }
  return (
    <section className="bank-picker">
      <button type="button" className="btn" onClick={load} disabled={disabled}>
        <LibraryBig size={16} />
        {t("Add from question bank")}
      </button>
      {open && (
        <Modal
          title={t("Add from question bank")}
          onClose={() => setOpen(false)}
          wide
        >
          <div className="bank-picker-body">
            <input
              aria-label={t("Search question bank")}
              placeholder={t("Search question bank")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="bank-picker-list">
              {rows
                .filter((q) =>
                  (q.description + q.category)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((q) => (
                  <div className="bank-picker-question" key={q.id}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={selected.includes(q.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, q.id]
                            : selected.filter((id) => id !== q.id),
                        )
                      }
                    />
                    <span>
                      <span className="preserve-lines">{q.description}</span>
                      <small className="cell-note">
                        {q.category} · {q.points} {t("points")}
                      </small>
                    </span>
                  </label>
                  <QuestionFigure question={q} />
                  </div>
                ))}
              {!rows.length && (
                <p>
                  {t("Create reusable questions in the question bank first.")}
                </p>
              )}
            </div>
            <ErrorBox message={error} />
            <button
              type="button"
              className="btn primary"
              disabled={!selected.length}
              onClick={() => {
                onAdd(
                  rows
                    .filter((q) => selected.includes(q.id))
                    .map((q) => ({
                      description: q.description,
                      type: q.type,
                      options: [...q.options],
                      solution: [...(q.solution || [])],
                      answer_tolerances: [...(q.answer_tolerances || [])],
                      answer_matching: [...(q.answer_matching || [])],
                      points: q.points,
                      grading_guide: q.grading_guide,
                      figure: q.figure,
                      figure_alt: q.figure_alt,
                      figure_caption: q.figure_caption,
                    })),
                );
                setSelected([]);
                setOpen(false);
              }}
            >
              {t("Add selected questions")} ({selected.length})
            </button>
            <p className="notice">
              {t(
                "Questions are copied into this exam. Later bank edits do not change existing exams or attempts.",
              )}
            </p>
          </div>
        </Modal>
      )}
    </section>
  );
}

export default function QuestionBank() {
  useLocale();
  const [rows, setRows] = useState<BankQuestion[]>([]),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<BankQuestion | null | undefined>(),
    [error, setError] = useState("");
  const load = () =>
    api<BankQuestion[]>("question-bank/")
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const visible = rows.filter(
    (q) =>
      q.archived === archived &&
      (q.description + q.category).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>

          <h1>{t("Question bank")}</h1>

        </div>
        <button className="btn primary" onClick={() => setEditing(null)}>
          <Plus size={17} />
          {t("Create question")}
        </button>
      </div>
      <div className="toolbar">
        <div className="tabs">
          <button
            className={!archived ? "active" : ""}
            onClick={() => setArchived(false)}
          >
            {t("Active questions")}
          </button>
          <button
            className={archived ? "active" : ""}
            onClick={() => setArchived(true)}
          >
            {t("Archived")}
          </button>
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label={t("Search question bank")}
            placeholder={t("Search question bank")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("Question")}</th>
                <th>{t("Category")}</th>
                <th>{t("Question type")}</th>
                <th>{t("Points")}</th>
                <th>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((q) => (
                <tr key={q.id}>
                  <td className="bank-description"><QuestionContent question={q} heading="span" /></td>
                  <td>
                    <Badge tone="blue">{q.category}</Badge>
                  </td>
                  <td>
                    {questionTypes().find(([key]) => key === q.type)?.[1]}
                  </td>
                  <td>{q.points}</td>
                  <td>
                    <button className="text-btn" onClick={() => setEditing(q)}>
                      <Pencil size={14} />
                      {t("Edit")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <Empty
            title={t("No questions to show")}

          />
        )}
      </div>
      {editing !== undefined && (
        <BankEditor
          question={editing}
          onClose={() => setEditing(undefined)}
          onSaved={load}
        />
      )}
    </>
  );
}

function BankEditor({
  question,
  onClose,
  onSaved,
}: {
  question: BankQuestion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  useLocale();
  const [uploads, setUploads] = useState(0);
  const [draft, setDraft] = useState<
    Question & { category: string; archived: boolean }
  >(
    question || {
      description: "",
      type: "single",
      options: ["", ""],
      solution: [0],
      points: 10,
      category: t("General training"),
      archived: false,
    },
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function patch(values: Partial<typeof draft>) {
    setDraft((d) => ({ ...d, ...values }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (uploads) return;
    setBusy(true);
    setError("");
    try {
      await api(
        question ? `question-bank/${question.id}/` : "question-bank/",
        question ? "PATCH" : "POST",
        questionPayload(draft),
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
      title={question ? t("Edit question") : t("Create question")}
      onClose={onClose}
      wide
    >
      <form className="modal-form" onSubmit={save}>
        <div className="form-grid">
          <label>
            {t("Category")}
            <input
              required
              maxLength={100}
              value={draft.category}
              onChange={(e) => patch({ category: e.target.value })}
            />
          </label>
          <label>
            {t("Question type")}
            <select
              value={draft.type}
              onChange={(e) => {
                const type = e.target.value as Question["type"];
                patch(questionTypeDefaults(type));
              }}
            >
              {questionTypes().map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Points")}
            <input
              required
              type="number"
              min={1}
              max={10000}
              value={draft.points}
              onChange={(e) => patch({ points: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          {t("Question text")}
          <textarea
            required
            rows={4}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>
        <QuestionFigureEditor question={draft} onChange={patch}
          onBusyChange={delta => setUploads(current => current + delta)} />
        {(draft.type === "single" || draft.type === "multiple") && (
          <>
            <p className="notice">
              {t("Select the correct answer or answers.")}
            </p>
            {draft.options.map((option, i) => (
              <div className="bank-option" key={i}>
                <input
                  aria-label={t("Correct option {number}", { number: i + 1 })}
                  type={draft.type === "single" ? "radio" : "checkbox"}
                  name="correct-answer"
                  checked={draft.solution?.includes(i) || false}
                  onChange={(e) =>
                    patch({
                      solution:
                        draft.type === "single"
                          ? [i]
                          : e.target.checked
                            ? [...(draft.solution || []), i]
                            : draft.solution?.filter((v) => v !== i),
                    })
                  }
                />
                <input
                  required
                  maxLength={4000}
                  aria-label={t("Option {number}", { number: i + 1 })}
                  value={option}
                  onChange={(e) =>
                    patch({
                      options: draft.options.map((v, index) =>
                        index === i ? e.target.value : v,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="text-btn"
                  disabled={draft.options.length <= 2}
                  onClick={() =>
                    patch({
                      options: draft.options.filter((_, j) => j !== i),
                      solution: (draft.solution || [])
                        .filter((v) => v !== i)
                        .map((v) => (Number(v) > i ? Number(v) - 1 : v)),
                    })
                  }
                >
                  {t("Remove")}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn"
              disabled={draft.options.length >= 20}
              onClick={() => patch({ options: [...draft.options, ""] })}
            >
              {t("Add option")}
            </button>
          </>
        )}
        {draft.type === "short" && (
          <TextAnswerFields question={draft} onChange={patch} />
        )}
        <StructuredQuestionFields question={draft} onChange={patch} />
        <GradingGuideEditor question={draft} onChange={patch} />
        {question && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.archived}
              onChange={(e) => patch({ archived: e.target.checked })}
            />
            {t("Archive this question")}
          </label>
        )}
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button className="btn primary" disabled={busy || uploads > 0}>
            {busy ? t("Saving…") : t("Save question")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
