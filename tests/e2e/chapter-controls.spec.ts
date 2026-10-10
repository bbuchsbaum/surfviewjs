import { expect, test, type Page } from '@playwright/test';

async function openControls(page: Page, query = ''): Promise<void> {
  await page.goto(`/demo/index.html?scenario=controls${query}`);
  await expect(page.locator('#status-text')).toHaveText('Running: Controls panel', { timeout: 20_000 });
}

test.describe('Controls panel chapter', () => {
  test('mounts the full panel over the bilateral scene in the lightbox theme', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openControls(page);
    const controls = page.locator('#panel surfview-controls');
    await expect(controls).toHaveCount(1);
    await expect(controls).toHaveAttribute('theme', 'dark');
    await expect(controls).toHaveAttribute('data-controls-task', 'full');

    // No QA fixture chrome in the public chapter.
    await expect(page.getByRole('button', { name: /^Fixture:/ })).toHaveCount(0);
    expect(await page.evaluate(() => '__surfviewControlsFixture' in window)).toBe(false);
    expect(await controls.evaluate(element => getComputedStyle(element).fontFamily)).toContain('Archivo');

    // Themed through public CSS custom properties: film tokens, square corners, chinagraph focus.
    const panel = controls.locator('.panel');
    await expect(panel).toHaveCSS('background-color', 'rgb(15, 23, 32)');
    await expect(panel).toHaveCSS('border-radius', '0px');
    expect(await controls.evaluate(element =>
      getComputedStyle(element).getPropertyValue('--surfview-controls-focus').trim()
    )).toBe('#f2c230');

    // Every first-party feature: views, both hemispheres' layer stacks, inspector, selection, figure.
    await expect(controls.getByRole('radio', { name: 'Lateral' })).toBeChecked();
    await expect(controls.locator('[data-surface-id="lh"] [data-layer-id="contrast"]')).toHaveCount(1);
    await expect(controls.locator('[data-surface-id="rh"] [data-layer-id="reliability"]')).toHaveCount(1);
    await expect(controls.locator('.selected-layer-section .selected-layer-title')).toHaveText('Synthetic contrast');
    await expect(controls.locator('.selection-section')).toHaveAttribute('data-empty', 'true');
    await expect(controls.locator('.figure-section')).toHaveCount(1);

    // Commands reach the viewer and print into the film.
    await controls.getByRole('radio', { name: 'Medial' }).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#viewer-frame')).toContainText(/View\s*medial/);
    // The chapter re-frames panel views (fitToView distance) without losing the view state.
    await expect(controls.getByRole('radio', { name: 'Medial' })).toBeChecked();
    const maskLow = controls.getByRole('spinbutton', { name: 'Synthetic contrast mask values between lower' });
    await maskLow.fill('-3');
    await maskLow.press('Enter');
    await expect(page.locator('#viewer-frame')).toContainText(/Masked\s*−3\.00 to 1\.65/);

    // Clicking the cortex selects a vertex; the panel and the film both report it.
    await controls.getByRole('radio', { name: 'Lateral' }).focus();
    await page.keyboard.press('Space');
    const canvas = page.locator('#viewer-slot canvas');
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(controls.locator('.selection-section')).toHaveAttribute('data-empty', 'false');
    await expect(page.locator('#viewer-frame')).toContainText(/Selected\s*(LH|RH) \d+/);

    // Page-token styling off: the component's own dark theme returns.
    await page.locator('#controls-page-tokens').uncheck();
    await expect(panel).toHaveCSS('background-color', 'rgb(18, 24, 32)');
    await page.locator('#controls-density').getByRole('radio', { name: 'Compact' }).check();
    await expect(controls).toHaveAttribute('density', 'compact');
  });

  test('product layer workflow: ?mode=product&task=layers', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openControls(page, '&mode=product&task=layers');
    const controls = page.locator('#panel surfview-controls');
    await expect(controls).toHaveAttribute('data-controls-task', 'layers');
    await expect(page.locator('#controls-task').getByRole('radio', { name: 'Layers', exact: true })).toBeChecked();
    await expect(controls.getByRole('radio')).toHaveCount(0);
    await expect(controls.locator('[data-surface-id="lh"] [data-layer-id]').first()).toBeVisible();
    await expect(controls.locator('[data-layer-id="contrast"]')).toHaveCount(2);
    await expect(controls.locator('.selected-layer-section')).toHaveCount(1);
    await expect(controls.locator('.figure-section')).toHaveCount(0);

    await page.locator('#controls-task').getByRole('radio', { name: 'View', exact: true }).check();
    await expect(controls).toHaveAttribute('data-controls-task', 'view');
    await expect(controls.locator('[data-layer-id]')).toHaveCount(0);
    await expect(controls.getByRole('radio', { name: 'Dorsal' })).toHaveCount(1);
  });

  test('product view workflow fits a narrow screen: ?mode=product&task=view', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openControls(page, '&mode=product&task=view');
    const controls = page.locator('#panel surfview-controls');
    await expect(controls).toHaveAttribute('data-controls-task', 'view');
    await expect(controls.locator('[data-layer-id]')).toHaveCount(0);
    await expect(controls.getByText('Applies to Cortex Pair')).toBeVisible();
    const dorsal = controls.getByRole('radio', { name: 'Dorsal' });
    await dorsal.focus();
    await page.keyboard.press('Space');
    await expect(dorsal).toBeChecked();
    await expect(page.locator('#viewer-frame')).toContainText(/View\s*dorsal/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const panelBox = (await controls.boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(390);
  });
});
