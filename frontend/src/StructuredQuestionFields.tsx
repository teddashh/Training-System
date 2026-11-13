import { t } from "./i18n";
import type { Question } from "./types";

export default function StructuredQuestionFields({
  question,
  onChange,
}: {
  question: Question;
  onChange: (patch: Partial<Question>) => void;
}) {
  if (question.type === "ordering") {
    const items = (question.solution || []).map(
      (index) => question.options[Number(index)],
    );
    return (
      <label>
        {t("Correct order")}
        <textarea
          required
          rows={5}
          value={items.join("\n")}
          onChange={(event) => {
            const options = event.target.value.split("\n");
            onChange({ options, solution: options.map((_, index) => index) });
          }}
        />
        <span className="field-hint">
          {t(
            "Enter 2–20 items, one per line; learners see them shuffled.",
          )}
        </span>
      </label>
    );
  }
  if (question.type !== "integer" && question.type !== "numeric") return null;
  const solution = question.solution || [""];
  const tolerances = question.answer_tolerances || [];
  return (
    <section
      className="numeric-rules"
      aria-label={t("Accepted numeric answers")}
    >
      <p className="field-hint">
        {question.type === "integer"
          ? t("Any listed integer earns full credit.")
          : t(
              "Tolerance includes its limits; 0 requires an exact match.",
            )}
      </p>
      {solution.map((value, index) => (
        <div className="numeric-rule" key={index}>
          <label>
            {t("Accepted number {number}", { number: index + 1 })}
            <input
              required
              type="text"
              maxLength={128}
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
          {question.type === "numeric" && (
            <label>
              {t("Tolerance {number}", { number: index + 1 })}
              <input
                required
                type="text"
                maxLength={128}
                value={tolerances[index] ?? "0"}
                onChange={(event) =>
                  onChange({
                    answer_tolerances: solution.map((_, i) =>
                      i === index ? event.target.value : (tolerances[i] ?? "0"),
                    ),
                  })
                }
              />
            </label>
          )}
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
                answer_tolerances: tolerances.filter((_, i) => i !== index),
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
            answer_tolerances:
              question.type === "numeric" ? [...tolerances, "0"] : [],
          })
        }
      >
        {t("Add accepted answer")}
      </button>
      {question.type === "numeric" && (
        <p className="field-hint">
          {t(
            "Use decimals (12.5) or scientific notation.",
          )}
        </p>
      )}
    </section>
  );
}
