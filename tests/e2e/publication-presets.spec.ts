import { test, expect } from '@playwright/test';

test('publication preset demo renders and exports a PNG figure', async ({ page }) => {
  await page.goto('/demo/index.html');

  await page.getByRole('button', { name: /publication presets/i }).click();
  await expect(page.locator('[data-publication-status]')).toContainText('Ready', { timeout: 10000 });

  await page.getByRole('button', { name: /talk dark/i }).click();
  await expect(page.locator('[data-publication-status]')).toContainText('Talk Dark');

  const viewerShot = await page.locator('#viewer-slot').screenshot();
  expect(viewerShot.length).toBeGreaterThan(5000);

  const dataUrl = await page.evaluate(() => {
    const demo = (window as any).__surfviewPublicationDemo;
    if (!demo) return null;
    return demo.exportPNG();
  });

  expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(dataUrl!.length).toBeGreaterThan(10000);

  await page.getByRole('button', { name: /export png/i }).click();
  await expect(page.locator('[data-publication-status]')).toContainText(/PNG \d+ chars/);
});
