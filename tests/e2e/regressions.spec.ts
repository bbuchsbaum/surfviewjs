import { test, expect } from '@playwright/test';

test('hemisphere views load and controls respond', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/demo/index.html');
  await page.getByRole('button', { name: /Hemisphere views/i }).click();
  await expect(page.locator('canvas')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#status-text')).toContainText('Running: Hemisphere views');

  const separation = page.locator('#hemi-gap');
  await separation.fill('40');
  await expect(separation).toHaveValue('40');

  await page.getByRole('button', { name: 'Medial', exact: true }).click();
  await page.getByRole('button', { name: 'Anterior', exact: true }).click();
  await expect(page.locator('#status-text')).toContainText('View: anterior');

  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});

test('GPU compositing toggle updates mode and layer counts', async ({ page }) => {
  await page.goto('/demo/index.html');
  await page.getByRole('button', { name: /Multi-layer \+ compositing/i }).click();
  await expect(page.locator('canvas')).toBeVisible({ timeout: 15000 });

  const perf = page.locator('#perf-text');
  await expect(perf).toContainText(/Layers: 2/);
  const beforeMode = await perf.textContent();
  await page.getByRole('button', { name: /Toggle GPU\/CPU/i }).click();
  await expect(perf).not.toHaveText(beforeMode ?? '');
  await page.getByRole('button', { name: /Add RGBA layer/i }).click();
  await expect(perf).toContainText(/Layers: 3/);
  await page.getByRole('button', { name: /Clear to base/i }).click();
  await expect(perf).toContainText(/Layers: 1/);
});

test('layer stack actions remain coherent', async ({ page }) => {
  await page.goto('/demo/index.html');
  await page.getByRole('button', { name: /Multi-layer \+ compositing/i }).click();
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /Add RGBA layer/i }).click();
  await page.getByRole('button', { name: /Add activation/i }).click();
  await expect(page.locator('#perf-text')).toContainText(/Layers: 3/);
  await page.getByRole('button', { name: /Clear to base/i }).click();
  await expect(page.locator('#status-text')).toContainText('Cleared layers');
});

test('interactive controls respond to drag', async ({ page }) => {
  await page.goto('/demo/index.html');
  const rightCanvas = page.locator('#viewer-slot canvas');
  await expect(rightCanvas).toBeVisible({ timeout: 15000 });

  const before = await rightCanvas.screenshot();
  const box = await rightCanvas.boundingBox();
  if (!box) throw new Error('Missing canvas bounding box');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 - 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await rightCanvas.screenshot();
  expect(after.equals(before)).toBe(false);
});

test('hemisphere view reacts to drag after preset selection', async ({ page }) => {
  await page.goto('/demo/index.html');
  await page.getByRole('button', { name: /Hemisphere views/i }).click();
  const canvas = page.locator('#viewer-slot canvas');
  await expect(canvas).toBeVisible({ timeout: 15000 });

  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas bounding box');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 50, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await canvas.screenshot();
  expect(after.equals(before)).toBe(false);
});

test('canvas resizes with viewport and stays visible', async ({ page }) => {
  await page.goto('/tests/test-gifti.html');
  await page.getByRole('button', { name: /Load ASCII Surface/i }).click();
  await expect(page.locator('#stats')).toContainText('Vertices', { timeout: 20000 });

  const canvas = page.locator('canvas');
  const sizeBefore = await canvas.evaluate((c) => ({ w: c.width, h: c.height, rectW: c.getBoundingClientRect().width }));

  await page.setViewportSize({ width: 900, height: 600 });
  await page.waitForTimeout(200);
  const sizeMid = await canvas.evaluate((c) => ({ w: c.width, h: c.height, rectW: c.getBoundingClientRect().width }));

  await page.setViewportSize({ width: 600, height: 400 });
  await page.waitForTimeout(200);
  const sizeAfter = await canvas.evaluate((c) => ({ w: c.width, h: c.height, rectW: c.getBoundingClientRect().width }));

  expect(sizeMid.w).not.toBe(sizeBefore.w);
  expect(sizeAfter.w).not.toBe(sizeMid.w);
  await expect(canvas).toBeVisible();
});

test('invalid local file shows error then recovers with valid surface', async ({ page }) => {
  await page.goto('/tests/test-gifti.html');

  await page.setInputFiles('input[type="file"]', {
    name: 'bad.gii',
    mimeType: 'application/xml',
    buffer: Buffer.from('not a valid gifti')
  });
  await page.getByRole('button', { name: /Load File/i }).click();
  await expect(page.locator('#message')).toHaveText(/Error/i, { timeout: 10000 });

  await page.getByRole('button', { name: /Load ASCII Surface/i }).click();
  await expect(page.locator('#stats')).toContainText('Vertices', { timeout: 20000 });
});
