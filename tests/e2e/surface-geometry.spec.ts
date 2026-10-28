import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const demoRoot = process.env.SURFVIEW_DEMO_ROOT ?? '/demo/';

test('native morph triangles, precise picks, markers and midpoint borders agree', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/geometry-fixture.html'); await page.waitForFunction(() => (window as any).geometryReady);
  const samples = await page.evaluate(() => (window as any).checkAttachments());
  for (const sample of samples) {
    expect(sample.kind).toBe('triangle'); expect(sample.markerZ).toBeCloseTo(sample.expectedZ, 6); expect(sample.hitZ).toBeCloseTo(sample.expectedZ, 6);
    expect(sample.pixel[1]).toBeGreaterThan(sample.pixel[0] + 30); expect(sample.pixel[1]).toBeGreaterThan(sample.pixel[2] + 30);
    expect(sample.border[2]).toBeCloseTo(sample.weight * 1.5, 6); expect(sample.border[5]).toBeCloseTo(sample.weight * 2, 6);
  }
  expect(errors).toEqual([]);
});

for (const kind of ['esm', 'umd', 'embed']) test(`${kind} consumer resolves standalone worker and matches synchronous results`, async ({ page }) => {
  await page.goto('/tests/geometry-fixture.html'); await page.waitForFunction(() => (window as any).geometryReady);
  const result = await page.evaluate(k => (window as any).checkWorker(k), kind);
  expect(result.values).toEqual(result.expected);
});

test('example ruler, live brush radius and both border styles produce visible results', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${demoRoot}?scenario=inspect`); await expect(page.locator('#status-text')).toContainText('Running: Inspect', { timeout: 30000 });
  await page.locator('#surface-measure-example').click();
  const distance = page.locator('#surface-measurement'), area = page.locator('#surface-brush-area');
  await expect(distance).toContainText('mm along surface');
  const surface = parseFloat((await distance.textContent())!);
  const chord = parseFloat((await page.locator('#surface-chord').textContent())!);
  expect(surface).toBeGreaterThan(0); expect(surface + 0.02).toBeGreaterThanOrEqual(chord);
  await expect(page.locator('#surface-anchor-status')).toContainText(/Face \d+; weights/);
  await expect(page.locator('#surface-border-status')).toContainText(/\d+ curve.*segments.*closed/);
  const beforeArea = Number(await area.getAttribute('data-partition-area'));
  await page.locator('#surface-brush-radius').fill('20');
  expect(Number(await area.getAttribute('data-partition-area'))).toBeGreaterThan(beforeArea);
  const canvas = page.locator('#viewer-slot canvas'), midpoint = await canvas.screenshot();
  await page.getByRole('radio', { name: 'Label-crossing edges', exact: true }).check();
  await expect.poll(async () => (await canvas.screenshot()).equals(midpoint)).toBe(false);
  await expect(page.locator('#inspect-marks li')).toHaveCount(0);
  await page.locator('#surface-measure-clear').click();
  await expect(distance).toContainText('Choose two points'); await expect(area).toHaveText('—');
  await page.getByRole('button', { name: 'Reset chapter', exact: true }).click();
  await expect(page.locator('#surface-measure-enabled')).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('precise anchors move through inflation while anatomical distance and area stay fixed', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${demoRoot}?scenario=anatomy&mode=morph&task=measure`);
  await expect(page.locator('#surface-measurement')).toContainText('mm along surface', { timeout: 30000 });
  await page.locator('#anatomy-inflation').fill('0');
  const point = await page.locator('#surface-anchor-position').textContent();
  const length = await page.locator('#surface-measurement').textContent();
  const area = await page.locator('#surface-brush-area').textContent();
  await page.locator('#anatomy-inflation').fill('1.5');
  await expect(page.locator('#surface-anchor-position')).not.toHaveText(point!);
  await expect(page.locator('#surface-measurement')).toHaveText(length!);
  await expect(page.locator('#surface-brush-area')).toHaveText(area!);
  await page.getByRole('button', { name: 'Inspect & annotate', exact: true }).click();
  await expect(page.locator('#surface-measurement')).toContainText('Choose two points');
  expect(errors).toEqual([]);
});

