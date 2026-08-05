import { test, expect } from '@playwright/test';

test.describe('Surface rendering flows', () => {
  test('renders the quickstart base surface', async ({ page }) => {
    await page.goto('/demo/index.html');

    await expect(page.locator('canvas')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#active-title')).toContainText('Quick start viewer');
    await expect(page.locator('#status-text')).toContainText('Running: Quick start viewer');
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

  test('supports RGBA and data layers in the multi-layer demo', async ({ page }) => {
    await page.goto('/demo/index.html');
    await page.getByRole('button', { name: /Multi-layer \+ compositing/i }).click();
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#status-text')).toContainText('Running: Multi-layer');

    await page.getByRole('button', { name: /Add RGBA layer/i }).click();
    await expect(page.locator('#status-text')).toContainText('Added RGBA gradient layer');
    await page.getByRole('button', { name: /Add activation/i }).click();
    await expect(page.locator('#perf-text')).toContainText(/Layers: 3/);
  });
});
