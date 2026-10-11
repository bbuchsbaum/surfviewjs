import { test, expect, Page } from '@playwright/test';

/** Supersedes the "Hemisphere views" and "linked flatmap" blocks of the shared specs. */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

async function openAnatomy(page: Page, query = '') {
  await page.goto(`/demo/index.html?scenario=anatomy${query}`);
  await expect(page.locator('#status-text')).toContainText('Running: Anatomy & views', { timeout: 30000 });
}

async function openMode(page: Page, label: string) {
  await page.locator('#anatomy-mode').getByRole('radio', { name: label, exact: true }).check();
  await expect(page.locator('#viewer-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 30000 });
}

async function dragAcross(page: Page, selector: string, dx: number, dy: number) {
  const canvas = page.locator(selector);
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`Missing bounding box for ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('Anatomy & views chapter', () => {
  test('opens from the chapter strip and from the old scenario ids', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/demo/index.html');
    await page.getByRole('button', { name: 'Anatomy & views', exact: true }).click();
    await expect(page.locator('#status-text')).toContainText('Running: Anatomy & views', { timeout: 30000 });
    await expect(page.locator('#viewer-slot canvas')).toBeVisible();

    for (const alias of ['hemispheres', 'clipping', 'morphing']) {
      await page.goto(`/demo/index.html?scenario=${alias}`);
      await expect(page.locator('#status-text')).toContainText('Running: Anatomy & views', { timeout: 30000 });
    }
    await page.goto('/demo/index.html?scenario=linked-flatmap');
    await expect(page.locator('#status-text')).toContainText('Running: Anatomy & views', { timeout: 30000 });
    expect(errors).toEqual([]);
  });

  test('views: anatomical views, hemisphere choice and gap respond', async ({ page }) => {
    const errors = trackErrors(page);
    await openAnatomy(page);
    const canvas = page.locator('#viewer-slot canvas');
    await expect(canvas).toBeVisible();

    const separation = page.locator('#hemi-gap');
    const beforeGap = await canvas.screenshot();
    await separation.fill('40');
    await expect(separation).toHaveValue('40');
    await expect(page.locator('#perf-text')).toContainText('Gap 40 mm');
    await expect(page.locator('.film-corner-bl')).toContainText('40 mm');
    await page.waitForTimeout(150);
    expect((await canvas.screenshot()).equals(beforeGap)).toBe(false);

    const views = page.locator('#anatomy-view');
    for (const name of ['Medial', 'Dorsal', 'Ventral', 'Posterior', 'Lateral', 'Anterior']) {
      await views.getByRole('radio', { name, exact: true }).check();
      await expect(page.locator('#status-text')).toContainText(`View: ${name.toLowerCase()}`);
      await expect(page.locator('.film-corner-tr')).toContainText(name);
    }

    await page.locator('#anatomy-layout').getByRole('radio', { name: 'Left', exact: true }).check();
    await expect(page.locator('#status-text')).toContainText('Hemispheres: left');
    await expect(separation).toBeDisabled();
    await page.locator('#anatomy-layout').getByRole('radio', { name: 'Both', exact: true }).check();
    await expect(separation).toBeEnabled();

    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });

  test('views: camera responds to drag after a preset view', async ({ page }) => {
    await openAnatomy(page);
    await page.locator('#anatomy-view').getByRole('radio', { name: 'Posterior', exact: true }).check();
    const canvas = page.locator('#viewer-slot canvas');
    await page.waitForTimeout(150);
    const before = await canvas.screenshot();
    await dragAcross(page, '#viewer-slot canvas', 70, 50);
    await page.waitForTimeout(200);
    expect((await canvas.screenshot()).equals(before)).toBe(false);
  });

  test('clip: planes cut the surface and presets apply', async ({ page }) => {
    const errors = trackErrors(page);
    await openAnatomy(page);
    await openMode(page, 'Clip');
    await expect(page).toHaveURL(/mode=clip/);
    const canvas = page.locator('#viewer-slot canvas');
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(150);
    const before = await canvas.screenshot();

    await page.locator('#clip-y-enable').check();
    await page.locator('#clip-y-offset').fill('-10');
    await expect(page.locator('#status-text')).toContainText('Clip Y: keeps in front of y = −10');
    await expect(page.locator('.film-corner-bl')).toContainText('keeps in front of y = −10');
    await page.waitForTimeout(150);
    expect((await canvas.screenshot()).equals(before)).toBe(false);

    await page.locator('#clip-y-flip').check();
    await expect(page.locator('#status-text')).toContainText('Clip Y: keeps behind y = −10');

    await page.getByRole('button', { name: 'Left medial wall' }).click();
    await expect(page.locator('#status-text')).toContainText('Preset: left medial wall');
    await expect(page.locator('#clip-x-enable')).toBeChecked();
    await expect(page.locator('#clip-y-enable')).not.toBeChecked();

    await page.getByRole('button', { name: 'Clear planes' }).click();
    await expect(page.locator('#clip-x-enable')).not.toBeChecked();
    await expect(page.locator('.film-corner-bl')).toContainText('none');
    expect(errors).toEqual([]);
  });

  test('inflate: morph slider and stage buttons reshape the cortex', async ({ page }) => {
    const errors = trackErrors(page);
    await openAnatomy(page, '&mode=morph');
    await expect(page.locator('#anatomy-mode').getByRole('radio', { name: 'Inflate', exact: true })).toBeChecked();
    const canvas = page.locator('#viewer-slot canvas');
    await expect(canvas).toBeVisible();
    const inflation = page.locator('#anatomy-inflation');

    // Entering the mode shows an inflated cortex at once, with the slider and film agreeing.
    await expect(inflation).toHaveValue('1');
    await expect(page.locator('.film-corner-tr')).toContainText('Inflated');
    await expect(page.locator('.control-slider output[for="anatomy-inflation"]')).toHaveText('Inflated');
    await page.waitForTimeout(150);
    const opening = await canvas.screenshot();
    await inflation.fill('0');
    await expect(page.locator('.film-corner-tr')).toContainText('Folded');
    await page.waitForTimeout(150);
    const folded = await canvas.screenshot();
    expect(folded.equals(opening)).toBe(false);

    await inflation.fill('1');
    await expect(page.locator('.film-corner-tr')).toContainText('Inflated');
    await page.waitForTimeout(150);
    expect((await canvas.screenshot()).equals(folded)).toBe(false);

    await page.locator('#morph-duration').fill('200');
    await page.getByRole('button', { name: 'Very inflated' }).click();
    await expect(page.locator('#status-text')).toContainText('Shape: very inflated', { timeout: 5000 });
    await expect(page.locator('#anatomy-inflation')).toHaveValue('2');
    await page.getByRole('button', { name: 'Folded' }).click();
    await expect(page.locator('#status-text')).toContainText('Shape: folded', { timeout: 5000 });
    await expect(inflation).toHaveValue('0');

    // Taking the slider mid-transition stops the animation and frees the stage buttons.
    await page.locator('#morph-duration').fill('2400');
    await page.getByRole('button', { name: 'Very inflated' }).click();
    await expect(page.getByRole('button', { name: 'Folded' })).toBeDisabled();
    await inflation.fill('0.5');
    await expect(page.locator('.film-corner-tr')).toContainText('0.50');
    for (const name of ['Folded', 'Inflated', 'Very inflated']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
    }
    await page.waitForTimeout(2600);
    await expect(inflation).toHaveValue('0.5');
    await expect(page.locator('.film-corner-tr')).toContainText('0.50');
    await expect(page.locator('#status-text')).not.toContainText('Shape: very inflated');

    // Leaving and returning opens inflated again.
    await openMode(page, 'Views');
    await openMode(page, 'Inflate');
    await expect(inflation).toHaveValue('1');
    await expect(page.locator('.film-corner-tr')).toContainText('Inflated');
    expect(errors).toEqual([]);
  });

  test('flat map: linked views, seeded ROI, exports and clear', async ({ page }) => {
    const errors = trackErrors(page);
    await openAnatomy(page);
    await openMode(page, 'Flat map');

    await expect(page.locator('[data-visual-qa="linked-flatmap"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-linked-flatmap-status]')).toContainText(/Ready: \d+ linked vertices/);

    const flatmapCanvas = page.locator('[data-visual-qa="linked-flatmap-canvas"]');
    await expect(flatmapCanvas).toBeVisible();
    const beforeROI = await flatmapCanvas.screenshot();

    await page.getByRole('button', { name: 'Seed ROI' }).click();
    await expect(page.locator('[data-roi-status]')).toContainText(/ROI_1: \d+ vertices/);
    await expect(page.locator('[data-linked-flatmap-status]')).toContainText(/Selected vertex \d+/);
    await expect(page.locator('.film-corner-bl')).toContainText('1');
    expect((await flatmapCanvas.screenshot()).equals(beforeROI)).toBe(false);

    await page.getByRole('button', { name: 'SVG', exact: true }).click();
    await expect(page.locator('[data-roi-export]')).toContainText(/<svg/);
    await expect(page.locator('#roi-download')).toHaveAttribute('download', 'ROI_1.svg');

    await page.getByRole('button', { name: 'Label GIFTI' }).click();
    await expect(page.locator('[data-roi-export]')).toContainText(/GIFTI/);
    await expect(page.locator('#roi-download')).toHaveAttribute('download', 'ROI_1.label.gii');

    await page.getByRole('button', { name: 'Draw polygon' }).click();
    await expect(page.getByRole('button', { name: 'Draw polygon' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-roi-status]')).toHaveText('Drawing a polygon');

    await page.getByRole('button', { name: 'Clear ROIs' }).click();
    await expect(page.locator('[data-roi-status]')).toHaveText('No ROI');
    await expect(page.getByRole('button', { name: 'Draw polygon' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-roi-export]')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('flat map: a lasso drawn on the map creates an ROI', async ({ page }) => {
    const errors = trackErrors(page);
    await openAnatomy(page, '&mode=flatmap');
    const flatmapCanvas = page.locator('[data-visual-qa="linked-flatmap-canvas"]');
    await expect(flatmapCanvas).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Draw lasso' }).click();
    const box = await flatmapCanvas.boundingBox();
    if (!box) throw new Error('Missing flat map bounding box');
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = box.width * 0.12;
    await page.mouse.move(cx + r, cy);
    await page.mouse.down();
    for (let step = 1; step <= 16; step++) {
      const angle = (step / 16) * Math.PI * 2;
      await page.mouse.move(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    }
    await page.mouse.up();
    await expect(page.locator('[data-roi-status]')).toContainText(/ROI_1: \d+ vertices/);
    expect(errors).toEqual([]);
  });
});
