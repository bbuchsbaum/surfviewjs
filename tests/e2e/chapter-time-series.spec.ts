import { test, expect } from '@playwright/test';

test.describe('Time series chapter', () => {
  test('opens without errors, plays, pauses, scrubs and stops', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/demo/index.html?scenario=temporal-playback');
    await expect(page.locator('#status-text')).toContainText('Running: Time series', { timeout: 30000 });
    const canvas = page.locator('#viewer-slot canvas').first();
    await expect(canvas).toBeVisible();
    // Opens inside the first visual block so the map is visible at rest.
    await expect(page.locator('#ts-frame')).toHaveText('17 / 100');
    await expect(page.locator('#ts-block')).toHaveText('visual');
    await expect(page.locator('.film-corner-bl')).toContainText('16.0 s');

    await page.locator('#ts-time').fill('14');
    await expect(page.locator('#ts-frame')).toHaveText('15 / 100');
    await expect(page.locator('#ts-block')).toHaveText('visual');
    await expect(page.locator('.film-corner-bl')).toContainText('14.0 s');

    const before = await canvas.screenshot();
    await page.locator('#ts-time').fill('34');
    await expect(page.locator('#ts-block')).toHaveText('motor');
    await page.waitForTimeout(150);
    expect((await canvas.screenshot()).equals(before)).toBe(false);

    const play = page.locator('#ts-play');
    await play.click();
    await expect(play).toHaveText('Pause');
    await expect(page.locator('#status-text')).toHaveText('Playing');
    const startFrame = await page.locator('#ts-frame').textContent();
    await expect(page.locator('#ts-frame')).not.toHaveText(startFrame ?? '', { timeout: 5000 });
    await play.click();
    await expect(play).toHaveText('Play');

    await page.locator('#ts-loop').getByRole('radio', { name: 'Bounce', exact: true }).check();
    await expect(page.locator('.film-corner-tr')).toContainText('Bounce');
    await page.locator('#ts-loop').getByRole('radio', { name: 'Hold at end', exact: true }).check();
    await expect(page.locator('.film-corner-tr')).toContainText('Hold at end');
    await page.locator('#ts-rate').fill('20');
    await expect(page.locator('.film-corner-tr')).toContainText('20×');

    await page.locator('#ts-stop').click();
    await expect(page.locator('#ts-frame')).toHaveText('1 / 100');
    await expect(page.locator('#status-text')).toHaveText('Stopped at 0 s');
    expect(errors).toEqual([]);
  });

  test('the margin plots a vertex time course with axes, and hovering changes the vertex', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/demo/index.html?scenario=time-series');
    await expect(page.locator('#status-text')).toContainText('Running: Time series', { timeout: 30000 });
    const canvas = page.locator('#viewer-slot canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Missing canvas bounding box');

    // Plotted at rest, in the margin (off the cortex), with a time axis in seconds.
    const trace = page.locator('#panel .ts-trace');
    await expect(trace.locator('canvas')).toBeVisible();
    await expect(trace).toContainText('time (s)');
    await expect(trace).toContainText('%');
    const caption = page.locator('#ts-trace-caption');
    await expect(caption).toContainText(/LH \d+ · % signal change/);
    const before = await caption.textContent();

    let changed = false;
    for (const [fx, fy] of [[0.5, 0.5], [0.4, 0.45], [0.6, 0.55], [0.45, 0.6], [0.55, 0.4]] as const) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 4 });
      await page.waitForTimeout(150);
      if ((await caption.textContent()) !== before) { changed = true; break; }
    }
    expect(changed).toBe(true);
    await expect(page.locator('.film-corner-br')).toContainText(/[LR]H \d+/);
    await expect(page.locator('.film-corner-br')).toContainText('%');
    expect(errors).toEqual([]);
  });
});
