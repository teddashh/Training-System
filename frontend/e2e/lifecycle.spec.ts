import { test, expect, type Page } from '@playwright/test';
import type { Course, CourseSession } from '../src/types';

const url = (path: string) => (process.env.E2E_SUBPATH || '') + path;
test.beforeEach(async ({ page }) => { page.on('pageerror', error => { throw error; }); });
async function setup(page: Page) {
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
    ends_at: null, active_attempt_id: null, last_result: null, attempts_remaining: 2, effective_attempt_limit: 2,
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
      role: 'training_scheduler', access: { courses: 'own', exams: 'own', results: 'none', assign: false,
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

test('My training hides unpublished courses and restores republished courses', async ({ page }) => {
  const state = await setup(page);
  await page.goto(url('/my-training'));
  await expect(page.getByRole('heading', { name: 'Synthetic training', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hidden draft', exact: true })).toHaveCount(0);
  state.unpublished = true;
  await page.reload();
  await expect(page.getByText('No training yet', { exact: true })).toBeVisible();
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

test('failed rounds display the retry wait and unlock Retake when the wait ends', async ({ page }) => {
  const now = new Date();
  await page.clock.install({ time: now });
  const state = await setup(page);
  const next = new Date(now.getTime() + 3000).toISOString();
  Object.assign(state.exam, { attempts_used: 2, attempts_remaining: 0, next_round_at: next, next_attempt_at: next,
    server_time: now.toISOString(), last_result: { id: 'synthetic-result', passed: false, score: 0 } });
  await page.goto(url('/my-exams'));
  await expect(page.getByRole('heading', { name: 'To do', exact: true })).toBeVisible();
  await expect(page.getByText(/Next attempt available at/)).toBeVisible();
  await expect(page.getByText(/Retry in .* sec/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retake', exact: true })).toBeDisabled();
  await page.clock.runFor(4000);
  await expect(page.getByRole('link', { name: 'Retake', exact: true })).toBeVisible();
  await expect(page.getByText(/Next attempt available at/)).toHaveCount(0);
  expect(state.writes).toEqual([]);
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
