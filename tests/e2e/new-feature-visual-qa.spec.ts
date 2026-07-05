import { test, expect, Page } from '@playwright/test';

async function openDemoScenario(page: Page, name: RegExp): Promise<void> {
  await page.goto('/demo/index.html');
  await page.getByRole('button', { name }).click();
}

function parseOutOfBounds(report: string): number {
  const match = report.match(/out-of-bounds:\s*([0-9.]+)/i);
  if (!match) throw new Error(`Missing out-of-bounds metric in report:\n${report}`);
  return Number(match[1]);
}

test.describe('new feature visual QA demos', () => {
  test('linked flatmap demo renders, seeds ROI, and exports ROI artifacts', async ({ page }) => {
    await openDemoScenario(page, /linked 3d and flatmap/i);

    await expect(page.locator('[data-visual-qa="linked-flatmap"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-linked-flatmap-status]')).toContainText(/Ready: \d+ linked vertices/);

    const flatmapCanvas = page.locator('[data-visual-qa="linked-flatmap-canvas"]');
    await expect(flatmapCanvas).toBeVisible();
    const beforeROI = await flatmapCanvas.screenshot();

    await page.getByRole('button', { name: /seed roi/i }).click();
    await expect(page.locator('[data-roi-status]')).toContainText(/ROI_1: \d+ vertices/);
    const afterROI = await flatmapCanvas.screenshot();
    expect(afterROI.equals(beforeROI)).toBe(false);

    await page.getByRole('button', { name: /^svg$/i }).click();
    await expect(page.locator('[data-roi-export]')).toContainText(/<svg/);

    await page.getByRole('button', { name: /label gifti/i }).click();
    await expect(page.locator('[data-roi-export]')).toContainText(/GIFTI/);

    await page.getByRole('button', { name: /clear/i }).click();
    await expect(page.locator('[data-roi-status]')).toHaveText('No ROI');
  });

  test('alignment QA demo renders all panels and exposes shifted-transform metrics', async ({ page }) => {
    await openDemoScenario(page, /alignment qa/i);

    await expect(page.locator('[data-visual-qa="alignment-qa"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-alignment-qa="workspace"]')).toBeVisible();
    await expect(page.locator('[data-alignment-qa-panel]')).toHaveCount(4);
    await expect(page.locator('[data-alignment-qa-canvas]')).toHaveCount(4);

    const report = page.locator('[data-alignment-qa-report="metrics"]');
    await expect(report).toContainText(/transform: anat-to-boldref/);
    const alignedReport = await report.textContent();
    const alignedOutOfBounds = parseOutOfBounds(alignedReport ?? '');
    const alignedShot = await page.locator('[data-alignment-qa="workspace"]').screenshot();
    expect(alignedShot.length).toBeGreaterThan(8000);

    await page.getByRole('button', { name: /shifted/i }).click();
    await expect(page.locator('[data-alignment-status]')).toContainText(/shifted/);
    await expect(report).toContainText(/anat-to-boldref-shifted/);
    const shiftedReport = await report.textContent();
    const shiftedOutOfBounds = parseOutOfBounds(shiftedReport ?? '');
    expect(shiftedOutOfBounds).toBeGreaterThan(alignedOutOfBounds);

    const shiftedShot = await page.locator('[data-alignment-qa="workspace"]').screenshot();
    expect(shiftedShot.equals(alignedShot)).toBe(false);
  });
});
