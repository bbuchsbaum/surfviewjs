import { test, expect } from '@playwright/test';

test.describe('Surface rendering flows', () => {
  test('renders the default First look chapter', async ({ page }) => {
    await page.goto('/demo/index.html');

    await expect(page.locator('#viewer-slot canvas')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#active-title')).toHaveText('First look');
    await expect(page.locator('#status-text')).toHaveText('Running: First look', { timeout: 30000 });
  });

  test('adds a data layer on the GIFTI test page', async ({ page }) => {
    await page.goto('/tests/test-gifti.html');

    await page.getByRole('button', { name: /Load ASCII Surface/i }).click();

    const stats = page.locator('#stats');
    await expect(stats).toContainText('Vertices', { timeout: 20000 });
    await expect(stats).toContainText('Faces');

    await page.getByRole('button', { name: /Add Random Data Layer/i }).click();
    await expect(page.locator('#message')).toHaveText(/Added data layer/i, { timeout: 5000 });
  });
});
