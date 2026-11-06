import { t, useLocale, getLocale, LanguagePicker } from "./i18n";
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
import { api } from "./api";
import type { Attempt as Data, Guest, GuestChallenge } from "./types";
import { Spinner, ErrorBox, Modal, Badge } from "./ui";
export function GuestExam({ go }: { go: (p: string) => void }) {
  useLocale();
  const [guest, setGuest] = useState<Guest | GuestChallenge | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<Promise<Guest | GuestChallenge> | null>(null);
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
        <ShieldCheck size={25} /> evitina learn
      </div>
      <div className="guest-card">
        <span className="eyebrow">{t("YOUR PERSONAL INVITATION")}</span>
        <h1>{t("Welcome to your assessment")}</h1>
        <ErrorBox message={error} />
        {guest ? (
          <>
            <Badge tone="teal">
              {t("Personal invitation \u00B7 No account required")}
            </Badge>
            <h2>{guest.title}</h2>
            <p>{guest.description}</p>
            <div className="guest-details">
              <div>
                <span>{t("Participant")}</span>
                <strong>{guest.recipient}</strong>
              </div>
              <div>
                <span>{t("Time allowed")}</span>
                <strong>
                  {guest.duration_minutes}
                  {" " + t("min")}
                </strong>
              </div>
              <div>
                <span>{t("New attempts remaining")}</span>
                <strong>
                  {guest.remaining}
                  {" " + t("attempts")}
                </strong>
              </div>
              <div>
                <span>{t("Link expires")}</span>
                <strong>
                  {new Date(guest.expires_at).toLocaleString(getLocale())}
                </strong>
              </div>
            </div>
            <p className="notice">
              {t(
                "This link belongs to the named participant. Do not forward it. Starting uses one attempt; an existing active attempt will resume.",
              ) + " "}
            </p>
            <button
              className="btn primary full"
              onClick={start}
              disabled={busy}
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
        {t("Evitina Learn \u00B7 Enterprise learning platform")}
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
        <ShieldCheck size={25} /> evitina learn
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
}: {
  id: string;
  go: (p: string) => void;
  guest?: boolean;
}) {
  useLocale();
  const [attempt, setAttempt] = useState<Data | null>(null),
    [answers, setAnswers] = useState<Data["answers"]>({}),
    [index, setIndex] = useState(0),
    [remaining, setRemaining] = useState(0),
    [error, setError] = useState(""),
    [saveState, setSaveState] = useState("Saved answers loaded"),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const deadline = useRef(0),
    changed = useRef(false),
    submitted = useRef(false),
    latest = useRef(answers);
  latest.current = answers;
  useEffect(() => {
    api<Data>(`attempts/${id}/`)
      .then((a) => {
        setAttempt(a);
        setAnswers(a.answers);
        deadline.current =
          Date.now() +
          new Date(a.deadline).getTime() -
          new Date(a.server_time).getTime();
        setRemaining(
          Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)),
        );
      })
      .catch((e) => setError(e.message));
  }, [id]);
  async function submit() {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError("");
    try {
      const a = await api<Data>(`attempts/${id}/`, "POST", {
        answers: latest.current,
      });
      setAttempt(a);
      setConfirm(false);
      changed.current = false;
    } catch (e) {
      submitted.current = false;
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (attempt?.status !== "in_progress") return;
    const timer = window.setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil((deadline.current - Date.now()) / 1000),
      );
      setRemaining(left);
      if (left === 0 && !submitted.current) void submit();
    }, 1000);
    return () => clearInterval(timer);
  }, [attempt?.status, id]);
  useEffect(() => {
    if (!changed.current || attempt?.status !== "in_progress") return;
    setSaveState("Unsaved changes");
    const timeout = setTimeout(() => {
      setSaveState("Saving\u2026");
      api<Data>(`attempts/${id}/`, "PATCH", { answers })
        .then((a) => {
          setSaveState("Answers saved automatically");
          if (a.status !== "in_progress") setAttempt(a);
        })
        .catch((e) => {
          setSaveState("Save failed");
          setError(e.message);
        });
    }, 600);
    return () => clearTimeout(timeout);
  }, [answers, attempt?.status, id]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (attempt?.status === "in_progress") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [attempt?.status]);
  if (!attempt)
    return (
      <div className="attempt-shell">
        <ErrorBox message={error} />
        {!error && <Spinner />}
      </div>
    );
  if (attempt.status !== "in_progress")
    return (
      <div className="result-celebration">
        <LanguagePicker />
        <div className={"result-emblem " + (attempt.passed ? "passed" : "")}>
          <Trophy size={44} />
        </div>
        <span className="eyebrow">{t("ASSESSMENT COMPLETE")}</span>
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
        <button
          className="btn primary"
          onClick={() => go(guest ? "/invite" : "/results")}
        >
          {guest ? t("Back to invitation") : t("Back to assessment history")}
          <ArrowRight size={16} />
        </button>
      </div>
    );
  const q = attempt.questions[index],
    answered = Object.values(answers).filter((v) =>
      Array.isArray(v) ? v.length : String(v).trim(),
    ).length;
  const setAnswer = (value: string | number | number[]) => {
    changed.current = true;
    setAnswers({ ...answers, [String(q.id)]: value });
  };
  return (
    <div className="attempt-shell">
      <LanguagePicker />
      <div className="attempt-header">
        <div>
          <Badge tone="blue">
            {t("Attempt {number}", { number: attempt.number })}
          </Badge>
          <h1>{attempt.title}</h1>
          <p>{t(saveState)}</p>
        </div>
        <div className={"exam-timer " + (remaining < 60 ? "danger-text" : "")}>
          <Clock3 size={21} />
          <strong>
            {String(Math.floor(remaining / 60)).padStart(2, "0")}:
            {String(remaining % 60).padStart(2, "0")}
          </strong>
          <span>{t("Time remaining")}</span>
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="attempt-layout">
        <aside className="question-navigation">
          <h3>
            {t("Your progress")}{" "}
            <span>
              {answered}/{attempt.questions.length}
            </span>
          </h3>
          <div className="progress">
            <i
              style={{
                width: (answered / attempt.questions.length) * 100 + "%",
              }}
            />
          </div>
          <div className="question-dots">
            {attempt.questions.map((question, i) => (
              <button
                key={question.id}
                className={
                  (i === index ? "current " : "") +
                  (answers[String(question.id)] !== undefined ? "answered" : "")
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
              {
                {
                  single: t("Single choice"),
                  multiple: t("Multiple choice"),
                  short: t("Short answer"),
                  essay: t("Written response"),
                }[q.type]
              }{" "}
              · {q.points}
              {" " + t("points") + " "}
            </Badge>
          </div>
          <h2>{q.description}</h2>
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
          ) : (
            <textarea
              className="essay-answer"
              aria-label={t("Your answer")}
              placeholder={t("Enter your answer here\u2026")}
              rows={q.type === "essay" ? 10 : 4}
              value={String(answers[String(q.id)] || "")}
              onChange={(e) => setAnswer(e.target.value)}
              maxLength={20000}
            />
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
            {index < attempt.questions.length - 1 ? (
              <button
                className="btn primary"
                onClick={() => setIndex(index + 1)}
              >
                {t("Next question") + " "}
                <ArrowRight size={16} />
              </button>
            ) : (
              <button className="btn primary" onClick={() => setConfirm(true)}>
                <Send size={16} />
                {t("Finish and submit") + " "}
              </button>
            )}
          </div>
        </section>
      </div>
      <button className="btn submit-fixed" onClick={() => setConfirm(true)}>
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
              {answered} / {attempt.questions.length}{" "}
              {t("questions. Answers cannot be changed after submission.") +
                " "}
            </p>
            {answered < attempt.questions.length && (
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
              <button className="btn primary" onClick={submit} disabled={busy}>
                {busy ? t("Submitting\u2026") : t("Confirm submission")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
