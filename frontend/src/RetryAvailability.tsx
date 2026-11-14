import { nextRetryAt, retryWaiting } from "./examLearnerState";
import { formatDateTime } from "./datetime";
import { useEffect, useMemo, useState } from "react";
import { t, useLocale } from "./i18n";
import { arrival } from "./serverClock";

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
  has_passed?: boolean;
  remaining?: number;
  starts_at?: string | null;
  /** When the exam closes, or the invitation expires: no attempt can start after it. */
  ends_at?: string | null;
  expires_at?: string | null;
};

export function useRetryAvailability(value?: RetryInfo | null) {
  return useRetryStatus(value).waiting;
}

export function useRetryStatus(value?: RetryInfo | null) {
  const [, tick] = useState(0);
  // Advance the server's clock with monotonic elapsed time, counted from the arrival of the answer and not
  // from when it is shown. Changing the device clock must not unlock a retry or extend its waiting period.
  const clock = useMemo(
    () => value?.server_time
      ? { server: Date.parse(value.server_time), received: arrival(value.server_time) }
      : { server: Date.now(), received: performance.now() },
    [value?.server_time],
  );
  const now = clock.server + performance.now() - clock.received;
  const next = value && nextRetryAt(value);
  const waiting = !!value && retryWaiting(value, now);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => tick((count) => count + 1), 1000);
    return () => window.clearInterval(timer);
  }, [waiting, clock]);
  return { waiting, now, next, seconds: waiting ? Math.ceil((Date.parse(next!) - now) / 1000) : 0 };
}

export function RetryNotice({ value }: { value: RetryInfo }) {
  const locale = useLocale();
  const { waiting, next, seconds, now } = useRetryStatus(value);
  // The wait this notice counted down. When it ends the notice keeps its lines, with "Ready" in place of
  // the countdown, so nothing below it moves; it goes when the answer no longer offers that attempt.
  const [counted, setCounted] = useState<string | null>(null);
  useEffect(() => { if (waiting && next) setCounted(next); }, [waiting, next]);
  const closed = [value.ends_at, value.expires_at].some(end => !!end && Date.parse(end) <= now);
  // Also after a remount (a list filtered and shown again): the answer itself says it carried a wait.
  const waitedAtArrival = !!value.server_time && retryWaiting(value, Date.parse(value.server_time));
  const ended = !waiting && !closed && (waitedAtArrival || (!!next && counted === next && retryWaiting(value, 0)));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
  const remaining = hours ? t('Retry in {hours} h {minutes} min', {hours, minutes})
    : seconds > 60 ? t('Retry in {minutes} min', {minutes: Math.ceil(seconds / 60)}) : t('Retry in {seconds} sec', {seconds});
  // Nothing was attempted yet, so the wait is when the exam opens for this person (after their session).
  const first = value.attempts_used === 0;
  // The page already shows that time when the exam's own start carries it.
  const shown = !!value.starts_at && Date.parse(value.starts_at) >= Date.parse(value.next_attempt_at || "");
  const wait = (waiting || ended) && !(first && shown);
  if (value.has_passed || (!wait && !(value.round_awaiting_grading && !value.active_attempt_id))) return null;
  return (
    <div className="retry-availability" aria-live="polite">
      {value.round_awaiting_grading && !value.active_attempt_id && <p className="notice">{t("All results must be graded before a new round can be scheduled.")}</p>}
      {wait && first && (
        <p className={"notice" + (ended ? " retry-opened" : "")}>
          {ended && <strong>{t("Ready")}</strong>}
          {/* Kept, unseen, once the exam has opened: it gives the notice the height it had. */}
          <strong aria-hidden={ended || undefined}>{t("Opens {time}", { time: formatDateTime(next!, locale, { zone: true }) })}</strong>
        </p>
      )}
      {wait && !first && (
        <p className="notice">
          <strong>
            {t("Next attempt available at {time}", {
              time: formatDateTime(next!, locale, {zone: true}),
            })}
          </strong>
          {ended ? <span>{t("Ready")}</span> : <span aria-live="off">{remaining}</span>}
          <span>
            {t(value.next_round_at ? "A new round opens after the failed round's waiting period. Earlier results are kept." : "The waiting period is measured from the start of your previous attempt.")}
          </span>
        </p>
      )}
    </div>
  );
}
