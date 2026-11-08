import { useEffect, useMemo, useState } from "react";
import { t, useLocale } from "./i18n";

export type RetryInfo = {
  retry_interval_minutes: number;
  next_attempt_at: string | null;
  server_time: string;
  active_attempt_id: string | null;
};

export function useRetryAvailability(value?: RetryInfo | null) {
  const [, tick] = useState(0);
  // Advance the server's clock with monotonic elapsed time. Changing the device
  // clock must not unlock a retry or extend its waiting period.
  const clock = useMemo(
    () => ({
      server: value ? Date.parse(value.server_time) : 0,
      received: performance.now(),
    }),
    [value?.server_time],
  );
  const now = clock.server + performance.now() - clock.received;
  const waiting = !!(
    value?.next_attempt_at &&
    !value.active_attempt_id &&
    Date.parse(value.next_attempt_at) > now
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => tick((count) => count + 1), 1000);
    return () => window.clearInterval(timer);
  }, [waiting, clock]);
  return waiting;
}

export function RetryNotice({ value }: { value: RetryInfo }) {
  const locale = useLocale();
  const waiting = useRetryAvailability(value);
  return (
    <div className="retry-availability" aria-live="polite">
      {waiting && (
        <p className="notice">
          <strong>
            {t("Next attempt available at {time}", {
              time: new Date(value.next_attempt_at!).toLocaleString(locale),
            })}
          </strong>
          <span>
            {t(
              "The waiting period is measured from the start of your previous attempt.",
            )}
          </span>
        </p>
      )}
    </div>
  );
}
