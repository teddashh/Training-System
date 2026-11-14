import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createData, day } from './data.ts';
import { createState, storageKey } from './state.ts';
import { createRouter, questionPoints, scoreAttempt, routes, notSaved, notAvailable } from './router.ts';
import { restoredRoute } from './deepLink.ts';
import { reloadTarget, reloadApp } from './reload.ts';
import { demoFetch, blockedLink } from './api.ts';
import { examLearnerState } from '../src/examLearnerState.ts';
import { selectNextSteps, type OwnAssignment } from '../src/nextSteps.ts';
import type { Attempt, Course, Dashboard, Exam, Question, ResultsPage } from '../src/types.ts';
import type { EnrollmentPage, TrainingOverview } from '../src/simpleTraining.ts';

function setup(now = Date.now()) {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) || null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const state = createState(storage, now);
  const route = createRouter(state, { now: () => now, appPath: path => '/Training-System/demo' + path });
  async function call<T = Record<string, unknown>>(path: string, method = 'GET', body = {}) {
    const [pathname, search] = path.split('?');
    const response = route(method, pathname, new URLSearchParams(search), body);
    assert.equal(response.status, 200, `${method} ${path}: ${await response.clone().text()}`);
    return response.json() as Promise<T>;
  }
  return { now, state, route, call, storage, entries };
}
test('fixtures keep local session and deadline times at every load hour, including DST boundaries', () => {
  const clock = (value: string) => {
    const date = new Date(value);
    return [date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()];
  };
  for (const month of [0, 2, 9, 10]) for (const offset of [0, 365, 3650]) for (let hour = 0; hour < 24; hour++) {
    const load = new Date(2026, month, 1, hour, 59, 59, 999);
    load.setDate(load.getDate() + offset);
    const now = load.getTime(), data = createData(now);
    assert.equal(data.users.length, 12); assert.equal(data.courses.length, 8); assert.equal(data.exams.length, 3);
    const expected = [[71, 7, 9, 0, 11, 0], [72, 14, 13, 30, 15, 30], [73, -7, 9, 0, 11, 0], [31, 3, 10, 0, 11, 0], [32, 10, 14, 0, 15, 0]];
    for (const [id, days, startHour, startMinute, endHour, endMinute] of expected) {
      const session = data.courses.flatMap(c => c.sessions).find(s => s.id === id)!;
      assert.deepEqual(clock(session.starts_at), [startHour, startMinute, 0, 0]);
      assert.deepEqual(clock(session.ends_at), [endHour, endMinute, 0, 0]);
      const date = new Date(now); date.setDate(date.getDate() + days);
      assert.equal(new Date(session.starts_at).toDateString(), date.toDateString());
      assert.equal(Date.parse(session.starts_at) > now, days > 0);
      assert.equal(Date.parse(session.ends_at) > now, days > 0);
      assert.deepEqual(clock(session.registration_opens_at!), [9, 0, 0, 0]);
      assert.deepEqual(clock(session.registration_closes_at!), [17, 0, 0, 0]);
    }
    assert.ok(data.assignments.every(a => Date.parse(a.due_at) > now));
    for (const assignment of data.assignments) assert.deepEqual(clock(assignment.due_at), [17, 0, 0, 0]);
    assert.ok(data.users.every(u => u.email.endsWith('@example.com')));
  }
});
test('same-day reload preserves timestamps and edits; a new local day discards saved state', async () => {
  const now = new Date(2026, 10, 13, 23, 50).getTime();
  const { state, storage, call } = setup(now);
  const attempt = await call<Attempt>('exams/1/start/', 'POST');
  state.switchView('learner');
  const restored = createState(storage, now + 5 * 60000);
  assert.deepEqual(restored.data, state.data);
  assert.equal(restored.data.attempts.at(-1)!.deadline, attempt.deadline);
  for (const later of [now + 15 * 60000, now + 180 * day]) {
    state.save();
    assert.deepEqual(createState(storage, later).data, createData(later));
    assert.equal(storage.getItem(storageKey), null);
  }
});
test('each course uses a distinct existing product cover', () => {
  const covers = JSON.parse(readFileSync(new URL('../../shared/brand/covers.json', import.meta.url), 'utf8')) as { id: string }[];
  const selected = createData().courses.map(course => course.cover);
  assert.equal(new Set(selected).size, selected.length);
  assert.ok(selected.every(id => covers.some(cover => cover.id === id)));
});
test('sign in accepts any credentials, signs out and preserves the selected view', async () => {
  const { state, call, storage, entries } = setup();
  await call('auth/logout/', 'POST');
  assert.equal((await call('auth/session/')).user, null);
  const first = await call<{ user: { id: number } }>('auth/login/', 'POST', { identifier: 'a visitor', password: 'anything' });
  assert.equal(first.user.id, 1);
  state.switchView('learner');
  await call('auth/logout/', 'POST');
  const second = await call<{ user: { id: number } }>('auth/login/', 'POST', { identifier: 'another visitor', password: 'anything' });
  assert.equal(second.user.id, 3);
  assert.equal(createState(storage).data.userId, 3);
  assert.ok(!entries.get(storageKey)!.includes('anything'));
  assert.equal((await call('auth/session/')).demo_mode, true);
  state.reset(); assert.equal(state.data.userId, 1);
});
test('training people list filters before pagination and reports unfiltered status totals', async () => {
  const { call } = setup();
  const first = await call<EnrollmentPage>('courses/7/enrollments/?page_size=3&page=1');
  const second = await call<EnrollmentPage>('courses/7/enrollments/?page_size=3&page=2');
  assert.equal(first.count, 11); assert.equal(first.results.length, 3);
  assert.equal(new Set([...first.results, ...second.results].map(r => r.id)).size, 6);
  const pending = await call<EnrollmentPage>('courses/7/enrollments/?status=pending&page_size=1&page=2');
  assert.equal(pending.count, 2); assert.equal(pending.results[0].status, 'pending');
  assert.equal(pending.counts.all, 11);
  const search = await call<EnrollmentPage>('courses/7/enrollments/?search=taylor');
  assert.equal(search.count, 1); assert.equal(search.results[0].person, 'Taylor Lin');
  const attendance = await call<EnrollmentPage>('courses/7/enrollments/?attendance=present');
  assert.equal(attendance.count, 3);
  const last = await call<EnrollmentPage>('courses/7/enrollments/?page=999&page_size=3');
  assert.equal(last.page, 4); assert.equal(last.results.length, 2);
});
test('learner cancellation and session switching update seats and survive reload', async () => {
  const { state, call, storage } = setup(); state.switchView('learner');
  const before = await call<Course>('courses/7/');
  assert.equal(before.enrollment?.status, 'pending');
  await call('courses/7/cancel-registration/', 'POST');
  assert.equal((await call<Course>('courses/7/')).sessions[0].remaining, before.sessions[0].remaining + 1);
  await call('courses/7/enroll/', 'POST', { session: 72 });
  let course = await call<Course>('courses/7/');
  assert.equal(course.enrollment?.session?.id, 72); assert.equal(course.enrollment?.status, 'pending');
  await call('courses/7/enroll/', 'POST', { session: 71 });
  course = await call<Course>('courses/7/');
  assert.equal(course.enrollment?.session?.id, 71);
  assert.equal(createState(storage).data.enrollments.find(e => e.course === 7 && e.user_id === 3)?.session?.id, 71);
});
test('admin roster dry run, add, approve, remove and attendance keep overview counts consistent', async () => {
  const { call, state, route } = setup();
  const body = { session: 71, people: [2], text: 'nobody@example.com', dry_run: true };
  const initial = state.data.enrollments.length;
  const dry = await call<{ rows: { outcome: string }[] }>('courses/7/roster/', 'POST', body);
  assert.deepEqual(dry.rows.map(r => r.outcome), ['added', 'not_found']); assert.equal(state.data.enrollments.length, initial);
  await call('courses/7/roster/', 'POST', { ...body, dry_run: false });
  assert.equal(state.data.enrollments.length, initial + 1);
  await call('courses/7/enrollments/3/review/', 'POST', { decision: 'approved' });
  const overview = await call<TrainingOverview>('courses/7/training/');
  assert.equal(overview.sessions[0].counts.pending, 1);
  await call('courses/7/enrollments/3/review/', 'POST', { decision: 'removed' });
  assert.equal((await call<TrainingOverview>('courses/7/training/')).sessions[0].counts.registered, overview.sessions[0].counts.registered - 1);
  const attendance = await call<{ counts: { absent: number; present: number } }>('courses/7/sessions/73/attendance/', 'POST', { enrollment: 10, attendance: 'absent' });
  assert.equal(attendance.counts.absent, 1); assert.equal(attendance.counts.present, 2);
  assert.equal(route('POST', 'courses/7/sessions/71/attendance/', undefined, { all_present: true, attendance: 'present' }).status, 400);
  await call('courses/8/', 'PATCH', { published: true }); assert.equal(state.data.courses[7].published, true);
});
test('exam objective types score from solutions; essay submissions await review', async () => {
  const { state, call } = setup(); state.switchView('learner');
  const all = state.data.exams[2].questions!;
  const correct: Record<string, unknown> = { '1': 1, '2': [3, 0, 1], '3': ' Safety ', '4': '4', '5': '0.505', '6': [0, 1, 2] };
  for (const q of all.filter(q => q.type !== 'essay')) {
    assert.equal(questionPoints(q, correct[String(q.id)]), q.points, q.type);
    assert.equal(questionPoints(q, undefined), 0, `missing ${q.type}`);
  }
  assert.equal(questionPoints(all[3], '4.0'), 0);
  assert.equal(questionPoints(all[4], '0.52'), 0);
  assert.equal(questionPoints(all[4], '1/2'), 0);
  assert.equal(questionPoints(all[5], [2, 1, 0]), 0);
  assert.equal(questionPoints(all[1], [0, 1]), 0);
  for (const original of state.data.attempts) { const copy = structuredClone(original); scoreAttempt(copy); assert.equal(copy.score, original.score); }
  const attempt = await call<Attempt>('exams/1/start/', 'POST');
  assert.ok(attempt.questions.every(q => q.solution === undefined));
  const resumed = await call<Attempt>('exams/1/start/', 'POST'); assert.equal(resumed.id, attempt.id);
  await call(`attempts/${attempt.id}/`, 'PATCH', { answers: { '1': 1 } });
  assert.equal((await call<Attempt>(`attempts/${attempt.id}/`)).answer_revision, 1);
  const result = await call<Attempt>(`attempts/${attempt.id}/`, 'POST', { answers: correct });
  assert.equal(result.score, 100); assert.equal(result.passed, true); assert.equal(result.status, 'graded');
  assert.equal((await call<Exam>('exams/1/')).last_result?.id, result.id);
  const essay = await call<Attempt>('exams/3/start/', 'POST');
  const pending = await call<Attempt>(`attempts/${essay.id}/`, 'POST', { answers: { ...correct, '7': 'A team meeting.' } });
  assert.equal(pending.status, 'pending_review'); assert.equal(pending.score, 80); assert.equal(pending.passed, null);
});
test('unsupported writes and downloads fail normally; only unknown paths warn', async () => {
  const { route } = setup();
  for (const [method, path] of [['POST', 'courses/'], ['PATCH', 'exams/1/'], ['PUT', 'settings/organization/'], ['POST', 'invitations/bulk/']]) {
    const response = route(method, path); assert.equal(response.status, 400); assert.equal((await response.json()).detail, notSaved);
  }
  assert.equal((await route('GET', 'courses/7/sessions/71/export/').json()).detail, notAvailable);
  const warnings: unknown[][] = [], original = console.warn;
  console.warn = (...args) => warnings.push(args);
  try { assert.equal(route('GET', 'missing/').status, 404); } finally { console.warn = original; }
  assert.deepEqual(warnings, [['[demo] unhandled', 'GET', 'missing/']]);
});
test('all advertised read routes respond; API authored text is translated at response time', async () => {
  const { state } = setup();
  const catalogue = { ...JSON.parse(readFileSync(new URL('../../shared/locales/messages.json', import.meta.url), 'utf8')), ...JSON.parse(readFileSync(new URL('./messages.json', import.meta.url), 'utf8')) };
  for (const language of ['en', 'zh-TW', 'es']) {
    const route = createRouter(state, { t: key => { if (key) assert.ok(catalogue[key]?.[language], `${language}: ${key}`); return catalogue[key]?.[language] || key; } });
    for (const entry of routes.filter(r => r.read)) {
      const path = entry.pattern.replace(':enrollment', '3').replace(':session', '73').replace(':id', entry.pattern.startsWith('attempts') || entry.pattern.startsWith('results/') ? 'demo-result-1' : entry.pattern.startsWith('courses') ? '7' : '1');
      const response = route('GET', path);
      assert.equal(response.status, 200, path);
      const body = await response.json();
      assert.notEqual(body?.detail, notAvailable, `missing implementation ${path}`);
    }
    // Exercise every fixture's detail, including localized lesson blocks and seeded essay answers.
    for (const course of state.data.courses) assert.equal(route('GET', `courses/${course.id}/`).status, 200);
    for (const exam of state.data.exams) assert.equal(route('GET', `exams/${exam.id}/`).status, 200);
    for (const attempt of state.data.attempts) assert.equal(route('GET', `results/${attempt.id}/review/`).status, 200);

  }
});
test('Pages redirect and restoration retain queries and fragments and reject outside paths', () => {
  const base = '/Training-System/demo/', origin = 'https://teddashh.github.io';
  let destination = '', hidden = false;
  function redirect(pathname: string, search = '', hash = '') {
    destination = '';
    const documentElement = { hidden: false };
    runInNewContext(readFileSync(new URL('./redirect.js', import.meta.url), 'utf8'), { URL, encodeURIComponent, document: { currentScript: { src: origin + base + 'redirect.js' }, documentElement }, window: { location: { pathname, search, hash, replace: (url: string) => { destination = url; } } } });
    hidden = documentElement.hidden;
    return destination;
  }
  assert.equal(redirect('/Training-System/about/'), ''); assert.equal(hidden, false);
  assert.equal(redirect(base), ''); assert.equal(hidden, false);
  const next = redirect(base + 'register', '?source=demo', '#demo-forklift-link');
  assert.equal(hidden, true);
  assert.equal(restoredRoute(new URL(next, origin).search, base, origin), base + 'register?source=demo#demo-forklift-link');
  for (const route of ['//example.com/', '/outside/', base + '../outside/', '/Training-System/demonstration/']) assert.equal(restoredRoute('?route=' + encodeURIComponent(route), base, origin), null);
});

