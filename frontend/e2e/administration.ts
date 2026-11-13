import { expect, type Page, type Browser } from '@playwright/test';

const url = (path: string) => (process.env.E2E_SUBPATH || '') + path;
async function login(page: Page, identifier = 'admin@example.com', password = process.env.DEMO_PASSWORD || 'Demo-Training-2026!') {
  await page.goto(url('/'));
  await page.getByLabel('Email, username or employee ID').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in to workspace', exact: true }).click();
  await expect(page.locator('header.topbar')).toBeVisible();
}
async function post(page: Page, path: string, body: unknown) {
  const csrf = (await page.context().cookies()).find(c => /^(?:__Host-)?training_csrf$/.test(c.name))!.value;
  const response = await page.request.post(url('/api/' + path), { headers: { 'X-CSRFToken': csrf }, data: body });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function managementWorkflow(page: Page, browser: Browser) {
  const title = `Management course ${Date.now()}`;
  const username = `management-learner-${Date.now()}`;
  const password = 'Management-workflow-2026!';
  await post(page, 'users/', { username, display_name: username, role: 'learner', password });
  await page.goto(url('/admin/'));
  await expect(page).toHaveURL(new RegExp(url('/manage') + '$'));
  await expect(page.getByRole('heading', { name: 'Management center', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  await page.getByLabel('Course title', { exact: true }).fill(title);
  await page.getByRole('radio', { name: 'Text lesson', exact: true }).check();
  await page.getByLabel('Block 2 content').fill('Only approved participants can read this lesson.');
  await page.getByRole('dialog').locator('summary').filter({ hasText: 'More options' }).click();
  await page.getByLabel('Require approval').check();
  await page.getByRole('button', { name: 'Save course', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(url('/manage'));
  const draft = page.locator('.management-records li').filter({ hasText: title });
  await draft.getByRole('link', { name: 'Continue editing' }).click();
  await expect(page.getByLabel('Course title', { exact: true })).toHaveValue(title);
  await page.getByLabel('Visible to learners').check();
  await page.getByRole('button', { name: 'Save course', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const courses = await (await page.request.get(url('/api/courses/'))).json();
  const course = courses.find((item: { title: string }) => item.title === title);
  expect(course.enrolled_count).toBe(0); // Opening the editor must not enroll the administrator.
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const learner = await context.newPage();
    await login(learner, username, password);
    await learner.goto(url('/courses'));
    await learner.locator('.course-card').filter({ hasText: title }).getByRole('button', { name: 'Request enrollment', exact: true }).click();
    await learner.getByRole('dialog').getByRole('button', { name: 'Request enrollment', exact: true }).click();
    await expect(learner.getByRole('dialog').getByText('Awaiting approval', { exact: true })).toBeVisible();
    await page.goto(url('/manage'));
    await page.locator('.management-attention-item').filter({ hasText: title }).getByRole('link', { name: 'Review requests' }).click();
    const roster = page.getByRole('dialog');
    await expect(roster.getByText(username, { exact: true }).first()).toBeVisible();
    await roster.getByRole('button', { name: 'Approve enrollment', exact: true }).click();
    await roster.getByRole('button', { name: 'Save decision', exact: true }).click();
    await expect(roster.getByText('Enrollment decision saved.')).toBeVisible();
    await learner.reload();
    await learner.locator('.course-card').filter({ hasText: title }).getByRole('button', { name: 'Continue learning', exact: true }).click();
    await expect(learner.getByText('Only approved participants can read this lesson.', { exact: true })).toBeVisible();
    expect((await learner.request.get(url('/api/administration/'))).status()).toBe(403);
    await learner.goto(url('/manage'));
    await expect(learner.getByRole('heading', { name: 'Management center', exact: true })).toHaveCount(0);
    await page.goto(url('/manage'));
    await expect(page.locator('.management-attention-item').filter({ hasText: title })).toHaveCount(0);
    await page.getByRole('link', { name: 'Manage assignments', exact: true }).click();
    await expect(page.locator('.tabs button.active')).toContainText('Completion report');
  } finally { await context.close(); }
}

export async function peopleManagementWorkflow(page: Page) {
  const username = `management-person-${Date.now()}`;
  await post(page, 'users/', { username, display_name: username, role: 'learner' });
  await page.goto(url('/people'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Search people', { exact: true }).fill(username);
  const row = page.locator('.people-table tbody tr').filter({ hasText: username });
  await row.getByRole('button', { name: 'Edit person' }).click();
  await expect(page.getByLabel('System role').locator('option[value=instructor]')).toHaveCount(0);
  await page.getByLabel('System role').selectOption('course_creator');
  await expect(page.getByText('Course creators manage and schedule their own courses, link existing exams and assign their courses.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save person', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Filter people by role').selectOption('course_creator');
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(page.getByText('This person will lose access to training. Their courses, attempts and results will be retained.')).toBeVisible();
  await page.getByRole('button', { name: 'Disable account', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Filter people by status').selectOption('disabled');
  await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  const box = await row.getByRole('button', { name: 'Edit person' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.goto(url('/settings'));
  await page.getByLabel('Search activity').fill(username);
  await expect(page.locator('.management-activity').getByText('Updated a person', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.management-activity').getByRole('link', { name: username }).first()).toBeVisible();
  await expect(page.locator('.readiness-panel')).toHaveCount(0);
  await page.getByText('Advanced maintenance', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open data maintenance' })).toHaveAttribute('href', url('/admin/data/'));
  await expect(page.locator('.readiness-panel')).toBeVisible();
  await page.goto(url('/manage'));
  for (const [locale, title] of [['zh-TW', '管理中心'], ['es', 'Centro de administración'], ['en', 'Management center']]) {
    await page.locator('.topbar .language-picker select').selectOption(locale);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await organizationSettingsWorkflow(page);
}


async function organizationSettingsWorkflow(page: Page) {
  const context = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
  const original = await (await page.request.get(url('/api/settings/'))).json();
  const csrf = (await page.context().cookies()).find(c => /^(?:__Host-)?training_csrf$/.test(c.name))!.value;
  await page.setViewportSize({width: 1440, height: 900});
  try {
    await page.goto(url('/settings'));
    const organization = page.getByRole('region', {name: 'Organization', exact: true});
    await organization.getByRole('button', {name: 'Change', exact: true}).click();
    await page.getByLabel('Organization name', {exact: true}).fill('Cedar Learning');
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 8;
      const drawing = canvas.getContext('2d')!; drawing.fillStyle = 'white'; drawing.fillRect(0, 0, 16, 8);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.getByLabel('Logo', {exact: true}).setInputFiles({name: 'synthetic-logo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
    await page.getByRole('dialog').getByRole('button', {name: 'Save', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.sidebar .organization-name')).toHaveText('Cedar Learning');
    await expect(page.locator('.sidebar .brand-logo')).toHaveAttribute('src', /api\/organization\/logo\/[a-f0-9]{64}\//);
    const signin = page.getByRole('region', {name: 'Sign-in', exact: true});
    await signin.getByRole('button', {name: 'Change', exact: true}).click();
    await page.getByLabel('Provider', {exact: true}).selectOption('google');
    await page.getByLabel('Client ID', {exact: true}).fill('synthetic-browser-client');
    await page.getByLabel('Client secret', {exact: true}).fill('synthetic-browser-secret');
    await page.getByLabel('Workspace domains', {exact: true}).fill('example.com');
    await expect(page.getByLabel('Redirect URI', {exact: true})).toHaveValue(/api\/auth\/google\/callback\/$/);
    await page.getByRole('dialog').getByRole('button', {name: 'Save', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const email = page.getByRole('region', {name: 'Email', exact: true});
    await expect(email.getByText('Set by the server', {exact: true})).toBeVisible();
    await expect(email.getByRole('button', {name: 'Change', exact: true})).toHaveCount(0);
    const anonymous = await context.newPage();
    await anonymous.goto(url('/'));
    await expect(anonymous.getByRole('heading', {name: 'Cedar Learning Training', exact: true})).toBeVisible();
    await expect(anonymous.locator('.login-story .brand-logo')).toHaveAttribute('src', /api\/organization\/logo\//);
    await expect(anonymous.getByRole('link', {name: 'Sign in with Google'})).toBeVisible();
    await expect(anonymous.getByRole('link', {name: 'Sign in with Microsoft'})).toHaveCount(0);
    await expect(anonymous).toHaveTitle('Cedar Learning Training');
    await signin.getByRole('button', {name: 'Change', exact: true}).click();
    await expect(page.getByLabel('Client secret', {exact: true})).toHaveValue('');
    await expect(page.getByLabel('Client secret', {exact: true})).toHaveAttribute('placeholder', 'Saved');
    await page.getByLabel('Provider', {exact: true}).selectOption('none');
    await page.getByRole('dialog').getByRole('button', {name: 'Save', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await organization.getByRole('button', {name: 'Change', exact: true}).click();
    await page.getByRole('button', {name: 'Remove logo', exact: true}).click();
    await page.getByLabel('Organization name', {exact: true}).fill(original.organization.organization_name);
    await page.getByRole('dialog').getByRole('button', {name: 'Save', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await anonymous.reload();
    await expect(anonymous.getByRole('link', {name: 'Sign in with Google'})).toHaveCount(0);
    await expect(anonymous.locator('.login-story .brand-logo')).not.toHaveAttribute('src', /api\/organization\/logo\//);
  } finally {
    const headers = {'X-CSRFToken': csrf};
    await page.request.put(url('/api/settings/sign_in/'), {headers, data: {provider: 'none'}});
    await page.request.delete(url('/api/settings/logo/'), {headers});
    await page.request.put(url('/api/settings/organization/'), {headers, data: {organization_name: original.organization.organization_name}});
    await context.close();
    await page.setViewportSize({width: 390, height: 844});
  }
}
