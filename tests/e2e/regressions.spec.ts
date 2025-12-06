import { test, expect } from '@playwright/test';

test('hemisphere views load and controls respond', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/test-hemisphere-views.html');
  await expect(page.locator('canvas')).toBeVisible({ timeout: 15000 });

  // Change separation and toggle wireframe
  const separation = page.locator('#sep');
  await separation.fill('40');
  await expect(separation).toHaveValue('40');

  await page.getByRole('button', { name: /Medial/i }).click();
  await page.getByRole('button', { name: /Anterior/i }).click();
  await page.locator('#wire').check();

  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});

test('GPU compositing toggle updates mode and layer counts', async ({ page }) => {
  await page.goto('/test-gpu-compositing.html');
  await expect(page.locator('canvas')).toBeVisible({ timeout: 15000 });

  const mode = page.locator('#mode');
  await expect(mode).toHaveText(/CPU/i);

  await page.locator('#toggleMode').click();
  await expect(mode).toHaveText(/GPU/i, { timeout: 5000 });

  const layers = page.locator('#layers');
  const initialLayers = Number(await layers.textContent());

  await page.locator('#addLayer').click();
  await expect(layers).toHaveText(String(initialLayers + 1));

  await page.locator('#removeLayer').click();
  await expect(layers).toHaveText(String(initialLayers));
});

test('layer opacity and visibility can be adjusted', async ({ page }) => {
  await page.goto('/demo-multilayer.html');

  await page.getByRole('button', { name: /Load Demo Surface/i }).click();
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /Add RGBA Layer/i }).click();
  await page.getByRole('button', { name: /Add Data Layer/i }).click();

  const layers = page.locator('#layer-list .layer-control');
  await expect(layers).toHaveCount(2, { timeout: 5000 });

  const opacitySlider = layers.first().locator('input[type="range"]');
  await opacitySlider.fill('50');
  await expect(opacitySlider).toHaveValue('50');

  const toggleButton = layers.first().getByRole('button', { name: /Hide|Show/ });
  await toggleButton.click();
  await expect(toggleButton).toHaveText(/Hide|Show/);

  await layers.nth(1).getByRole('button', { name: /Remove/i }).click();
  await expect(layers).toHaveCount(1, { timeout: 2000 });
});

test('natural controls respond to drag on comparison page', async ({ page }) => {
  await page.goto('/test-natural-controls.html');
  const rightCanvas = page.locator('#viewer2-container canvas');
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

test('natural rotation page reacts to drag', async ({ page }) => {
  await page.goto('/test-natural-rotation.html');
  const canvas = page.locator('canvas');
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
