import { roleInfo, roleLabel, rolesFor } from "./access";
import { useState } from "react";
import { Upload, CheckCircle2 } from "lucide-react";
import { api } from "./api";
import { t, useLocale } from "./i18n";
import { ErrorBox, Modal } from "./ui";
import type { User } from "./types";

export function PeopleImport({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  useLocale();
  const [csv, setCsv] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    valid: boolean;
    count: number;
    applied: boolean;
    errors: { row: number; message: unknown }[];
  } | null>(null);
  const sample =
    "username,email,employee_id,display_name,department,employment\npartner01,partner01@example.com,,Jordan Lee,Operations,contractor\n";
  function update(value: string) {
    setCsv(value);
    setPreview(null);
    setError("");
  }
  async function submit(apply: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await api<NonNullable<typeof preview>>(
        "users/import/",
        "POST",
        { csv, apply },
      );
      setPreview(result);
      if (result.applied) onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal className="management-dialog" title={t("Import participants")} onClose={onClose} wide>
      <div className="modal-form">
        <p>
          {t(
            "Create up to 500 learner accounts from CSV. Preview checks every row and existing sign-in identifiers before any accounts are saved.",
          )}
        </p>
        <p className="notice">
          {t(
            "Supported columns: username, email, employee_id, display_name, department, employment. Use employee or contractor for employment. Passwords and administrator roles cannot be imported.",
          )}
        </p>
        <div className="toolbar">
          <label className="btn">
            <Upload size={16} />
            {t("Choose CSV file")}
            <input
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 1_000_000) {
                  setError(t("The CSV file must be smaller than 1 MB."));
                  return;
                }
                try {
                  update(await file.text());
                } catch {
                  setError(t("The CSV file could not be read."));
                }
              }}
            />
          </label>
          <button
            className="text-btn"
            disabled={busy}
            onClick={() => update(sample)}
          >
            {t("Use sample template")}
          </button>
        </div>
        <label>
          {t("CSV content")}
          <textarea
            className="csv-input"
            rows={9}
            value={csv}
            disabled={busy || preview?.applied}
            onChange={(e) => update(e.target.value)}
          />
        </label>
        <ErrorBox message={error} />
        {preview && (
          <div aria-live="polite">
            <p className={preview.valid ? "notice success" : "notice"}>
              {preview.applied
                ? t("Created {count} learner accounts.", {
                    count: preview.count,
                  })
                : preview.valid
                  ? t("All {count} rows are valid. Ready to import.", {
                      count: preview.count,
                    })
                  : t("Fix the errors below. No accounts were created.")}
            </p>
            {preview.errors.map((item) => (
              <div className="import-error" key={item.row}>
                <strong>{t("Row {number}", { number: item.row })}</strong>
                <span>
                  {typeof item.message === "string"
                    ? item.message
                    : JSON.stringify(item.message)}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="notice">
          {t(
            "New accounts can use email codes when email delivery is configured. For employee-ID-only accounts, set an initial password in Edit person. Existing accounts are never overwritten.",
          )}
        </p>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            {t("Close")}
          </button>
          {!preview?.applied && (
            <>
              <button
                className="btn"
                disabled={busy || !csv.trim()}
                onClick={() => submit(false)}
              >
                {t("Validate preview")}
              </button>
              <button
                className="btn primary"
                disabled={busy || !preview?.valid}
                onClick={() => submit(true)}
              >
                {busy ? t("Saving…") : t("Create learner accounts")}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function PersonEditor({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  useLocale();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [role, setRole] = useState<User["role"]>(user.role);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      await api(`users/${user.id}/`, "PATCH", values);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal className="management-dialog" title={t("Edit person")} onClose={onClose}>
      <form className="modal-form" onSubmit={save}>
        <p className="notice">
          {user.username} · {user.email || user.employee_id || "—"}
        </p>
        <p>
          {t(
            "Sign-in identifiers stay fixed to preserve assessment ownership.",
          )}
        </p>
        {user.entra_subject && <p className="notice">{t("Microsoft sign-in linked. Role changes keep the existing company sign-in and learning history.")}</p>}
        <div className="form-grid">
          <label>
            {t("Display name")}
            <input
              name="display_name"
              required
              maxLength={100}
              defaultValue={user.display_name}
            />
          </label>
          <label>
            {t("Department")}
            <input
              name="department"
              maxLength={100}
              defaultValue={user.department}
            />
          </label>
          <label>
            {t("Employment type")}
            <select name="employment" defaultValue={user.employment}>
              <option value="employee">{t("Employees")}</option>
              <option value="contractor">{t("Contractors")}</option>
            </select>
          </label>
          <label>
            {t("System role")}
            <select name="role" value={role} onChange={event => setRole(event.target.value as User["role"])} aria-describedby="person-role-help">
              {rolesFor(user.role).map(key => <option key={key} value={key}>{roleLabel(key)}</option>)}
            </select>
          </label>
          <p className="span-2 role-help" id="person-role-help">{t(roleInfo[role].help)}</p>
          <label className="span-2">
            {t("New password (leave blank to keep current)")}
            <input
              type="password"
              name="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
        </div>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? t("Saving…") : t("Save person")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PasswordDialog({ onClose }: { onClose: () => void }) {
  useLocale();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    if (form.get("new_password") !== form.get("confirm_password")) {
      setError(t("The new passwords do not match."));
      return;
    }
    setBusy(true);
    try {
      await api("auth/password/", "POST", {
        current_password: form.get("current_password"),
        new_password: form.get("new_password"),
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("Change password")} onClose={onClose}>
      {done ? (
        <div className="modal-form">
          <CheckCircle2 size={32} />
          <p>{t("Password changed. You remain signed in on this browser.")}</p>
          <button className="btn primary" onClick={onClose}>
            {t("Close")}
          </button>
        </div>
      ) : (
        <form className="modal-form" onSubmit={save}>
          <p className="notice">
            {t(
              "This changes your local platform password. Manage your Microsoft password through your organization. If you have no local password, ask an administrator to set one.",
            )}
          </p>
          <label>
            {t("Current password")}
            <input
              required
              type="password"
              name="current_password"
              autoComplete="current-password"
            />
          </label>
          <label>
            {t("New password")}
            <input
              required
              type="password"
              name="new_password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <label>
            {t("Confirm new password")}
            <input
              required
              type="password"
              name="confirm_password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <ErrorBox message={error} />
          <div className="modal-footer">
            <button className="btn primary" disabled={busy}>
              {busy ? t("Saving…") : t("Change password")}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
