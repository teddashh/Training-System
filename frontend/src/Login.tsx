import { t, useLocale, LanguagePicker } from "./i18n";
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
  useLocale();
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
        const response = await api<{
          user: User;
        }>(
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
          <div className="eyebrow">
            {t("PEOPLE \u00b7 LEARNING \u00b7 GROWTH")}
          </div>
          <h1>
            {t("Let every lesson") + " "}
            <br />
            {t("be a new ")}
            <span>{t("beginning.")}</span>
          </h1>
          <p>
            {t("Connect knowledge, training and assessment.") + " "}
            <br />
            {t("Build your team's journey of growth.") + " "}
          </p>
          <div className="login-features">
            {[
              [BookOpen, t("Learn at your own pace")],
              [ShieldCheck, t("Assess with confidence")],
              [BarChart3, t("See progress clearly")],
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
          EVITINA LEARN <span>{t("Enterprise learning platform")}</span>
        </footer>
      </div>
      <div className="login-form">
        <div className="login-box">
          <span className="eyebrow blue-text">{t("WELCOME BACK")}</span>
          <LanguagePicker />
          <h2>{t("Welcome back")}</h2>
          <p className="muted">
            {t("Sign in to your workspace and continue learning.")}
          </p>
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
            {t("Sign in with Microsoft") + " "}
            <ArrowRight size={17} />
          </a>
          {!entra && (
            <small className="muted">
              {t("Company SSO is awaiting administrator setup in Entra ID") +
                " "}
            </small>
          )}
          <div className="divider">
            <span>{t("or use another method")}</span>
          </div>
          <div className="segmented">
            <button
              className={mode === "password" ? "active" : ""}
              onClick={() => {
                setMode("password");
                setError("");
              }}
            >
              {t("Email / employee ID") + " "}
            </button>
            <button
              className={mode === "email" ? "active" : ""}
              onClick={() => {
                setMode("email");
                setError("");
              }}
            >
              {t("Email verification code") + " "}
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              {mode === "email"
                ? "E-mail"
                : t("Email, username or employee ID")}
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
                  mode === "email"
                    ? "name@company.com"
                    : t("Enter your sign-in identifier")
                }
              />
            </label>
            {mode === "password" ? (
              <label>
                {t("Password") + " "}
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("Enter your password")}
                />
              </label>
            ) : (
              sent && (
                <>
                  <p className="notice">
                    {t(
                      "If the account exists, a code has been sent. It expires in 10 minutes.",
                    ) + " "}
                  </p>
                  <label>
                    {t("Six-digit verification code") + " "}
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
                ? t("Processing\u2026")
                : mode === "email" && !sent
                  ? t("Send sign-in code")
                  : t("Sign in to workspace")}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="login-help">
            {t(
              "Need an account? Contact your company training administrator.",
            ) + " "}
            <br />
            {t(
              "Guests with an exam invitation should open their personal link.",
            ) + " "}
          </p>
        </div>
        <div className="login-legal">
          <ShieldCheck size={14} />
          {" " +
            t("Your learning records are protected by secure authentication") +
            " "}
        </div>
      </div>
    </div>
  );
}
