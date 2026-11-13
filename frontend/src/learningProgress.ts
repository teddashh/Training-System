import type { Course, Exam } from './types';
import type { OwnAssignment } from './nextSteps';

/** Count distinct personal targets; management visibility is not enrollment. */
export function learningProgress(courses: Course[], exams: Exam[], assignments: OwnAssignment[], userId: number) {
  const assigned = new Set(assignments.filter(a => a.user_id === userId && a.kind === 'course' && a.status !== 'cancelled').map(a => a.target_id));
  const ownCourses = new Map(courses.filter(c => assigned.has(c.id) || (c.enrollment && ['approved', 'pending'].includes(c.enrollment.status))).map(c => [c.id, c]));
  // Include assigned courses even if temporarily unavailable in the catalog.
  const courseIds = new Set([...assigned, ...ownCourses.keys()]);
  // An exam that is merely open to everyone is not the person's own: count what was assigned,
  // what belongs to one of their courses and what they already started.
  const assignedExams = new Set(assignments.filter(a => a.user_id === userId && a.kind === 'exam' && a.status !== 'cancelled').map(a => a.target_id));
  const courseExams = new Set([...ownCourses.values()].flatMap(c => (c.assessments || []).filter(e => e.available_to_me).map(e => e.id)));
  const ownExams = new Map(exams.filter(e => e.available_to_me && (assignedExams.has(e.id) || courseExams.has(e.id) || e.last_result || e.active_attempt_id)).map(e => [e.id, e]));
  let done = 0;
  for (const id of courseIds) {
    const course = ownCourses.get(id);
    if (course?.enrollment?.completed_at || course?.progress === 100 || assignments.some(a => a.user_id === userId && a.kind === 'course' && a.target_id === id && a.status !== 'cancelled' && (a.completed_at || a.status === 'completed'))) done++;
  }
  for (const exam of ownExams.values()) if (exam.last_result?.passed === true) done++;
  return {done, total: courseIds.size + ownExams.size};
}
