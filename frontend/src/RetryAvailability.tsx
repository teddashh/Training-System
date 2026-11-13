import { formatDateTime } from "./datetime";
import { useEffect, useMemo, useState } from "react";
import { t, useLocale } from "./i18n";

export type RetryInfo = {
  retry_interval_minutes?: number;
  next_attempt_at: string | null;
  server_time?: string;
  active_attempt_id: string | null;
  next_round_at?: string | null;
  round_awaiting_grading?: boolean;
  /** Signed-in exams only. Before a first attempt a wait is the opening time, never a retry. */
  attempts_used?: number;
  attempts_remaining?: number;
  starts_at?: string | null;
};

export function useRetryAvailability(value?: RetryInfo | null) {
  return useRetryStatus(value).waiting;
}

export function useRetryStatus(value?: RetryInfo | null) {
  const [, tick] = useState(0);
  // Advance the server's clock with monotonic elapsed time. Changing the device
  // clock must not unlock a retry or extend its waiting period.
  const clock = useMemo(
    () => ({
      server: value?.server_time ? Date.parse(value.server_time) : Date.now(),
      received: performance.now(),
    }),
    [value?.server_time],
  );
  const now = clock.server + performance.now() - clock.received;
  const next = value?.next_attempt_at || value?.next_round_at;
  const waiting = !!(
    next &&
    (value?.attempts_remaining !== 0 || value?.next_round_at) &&
    !value.active_attempt_id &&
    Date.parse(next) > now
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => tick((count) => count + 1), 1000);
    return () => window.clearInterval(timer);
  }, [waiting, clock]);
  return { waiting, now, next, seconds: waiting ? Math.ceil((Date.parse(next!) - now) / 1000) : 0 };
}

export function RetryNotice({ value }: { value: RetryInfo }) {
  const locale = useLocale();
  const { waiting, next, seconds } = useRetryStatus(value);
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
  const remaining = hours ? t('Retry in {hours} h {minutes} min', {hours, minutes})
    : seconds > 60 ? t('Retry in {minutes} min', {minutes: Math.ceil(seconds / 60)}) : t('Retry in {seconds} sec', {seconds});
  // Nothing was attempted yet, so the wait is when the exam opens for this person (after their session).
  const first = value.attempts_used === 0;
  // The page already shows that time when the exam's own start carries it.
  const shown = !!value.starts_at && Date.parse(value.starts_at) >= Date.parse(value.next_attempt_at || "");
  if ((!waiting || (first && shown)) && !(value.round_awaiting_grading && !value.active_attempt_id)) return null;
  return (
    <div className="retry-availability" aria-live="polite">
      {value.round_awaiting_grading && !value.active_attempt_id && <p className="notice">{t("All results must be graded before a new round can be scheduled.")}</p>}
      {waiting && first && !shown && (
        <p className="notice">
          <strong>{t("Opens {time}", { time: formatDateTime(value.next_attempt_at!, locale, { zone: true }) })}</strong>
        </p>
      )}
      {waiting && !first && (
        <p className="notice">
          <strong>
            {t("Next attempt available at {time}", {
              time: formatDateTime(next!, locale, {zone: true}),
            })}
          </strong>
          <span aria-live="off">{remaining}</span>
          <span>
            {t(value.next_round_at ? "A new round opens after the failed round's waiting period. Earlier results are kept." : "The waiting period is measured from the start of your previous attempt.")}
          </span>
        </p>
      )}
    </div>
  );
}
