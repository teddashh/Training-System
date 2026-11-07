import { useEffect, useState } from "react";
import { Badge, ErrorBox } from "./ui";
import { api } from "./api";
import { t, useLocale } from "./i18n";

export default function Readiness() {
  useLocale();
  const [checks, setChecks] = useState<
    { key: string; label: string; status: string; detail: string }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ checks: typeof checks }>("readiness/")
      .then((result) => setChecks(result.checks))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel readiness-panel">
      <h2>{t("Deployment readiness")}</h2>
      <p>
        {t(
          "Local configuration checks for the Peach1 handover. Company sign-in, email delivery and Graph connectivity need acceptance testing on the target machine.",
        )}
      </p>
      <ErrorBox message={error} />
      <div className="readiness-grid">
        {checks.map((check) => (
          <div className="readiness-check" key={check.key}>
            <div>
              <strong>{t(check.label)}</strong>
              <Badge
                tone={
                  check.status === "ready"
                    ? "teal"
                    : check.status === "action_required"
                      ? "amber"
                      : "blue"
                }
              >
                {
                  {
                    ready: t("Ready"),
                    action_required: t("Action required"),
                    configured: t("Configured"),
                    deferred: t("Connect on Peach1"),
                  }[check.status]
                }
              </Badge>
            </div>
            <p>{t(check.detail)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
