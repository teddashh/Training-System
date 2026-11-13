import type { Exam } from "./types";

type LearnerExam = Pick<Exam, "active_attempt_id" | "last_result" | "attempts_remaining" | "starts_at" | "ends_at"> & Partial<Pick<Exam, 'next_attempt_at' | 'next_round_at' | 'round_awaiting_grading'>>;
export type ExamLearnerState = "active" | "completed" | "upcoming" | "closed" | "retake" | "ready" | "waiting" | "grading";

/** Shared by course assessment rows and the personal exam groups. */
export function examLearnerState(exam: LearnerExam, now = Date.now()): {state: ExamLearnerState; group: "To do" | "Completed" | "Closed"} {
  if (exam.active_attempt_id) return {state: "active", group: "To do"};
  if (exam.last_result?.passed === true)
    return {state: "completed", group: "Completed"};
  if (exam.ends_at && Date.parse(exam.ends_at) <= now) return {state: "closed", group: "Closed"};
  if (exam.starts_at && Date.parse(exam.starts_at) > now) return {state: "upcoming", group: "To do"};
  if (exam.round_awaiting_grading && exam.attempts_remaining === 0) return {state: 'grading', group: 'To do'};
  if (exam.attempts_remaining === 0 && !exam.next_round_at) return {state: 'completed', group: 'Completed'};
  if ((exam.next_attempt_at || exam.next_round_at) && Date.parse((exam.next_attempt_at || exam.next_round_at)!) > now)
    return {state: 'waiting', group: 'To do'};
  if ((exam.last_result && exam.last_result.passed !== false) || (exam.attempts_remaining === 0 && !exam.next_round_at))
    return {state: 'completed', group: 'Completed'};
  return {state: exam.last_result?.passed === false ? "retake" : "ready", group: "To do"};
}
