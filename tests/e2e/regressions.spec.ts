import { test, expect } from '@playwright/test';

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
