import { expect, type Page } from '@playwright/test';

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
