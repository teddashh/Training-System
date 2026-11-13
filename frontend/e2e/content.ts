import { navigateArea, trainingMore } from "./navigation";
import { expect, type Page, type Browser } from '@playwright/test';
const url = (path: string) => (process.env.E2E_SUBPATH || '') + path;

export async function contentWorkflow(page: Page, browser: Browser) {
  // Create an interactive course and land in its editor without finding it again.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url('/authoring'));
  await expect(page.getByRole('button', { name: 'My learning', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start learning', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Training', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New training', exact: true })).toHaveClass(/primary/);
  await trainingMore(page, 'Create course');
  const directTitle = `Direct course ${Date.now()}`;
  await expect(page.getByRole('radio', { name: 'Interactive content', exact: true })).toBeChecked();
  await expect(page.getByLabel('Course category', { exact: true })).not.toBeVisible();
  await page.getByLabel('Course title', { exact: true }).fill(directTitle);
  await page.getByLabel('Course description', { exact: true }).fill('Case-insensitive search evidence');
  // Failed saves retain the form and cannot navigate to an uncreated course.
  const createUrl = '**' + url('/api/courses/');
  await page.route(createUrl, route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Please retry this save.' }) })
    : route.continue());
  await page.getByRole('button', { name: 'Create and edit', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Please retry this save.');
  await expect(page.getByLabel('Course title', { exact: true })).toHaveValue(directTitle);
  await page.unroute(createUrl);
  await page.getByRole('button', { name: 'Create and edit', exact: true }).click();
  await expect(page.getByLabel('Content title', { exact: true })).toHaveValue(directTitle);
  const directId = new URL(page.url()).searchParams.get('course');
  expect(directId).toMatch(/^[1-9]\d*$/);
  const direct = await (await page.request.get(url(`/api/courses/${directId}/`))).json();
  expect(direct.published).toBe(false);
  expect(direct.blocks).toEqual([]);
  expect(direct.enrolled_count).toBe(0);
  // A draft destination cannot silently fall back to another assignable course.
  await page.goto(url(`/assignments?action=assign&course=${directId}&report=1`));
  await expect(page.getByRole('alert')).toContainText('This course is unavailable for assignment.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(url(`/studio/?course=${directId}#/app`));
  await expect(page.getByLabel('Content title', { exact: true })).toHaveValue(directTitle);
  await expect(page.getByText(`Course: ${directTitle}`, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to courses', exact: false }).click();
  await page.getByLabel('Search courses', { exact: true }).fill('CASE-INSENSITIVE SEARCH EVIDENCE');
  const directRow = page.locator('.training-row').filter({ hasText: directTitle });
  await expect(directRow).toBeVisible();
  await expect(directRow.getByText('Draft', { exact: true })).toBeVisible();
  await page.getByLabel('Search courses', { exact: true }).fill('NO SUCH TRAINING ' + Date.now());
  await expect(page.getByText('No matching courses', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(directRow).toBeVisible();
  await navigateArea(page, 'My training', 'Catalog');
  await navigateArea(page, 'My training');
  await expect(page.getByRole('heading', { name: 'My training', exact: true })).toBeVisible();
  await navigateArea(page, 'Training');
  await expect(page.getByRole('heading', { name: 'Training', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Library', exact: true })).toHaveCount(0);
  await expect(directRow).toBeVisible();
  await directRow.getByLabel(`More actions for ${directTitle}`, { exact: true }).click();
  await expect(directRow.getByRole('button', { name: 'Upload SCORM', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(directRow.getByRole('button', { name: 'Upload SCORM', exact: true })).not.toBeVisible();
  await expect(directRow.getByLabel(`More actions for ${directTitle}`, { exact: true })).toBeFocused();
  await directRow.getByLabel(`More actions for ${directTitle}`, { exact: true }).click();
  await directRow.getByRole('button', { name: 'Upload SCORM', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Upload SCORM content', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(directRow.getByLabel(`More actions for ${directTitle}`, { exact: true })).toBeFocused();

  const csrf = (await page.context().cookies()).find(cookie => /^(?:__Host-)?training_csrf$/.test(cookie.name))!.value;
  const title = `Content workflow ${Date.now()}`;
  const text = 'Preserve plain text: <script>not executable</script> & company policy.';
  const created = await page.request.post(url('/api/courses/'), { headers: { 'X-CSRFToken': csrf }, data: {
    title, published: false, requires_approval: true, blocks: [{ type: 'text', text }],
  } });
  expect(created.ok()).toBeTruthy();
  const course = await created.json();
  await page.goto(url('/authoring'));
  const nativeRow = page.locator('.training-row').filter({ hasText: title });
  await nativeRow.getByLabel(`More actions for ${title}`, { exact: true }).click();
  await nativeRow.getByRole('button', { name: `Edit ${title} content`, exact: true }).click();
  await expect(page.getByRole('dialog', {name: 'Course settings', exact: true})).toBeVisible();
  await expect(page).toHaveURL(new RegExp(url('/authoring') + '$'));
  await expect(page.getByLabel('Block 1 content')).toHaveValue(text);
  await page.getByRole('dialog').getByRole('button', { name: 'Save course', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await (await page.request.get(url(`/api/courses/${course.id}/`))).json()).package).toBeNull();
  await nativeRow.getByLabel(`More actions for ${title}`, { exact: true }).click();
  await nativeRow.getByRole('link', { name: 'Open in Studio', exact: true }).click();
  await expect(page.getByLabel('Content title', { exact: true })).toHaveValue(title);
  await expect(page.locator('[contenteditable="true"]').filter({ hasText: text }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip tour', exact: true })).toHaveCount(0);
  const publishWidth = Number(process.env.UI_CAPTURE_WIDTH) || 390;
  await page.setViewportSize({ width: publishWidth, height: 900 });
  await page.getByRole('button', { name: 'Publish to course', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('combobox', { name: 'Course', exact: true })).toHaveValue(String(course.id));
  await expect(page.getByText('This course is a draft. Publishing content will not make it visible to learners.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Package format')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.UI_CAPTURE_DIR) await page.screenshot({ path: `${process.env.UI_CAPTURE_DIR}/publish-${publishWidth}.png` });
  const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === url(`/api/courses/${course.id}/upload/`) && response.request().method() === 'POST');
  await page.getByRole('region', { name: 'Publish to course', exact: true }).getByRole('button', { name: 'Publish to course', exact: true }).click();
  expect((await uploaded).status()).toBe(201);
  await expect(page.getByRole('status').filter({ hasText: 'The course is still a draft.' })).toBeVisible();
  const savedDraft = await (await page.request.get(url(`/api/courses/${course.id}/`))).json();
  expect(savedDraft.published).toBe(false);
  if (process.env.UI_CAPTURE_DIR) await page.screenshot({ path: `${process.env.UI_CAPTURE_DIR}/release-next-${publishWidth}.png` });
  // A failed release retains the uploaded source and offers an idempotent retry.
  const releaseUrl = '**' + url(`/api/courses/${course.id}/`);
  await page.route(releaseUrl, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
  await page.getByRole('button', { name: 'Make available to learners', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Content is saved.');
  await expect(page.getByRole('button', { name: 'Make available to learners', exact: true })).toBeEnabled();
  await page.unroute(releaseUrl);
  await page.getByRole('button', { name: 'Make available to learners', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Assign training', exact: true })).toBeVisible();
  const released = await (await page.request.get(url(`/api/courses/${course.id}/`))).json();
  expect(released.published).toBe(true);
  expect(released.requires_approval).toBe(true);
  expect(released.package.id).toBe(savedDraft.package.id);
  expect(released.enrolled_count).toBe(0);
  if (process.env.UI_CAPTURE_DIR) await page.screenshot({ path: `${process.env.UI_CAPTURE_DIR}/released-${publishWidth}.png` });
  await page.getByRole('link', { name: 'Assign training', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Training', { exact: true })).toHaveValue(String(course.id));
  await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Assign to', exact: true })).toHaveValue('people');
  const people = page.getByRole('dialog').getByRole('group', { name: 'Selected people (0)', exact: true });
  await expect(people).toBeVisible();
  await expect(people.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Email the people I assign', exact: true })).toBeChecked();
  await expect(page.getByRole('dialog').getByLabel('Due date (optional)')).not.toBeVisible();
  if (process.env.UI_CAPTURE_DIR) {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${process.env.UI_CAPTURE_DIR}/assign-next-${width}.png` });
    }
  }
  await page.getByRole('dialog').getByLabel('Alex Morgan', { exact: false }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Assign training', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Training assigned.' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: title })).toBeVisible();
  await page.goto(url('/authoring'));
  const publishedRow = page.locator('.training-row').filter({ hasText: title });
  await publishedRow.getByLabel(`More actions for ${title}`, { exact: true }).click();
  await publishedRow.getByRole('link', { name: `Edit ${title} content`, exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Content title', { exact: true }).fill(title + ' local revision');
  await page.getByRole('button', { name: /^(Save draft|Saved locally)$/ }).filter({ visible: true }).click();
  await expect(page.getByRole('button', { name: 'Saved locally', exact: true }).filter({ visible: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Content title', { exact: true })).toHaveValue(title + ' local revision');

  // A different browser must open the published source, not this browser's draft.
  const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: { cookies: await page.context().cookies(), origins: [] } });
  try {
    const editor = await fresh.newPage();
    await editor.goto(url(`/studio/?course=${course.id}#/app`));
    await expect(editor.getByLabel('Content title', { exact: true })).toHaveValue(title);
    await expect(editor.locator('[contenteditable="true"]').filter({ hasText: text }).first()).toBeVisible();
  } finally { await fresh.close(); }

  // A new project cannot accidentally inherit the previous course destination.
  await page.getByTitle('Content options', { exact: true }).filter({ visible: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Create content', exact: true }).click();
  await expect(page).not.toHaveURL(/[?&]course=/);
  await page.getByRole('button', { name: 'Publish to course', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('combobox', { name: 'Course', exact: true })).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Publish to course', exact: true }).getByRole('button', { name: 'Publish to course', exact: true })).toBeDisabled();
  const newCourse = page.waitForResponse(response => new URL(response.url()).pathname === url('/api/courses/') && response.request().method() === 'POST');
  await page.getByRole('region', { name: 'Publish to course', exact: true }).getByRole('button', { name: 'Create course', exact: true }).click();
  const newRecord = await (await newCourse).json();
  expect(newRecord.published).toBe(false);
  await expect(page.getByRole('combobox', { name: 'Course', exact: true })).toHaveValue(String(newRecord.id));
  const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const editor = await anonymous.newPage();
    await editor.goto(url(`/studio/?course=${course.id}#/app`));
    await expect(editor.getByRole('alert')).toHaveText('This course is unavailable or you do not have editing access.');
    await expect(editor.getByLabel('Content title', { exact: true })).toHaveCount(0);
  } finally { await anonymous.close(); }
  await page.goto(url('/'));
}
