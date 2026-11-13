import { expect, type Page } from '@playwright/test';
import { navigateArea, rowMenu } from './navigation';

const url = (path: string) => (process.env.E2E_SUBPATH || '') + path;

/** Runs in the existing organizer session; all records are synthetic. */
export async function trainingHomeWorkflow(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const csrf = (await page.context().cookies()).find(c => /^(?:__Host-)?training_csrf$/.test(c.name))!.value;
  const headers = { 'X-CSRFToken': csrf };
  const stamp = Date.now();
  const response = await page.request.post(url('/api/courses/'), { headers, data: {
    title: `Orbit workshop ${stamp}`, delivery_mode: 'scheduled', published: false,
    blocks: [{ type: 'text', text: 'A synthetic workshop lesson.' }],
  } });
  expect(response.status()).toBe(201);
  const course = await response.json();
  const home = url(`/authoring/${course.id}`);
  const row = page.locator('.training-row').filter({ has: page.getByRole('link', { name: course.title, exact: true }) });
  const settings = page.getByRole('dialog', { name: 'Course settings', exact: true });
  const people = page.locator('.training-tabs').getByRole('link', { name: 'People', exact: true });

  await page.goto(url('/authoring'));
  await rowMenu(page, course.title);
  await expect(row.getByRole('button', { name: 'People', exact: true })).toBeEnabled();
  await expect(row.getByRole('link', { name: 'Registration page', exact: true })).toHaveCount(0);
  await expect(row.getByRole('link', { name: 'Assign training', exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Enrollments', exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'Course settings', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(home + '\\?settings=1$'));
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(home + '$'));
  await expect(page.getByText('No sessions available.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add session', exact: true })).toBeVisible();

  // The header uses the same editor, without duplicate session or registration controls.
  await page.getByRole('button', { name: 'Course settings', exact: true }).click();
  await expect(settings.locator('.session-list')).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Add session', exact: true })).toHaveCount(0);
  await expect(settings.getByRole('link', { name: 'Open training page', exact: true })).toHaveCount(0);
  await expect(settings.getByText('Publish before scheduling or assigning.', { exact: true })).toHaveCount(0);
  await settings.locator('details.course-options > summary').click();
  await expect(settings.getByRole('heading', { name: 'Registration link', exact: true })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Show registration link', exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Close', exact: true }).click();

  await navigateArea(page, 'Training');
  await row.getByRole('link', { name: course.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(home + '$'));
  await expect(page.getByText('No sessions available.', { exact: true })).toBeVisible();
  await navigateArea(page, 'Training');
  await rowMenu(page, course.title);
  await row.getByRole('button', { name: `Edit ${course.title} content`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(home + '\\?settings=1$'));
  await expect(settings.getByLabel('Block 1 content', { exact: true })).toHaveValue('A synthetic workshop lesson.');
  await settings.getByRole('button', { name: 'Close', exact: true }).click();

  await navigateArea(page, 'Training');
  await rowMenu(page, course.title);
  await row.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(home + '\\?tab=people$'));
  await expect(people).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Assign training', exact: true })).toHaveCount(0);

  // Both legacy links replace their entry: Back must leave the training, even after closing settings.
  for (const action of ['edit', 'enrollments']) {
    await page.goto(url('/my-training'));
    await expect(page.getByRole('heading', { name: 'My training', exact: true })).toBeVisible();
    await page.goto(url(`/authoring?course=${course.id}&action=${action}`));
    if (action === 'edit') {
      await expect(page).toHaveURL(new RegExp(home + '\\?settings=1$'));
      await expect(settings).toBeVisible();
      await settings.getByRole('button', { name: 'Close', exact: true }).click();
    } else {
      await expect(page).toHaveURL(new RegExp(home + '\\?tab=people&status=pending$'));
      await expect(people).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('group', { name: 'Status', exact: true }).getByRole('button', { name: 'All 0', exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(url('/my-training') + '$'));
    await expect(page.getByRole('heading', { name: 'My training', exact: true })).toBeVisible();
  }

  await page.goto(home + '?settings=1');
  await settings.getByRole('button', { name: 'Publish course', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await navigateArea(page, 'Training');
  await rowMenu(page, course.title);
  await expect(row.getByRole('link', { name: 'Registration page', exact: true })).toHaveCount(0);
  await expect(row.getByRole('link', { name: 'Assign training', exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'People', exact: true }).click();
  const assign = page.getByRole('link', { name: 'Assign training', exact: true });
  await expect(assign).toHaveAttribute('href', url(`/assignments?action=assign&course=${course.id}&report=1`));
  await assign.click();
  await expect(page.getByRole('dialog').getByLabel('Training', { exact: true })).toHaveValue(String(course.id));

  await page.goto(home);
  const registration = page.getByRole('region', { name: 'Registration link', exact: true });
  await registration.getByRole('button', { name: 'Create link', exact: true }).click();
  const open = registration.getByRole('link', { name: 'Open page', exact: true });
  await expect(open).toBeVisible();
  const overview = await (await page.request.get(url(`/api/courses/${course.id}/training/`))).json();
  const link = new URL(overview.registration_url, page.url()).href;
  await expect(open).toHaveAttribute('href', link);
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  const popupPromise = page.waitForEvent('popup');
  await open.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(link);
  await expect(popup.getByRole('heading', { name: course.title, exact: true })).toBeVisible();
  await popup.close();
  await registration.getByLabel('More actions for Registration link', { exact: true }).click();
  page.once('dialog', async dialog => {
    expect(dialog.message()).toBe('Create a new registration link? The old link will stop working immediately.');
    await dialog.accept();
  });
  const rotation = page.waitForResponse(r => new URL(r.url()).pathname === url(`/api/courses/${course.id}/registration-link/`) && r.request().method() === 'POST');
  await registration.getByRole('button', { name: 'Create new link', exact: true }).click();
  const rotated = await rotation;
  expect(rotated.ok()).toBeTruthy();
  expect(rotated.request().postDataJSON()).toEqual({ rotate: true });
  const nextLink = new URL((await rotated.json()).url, page.url()).href;
  expect(nextLink).not.toBe(link);
  await expect(open).toHaveAttribute('href', nextLink);
  await expect(registration.getByRole('button', { name: 'Copy link', exact: true })).toHaveClass(/primary/);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Course settings', exact: true }).click();
  await settings.locator('details.course-options > summary').click();
  await expect(settings.getByRole('heading', { name: 'Registration link', exact: true })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Show registration link', exact: true })).toHaveCount(0);
  // Changing a saved training to self-paced leaves its training page.
  await settings.getByRole('combobox', { name: 'Course type', exact: true }).selectOption('self_paced');
  await settings.getByRole('button', { name: 'Save course', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(url('/authoring') + '$'));
  await rowMenu(page, course.title);
  await expect(row.getByRole('link', { name: 'Assign training', exact: true })).toHaveAttribute('href', url(`/assignments?action=assign&course=${course.id}&report=1`));
  await row.getByRole('button', { name: 'People', exact: true }).click();
  const enrollments = page.getByRole('dialog', { name: 'Manage enrollments', exact: true });
  await expect(enrollments).toBeVisible();
  await expect(page).toHaveURL(new RegExp(url('/authoring') + '$'));
  await enrollments.getByRole('button', { name: 'Close', exact: true }).first().click();

  const onsite = await page.request.post(url('/api/courses/'), { headers, data: {
    title: `Meadow event ${stamp}`, delivery_mode: 'scheduled', venue: 'onsite', published: false,
  } });
  expect(onsite.status()).toBe(201);
  const event = await onsite.json();
  await page.reload();
  await page.locator('.training-row').getByRole('link', { name: event.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(url(`/authoring/${event.id}`) + '$'));
  await expect(page.getByText('No sessions available.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add session', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add session', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
}
