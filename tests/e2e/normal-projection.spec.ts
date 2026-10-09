import { test, expect } from '@playwright/test';

test('normal projection demo renders and recomputes ordinary vertex data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/demo/index.html');
  await page.getByRole('button', { name: /^Normal Volume Projection/ }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const result = page.locator('#normal-result');
  await expect(result).toContainText('5 samples; mean;');
  const counts = (await result.textContent())!.match(/([\d,]+) \/ ([\d,]+) vertices/)!;
  expect(Number(counts[1].replaceAll(',', ''))).toBeGreaterThan(1000);
  expect(counts[1]).toBe(counts[2]);
  const meanImage = await page.locator('canvas').screenshot();
  expect(meanImage.length).toBeGreaterThan(5000);
  await page.locator('#normal-reducer').selectOption('max-abs');
  await expect(result).toContainText('max-abs');
  const maxAbsImage = await page.locator('canvas').screenshot();
  expect(maxAbsImage.equals(meanImage)).toBe(false);
  await page.locator('#normal-steps').fill('1');
  await expect(result).toContainText('1 samples;');
  await page.locator('#normal-interpolation').selectOption('nearest');
  expect(errors).toEqual([]);
});
