import { expect, type Page, type Route } from '@playwright/test';

export async function learningViewport(page: Page) {
  const dialog = page.getByRole('dialog');
  for (const [width, height] of [[1440, 900], [768, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect(dialog).toHaveClass(/full-viewport/);
    const bounds = await dialog.boundingBox();
    expect(bounds?.width).toBe(width);
    expect(bounds?.height).toBe(height);
    expect(bounds?.x).toBe(0);
    expect(bounds?.y).toBe(0);
    const player = page.locator('iframe[title="SCORM course player"]');
    if (await player.count()) {
      expect((await player.boundingBox())!.height).toBeGreaterThan(height * 0.7);
      await expect(dialog.getByRole('button', { name: 'Save and close', exact: true })).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await dialog.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await dialog.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await dialog.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
}

export function attemptRecoveryTests(test: typeof import('@playwright/test').test) {
  async function setup(page: Page, mode: 'stall' | 'committed' | 'committed-502' | 'heartbeat' | 'normal') {
    await page.clock.install();
    await page.addInitScript(() => {
      AbortSignal.timeout = (milliseconds: number) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), milliseconds);
        return controller.signal;
      };
    });
    const now = Date.now();
    const attempt = {
      id: 'recovery', exam_id: 1, title: mode === 'heartbeat' ? 'Recovery exam with a long title that wraps on a phone 1794648844994' : 'Recovery exam', number: 1, status: 'in_progress',
      deadline: new Date(now + 3600000).toISOString(), server_time: new Date(now).toISOString(),
      extra_time_minutes: mode === 'heartbeat' ? 10 : 0, answers: {} as Record<string, string>, answer_revision: 0,
      grading_revision: 0, allow_skip: true, question_count: 2, review_available: false,
      questions: [1, 2].map(id => ({ id, type: 'essay', description: `Question ${id}`, options: [], points: 1 })),
      score: null, passed: null, pass_score: 70, manual_grades: {},
    };
    let patches = 0;
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.endsWith('/auth/session/')) return route.fulfill({ json: { user: null } });
      if (path.endsWith('/heartbeat/')) {
        if (mode === 'heartbeat') return route.abort('failed');
        return route.fulfill({ json: { status: attempt.status, deadline: attempt.deadline, server_time: attempt.server_time, extra_time_minutes: 0 } });
      }
      if (path.endsWith('/attempts/recovery/')) {
        if (request.method() !== 'GET') {
          const body = request.postDataJSON();
          expect(body.answer_revision).toBe(attempt.answer_revision);
          if (request.method() === 'PATCH' && ++patches === 1 && mode !== 'heartbeat' && mode !== 'normal') {
            if (mode === 'committed' || mode === 'committed-502') {
              attempt.answers = body.answers;
              attempt.answer_revision++;
              if (mode === 'committed-502') return route.fulfill({ status: 502, json: { detail: 'Gateway error' } });
              return route.abort('failed');
            }
            return new Promise<void>(() => {});
          }
          attempt.answers = body.answers;
          attempt.answer_revision++;
          if (request.method() === 'POST') attempt.status = 'graded';
        }
        return route.fulfill({ json: attempt });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto((process.env.E2E_SUBPATH || '') + '/attempt/recovery');
    await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeVisible();
    return { attempt, patches: () => patches };
  }
  async function answerBoth(page: Page) {
    await page.getByRole('textbox', { name: 'Your answer' }).fill('first');
    await page.clock.runFor(700);
    await page.getByRole('button', { name: 'Next question' }).click();
    await page.getByRole('textbox', { name: 'Your answer' }).fill('second');
  }
  async function submit(page: Page) {
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm submission' }).click();
  }
  test('stalled save retries newer answers and permits submission', async ({ page }) => {
    const state = await setup(page, 'stall');
    await answerBoth(page);
    await expect.poll(state.patches).toBe(1);
    await page.clock.runFor(30000);
    await expect(page.getByRole('status').first()).toHaveText('Save failed');
    await page.getByRole('button', { name: 'Retry saving' }).click();
    await expect.poll(() => state.attempt.answers).toEqual({ '1': 'first', '2': 'second' });
    await submit(page);
    await expect.poll(() => state.attempt.status).toBe('graded');
  });
  test('dropped committed save is reconciled before newer answers', async ({ page }) => {
    const state = await setup(page, 'committed');
    await answerBoth(page);
    await page.getByRole('button', { name: 'Retry saving' }).click();
    await expect.poll(() => state.attempt.answers).toEqual({ '1': 'first', '2': 'second' });
    await expect(page.getByRole('button', { name: 'Reload saved answers' })).toHaveCount(0);
  });
  test('committed save followed by 502 is reconciled before newer answers', async ({ page }) => {
    const state = await setup(page, 'committed-502');
    await answerBoth(page);
    await page.getByRole('button', { name: 'Retry saving' }).click();
    await expect.poll(() => state.attempt.answers).toEqual({ '1': 'first', '2': 'second' });
    await expect(page.getByRole('button', { name: 'Reload saved answers' })).toHaveCount(0);
  });
  test('submit during stalled save sends the latest answers', async ({ page }) => {
    const state = await setup(page, 'stall');
    await answerBoth(page);
    await expect.poll(state.patches).toBe(1);
    await submit(page);
    await page.clock.runFor(30000);
    await expect.poll(() => state.attempt.status).toBe('graded');
    expect(state.attempt.answers).toEqual({ '1': 'first', '2': 'second' });
  });
  for (const applied of [false, true]) {
    test(`retry reconciles ${applied ? 'a committed' : 'an unapplied'} submit after a 502`, async ({ page }) => {
      const state = await setup(page, 'normal');
      await answerBoth(page);
      await page.clock.runFor(700);
      await expect.poll(() => state.attempt.answers).toEqual({ '1': 'first', '2': 'second' });
      await expect(page.getByRole('status').first()).toHaveText('Answers saved automatically');
      const savedPatches = state.patches();

      const endpoint = '**/api/attempts/recovery/';
      async function failedSubmit(route: Route) {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        expect(body.answer_revision).toBe(state.attempt.answer_revision);
        expect(body.answers).toEqual(state.attempt.answers);
        if (applied) {
          state.attempt.answers = body.answers;
          state.attempt.answer_revision++;
          state.attempt.status = 'graded';
        }
        await route.fulfill({ status: 502, json: { detail: 'Gateway error' } });
      }
      await page.route(endpoint, failedSubmit);
      await submit(page);
      const dialog = page.getByRole('dialog', { name: 'Confirm submission' });
      await expect(dialog.getByRole('alert')).toContainText('Gateway error');
      await page.unroute(endpoint, failedSubmit);
      await dialog.getByRole('button', { name: 'Continue answering' }).click();
      await page.getByRole('button', { name: 'Retry saving' }).click();

      if (applied) {
        await expect(page.getByRole('heading', { name: 'Assessment completed' })).toBeVisible();
        await expect(page.locator('.result-celebration').getByRole('alert')).toHaveCount(0);
      } else {
        await expect(page.getByRole('status').first()).toHaveText('Answers saved automatically');
        await expect(page.locator('.attempt-status')).toBeHidden();
        expect(state.attempt.status).toBe('in_progress');
        await page.clock.runFor(5000);
        expect(state.patches()).toBe(savedPatches);
        await submit(page);
        await expect(page.getByRole('heading', { name: 'Assessment completed' })).toBeVisible();
      }
      expect(state.patches()).toBe(savedPatches);
    });
  }
  test('retry waits for a pending heartbeat before reconciling a submit', async ({ page }) => {
    const state = await setup(page, 'normal');
    await page.getByRole('textbox', { name: 'Your answer' }).fill('first');
    await page.clock.runFor(700);
    await expect(page.getByRole('status').first()).toHaveText('Answers saved automatically');
    const savedPatches = state.patches();
    const endpoint = '**/api/attempts/recovery/';
    async function failedSubmit(route: Route) {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({ status: 502, json: { detail: 'Gateway error' } });
    }
    await page.route(endpoint, failedSubmit);
    await submit(page);
    const dialog = page.getByRole('dialog', { name: 'Confirm submission' });
    await expect(dialog.getByRole('alert')).toContainText('Gateway error');
    await page.unroute(endpoint, failedSubmit);
    await dialog.getByRole('button', { name: 'Continue answering' }).click();

    let heartbeatStarted!: () => void, releaseHeartbeat!: () => void;
    const started = new Promise<void>(resolve => { heartbeatStarted = resolve; });
    const released = new Promise<void>(resolve => { releaseHeartbeat = resolve; });
    const heartbeatEndpoint = '**/api/attempts/recovery/heartbeat/';
    async function pendingHeartbeat(route: Route) {
      heartbeatStarted();
      await released;
      await route.fulfill({ json: { status: state.attempt.status, deadline: state.attempt.deadline,
        server_time: state.attempt.server_time, extra_time_minutes: 0 } });
    }
    await page.route(heartbeatEndpoint, pendingHeartbeat);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await started;
    await page.getByRole('button', { name: 'Retry saving' }).click();
    const response = page.waitForResponse(res => res.url().endsWith('/attempts/recovery/heartbeat/'));
    releaseHeartbeat();
    await response;
    await page.unroute(heartbeatEndpoint, pendingHeartbeat);
    await expect.poll(async () => {
      await page.clock.runFor(200);
      return page.getByRole('status').first().textContent();
    }).toBe('Answers saved automatically');
    await expect(page.locator('.attempt-status')).toBeHidden();
    expect(state.patches()).toBe(savedPatches);
  });
  test('completion after a heartbeat error clears the result alert', async ({ page }) => {
    const state = await setup(page, 'heartbeat');
    await page.clock.runFor(16000);
    await expect(page.locator('.attempt-status').getByRole('alert')).toBeVisible();
    state.attempt.status = 'graded';
    const endpoint = '**/api/attempts/recovery/heartbeat/';
    async function completedHeartbeat(route: Route) {
      await route.fulfill({ json: { status: state.attempt.status, deadline: state.attempt.deadline,
        server_time: state.attempt.server_time, extra_time_minutes: state.attempt.extra_time_minutes } });
    }
    await page.route(endpoint, completedHeartbeat);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('heading', { name: 'Assessment completed' })).toBeVisible();
    await expect(page.locator('.result-celebration').getByRole('alert')).toHaveCount(0);
    await page.unroute(endpoint, completedHeartbeat);
  });
  test('heartbeat error leaves question and navigation in place', async ({ page }) => {
    await setup(page, 'heartbeat');
    await expect(page.locator('.exam-timer > span')).toHaveText('Time remaining · +10 min');
    const question = page.locator('.question-paper'), navigation = page.locator('.question-navigation');
    const before = await question.boundingBox(), navBefore = await navigation.boundingBox();
    await page.clock.runFor(16000);
    const status = page.locator('.attempt-status');
    await expect(status.locator('.error')).toHaveText('The server could not be reached. Check your connection and try again.');
    expect(await question.boundingBox()).toEqual(before);
    expect(await navigation.boundingBox()).toEqual(navBefore);
    for (const [width, height] of [[390, 844], [768, 900], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      const caption = page.locator('.exam-timer > span');
      expect(await caption.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
      expect(await caption.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await caption.evaluate(el => el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right)).toBe(true);
      const box = (await status.boundingBox())!;
      for (const target of [page.locator('.exam-timer'), page.locator('.submit-fixed'), navigation]) {
        const other = (await target.boundingBox())!;
        expect(box.x + box.width <= other.x || other.x + other.width <= box.x ||
          box.y + box.height <= other.y || other.y + other.height <= box.y).toBe(true);
      }
      expect(await status.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return target !== null && el.contains(target);
      })).toBe(true);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const lastButton = page.locator('.question-paper-footer .btn').last();
      await expect(lastButton).toBeInViewport();
      const statusAtBottom = (await status.boundingBox())!, buttonAtBottom = (await lastButton.boundingBox())!;
      expect(statusAtBottom.x + statusAtBottom.width <= buttonAtBottom.x ||
        buttonAtBottom.x + buttonAtBottom.width <= statusAtBottom.x ||
        statusAtBottom.y + statusAtBottom.height <= buttonAtBottom.y ||
        buttonAtBottom.y + buttonAtBottom.height <= statusAtBottom.y).toBe(true);
    }
  });
  test('a long heartbeat error scrolls and leaves the last button reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, 'normal');
    const message = 'Timing service is unavailable. '.repeat(60).trim();
    const endpoint = '**/api/attempts/recovery/heartbeat/';
    async function longHeartbeatError(route: Route) {
      await route.fulfill({ status: 503, json: { detail: message } });
    }
    await page.route(endpoint, longHeartbeatError);
    await page.clock.runFor(16000);
    const status = page.locator('.attempt-status');
    await expect(status.getByRole('alert')).toHaveText(message);
    expect(await status.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await status.evaluate(el => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    })).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const box = (await status.boundingBox())!, lastButton = page.locator('.question-paper-footer .btn').last();
    await expect(lastButton).toBeInViewport();
    const button = (await lastButton.boundingBox())!;
    expect(box.x + box.width <= button.x || button.x + button.width <= box.x ||
      box.y + box.height <= button.y || button.y + button.height <= box.y).toBe(true);
    await page.unroute(endpoint, longHeartbeatError);
  });
}