test('area cluster controls use physical extent and keep the threshold editable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${demoRoot}?scenario=statistics&task=area`);
  await expect(page.locator('#status-text')).toContainText('Running: Statistical maps', { timeout: 30000 });
  await expect(page.getByRole('radio', { name: 'Cluster area (descriptive)', exact: true })).toBeChecked();
  await expect(page.locator('#stats-cluster-t')).toBeEnabled();
  await expect(page.locator('#stats-rate')).toBeDisabled();
  await page.locator('#stats-cluster-area').fill('200');
  await page.locator('#stats-cluster-t').fill('3');
  await expect(page.locator('#stats-surviving')).toContainText('≥ 200 mm², signs separate');
  expect(errors).toEqual([]);
});

test('derived smoothing follows temporal frames and survives chapter disposal', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${demoRoot}?scenario=time-series&task=smoothing`);
  await expect(page.locator('#status-text')).toContainText('Running: Time series', { timeout: 30000 });
  await page.locator('#surface-smoothing').check();
  const kernel = page.locator('#surface-smoothing-status'), difference = page.locator('#surface-smoothing-difference');
  await expect(kernel).toHaveText('3 mm FWHM; weights ready in worker', { timeout: 30000 });
  await expect.poll(() => page.workers().length).toBe(1);
  await page.locator('#surface-smoothing-fwhm').fill('0');
  await expect(kernel).toContainText('0 mm FWHM; weights ready');
  await expect(difference).toHaveText('0.0000 % signal');
  await page.locator('#surface-smoothing-fwhm').fill('6');
  await expect(kernel).toContainText('6 mm FWHM; weights ready');
  await expect.poll(async () => parseFloat((await difference.textContent())!)).toBeGreaterThan(0);
  await page.locator('#ts-time').fill('14');
  const before = await page.locator('#viewer-slot canvas').screenshot();
  await page.locator('#ts-time').fill('34');
  await expect(page.locator('#ts-frame')).toHaveText('35 / 100');
  await expect.poll(async () => (await page.locator('#viewer-slot canvas').screenshot()).equals(before)).toBe(false);
  await page.locator('#surface-smoothing').uncheck();
  await expect(kernel).toHaveText('Original playback'); await expect(difference).toHaveText('—');
  // Restart, then leave while work can be pending. SPA navigation must dispose the worker.
  await page.locator('#surface-smoothing').check();
  await page.getByRole('button', { name: 'First look', exact: true }).click();
  await expect(page.locator('#status-text')).toContainText('Running: First look', { timeout: 30000 });
  await expect.poll(() => page.workers().length).toBe(0);
  expect(errors).toEqual([]);
});

test('mapping demo supports scalar/label transfer, persisted identity, and invalid artifact recovery', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${demoRoot}?scenario=data&task=mapping`);
  await expect(page.locator('#status-text')).toContainText('Running: Data in & out', { timeout: 30000 });
  await page.getByRole('button', { name: 'Tetrahedron', exact: true }).click();
  await expect(page.locator('#data-load-status')).toHaveText('Tetrahedron: 4 vertices, 4 faces');
  const download = page.waitForEvent('download');
  await page.locator('#surface-mapping-roundtrip').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('surface-mapping.json');
  const artifact = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(artifact.checksum).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.locator('#surface-mapping-status')).toHaveText('4 supported rows; checksum verified');
  const canvas = page.locator('#viewer-slot canvas'), scalar = await canvas.screenshot();
  await page.getByRole('radio', { name: 'Categorical labels', exact: true }).check();
  await expect(page.locator('#surface-mapping-coverage')).toContainText('weighted label votes');
  await expect.poll(async () => (await canvas.screenshot()).equals(scalar)).toBe(false);
  await page.getByRole('radio', { name: 'Neighbour blend', exact: true }).check();
  await expect(page.locator('.film-corner-tr')).toContainText('labels; blend');
  const input = page.locator('#surface-mapping-file');
  await input.setInputFiles({ name: 'corrupt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...artifact, checksum: '0'.repeat(64) })) });
  await expect(page.locator('#surface-mapping-status')).toContainText('Mapping rejected');
  await expect(page.locator('#surface-mapping-status')).toHaveAttribute('data-error', 'true');
  await page.getByRole('button', { name: 'Reset chapter', exact: true }).click();
  await expect(page.locator('#data-load-status')).toContainText('fsaverage5');
  await input.setInputFiles({ name: 'wrong-mesh.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(artifact)) });
  await expect(page.locator('#surface-mapping-status')).toContainText('Mapping rejected');
  await page.getByRole('button', { name: 'Tetrahedron', exact: true }).click();
  await expect(page.locator('#data-load-status')).toHaveText('Tetrahedron: 4 vertices, 4 faces');
  await input.setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(artifact)) });
  await expect(page.locator('#surface-mapping-status')).toHaveText('4 supported rows; checksum verified');
  await expect(page.locator('#surface-mapping-status')).not.toHaveAttribute('data-error');
  expect(errors).toEqual([]);
});

