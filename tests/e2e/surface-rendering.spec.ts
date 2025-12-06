import { test, expect } from '@playwright/test';

test.describe('Surface rendering flows', () => {
  test('renders base layer info for a GIFTI surface', async ({ page }) => {
    await page.goto('/test-base-layer.html');

    await expect(page.locator('canvas')).toBeVisible({ timeout: 15000 });

    const info = page.locator('#info');
    await expect(info).toContainText('Base Layer Test', { timeout: 15000 });
    await expect(info).toContainText('Vertices');
    await expect(info).toContainText('Faces');
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
    await page.goto('/demo-multilayer.html');

    await page.getByRole('button', { name: /Load Demo Surface/i }).click();
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#layer-controls')).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /Add RGBA Layer/i }).click();
    await page.getByRole('button', { name: /Add Data Layer/i }).click();

    const layers = page.locator('#layer-list .layer-control');
    await expect(layers).toHaveCount(2, { timeout: 5000 });

    const toggleButton = layers.first().getByRole('button', { name: /Hide|Show/ });
    const initialLabel = await toggleButton.textContent();
    await toggleButton.click();

    if (initialLabel?.includes('Hide')) {
      await expect(toggleButton).toHaveText(/Show/);
    } else {
      await expect(toggleButton).toHaveText(/Hide/);
    }
  });
});
