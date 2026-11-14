import type { Course, Question, ResultsPage } from '../src/types.ts';
import type { EnrollmentRow } from '../src/simpleTraining.ts';
import type { DemoAttempt, DemoEnrollment } from './data.ts';
import { relative } from './data.ts';
import type { DemoState } from './state.ts';
export const notSaved = 'This demo does not save this change.';
export const notAvailable = 'Not available in this demo.';
// This is the router's actual dispatch table, also checked against frontend call sites.
const reads = [
  'auth/session/', 'courses/', 'courses/mine/', 'courses/:id/', 'courses/:id/training/',
  'courses/:id/enrollments/', 'courses/:id/sessions/', 'courses/:id/sessions/:session/attendance/',
  'courses/:id/assessments/', 'courses/:id/materials/', 'courses/:id/deletion-preview/',
  'exams/', 'exams/:id/', 'exams/link-options/', 'exams/audience-options/', 'exams/:id/insights/',
  'exams/:id/monitor/', 'exams/:id/previews/', 'exams/:id/budget/', 'exams/:id/deletion-preview/',
  'exams/:id/marks/imports/', 'attempts/:id/', 'attempts/:id/inspection/',
  'attempts/:id/extensions/', 'attempts/:id/reopenings/', 'results/', 'results/:id/review/',
  'assignments/', 'users/', 'users/:id/', 'groups/', 'groups/:id/', 'groups/:id/members/',
  'groups/entra-search/', 'question-bank/', 'dashboard/', 'administration/', 'settings/',
  'directory/status/', 'email/', 'audit/', 'readiness/', 'invitations/',
  'guest/exam/', 'previews/:id/', 'previews/:id/heartbeat/', 'previews/:id/review/',
  'attempts/:id/reopenings/:record/', 'exams/:id/marks/imports/:record/',
];
const writes = [
  'auth/login/', 'auth/logout/', 'courses/:id/', 'courses/:id/enroll/', 'courses/:id/cancel-registration/',
  'courses/:id/enrollments/:enrollment/review/', 'courses/:id/roster/', 'courses/:id/complete/',
  'courses/:id/sessions/:session/attendance/', 'scorm/:id/commit/', 'exams/:id/start/', 'attempts/:id/',
];
const postReads = ['registration/lookup/', 'trainings/check-people/', 'courses/:id/content/', 'courses/:id/registration-link/', 'attempts/:id/heartbeat/', 'scorm/:id/launch/', 'guest/exchange/', 'assignments/group-preview/'];
const unavailable = [
  'courses/:id/source/', 'courses/:id/sessions/:session/export/', 'courses/:id/materials/:material/download/',
  'results/export/', 'assignments/export/', 'trainings/people-template/', 'exams/:id/marks/template/',
  // No fixture has a question figure; its only creation path is an explicit upload.
  'question-figures/:id/', 'auth/entra/', 'auth/google/start/',
];
const unsaved = [
  'auth/password/', 'auth/email/request/', 'auth/email/verify/', 'trainings/',
  'courses/:id/cancel-training/', 'courses/:id/upload/', 'courses/:id/sessions/:session/',
  'courses/:id/materials/:material/',
  'assignments/:id/cancel/', 'users/import/', 'users/import-preview/',
  'groups/:id/matching-members/', 'groups/:id/remove-members/', 'groups/entra-create/',
  'groups/:id/entra-sync/', 'groups/:id/entra-link/', 'groups/:id/entra-unlink/',
  'question-bank/:id/', 'question-figures/', 'documents/convert/', 'settings/:section/',
  'directory/run/', 'email/test/', 'email/:id/retry/', 'email/:id/cancel/',
  'invitations/issue/', 'invitations/bulk/', 'invitations/:id/revoke/',
  'guest/email/request/', 'guest/email/verify/',
];
export const routes = [...new Set([...reads, ...writes, ...postReads, ...unavailable, ...unsaved])].map(pattern => ({
  pattern, read: reads.includes(pattern), write: writes.includes(pattern), postRead: postReads.includes(pattern), unavailable: unavailable.includes(pattern),
}));
export function matchRoute(path: string) {
  const parts = path.split('?')[0].replace(/^\/+/, '').split('/');
  // Literal routes (mine, export, link-options) win over parameter routes.
  return routes.filter(route => {
    const expected = route.pattern.split('/');
    return expected.length === parts.length && expected.every((part, i) => part.startsWith(':') ? !!parts[i] : part === parts[i]);
  }).sort((a, b) => a.pattern.split(':').length - b.pattern.split(':').length)[0];
}
export function paginate<T>(rows: T[], query: URLSearchParams, defaultSize = 10) {
  const size = Math.max(1, Math.min(100, Number(query.get('page_size')) || defaultSize));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.max(1, Math.min(pages, Number(query.get('page')) || 1));
  return { results: rows.slice((page - 1) * size, page * size), count: rows.length, total: rows.length, page, pages, page_size: size };
}
export function questionPoints(q: Question, answer: unknown): number | null {
  if (q.type === 'essay')
    return null;
  const solutions = q.solution || [];
  let correct = false;
  if (q.type === 'single' || q.type === 'multiple') {
    const values = Array.isArray(answer) ? answer : answer === undefined ? [] : [answer];
    correct = JSON.stringify([...new Set(values.map(String))].sort()) === JSON.stringify(solutions.map(String).sort());
  }
  else if (q.type === 'ordering')
    correct = JSON.stringify(answer) === JSON.stringify(solutions);
  else if (q.type === 'short') {
    correct = solutions.some((solution, i) => {
      const mode = q.answer_matching?.[i] || 'normalized';
      const normalize = (value: unknown) => mode === 'exact' ? String(value ?? '') : mode === 'lower' ? String(value ?? '').toLowerCase() : String(value ?? '').trim().toLowerCase();
      return normalize(answer) === normalize(solution);
    });
  }
  else {
    const value = String(answer ?? '').trim();
    const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
    correct = numeric && Number.isFinite(Number(value)) && (q.type !== 'integer' || /^[+-]?\d+$/.test(value)) && solutions.some((solution, i) => Math.abs(Number(value) - Number(solution)) <= Number(q.answer_tolerances?.[i] || 0) + Number.EPSILON);
  }
  return correct ? q.points : 0;
}
export function scoreAttempt(attempt: DemoAttempt) {
  let earned = 0, total = 0, pending = false;
  for (const q of attempt.questions) {
    const points = attempt.manual_grades[String(q.id)]?.points ?? questionPoints(q, attempt.answers[String(q.id)]);
    total += q.points;
    if (points === null)
      pending = true;
    else
      earned += points;
  }
  attempt.score = total ? Math.round(earned / total * 100) : 0;
  attempt.status = pending ? 'pending_review' : 'graded';
  attempt.passed = pending ? null : attempt.score >= attempt.pass_score;
}
export function summary(attempts: DemoAttempt[]): ResultsPage['summary'] {
  const graded = attempts.filter(a => a.status === 'graded'), passed = graded.filter(a => a.passed).length;
  return {
    total: attempts.length, graded: graded.length, pending: attempts.filter(a => a.status === 'pending_review').length, in_progress: attempts.filter(a => a.status === 'in_progress').length, passed, average_score: graded.length ? Math.round(graded.reduce((sum, a) => sum + (a.score || 0), 0) / graded.length) : null, pass_rate: graded.length ? Math.round(passed / graded.length * 100) : null, participants: new Set(attempts.map(a => a.user_id)).size
  };
}
type Body = Record<string, unknown>;
export function createRouter(state: DemoState, options: {
  appPath?: (path: string) => string;
  t?: (key: string) => string;
  now?: () => number;
  origin?: string;
} = {}) {
  const appPath = options.appPath || (path => path), t = options.t || (key => key), now = options.now || Date.now;
  // Translate authored fields only; identifiers, status codes, URLs and answers remain stable.
  const fields = new Set([
    'title', 'description', 'text', 'category', 'department', 'user__department', 'departments', 'name', 'location', 'notes', 'options', 'grading_guide', 'course__title', 'detail'
  ]);
  function localize(value: unknown, key = ''): unknown {
    if (typeof value === 'string')
      return fields.has(key) ? t(value) : value;
    if (Array.isArray(value))
      return value.map(v => localize(v, key));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localize(v, k)]));
    return value;
  }
  const json = (value: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(localize(value)), { status, headers: { 'Content-Type': 'application/json' } });
  const error = (message: string, status = 400) => json({ detail: message }, status);
  const changed = (value: unknown, status = 200) => { state.save(); return json(value, status); };
  const current = () => state.data.users.find(u => u.id === state.data.userId);
  const manager = () => current()?.access.courses === 'all';
  const ownRows = (id: number) => state.data.enrollments.filter(e => e.course === id);
  const ownAttempt = (a: DemoAttempt) => manager() || a.user_id === state.data.userId;
  function findPerson(raw: string) {
    const needle = raw.trim().toLowerCase();
    if (!needle)
      return undefined;
    return state.data.users.find(u => String(u.id) === raw.trim() || [u.username, u.email, u.employee_id, u.display_name].some(v => (v || '').trim().toLowerCase() === needle));
  }
  function enrollmentView(row: DemoEnrollment): EnrollmentRow & { course: number } {
    const quizzes = state.data.exams.filter(e => e.published && e.courses.includes(row.course));
    let quiz: EnrollmentRow['quiz'] = null;
    if (quizzes.length) {
      const graded = state.data.attempts.filter(a => a.user_id === row.user_id && a.status === 'graded' && quizzes.some(q => q.id === a.exam_id));
      if (!graded.length)
        quiz = 'not_started';
      else if (quizzes.every(q => graded.some(a => a.exam_id === q.id && a.passed)))
        quiz = 'passed';
      else
        quiz = 'not_passed';
    }
    return { ...row, quiz };
  }
  function examOpensFor(exam: typeof state.data.exams[number]): string | null {
    if (exam.audience !== 'course')
      return exam.starts_at;
    const rows = state.data.enrollments.filter(e => e.user_id === state.data.userId && e.status === 'approved' && e.attendance !== 'absent' && exam.courses.includes(e.course));
    const ends: string[] = [];
    for (const r of rows) {
      const c = state.data.courses.find(course => course.id === r.course);
      if (!c)
        continue;
      if (c.delivery_mode !== 'scheduled')
        return exam.starts_at;
      const s = c.sessions.find(session => session.id === r.session?.id && !session.cancelled);
      if (s)
        ends.push(s.ends_at);
    }
    if (!ends.length)
      return null;
    const sessionEnd = ends.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    return exam.starts_at && Date.parse(exam.starts_at) > Date.parse(sessionEnd) ? exam.starts_at : sessionEnd;
  }
  function isAvailableToMe(exam: typeof state.data.exams[number]): boolean {
    if (!exam.published)
      return false;
    if (exam.audience === 'course') {
      return state.data.enrollments.some(e => {
        if (e.user_id !== state.data.userId || e.status !== 'approved' || e.attendance === 'absent' || !exam.courses.includes(e.course))
          return false;
        const c = state.data.courses.find(course => course.id === e.course);
        if (!c)
          return false;
        return c.delivery_mode !== 'scheduled' || c.sessions.some(s => s.id === e.session?.id && !s.cancelled);
      });
    }
    return exam.available_to_me;
  }
  function examView(exam: typeof state.data.exams[number]) {
    const attempts = state.data.attempts.filter(a => a.exam_id === exam.id && a.user_id === state.data.userId);
    const last = attempts.filter(a => a.status !== 'in_progress').at(-1);
    const can_manage = !!current()?.access.exams && current()?.access.exams !== 'none';
    const available_to_me = isAvailableToMe(exam);
    const opens = examOpensFor(exam);
    const starts_at = can_manage ? exam.starts_at : opens;
    const next_attempt_at = opens && opens !== exam.starts_at && Date.parse(opens) > now() ? opens : exam.next_attempt_at;
    const course_links = exam.courses.map(cid => state.data.courses.find(c => c.id === cid)).filter((c): c is Course => !!c).map(c => ({ id: c.id, title: c.title }));
    return {
      ...exam, course_links, available_to_me, starts_at, next_attempt_at, can_manage, can_view_results: manager(), active_attempt_id: attempts.find(a => a.status === 'in_progress')?.id || null, attempts_used: attempts.length, attempts_remaining: Math.max(0, exam.max_attempts - attempts.length), round_attempts_used: attempts.length, last_result: last ? { id: last.id, status: last.status, score: last.score, passed: last.passed } : null, server_time: relative(now(), 0)
    };
  }
  function courseView(course: Course) {
    const rows = ownRows(course.id), rawEnrollment = rows.find(e => e.user_id === state.data.userId) || null, enrollment = rawEnrollment ? enrollmentView(rawEnrollment) : null;
    const sessions = course.sessions.map(s => {
      const reserved = rows.filter(e => e.session?.id === s.id && ['approved', 'pending'].includes(e.status)).length;
      return {
        ...s, reserved, remaining: Math.max(0, s.capacity - reserved), state: s.cancelled ? 'cancelled' : Date.parse(s.ends_at) < now() ? 'ended' : Date.parse(s.starts_at) <= now() ? 'in_progress' : reserved >= s.capacity ? 'full' : 'open'
      };
    });
    return {
      ...course, sessions, enrollment, can_manage: manager(), can_learn: course.venue !== 'onsite' && (manager() || course.published && (course.delivery_mode === 'self_paced' ? !course.requires_approval || enrollment?.status === 'approved' : enrollment?.status === 'approved' && sessions.some(s => s.id === enrollment.session?.id && s.state === 'in_progress'))), progress: enrollment ? enrollment.progress : null, progress_known: enrollment ? enrollment.progress_known !== false : true, enrolled_count: rows.filter(e => e.status === 'approved').length, server_time: relative(now(), 0), assessments: state.data.exams.filter(e => e.courses.includes(course.id)).map(e => {
        const ev = examView(e);
        const window_state = ev.starts_at && Date.parse(ev.starts_at) > now() ? 'upcoming' : ev.ends_at && Date.parse(ev.ends_at) <= now() ? 'closed' : 'open';
        return { ...ev, gated: e.audience === 'course' && course.delivery_mode === 'scheduled', release: course.delivery_mode === 'scheduled' ? 'after_session' : 'immediate', window_state, other_courses: Math.max(0, e.courses.length - 1) };
      }).filter(e => manager() || e.available_to_me)
    };
  }
  function counts(rows: DemoEnrollment[]) {
    return {
      all: rows.length, registered: rows.filter(r => r.status === 'approved').length, pending: rows.filter(r => r.status === 'pending').length, attended: rows.filter(r => r.effective_attendance === 'present').length, absent: rows.filter(r => r.effective_attendance === 'absent').length, cancelled: rows.filter(r => r.status === 'cancelled').length
    };
  }
  function people(query: URLSearchParams, ids?: number[]) {
    const search = (query.get('search') || '').trim().toLowerCase();
    const rows = state.data.users.filter(u => (!ids || ids.includes(u.id)) && (!search || `${u.display_name} ${u.username} ${u.email} ${u.employee_id} ${u.department} ${t(u.department)}`.toLowerCase().includes(search)) && (!query.get('department') || u.department === query.get('department') || t(u.department) === query.get('department')) && (!query.get('role') || query.get('role') === 'all' || u.role === query.get('role')) && (!['inactive', 'disabled'].includes(query.get('status') || '')) && (!query.get('group') || !!state.data.groups.find(g => g.id === Number(query.get('group')))?.members.includes(u.id)) && (query.get('signed_in') !== 'no'));
    return { ...paginate(rows, query, 50), people: paginate(rows, query, 50).results, departments: state.data.departments };
  }
  function register(course: Course, userId: number, sessionId: number | null, approved = false) {
    let row = ownRows(course.id).find(e => e.user_id === userId);
    const user = state.data.users.find(u => u.id === userId)!;
    if (!row) {
      row = {
        id: Math.max(0, ...state.data.enrollments.map(e => e.id)) + 1, course: course.id, user_id: userId, person: user.display_name, username: user.username, department: user.department, active: true, status: 'approved', revision: 0, session: null, request_note: '', requested_at: relative(now(), 0), review_note: '', reviewed_at: null, progress: 0, progress_known: true, completed_at: null, attendance: '', effective_attendance: '', attended_at: null, attendance_marked_at: null
      };
      state.data.enrollments.push(row);
    }
    const same = row.session?.id === sessionId && ['approved', 'pending'].includes(row.status);
    row.session = course.sessions.find(s => s.id === sessionId) || null;
    if (!same || approved) {
      row.status = approved || !course.requires_approval || manager() ? 'approved' : 'pending';
      row.revision++;
    }
    return row;
  }
  return function route(method: string, path: string, query = new URLSearchParams(), body: Body = {}): Response {
    method = method.toUpperCase();
    path = path.replace(/^\/+/, '');
    const route = matchRoute(path);
    if (!route) {
      console.warn('[demo] unhandled', method, path);
      return error('Not found.', 404);
    }
    const d = state.data, parts = path.split('/'), id = Number(parts[1]), key = route.pattern;
    const user = current();
    if (key === 'auth/session/' && method === 'GET')
      return json({ user: user || null, entra_enabled: false, demo_mode: true, languages: ['en', 'zh-TW', 'es'], sign_in: { entra: false, google: false, password: true }, email_enabled: false });
    if (key === 'auth/login/' && method === 'POST') {
      const selected = findPerson(String(body.identifier || '')) || d.users[d.view === 'admin' ? 0 : 2];
      d.userId = selected.id;
      d.view = selected.id === 1 ? 'admin' : 'learner';
      return changed({ user: selected });
    }
    if (key === 'auth/logout/' && method === 'POST') {
      d.userId = null;
      return changed({ ok: true });
    }
    if (key === 'registration/lookup/' && method === 'POST') {
      if (body.key !== 'demo-forklift-link')
        return error('Not found.', 404);
      const course = courseView(d.courses[6]);
      return json({
        ...course, sessions: course.sessions.filter(s => s.state !== 'ended').map(s => ({ ...s, seats_remain: s.remaining > 0, seats_left: s.remaining })), enrollment: course.enrollment ? { status: course.enrollment.status, session: course.enrollment.session?.id || null } : null
      });
    }
    // GuestExam resolves its link on mount, including while signed out.
    if (key === 'guest/exam/' && method === 'GET' || key === 'guest/exchange/' && method === 'POST') {
      const exam = d.exams[0];
      return json({ ...examView(exam), exam_id: exam.id, recipient: d.users[2].display_name,
        remaining: exam.max_attempts, active_attempt_id: null, expires_at: relative(now(), 30) });
    }
    const supportedWrite = route.write && (key === 'courses/:id/'
      ? method === 'PATCH' && Object.keys(body).length === 1 && body.published === true
      : key === 'attempts/:id/' ? ['PATCH', 'POST'].includes(method) : method === 'POST');
    if (method !== 'GET' && !supportedWrite && !(route.postRead && method === 'POST'))
      return error(notSaved);
    if (route.unavailable || query.has('export'))
      return error(notAvailable);
    if (!user)
      return error('Sign in to continue.', 403);
    if (key === 'assignments/group-preview/' && method === 'POST') {
      const groups = Array.isArray(body.groups) ? body.groups.map(Number) : [];
      const members = new Set(d.groups.filter(g => groups.includes(g.id)).flatMap(g => g.members));
      return json({ people: members.size, within_limit: members.size <= 1000 });
    }
    if (key === 'trainings/check-people/' && method === 'POST') {
      if (!manager())
        return error('Permission denied.', 403);
      const list = Array.isArray(body.rosters) ? (body.rosters as Body[]) : [body];
      if (body.file || list.some(r => r && r.file))
        return error(notSaved);
      const seen = new Set<number>();
      const rosters = list.map(roster => {
        const ids = Array.isArray(roster?.people) ? roster.people.map(Number) : [];
        if (Array.isArray(roster?.groups))
          ids.push(...d.groups.filter(g => (roster.groups as unknown[]).map(Number).includes(g.id)).flatMap(g => g.members));
        const inputs = [...new Set(ids)].map(pid => String(pid)).concat(String(roster?.text || '').split(/[\n,;]+/).map(v => v.trim()).filter(Boolean));
        const rows = inputs.map(input => {
          const person = findPerson(input);
          let outcome = 'not_found';
          if (person) {
            outcome = seen.has(person.id) ? 'duplicate' : 'ready';
            seen.add(person.id);
          }
          return { input, outcome, user: person?.id, name: person?.display_name, email: person?.email, department: person?.department };
        });
        return { rows, counts: Object.fromEntries([...new Set(rows.map(r => r.outcome))].map(outcome => [outcome, rows.filter(r => r.outcome === outcome).length])) };
      });
      return json(Array.isArray(body.rosters) ? { rosters } : rosters[0]);
    }
    // Opening a saved preview is read-only; use an existing synthetic completed submission.
    if (parts[0] === 'previews' && method === 'GET') {
      return json({ ...publicAttempt(d.attempts[0]), id: parts[1], preview_mode: 'unrestricted',
        preview_expires_at: relative(now(), 1) });
    }
    if (parts[0] === 'courses' && id > 0) {
      const course = d.courses.find(c => c.id === id);
      if (!course)
        return error('Not found.', 404);
      const rows = ownRows(id), view = courseView(course);
      if (key === 'courses/:id/' && method === 'GET')
        return json(view);
      if (key === 'courses/:id/content/' && method === 'POST')
        return view.can_learn ? json(view) : error('Course enrollment approval is required.', 403);
      if (key === 'courses/:id/complete/' && method === 'POST') {
        if (!view.can_learn)
          return error('Course enrollment approval is required.', 403);
        if (course.package || !course.blocks.length)
          return error('SCORM completion must be reported by the player. Empty content cannot be completed.');
        const row = register(course, user.id, view.enrollment?.session?.id || null, true);
        row.progress = 100;
        row.progress_known = true;
        row.completed_at = row.completed_at || relative(now(), 0);
        return changed({ progress: 100 });
      }
      if (key === 'courses/:id/enroll/' && method === 'POST') {
        const session = course.sessions.find(s => s.id === Number(body.session));
        if (course.delivery_mode === 'scheduled' && (!session || !['open'].includes(view.sessions.find(s => s.id === session.id)!.state)))
          return error('Choose an available session.');
        return changed(enrollmentView(register(course, user.id, session?.id || null)));
      }
      if (key === 'courses/:id/cancel-registration/' && method === 'POST') {
        const row = rows.find(e => e.user_id === user.id);
        if (!row)
          return error('Not found.', 404);
        row.status = 'cancelled';
        row.revision++;
        return changed(enrollmentView(row));
      }
      if (key === 'courses/:id/materials/' && method === 'GET')
        return json([]);
      if (key === 'courses/:id/sessions/' && method === 'GET')
        return json(view.sessions);
      if (!manager())
        return error('Permission denied.', 403);
      if (key === 'courses/:id/' && method === 'PATCH' && Object.keys(body).length === 1 && body.published === true) {
        course.published = true;
        return changed(courseView(course));
      }
      if (key === 'courses/:id/registration-link/' && method === 'POST' && !body.rotate)
        return json({ url: `${options.origin || ''}${appPath('/register#demo-forklift-link')}` });
      if (key === 'courses/:id/training/' && method === 'GET') {
        // As the real overview: people and quiz participation count approved participants only.
        const participants = new Set(rows.filter(r => r.status === 'approved').map(r => r.user_id));
        return json({
          ...view, people: participants.size, registration_url: appPath('/register#demo-forklift-link'), quizzes: d.exams.filter(e => e.courses.includes(id)).map(e => ({
            ...examView(e), gated: e.audience === 'course' && course.delivery_mode === 'scheduled', release: 'after_session', participation: { started: new Set(d.attempts.filter(a => a.exam_id === e.id && participants.has(a.user_id)).map(a => a.user_id)).size, passed: new Set(d.attempts.filter(a => a.exam_id === e.id && participants.has(a.user_id) && a.status === 'graded' && a.passed).map(a => a.user_id)).size }
          })), sessions: view.sessions.map(s => { const c = counts(rows.filter(r => r.session?.id === s.id)); return {
            ...s, counts: { ...c, present: c.attended, seats: s.remaining }, emails: [
              {
                kind: 'session_tomorrow', exam: null, scheduled_at: relative(Date.parse(s.starts_at), -1), produced_at: s.state === 'ended' ? relative(Date.parse(s.starts_at), -1) : null, state: s.state === 'ended' ? 'produced' : 'scheduled', delivery: {}
              }
            ]
          }; })
        });
      }
      if (key === 'courses/:id/enrollments/' && method === 'GET') {
        const search = (query.get('search') || '').trim().toLowerCase();
        const filtered = rows.filter(r => {
          const u = d.users.find(person => person.id === r.user_id);
          return (!query.get('status') || query.get('status') === 'all' || r.status === query.get('status')) && (!query.get('session') || r.session?.id === Number(query.get('session'))) && (!query.get('attendance') || r.effective_attendance === query.get('attendance')) && `${r.person} ${r.username} ${r.department} ${u?.email || ''} ${u?.employee_id || ''}`.toLowerCase().includes(search);
        }).map(enrollmentView);
        return json({ ...paginate(filtered, query, 20), counts: counts(rows) });
      }
      if (key === 'courses/:id/enrollments/:enrollment/review/' && method === 'POST') {
        const row = rows.find(r => r.id === Number(parts[3]));
        if (!row)
          return error('Not found.', 404);
        if (!['approved', 'rejected', 'removed'].includes(String(body.decision)))
          return error(notSaved);
        row.status = body.decision as DemoEnrollment['status'];
        row.review_note = String(body.note || '');
        row.reviewed_at = relative(now(), 0);
        row.revision++;
        return changed(enrollmentView(row));
      }
      if (key === 'courses/:id/roster/' && method === 'POST') {
        if (body.file)
          return error(notSaved);
        const session = view.sessions.find(s => s.id === Number(body.session));
        if (!session || !['open', 'full'].includes(session.state))
          return error('Choose an available session.');
        const ids = Array.isArray(body.people) ? body.people.map(Number) : [];
        if (Array.isArray(body.groups))
          ids.push(...d.groups.filter(g => (body.groups as unknown[]).includes(g.id)).flatMap(g => g.members));
        const inputs = [...new Set(ids)].map(id => String(id)).concat(String(body.text || '').split(/[\n,;]+/).map(v => v.trim()).filter(Boolean));
        const seen = new Set<number>();
        let seats = session.remaining;
        const report = inputs.map(input => {
          const person = findPerson(input);
          let outcome = 'not_found';
          if (person) {
            const before = rows.find(e => e.user_id === person.id);
            outcome = seen.has(person.id) ? 'duplicate' : before?.session?.id === session.id && before.status === 'approved' ? 'already' : seats <= 0 ? 'full' : before && before.session?.id !== session.id ? 'moved' : before?.status === 'pending' ? 'approved' : 'added';
            seen.add(person.id);
            if (['added', 'approved', 'moved'].includes(outcome)) {
              seats--;
              if (!body.dry_run)
                register(course, person.id, session.id, true);
            }
          }
          return { input, outcome, user: person?.id, name: person?.display_name, email: person?.email, department: person?.department };
        });
        return changed({
          session: session.id, rows: report, counts: Object.fromEntries([...new Set(report.map(r => r.outcome))].map(outcome => [outcome, report.filter(r => r.outcome === outcome).length])), notified: 0
        });
      }
      if (key === 'courses/:id/sessions/:session/attendance/' && ['GET', 'POST'].includes(method)) {
        const session = course.sessions.find(s => s.id === Number(parts[3]));
        if (!session)
          return error('Not found.', 404);
        const can_mark = Date.parse(session.starts_at) <= now();
        const attendees = rows.filter(r => r.session?.id === session.id && r.status === 'approved');
        if (method === 'POST') {
          if (!can_mark || !['', 'present', 'absent'].includes(String(body.attendance)))
            return error(notSaved);
          for (const row of attendees.filter(r => body.all_present || r.id === Number(body.enrollment))) {
            row.attendance = row.effective_attendance = body.attendance as DemoEnrollment['attendance'];
            row.attendance_marked_at = relative(now(), 0);
            row.progress = row.attendance === 'present' ? 100 : 0;
            row.completed_at = row.attendance === 'present' ? relative(now(), 0) : null;
            row.revision++;
          }
          state.save();
        }
        return json({
          results: attendees.map(enrollmentView), counts: {
            present: attendees.filter(r => r.attendance === 'present').length, absent: attendees.filter(r => r.attendance === 'absent').length, no_record: attendees.filter(r => !r.attendance).length
          }, can_mark
        });
      }
      if (key === 'courses/:id/assessments/' && method === 'GET')
        return json({ linked: view.assessments, available: d.exams.filter(e => !e.courses.includes(id)).map(examView) });
      if (key === 'courses/:id/deletion-preview/' && method === 'GET')
        return json({
          title: course.title, counts: { sessions: course.sessions.length, enrollments: rows.length, assignments: d.assignments.filter(a => a.kind === 'course' && a.target_id === id).length }
        });
    }
    if (key === 'courses/' && method === 'GET')
      return json(d.courses.filter(c => manager() || c.published).map(courseView));
    if (key === 'courses/mine/' && method === 'GET')
      return json(d.courses.filter(c => d.enrollments.some(e => e.course === c.id && e.user_id === user.id)).map(courseView));
    if (key === 'exams/' && method === 'GET')
      return json(d.exams.map(examView));
    if (key === 'exams/link-options/' && method === 'GET')
      return json(query.get('quizzes') === '1'
        ? d.exams.map(e => ({ ...examView(e), gated: e.audience === 'course' || (!e.published && e.audience === 'all') }))
        : d.courses.map(c => ({ id: c.id, title: c.title, published: c.published })));
    if (key === 'exams/audience-options/' && method === 'GET')
      return json(people(query));
    if (parts[0] === 'exams' && id > 0) {
      const exam = d.exams.find(e => e.id === id);
      if (!exam)
        return error('Not found.', 404);
      const view = examView(exam);
      if (key === 'exams/:id/' && method === 'GET')
        return json(view);
      if (key === 'exams/:id/start/' && method === 'POST') {
        const active = d.attempts.find(a => a.id === view.active_attempt_id);
        if (active)
          return json(active);
        if (!view.available_to_me)
          return error('You are not assigned to this exam.', 403);
        const opens = examOpensFor(exam);
        if ((opens && Date.parse(opens) > now()) || (exam.ends_at && Date.parse(exam.ends_at) <= now()))
          return error('This exam is outside its availability window.', 403);
        if (!view.attempts_remaining)
          return error('No attempts remaining.', 403);
        const attempt: DemoAttempt = {
          id: `demo-attempt-${d.attempts.length + 1}`, user_id: user.id, exam_id: id, title: exam.title, person: user.display_name, number: view.attempts_used + 1, status: 'in_progress', deadline: new Date(now() + exam.duration_minutes * 60000).toISOString(), started_at: relative(now(), 0), submitted_at: null, server_time: relative(now(), 0), extra_time_minutes: 0, answers: {}, questions: structuredClone(exam.questions || []), score: null, passed: null, pass_score: exam.pass_score, manual_grades: {}, allow_skip: exam.allow_skip, review_available: false, question_count: exam.question_count, answer_revision: 0, grading_revision: 0
        };
        d.attempts.push(attempt);
        return changed(publicAttempt(attempt));
      }
      if (key === 'exams/:id/previews/' && method === 'GET')
        return json([]);
      if (key === 'exams/:id/budget/' && method === 'GET')
        return json({ ...view, starts_at: examOpensFor(exam) });
      if (key === 'exams/:id/deletion-preview/' && method === 'GET')
        return json({ title: exam.title, counts: { attempts: d.attempts.filter(a => a.exam_id === id).length, questions: exam.question_count } });
      // MarksImport restores an optional saved receipt before loading the history list.
      if (key === 'exams/:id/marks/imports/:record/' && method === 'GET')
        return json({ id: parts[4], actor: d.users[0].display_name, reason: '', status: 'expired',
          created_at: relative(now(), -2), expires_at: relative(now(), -1), applied_at: null,
          row_count: 0, attempt_count: 0, skipped: 0, can_apply: false, changes: [], outcomes: [] });
      if (key === 'exams/:id/marks/imports/' && method === 'GET')
        return json(paginate([], query));
      const attempts = filteredAttempts(query).filter(a => a.exam_id === id);
      if (key === 'exams/:id/monitor/' && method === 'GET')
        return json({
          ...paginate(attempts.map(a => ({
            ...a, key: `demo-person-${a.user_id}`, department: d.users.find(u => u.id === a.user_id)?.department, recent: a.status === 'in_progress', answered: Object.keys(a.answers).length, reopen_count: 0, last_seen_at: a.started_at, last_saved_at: a.started_at
          })), query), exam: { id, title: exam.title }, server_time: relative(now(), 0), summary: {
            total: attempts.length, in_progress: attempts.filter(a => a.status === 'in_progress').length, pending_review: attempts.filter(a => a.status === 'pending_review').length, graded: attempts.filter(a => a.status === 'graded').length, recent: 0
          }
        });
      if (key === 'exams/:id/insights/' && method === 'GET')
        return json({
          exam: { id, title: exam.title }, summary: summary(attempts), distribution: bands(attempts), departments: d.departments.map(department => { const values = attempts.filter(a => d.users.find(u => u.id === a.user_id)?.department === department); const s = summary(values); return { department, attempts: values.length, graded: s.graded, passed: s.passed, average: s.average_score }; }), questions: (exam.questions || []).map(q => { const points = attempts.map(a => a.manual_grades[String(q.id)]?.points ?? questionPoints(q, a.answers[String(q.id)])).filter((v): v is number => v !== null); return {
            ...q, question_id: q.id, variant: `demo-question-${q.id}`, responses: attempts.length, answered: attempts.filter(a => a.answers[String(q.id)] !== undefined).length, full_credit: points.filter(p => p === q.points).length, average_points: points.length ? Math.round(points.reduce((a, b) => a + b, 0) / points.length) : 0, full_credit_rate: points.length ? Math.round(points.filter(p => p === q.points).length / points.length * 100) : 0, answer_rate: attempts.length ? Math.round(attempts.filter(a => a.answers[String(q.id)] !== undefined).length / attempts.length * 100) : 0
          }; })
        });
    }
    if (parts[0] === 'attempts' || key === 'results/:id/review/') {
      const attempt = d.attempts.find(a => a.id === parts[1]);
      if (!attempt)
        return error('Not found.', 404);
      if (!ownAttempt(attempt))
        return error('Permission denied.', 403);
      if (key === 'attempts/:id/reopenings/:record/' && method === 'GET')
        return json({ ...publicAttempt(attempt), last_saved_at: attempt.submitted_at || attempt.started_at,
          observed_at: relative(now(), 0) });
      if (key === 'attempts/:id/' && ['PATCH', 'POST'].includes(method)) {
        if (attempt.status === 'in_progress') {
          if (body.answers && typeof body.answers === 'object')
            attempt.answers = body.answers as DemoAttempt['answers'];
          attempt.answer_revision++;
          if (method === 'POST') {
            scoreAttempt(attempt);
            attempt.submitted_at = relative(now(), 0);
            attempt.review_available = true;
          }
        }
        return changed(publicAttempt(attempt));
      }
      if ((['attempts/:id/', 'attempts/:id/inspection/', 'results/:id/review/'].includes(key) && method === 'GET') || key === 'attempts/:id/heartbeat/' && method === 'POST') {
        if (attempt.status === 'in_progress' && attempt.deadline && Date.parse(attempt.deadline) <= now()) {
          scoreAttempt(attempt);
          attempt.submitted_at = relative(now(), 0);
          attempt.review_available = true;
          state.save();
        }
        return json(publicAttempt(attempt));
      }
      if (['attempts/:id/extensions/', 'attempts/:id/reopenings/'].includes(key) && method === 'GET')
        return json(paginate([], query));
    }
    if (key === 'results/' && method === 'GET') {
      const rows = filteredAttempts(query);
      return json({
        ...paginate(rows.map(a => ({
          id: a.id, exam: a.title, exam_id: a.exam_id, person: a.person, department: d.users.find(u => u.id === a.user_id)?.department, number: a.number, status: a.status, score: a.score, passed: a.passed, submitted_at: a.submitted_at, can_view_results: true
        })), query, 25), summary: summary(rows)
      });
    }
    if (key === 'assignments/' && method === 'GET')
      return json(d.assignments.filter(a => manager() && query.get('report') || a.user_id === user.id).map(a => { const attempt = a.kind === 'exam' ? d.attempts.filter(v => v.exam_id === a.target_id && v.user_id === a.user_id).at(-1) : null; return {
        ...a, score: attempt?.score ?? a.score, status: attempt ? attempt.passed ? 'completed' : attempt.status === 'pending_review' ? 'pending_review' : 'in_progress' : a.status, completed_at: attempt?.passed ? attempt.submitted_at : null
      }; }));
    if (key === 'users/' && method === 'GET')
      return json(people(query));
    if (key === 'users/:id/' && method === 'GET')
      return d.users.some(u => u.id === id) ? json(d.users.find(u => u.id === id)) : error('Not found.', 404);
    if (key === 'groups/' && method === 'GET')
      return json(paginate(d.groups.filter(g => t(g.name).toLowerCase().includes((query.get('search') || '').toLowerCase())), query, 50));
    if (key === 'groups/:id/' && method === 'GET')
      return d.groups.some(g => g.id === id) ? json(d.groups.find(g => g.id === id)) : error('Not found.', 404);
    if (key === 'groups/:id/members/' && method === 'GET')
      return json(people(query, d.groups.find(g => g.id === id)?.members || []));
    if (key === 'groups/entra-search/' && method === 'GET')
      return json({ results: [] });
    if (key === 'question-bank/' && method === 'GET')
      return json(d.exams[2].questions?.map(q => ({
        answer_tolerances: [], answer_matching: [], grading_guide: '', figure: null, figure_alt: '', figure_caption: '',
        ...q, category: 'Core training', archived: false, owner_name: d.users[0].display_name, can_manage: manager(), updated_at: relative(now(), 0)
      })));
    if (key === 'settings/' && method === 'GET')
      return json({
        organization: { name: 'Training System', organization_name: '', title: 'Training System', logo_url: null, languages: ['en', 'zh-TW', 'es'], languages_server: false }, sign_in: { provider: 'none', server: true, configured: false, domains: [], client_id: '', tenant_id: '' }, email: { provider: 'off', server: true, configured: false, from_email: '', host: '', port: 587, username: '', security: 'starttls' }
      });
    if (key === 'directory/status/' && method === 'GET')
      return json({ configured: false, interval_hours: 0, last_run: null });
    if (key === 'email/' && method === 'GET')
      return json({
        ...paginate([], query), off: true, sender: '', configured: false, enabled: false, queued: 0, failed: 0, paused_until: null, pause_reason: '', sent_last_24_hours: 0, daily_limit: 100, daily_limit_reached: false
      });
    if (key === 'audit/' && method === 'GET')
      return json([]);
    if (key === 'readiness/' && method === 'GET')
      return json({ checks: [{ key: 'sign-in', label: 'Microsoft Entra configuration', status: 'off', detail: 'Not configured' }, { key: 'email', label: 'Company email configuration', status: 'off', detail: 'Email is off.' }] });
    if (key === 'invitations/' && method === 'GET')
      return json(paginate([], query));
    if (key === 'administration/' && method === 'GET')
      return json({
        courses: { total: d.courses.length, published: d.courses.filter(c => c.published).length }, exams: { total: d.exams.length, published: d.exams.filter(e => e.published).length }, people: { total: d.users.length, active: d.users.length }, pending_enrollments: d.enrollments.filter(e => e.status === 'pending').length, pending_reviews: d.attempts.filter(a => a.status === 'pending_review').length, enrollment_requests: d.courses.map(c => ({ course_id: c.id, course__title: c.title, count: ownRows(c.id).filter(e => e.status === 'pending').length })).filter(c => c.count), drafts: d.courses.filter(c => !c.published).map(c => ({ kind: 'course', id: c.id, title: c.title })), activity: []
      });
    if (key === 'dashboard/' && method === 'GET') {
      const attempts = filteredAttempts(query), s = summary(attempts), department = query.get('department');
      const rows = d.enrollments.filter(e => !department || e.department === department || t(e.department) === department), users = d.users.filter(u => !department || u.department === department || t(u.department) === department), completed = rows.filter(e => e.progress === 100).length;
      const dates = [...new Set(attempts.filter(a => a.submitted_at).map(a => a.submitted_at!.slice(0, 10)))].sort();
      return json({
        people: users.length, courses: d.courses.length, enrollments: rows.length, completed, completion: rows.length ? Math.round(completed / rows.length * 100) : 0, pass_rate: s.pass_rate || 0, average_score: s.average_score || 0, graded_count: s.graded, pending: s.pending, employee_count: users.filter(u => u.employment === 'employee').length, contractor_count: users.filter(u => u.employment === 'contractor').length, days: Number(query.get('days')) || 30, trend: dates.map(day => { const selected = attempts.filter(a => a.submitted_at?.startsWith(day)); return { day, count: selected.length, average: summary(selected).average_score || 0 }; }), departments: d.departments.map(name => ({
          user__department: name, total: rows.filter(e => e.department === name).length, completed: rows.filter(e => e.department === name && e.progress === 100).length
        })), distribution: bands(attempts).map(b => b.count)
      });
    }
    if (key === 'scorm/:id/launch/' && method === 'POST')
      return json({ url: appPath('/scorm.html'), nonce: 'demo-course-preview', origin: options.origin || '' });
    if (key === 'scorm/:id/commit/' && method === 'POST') {
      const course = d.courses.find(c => c.package?.id === parts[1]);
      if (!course)
        return error('Not found.', 404);
      const cmi = (body.cmi && typeof body.cmi === 'object' ? body.cmi : {}) as Record<string, unknown>;
      const row = register(course, user.id, null, true);
      const completed = ['passed', 'completed'].includes(String(cmi['cmi.core.lesson_status'])) || cmi['cmi.completion_status'] === 'completed';
      if (completed) {
        row.progress = 100;
        row.progress_known = true;
        row.completed_at = row.completed_at || relative(now(), 0);
      }
      else {
        const measured = Math.round(Number(cmi['cmi.progress_measure']) * 100);
        const previous = row.progress_known !== false ? row.progress : 0;
        if (row.progress < 100) {
          row.progress = Number.isFinite(measured) ? Math.max(previous, Math.min(measured, 99)) : previous;
          row.progress_known = true;
        }
      }
      return changed({ completed: row.progress === 100, progress: row.progress, progress_known: true });
    }
    return error(method === 'GET' ? notAvailable : notSaved);
  };
  function publicAttempt(attempt: DemoAttempt) {
    return {
      ...attempt, answers: Object.fromEntries(Object.entries(attempt.answers).map(([key, value]) => [
        key, typeof value === 'string' && attempt.id.startsWith('demo-result-') && attempt.questions.find(q => String(q.id) === key)?.type === 'essay' ? t(value) : value
      ])), server_time: relative(now(), 0), questions: attempt.questions.map(q => attempt.status === 'in_progress' ? { ...q, solution: undefined, grading_guide: undefined } : q)
    };
  }
  function filteredAttempts(query: URLSearchParams) {
    const days = Number(query.get('days')), department = query.get('department'), search = (query.get('search') || '').trim().toLowerCase();
    return state.data.attempts.filter(a => {
      const u = state.data.users.find(user => user.id === a.user_id);
      return ownAttempt(a) && (!query.get('number') || a.number === Number(query.get('number'))) && (!query.get('group') || !!state.data.groups.find(g => g.id === Number(query.get('group')))?.members.includes(a.user_id)) && (!query.get('outcome') || (query.get('outcome') === 'passed' ? a.passed === true : a.passed === false)) && (!query.get('exam') || a.exam_id === Number(query.get('exam'))) && (!query.get('status') || query.get('status') === 'all' || a.status === query.get('status')) && (!days || Date.parse(a.started_at) >= now() - days * 86400000) && (!department || [u?.department, t(u?.department || '')].includes(department)) && `${a.person} ${a.title} ${u?.username || ''} ${u?.email || ''} ${u?.employee_id || ''}`.toLowerCase().includes(search);
    });
  }
}
function bands(attempts: DemoAttempt[]) {
  return [[0, 60], [60, 70], [70, 80], [80, 90], [90, 101]].map(([lo, hi]) => ({ band: `${lo}–${hi === 101 ? 100 : hi - 1}`, count: attempts.filter(a => a.status === 'graded' && (a.score || 0) >= lo && (a.score || 0) < hi).length }));
}
