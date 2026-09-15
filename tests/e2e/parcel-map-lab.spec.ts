import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) } });

function validateExport(record: any): void {
  expect(record.schema).toBe('surfview.parcel-map-experiment.v1');
  const uv = record.coordinates as number[], faces = record.faces as number[];
  const areas = new Array(record.parcelIds.length).fill(0);
  let total = 0, minimumRatio = Infinity, minimumArea = Infinity, maximumBoundaryChange = 0;
  const areaAt = (array: number[], a: number, b: number, c: number): number =>
    ((array[b * 2]! - array[a * 2]!) * (array[c * 2 + 1]! - array[a * 2 + 1]!) -
     (array[b * 2 + 1]! - array[a * 2 + 1]!) * (array[c * 2]! - array[a * 2]!)) / 2;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f]!, b = faces[f + 1]!, c = faces[f + 2]!, area = areaAt(uv, a, b, c);
    minimumArea = Math.min(minimumArea, area);
    minimumRatio = Math.min(minimumRatio, area / areaAt(record.referenceCoordinates, a, b, c));
    total += area; areas[record.faceParcels[f / 3]] += area;
  }
  let boundaryArea = 0;
  record.boundary.forEach((a: number, i: number) => {
    const b = record.boundary[(i + 1) % record.boundary.length];
    boundaryArea += (uv[a * 2]! * uv[b * 2 + 1]! - uv[b * 2]! * uv[a * 2 + 1]!) / 2;
    maximumBoundaryChange = Math.max(maximumBoundaryChange, Math.abs(uv[a * 2]! - record.referenceCoordinates[a * 2]), Math.abs(uv[a * 2 + 1]! - record.referenceCoordinates[a * 2 + 1]));
  });
  expect(total).toBeCloseTo(boundaryArea, 9);
  expect(minimumArea).toBeGreaterThan(0);
  expect(maximumBoundaryChange).toBe(0);
  expect(Math.max(...areas.map((area, i) => Math.abs(area - record.metrics.parcelAreas[i])))).toBeLessThan(1e-10);
  const independentError = areas.reduce((sum, area, i) => sum + (area - record.metrics.targetAreas[i]) ** 2 / record.metrics.targetAreas[i] / total, 0);
  expect(independentError).toBeCloseTo(record.metrics.areaError, 10);
  expect(minimumRatio).toBeGreaterThanOrEqual(1e-4);
}

test('small map supports optimization, original-shape inspection, saved comparisons, alternate boundaries, and mobile export', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/demo/map-lab.html?dataset=toy');
  const root = page.locator('.parcel-map-lab');
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await page.locator('[data-auto]').uncheck();
  const before = await root.getAttribute('data-objective');
  await page.getByRole('button', { name: 'Optimize 80 steps', exact: true }).click();
  await expect(root).toHaveAttribute('data-running', 'false', { timeout: 30000 });
  expect(Number(await root.getAttribute('data-objective'))).toBeLessThan(Number(before));
  await expect(root).toHaveAttribute('data-flips', '0');
  await page.getByRole('button', { name: 'Keep this map', exact: true }).click();
  await expect(page.locator('.pml-snapshot')).toHaveCount(2);
  await page.getByRole('button', { name: 'Restore Starting map', exact: true }).click();
  expect(Number(await root.getAttribute('data-objective'))).toBeCloseTo(Number(before), 9);
  await page.getByLabel('Inspect map parcel', { exact: true }).selectOption('5');
  await expect(page.locator('.pml-detail')).toBeVisible();
  await expect(page.locator('[data-preview] canvas')).toBeVisible();
  const preview = page.locator('[data-preview] canvas'), image = await preview.screenshot(), box = (await preview.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 5 }); await page.mouse.up();
  expect((await preview.screenshot()).equals(image)).toBe(false);
  await page.getByRole('button', { name: 'Close parcel detail', exact: true }).click();
  await page.getByLabel('Map outline', { exact: true }).selectOption('4');
  await expect(root).toHaveAttribute('data-ready', 'true');
  await page.getByLabel('Map aspect ratio', { exact: true }).fill('1.4');
  await page.getByLabel('Map aspect ratio', { exact: true }).dispatchEvent('change');
  await expect(root).toHaveAttribute('data-ready', 'true');
  await page.getByLabel('Equal area target', { exact: true }).fill('1');
  await page.getByLabel('Compactness weight', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Optimize 80 steps', exact: true }).click();
  await expect(root).toHaveAttribute('data-running', 'false', { timeout: 30000 });
  await page.getByLabel('Map color mode', { exact: true }).selectOption('area');
  await page.locator('[data-reference]').check();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export map & parameters', exact: true }).click();
  const download = await downloadPromise;
  const record = JSON.parse(await readFile((await download.path())!, 'utf8')); validateExport(record);
  expect(record.parcelIds).toHaveLength(9); expect(record.outline).toBe(4); expect(record.aspectRatio).toBe(1.4);
  await page.screenshot({ path: testInfo.outputPath('toy-map-experiment.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(root).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('map-lab-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('real Schaefer and Glasser maps retain positive areas through a parameter comparison and export', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.goto('/demo/map-lab.html');
  const root = page.locator('.parcel-map-lab');
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(page.getByLabel('Inspect map parcel', { exact: true }).locator('option')).toHaveCount(201);
  await page.getByRole('button', { name: 'Compare three balances', exact: true }).click();
  await expect(page.locator('.pml-snapshot')).toHaveCount(4, { timeout: 90000 });
  await expect(root).toHaveAttribute('data-flips', '0');
  await page.screenshot({ path: 'output/concepts/parcel-map-comparison.png', fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export map & parameters', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs('output/concepts/parcel-map-schaefer.json');
  const record = JSON.parse(await readFile((await download.path())!, 'utf8')); validateExport(record);
  expect(record.parcelIds).toHaveLength(200);
  await page.getByRole('button', { name: 'Restore Fidelity', exact: true }).click();
  await expect(page.getByLabel('Angle fidelity weight', { exact: true })).toHaveValue('1.5');
  await page.getByLabel('Inspect map parcel', { exact: true }).selectOption('101');
  await expect(page.locator('[data-preview] canvas')).toBeVisible();
  await page.screenshot({ path: 'output/concepts/parcel-map-detail.png', fullPage: true });
  await page.getByLabel('Map dataset', { exact: true }).selectOption('glasser');
  await expect(root).toHaveAttribute('data-dataset', 'glasser', { timeout: 30000 });
  await expect(root).toHaveAttribute('data-ready', 'true');
  await expect(page.getByLabel('Inspect map parcel', { exact: true }).locator('option')).toHaveCount(181);
  await page.getByLabel('Map outline', { exact: true }).selectOption('6');
  await expect(root).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Optimize 80 steps', exact: true }).click();
  await expect(root).toHaveAttribute('data-running', 'false', { timeout: 30000 });
  await expect(root).toHaveAttribute('data-flips', '0');
  await page.getByLabel('Map color mode', { exact: true }).selectOption('compactness');
  await page.screenshot({ path: testInfo.outputPath('glasser-map-rounded-square.png'), fullPage: true });
  const secondDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export map & parameters', exact: true }).click();
  const second = await secondDownloadPromise; validateExport(JSON.parse(await readFile((await second.path())!, 'utf8')));
  expect(errors).toEqual([]);
});
