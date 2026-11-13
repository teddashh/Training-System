import { brand } from "./brand";
import { QuestionContent } from "./QuestionFigure";
import { formatDateTime } from "./datetime";
import Brand from "./Brand";
import { countLabel, attemptCount, t, useLocale, getLocale, LanguagePicker } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  CheckCircle2,
  Send,
  ShieldCheck,
  Trophy,
  FileCheck2,
} from "lucide-react";
import { api, ApiError } from "./api";
import { useAttemptSession } from "./useAttemptSession";
import type { Attempt as Data, Exam, Guest, GuestChallenge } from "./types";
import { Spinner, ErrorBox, Modal, Badge } from "./ui";
import { questionTypes, answerText, answerProvided } from "./questionTypes";
import ExamPolicyNotice from "./ExamPolicyNotice";
import OrderingAnswer from "./OrderingAnswer";
import { ReviewModal } from "./Management";
import { RetryNotice, useRetryAvailability } from "./RetryAvailability";

function ResultRetryNotice({examId, refreshKey}: {examId: number; refreshKey: string}) {
  const [exam, setExam] = useState<Exam | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setExam(null); setError('');
    api<Exam>(`exams/${examId}/`).then(value => { if (active) { setExam(value); setError(''); } })
      .catch(e => { if (active && !(e instanceof ApiError && [403, 404].includes(e.status))) setError(e.message); });
    return () => { active = false; };
  }, [examId, refreshKey]);
  return <>{exam && <RetryNotice value={exam}/>}<ErrorBox message={error}/></>;
}
export function GuestExam({ go }: { go: (p: string) => void }) {
  useLocale();
  const [guest, setGuest] = useState<Guest | GuestChallenge | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<Promise<Guest | GuestChallenge> | null>(null);
  const waiting = useRetryAvailability(
    guest && !guest.verification_required ? guest : null,
  );
  async function refreshAvailability(preserveError = false) {
    setBusy(true);
    if (!preserveError) setError("");
    try {
      setGuest(await api<Guest | GuestChallenge>("guest/exam/"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!pending.current)
      pending.current = token
        ? api<Guest | GuestChallenge>("guest/exchange/", "POST", { token })
        : api<Guest | GuestChallenge>("guest/exam/");
    pending.current
      .then((v) => {
        setGuest(v);
        history.replaceState({}, "", window.location.pathname);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const result = await api<Data>("guest/exam/", "POST", {});
      go("/attempt/" + result.id);
    } catch (e) {
      setError((e as Error).message);
      await refreshAvailability(true);
    } finally {
      setBusy(false);
    }
  }
  if (guest?.verification_required)
    return <GuestVerification challenge={guest} onVerified={setGuest} />;
  return (
    <div className="guest-page">
      <LanguagePicker />
      <div className="guest-brand">
        <Brand /><strong>{brand.organization}</strong>
      </div>
      <div className="guest-card">

        <h1>{t("Welcome to your assessment")}</h1>
        <ErrorBox message={error} />
        {guest ? (
          <>
            <Badge tone="teal">
              {t("Personal invitation \u00B7 No account required")}
            </Badge>
            <h2>{guest.title}</h2>
            <p className="preserve-lines">{guest.description}</p>
            <div className="guest-details">
              <div>
                <span>{t("Participant")}</span>
                <strong>{guest.recipient}</strong>
              </div>
              <div>
                <span>{t("Time allowed")}</span>
                <strong>
                  {countLabel(guest.duration_minutes, "{count} minute", "{count} minutes")}
                </strong>
              </div>
              <div>
                <span>{t("New attempts remaining")}</span>
                <strong>
                  {attemptCount(guest.remaining)}
                </strong>
              </div>
              <div>
                <span>{t("Link expires")}</span>
                <strong>
                  {formatDateTime(guest.expires_at, getLocale())}
                </strong>
              </div>
            </div>
            <p className="notice">
              {t(
                "This link belongs to the named participant. Do not forward it. Starting uses one attempt; an existing active attempt will resume.",
              ) + " "}
            </p>
            <RetryNotice value={guest} />
            <ExamPolicyNotice value={guest} />
            {guest.retry_interval_minutes > 0 && (
              <button
                className="text-btn"
                onClick={() => refreshAvailability()}
                disabled={busy}
              >
                {t("Refresh availability")}
              </button>
            )}
            <button
              className="btn primary full"
              onClick={start}
              disabled={busy || waiting}
            >
              {busy ? t("Preparing\u2026") : t("Start / resume exam")}
              <ArrowRight size={17} />
            </button>
          </>
        ) : (
          !error && <Spinner />
        )}
      </div>
      <p className="muted">
        {t("{organization} · Enterprise learning platform", { organization: brand.organization })}
      </p>
    </div>
  );
}

function GuestVerification({
  challenge,
  onVerified,
}: {
  challenge: GuestChallenge;
  onVerified: (guest: Guest) => void;
}) {
  useLocale();
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      await api("guest/email/request/", "POST", {});
      setSent(true);
      setCode("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onVerified(await api<Guest>("guest/email/verify/", "POST", { code }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="guest-page">
      <LanguagePicker />
      <div className="guest-brand">
        <Brand /><strong>{brand.organization}</strong>
      </div>
      <div className="guest-card">
        <h1>{t("Verify your email to continue")}</h1>
        <h2>{challenge.title}</h2>
        <p>
          {t("A code will be sent to {email}.", {
            email: challenge.email_hint,
          })}
        </p>
        <p className="notice">
          {t(
            "Verification does not use an exam attempt. Codes expire in 10 minutes and allow five incorrect entries.",
          )}
        </p>
        <button className="btn full" onClick={sendCode} disabled={busy}>
          {sent ? t("Send a new code") : t("Send verification code")}
        </button>
        {sent && (
          <form className="modal-form" onSubmit={verify}>
            <p role="status">
              {t("A verification code has been sent to the invited recipient.")}
            </p>
            <label>
              {t("Six-digit verification code")}
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button className="btn primary full" disabled={busy}>
              {busy ? t("Processing…") : t("Verify and continue")}
            </button>
          </form>
        )}
        <ErrorBox message={error} />
      </div>
    </div>
  );
}
export default function Attempt({
  id,
  go,
  guest = false,
  preview = false,
}: {
  id: string;
  go: (p: string) => void;
  guest?: boolean;
  preview?: boolean;
}) {
  useLocale();
  const {
    attempt,
    answers,
    remaining,
    error,
    saveState,
    busy,
    conflict,
    change,
    submit,
    retry,
    reload,
  } = useAttemptSession(id, preview);
  const [index, setIndex] = useState(0),
    [confirm, setConfirm] = useState(false),
    [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    setIndex(0);
    setConfirm(false);
  }, [id]);
  const examsPath = preview && attempt ? `/exams?exam=${attempt.exam_id}` : "/exams";
  if (!attempt)
    return (
      <div className="attempt-shell">
        <ErrorBox message={error} />
        {preview && (
          <button className="btn" onClick={() => go(examsPath)}>
            {t("Back to exams")}
          </button>
        )}
        {error ? (
          <button className="btn" onClick={reload} disabled={busy}>
            {t("Reload saved answers")}
          </button>
        ) : (
          <Spinner />
        )}
      </div>
    );
  const previewNotice = preview && (
    <aside className="preview-banner" aria-label={t("Instructor preview")}>
      <strong>
        {attempt.preview_mode === "learner"
          ? t("Learner simulation")
          : t("Untimed test")}
      </strong>
      <p>
        {t(
          "Private test. No participant attempts, results or training completion are recorded.",
        )}
      </p>
      <small>{t("Saved previews are deleted after seven days.")}</small>
      {attempt.status === "in_progress" && (
        <button
          className="btn"
          disabled={
            busy ||
            conflict ||
            !["Answers saved automatically", "Saved answers loaded"].includes(
              saveState,
            )
          }
          onClick={() => go(examsPath)}
        >
          {t("Back to exams")}
        </button>
      )}
    </aside>
  );
  if (attempt.status !== "in_progress")
    return (
      <div className="result-celebration">
        <LanguagePicker />
        {previewNotice}
        <div className={"result-emblem " + (attempt.passed ? "passed" : "")}>
          <Trophy size={44} />
        </div>

        <h1>
          {attempt.status === "pending_review"
            ? t("Submitted, awaiting instructor review")
            : attempt.passed
              ? t("Congratulations, you passed")
              : t("Assessment completed")}
        </h1>
        <p>
          {attempt.title}
          {" · " + t("Attempt {number}", { number: attempt.number })}
        </p>
        {attempt.score !== null && (
          <div className="result-score">
            {attempt.score}
            <span> / 100</span>
          </div>
        )}
        <p className="muted">
          {attempt.status === "pending_review"
            ? t(
                "Your final score will appear after the written responses are reviewed.",
              )
            : t("Passing score: {v0} points \u00B7 {v1}", {
                v0: attempt.pass_score,
                v1: attempt.passed
                  ? t("Keep learning and growing.")
                  : t("Review the course and prepare for your next attempt."),
              })}
        </p>
        {!preview && !guest && !attempt.passed && <ResultRetryNotice examId={attempt.exam_id} refreshKey={attempt.server_time}/>}
        {attempt.review_available ? (
          <section
            className="response-review"
            aria-label={t("Your responses and feedback")}
          >
            <h2>{t("Your responses and feedback")}</h2>
            {attempt.questions.map((question, i) => {
              const answer = attempt.answers[String(question.id)];
              const grade = attempt.manual_grades[String(question.id)];
              const response = answerText(question, answer);
              return (
                <article className="response-item" key={question.id}>
                  <QuestionContent question={question} prefix={`${i + 1}. `} />
                  <p className="review-answer">
                    {response.trim() || t("No answer provided")}
                  </p>
                  {grade && (
                    <div className="instructor-feedback">
                      <strong>
                        {t("Instructor review")}
                        {grade.points !== null &&
                          ` · ${grade.points} / ${question.points} ${t("points")}`}
                      </strong>
                      {grade.feedback && (
                        <p className="review-answer">{grade.feedback}</p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        ) : (
          <p className="notice exam-policy-notice">
            {t(
              "You can see your score, but not your answers.",
            )}
          </p>
        )}
        <ErrorBox message={error} />
        {preview && (
          <button className="btn" onClick={() => setReviewing(true)}>
            {t("Inspect test result")}
          </button>
        )}
        {reviewing && (
          <ReviewModal
            id={id}
            preview
            onClose={() => setReviewing(false)}
            onSaved={reload}
          />
        )}
        <button className="btn" onClick={reload} disabled={busy}>
          {t("Refresh result")}
        </button>
        <button
          className="btn primary"
          onClick={() =>
            go(preview ? examsPath : guest ? "/invite" : "/results")
          }
        >
          {preview
            ? t("Back to exams")
            : guest
              ? t("Back to invitation")
              : t("Back to assessment history")}
          <ArrowRight size={16} />
        </button>
      </div>
    );
  const q = attempt.questions[index],
    total = attempt.question_count,
    answered = attempt.questions.filter((question) =>
      answerProvided(answers[String(question.id)]),
    ).length,
    incompleteRequired = !attempt.allow_skip && answered < total,
    timedOut = attempt.deadline !== null && remaining === 0;
  const setAnswer = (value: string | number | number[]) => {
    change(String(q.id), value);
  };
  return (
    <div className="attempt-shell">
      <LanguagePicker />
      {previewNotice}
      <div className="attempt-header">
        <div>
          <Badge tone="blue">
            {t("Attempt {number}", { number: attempt.number })}
          </Badge>
          <h1>{attempt.title}</h1>
          <p role="status" aria-live="polite">
            {t(saveState)}
          </p>
        </div>
        <div
          className={
            "exam-timer " +
            (attempt.deadline && remaining < 60 ? "danger-text" : "")
          }
        >
          <Clock3 size={21} />
          <strong>
            {attempt.deadline
              ? `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`
              : t("Untimed")}
          </strong>
          <span>
            {attempt.deadline ? t("Time remaining") : t("Instructor preview")}
          </span>
        </div>
      </div>
      <ErrorBox message={error} />
      {attempt.extra_time_minutes > 0 && (
        <p className="notice exam-policy-notice">
          {t("Extra time granted: {minutes} minutes.", {
            minutes: attempt.extra_time_minutes,
          })}
        </p>
      )}
      {!attempt.allow_skip && (
        <p className="notice exam-policy-notice" id="sequential-rules">
          {attempt.deadline
            ? t(
                "Save each answer to unlock the next question. You can revisit unlocked questions. Answer all before submitting; the timer keeps running.",
              )
            : t(
                "Save each answer to unlock the next question. You can revisit unlocked questions. Answer all before submitting.",
              )}
        </p>
      )}
      {error && (
        <div className="save-recovery">
          {conflict && (
            <p>
              {t(
                "Reloading replaces your unsaved changes with the answers stored on the server.",
              )}
            </p>
          )}
          <button
            className="btn"
            onClick={conflict ? reload : retry}
            disabled={busy}
          >
            {conflict ? t("Reload saved answers") : t("Retry saving")}
          </button>
        </div>
      )}
      <div className="attempt-layout">
        <aside className="question-navigation">
          <h3>
            {t("Your progress")}{" "}
            <span>
              {answered}/{total}
            </span>
          </h3>
          <div className="progress">
            <i
              style={{
                width: (answered / total) * 100 + "%",
              }}
            />
          </div>
          <div className="question-dots">
            {Array.from({ length: total }, (_, i) => (
              <button
                key={i}
                className={
                  (i === index ? "current " : "") +
                  (answerProvided(answers[String(attempt.questions[i]?.id)])
                    ? "answered"
                    : "")
                }
                disabled={i >= attempt.questions.length}
                aria-describedby={
                  !attempt.allow_skip ? "sequential-rules" : undefined
                }
                onClick={() => setIndex(i)}
                aria-label={t("Go to question {v0}", { v0: i + 1 })}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <p>
            <span className="tiny-dot blue" />
            {t("Answered") + " "}
            <span className="tiny-dot neutral" />
            {t("Unanswered") + " "}
          </p>
          <div className="attempt-note">
            <ShieldCheck size={19} />
            <span>
              {t(
                "Answers save automatically. Watch the timer and submit when you are finished.",
              )}
            </span>
          </div>
        </aside>
        <section className="question-paper">
          <div className="question-paper-meta">
            <span>
              {t("Question")} {String(index + 1).padStart(2, "0")}
            </span>
            <Badge tone="neutral">
              {questionTypes().find(([value]) => value === q.type)?.[1]} ·{" "}
              {q.points}
              {" " + t("points") + " "}
            </Badge>
          </div>
          <QuestionContent question={q} heading="h2" />
          {q.type === "single" || q.type === "multiple" ? (
            <div className="answer-options">
              {q.options.map((option, i) => {
                const current = answers[String(q.id)],
                  checked = Array.isArray(current)
                    ? current.includes(i)
                    : current === i;
                return (
                  <label key={i} className={checked ? "selected" : ""}>
                    <input
                      type={q.type === "single" ? "radio" : "checkbox"}
                      name={"q" + q.id}
                      checked={checked}
                      disabled={busy || conflict || timedOut}
                      onChange={() =>
                        setAnswer(
                          q.type === "single"
                            ? i
                            : checked
                              ? (Array.isArray(current) ? current : []).filter(
                                  (v) => v !== i,
                                )
                              : [...(Array.isArray(current) ? current : []), i],
                        )
                      }
                    />
                    <span className="option-letter">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span>{option}</span>
                    {checked && <CheckCircle2 size={18} />}
                  </label>
                );
              })}
            </div>
          ) : q.type === "ordering" ? (
            <OrderingAnswer
              options={q.options}
              answer={answers[String(q.id)]}
              disabled={busy || conflict || timedOut}
              onChange={setAnswer}
            />
          ) : q.type === "integer" || q.type === "numeric" ? (
            <div className="numeric-answer">
              <p className="field-hint">
                {q.type === "integer"
                  ? t("Enter a whole number.")
                  : t(
                      "Use decimals (12.5) or scientific notation.",
                    )}
              </p>
              <input
                type="text"
                aria-label={t("Your answer")}
                maxLength={128}
                readOnly={conflict}
                disabled={busy || timedOut}
                value={String(answers[String(q.id)] ?? "")}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </div>
          ) : (
            <div>
              {q.type === "short" && (
                <p className="field-hint" id="text-answer-format">
                  {t(
                    "Match the requested capitalization, spacing and line breaks.",
                  )}
                </p>
              )}
              <textarea
                className="essay-answer"
                readOnly={conflict}
                disabled={busy || timedOut}
                aria-label={t("Your answer")}
                aria-describedby={
                  q.type === "short" ? "text-answer-format" : undefined
                }
                autoCapitalize={q.type === "short" ? "none" : undefined}
                autoCorrect={q.type === "short" ? "off" : undefined}
                spellCheck={q.type === "short" ? false : undefined}
                placeholder={t("Enter your answer here\u2026")}
                rows={q.type === "essay" ? 10 : 4}
                value={String(answers[String(q.id)] || "")}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={20000}
              />
            </div>
          )}
          <div className="question-paper-footer">
            <button
              className="btn"
              onClick={() => setIndex(index - 1)}
              disabled={index === 0}
            >
              <ArrowLeft size={16} />
              {t("Previous question") + " "}
            </button>
            {index < total - 1 ? (
              <button
                className="btn primary"
                onClick={() => setIndex(index + 1)}
                disabled={
                  index + 1 >= attempt.questions.length || busy || conflict
                }
              >
                {t("Next question") + " "}
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="btn primary"
                onClick={() => setConfirm(true)}
                disabled={busy || conflict || incompleteRequired}
              >
                <Send size={16} />
                {t("Finish and submit") + " "}
              </button>
            )}
          </div>
        </section>
      </div>
      <button
        className="btn submit-fixed"
        onClick={() => setConfirm(true)}
        disabled={busy || conflict || incompleteRequired}
      >
        <FileCheck2 size={17} />
        {t("Submit") + " "}
      </button>
      {confirm && (
        <Modal
          title={t("Confirm submission")}
          onClose={() => setConfirm(false)}
        >
          <div className="modal-form">
            <p>
              {t("Answered") + " "}
              {answered} / {total}{" "}
              {t("questions. Answers cannot be changed after submission.") +
                " "}
            </p>
            {answered < total && (
              <p className="notice">
                {t(
                  "Some questions are unanswered. You can return to complete them.",
                )}
              </p>
            )}
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirm(false)}>
                {t("Continue answering") + " "}
              </button>
              <button
                className="btn primary"
                onClick={submit}
                disabled={busy || conflict || incompleteRequired}
              >
                {busy ? t("Submitting\u2026") : t("Confirm submission")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
