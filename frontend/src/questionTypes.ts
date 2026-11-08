import { t } from "./i18n";
import type { Question, TextMatchingMode } from "./types";

export const textMatchingModes = (): [TextMatchingMode, string][] => [
  ["normalized", t("Ignore case and surrounding whitespace")],
  ["lower", t("Ignore case; preserve spacing")],
  ["exact", t("Match case and spacing")],
];

export const questionTypes = (): [Question["type"], string][] => [
  ["single", t("Single choice")],
  ["multiple", t("Multiple choice")],
  ["short", t("Short answer")],
  ["essay", t("Written response")],
  ["integer", t("Integer answer")],
  ["numeric", t("Numeric answer")],
  ["ordering", t("Ordering")],
];

export function questionTypeDefaults(
  type: Question["type"],
): Partial<Question> {
  const options = ["single", "multiple", "ordering"].includes(type)
    ? ["", ""]
    : [];
  return {
    type,
    options,
    solution:
      type === "ordering"
        ? [0, 1]
        : ["short", "integer", "numeric"].includes(type)
          ? [""]
          : type === "essay"
            ? []
            : [0],
    answer_tolerances: type === "numeric" ? ["0"] : [],
    answer_matching: type === "short" ? ["normalized"] : [],
  };
}

export function answerText(question: Question, answer: unknown): string {
  if (["single", "multiple", "ordering"].includes(question.type)) {
    const selected = Array.isArray(answer)
      ? answer
      : typeof answer === "number"
        ? [answer]
        : [];
    return selected
      .map((value, index) => {
        const label = question.options[value] ?? "";
        return question.type === "ordering" ? `${index + 1}. ${label}` : label;
      })
      .join("\n");
  }
  return String(answer ?? "");
}

export function acceptedAnswerText(question: Question): string {
  if (["single", "multiple", "ordering"].includes(question.type)) {
    return answerText(question, question.solution);
  }
  return (question.solution || [])
    .map((value, index) =>
      question.type === "numeric"
        ? `${value} ± ${question.answer_tolerances?.[index] ?? "0"}`
        : question.type === "short"
          ? `${textMatchingModes().find(([mode]) => mode === (question.answer_matching?.[index] ?? "normalized"))?.[1]}:\n${value}`
          : String(value),
    )
    .join("\n");
}
