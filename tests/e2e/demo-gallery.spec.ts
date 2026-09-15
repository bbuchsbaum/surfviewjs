import { test, expect, type Page } from '@playwright/test';

test.use({ launchOptions: {
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ['--enable-unsafe-swiftshader']
} });

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('gallery opens the featured Glasser puzzle and full-width 2D map, then cleans up on reset and navigation', async ({ page }) => {
  test.setTimeout(90000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1500, height: 940 });
  await page.goto('/demo/');

  const featured = page.locator('.scenario-btn-featured');
  await expect(featured).toHaveCount(3);
  await expect(featured.filter({ hasText: 'Glasser atlas plates' })).toBeVisible();
  await expect(featured.filter({ hasText: 'Glasser parcel puzzle' })).toBeVisible();
  await expect(featured.filter({ hasText: '2D parcel map laboratory' })).toBeVisible();

  await featured.filter({ hasText: 'Glasser parcel puzzle' }).click();
  await expect(page).toHaveURL(/scenario=parcel-puzzle/);
  await expect(page).toHaveURL(/atlas=glasser/);
  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('glasser');
  await expect(page.getByLabel('Inspect a parcel', { exact: true }).locator('option')).toHaveCount(181);

  const firstPuzzle = await page.locator('.sv-parcel-puzzle').elementHandle();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('glasser');
  expect(await firstPuzzle!.evaluate(element => element.isConnected)).toBe(false);
  await expect(page.locator('.sv-parcel-puzzle')).toHaveCount(1);

  await page.getByLabel('Puzzle atlas', { exact: true }).selectOption('schaefer400-7');
  await expect(page).toHaveURL(/atlas=schaefer400-7/);
  await expect(page.getByLabel('Inspect a parcel', { exact: true }).locator('option')).toHaveCount(201);
  await expect(page.locator('.scenario-btn-featured').filter({ hasText: 'Glasser parcel puzzle' })).not.toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('schaefer400-7');
  await page.reload();
  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('schaefer400-7');

  await page.locator('.scenario-btn-featured').filter({ hasText: '2D parcel map laboratory' }).click();
  const map = page.locator('.parcel-map-lab');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(map).toHaveAttribute('data-dataset', 'glasser');
  await expect(page.getByLabel('Map dataset', { exact: true })).toHaveValue('glasser');
  await expect(page.locator('.workspace')).toHaveAttribute('data-layout', 'wide');
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.getByLabel('Map experiment controls', { exact: true })).toBeVisible();
  const mapBox = await map.boundingBox();
  expect(mapBox!.width).toBeGreaterThan(900);

  const oldMap = await map.elementHandle();
  await page.locator('.scenario-btn:not(.scenario-btn-featured)[data-id="quickstart"]').click();
  await expect(page.locator('[data-scenario-host="quickstart"] canvas')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.workspace')).toHaveAttribute('data-layout', 'standard');
  await expect(page.locator('#panel')).toBeVisible();
  expect(await oldMap!.evaluate(element => element.isConnected)).toBe(false);
  await expect(page.locator('.parcel-map-lab')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('featured parcel tools remain keyboard accessible without horizontal page overflow on a small screen', async ({ page }) => {
  test.setTimeout(90000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/?scenario=parcel-puzzle&atlas=glasser');
  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.nav')).toBeVisible();
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('glasser');

  const search = page.getByLabel('Search demonstrations', { exact: true });
  await search.focus();
  const focusStyle = await search.evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.style).not.toBe('none');
  expect(focusStyle.width).toBeGreaterThanOrEqual(2);

  await page.reload();
  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('glasser');
  await search.fill('flatmap');
  await expect(page.locator('.scenario-btn[data-id="parcel-map-lab"]')).toHaveCount(2);
  await search.clear();

  const labButton = page.locator('.scenario-btn-featured').filter({ hasText: '2D parcel map laboratory' });
  await labButton.scrollIntoViewIfNeeded();
  await labButton.focus();
  await page.keyboard.press('Enter');
  const map = page.locator('.parcel-map-lab');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(map).toHaveAttribute('data-dataset', 'glasser');
  await expect(page.getByLabel('Map experiment controls', { exact: true })).toBeVisible();
  await expect(page.locator('#panel')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.goBack();
  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('glasser');
  await page.goForward();
  await expect(page.locator('.parcel-map-lab[data-ready="true"]')).toHaveAttribute('data-dataset', 'glasser', { timeout: 30000 });

  await page.evaluate(() => {
    (document.querySelector('.scenario-btn-featured[data-id="parcel-puzzle"]') as HTMLButtonElement).click();
    (document.querySelector('.scenario-btn:not(.scenario-btn-featured)[data-id="quickstart"]') as HTMLButtonElement).click();
  });
  await expect(page.locator('[data-scenario-host="quickstart"] canvas')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.sv-parcel-puzzle')).toHaveCount(0);
  await expect(page.locator('.parcel-map-lab')).toHaveCount(0);
  expect(errors).toEqual([]);
});
