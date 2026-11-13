import { useState, type CSSProperties } from "react";
import { Expand } from "lucide-react";
import { appPath } from "./paths";
import { t, useLocale } from "./i18n";
import { Modal } from "./ui";
import type { Question } from "./types";

type FigureQuestion = Pick<Question, "description" | "figure" | "figure_alt" | "figure_caption">;

export default function QuestionFigure({ question }: { question: FigureQuestion }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const figure = question.figure;
  if (!figure) return null;
  const alt = figure.alt ?? question.figure_alt ?? "";
  const caption = figure.caption ?? question.figure_caption ?? "";
  const src = appPath(`/api/question-figures/${encodeURIComponent(figure.key)}/`);
  return <figure className="question-figure">
    <button type="button" className="figure-open" aria-label={alt ? t("Enlarge figure: {description}", { description: alt }) : t("Enlarge figure")}
      onClick={() => setOpen(true)}>
      <img src={src} alt={alt} width={figure.width} height={figure.height} decoding="async" />
      <span className="figure-enlarge-cue" aria-hidden="true"><Expand size={16} />{t("Enlarge")}</span>
    </button>
    {caption && <figcaption>{caption}</figcaption>}
    {open && <Modal title={t("Figure")} onClose={() => setOpen(false)} wide className="figure-dialog" showLanguagePicker={false}>
      <div className="figure-scroll" tabIndex={0} role="region" aria-label={t("Enlarged figure")}>
        <img src={src} alt={alt} width={figure.width} height={figure.height} decoding="async"
          style={{ "--figure-pixel-width": `${figure.width}px`, "--figure-design-width": `${figure.width / 2}px` } as CSSProperties} />
      </div>
      {caption && <p className="figure-dialog-caption">{caption}</p>}
    </Modal>}
  </figure>;
}

export function QuestionContent({ question, heading: Heading = "h3", headingClassName = "", prefix = "" }: {
  question: FigureQuestion; heading?: "h2" | "h3" | "span" | "strong"; headingClassName?: string; prefix?: string;
}) {
  const paragraphs = question.description.replace(/\r\n?/g, "\n").split(/\n[\t ]*\n+/).filter(paragraph => paragraph.trim());
  return <>
    {paragraphs.slice(0, -1).map((paragraph, index) =>
      <p className="question-context preserve-lines" key={index}>{paragraph}</p>)}
    <Heading className={`preserve-lines ${headingClassName}`}>{prefix}{paragraphs.at(-1)}</Heading>
    <QuestionFigure question={question} />
  </>;
}

// API writes use a key, while read forms and local editor drafts carry dimensions.
export function questionPayload(question: Question) {
  return { ...question, figure: question.figure?.key ?? null };
}
