import { useId } from "react";
import { t, useLocale } from "./i18n";
import type { Question } from "./types";

export function GradingGuideEditor({ question, onChange }: {
  question: Question; onChange: (values: Partial<Question>) => void;
}) {
  useLocale();
  const hint = useId();
  if (question.type !== "essay") return null;
  return <div className="grading-guide-editor">
    <label>{t("Grading guide")}
      <textarea rows={5} maxLength={5000} value={question.grading_guide || ""} aria-describedby={hint}
        onChange={event => onChange({ grading_guide: event.target.value })} />
    </label>
    <p className="muted" id={hint}>{t("For graders only; 5,000 characters max.")}</p>
  </div>;
}

// Use only in organizer/grader views; never render this from learner components.
export function GradingGuide({ question }: { question: Question }) {
  useLocale();
  if (question.type !== "essay" || !question.grading_guide) return null;
  return <section className="grading-guide" aria-label={t("Grading guide")}>
    <strong>{t("Grading guide")}</strong>
    <p className="preserve-lines">{question.grading_guide}</p>
  </section>;
}
