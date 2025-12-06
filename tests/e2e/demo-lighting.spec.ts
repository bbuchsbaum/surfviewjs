import { test, expect } from '@playwright/test';

test('Lighting demo renders a frame', async ({ page }) => {
  await page.goto('/demo/index.html');

  // Select Lighting & materials scenario
  await page.getByRole('button', { name: /lighting & materials/i }).click();

  // Wait for canvas to be visible
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 10000 });

  // Wait a moment for first frame and grab a pixel
  await page.waitForTimeout(500);
  const pixel = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!(c instanceof HTMLCanvasElement)) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const data = ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return Array.from(data);
  });

  // Expect some non-zero content (not pure black)
  expect(pixel).not.toEqual([0, 0, 0, 0]);
});
