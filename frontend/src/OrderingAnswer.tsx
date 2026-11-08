import { ArrowUp, ArrowDown, CheckCircle2 } from "lucide-react";
import { t } from "./i18n";

export default function OrderingAnswer({
  options,
  answer,
  disabled,
  onChange,
}: {
  options: string[];
  answer: string | number | number[] | undefined;
  disabled: boolean;
  onChange: (value: number[]) => void;
}) {
  const selected = Array.isArray(answer) && answer.length === options.length;
  const order = selected ? answer : options.map((_, index) => index);
  function move(index: number, delta: number) {
    const next = [...order];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  }
  return (
    <div
      role="group"
      aria-label={t("Your ordered answer")}
      className="ordering-answer"
    >
      <p className="field-hint">
        {t(
          "Arrange the items from first to last using the arrow buttons. If this order is already correct, choose Use this order.",
        )}
      </p>
      <ol>
        {order.map((item, index) => (
          <li key={item}>
            <span className="order-number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="order-text">{options[item]}</span>
            <div className="order-controls">
              <button
                type="button"
                className="icon-btn"
                disabled={disabled || index === 0}
                aria-label={t("Move item {number} up", { number: index + 1 })}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={18} />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={disabled || index === order.length - 1}
                aria-label={t("Move item {number} down", { number: index + 1 })}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={18} />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div aria-live="polite">
        {selected ? (
          <p className="field-hint">
            <CheckCircle2 size={15} />{" "}
            {t("Order selected. You can still move items before submitting.")}
          </p>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={disabled}
            onClick={() => onChange(order)}
          >
            {t("Use this order")}
          </button>
        )}
      </div>
    </div>
  );
}
