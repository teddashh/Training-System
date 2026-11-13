import { formatDateTime } from "./datetime";
import { countLabel, t, useLocale } from "./i18n";
import type { Exam } from "./types";
import { RetryNotice } from "./RetryAvailability";
import ExamPolicyNotice from "./ExamPolicyNotice";

export default function ExamBudget({ exam }: { exam: Exam }) {
  const locale = useLocale();
  return (
    <div className="exam-budget-info">
      <strong>
        {countLabel(exam.attempts_remaining, "{count} new attempt remaining", "{count} new attempts remaining")}
      </strong>
      <span>
        {t(exam.effective_attempt_limit === 1 ? "{used} of {limit} attempt used" : "{used} of {limit} attempts used", {
          used: exam.round_attempts_used ?? exam.attempts_used,
          limit: exam.effective_attempt_limit,
        })}
      </span>
      {exam.attempt_reset_minutes > 0 && <small>{t("Round {number}", {number: exam.round_number})}</small>}
      {exam.active_attempt_id && (
        <p>
          {t(
            "Resuming uses no extra attempt.",
          )}
        </p>
      )}
      {exam.retry_interval_minutes > 0 && (
        <small>
          {t("Minimum interval between starts: {duration}", {duration: countLabel(exam.retry_interval_minutes, "{count} minute", "{count} minutes")})}
        </small>
      )}
      <RetryNotice value={exam} />
      <ExamPolicyNotice value={exam} />
      {exam.starts_at && (
        <small>
          {t("Opens at")}: {formatDateTime(exam.starts_at, locale)}
        </small>
      )}
      {exam.ends_at && (
        <small>
          {t("Closes at")}: {formatDateTime(exam.ends_at, locale)}
        </small>
      )}
    </div>
  );
}
