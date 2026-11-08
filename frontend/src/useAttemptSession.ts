import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Attempt } from "./types";

type Answers = Attempt["answers"];
type Actions = {
  change: (key: string, value: Answers[string]) => void;
  submit: () => Promise<void>;
  retry: () => void;
  reload: () => void;
};

// One writer per mounted attempt. New edits never compete with an older save;
// the server revision also detects writes made by another browser window.
export function useAttemptSession(id: string) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("Saved answers loaded");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const actions = useRef<Actions | null>(null);

  useEffect(() => {
    let alive = true,
      current: Attempt | null = null,
      latest: Answers = {};
    let dirty = false,
      blocked = false,
      submitting = false,
      loading = false;
    let deadline = 0,
      retryAt = 0,
      failures = 0;
    let saving: Promise<void> | null = null,
      timer: ReturnType<typeof setTimeout> | undefined;
    setAttempt(null);
    setAnswers({});
    setError("");
    setConflict(false);
    setBusy(false);

    function accept(data: Attempt) {
      current = data;
      setAttempt(data);
      if (data.status !== "in_progress") {
        dirty = false;
        latest = data.answers;
        setAnswers(data.answers);
        clearTimeout(timer);
      }
    }
    function fail(reason: unknown) {
      const failure = reason as Error;
      setError(failure.message);
      setSaveState("Save failed");
      blocked =
        reason instanceof ApiError &&
        [400, 401, 403, 404, 409].includes(reason.status);
      setConflict(blocked);
      failures++;
      const delay =
        reason instanceof ApiError && reason.retryAfter
          ? reason.retryAfter * 1000
          : Math.min(30000, 2000 * 2 ** Math.min(failures, 4));
      retryAt = performance.now() + delay;
      if (!blocked) schedule(delay);
    }
    function schedule(delay = 600) {
      clearTimeout(timer);
      if (alive && !blocked && current?.status === "in_progress")
        timer = setTimeout(
          () => {
            void save();
          },
          Math.max(delay, retryAt - performance.now()),
        );
    }
    async function save(): Promise<void> {
      if (
        !alive ||
        !current ||
        !dirty ||
        blocked ||
        submitting ||
        current.status !== "in_progress"
      )
        return;
      if (saving) return saving;
      const snapshot = latest;
      setSaveState("Saving…");
      saving = (async () => {
        try {
          const result = await api<Attempt>(`attempts/${id}/`, "PATCH", {
            answers: snapshot,
            answer_revision: current!.answer_revision,
          });
          if (!alive) return;
          accept(result);
          dirty = result.status === "in_progress" && latest !== snapshot;
          failures = 0;
          retryAt = 0;
          setError("");
          setSaveState(
            dirty ? "Unsaved changes" : "Answers saved automatically",
          );
        } catch (reason) {
          if (alive) fail(reason);
        } finally {
          saving = null;
          if (alive && dirty && !blocked && !submitting && !failures)
            schedule(0);
        }
      })();
      return saving;
    }
    async function submit() {
      if (
        !alive ||
        !current ||
        submitting ||
        blocked ||
        current.status !== "in_progress"
      )
        return;
      submitting = true;
      setBusy(true);
      clearTimeout(timer);
      setError("");
      // A pending PATCH may already have reached the server. Wait for its
      // revision before sending the final snapshot, including newer edits.
      if (saving) await saving;
      try {
        if (!alive || blocked || current.status !== "in_progress") return;
        const result = await api<Attempt>(`attempts/${id}/`, "POST", {
          answers: latest,
          answer_revision: current.answer_revision,
        });
        if (alive) {
          accept(result);
          setError("");
          failures = 0;
        }
      } catch (reason) {
        if (alive) {
          if (
            reason instanceof ApiError &&
            reason.code === "answers_required"
          ) {
            setError(reason.message);
            setSaveState(
              dirty ? "Unsaved changes" : "Answers saved automatically",
            );
          } else fail(reason);
        }
      } finally {
        submitting = false;
        if (alive) setBusy(false);
        if (alive && dirty && !blocked && !failures) schedule();
      }
    }
    async function reload() {
      if (loading || saving || submitting) return;
      loading = true;
      setBusy(true);
      clearTimeout(timer);
      try {
        const data = await api<Attempt>(`attempts/${id}/`);
        if (!alive) return;
        latest = data.answers;
        dirty = false;
        blocked = false;
        failures = 0;
        retryAt = 0;
        // Server timestamps establish the remaining duration; elapsed time must
        // not jump if the participant changes the device wall clock.
        deadline =
          performance.now() +
          new Date(data.deadline).getTime() -
          new Date(data.server_time).getTime();
        accept(data);
        setAnswers(latest);
        setError("");
        setConflict(false);
        setSaveState("Saved answers loaded");
        setRemaining(
          Math.max(0, Math.ceil((deadline - performance.now()) / 1000)),
        );
      } catch (reason) {
        if (alive) {
          setError((reason as Error).message);
          setConflict(true);
        }
      } finally {
        loading = false;
        if (alive) setBusy(false);
      }
    }
    function retry() {
      retryAt = 0;
      if (performance.now() >= deadline && current) void submit();
      else void save();
    }
    actions.current = {
      change(key, value) {
        if (
          !current ||
          current.status !== "in_progress" ||
          blocked ||
          submitting ||
          loading ||
          performance.now() >= deadline
        )
          return;
        latest = { ...latest, [key]: value };
        dirty = true;
        setAnswers(latest);
        setSaveState("Unsaved changes");
        schedule();
      },
      submit,
      retry,
      reload: () => {
        void reload();
      },
    };
    const tick = setInterval(() => {
      if (!current || current.status !== "in_progress") return;
      const left = Math.max(
        0,
        Math.ceil((deadline - performance.now()) / 1000),
      );
      setRemaining(left);
      if (!left && performance.now() >= retryAt && !blocked) void submit();
    }, 1000);
    const before = (event: BeforeUnloadEvent) => {
      if (current?.status === "in_progress") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const online = () => {
      if (!blocked) retry();
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("online", online);
    void reload();
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(tick);
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("online", online);
    };
  }, [id]);
  return {
    attempt,
    answers,
    remaining,
    error,
    saveState,
    busy,
    conflict,
    change: (key: string, value: Answers[string]) =>
      actions.current?.change(key, value),
    submit: () => actions.current?.submit(),
    retry: () => actions.current?.retry(),
    reload: () => actions.current?.reload(),
  };
}
