import type { Course, CourseSession, Exam } from './types';
import { examLearnerState } from './examLearnerState.ts';

export type OwnAssignment = {
  user_id: number; kind: 'course' | 'exam'; target_id: number; title: string;
  available: boolean; status: string; due_at: string | null; completed_at?: string | null;
};
export type NextStep = {
  key: string; title: string; path: string; action: string;
  caption: 'Attempt in progress' | 'session' | 'Assigned to you' | 'progress' | 'assessment';
  badge?: string; due?: string | null; progress?: number;
  /** When a course quiz opened for the person (the end of their session). */
  since?: string;
  course?: Course; session?: CourseSession | NonNullable<Course['enrollment']>['session'];
};

/** Priority and deduplication are independent of rendering, language and network access. */
export function selectNextSteps(courses: Course[], exams: Exam[], assignments: OwnAssignment[], userId: number, now = Date.now()): NextStep[] {
  courses = courses.filter(course => course.published);
  const rows: NextStep[] = [], seen = new Set<string>();
  const add = (row: NextStep) => { if (!seen.has(row.key)) { seen.add(row.key); rows.push(row); } };
  const examPath = (id: number) => `/exams?exam=${id}&action=start`;
  const canStart = (e: Exam | Course['assessments'][number]) => e.available_to_me &&
    ['ready', 'retake'].includes(examLearnerState(e, now).state) && (!e.next_attempt_at || Date.parse(e.next_attempt_at) <= now);
  for (const e of exams) if (e.active_attempt_id) add({key: `exam:${e.id}`, title: e.title, path: examPath(e.id), action: 'Resume', caption: 'Attempt in progress'});
  const reserved = courses.filter(c => c.enrollment && ['approved', 'pending'].includes(c.enrollment.status) && c.enrollment.session)
    .sort((a, b) => Date.parse(a.enrollment!.session!.starts_at) - Date.parse(b.enrollment!.session!.starts_at));
  for (const c of reserved) {
    const s = c.sessions.find(s => s.id === c.enrollment!.session!.id) || c.enrollment!.session!;
    if (!s.cancelled && Date.parse(s.ends_at) <= now) continue;
    const running = !s.cancelled && Date.parse(s.starts_at) <= now && Date.parse(s.ends_at) > now && c.can_learn;
    add({key: `course:${c.id}`, title: c.title, course: c, session: s, caption: 'session',
      badge: s.cancelled ? 'Session cancelled' : c.enrollment!.status === 'pending' ? 'Pending approval' : undefined,
      action: s.cancelled ? 'Choose another session' : running ? 'Start learning' : 'View session',
      path: `/courses?course=${c.id}&action=${running ? 'learn' : 'register'}`});
  }
  const open = assignments.filter(a => a.user_id === userId && a.available && !a.completed_at && !['completed', 'cancelled'].includes(a.status))
    .sort((a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity));
  for (const a of open) {
    const base = {key: `${a.kind}:${a.target_id}`, title: a.title, caption: 'Assigned to you' as const, due: a.due_at,
      badge: a.due_at && Date.parse(a.due_at) < now ? 'Overdue' : undefined};
    if (a.kind === 'exam') {
      const e = exams.find(e => e.id === a.target_id);
      if (e && canStart(e)) add({...base, path: examPath(e.id), action: examLearnerState(e, now).state === 'retake' ? 'Retake' : 'Take assessment'});
    } else {
      const c = courses.find(c => c.id === a.target_id);
      if (!c) continue;
      const hasSeat = c.enrollment && ['approved', 'pending'].includes(c.enrollment.status) && c.enrollment.session && !c.enrollment.session.cancelled;
      const choose = c.delivery_mode === 'scheduled' && !hasSeat;
      add({...base, course: c, path: `/courses?course=${c.id}${c.delivery_mode === 'scheduled' ? `&action=${choose ? 'register' : 'learn'}` : ''}`,
        action: choose ? 'Choose a session' : c.progress && c.progress < 100 ? 'Continue learning' : 'Start learning'});
    }
  }
  for (const c of courses) if (c.delivery_mode === 'self_paced' && c.enrollment?.status === 'approved' && c.can_learn && c.progress_known !== false && c.progress !== null && c.progress >= 1 && c.progress < 100)
    add({key: `course:${c.id}`, title: c.title, course: c, path: `/courses?course=${c.id}`, action: 'Continue learning', caption: 'progress', progress: c.progress});
  for (const c of courses) if (c.enrollment?.status === 'approved') {
    // A quiz that opened when the person's session ended is dated by that end, so undated work does not bury it.
    const seat = c.enrollment.session;
    const since = seat && !seat.cancelled && Date.parse(seat.ends_at) <= now ? seat.ends_at : undefined;
    for (const e of c.assessments || []) if (canStart(e))
      add({key: `exam:${e.id}`, title: e.title, course: c, since, path: examPath(e.id), action: examLearnerState(e, now).state === 'retake' ? 'Retake' : 'Take assessment', caption: 'assessment'});
  }
  // Select each target's representative first; urgency only orders those survivors.
  const urgency = (row: NextStep): [number, number] => {
    if (row.caption === 'Attempt in progress') return [0, 0];
    if (row.session && row.action === 'Start learning') return [1, Date.parse(row.session.starts_at)];
    if (row.session?.cancelled) return [2, Date.parse(row.session.starts_at)];
    if (row.due && Date.parse(row.due) < now) return [3, Date.parse(row.due)];
    if (row.since) return [4, Date.parse(row.since)];
    if (row.session || row.due) return [4, Date.parse(row.session?.starts_at || row.due!)];
    if (row.caption === 'Assigned to you') return [5, 0];
    return [row.caption === 'progress' ? 6 : 7, 0];
  };
  return rows.sort((a, b) => {
    const left = urgency(a), right = urgency(b);
    return left[0] - right[0] || left[1] - right[1];
  });
}
