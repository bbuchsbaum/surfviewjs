import { test, expect } from '@playwright/test';

test('loads gifti test page and renders a canvas', async ({ page }) => {
  await page.goto('/tests/test-gifti.html');

  // Wait for viewer canvas to appear
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 10000 });

  // Ensure no fallback error message is shown
  await expect(page.locator('text=WebGL is not available')).toHaveCount(0);
});
