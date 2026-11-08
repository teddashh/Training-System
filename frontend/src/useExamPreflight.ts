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
  } | null>(null);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    if (!request.id) return;
    let alive = true;
    api<Exam>(`exams/${request.id}/`)
      .then((value) => {
        if (alive) setResult({ request, exam: value, error: "" });
      })
      .catch((failure) => {
        if (alive) setResult({ request, exam: null, error: failure.message });
      });
    return () => {
      alive = false;
    };
  }, [request]);
  // Reopening the same exam still requires a fresh response. Cached metadata
  // cannot enable the button for a render before the new request starts.
  const current = result?.request === request ? result : null;
  return {
    exam: current?.exam ?? null,
    loading: !!id && !current,
    error: current?.error ?? "",
    refresh,
  };
}
