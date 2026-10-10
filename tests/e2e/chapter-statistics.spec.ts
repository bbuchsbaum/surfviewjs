import { expect, test, type Page } from '@playwright/test';

async function openStatistics(page: Page, id = 'statistics') {
  await page.goto(`/demo/index.html?scenario=${id}`);
  await expect(page.locator('#status-text')).toContainText('Running: Statistical maps', { timeout: 20_000 });
  await expect(page.locator('#viewer-slot canvas')).toBeVisible();
}

async function settledShot(page: Page) {
  await page.waitForTimeout(250);
  return page.locator('#viewer-slot canvas').screenshot();
}

function survivingCounts(text: string | null): [number, number] {
  const match = text!.match(/L ([\d,]+) · R ([\d,]+)/)!;
  return [Number(match[1].replaceAll(',', '')), Number(match[2].replaceAll(',', ''))];
}

test.describe('Statistical maps chapter', () => {
  test('corrections start at FDR and change what survives', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openStatistics(page, 'statisticalMap');
    const surviving = page.locator('#stats-surviving');
    const bl = page.locator('.film-corner-bl');

    // The highlighted option matches the correction actually applied.
    await expect(page.getByRole('radio', { name: 'FDR' })).toBeChecked();
    await expect(bl).toContainText('FDR q 0.05');
    await expect(surviving).toContainText('p ≤');
    const fdr = survivingCounts(await surviving.textContent());
    expect(fdr[0]).toBeGreaterThan(0);
    const fdrImage = await settledShot(page);

    await page.getByRole('radio', { name: 'Bonferroni' }).check();
    await expect(bl).toContainText('Bonferroni α 0.05');
    const bonferroni = survivingCounts(await surviving.textContent());
    expect(bonferroni[0]).toBeGreaterThan(0);
    expect(bonferroni[0]).toBeLessThan(fdr[0]);
    expect((await settledShot(page)).equals(fdrImage)).toBe(false);

    await page.getByRole('radio', { name: 'Cluster extent' }).check();
    await expect(surviving).toContainText(/\d+ clusters?/);
    await expect(page.locator('#stats-rate')).toBeDisabled();
    await page.locator('#stats-cluster-size').fill('150');
    await expect(bl).toContainText('k ≥ 150');

    await page.getByRole('radio', { name: 'None' }).check();
    await expect(surviving).toHaveText('all vertices (display threshold only)');
    const noneImage = await settledShot(page);

    await page.locator('#stats-threshold').fill('4');
    await expect(bl).toContainText('±4.0');
    expect((await settledShot(page)).equals(noneImage)).toBe(false);

    await page.locator('#stats-dual').check();
    await expect(page.locator('#stats-colormap')).toBeDisabled();
    await expect(page.locator('.film-corner-tr')).toContainText('hot + / cool −');
    expect(errors).toEqual([]);
  });

  test('hover prints statistics into the film corner', async ({ page }) => {
    await openStatistics(page);
    const canvas = page.locator('#viewer-slot canvas');
    const box = (await canvas.boundingBox())!;
    const br = page.locator('.film-corner-br');
    let found = false;
    for (const [fx, fy] of [[0.3, 0.45], [0.25, 0.5], [0.7, 0.45], [0.35, 0.4], [0.65, 0.55]]) {
      await page.mouse.move(box.x + box.width * fx!, box.y + box.height * fy!);
      await page.waitForTimeout(250);
      if (/Vertex[LR] \d+/.test((await br.textContent()) ?? '')) { found = true; break; }
    }
    expect(found).toBe(true);
    await expect(br).toContainText(' · z ');
    await expect(br).toContainText('FDR');
  });

  test('effect × confidence mode draws a TwoDataLayer with switchable 2D colormaps', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openStatistics(page, 'colormap2d');
    await page.getByRole('radio', { name: 'Effect × confidence (2D)' }).check();
    await expect(page.locator('#stats-correction')).toBeHidden();
    await expect(page.locator('.film-corner-tr')).toContainText('2D Confidence');
    const confidenceImage = await settledShot(page);

    await page.getByRole('radio', { name: 'Diverging' }).check();
    await expect(page.locator('.film-corner-tr')).toContainText('2D Diverging');
    const divergingImage = await settledShot(page);
    expect(divergingImage.equals(confidenceImage)).toBe(false);

    await page.locator('#stats-confidence').fill('0.2');
    expect((await settledShot(page)).equals(divergingImage)).toBe(false);

    await page.getByRole('radio', { name: 'Statistical map' }).check();
    await expect(page.locator('#stats-correction')).toBeVisible();
    await expect(page.locator('.film-corner-bl')).toContainText('FDR q 0.05');
    expect(errors).toEqual([]);
  });
});
