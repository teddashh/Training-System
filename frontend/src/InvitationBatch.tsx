import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { api, ApiError } from "./api";
import { t, useLocale } from "./i18n";
import { ErrorBox, Modal } from "./ui";
import type { Exam, Invitation } from "./types";

type PreviewRow = {
  row: number;
  key: string;
  identity_key?: string;
  participant?: string;
  verification_email?: string;
  remaining_new_attempts?: number;
  error: string;
};
type BatchResult = {
  valid: boolean;
  applied: boolean;
  count: number;
  rows?: PreviewRow[];
  invitations?: Invitation[];
  replayed?: boolean;
};
type Payload = {
  csv: string;
  exam: number;
  max_attempts: number;
  days: number;
  require_email_verification: boolean;
  apply: boolean;
  request_id?: string;
};

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r\n]/.test(text.trimStart()) || /^[\t\r\n]/.test(text))
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export default function InvitationBatch({
  exams,
  onClose,
  onSaved,
}: {
  exams: Exam[];
  onClose: () => void;
  onSaved: () => void;
}) {
  useLocale();
  const [exam, setExam] = useState(
    String(exams.find((e) => e.can_manage && e.published)?.id || ""),
  );
  const [csv, setCsv] = useState(""),
    [limit, setLimit] = useState(1),
    [days, setDays] = useState(7);
  const [verify, setVerify] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<BatchResult | null>(null);
  const [pending, setPending] = useState<Payload | null>(null);
  const [downloaded, setDownloaded] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const mounted = useRef(true);
  const locked = busy || !!pending || !!result?.applied;
  const unsavedLinks = (!!pending || !!result?.applied) && !downloaded;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!unsavedLinks) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsavedLinks]);
  function resetPreview() {
    setResult(null);
    setError("");
  }
  function close() {
    if (busy) return;
    if (unsavedLinks) setConfirmClose(true);
    else onClose();
  }
  async function submit(apply: boolean) {
    if (busy) return;
    const payload = pending || {
      csv,
      exam: Number(exam),
      max_attempts: limit,
      days,
      require_email_verification: verify,
      apply,
      ...(apply ? { request_id: crypto.randomUUID() } : {}),
    };
    if (apply) setPending(payload);
    setBusy(true);
    setError("");
    try {
      const response = await api<BatchResult>(
        "invitations/bulk/",
        "POST",
        payload,
        30000,
      );
      if (!mounted.current) return;
      setResult(response);
      setPending(null);
      if (response.applied) onSaved();
    } catch (reason) {
      if (!mounted.current) return;
      setError((reason as Error).message);
      // These responses reject the request before issuance. Network failures
      // retain the same payload and request UUID for safe recovery.
      if (reason instanceof ApiError && [400, 403, 404].includes(reason.status))
        setPending(null);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function download() {
    const headers = [
      "participant_key",
      "exam",
      "max_attempts",
      "remaining_new_attempts",
      "expires_at",
      "verification_email",
      "requires_email_verification",
      "url",
    ];
    const rows = (result?.invitations || []).map((row) => [
      row.identity_key,
      row.exam_title,
      row.max_attempts,
      row.remaining_new_attempts,
      row.expires_at,
      row.verification_email,
      row.require_email_verification,
      row.url,
    ]);
    const content =
      "\ufeff" +
      [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
      "\r\n";
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "exam-invitations.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
  }
  return (
    <>
      <Modal
        title={t(
          result?.applied
            ? "Batch invitations created"
            : "Create invitation batch",
        )}
        onClose={close}
        wide
      >
        <div className="modal-form">
          {result?.applied ? (
            <>
              <p className="notice success" role="status">
                {t("Created {count} personal invitation links.", {
                  count: result.count,
                })}
              </p>
              <p>
                {t(
                  "Download the links before closing. Invitation history contains metadata, not the full access links.",
                )}
              </p>
              <button className="btn primary" onClick={download}>
                <Download size={17} />
                {t("Download invitation links CSV")}
              </button>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Participant")}</th>
                      <th>{t("New attempts remaining")}</th>
                      <th>{t("Personal exam link")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.invitations?.map((row) => (
                      <tr key={row.id}>
                        <td>
                          {row.identity_key.replace(/^(email|account):/, "")}
                        </td>
                        <td>{row.remaining_new_attempts}</td>
                        <td>
                          <input
                            className="invitation-link"
                            aria-label={t("Link for {participant}", {
                              participant: row.identity_key,
                            })}
                            value={row.url || ""}
                            readOnly
                            onFocus={(e) => e.target.select()}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="notice">
                {t(
                  "This download contains access credentials. Share each link only with its intended participant and store the file securely.",
                )}
              </p>
            </>
          ) : (
            <>
              <p>
                {t(
                  "Preview up to 200 recipients, then create one personal link per identity. Existing accounts and attempt budgets are preserved.",
                )}
              </p>
              <div className="form-grid">
                <label className="span-2">
                  {t("Select exam")}
                  <select
                    value={exam}
                    disabled={locked}
                    onChange={(e) => {
                      setExam(e.target.value);
                      resetPreview();
                    }}
                  >
                    <option value="">{t("Please select")}</option>
                    {exams
                      .filter((e) => e.can_manage && e.published)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {t("Maximum attempts with this link")}
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={limit}
                    disabled={locked}
                    onChange={(e) => {
                      setLimit(Number(e.target.value));
                      resetPreview();
                    }}
                  />
                </label>
                <label>
                  {t("Valid for (days)")}
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={days}
                    disabled={locked}
                    onChange={(e) => {
                      setDays(Number(e.target.value));
                      resetPreview();
                    }}
                  />
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={verify}
                  disabled={locked}
                  onChange={(e) => {
                    setVerify(e.target.checked);
                    resetPreview();
                  }}
                />
                {t("Require recipient email verification")}
              </label>
              {!verify && (
                <p className="notice">
                  {t(
                    "Anyone holding a link can use its bound identity when email verification is disabled.",
                  )}
                </p>
              )}
              <p className="notice">
                {t(
                  "CSV headers: key,verification_email. The key can be an email, username or employee ID. Leave verification_email blank to use the participant's email.",
                )}
              </p>
              <div className="toolbar">
                <label className="btn">
                  <Upload size={16} />
                  {t("Choose CSV file")}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    disabled={locked}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 262144) {
                        setError(
                          t("The invitation CSV must be 256 KB or smaller."),
                        );
                        return;
                      }
                      try {
                        setCsv(await file.text());
                        resetPreview();
                      } catch {
                        setError(t("The CSV file could not be read."));
                      }
                    }}
                  />
                </label>
                <button
                  className="text-btn"
                  disabled={locked}
                  onClick={() => {
                    setCsv(
                      "key,verification_email\npartner01@example.com,\ncontractor-02,partner02@example.com\n",
                    );
                    resetPreview();
                  }}
                >
                  {t("Use sample template")}
                </button>
              </div>
              <label>
                {t("Recipient CSV")}
                <textarea
                  className="csv-input"
                  rows={6}
                  value={csv}
                  disabled={locked}
                  onChange={(e) => {
                    setCsv(e.target.value);
                    resetPreview();
                  }}
                />
              </label>
              {result && (
                <>
                  <p
                    className={result.valid ? "notice success" : "notice"}
                    role="status"
                  >
                    {result.valid
                      ? t(
                          "All {count} recipients are valid. No links have been created yet.",
                          { count: result.count },
                        )
                      : t(
                          "Fix the recipient errors. No invitations were created.",
                        )}
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Row")}</th>
                          <th>{t("Participant")}</th>
                          <th>{t("Verification email")}</th>
                          <th>{t("New attempts remaining")}</th>
                          <th>{t("Validation")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows?.map((row) => (
                          <tr key={row.row}>
                            <td>{row.row}</td>
                            <td>
                              {row.participant || row.key}
                              <small className="cell-note">
                                {row.identity_key}
                              </small>
                            </td>
                            <td>{row.verification_email || "—"}</td>
                            <td>{row.remaining_new_attempts ?? "—"}</td>
                            <td>
                              {row.error ? (
                                <span className="danger-text">{row.error}</span>
                              ) : (
                                t("Valid")
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {result.rows?.some(
                    (row) => !row.error && row.remaining_new_attempts === 0,
                  ) && (
                    <p className="notice">
                      {t(
                        "Some participants have no new attempts remaining. A new link does not reset their budget; an existing attempt may still be resumed.",
                      )}
                    </p>
                  )}
                </>
              )}
              {pending && !busy && (
                <p className="notice">
                  {t(
                    "The issuance result is uncertain. Keep this dialog open and retry the same request within ten minutes to recover its links without creating duplicates.",
                  )}
                </p>
              )}
              <div className="modal-footer">
                {!pending && (
                  <button
                    className="btn"
                    disabled={busy || !csv.trim() || !exam}
                    onClick={() => submit(false)}
                  >
                    {t("Validate recipients")}
                  </button>
                )}
                <button
                  className="btn primary"
                  disabled={busy || (!pending && !result?.valid)}
                  onClick={() => submit(true)}
                >
                  {busy
                    ? pending
                      ? t("Creating…")
                      : t("Validating…")
                    : pending
                      ? t("Retry batch request")
                      : t("Create invitation links")}
                </button>
              </div>
            </>
          )}
          <ErrorBox message={error} />
          <div className="modal-footer">
            <button className="btn" disabled={busy} onClick={close}>
              {t("Close")}
            </button>
          </div>
        </div>
      </Modal>
      {confirmClose && (
        <Modal
          title={t("Close invitation batch?")}
          onClose={() => setConfirmClose(false)}
        >
          <div className="modal-form">
            <p>
              {t(
                "Closing discards the links or recovery request held in this window. Download successful results first; if creation is uncertain, check invitation history before issuing another batch.",
              )}
            </p>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirmClose(false)}>
                {t("Keep open")}
              </button>
              <button className="btn danger-text" onClick={onClose}>
                {t("Close without download")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
