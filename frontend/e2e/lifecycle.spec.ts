import { test, expect, type Page, type Route } from '@playwright/test';
import type { Course, CourseSession } from '../src/types';

const url = (path: string) => (process.env.E2E_SUBPATH || '') + path;
test.beforeEach(async ({ page }) => { page.on('pageerror', error => { throw error; }); });
async function setup(page: Page, assign = false) {
  const session: CourseSession = { id: 81, title: 'Synthetic session', revision: 2, location: 'Room',
    starts_at: new Date(Date.now() + 86400000).toISOString(), ends_at: new Date(Date.now() + 90000000).toISOString(),
    registration_opens_at: null, registration_closes_at: new Date(Date.now() + 86400000).toISOString(),
    capacity: 30, reserved: 1, remaining: 29, cancelled: false, state: 'open' };
  const course: Course = { id: 901, title: 'Synthetic training', description: 'Synthetic training', category: 'General training',
    cover: 'learning-skills', duration_minutes: 60, delivery_mode: 'scheduled', venue: 'onsite', requires_approval: false,
    published: true, release_at: null, sessions: [session], assessments: [], server_time: new Date().toISOString(),
    enrollment: null, can_learn: true, can_manage: true, blocks: [], package: null, progress: null, enrolled_count: 1 };
  const exam = { id: 902, title: 'Synthetic exam', published: true, can_manage: true, can_view_results: true,
    available_to_me: true, question_count: 2, courses: [], course_links: [], audience: 'all', starts_at: null,
    ends_at: null, active_attempt_id: null, last_result: null, has_passed: false, next_attempt_at: null as string | null,
    attempts_remaining: 2, effective_attempt_limit: 2,
    max_attempts: 2, attempts_used: 0, duration_minutes: 30, pass_score: 70, server_time: new Date().toISOString() };
  const state = { course, exam, courseDeleted: false, examDeleted: false, unpublished: false, attempts: 0, fail: false, writes: [] as string[] };
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      state.writes.push(request.method() + ' ' + path);
      if (state.fail) return route.fulfill({ status: 409, json: { detail: 'Synthetic conflict. Refresh and try again.' } });
    }
    let data: unknown = [];
    if (path.endsWith('/auth/session/')) data = { user: { id: 1, username: 'test', display_name: 'Test Manager',
      role: 'training_scheduler', access: { courses: 'own', exams: 'own', results: 'none', assign,
        invitations: false, system_admin: false, people: false, scorm_upload: false, scorm_source: false } }, entra_enabled: false };
    else if (path.endsWith('/courses/901/deletion-preview/')) data = { title: course.title, counts: { sessions: 1, enrollments: 1, assignments: 0 } };
    else if (path.endsWith('/exams/902/deletion-preview/')) data = { title: exam.title, counts: { questions: 2, attempts: state.attempts, courses: 0, invitations: 0, assignments: 0 } };
    else if (path.endsWith('/cancel-training/')) {
      expect(request.postDataJSON()).toEqual({ sessions: [{ id: session.id, revision: 2 }] });
      session.cancelled = true; session.state = 'cancelled'; session.revision++; data = { cancelled: 1 };
    } else if (path.endsWith('/sessions/81/')) {
      expect(request.postDataJSON()).toEqual({ cancelled: true, revision: 2 });
      session.cancelled = true; session.state = 'cancelled'; session.revision++; data = session;
    } else if (request.method() === 'DELETE') {
      expect(request.postDataJSON().confirm_title).toBe(path.includes('/courses/') ? course.title : exam.title);
      if (path.includes('/courses/')) state.courseDeleted = true; else state.examDeleted = true;
      return route.fulfill({ status: 204 });
    } else if (path.endsWith('/courses/mine/')) data = [{ ...course, published: !state.unpublished }, { ...course, id: 999, title: 'Hidden draft', published: false }];
    else if (path.endsWith('/courses/')) data = state.courseDeleted ? [] : [course];
    else if (path.endsWith('/exams/')) data = state.examDeleted ? [] : [exam];
    else if (path.endsWith('/exams/902/')) data = exam;
    else if (path.endsWith('/courses/901/assessments/')) data = { linked: [], available: [] };
    else if (path.endsWith('/courses/901/enrollments/')) data = { count: 0, page: 1, page_size: 50, counts: { all: 0 }, results: [] };
    else if (path.endsWith('/courses/901/')) data = course;
    else if (path.endsWith('/training/')) data = { ...course, reminders: false, registration_url: null, quizzes: [],
      sessions: [{ ...session, counts: { registered: 1, pending: 0, present: 0, absent: 0, seats: 1 }, emails: [] }] };
    return route.fulfill({ json: data });
  });
  return state;
}

