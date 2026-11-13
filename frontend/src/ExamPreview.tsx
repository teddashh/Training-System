import { formatDateTime } from "./datetime";
import { GradingGuide } from "./GradingGuide";
import { QuestionContent } from "./QuestionFigure";
import { useEffect, useState } from "react";
import { api } from "./api";
import { t, useLocale } from "./i18n";
import type { Attempt, Exam } from "./types";
import { acceptedAnswerText, questionTypes } from "./questionTypes";
import { Badge, ErrorBox, Modal, Spinner } from "./ui";

type SavedPreview = {
  id: string;
  mode: "learner" | "unrestricted";
  status: string;
  started_at: string;
  expires_at: string;
};

export default function ExamPreview({
  id,
  onClose,
  go,
}: {
  id: number;
  onClose: () => void;
  go: (path: string) => void;
}) {
  const locale = useLocale();
  const [exam, setExam] = useState<Exam | null>(null),
    [saved, setSaved] = useState<SavedPreview[]>([]),
    [showKey, setShowKey] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api<Exam>(`exams/${id}/`),
      api<SavedPreview[]>(`exams/${id}/previews/`),
    ])
      .then(([exam, saved]) => {
        if (alive) {
          setExam(exam);
          setSaved(saved);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  async function start(mode: SavedPreview["mode"]) {
    setBusy(true);
    setError("");
    try {
      const result = await api<Attempt>(`exams/${id}/previews/`, "POST", {
        mode,
      });
      go(`/preview/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(preview: SavedPreview) {
    setBusy(true);
    setError("");
    try {
      await api(`previews/${preview.id}/`, "DELETE");
      setSaved((items) => items.filter((item) => item.id !== preview.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("Preview exam")} onClose={onClose} wide>
      <div className="modal-form">
        <ErrorBox message={error} />
        {!exam ? (
          !error && <Spinner />
        ) : (
          <>
            <h3>{exam.title}</h3>
            {exam.starts_at && <p className="muted">{t('Opens at')}: {formatDateTime(exam.starts_at, locale)}</p>}
            {exam.ends_at && <p className="muted">{t('Closes at')}: {formatDateTime(exam.ends_at, locale)}</p>}
            <p className="notice exam-policy-notice">
              {t(
                "Private test. No participant attempts, results or training completion are recorded.",
              )}
            </p>
            <div className="preview-modes">
              <section>
                <h3>{t("Learner simulation")}</h3>
                <p>
                  {t(
                    "Uses the open window, timer, navigation and review settings. Audience, attempt limits and retry waits are not tested.",
                  )}
                </p>
                <button
                  className="btn primary"
                  disabled={busy || !exam.question_count}
                  onClick={() => start("learner")}
                >
                  {t("Start learner simulation")}
                </button>
              </section>
              <section>
                <h3>{t("Untimed test")}</h3>
                <p>
                  {t(
                    "Test drafts or closed exams without a timer. Question selection, navigation and grading rules still apply.",
                  )}
                </p>
                <button
                  className="btn"
                  disabled={busy || !exam.question_count}
                  onClick={() => start("unrestricted")}
                >
                  {t("Start untimed test")}
                </button>
              </section>
            </div>
            <section aria-label={t("Saved previews")}>
              <h3>{t("Saved previews")}</h3>
              <p className="field-hint">
                {t("Saved previews are deleted after seven days.")}
              </p>
              {!saved.length && <p>{t("No saved previews yet.")}</p>}
              {saved.map((item) => (
                <div className="preview-session" key={item.id}>
                  <div>
                    <strong>
                      {item.mode === "learner"
                        ? t("Learner simulation")
                        : t("Untimed test")}
                    </strong>
                    <small>
                      {new Date(item.started_at).toLocaleString(locale)} ·{" "}
                      {item.status === "in_progress"
                        ? t("In progress")
                        : item.status === "pending_review"
                          ? t("Pending review")
                          : t("Graded")}
                    </small>
                  </div>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => go(`/preview/${item.id}`)}
                  >
                    {t("Open preview")}
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => remove(item)}
                  >
                    {t("Delete preview")}
                  </button>
                </div>
              ))}
            </section>
            <section aria-label={t("Question paper")}>
              <h3>{t("Question paper")}</h3>
              <p className="field-hint">
                {t(
                  "All saved questions are shown here. Each test selects and shuffles its own paper using the exam settings.",
                )}
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showKey}
                  onChange={(e) => setShowKey(e.target.checked)}
                />
                {t("Show accepted answers")}
              </label>
              {!exam.question_count && (
                <p className="notice">{t("This exam has no questions yet.")}</p>
              )}
              {exam.questions?.map((q, i) => (
                <article
                  className="review-question preview-question"
                  key={q.id}
                >
                  <Badge tone="neutral">
                    {i + 1} ·{" "}
                    {questionTypes().find(([value]) => value === q.type)?.[1]} ·{" "}
                    {q.points} {t("points")}
                  </Badge>
                  <QuestionContent question={q} headingClassName="review-answer" />
                  {showKey && <GradingGuide question={q} />}
                  {!!q.options.length && (
                    <ol>
                      {q.options.map((option, index) => (
                        <li className="review-answer" key={index}>
                          {option}
                        </li>
                      ))}
                    </ol>
                  )}
                  {showKey && (
                    <div>
                      <strong>
                        {q.type === "essay"
                          ? t("Manual review required")
                          : t("Accepted answers")}
                      </strong>
                      <p className="review-answer accepted-answer">
                        {acceptedAnswerText(q)}
                      </p>
                    </div>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