test('ribbon inspector reports a valid column on the cortical display', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${demoRoot}?scenario=volume&task=column`);
  await expect(page.locator('#status-text')).toContainText('Running: Volume to surface', { timeout: 30000 });
  await page.locator('#ribbon-column-example').click();
  const status = page.locator('#ribbon-column-status');
  await expect(status).toContainText(/v\d+: [-\d.]+, [\d.]+% valid, [\d.]+ mm³/);
  await expect(page.locator('#ribbon-segment-status')).toContainText(/[-\d.]+; \d \/ 7 samples/);
  await expect(page.locator('#ribbon-column-support')).toContainText('mm³; valid');
  const before = await status.textContent();
  await page.locator('#ribbon-column-min-coverage').fill('50');
  await expect(status).toHaveText(before!);
  await page.locator('#ribbon-column-clear').click();
  await expect(status).toHaveText('Choose a column');
  await page.getByRole('button', { name: 'First look', exact: true }).click();
  await expect.poll(() => page.workers().length).toBe(0);
  expect(errors).toEqual([]);
});

test('surface tools are discoverable and keyboard operable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(demoRoot);
  const fonts = await page.evaluate(async () => {
    const families = ['Archivo Variable', 'JetBrains Mono Variable'];
    return await Promise.all(families.map(async family => (await document.fonts.load(`16px "${family}"`, 'Surface geometry')).length));
  });
  expect(fonts.every(count => count > 0)).toBe(true);
  const tools = page.locator('#surface-tools');
  await expect(tools.getByRole('link')).toHaveCount(6);
  const ruler = tools.getByRole('link', { name: 'Ruler & borders', exact: true });
  await ruler.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#surface-measurement')).toContainText('mm along surface', { timeout: 30000 });
  await page.locator('#surface-measure-clear').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#surface-brush-area')).toHaveText('—');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#code-block summary').click();
  await expect(page.locator('#code-text')).toContainText('shortestPathLocations');
  await expect(page.locator('#code-text')).toContainText("from 'surfview'");
});

test('folded strokes remain visible at two zoom levels and preserve cortical occlusion', async ({ page }) => {
  await page.goto('/tests/geometry-fixture.html');
  await page.waitForFunction(() => (window as any).geometryReady);
  const samples = await page.evaluate(() => (window as any).checkFoldedStroke());
  for (const sample of samples) {
    if (sample.expectedVisible) expect(sample.yellow).toBeGreaterThan(0);
    else expect(sample.yellow).toBe(0);
  }
});

test('prepared worker batches retain dependencies, snapshot frames, cancel and release', async ({ page }) => {
  await page.goto('/tests/geometry-fixture.html');
  await page.waitForFunction(() => (window as any).geometryReady);
  const result = await page.evaluate(() => (window as any).checkPreparedWorker());
  expect(result.actual).toEqual(result.expected);
  expect(result.rejected).toBe(true); expect(result.cancellation).toBe(true); expect(result.released).toBe(true); expect(result.configurationLocked).toBe(true); expect(result.lockedAfterRelease).toBe(true);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('streamed worker batches snapshot distinct masks and reject stale delivery', async ({ page }) => {
  await page.goto('/tests/geometry-fixture.html');
  await page.waitForFunction(() => (window as any).geometryReady);
  const result = await page.evaluate(() => (window as any).checkStreamedWorker());
  expect(result.actual).toEqual(result.expected); expect(result.staleRejected).toBe(true);
  await expect.poll(() => page.workers().length).toBe(0);
});


test('compacted annotation slots upload their positions and colors', async ({ page }) => {
  await page.goto('/tests/geometry-fixture.html');
  await page.waitForFunction(() => (window as any).geometryReady);
  const pixels = await page.evaluate(() => (window as any).checkInstanceCompaction());
  expect(pixels.left[1]).toBeGreaterThan(200);
  expect(pixels.left[0]).toBeLessThan(20);
  expect(pixels.right[2]).toBeGreaterThan(200);
  expect(pixels.right[0]).toBeLessThan(20);
});

test('independent clients share a real worker without resource or cancellation collisions', async ({ page }) => {
  await page.goto('/tests/geometry-fixture.html');
  await page.waitForFunction(() => (window as any).geometryReady);
  const result = await page.evaluate(() => (window as any).checkSharedWorker());
  expect(result).toEqual({distinct:true,cancelledA:true,values:[1,2,3,4]});
});
