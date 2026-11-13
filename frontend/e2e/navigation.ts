import { expect, type Page } from '@playwright/test';

/** Exercise the sidebar and then the area's tabs, including the mobile drawer. */
export async function navigateArea(page: Page, area: string, tab?: string) {
  const sidebar = page.getByRole('navigation', {name: 'Main navigation', exact: true});
  const toggle = page.getByRole('button', {name: 'Open navigation', exact: true});
  if (await toggle.isVisible() && !(await page.locator('aside.sidebar').evaluate(node => node.classList.contains('open')))) {
    await page.getByRole('button', {name: 'Open navigation', exact: true}).click();
  }
  await sidebar.getByRole('link', {name: area, exact: true}).click();
  if (tab) await page.locator('.area-tabs').getByRole('link', {name: tab, exact: true}).click();
}
export async function moreOptions(page: Page) {
  const options = page.getByRole('dialog').last().locator('details.course-options').first();
  if (!(await options.evaluate(element => (element as HTMLDetailsElement).open))) await options.locator('summary').click();
  await expect(options).toHaveAttribute('open', '');
}
/** Less frequent creation entries on the Training list sit in one "More" menu next to New training. */
export async function trainingMore(page: Page, item: string) {
  await page.locator('.page-heading details.action-menu > summary').filter({hasText: 'More'}).click();
  await page.locator('.page-heading .course-more-panel').getByRole(item === 'Open Studio' ? 'link' : 'button', {name: item, exact: true}).click();
}
/** Opens a training row's menu (everything a row can do besides opening). */
export async function rowMenu(page: Page, title: string) {
  await page.locator('.training-row').filter({hasText: title}).getByLabel(`More actions for ${title}`, {exact: true}).click();
}

/** Secondary exam actions live in the row disclosure. */
export async function examAction(page: Page, title: string, action: string) {
  const row = page.locator('.exam-card').filter({has: page.getByRole('heading', {name: title, exact: true})});
  await row.locator('summary').click();
  await row.getByRole('button', {name: action, exact: true}).click();
}

export async function registrationActionLayout(page: Page) {
  const bar = page.locator('.registration-action-bar');
  const mobile = page.viewportSize()!.width < 768;
  await expect(bar).toHaveCSS('position', mobile ? 'fixed' : 'static');
  const last = page.locator('.registration-choices .session-card').last();
  // The fixed bar covers the bottom edge until the page is scrolled to its end; the page reserves that room.
  if (mobile) await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  else await last.scrollIntoViewIfNeeded();
  const bounds = (await bar.boundingBox())!, session = (await last.boundingBox())!;
  if (mobile) {
    expect(bounds.x).toBe(0);
    expect(bounds.width).toBe(page.viewportSize()!.width);
    expect(Math.round(bounds.y + bounds.height)).toBe(page.viewportSize()!.height);
    expect(session.y + session.height).toBeLessThanOrEqual(bounds.y);
  } else {
    expect(bounds.y).toBeGreaterThanOrEqual(session.y + session.height);
  }
}
