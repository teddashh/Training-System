import { t } from "./i18n";
import { textMatchingModes } from "./questionTypes";
import type { Question, TextMatchingMode } from "./types";

export default function TextAnswerFields({
  question,
  onChange,
}: {
  question: Question;
  onChange: (patch: Partial<Question>) => void;
}) {
  const solution = question.solution || [""];
  const modes = solution.map(
    (_, index) => question.answer_matching?.[index] ?? "normalized",
  );
  return (
    <section
      className="text-answer-rules"
      aria-label={t("Accepted text answers")}
    >
      <p className="field-hint">
        {t(
          "State the required answer format in the question.",
        )}
      </p>
      {solution.map((value, index) => (
        <div className="text-answer-rule" key={index}>
          <label>
            {t("Accepted text {number}", { number: index + 1 })}
            <textarea
              required
              rows={3}
              maxLength={20000}
              spellCheck={false}
              value={String(value)}
              onChange={(event) =>
                onChange({
                  solution: solution.map((entry, i) =>
                    i === index ? event.target.value : entry,
                  ),
                })
              }
            />
          </label>
          <label>
            {t("Matching rule {number}", { number: index + 1 })}
            <select
              value={modes[index]}
              onChange={(event) =>
                onChange({
                  answer_matching: modes.map((mode, i) =>
                    i === index
                      ? (event.target.value as TextMatchingMode)
                      : mode,
                  ),
                })
              }
            >
              {textMatchingModes().map(([mode, label]) => (
                <option key={mode} value={mode}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="text-btn"
            disabled={solution.length <= 1}
            aria-label={t("Remove accepted answer {number}", {
              number: index + 1,
            })}
            onClick={() =>
              onChange({
                solution: solution.filter((_, i) => i !== index),
                answer_matching: modes.filter((_, i) => i !== index),
              })
            }
          >
            {t("Remove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        disabled={solution.length >= 20}
        onClick={() =>
          onChange({
            solution: [...solution, ""],
            answer_matching: [...modes, "normalized"],
          })
        }
      >
        {t("Add accepted answer")}
      </button>
      <p className="field-hint">
        {t(
          "Spacing rules ignore line-ending style and one final line break.",
        )}
      </p>
    </section>
  );
}
