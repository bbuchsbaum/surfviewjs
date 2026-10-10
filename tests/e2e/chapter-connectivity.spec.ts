import { test, expect, Page } from '@playwright/test';

/** The Parcels & connectivity chapter: seed map, edges and topology lens on real Schaefer 400 parcels. */

test.use({ launchOptions: {
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ['--enable-unsafe-swiftshader']
} });

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

async function open(page: Page, id = 'connectivity') {
  await page.goto(`/demo/index.html?scenario=${id}`);
  await expect(page.locator('#status-text')).toContainText('Running: Parcels & connectivity', { timeout: 60000 });
  await expect(page.locator('#viewer-slot canvas')).toBeVisible();
}

const canvas = (page: Page) => page.locator('#viewer-slot canvas').first();

/** Wait for the film to show something different from `before`. */
async function expectChanged(page: Page, before: Buffer) {
  await expect.poll(async () => (await canvas(page).screenshot()).equals(before), { timeout: 10000 }).toBe(false);
}

async function setMode(page: Page, label: string) {
  await page.locator('#conn-mode').getByRole('radio', { name: label, exact: true }).check();
}

test.describe('Parcels & connectivity chapter', () => {
  test('opens from the chapter strip and from the old scenario ids', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/demo/index.html');
    await page.getByRole('button', { name: 'Parcels & connectivity', exact: true }).click();
    await expect(page.locator('#status-text')).toContainText('Running: Parcels & connectivity', { timeout: 60000 });
    await expect(page.locator('#active-synthetic')).toContainText('connectivity matrix is synthetic');
    for (const alias of ['parcel-connectivity', 'topologyLens']) {
      await open(page, alias);
    }
    await expect(page.locator('.film-corner-tl')).toContainText('Schaefer 400');
    expect(errors).toEqual([]);
  });

  test('seed map follows hover, locks on click or from the matrix, and responds to its controls', async ({ page }) => {
    test.setTimeout(90000);
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await expect(page.locator('#conn-locked')).toHaveText('—');

    const box = (await canvas(page).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await expect(page.locator('.film-corner-br [data-key="hover"]')).not.toContainText('—');
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await expect(page.locator('#conn-locked')).not.toHaveText('—');
    await expect(page.locator('#conn-partner')).not.toHaveText('—');

    await page.locator('#conn-parcel').selectOption('8');
    await expect(page.locator('#conn-locked')).toHaveText('8 · Vis 8');
    await expect(page.locator('.film-corner-br')).toContainText('8 · Vis 8');
    await page.mouse.move(box.x + 4, box.y + 4);
    const locked = await canvas(page).screenshot();

    await page.locator('#conn-threshold').fill('0.9');
    await expect(page.locator('.film-corner-bl')).toContainText('0.90');
    await expectChanged(page, locked);
    const thresholded = await canvas(page).screenshot();
    await page.locator('#conn-threshold').fill('0');
    await page.locator('#conn-alpha').getByRole('radio', { name: 'By |r|', exact: true }).check();
    await expect(page.locator('.film-corner-bl')).toContainText('By |r|');
    await expectChanged(page, thresholded);
    const before = await canvas(page).screenshot();
    await page.locator('#conn-colormap').selectOption('seismic');
    await expect(page.locator('.film-corner-tr')).toContainText('Seismic');
    await expectChanged(page, before);

    // A matrix row locks that parcel; clicking it again releases the lock.
    const matrix = page.locator('.conn-matrix');
    await matrix.scrollIntoViewIfNeeded();
    const matrixBox = (await matrix.boundingBox())!;
    const rowY = matrixBox.y + ((4 + 150.5) / 204) * matrixBox.height;
    await page.mouse.click(matrixBox.x + matrixBox.width / 2, rowY);
    await expect(page.locator('#conn-locked')).toHaveText(/^151 · /);
    await page.mouse.click(matrixBox.x + matrixBox.width / 2, rowY);
    await expect(page.locator('#conn-locked')).toHaveText('—');

    await page.locator('#conn-parcel').selectOption('8');
    await page.getByRole('button', { name: 'Clear lock', exact: true }).click();
    await expect(page.locator('#conn-locked')).toHaveText('—');
    await expect(page.locator('#conn-parcel')).toHaveValue('');
    expect(errors).toEqual([]);
  });

  test('edges filter by weight, top N and the locked parcel, and switch between tubes and lines', async ({ page }) => {
    test.setTimeout(90000);
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await page.mouse.move(0, 0);
    const seed = await canvas(page).screenshot();
    await setMode(page, 'Edges');
    await expect(page.locator('.film-corner-tr')).toContainText('Edges');
    await expect(page.locator('#conn-edge-count')).toHaveText('150');
    await expect(page.locator('#conn-threshold')).toBeHidden();
    await expectChanged(page, seed);

    await page.locator('#conn-topn').fill('0');
    const all = Number((await page.locator('#conn-edge-count').textContent())!.replace(/,/g, ''));
    expect(all).toBeGreaterThan(150);
    await page.locator('#conn-edge-threshold').fill('0.8');
    const strong = Number((await page.locator('#conn-edge-count').textContent())!.replace(/,/g, ''));
    expect(strong).toBeGreaterThan(0);
    expect(strong).toBeLessThan(all);
    await expect(page.locator('.film-corner-bl')).toContainText('0.80');

    const tubes = await canvas(page).screenshot();
    await page.locator('#conn-render').getByRole('radio', { name: 'Lines', exact: true }).check();
    await expectChanged(page, tubes);

    await page.locator('#conn-edge-threshold').fill('0.5');
    await page.locator('#conn-parcel').selectOption('20');
    await page.getByLabel('Only edges of the locked parcel', { exact: true }).check();
    const own = Number((await page.locator('#conn-edge-count').textContent())!.replace(/,/g, ''));
    expect(own).toBeGreaterThan(0);
    expect(own).toBeLessThan(200);
    await page.getByRole('button', { name: 'Clear lock', exact: true }).click();
    await expect(page.locator('#conn-edge-count')).not.toHaveText(String(own));
    expect(errors).toEqual([]);
  });

  test('topology lens rings the locked parcel by hops and toggles tension and quality outlines', async ({ page }) => {
    test.setTimeout(90000);
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await page.mouse.move(0, 0);
    await setMode(page, 'Topology lens');
    await expect(page.locator('#conn-focus')).toContainText('(auto)');
    await expect(page.locator('.film-corner-bl')).toContainText('Hops');
    await page.locator('#conn-view').getByRole('radio', { name: 'Lateral', exact: true }).check();
    await page.locator('#conn-parcel').selectOption('40');
    await expect(page.locator('#conn-focus')).toHaveText(/^40 · /);
    await expect(page.locator('.film-corner-br')).toContainText('40 · ');
    await page.mouse.move(0, 0);
    const twoHops = await canvas(page).screenshot();
    await page.locator('#conn-hops').fill('4');
    await expect(page.locator('.film-corner-bl')).toContainText('4');
    await expectChanged(page, twoHops);
    const withTension = await canvas(page).screenshot();
    await page.getByLabel('Boundary tension (|Δ| across each border)', { exact: true }).uncheck();
    await expect(page.locator('.film-corner-bl')).toContainText('OFF');
    await expectChanged(page, withTension);
    const withQuality = await canvas(page).screenshot();
    await page.getByLabel('Outline parcels by quality', { exact: true }).uncheck();
    await expectChanged(page, withQuality);
    expect(errors).toEqual([]);
  });

  test('stays within a phone-width page', async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.locator('#conn-parcel').selectOption('120');
    for (const mode of ['Edges', 'Topology lens', 'Seed map']) {
      await setMode(page, mode);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
    expect(errors).toEqual([]);
  });
});
