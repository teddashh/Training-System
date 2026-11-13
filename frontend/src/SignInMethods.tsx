import { signIn } from "./brand";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "./api";
import { appPath } from "./paths";
import { t, useLocale } from "./i18n";
import { ErrorBox } from "./ui";
import type { User } from "./types";

export default function SignInMethods({ entra, onLogin, allowPassword = false, beforeMicrosoft }: {
  entra: boolean; onLogin: (user: User) => void | Promise<void>;
  allowPassword?: boolean; beforeMicrosoft?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  useLocale();
  const [mode, setMode] = useState(allowPassword ? "password" : "email"),
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
        await onLogin(response.user);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <>
          {(entra || signIn.google) && <>
            <a className="sso-button" href={appPath(signIn.google ? "/api/auth/google/start/" : "/api/auth/entra/")} onClick={beforeMicrosoft}>
              {signIn.google ? <span className="google-logo" aria-hidden="true">G</span> : <span className="microsoft-logo" aria-hidden="true"><i /><i /><i /><i /></span>}
              {signIn.google ? t("Sign in with Google") : t("Sign in with Microsoft")}
              <ArrowRight size={17} />
            </a>
            {(allowPassword || signIn.email) && <div className="divider"><span>{t("or use another method")}</span></div>}
          </>}
          {!allowPassword && !signIn.email && !entra && !signIn.google && <p className="notice">{t("Email is off.")}</p>}
          {allowPassword && signIn.email && <div className="segmented">
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
          </div>}
          {(allowPassword || signIn.email) && <form onSubmit={submit}>
            <label>
              {mode === "email"
                ? t("Email")
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
                    ? "name@example.com"
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
          </form>}
  </>;
}
