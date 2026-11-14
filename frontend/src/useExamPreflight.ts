import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Exam } from "./types";

export function useExamPreflight(id?: number) {
  const [version, setVersion] = useState(0);
  const request = useMemo(() => ({ id, version }), [id, version]);
  const [result, setResult] = useState<{
    request: typeof request;
    exam: Exam | null;
    error: string;
    /** The last answer for this exam; a refresh, also a failed one, keeps it. */
    shown: Exam | null;
  } | null>(null);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    if (!request.id) {
      // Closed: the next opening starts from the list's row, not from an older answer.
      setResult(null);
      return;
    }
    let alive = true;
    api<Exam>(`exams/${request.id}/`)
      .then((value) => {
        if (alive) setResult({ request, exam: value, error: "", shown: value });
      })
      .catch((failure) => {
        if (alive)
          setResult((previous) => ({
            request,
            exam: null,
            error: failure.message,
            shown: previous && previous.request.id === request.id ? previous.shown : null,
          }));
      });
    return () => {
      alive = false;
    };
  }, [request]);
  // Reopening the same exam still requires a fresh response. Cached metadata
  // cannot enable the button for a render before the new request starts.
  const current = result?.request === request ? result : null;
  useEffect(() => {
    const exam = current?.exam;
    if (!exam?.next_round_at) return;
    const delay = Date.parse(exam.next_round_at) - Date.parse(exam.server_time);
    if (delay <= 0) return;
    const timer = window.setTimeout(refresh, Math.min(delay + 100, 2147483647));
    return () => clearTimeout(timer);
  }, [current, refresh]);
  return {
    exam: current?.exam ?? null,
    // For display only. While a newer answer is on its way the dialog keeps
    // the last one, so it does not collapse and grow again under the pointer.
    shown: result && result.request.id === id ? result.shown : null,
    loading: !!id && !current,
    error: current?.error ?? "",
    refresh,
  };
}
