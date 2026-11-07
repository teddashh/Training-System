import { t, useLocale } from "./i18n";
import type { Exam } from "./types";

export default function ExamBudget({ exam }: { exam: Exam }) {
  const locale = useLocale();
  return (
    <div className="exam-budget-info">
      <strong>
        {t("{remaining} new attempts remaining", {
          remaining: exam.attempts_remaining,
        })}
      </strong>
      <span>
        {t("{used} of {limit} attempts used", {
          used: exam.attempts_used,
          limit: exam.effective_attempt_limit,
        })}
      </span>
      {exam.active_attempt_id && (
        <p>
          {t(
            "You have an active attempt. Resuming it does not use another attempt.",
          )}
        </p>
      )}
      {exam.starts_at && (
        <small>
          {t("Opens at")}: {new Date(exam.starts_at).toLocaleString(locale)}
        </small>
      )}
      {exam.ends_at && (
        <small>
          {t("Closes at")}: {new Date(exam.ends_at).toLocaleString(locale)}
        </small>
      )}
    </div>
  );
}
