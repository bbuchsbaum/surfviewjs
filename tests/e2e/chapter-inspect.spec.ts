import { test, expect, Page } from '@playwright/test';

async function hoverCortex(page: Page): Promise<{ x: number; y: number }> {
  const canvas = page.locator('#viewer-slot canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas bounding box');
  for (const [fx, fy] of [[0.3, 0.5], [0.7, 0.5], [0.35, 0.45], [0.65, 0.55], [0.5, 0.5]] as const) {
    const point = { x: box.x + box.width * fx, y: box.y + box.height * fy };
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await page.waitForTimeout(120);
    if (/[LR]H \d+/.test((await page.locator('.film-corner-br').textContent()) ?? '')) return point;
  }
  throw new Error('No cortex under the probed points');
}

test.describe('Inspect & annotate chapter', () => {
  test('picks time each hover, and the picker can be switched', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/demo/index.html?scenario=gpupicking');
    await expect(page.locator('#status-text')).toContainText('Running: Inspect & annotate', { timeout: 30000 });

    await hoverCortex(page);
    await expect(page.locator('#inspect-pick-count')).not.toHaveText('0');
    await expect(page.locator('#inspect-pick-mean')).toContainText('ms');
    await expect(page.locator('.film-corner-br')).toContainText(/−?\d+\.\d{2} z/);
    await expect(page.locator('.film-corner-br')).toContainText('RAS');

    await page.locator('#inspect-picker').getByRole('radio', { name: 'CPU (raycast)' }).check();
    await expect(page.locator('#inspect-pick-count')).toHaveText('0');
    await expect(page.locator('.film-corner-tr')).toContainText('CPU (raycast)');
    await hoverCortex(page);
    await expect(page.locator('#inspect-pick-count')).not.toHaveText('0');
    await expect(page.locator('.film-corner-bl')).toContainText('CPU');
    expect(errors).toEqual([]);
  });

  test('clicks place labelled marks that can be selected, removed and cleared', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/demo/index.html?scenario=inspect');
    await expect(page.locator('#status-text')).toContainText('Running: Inspect & annotate', { timeout: 30000 });

    const marks = page.locator('#inspect-marks li');
    await expect(marks).toHaveCount(0);
    await expect(page.locator('#inspect-clear-marks')).toBeDisabled();

    await page.locator('#inspect-mark-label').fill('Peak');
    const first = await hoverCortex(page);
    await page.mouse.click(first.x, first.y);
    await expect(marks).toHaveCount(1);
    await expect(marks.first()).toContainText('Peak');
    await expect(page.locator('#status-text')).toContainText('Marked Peak');
    await expect(page.locator('#inspect-release')).toBeEnabled();
    await expect(page.locator('.film-corner-br')).toContainText('Marks');

    await page.mouse.click(first.x + 6, first.y + 4);
    await expect(marks).toHaveCount(2);
    await expect(marks.nth(1)).toContainText('M2');

    // A drag rotates the camera and must not place a mark.
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(first.x + 60, first.y + 30, { steps: 6 });
    await page.mouse.up();
    await expect(marks).toHaveCount(2);

    await page.getByRole('button', { name: 'Select Peak' }).click();
    await expect(marks.first()).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Remove Peak' }).click();
    await expect(marks).toHaveCount(1);

    await page.locator('#inspect-release').click();
    await expect(page.locator('#inspect-release')).toBeDisabled();

    await page.locator('#inspect-clear-marks').click();
    await expect(marks).toHaveCount(0);
    await expect(page.locator('#status-text')).toHaveText('Marks cleared');
    expect(errors).toEqual([]);
  });
});
