import { brand, signIn } from "./brand";
import Brand from "./Brand";
import SignInMethods from "./SignInMethods";
import { t, useLocale, LanguagePicker } from "./i18n";
import {
  BookOpen,
  ShieldCheck,
  BarChart3,
} from "lucide-react";
import type { User } from "./types";
export default function Login({
  entra,
  onLogin,
}: {
  entra: boolean;
  onLogin: (u: User) => void;
}) {
  useLocale();
  return (
    <div className="login-page">
      <div className="login-story">
        <div className="brand"><Brand /></div>
        <div className="login-copy">

          <h1>{brand.title}</h1>
          <p>{t("Courses, assessments and assigned training in one workspace.")}</p>
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

        </div>
        <footer>
          © {new Date().getFullYear()} {brand.organization}
        </footer>
      </div>
      <div className="login-form">
        <div className="login-box">
          <div className="login-mobile-brand"><Brand /><strong>{brand.organization}</strong></div>

          <LanguagePicker />
          <h2>{t("Welcome back")}</h2>
          <p className="muted">
            {t("Sign in to your workspace and continue learning.")}
          </p>
          <SignInMethods entra={entra} onLogin={onLogin} allowPassword={signIn.password} />
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
