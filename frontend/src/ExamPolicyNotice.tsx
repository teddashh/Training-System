import { t } from "./i18n";

export default function ExamPolicyNotice({
  value,
}: {
  value: {
    allow_skip: boolean;
    allow_response_review: boolean;
    active_attempt_id?: string | null;
  };
}) {
  return (
    <>
      {!value.allow_skip && !value.active_attempt_id && (
        <p className="notice exam-policy-notice">
          {t(
            "This exam requires answers in order. Questions unlock after each answer is saved; all questions need an answer before submission.",
          )}
        </p>
      )}
      {!value.allow_response_review && (
        <p className="notice exam-policy-notice">
          {t(
            "Response review is currently disabled. Your score will remain available after grading.",
          )}
        </p>
      )}
    </>
  );
}