export function examMessageTests(test: typeof import('@playwright/test').test) {
  async function setup(page: Page, manage: boolean, changes: Record<string, unknown> = {}) {
    const exam: Record<string, unknown> = {
      id: 42, title: 'Message test exam', description: '', courses: [], course_links: [],
      available_to_me: true, assignment_due_at: null, last_result: null, duration_minutes: 30,
      max_attempts: 2, retry_interval_minutes: 0, attempt_reset_minutes: 0, next_round_at: null,
      round_number: 1, round_attempts_used: 0, round_awaiting_grading: false, allow_skip: true,
      allow_response_review: true, next_attempt_at: null, server_time: new Date().toISOString(),
      pass_score: 70, published: true, starts_at: null, ends_at: null, question_count: 2,
      attempts_used: 0, effective_attempt_limit: 2, attempts_remaining: 2, active_attempt_id: null,
      audience: 'all', can_manage: manage, can_view_results: manage, ...changes,
    };
    const access = { courses: 'none', exams: manage ? 'all' : 'none', results: 'none', assign: false,
      invitations: false, system_admin: false, people: false, scorm_upload: false, scorm_source: false };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/session/')) return route.fulfill({ json: { languages: ['en'], user: {
        id: 1, username: 'tester', display_name: 'Tester', email: 'tester@example.com',
        role: manage ? 'exam_admin' : 'learner', access, employment: '', department: '', employee_id: null,
      } } });
      if (path.endsWith('/courses/')) return route.fulfill({ json: [] });
      if (path.endsWith('/exams/')) return route.fulfill({ json: [exam] });
      if (path.endsWith('/exams/42/')) return route.fulfill({ json: exam });
      return route.fulfill({ json: {} });
    });
    return exam;
  }
  test('monitor announces initial and subsequent errors without clipping them', async ({ page }) => {
    await page.clock.install();
    await setup(page, true);
    const endpoint = '**/api/exams/42/monitor/**';
    const message = 'The monitoring service is unavailable. '.repeat(30).trim();
    async function failedMonitor(route: Route) {
      await route.fulfill({ status: 503, json: { detail: message } });
    }
    await page.route(endpoint, failedMonitor);
    await page.goto((process.env.E2E_SUBPATH || '') + '/exams');
    await page.locator('summary[aria-label="More actions for Message test exam"]').click();
    await page.getByRole('button', { name: 'Live exam monitor' }).click();
    const monitor = page.getByRole('dialog', { name: 'Live exam monitor' });
    const heading = monitor.locator('.monitor-heading p');
    const initialError = monitor.locator('.exam-monitor > .error');
    await expect(initialError).toHaveText(message);
    await expect(initialError).toHaveAttribute('role', 'alert');
    const errorColor = await initialError.evaluate(el => getComputedStyle(el).color);
    await expect(heading).not.toHaveAttribute('role', 'alert');

    await page.unroute(endpoint, failedMonitor);
    async function successfulMonitor(route: Route) {
      await route.fulfill({ json: { exam: { id: 42, title: 'Message test exam' },
        server_time: new Date().toISOString(), count: 0, page: 1, pages: 1, results: [],
        summary: { total: 0, in_progress: 0, pending_review: 0, graded: 0, recent: 0 } } });
    }
    await page.route(endpoint, successfulMonitor);
    await monitor.getByRole('button', { name: 'Refresh', exact: true }).click();
    const stats = monitor.locator('.monitor-stats');
    await expect(stats).toBeVisible();
    const before = await stats.boundingBox();
    await page.unroute(endpoint, successfulMonitor);
    async function shortMonitorError(route: Route) {
      await route.fulfill({ status: 503, json: { detail: 'Unavailable.' } });
    }
    await page.route(endpoint, shortMonitorError);
    await page.clock.runFor(5000);
    await expect(heading).toHaveAttribute('role', 'alert');
    await expect(heading).toContainText('Unavailable.');
    expect(await stats.boundingBox()).toEqual(before);
    await page.unroute(endpoint, shortMonitorError);
    await page.route(endpoint, failedMonitor);
    await monitor.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(heading).toContainText(message);
    expect(await heading.evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth &&
      getComputedStyle(el).overflowY === 'visible')).toBe(true);
    expect(await heading.evaluate(el => getComputedStyle(el).color)).toBe(errorColor);
    expect(await heading.locator('svg').evaluate(el => getComputedStyle(el).flexShrink)).toBe('0');
    await page.unroute(endpoint, failedMonitor);
  });
  test('start and availability errors appear in their respective dialog regions', async ({ page }) => {
    await setup(page, false);
    const startEndpoint = '**/api/exams/42/start/';
    const startMessage = 'The attempt could not be started. '.repeat(20).trim();
    async function failedStart(route: Route) {
      await route.fulfill({ status: 502, json: { detail: startMessage } });
    }
    await page.route(startEndpoint, failedStart);
    await page.goto((process.env.E2E_SUBPATH || '') + '/exams?exam=42&action=start');
    const dialog = page.getByRole('dialog', { name: 'Ready to start?' });
    await dialog.getByRole('button', { name: 'Start / resume attempt' }).click();
    const alert = dialog.locator('.modal-form > .error');
    await expect(alert).toHaveText(startMessage);
    expect(await alert.evaluate(el => el.nextElementSibling?.classList.contains('modal-footer'))).toBe(true);
    expect(await alert.evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(dialog.locator('.preflight-availability').getByRole('alert')).toHaveCount(0);
    await page.unroute(startEndpoint, failedStart);

    const detailEndpoint = '**/api/exams/42/';
    async function failedPreflight(route: Route) {
      await route.fulfill({ status: 503, json: { detail: 'Availability could not be loaded.' } });
    }
    await page.route(detailEndpoint, failedPreflight);
    await dialog.getByRole('button', { name: 'Refresh availability' }).click();
    await expect(dialog.locator('.preflight-availability').getByRole('alert')).toHaveText('Availability could not be loaded.');
    await expect(dialog.locator('.modal-form > .error')).toHaveCount(0);
    await page.unroute(detailEndpoint, failedPreflight);
  });
  test('the start dialog shows the exam at once and keeps its buttons in place', async ({ page }) => {
    // A second attempt after a wait of one minute, on a clock the test moves. The dialog's own check answers
    // only when the test lets it.
    const now = new Date();
    await page.clock.install({ time: now });
    const exam = await setup(page, false, { retry_interval_minutes: 1, attempts_used: 1, round_attempts_used: 1,
      attempts_remaining: 1, next_attempt_at: new Date(now.getTime() + 60000).toISOString(), server_time: now.toISOString() });
    let answer = () => {};
    const hold = () => new Promise<void>(resolve => { answer = resolve; });
    let held = hold();
    await page.route('**/api/exams/42/', async route => {
      await held;
      await route.fulfill({ json: exam });
    });
    await page.goto((process.env.E2E_SUBPATH || '') + '/exams?exam=42&action=start');
    const dialog = page.getByRole('dialog', { name: 'Ready to start?' });
    const start = dialog.getByRole('button', { name: 'Start / resume attempt' });
    const card = dialog.locator('.exam-budget-info'), notice = dialog.locator('.retry-availability');
    const refresh = dialog.locator('button.text-btn');
    await expect(refresh).toHaveText('Checking availability…');
    await expect(card).toContainText('1 new attempt remaining');
    await expect(notice).toContainText(/Retry in \d+ sec/);
    await expect(start).toBeDisabled();
    const place = await start.boundingBox(), size = await notice.boundingBox();
    // No reserved blank area: the next row follows the card.
    expect((await refresh.boundingBox())!.y - (await card.boundingBox())!.y - (await card.boundingBox())!.height).toBeLessThan(40);
    answer();
    await expect(refresh).toHaveText('Refresh availability');
    expect(await start.boundingBox()).toEqual(place);

    // The wait ends: the notice keeps its lines, the button becomes usable where it is.
    await page.clock.runFor(61000);
    await expect(notice).toContainText('Ready');
    await expect(notice).toContainText('Next attempt available at');
    await expect(start).toBeEnabled();
    expect((await notice.boundingBox())!.height).toBe(size!.height);
    expect(await start.boundingBox()).toEqual(place);
    expect(await notice.evaluate(el => getComputedStyle(el).overflowY === 'visible' && el.scrollHeight <= el.clientHeight)).toBe(true);

    // A refresh keeps the card on screen while its answer is on the way.
    held = hold();
    await refresh.click();
    await expect(refresh).toHaveText('Checking availability…');
    await expect(card).toBeVisible();
    await expect(start).toBeDisabled();
    expect(await start.boundingBox()).toEqual(place);
    answer();
    await expect(start).toBeEnabled();
    expect(await start.boundingBox()).toEqual(place);
  });
}
