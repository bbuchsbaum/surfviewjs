import { expect, test, type Page } from '@playwright/test';

async function openLayers(page: Page, id = 'layers') {
  await page.goto(`/demo/index.html?scenario=${id}`);
  await expect(page.locator('#status-text')).toContainText('Running: Layers & thresholds', { timeout: 20_000 });
  await expect(page.locator('#viewer-slot canvas')).toBeVisible();
}

test.describe('Layers & thresholds chapter', () => {
  test('layer stack can be reordered, removed, cleared and restored', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openLayers(page);

    const perf = page.locator('#perf-text');
    const stack = page.locator('#layers-stack');
    const tr = page.locator('.film-corner-tr');
    await expect(perf).toContainText('CPU compositing · 3 overlays · static');
    await expect(stack).toHaveText('Func › Activation › Tint › curvature');
    await expect(tr).toContainText('Func isoline');

    // Raise the RGBA tint to the top: the threshold isoline has no data layer to follow.
    await page.locator('#layers-edit').selectOption('tint');
    await expect(page.locator('#layers-threshold')).toBeDisabled();
    await page.locator('#layers-raise').click();
    await expect(stack).toHaveText('Func › Tint › Activation › curvature');
    await page.locator('#layers-raise').click();
    await expect(stack).toHaveText('Tint › Func › Activation › curvature');
    await expect(page.locator('#layers-raise')).toBeDisabled();
    await expect(tr).toContainText('none (top is not a data layer)');

    // The additive activation on top also disables edges.
    await page.locator('#layers-edit').selectOption('activation');
    await page.locator('#layers-raise').click();
    await page.locator('#layers-raise').click();
    await expect(stack).toHaveText('Activation › Tint › Func › curvature');
    await expect(tr).toContainText('none (Activation is additive)');

    // Take one layer out of the stack, then everything, then restore.
    await page.locator('#layers-in-stack').uncheck();
    await expect(perf).toContainText('2 overlays');
    await expect(stack).toHaveText('Tint › Func › curvature');
    await page.locator('#layers-in-stack').check();
    await expect(perf).toContainText('3 overlays');
    await page.locator('#layers-clear').click();
    await expect(perf).toContainText('0 overlays');
    await expect(stack).toHaveText('underlay only');
    await expect(page.locator('#status-text')).toContainText('Overlays removed');
    await page.locator('#layers-restore').click();
    await expect(perf).toContainText('3 overlays');
    await expect(stack).toHaveText('Func › Activation › Tint › curvature');
    expect(errors).toEqual([]);
  });

  test('threshold, opacity and edge shading change the rendered film', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openLayers(page);
    const canvas = page.locator('#viewer-slot canvas');
    await page.waitForTimeout(300);
    const initial = await canvas.screenshot();

    await page.locator('#layers-threshold').fill('0.4');
    await expect(page.locator('.film-corner-bl')).toContainText('±0.40');
    await page.waitForTimeout(200);
    const thresholded = await canvas.screenshot();
    expect(thresholded.equals(initial)).toBe(false);

    await page.locator('#layers-outline').fill('4');
    await page.locator('#layers-outline-shade').fill('0');
    await page.waitForTimeout(200);
    const outlined = await canvas.screenshot();
    expect(outlined.equals(thresholded)).toBe(false);

    await page.locator('#layers-curvature').uncheck();
    await expect(page.locator('.film-corner-tl')).toContainText('base colour');
    await page.waitForTimeout(200);
    expect((await canvas.screenshot()).equals(outlined)).toBe(false);
    expect(errors).toEqual([]);
  });

  test('CPU and GPU compositing both animate with a live frame rate and stop cleanly', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openLayers(page, 'gpu-compositing');
    const perf = page.locator('#perf-text');

    await page.locator('#layers-animate').check();
    await expect(page.locator('#status-text')).toContainText('Animating');
    await expect(perf).toContainText(/CPU compositing · 3 overlays · [1-9]\d* fps · \d+\.\d ms\/composite/, { timeout: 5_000 });

    await page.getByRole('radio', { name: 'GPU (WebGL2)' }).check();
    await expect(page.locator('#status-text')).toContainText('Switched compositing to GPU');
    await expect(page.locator('.film-corner-tr')).toContainText('per vertex (GPU)');
    await expect(perf).toContainText(/GPU compositing · 3 overlays · [1-9]\d* fps/, { timeout: 5_000 });

    await page.locator('#layers-animate').uncheck();
    await expect(page.locator('#status-text')).toContainText('Animation stopped');
    await expect(perf).toContainText('GPU compositing · 3 overlays · static');
    await page.waitForTimeout(250);
    await expect(perf).toContainText('static');

    await page.getByRole('radio', { name: 'CPU' }).check();
    await expect(perf).toContainText('CPU compositing · 3 overlays · static');

    await page.getByRole('button', { name: 'First look' }).click();
    await expect(page.locator('#status-text')).toContainText('Running: First look');
    expect(errors).toEqual([]);
  });

  test('old scenario ids open the chapter', async ({ page }) => {
    for (const id of ['multilayer', 'curvature', 'fslr-func']) {
      await openLayers(page, id);
      await expect(page.locator('#perf-text')).toContainText('3 overlays');
    }
  });
});