test('fetch shim preserves non-API requests and routes Request bodies, filters and aborts locally', async () => {
  const { route } = setup();
  const passthrough: string[] = [];
  const original: typeof fetch = async input => {
    const request = input as Request;
    passthrough.push(await request.text());
    return new Response('asset');
  };
  const origin = 'https://teddashh.github.io', base = '/Training-System/demo/';
  const fetch = demoFetch(original, route, origin + base, base + 'api/');
  const external = new Request('https://example.com/api/other/', { method: 'POST', body: 'untouched' });
  assert.equal(await (await fetch(external)).text(), 'asset'); assert.deepEqual(passthrough, ['untouched']);
  const request = new Request(origin + base + 'api/auth/login/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'learner2@example.com', password: 'anything' }) });
  assert.equal((await (await fetch(request)).json()).user.id, 3);
  const response = await fetch(base + 'api/courses/7/');
  assert.equal((await response.json()).enrollment.person, 'Taylor Lin');
  const signal = AbortSignal.abort();
  await assert.rejects(fetch(base + 'api/auth/session/', { signal }), { name: 'AbortError' });
  assert.equal(passthrough.length, 1);
  const link = (href: string, download = false) => ({ href, hasAttribute: () => download });
  for (const href of [base + 'api/results/export/', base + 'studio/#/app']) assert.equal(blockedLink(link(href), origin + base, base + 'api/', base + 'studio/'), true);
  assert.equal(blockedLink(link('blob:demo-calendar', true), origin + base, base + 'api/', base + 'studio/'), true);
  assert.equal(blockedLink(link(base + 'register#demo-forklift-link'), origin + base, base + 'api/', base + 'studio/'), false);
});

// Audited against the unavailable/unsaved lists: downloads, SSO links and mutation handlers
// run only after an explicit action. QuestionFigure mounts only when a figure exists;
// none of the fixtures has one, and figure upload remains an explicit refused action.
// These conditional reads must also succeed when restoring optional state or deep links.
const mountReads: [string, string, string, Record<string, unknown>?][] = [
  ['Course settings /authoring/3?settings=1: materials', 'GET', 'courses/3/materials/'],
  ['Course settings /authoring/3?settings=1: assessments', 'GET', 'courses/3/assessments/'],
  ['Course settings /authoring/7?settings=1: materials', 'GET', 'courses/7/materials/'],
  ['Course settings /authoring/7?settings=1: assessments', 'GET', 'courses/7/assessments/'],
  ['Course settings: assessment choices', 'GET', 'exams/'],
  ['GuestExam: invitation page', 'GET', 'guest/exam/'],
  ['GuestExam: fragment exchange', 'POST', 'guest/exchange/', { token: 'demo-exam-link' }],
  ['useAttemptSession: saved preview', 'GET', 'previews/demo-preview/'],
  ['useAttemptSession: preview timing', 'GET', 'previews/demo-preview/heartbeat/'],
  ['ReviewModal: preview review', 'GET', 'previews/demo-preview/review/'],
  ['AttemptEvidence: preserved submission', 'GET', 'attempts/demo-result-1/reopenings/demo-reopening/'],
  ['MarksImport: restored receipt', 'GET', 'exams/1/marks/imports/demo-marks/'],
  ['MarksImport: history', 'GET', 'exams/1/marks/imports/'],
  ['Assignments: selected-group count effect', 'POST', 'assignments/group-preview/', { groups: [1, 2] }],
];
test('named screen/dialog mount-time reads return 200 without saving changes', async () => {
  const { state, route } = setup();
  const before = JSON.stringify(state.data);
  for (const [name, method, path, body] of mountReads) {
    const response = route(method, path, undefined, body);
    assert.equal(response.status, 200, name);
    const data = await response.json();
    assert.equal(data.detail, undefined, name);
    if (path.endsWith('/materials/')) assert.deepEqual(data, []);
    if (path.endsWith('/assessments/')) assert.ok(Array.isArray(data.linked) && Array.isArray(data.available));
    if (path === 'assignments/group-preview/') assert.deepEqual(data, { people: 8, within_limit: true });
    if (path === 'exams/1/marks/imports/demo-marks/') assert.ok(Array.isArray(data.changes) && Array.isArray(data.outcomes) && !data.can_apply);
  }
  assert.equal(JSON.stringify(state.data), before);
  state.data.userId = null;
  assert.equal(route('GET', 'guest/exam/').status, 200);
  assert.equal(route('POST', 'guest/exchange/', undefined, { token: 'demo-exam-link' }).status, 200);
  assert.ok(state.data.exams.every(e => e.questions?.every(q => !q.figure)));
  assert.ok(state.data.attempts.every(a => a.questions.every(q => !q.figure)));
});

test('reloadTarget and reloadApp reload at the base URL and replace with ?route= on nested routes', () => {
  const base = '/Training-System/demo/';
  assert.equal(reloadTarget(base, '?x=1', '#h', base), null);
  assert.equal(reloadTarget(base + 'authoring/7', '?tab=people', '#top', base), base + '?route=' + encodeURIComponent(base + 'authoring/7?tab=people#top'));
  let reloaded = 0, replaced = '';
  reloadApp({ pathname: base, search: '', hash: '', reload: () => { reloaded++; }, replace: url => { replaced = String(url); } }, base);
  assert.equal(reloaded, 1); assert.equal(replaced, '');
  reloadApp({ pathname: base + 'authoring/7', search: '', hash: '', reload: () => { reloaded++; }, replace: url => { replaced = String(url); } }, base);
  assert.equal(reloaded, 1); assert.equal(replaced, base + '?route=' + encodeURIComponent(base + 'authoring/7'));
});

test('question-bank returns 7 active questions with archived: false and full bank fields', async () => {
  const { call } = setup();
  const questions = await call<(Question & { category: string; archived: boolean; owner_name: string; can_manage: boolean; updated_at: string })[]>('question-bank/');
  assert.equal(questions.length, 7);
  assert.equal(questions.filter(q => q.archived === false).length, 7);
  assert.equal(questions.filter(q => q.archived === true).length, 0);
  for (const q of questions) {
    assert.equal(q.category, 'Core training');
    assert.equal(typeof q.owner_name, 'string');
    assert.equal(q.can_manage, true);
    assert.equal(typeof q.updated_at, 'string');
    assert.ok(Array.isArray(q.answer_tolerances));
    assert.ok(Array.isArray(q.answer_matching));
  }
});

test('exams/link-options returns courses by default, quizzes when ?quizzes=1, and exam course_links carry linked course id and title', async () => {
  const { call } = setup();
  const courses = await call<{ id: number; title: string; published: boolean }[]>('exams/link-options/');
  assert.equal(courses.length, 8);
  assert.deepEqual(courses[0], { id: 1, title: 'Information security & data privacy', published: true });
  const quizzes = await call<(Exam & { gated: boolean })[]>('exams/link-options/?quizzes=1');
  assert.equal(quizzes.length, 3);
  assert.equal(quizzes[1].title, 'Forklift safety quiz');
  assert.equal(quizzes[1].gated, true);
  const exam1 = await call<Exam>('exams/1/');
  assert.deepEqual(exam1.course_links, [{ id: 1, title: 'Information security & data privacy' }]);
});

test('people have employee_id E0001..E0012 and people lookups match email, username or employee ID trimmed and case-insensitively', async () => {
  const { state, call } = setup();
  assert.deepEqual(state.data.users.map(u => u.employee_id), Array.from({ length: 12 }, (_, i) => `E${String(i + 1).padStart(4, '0')}`));
  const checked = await call<{ rosters: { rows: { input: string; outcome: string; user?: number; name?: string }[] }[] }>('trainings/check-people/', 'POST', {
    rosters: [{ people: [], groups: [], text: '  e0002 \n LEARNER2@EXAMPLE.COM , demo.learner3 ' }],
  });
  assert.deepEqual(checked.rosters[0].rows.map(r => [r.user, r.name, r.outcome]), [
    [2, 'Jamie Chen', 'ready'],
    [3, 'Taylor Lin', 'ready'],
    [4, 'Sofia Huang', 'ready'],
  ]);
  const roster = await call<{ rows: { user?: number; name?: string; outcome: string }[] }>('courses/7/roster/', 'POST', {
    session: 71, people: [], text: '  e0002 ', dry_run: true,
  });
  assert.deepEqual(roster.rows.map(r => [r.user, r.name, r.outcome]), [[2, 'Jamie Chen', 'added']]);
  const users = await call<{ results: { id: number; display_name: string }[] }>('users/?search=%20e0002%20');
  assert.deepEqual(users.results.map(u => u.display_name), ['Jamie Chen']);
  const enrollments = await call<EnrollmentPage>('courses/7/enrollments/?search=%20e0003%20');
  assert.deepEqual(enrollments.results.map(r => r.person), ['Taylor Lin']);
});

test('POST courses/:id/complete marks text courses completed and rejects SCORM or empty courses', async () => {
  const { state, call, route } = setup();
  state.switchView('learner');
  assert.equal((await call<Course>('courses/5/')).progress, null);
  assert.deepEqual(await call<{ progress: number }>('courses/5/complete/', 'POST'), { progress: 100 });
  const completed = await call<Course>('courses/5/');
  assert.equal(completed.progress, 100);
  assert.equal(completed.progress_known, true);
  assert.ok(completed.enrollment?.completed_at);
  const scorm = route('POST', 'courses/4/complete/');
  assert.equal(scorm.status, 400);
  assert.equal((await scorm.json()).detail, 'SCORM completion must be reported by the player. Empty content cannot be completed.');
});

test('POST scorm/:id/commit records partial and completed SCORM progress on the enrollment', async () => {
  const { state, call } = setup();
  state.switchView('learner');
  const slide2 = await call<{ completed: boolean; progress: number; progress_known: boolean }>('scorm/demo-digital-tools/commit/', 'POST', {
    nonce: 'demo-course-preview',
    cmi: { 'cmi.core.lesson_status': 'incomplete', 'cmi.progress_measure': String(2 / 3) },
  });
  assert.deepEqual(slide2, { completed: false, progress: 67, progress_known: true });
  assert.equal((await call<Course>('courses/4/')).progress, 67);
  const slide3 = await call<{ completed: boolean; progress: number; progress_known: boolean }>('scorm/demo-digital-tools/commit/', 'POST', {
    nonce: 'demo-course-preview',
    cmi: { 'cmi.core.lesson_status': 'completed', 'cmi.progress_measure': '1' },
  });
  assert.deepEqual(slide3, { completed: true, progress: 100, progress_known: true });
  const course = await call<Course>('courses/4/');
  assert.equal(course.progress, 100);
  assert.ok(course.enrollment?.completed_at);
});

test('courses without an enrollment serialize progress as null while enrolled courses use the enrollment progress', async () => {
  const { state, call } = setup();
  state.switchView('learner');
  const courses = await call<Course[]>('courses/');
  const byId = new Map(courses.map(c => [c.id, c]));
  assert.equal(byId.get(1)?.progress, 40);
  assert.equal(byId.get(2)?.progress, 100);
  assert.equal(byId.get(7)?.progress, 0);
  for (const id of [3, 4, 5, 6]) {
    assert.equal(byId.get(id)?.progress, null, `course ${id}`);
    assert.equal(byId.get(id)?.progress_known, true, `course ${id}`);
  }
});

test('Forklift quiz attempts, roster quiz statuses, overview counts, and session-end gating are consistent', async () => {
  const { now, state, call, route } = setup();
  const exam2Attempts = state.data.attempts.filter(a => a.exam_id === 2);
  assert.deepEqual(exam2Attempts.map(a => [a.user_id, a.score, a.passed, a.status]), [
    [10, 100, true, 'graded'],
    [11, 90, true, 'graded'],
    [12, 80, true, 'graded'],
  ]);
  const otherAttempts = state.data.attempts.filter(a => a.exam_id !== 2);
  assert.ok(otherAttempts.every(a => [1, 3].includes(a.exam_id) && a.user_id >= 3 && a.user_id <= 9));
  assert.ok(otherAttempts.filter(a => a.status === 'graded' && a.passed === false).length >= 2);

  const overview = await call<TrainingOverview>('courses/7/training/');
  assert.equal(overview.quizzes[0].participation.passed, 3);
  // As the real overview: only approved participants count, and a quiz open to everyone is not gated.
  assert.equal(overview.people, 9);
  assert.equal(overview.quizzes[0].gated, true);
  const online = await call<TrainingOverview>('courses/3/training/');
  assert.equal(online.people, 0);
  assert.deepEqual(online.quizzes.map(q => [q.title, q.gated, q.participation]), [['Workplace skills assessment', false, { started: 0, passed: 0 }]]);
  const enrollments = await call<EnrollmentPage>('courses/7/enrollments/');
  const passedPeople = enrollments.results.filter(r => r.quiz === 'passed').map(r => r.person);
  const results = await call<ResultsPage>('results/?exam=2');
  assert.deepEqual(passedPeople, ['Mia Tsai', 'Ethan Yang', 'Ava Hsu']);
  assert.deepEqual(results.results.map(r => r.person), passedPeople);
  assert.ok(enrollments.results.filter(r => r.quiz !== 'passed').every(r => r.quiz === 'not_started'));

  // Alex Morgan (userId 1, approved for future session 71) and Taylor Lin (userId 3, pending for future session 72)
  for (const userId of [1, 3]) {
    state.data.userId = userId;
    const courses = await call<Course[]>('courses/'), exams = await call<Exam[]>('exams/'), assignments = await call<OwnAssignment[]>('assignments/');
    const steps = selectNextSteps(courses, exams, assignments, userId, now);
    assert.ok(!steps.some(r => r.title === 'Forklift safety quiz' && r.action === 'Take assessment'), `user ${userId} nextSteps`);
    const exam2 = exams.find(e => e.id === 2)!;
    if (userId === 3) assert.equal(exam2.available_to_me, false);
    else assert.notEqual(examLearnerState(exam2, now).state, 'ready');
    assert.equal(route('POST', 'exams/2/start/').status, 403);
  }
  // Mia Tsai (userId 10, approved for ended session 73)
  state.data.userId = 10;
  const exam2For10 = await call<Exam>('exams/2/');
  assert.equal(exam2For10.available_to_me, true);
  assert.equal(exam2For10.next_attempt_at, null);
});

test('all router percentages and averages are rounded to whole numbers with Math.round', async () => {
  const { call } = setup();
  const dash = await call<Dashboard>('dashboard/');
  for (const value of [dash.completion, dash.pass_rate, dash.average_score, ...dash.trend.map(t => t.average)]) {
    assert.equal(Number.isInteger(value), true, `dashboard value ${value}`);
  }
  const results = await call<ResultsPage>('results/');
  assert.equal(Number.isInteger(results.summary.average_score), true);
  assert.equal(Number.isInteger(results.summary.pass_rate), true);
  for (const id of [1, 2, 3]) {
    const insights = await call<{ summary: ResultsPage['summary']; questions: { average_points: number; full_credit_rate: number; answer_rate: number }[] }>(`exams/${id}/insights/`);
    if (insights.summary.average_score !== null) assert.equal(Number.isInteger(insights.summary.average_score), true);
    if (insights.summary.pass_rate !== null) assert.equal(Number.isInteger(insights.summary.pass_rate), true);
    for (const q of insights.questions) {
      assert.equal(Number.isInteger(q.average_points), true);
      assert.equal(Number.isInteger(q.full_credit_rate), true);
      assert.equal(Number.isInteger(q.answer_rate), true);
    }
  }
});
