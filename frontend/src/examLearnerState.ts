import type { Exam, Guest } from "./types";

type LearnerExam = Pick<Exam, "active_attempt_id" | "last_result" | "has_passed" | "attempts_remaining" | "starts_at" | "ends_at"> & Partial<Pick<Exam, 'next_attempt_at' | 'next_round_at' | 'round_awaiting_grading'>>;
export type ExamLearnerState = "active" | "completed" | "upcoming" | "closed" | "retake" | "ready" | "waiting" | "grading";

/** Shared by course assessment rows and the personal exam groups. */
export function examLearnerState(exam: LearnerExam, now = Date.now()): {state: ExamLearnerState; group: "To do" | "Completed" | "Closed"} {
  if (exam.active_attempt_id) return {state: "active", group: "To do"};
  if (exam.has_passed || exam.last_result?.passed === true)
    return {state: "completed", group: "Completed"};
  if (exam.ends_at && Date.parse(exam.ends_at) <= now) return {state: "closed", group: "Closed"};
  if (exam.starts_at && Date.parse(exam.starts_at) > now) return {state: "upcoming", group: "To do"};
  if (exam.round_awaiting_grading && exam.attempts_remaining === 0) return {state: 'grading', group: 'To do'};
  if (exam.last_result?.status === 'pending_review' && exam.attempts_remaining === 0 && !exam.next_round_at)
    return {state: 'grading', group: 'To do'};
  if (exam.attempts_remaining === 0 && !exam.next_round_at) return {state: 'completed', group: 'Completed'};
  if (retryWaiting(exam, now))
    return {state: 'waiting', group: 'To do'};
  if (exam.last_result && exam.last_result.passed !== false && exam.last_result.status !== 'pending_review')
    return {state: 'completed', group: 'Completed'};
  return {state: exam.last_result ? "retake" : "ready", group: "To do"};
}

/** A retry may be visible but disabled while its waiting period runs. */
export function isRetake(exam: LearnerExam, now = Date.now()) {
  const state = examLearnerState(exam, now).state;
  return state === 'retake' || (state === 'waiting' &&
    (exam.last_result?.passed === false || exam.last_result?.status === 'pending_review'));
}

/** A round may renew while the invitation still has its own attempts left. */
export function guestLearnerExam(guest: Guest) {
  return {...guest, attempts_remaining: guest.remaining, remaining: guest.invitation_remaining,
    next_round_at: guest.invitation_remaining > 0 ? guest.next_round_at : null};
}

export function nextRetryAt(value: {next_attempt_at?: string | null; next_round_at?: string | null}) {
  const {next_attempt_at, next_round_at} = value;
  if (!next_attempt_at) return next_round_at;
  if (!next_round_at) return next_attempt_at;
  return Date.parse(next_attempt_at) >= Date.parse(next_round_at) ? next_attempt_at : next_round_at;
}

export function retryWaiting(value: {next_attempt_at?: string | null; next_round_at?: string | null; active_attempt_id?: string | null; attempts_remaining?: number; remaining?: number}, now: number) {
  const next = nextRetryAt(value);
  return !!(next && value.remaining !== 0 && (value.attempts_remaining !== 0 || value.next_round_at) && !value.active_attempt_id && Date.parse(next) > now);
}