for (const width of [390, 768, 1440]) {
  test(`cancel training and delete course at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await setup(page);
    await page.goto(url('/authoring'));
    await page.getByLabel('More actions for Synthetic training', { exact: true }).click();
    await page.getByRole('button', { name: 'Cancel training', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Enrollment and attendance records are kept');
    await page.screenshot({ path: `/tmp/training-lifecycle-cancel-${width}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Keep sessions', exact: true }).click();
    expect(state.writes).toEqual([]);
    await page.getByLabel('More actions for Synthetic training', { exact: true }).click();
    await page.getByRole('button', { name: 'Cancel training', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByLabel('More actions for Synthetic training', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancel training', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete course', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Enrollments: 1');
    await expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    await dialog.getByLabel('Type the title to confirm').fill('wrong');
    await expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    await dialog.getByLabel('Type the title to confirm').fill('Synthetic training');
    await page.screenshot({ path: `/tmp/training-lifecycle-delete-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    state.fail = true;
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(dialog).toContainText('Synthetic conflict');
    expect(state.courseDeleted).toBe(false);
    state.fail = false;
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.training-row')).toHaveCount(0);
  });
}

test('exam results block deletion; an unused exam can be deleted', async ({ page }) => {
  const state = await setup(page);
  state.attempts = 1;
  await page.goto(url('/exams'));
  await page.getByLabel('More actions for Synthetic exam', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete exam', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Unpublish it instead.');
  await expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.writes).toEqual([]);
  state.attempts = 0;
  await page.getByLabel('More actions for Synthetic exam', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete exam', exact: true }).click();
  await dialog.getByLabel('Type the title to confirm').fill('Synthetic exam');
  await dialog.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.exam-card')).toHaveCount(0);
});

for (const [locale, action, label] of [
  ['zh-TW', '刪除課程', '輸入完整名稱以確認'],
  ['es', 'Eliminar curso', 'Escribe el título para confirmar'],
]) test(`deletion confirmation is translated in ${locale}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(value => localStorage.setItem('training-language', value), locale);
  await setup(page);
  await page.goto(url('/authoring'));
  await page.locator('.training-row summary').click();
  await page.getByRole('button', { name: action, exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel(label)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/training-lifecycle-${locale}.png`, fullPage: true });
});

test('training page supports single-session cancellation and returns to list after deletion', async ({ page }) => {
  await setup(page);
  await page.goto(url('/authoring/901'));
  await page.getByLabel('More actions for Synthetic session', { exact: true }).click();
  await page.getByRole('button', { name: 'Cancel session', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(page.locator('.session-card')).toContainText('Cancelled');
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete course', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type the title to confirm').fill('Synthetic training');
  await dialog.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page).toHaveURL(new RegExp('/authoring$'));
  await expect(page.locator('.training-row')).toHaveCount(0);
});

test('People deep links select counted statuses and fall back to All for empty statuses', async ({ page }) => {
  await setup(page, true);
  const statuses: string[] = [];
  await page.route('**/api/courses/901/enrollments/**', route => {
    statuses.push(new URL(route.request().url()).searchParams.get('status')!);
    return route.fulfill({ json: { count: 0, page: 1, page_size: 50, results: [],
      counts: { all: 2, registered: 1, pending: 1, attended: 0, absent: 0, cancelled: 0 } } });
  });
  await page.goto(url('/authoring/901?tab=people&status=pending&settings=1'));
  const settings = page.getByRole('dialog', { name: 'Course settings', exact: true });
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/authoring/901\\?tab=people&status=pending$'));
  const filters = page.getByRole('group', { name: 'Status', exact: true });
  await expect(filters.getByRole('button', { name: 'Pending 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(statuses).toEqual(['pending']);
  const assign = page.getByRole('link', { name: 'Assign training', exact: true });
  await expect(assign).toBeVisible();
  await page.getByRole('button', { name: 'Add people', exact: true }).click();
  await expect(assign).toHaveCount(0);
  await page.locator('.training-add').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(assign).toBeVisible();

  statuses.length = 0;
  await page.goto(url('/authoring/901?tab=people&status=cancelled'));
  await expect(filters.getByRole('button', { name: 'All 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => statuses).toEqual(['cancelled', 'all']);
  await expect(filters.getByRole('button', { name: 'Cancelled 0', exact: true })).toHaveCount(0);
  await page.goto(url('/authoring/901?tab=people&status=unknown'));
  await expect(filters.getByRole('button', { name: 'All 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('People filters keep their URL, attendance results, and position through overlapping requests', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const calls: { status: string | null; attendance: string | null }[] = [];
  const counts = { all: 2, registered: 2, pending: 0, attended: 1, absent: 1, cancelled: 0 };
  const present = { id: 1, person: 'Alex Present', active: true, department: 'Safety', session: null, status: 'approved', effective_attendance: 'present' };
  const absent = { id: 2, person: 'Bailey Absent', active: true, department: 'Safety', session: null, status: 'approved', effective_attendance: 'absent' };
  let releaseInitial!: () => void, releasePresent!: () => void;
  const initial = new Promise<void>(resolve => { releaseInitial = resolve; });
  const delayedPresent = new Promise<void>(resolve => { releasePresent = resolve; });
  let blockInitial = true, blockPresent = true;
  await page.route('**/api/courses/901/enrollments/**', async route => {
    const params = new URL(route.request().url()).searchParams;
    const status = params.get('status'), attendance = params.get('attendance');
    calls.push({ status, attendance });
    if (blockInitial && status === 'all' && !attendance) await initial;
    if (blockPresent && attendance === 'present') {
      await delayedPresent;
      return route.fulfill({ json: { count: 0, page: 1, page_size: 50, results: [], counts: { ...counts, attended: 0 } } });
    }
    const results = status === 'cancelled' ? [] : attendance === 'present' ? [present] : attendance === 'absent' ? [absent] : [present, absent];
    return route.fulfill({ json: { count: results.length, page: 1, page_size: 50, results, counts } });
  });
  try {
    await page.goto(url('/authoring/901?tab=people'));
    const add = page.getByRole('button', { name: 'Add people', exact: true });
    await expect(add).toBeVisible();
    const before = (await add.boundingBox())!.y;
    blockInitial = false; releaseInitial();
    const filters = page.getByRole('group', { name: 'Status', exact: true });
    await expect(filters.getByRole('button', { name: 'Present 1', exact: true })).toBeVisible();
    expect(Math.abs((await add.boundingBox())!.y - before)).toBeLessThanOrEqual(1);
    await expect(filters.getByRole('button', { name: 'Pending 0', exact: true })).toHaveCount(0);
    // The filters wrap: never a strip that scrolls or loses a button at the edge, on a tablet or a phone.
    // The row is as wide as the tab and starts at its left edge, not squeezed to the right like a heading's actions.
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const edges = await filters.evaluate(row => {
        const box = row.getBoundingClientRect(), tab = row.parentElement!.getBoundingClientRect();
        return { scrolls: row.scrollWidth > row.clientWidth,
          outside: [...row.querySelectorAll('button')].filter(b => b.getBoundingClientRect().left < 0 || b.getBoundingClientRect().right > window.innerWidth).length,
          full: Math.abs(box.width - tab.width) <= 1, left: Math.abs(row.querySelector('button')!.getBoundingClientRect().left - tab.left) <= 1 };
      });
      expect(edges).toEqual({ scrolls: false, outside: 0, full: true, left: true });
    }

    await filters.getByRole('button', { name: 'Present 1', exact: true }).click();
    await expect(page).toHaveURL(/[?&]status=attended$/);
    await expect.poll(() => calls.some(call => call.status === 'all' && call.attendance === 'present')).toBe(true);
    await filters.getByRole('button', { name: 'Absent 1', exact: true }).click();
    await expect(page).toHaveURL(/[?&]status=absent$/);
    await expect.poll(() => calls.some(call => call.status === 'all' && call.attendance === 'absent')).toBe(true);
    await expect(page.getByText('Bailey Absent', { exact: true })).toBeVisible();
    const stale = page.waitForResponse(response => new URL(response.url()).searchParams.get('attendance') === 'present');
    blockPresent = false; releasePresent();
    await (await stale).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(filters.getByRole('button', { name: 'Absent 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Bailey Absent', { exact: true })).toBeVisible();
    await expect(page.getByText('Alex Present', { exact: true })).toHaveCount(0);

    await page.evaluate(() => history.pushState({}, '', '?tab=people&status=attended'));
    await page.goBack();
    await page.goForward();
    await expect(filters.getByRole('button', { name: 'Present 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Alex Present', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(filters.getByRole('button', { name: 'Absent 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Bailey Absent', { exact: true })).toBeVisible();

    calls.length = 0;
    await page.goto(url('/authoring/901?tab=people&status=cancelled'));
    await expect(filters.getByRole('button', { name: 'All 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => calls).toEqual([{ status: 'cancelled', attendance: null }, { status: 'all', attendance: null }]);
    await expect(page).toHaveURL(/[?&]status=cancelled$/);
    await expect(filters.getByRole('button', { name: 'Cancelled 0', exact: true })).toHaveCount(0);
    await page.goto(url('/authoring/901?tab=people&status=unknown'));
    await expect(filters.getByRole('button', { name: 'All 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[?&]status=unknown$/);
  } finally {
    releaseInitial(); releasePresent();
  }
});

test('catalog settings link to the training page; self-paced redirects replace history', async ({ page }) => {
  const state = await setup(page);
  await page.goto(url('/courses'));
  await page.getByRole('button', { name: 'Edit Synthetic training', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Course settings', exact: true });
  const home = settings.getByRole('link', { name: 'Open training page', exact: true });
  await expect(home).toHaveAttribute('href', url('/authoring/901'));
  await expect(settings.getByRole('button', { name: 'Add session', exact: true })).toHaveCount(0);
  await home.click();
  await expect(page).toHaveURL(new RegExp('/authoring/901$'));
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add session', exact: true })).toBeVisible();

  state.course.delivery_mode = 'self_paced';
  state.course.venue = 'online';
  state.course.sessions = [];
  await page.goto(url('/my-training'));
  await expect(page.getByRole('heading', { name: 'My Training', exact: true })).toBeVisible();
  await page.goto(url('/authoring/901'));
  await expect(page).toHaveURL(new RegExp('/authoring\\?course=901&action=edit$'));
  await expect(settings).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp('/my-training$'));
});

test('My Training hides unpublished courses and restores republished courses', async ({ page }) => {
  const state = await setup(page);
  await page.goto(url('/my-training'));
  await expect(page.getByRole('heading', { name: 'Synthetic training', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hidden draft', exact: true })).toHaveCount(0);
  state.unpublished = true;
  await page.reload();
  await expect(page.getByText('No training yet', { exact: true })).toBeVisible();
  const empty = page.locator('.panel').filter({has: page.getByRole('heading', {name: 'No training yet', exact: true})});
  await expect(empty).toHaveText('No training yet');
  await expect(empty.locator('a, button')).toHaveCount(0);
  state.unpublished = false;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Synthetic training', exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});

for (const width of [390, 768, 1440]) test(`assessment options escape dialog clipping at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const state = await setup(page);
  state.course.assessments = [{ ...state.exam, audience: 'all', next_attempt_at: null, other_courses: 0, window_state: 'open',
    last_result: { id: 'synthetic-result', status: 'graded', score: 0, passed: false } }] as Course['assessments'];
  await page.goto(url('/courses?course=901&action=register'));
  const dialog = page.getByRole('dialog');
  const summary = dialog.getByLabel('More actions for Synthetic exam', { exact: true });
  await summary.scrollIntoViewIfNeeded(); await summary.click();
  const panel = dialog.locator('.course-more-panel');
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.evaluate(el => el.matches(':popover-open'))).toBe(true);
  for (const item of await panel.locator('button,a').all()) {
    expect(await item.evaluate(el => {
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight && !!hit && el.contains(hit);
    })).toBe(true);
  }
  await page.screenshot({ path: `/tmp/training-assessment-options-${width}.png` });
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible(); await expect(dialog).toBeVisible(); await expect(summary).toBeFocused();
  expect(state.writes).toEqual([]);
});

test('Home adds its sections from the top down and moves nothing that is shown', async ({ page }) => {
  const state = await setup(page);
  state.course.requires_approval = true;
  const gates: (() => void)[] = [];
  const gate = () => new Promise<void>(resolve => gates.push(resolve));
  const steps = gate(), requests = gate();
  await page.route('**/api/assignments/', async route => { await steps; await route.fulfill({ json: [
    { user_id: 1, kind: 'exam', target_id: 902, title: 'Synthetic exam', available: true, status: 'assigned', due_at: null }] }); });
  await page.route('**/api/courses/901/enrollments/?status=pending', async route => { await requests; await route.fulfill({ json: { count: 2 } }); });
  await page.goto(url('/'));
  const create = page.getByRole('link', { name: 'New training', exact: true });
  const upcoming = page.getByRole('link', { name: /Synthetic training 1 of 30/ });
  const more = page.getByRole('link', { name: 'Statistics', exact: true });
  await expect(create).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Loading…');
  // Nothing below the first answer shows before it: it could only be pushed down later.
  await expect(upcoming).toHaveCount(0);
  await expect(more).toHaveCount(0);
  const createAt = await create.boundingBox();
  gates[0]();
  await expect(upcoming).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next steps', exact: true })).toBeVisible();
  await expect(more).toHaveCount(0);
  expect(await create.boundingBox()).toEqual(createAt);
  const upcomingAt = await upcoming.boundingBox();
  gates[1]();
  await expect(page.getByRole('link', { name: /Synthetic training 2 requests/ })).toBeVisible();
  await expect(more).toBeVisible();
  expect(await upcoming.boundingBox()).toEqual(upcomingAt);
  expect(state.writes).toEqual([]);
});

test('failed rounds display the retry wait and unlock Retake when the wait ends', async ({ page }) => {
  const now = new Date();
  await page.clock.install({ time: now });
  const state = await setup(page);
  // Long enough that a slow first page load does not reach the end of the wait before the first checks.
  const next = new Date(now.getTime() + 30000).toISOString();
  Object.assign(state.exam, { attempts_used: 2, attempts_remaining: 0, next_round_at: next, next_attempt_at: next,
    server_time: now.toISOString(), last_result: { id: 'synthetic-result', passed: false, score: 0 } });
  await page.goto(url('/my-exams'));
  await expect(page.getByRole('heading', { name: 'To do', exact: true })).toBeVisible();
  await expect(page.getByText(/Next attempt available at/)).toBeVisible();
  await expect(page.getByText(/Retry in .* sec/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retake', exact: true })).toBeDisabled();
  const notice = page.locator('.retry-availability'), size = await notice.boundingBox();
  await page.clock.runFor(31000);
  await expect(page.getByRole('link', { name: 'Retake', exact: true })).toBeVisible();
  // The notice keeps its lines, so nothing below it moves; "Ready" takes the place of the countdown.
  await expect(page.getByText(/Retry in .* sec/)).toHaveCount(0);
  await expect(notice).toContainText('Ready');
  expect(await notice.boundingBox()).toEqual(size);
  expect(state.writes).toEqual([]);
});

test('a pending assessment offers Retake across personal work until it is exhausted or already passed', async ({ page }) => {
  const state = await setup(page);
  Object.assign(state.exam, {can_manage: false, can_view_results: false, has_passed: false, attempts_used: 1,
    attempts_remaining: 1, retry_interval_minutes: 0, next_attempt_at: null, next_round_at: null,
    round_awaiting_grading: false, last_result: {id: 'pending-result', status: 'pending_review', score: null, passed: null}});
  state.course.delivery_mode = 'self_paced';
  state.course.enrollment = {id: 1, status: 'approved', session: null, progress: 0, completed_at: null} as Course['enrollment'];
  state.course.assessments = [{...state.exam, audience: 'all', other_courses: 0, window_state: 'open'}] as Course['assessments'];
  const assignment = {id: 1, user_id: 1, kind: 'exam', target_id: 902, title: state.exam.title, person: '', username: '',
    department: '', available: true, status: 'pending_review', due_at: null, completed_at: null, notes: '', overdue: false, progress: 0, score: null};
  const sessionEndpoint = '**/api/auth/session/', assignmentEndpoint = '**/api/assignments/', resultEndpoint = '**/api/attempts/pending-result/';
  async function learnerSession(route: Route) {
    await route.fulfill({json: {languages: ['en'], user: {id: 1, username: 'learner', display_name: 'Learner', role: 'learner',
      access: {courses: 'none', exams: 'none', results: 'none', assign: false, invitations: false, system_admin: false, people: false, scorm_upload: false, scorm_source: false}}}});
  }
  async function assignmentRows(route: Route) { await route.fulfill({json: [assignment]}); }
  async function pendingResult(route: Route) { await route.fulfill({json: {id: 'pending-result', exam_id: 902, title: state.exam.title,
    number: 1, status: 'pending_review', score: null, passed: null, pass_score: 70, server_time: new Date().toISOString(), deadline: null,
    questions: [], answers: {}, manual_grades: {}, review_available: false, answer_revision: 0, grading_revision: 0,
    allow_skip: true, question_count: 0, extra_time_minutes: 0}}); }
  await page.route(sessionEndpoint, learnerSession);
  await page.route(assignmentEndpoint, assignmentRows);
  await page.route(resultEndpoint, pendingResult);
  try {
    await page.goto(url('/'));
    const next = page.locator('.next-step').filter({hasText: state.exam.title});
    await expect(next.getByRole('button', {name: 'Retake', exact: true})).toBeVisible();
    await page.goto(url('/my-exams'));
    const todo = page.locator('.personal-section').filter({has: page.getByRole('heading', {name: 'To do', exact: true})});
    const card = todo.locator('.exam-card').filter({hasText: state.exam.title});
    await expect(card.getByRole('link', {name: 'Retake', exact: true})).toBeVisible();
    await expect(card.getByRole('link', {name: 'View results', exact: true})).toHaveAttribute('href', url('/attempt/pending-result'));
    await page.goto(url('/my-training'));
    const courseQuiz = page.locator('.assessment-summary').filter({hasText: state.exam.title});
    await expect(courseQuiz.getByRole('link', {name: 'Retake', exact: true})).toBeVisible();
    await expect(courseQuiz.getByRole('link', {name: 'View results', exact: true})).toBeVisible();
    await page.goto(url('/courses'));
    const compactQuiz = page.locator('.assessment-compact .assessment-summary').filter({hasText: state.exam.title});
    await expect(compactQuiz.getByRole('link', {name: 'Retake', exact: true})).toBeVisible();
    await expect(compactQuiz.getByRole('link', {name: 'View results', exact: true})).toBeVisible();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({width, height: 900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto(url('/exams'));
    const examCard = page.locator('.exam-card').filter({hasText: state.exam.title});
    await examCard.getByRole('link', {name: 'Retake', exact: true}).click();
    const examDialog = page.getByRole('dialog', {name: 'Ready to start?', exact: true});
    await expect(examDialog.getByRole('button', {name: 'Retake', exact: true})).toBeEnabled();
    await page.goto(url('/assignments'));
    const row = page.getByRole('row').filter({hasText: state.exam.title});
    await row.getByRole('button', {name: 'Retake', exact: true}).click();
    await expect(page.getByRole('dialog', {name: 'Open assessment', exact: true}).getByRole('button', {name: 'Retake', exact: true})).toBeEnabled();
    await page.goto(url('/attempt/pending-result'));
    await expect(page.getByRole('heading', {name: 'Submitted, awaiting instructor review', exact: true})).toBeVisible();
    await expect(page.getByRole('link', {name: 'Retake', exact: true})).toBeVisible();

    Object.assign(state.exam, {next_attempt_at: new Date(Date.now() + 60000).toISOString(), server_time: new Date().toISOString()});
    await page.goto(url('/my-exams'));
    await expect(page.getByRole('button', {name: 'Retake', exact: true})).toBeDisabled();
    await page.goto(url('/assignments'));
    await row.getByRole('button', {name: 'Retake', exact: true}).click();
    const assignmentDialog = page.getByRole('dialog', {name: 'Open assessment', exact: true});
    await expect(assignmentDialog.getByRole('button', {name: 'Retake', exact: true})).toBeDisabled();
    Object.assign(state.exam, {next_attempt_at: null, attempts_remaining: 0});
    await page.goto(url('/my-exams'));
    await expect(page.getByRole('button', {name: 'Awaiting grading', exact: true})).toBeDisabled();
    await page.goto(url('/assignments'));
    await row.getByRole('button', {name: 'Awaiting grading', exact: true}).click();
    await expect(assignmentDialog.getByRole('button', {name: 'Awaiting grading', exact: true})).toBeDisabled();
    Object.assign(state.exam, {attempts_remaining: 1, has_passed: true});
    await page.goto(url('/my-exams'));
    const completed = page.locator('.personal-section').filter({has: page.getByRole('heading', {name: 'Completed', exact: true})});
    await expect(completed).toContainText(state.exam.title);
    await expect(completed.getByRole('link', {name: 'Retake', exact: true})).toHaveCount(0);
    await expect(completed.getByRole('link', {name: 'View results', exact: true})).toBeVisible();

    // The earlier result is now passed, but the next attempt is already running.
    Object.assign(state.exam, {active_attempt_id: 'active-result', attempts_remaining: 0, server_time: new Date().toISOString()});
    Object.assign(state.course.assessments[0], state.exam);
    await page.goto(url('/'));
    await expect(next.getByRole('button', {name: 'Resume', exact: true})).toBeVisible();
    await page.goto(url('/my-exams'));
    await expect(card.getByRole('link', {name: 'Resume', exact: true})).toBeVisible();
    await expect(completed).toHaveCount(0);
    await page.goto(url('/my-training'));
    await expect(courseQuiz.getByRole('link', {name: 'Resume', exact: true})).toBeVisible();
    await page.goto(url('/courses'));
    await expect(compactQuiz.getByRole('link', {name: 'Resume', exact: true})).toBeVisible();
    await page.goto(url('/exams'));
    await examCard.getByRole('link', {name: 'Resume', exact: true}).click();
    await expect(examDialog.getByRole('button', {name: 'Resume', exact: true})).toBeEnabled();
    await page.goto(url('/assignments'));
    await row.getByRole('button', {name: 'Resume', exact: true}).click();
    await expect(assignmentDialog.getByRole('button', {name: 'Resume', exact: true})).toBeEnabled();

    // The row describes each unavailable state, while its dialog explains the same restriction.
    const opensAt = new Date(Date.now() + 3600000).toISOString();
    Object.assign(state.exam, {active_attempt_id: null, has_passed: false, last_result: null, attempts_used: 0,
      attempts_remaining: 1, starts_at: opensAt, ends_at: null, next_attempt_at: null, server_time: new Date().toISOString()});
    const opensLabel = await page.evaluate(value => `Opens ${new Intl.DateTimeFormat('en', {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}).format(new Date(value))}`, opensAt);
    await page.goto(url('/assignments'));
    await row.getByRole('button', {name: opensLabel, exact: true}).click();
    await expect(assignmentDialog.getByText('Opens at:', {exact: false})).toBeVisible();
    await expect(assignmentDialog.getByRole('button', {name: 'Start', exact: true})).toBeDisabled();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({width, height: 900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    Object.assign(state.exam, {starts_at: null, ends_at: new Date(Date.now() - 60000).toISOString()});
    await page.goto(url('/assignments'));
    await row.getByRole('button', {name: 'Assessment closed', exact: true}).click();
    await expect(assignmentDialog.getByRole('button', {name: 'Assessment closed', exact: true})).toBeDisabled();
    Object.assign(state.exam, {ends_at: null, next_attempt_at: new Date(Date.now() + 60000).toISOString()});
    // The row and dialog both follow the server clock when the device clock is wrong.
    await page.clock.setFixedTime(new Date('2099-01-01T00:00:00Z'));
    await page.goto(url('/assignments'));
    await row.getByRole('button', {name: 'Start', exact: true}).click();
    await expect(assignmentDialog.getByRole('button', {name: 'Start', exact: true})).toBeDisabled();
    await page.clock.setFixedTime(new Date());
    expect(state.writes).toEqual([]);
  } finally {
    await page.unroute(sessionEndpoint, learnerSession);
    await page.unroute(assignmentEndpoint, assignmentRows);
    await page.unroute(resultEndpoint, pendingResult);
  }
});

test('invited learners can retake a pending submission but not after an earlier pass', async ({page}) => {
  const state = await setup(page);
  const info = {...state.exam, exam_id: 902, recipient: 'Synthetic learner', remaining: 1, invitation_remaining: 1,
    expires_at: new Date(Date.now() + 86400000).toISOString(), retry_interval_minutes: 0,
    next_attempt_at: null as string | null, next_round_at: null, round_awaiting_grading: false, has_passed: false,
    last_result: {id: 'pending-result', status: 'pending_review', score: null, passed: null}};
  // The signed-in account has passed, but this invitation belongs to another identity.
  Object.assign(state.exam, {last_result: info.last_result, attempts_remaining: 1, has_passed: true});
  const endpoint = '**/api/guest/exam/', resultEndpoint = '**/api/attempts/pending-result/', activeEndpoint = '**/api/attempts/active-result/';
  let starts = 0;
  async function guestInfo(route: Route) {
    if (route.request().method() === 'POST') {
      starts++;
      return route.fulfill({json: {id: info.active_attempt_id || 'pending-result'}});
    }
    await route.fulfill({json: info});
  }
  async function guestResult(route: Route) { await route.fulfill({json: {id: 'pending-result', exam_id: 902, title: state.exam.title,
    number: 1, status: 'pending_review', score: null, passed: null, pass_score: 70, server_time: new Date().toISOString(), deadline: null,
    questions: [], answers: {}, manual_grades: {}, review_available: false, answer_revision: 0, grading_revision: 0,
    allow_skip: true, question_count: 0, extra_time_minutes: 0}}); }
  async function activeResult(route: Route) { await route.fulfill({json: {id: 'active-result', exam_id: 902, title: state.exam.title,
    number: 2, status: 'in_progress', score: null, passed: null, pass_score: 70, server_time: new Date().toISOString(),
    deadline: new Date(Date.now() + 600000).toISOString(), questions: [{id: 1, description: 'Synthetic question', type: 'single', options: ['Yes', 'No'], points: 1}],
    answers: {}, manual_grades: {}, review_available: false, answer_revision: 0, grading_revision: 0,
    allow_skip: true, question_count: 1, extra_time_minutes: 0}}); }
  await page.route(endpoint, guestInfo);
  await page.route(resultEndpoint, guestResult);
  await page.route(activeEndpoint, activeResult);
  try {
    await page.goto(url('/invite'));
    await expect(page.getByRole('button', {name: 'Retake', exact: true})).toBeEnabled();
    await expect(page.getByRole('button', {name: 'View results', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Retake', exact: true}).click();
    expect(starts).toBe(1);
    await expect(page.getByRole('link', {name: 'Retake', exact: true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('link', {name: 'Retake', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Back to invitation', exact: true}).click();
    info.next_attempt_at = new Date(Date.now() + 60000).toISOString();
    await page.reload();
    await expect(page.getByRole('button', {name: 'Retake', exact: true})).toBeDisabled();
    info.next_attempt_at = null;
    info.remaining = 0;
    await page.reload();
    await expect(page.getByRole('button', {name: 'Awaiting grading', exact: true})).toBeDisabled();
    info.remaining = 1;
    info.has_passed = true;
    state.exam.has_passed = false;
    await page.reload();
    await expect(page.getByRole('button', {name: 'Retake', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'View results', exact: true})).toBeVisible();
    Object.assign(info, {active_attempt_id: 'active-result', remaining: 0, invitation_remaining: 0});
    await page.reload();
    await expect(page.getByRole('button', {name: 'Resume', exact: true})).toBeEnabled();
    await expect(page.getByRole('button', {name: 'View results', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Resume', exact: true}).click();
    expect(starts).toBe(2);
    await expect(page).toHaveURL(url('/attempt/active-result?guest=1'));
    await expect(page.getByRole('heading', {name: 'Synthetic question', exact: true})).toBeVisible();

    Object.assign(info, {active_attempt_id: null, remaining: 1, invitation_remaining: 1, has_passed: false,
      last_result: null, retry_interval_minutes: 30, starts_at: null, ends_at: null, server_time: new Date().toISOString()});
    await page.goto(url('/invite'));
    const startButton = page.getByRole('button', {name: 'Start / resume exam', exact: true});
    await expect(startButton).toBeEnabled();
    // Positions in the page, not the viewport: clicking a control below the fold scrolls the page first.
    const pagePosition = (button: typeof startButton) => button.evaluate(element => {
      const box = element.getBoundingClientRect();
      return {x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height};
    });
    const startPosition = await pagePosition(startButton);
    const opensAt = new Date(Date.now() + 3600000).toISOString();
    const opensLabel = await page.evaluate(value => `Opens ${new Intl.DateTimeFormat('en', {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}).format(new Date(value))}`, opensAt);
    Object.assign(info, {starts_at: opensAt, server_time: new Date().toISOString()});
    await page.getByRole('button', {name: 'Refresh availability', exact: true}).click();
    const upcomingButton = page.getByRole('button', {name: 'Start', exact: true});
    await expect(upcomingButton).toBeDisabled();
    await expect(page.getByText(opensLabel, {exact: true})).toBeVisible();
    expect(await pagePosition(upcomingButton)).toEqual(startPosition);
    Object.assign(info, {starts_at: null, ends_at: new Date(Date.now() - 60000).toISOString(), server_time: new Date().toISOString()});
    await page.getByRole('button', {name: 'Refresh availability', exact: true}).click();
    const closedButton = page.getByRole('button', {name: 'Closed', exact: true});
    await expect(closedButton).toBeDisabled();
    await expect(page.getByText('Assessment closed', {exact: true})).toBeVisible();
    expect(await pagePosition(closedButton)).toEqual(startPosition);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({width, height: 900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    Object.assign(info, {has_passed: true, last_result: {id: 'pending-result', status: 'pending_review', score: null, passed: null}, ends_at: null});
    await page.reload();
    const invitationResult = page.waitForResponse(response => response.url().endsWith('/api/guest/exam/') && response.request().method() === 'GET');
    await page.getByRole('button', {name: 'View results', exact: true}).click();
    await invitationResult;
    await expect(page.getByRole('button', {name: 'Back to invitation', exact: true})).toBeVisible();
    await expect(page.getByRole('link', {name: 'Retake', exact: true})).toHaveCount(0);
  } finally {
    await page.unroute(endpoint, guestInfo);
    await page.unroute(resultEndpoint, guestResult);
    await page.unroute(activeEndpoint, activeResult);
  }
});

test('result controls stay in place when retry availability and a long error arrive', async ({page}) => {
  await setup(page);
  await page.setViewportSize({width: 390, height: 900});
  const resultEndpoint = '**/api/attempts/pending-result/', examEndpoint = '**/api/exams/902/';
  const message = 'The availability check failed. Please try again. '.repeat(8).trim();
  let release!: () => void, arrived!: () => void, fail = false, requests = 0;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { arrived = resolve; });
  async function result(route: Route) {
    requests++;
    await route.fulfill({json: {id: 'pending-result', exam_id: 902, title: 'Synthetic exam',
      number: 1, status: 'pending_review', score: null, passed: null, pass_score: 70,
      server_time: new Date(Date.now() + requests * 1000).toISOString(), deadline: null,
      questions: [], answers: {}, manual_grades: {}, review_available: false, answer_revision: 0, grading_revision: 0,
      allow_skip: true, question_count: 0, extra_time_minutes: 0}});
  }
  async function availability(route: Route) {
    if (fail) return route.fulfill({status: 503, json: {detail: message}});
    arrived();
    await delayed;
    await route.fulfill({json: {id: 902, available_to_me: true, active_attempt_id: null, last_result: {id: 'pending-result',
      status: 'pending_review', score: null, passed: null}, has_passed: false, attempts_remaining: 1,
      starts_at: null, ends_at: null, next_attempt_at: new Date(Date.now() + 60000).toISOString(),
      next_round_at: null, server_time: new Date().toISOString()}});
  }
  await page.route(resultEndpoint, result);
  await page.route(examEndpoint, availability);
  try {
    await page.goto(url('/attempt/pending-result'));
    await waiting;
    const refresh = page.getByRole('button', {name: 'Refresh result', exact: true});
    const back = page.getByRole('button', {name: 'Back to assessment history', exact: true});
    await expect(refresh).toBeVisible();
    const position = async () => Promise.all([refresh, back].map(button => button.evaluate(el => el.getBoundingClientRect().top + window.scrollY)));
    const before = await position();
    release();
    await expect(page.getByText(/Next attempt available at/)).toBeVisible();
    expect(await position()).toEqual(before);
    fail = true;
    await refresh.click();
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText(message);
    expect(await position()).toEqual(before);
    expect(await alert.evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    release();
    await page.unroute(resultEndpoint, result);
    await page.unroute(examEndpoint, availability);
  }
});

test('course assessment summaries retain the next-round wait after two failures', async ({ page }) => {
  const state = await setup(page);
  const next = new Date(Date.now() + 3600000).toISOString();
  state.course.assessments = [{ ...state.exam, audience: 'all', next_attempt_at: next, next_round_at: next, attempts_used: 2,
    attempts_remaining: 0, other_courses: 0, window_state: 'open', last_result: { id: 'synthetic-result', status: 'graded', score: 0, passed: false } }] as Course['assessments'];
  await page.goto(url('/courses?course=901&action=register'));
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Next attempt available at/)).toBeVisible();
  await expect(dialog.getByText(/Retry in/)).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('a failed result immediately shows the next retry time', async ({ page }) => {
  const state = await setup(page);
  const next = new Date(Date.now() + 3600000).toISOString();
  Object.assign(state.exam, { attempts_used: 2, attempts_remaining: 0, next_round_at: next, next_attempt_at: next,
    last_result: { id: 'synthetic-result', passed: false, score: 0 } });
  await page.route('**/api/attempts/synthetic-result/', route => route.fulfill({ json: {
    id: 'synthetic-result', exam_id: 902, title: 'Synthetic exam', number: 2, status: 'graded', score: 0, passed: false,
    pass_score: 70, server_time: new Date().toISOString(), deadline: null, questions: [], answers: {}, manual_grades: {},
    review_available: false, answer_revision: 0, grading_revision: 0, allow_skip: true, question_count: 0, extra_time_minutes: 0,
  } }));
  await page.goto(url('/attempt/synthetic-result'));
  await expect(page.getByRole('heading', { name: 'Assessment completed', exact: true })).toBeVisible();
  await expect(page.getByText(/Next attempt available at/)).toBeVisible();
  await expect(page.getByText(/Retry in/)).toBeVisible();
  expect(state.writes).toEqual([]);
});
