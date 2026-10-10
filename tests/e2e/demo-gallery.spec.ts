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

const chapter = (page: Page, title: string) =>
  page.getByRole('group', { name: /Surfaces|Atlases|Workflows/ }).getByRole('button', { name: title, exact: true });

/** Distinct colours in a canvas screenshot: a rendered brain has many, a blank film has one. */
async function distinctColours(page: Page, selector: string): Promise<number> {
  const png = await page.locator(selector).screenshot();
  return page.evaluate(async bytes => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 7) colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    return colours.size;
  }, [...png]);
}

test('opens First look by default with a rendered cortex, live film overlays and a public-API excerpt', async ({ page }) => {
  test.setTimeout(60000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/demo/');

  await expect(page.locator('#active-title')).toHaveText('First look');
  await expect(page.locator('#status-text')).toHaveText('Running: First look', { timeout: 30000 });
  await expect(page).toHaveURL(/scenario=first-look/);
  await expect(page.getByRole('group', { name: 'Surfaces' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Atlases' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Workflows' })).toBeVisible();
  await expect(page.locator('.frame')).toHaveCount(14);
  await expect(chapter(page, 'First look')).toHaveAttribute('aria-current', 'page');

  await expect(page.locator('#viewer-slot canvas')).toBeVisible();
  expect(await distinctColours(page, '#viewer-slot canvas')).toBeGreaterThan(40);
  await expect(page.locator('.film-corner-tl')).toContainText('fsaverage5');
  await expect(page.locator('.film-orient-left')).toHaveText('A');
  await expect(page.locator('.film-orient-right')).toHaveText('P');

  const threshold = page.getByLabel('Hide values within (±z)');
  await threshold.fill('3');
  await expect(page.locator('.film-corner-bl')).toContainText('±3.0');
  await page.getByRole('radio', { name: 'Medial' }).check();
  await expect(page.locator('.film-corner-tr')).toContainText('Medial');

  await expect(page.locator('#active-synthetic')).toContainText('not a result');
  await page.locator('#code-block summary').click();
  await expect(page.locator('#code-text')).toContainText("from 'surfview'");
  await expect(page.locator('#code-text')).not.toContainText('@src');
  expect(errors).toEqual([]);
});

test('old scenario ids open the chapter that absorbed them', async ({ page }) => {
  await page.goto('/demo/?scenario=quickstart');
  await expect(page.locator('#active-title')).toHaveText('First look');
  await expect(page).toHaveURL(/scenario=first-look/);
  await page.goto('/demo/?scenario=no-such-chapter');
  await expect(page.locator('#active-title')).toHaveText('First look');
});

test('opens the Glasser puzzle and the full-width map lab, then cleans up on reset and navigation', async ({ page }) => {
  test.setTimeout(90000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1500, height: 940 });
  await page.goto('/demo/?scenario=parcel-puzzle&atlas=glasser');

  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(chapter(page, 'Parcel puzzle')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('glasser');
  await expect(page.getByLabel('Inspect a parcel', { exact: true }).locator('option')).toHaveCount(181);

  const firstPuzzle = await page.locator('.sv-parcel-puzzle').elementHandle();
  await page.getByRole('button', { name: 'Reset chapter', exact: true }).click();
  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('glasser');
  expect(await firstPuzzle!.evaluate(element => element.isConnected)).toBe(false);
  await expect(page.locator('.sv-parcel-puzzle')).toHaveCount(1);

  await page.getByLabel('Puzzle atlas', { exact: true }).selectOption('schaefer400-7');
  await expect(page).toHaveURL(/atlas=schaefer400-7/);
  await expect(page.getByLabel('Inspect a parcel', { exact: true }).locator('option')).toHaveCount(201);
  await page.getByRole('button', { name: 'Reset chapter', exact: true }).click();
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('schaefer400-7');
  await page.reload();
  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('schaefer400-7');

  await chapter(page, 'Parcel map lab').click();
  await expect(page).toHaveURL(/scenario=parcel-map-lab/);
  await expect(page).not.toHaveURL(/atlas=/);
  const map = page.locator('.parcel-map-lab');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(page.locator('.workspace')).toHaveAttribute('data-layout', 'wide');
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.getByLabel('Map experiment controls', { exact: true })).toBeVisible();
  const mapBox = await map.boundingBox();
  expect(mapBox!.width).toBeGreaterThan(900);

  const oldMap = await map.elementHandle();
  await chapter(page, 'First look').click();
  await expect(page.locator('[data-scenario-host="first-look"] canvas')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.workspace')).toHaveAttribute('data-layout', 'standard');
  await expect(page.locator('#panel')).toBeVisible();
  expect(await oldMap!.evaluate(element => element.isConnected)).toBe(false);
  await expect(page.locator('.parcel-map-lab')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('chapters stay keyboard accessible without horizontal page overflow on a small screen', async ({ page }) => {
  test.setTimeout(90000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/?scenario=parcel-puzzle&atlas=glasser');
  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.nav')).toBeVisible();

  const lab = chapter(page, 'Parcel map lab');
  await lab.focus();
  const focusStyle = await lab.evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.style).not.toBe('none');
  expect(focusStyle.width).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Enter');

  const map = page.locator('.parcel-map-lab');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(page.getByLabel('Map experiment controls', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.goBack();
  await expect(page.locator('.sv-parcel-puzzle[data-ready="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Puzzle atlas', { exact: true })).toHaveValue('glasser');
  await page.goForward();
  await expect(page.locator('.parcel-map-lab[data-ready="true"]')).toBeVisible({ timeout: 30000 });

  // Rapid successive navigation must leave exactly the last chapter mounted.
  await page.evaluate(() => {
    (document.querySelector('.frame[data-id="parcel-puzzle"]') as HTMLButtonElement).click();
    (document.querySelector('.frame[data-id="first-look"]') as HTMLButtonElement).click();
  });
  await expect(page.locator('[data-scenario-host="first-look"] canvas')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.sv-parcel-puzzle')).toHaveCount(0);
  await expect(page.locator('.parcel-map-lab')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
