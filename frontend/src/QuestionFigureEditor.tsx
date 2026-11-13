import { useId, useRef, useState } from "react";
import { api } from "./api";
import { t, useLocale } from "./i18n";
import type { Question, Figure } from "./types";
import { ErrorBox } from "./ui";
import QuestionFigure from "./QuestionFigure";

export default function QuestionFigureEditor({ question, onChange, onBusyChange }: {
  question: Question; onChange: (change: Partial<Question>) => void;
  onBusyChange: (delta: number) => void;
}) {
  useLocale();
  const hint = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const change = useRef(onChange);
  change.current = onChange;
  async function upload(file: File) {
    setBusy(true);
    onBusyChange(1);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const figure = await api<Figure>("question-figures/", "POST", form);
      change.current({ figure });
    } catch (e) { setError((e as Error).message); }
    finally {
      setBusy(false);
      onBusyChange(-1);
      if (picker.current) picker.current.value = "";
    }
  }
  return <section className="figure-editor" aria-label={t("Figure")}>
    <h4>{t("Figure")}</h4>
    <label>{t("Upload figure")}
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
        onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    </label>
    <p className="muted">{t("PNG/JPEG/WebP: max 5 MiB, 4096 px per side, 16 MP.")}</p>
    {busy && <p role="status">{t("Uploading figure…")}</p>}
    <ErrorBox message={error} />
    {question.figure && <>
      <QuestionFigure question={question} />
      <label>{t("Alt text")}
        <input required maxLength={2000} value={question.figure_alt || ""} aria-describedby={hint}
          onChange={event => onChange({ figure_alt: event.target.value })} />
      </label>
      <p className="muted" id={hint}>{t("Describe the figure; 2,000 characters max.")}</p>
      <label>{t("Caption")}
        <input maxLength={300} value={question.figure_caption || ""}
          onChange={event => onChange({ figure_caption: event.target.value })} />
      </label>
      <button type="button" className="btn" disabled={busy} onClick={() => {
        onChange({ figure: null, figure_alt: "", figure_caption: "" }); setError("");
      }}>{t("Remove figure")}</button>
    </>}
  </section>;
}
