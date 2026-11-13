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
            "Save each answer to unlock the next question. Answer all questions before submitting.",
          )}
        </p>
      )}
      {!value.allow_response_review && (
        <p className="notice exam-policy-notice">
          {t(
            "You can see your score, but not your answers.",
          )}
        </p>
      )}
    </>
  );
}
