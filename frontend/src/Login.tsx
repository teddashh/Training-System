import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ShieldCheck,
  BarChart3,
  Layers3,
} from "lucide-react";
import { api } from "./api";
import type { User } from "./types";
import { ErrorBox } from "./ui";

export default function Login({
  entra,
  onLogin,
}: {
  entra: boolean;
  onLogin: (u: User) => void;
}) {
  const [mode, setMode] = useState("password"),
    [identifier, setIdentifier] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "email" && !sent) {
        await api("auth/email/request/", "POST", { email: identifier });
        setSent(true);
      } else {
        const response = await api<{ user: User }>(
          mode === "email" ? "auth/email/verify/" : "auth/login/",
          "POST",
          mode === "email"
            ? { email: identifier, code }
            : { identifier, password },
        );
        onLogin(response.user);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Layers3 size={24} />
          </span>
          <span>
            evitina<span className="brand-light"> learn</span>
          </span>
        </div>
        <div className="login-copy">
          <div className="eyebrow">PEOPLE · LEARNING · GROWTH</div>
          <h1>
            讓每一次學習，
            <br />
            成為成長的<span>起點。</span>
          </h1>
          <p>
            串聯知識、培訓與評量，
            <br />
            打造屬於團隊的人才發展旅程。
          </p>
          <div className="login-features">
            {[
              [BookOpen, "學習，隨時開始"],
              [ShieldCheck, "評量，安心進行"],
              [BarChart3, "成效，一目了然"],
            ].map(([Icon, text]) => {
              const C = Icon as typeof BookOpen;
              return (
                <div key={String(text)}>
                  <C size={21} />
                  {String(text)}
                </div>
              );
            })}
          </div>
          <div className="orbit">
            <div />
            <div />
            <div />
            <Layers3 size={64} />
            <span className="orbit-dot" />
          </div>
        </div>
        <footer>
          EVITINA LEARN <span>企業人才發展平台</span>
        </footer>
      </div>
      <div className="login-form">
        <div className="login-box">
          <span className="eyebrow blue-text">WELCOME BACK</span>
          <h2>歡迎回來</h2>
          <p className="muted">登入您的工作空間，繼續學習與成長。</p>
          <a
            className={"sso-button " + (!entra ? "disabled" : "")}
            href={entra ? "/api/auth/entra/" : undefined}
            aria-disabled={!entra}
          >
            <span className="microsoft-logo">
              <i />
              <i />
              <i />
              <i />
            </span>
            使用 Microsoft 帳號登入
            <ArrowRight size={17} />
          </a>
          {!entra && (
            <small className="muted">
              公司 SSO 尚待管理員完成 Entra ID 設定
            </small>
          )}
          <div className="divider">
            <span>或使用其他方式</span>
          </div>
          <div className="segmented">
            <button
              className={mode === "password" ? "active" : ""}
              onClick={() => {
                setMode("password");
                setError("");
              }}
            >
              E-mail／員工編號
            </button>
            <button
              className={mode === "email" ? "active" : ""}
              onClick={() => {
                setMode("email");
                setError("");
              }}
            >
              E-mail 驗證碼
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              {mode === "email" ? "E-mail" : "E-mail、帳號或員工編號"}
              <input
                required
                autoComplete="username"
                type={mode === "email" ? "email" : "text"}
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setSent(false);
                }}
                placeholder={
                  mode === "email" ? "name@company.com" : "請輸入您的登入識別碼"
                }
              />
            </label>
            {mode === "password" ? (
              <label>
                密碼
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="請輸入密碼"
                />
              </label>
            ) : (
              sent && (
                <>
                  <p className="notice">
                    若帳號存在，驗證碼已寄送，10 分鐘內有效。
                  </p>
                  <label>
                    六位數驗證碼
                    <input
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      autoComplete="one-time-code"
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                </>
              )
            )}
            <ErrorBox message={error} />
            <button className="btn primary full" disabled={busy}>
              {busy
                ? "處理中…"
                : mode === "email" && !sent
                  ? "寄送登入驗證碼"
                  : "登入工作空間"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="login-help">
            尚未取得帳號？請聯絡您的公司訓練管理員。
            <br />
            收到考試邀請的訪客，請直接開啟專屬連結。
          </p>
        </div>
        <div className="login-legal">
          <ShieldCheck size={14} /> 以安全的企業身分驗證保護您的學習紀錄
        </div>
      </div>
    </div>
  );
}
