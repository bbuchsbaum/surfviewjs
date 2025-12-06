import { test, expect } from '@playwright/test';

test('loads gzip-base64 gifti and renders', async ({ page }) => {
  await page.goto('/tests/test-gifti.html');

  // Click the new gzip surface button
  await page.getByRole('button', { name: /GZip Base64 Surface/i }).click();

  // Wait for canvas and some stats text to appear
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 10000 });

  // A small tetrahedron should render quickly; ensure no error message is shown
  await expect(page.locator('text=Error')).toHaveCount(0);
});
