import { useEffect, useState } from "react";
import { api } from "./api";
import { t, useLocale } from "./i18n";
import { answerText, acceptedAnswerText } from "./questionTypes";
import { Badge, ErrorBox, Modal, Spinner, statusLabel } from "./ui";
import type { Attempt } from "./types";

type Evidence = Pick<
  Attempt,
  | "title"
  | "person"
  | "status"
  | "questions"
  | "answers"
  | "answer_revision"
  | "manual_grades"
  | "score"
  | "passed"
> & {
  submitted_at: string | null;
  last_saved_at: string | null;
  observed_at?: string;
};

export default function AttemptEvidence({
  id,
  recordId,
  onClose,
}: {
  id: string;
  recordId?: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const [data, setData] = useState<Evidence | null>(null);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(document.hidden);
  const [version, setVersion] = useState(0);
  const endpoint = recordId
    ? `attempts/${id}/reopenings/${recordId}/`
    : `attempts/${id}/inspection/`;
  useEffect(() => {
    let alive = true,
      flight = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (!alive || flight) return;
      clearTimeout(timer);
      flight = true;
      try {
        const result = await api<Evidence>(endpoint, "GET", undefined, 15000);
        if (alive) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        flight = false;
        if (alive && !recordId && !document.hidden)
          timer = setTimeout(load, 5000);
      }
    }
    function visibility() {
      setPaused(document.hidden);
      clearTimeout(timer);
      if (!document.hidden) void load();
    }
    document.addEventListener("visibilitychange", visibility);
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [endpoint, recordId, version]);
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : t("Not yet reported");
  return (
    <Modal
      title={recordId ? t("Preserved submission") : t("Inspect saved answers")}
      onClose={onClose}
      wide
    >
      <div className="modal-form">
        <p className="notice">
          {recordId
            ? t(
                "This is the submission preserved before reopening. It is read-only and does not contribute to current results.",
              )
            : t(
                "Read-only view of server-saved answers. Unsaved edits on the participant’s device are not visible. Viewing this page does not update participant contact times.",
              )}
        </p>
        <ErrorBox message={error} />
        {error && data && (
          <p role="status">
            {t("Showing the last successful update. Data may be out of date.")}
          </p>
        )}
        <div className="monitor-update">
          {!recordId && (
            <span>
              {paused
                ? t("Updates paused while this tab is hidden.")
                : t("Refreshes every 5 seconds.")}
            </span>
          )}
          <button className="btn" onClick={() => setVersion((v) => v + 1)}>
            {t("Refresh")}
          </button>
        </div>
        {!data && !error && <Spinner />}
        {data && (
          <>
            <h3>
              {data.title} · {data.person}
            </h3>
            <Badge tone="neutral">
              {statusLabel()[data.status] || data.status}
            </Badge>
            <p>
              {t("Saved answer revision: {revision}", {
                revision: data.answer_revision,
              })}{" "}
              · {t("Last answer save")}: {date(data.last_saved_at)}
            </p>
            {data.observed_at && (
              <small>
                {t("Last updated")}: {date(data.observed_at)}
              </small>
            )}
            {data.submitted_at && (
              <p>
                {t("Submitted")}: {date(data.submitted_at)}
                {data.score !== null && ` · ${t("Score")}: ${data.score}%`}
              </p>
            )}
            {data.questions.map((q, index) => (
              <article className="review-question" key={q.id}>
                <Badge tone="neutral">
                  {t("Question")} {index + 1} · {q.points} {t("points")}
                </Badge>
                <h3>{q.description}</h3>
                <p className="review-answer">
                  {answerText(q, data.answers[String(q.id)]) ||
                    t("(Unanswered)")}
                </p>
                {q.type !== "essay" && (
                  <div>
                    <small>{t("Accepted answer")}</small>
                    <p className="review-answer accepted-answer">
                      {acceptedAnswerText(q)}
                    </p>
                  </div>
                )}
                {data.manual_grades[String(q.id)] && (
                  <div>
                    {data.manual_grades[String(q.id)].points !== null && (
                      <strong>
                        {t("Score")}: {data.manual_grades[String(q.id)].points}{" "}
                        / {q.points}
                      </strong>
                    )}
                    <p className="review-answer">
                      {data.manual_grades[String(q.id)].feedback}
                    </p>
                  </div>
                )}
              </article>
            ))}
          </>
        )}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            {t("Close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
