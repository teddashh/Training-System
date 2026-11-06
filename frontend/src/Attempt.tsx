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
import type { Attempt as Data, Guest } from "./types";
import { Spinner, ErrorBox, Modal, Badge } from "./ui";

export function GuestExam({ go }: { go: (p: string) => void }) {
  const [guest, setGuest] = useState<Guest | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<Promise<Guest> | null>(null);
  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!pending.current)
      pending.current = token
        ? api<Guest>("guest/exchange/", "POST", { token })
        : api<Guest>("guest/exam/");
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
  return (
    <div className="guest-page">
      <div className="guest-brand">
        <ShieldCheck size={25} /> evitina learn
      </div>
      <div className="guest-card">
        <span className="eyebrow">YOUR PERSONAL INVITATION</span>
        <h1>歡迎參與評量</h1>
        <ErrorBox message={error} />
        {guest ? (
          <>
            <Badge tone="teal">專屬邀請 · 不需建立帳號</Badge>
            <h2>{guest.title}</h2>
            <p>{guest.description}</p>
            <div className="guest-details">
              <div>
                <span>受測者</span>
                <strong>{guest.recipient}</strong>
              </div>
              <div>
                <span>作答時間</span>
                <strong>{guest.duration_minutes} 分鐘</strong>
              </div>
              <div>
                <span>可用新作答次數</span>
                <strong>{guest.remaining} 次</strong>
              </div>
              <div>
                <span>連結有效至</span>
                <strong>
                  {new Date(guest.expires_at).toLocaleString("zh-TW")}
                </strong>
              </div>
            </div>
            <p className="notice">
              此連結綁定指定受測者，請勿轉傳。開始後即計入一次；若已有進行中的考卷，將繼續作答。
            </p>
            <button
              className="btn primary full"
              onClick={start}
              disabled={busy}
            >
              {busy ? "準備中…" : "開始／繼續考試"}
              <ArrowRight size={17} />
            </button>
          </>
        ) : (
          !error && <Spinner />
        )}
      </div>
      <p className="muted">Evitina Learn · 企業人才發展平台</p>
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
  const [attempt, setAttempt] = useState<Data | null>(null),
    [answers, setAnswers] = useState<Data["answers"]>({}),
    [index, setIndex] = useState(0),
    [remaining, setRemaining] = useState(0),
    [error, setError] = useState(""),
    [saveState, setSaveState] = useState("已載入作答紀錄"),
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
    setSaveState("尚有未儲存變更");
    const timeout = setTimeout(() => {
      setSaveState("儲存中…");
      api<Data>(`attempts/${id}/`, "PATCH", { answers })
        .then((a) => {
          setSaveState("答案已自動儲存");
          if (a.status !== "in_progress") setAttempt(a);
        })
        .catch((e) => {
          setSaveState("儲存失敗");
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
        <div className={"result-emblem " + (attempt.passed ? "passed" : "")}>
          <Trophy size={44} />
        </div>
        <span className="eyebrow">ASSESSMENT COMPLETE</span>
        <h1>
          {attempt.status === "pending_review"
            ? "已交卷，等待講師評分"
            : attempt.passed
              ? "恭喜，通過本次評量"
              : "本次評量已完成"}
        </h1>
        <p>
          {attempt.title} · 第 {attempt.number} 次作答
        </p>
        {attempt.score !== null && (
          <div className="result-score">
            {attempt.score}
            <span> / 100</span>
          </div>
        )}
        <p className="muted">
          {attempt.status === "pending_review"
            ? "申論題完成評閱後，將顯示最終成績。"
            : `及格標準 ${attempt.pass_score} 分 · ${attempt.passed ? "持續學習，讓成長發生。" : "檢視教材並準備下一次挑戰。"}`}
        </p>
        <button
          className="btn primary"
          onClick={() => go(guest ? "/invite" : "/results")}
        >
          返回{guest ? "邀請頁" : "評量紀錄"}
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
      <div className="attempt-header">
        <div>
          <Badge tone="blue">第 {attempt.number} 次作答</Badge>
          <h1>{attempt.title}</h1>
          <p>{saveState}</p>
        </div>
        <div className={"exam-timer " + (remaining < 60 ? "danger-text" : "")}>
          <Clock3 size={21} />
          <strong>
            {String(Math.floor(remaining / 60)).padStart(2, "0")}:
            {String(remaining % 60).padStart(2, "0")}
          </strong>
          <span>剩餘時間</span>
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="attempt-layout">
        <aside className="question-navigation">
          <h3>
            作答進度{" "}
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
                aria-label={`前往第 ${i + 1} 題`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <p>
            <span className="tiny-dot blue" />
            已作答 <span className="tiny-dot neutral" />
            未作答
          </p>
          <div className="attempt-note">
            <ShieldCheck size={19} />
            <span>答案會自動儲存。請留意剩餘時間，完成後記得交卷。</span>
          </div>
        </aside>
        <section className="question-paper">
          <div className="question-paper-meta">
            <span>QUESTION {String(index + 1).padStart(2, "0")}</span>
            <Badge tone="neutral">
              {
                {
                  single: "單選題",
                  multiple: "複選題",
                  short: "簡答題",
                  essay: "申論題",
                }[q.type]
              }{" "}
              · {q.points} 分
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
              aria-label="您的答案"
              placeholder="請在此輸入答案…"
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
              上一題
            </button>
            {index < attempt.questions.length - 1 ? (
              <button
                className="btn primary"
                onClick={() => setIndex(index + 1)}
              >
                下一題
                <ArrowRight size={16} />
              </button>
            ) : (
              <button className="btn primary" onClick={() => setConfirm(true)}>
                <Send size={16} />
                完成交卷
              </button>
            )}
          </div>
        </section>
      </div>
      <button className="btn submit-fixed" onClick={() => setConfirm(true)}>
        <FileCheck2 size={17} />
        交卷
      </button>
      {confirm && (
        <Modal title="確認交卷" onClose={() => setConfirm(false)}>
          <div className="modal-form">
            <p>
              已作答 {answered} / {attempt.questions.length}{" "}
              題。交卷後無法修改答案。
            </p>
            {answered < attempt.questions.length && (
              <p className="notice">尚有未作答題目，您可以返回繼續完成。</p>
            )}
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirm(false)}>
                繼續作答
              </button>
              <button className="btn primary" onClick={submit} disabled={busy}>
                {busy ? "交卷中…" : "確認交卷"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
