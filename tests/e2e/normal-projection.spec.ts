import { test, expect, type Page } from '@playwright/test';

async function openVolume(page: Page, id = 'volume') {
  await page.goto(`/demo/index.html?scenario=${id}`);
  await expect(page.locator('#status-text')).toContainText('Running: Volume to surface', { timeout: 20_000 });
  await expect(page.locator('#viewer-slot canvas')).toBeVisible();
}

async function settledShot(page: Page) {
  await page.waitForTimeout(250);
  return page.locator('#viewer-slot canvas').screenshot();
}

test('volume chapter projects along normals and recomputes ordinary vertex data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openVolume(page, 'normal-projection');
  const result = page.locator('#normal-result');
  await expect(result).toContainText('5 samples; mean;');
  await expect(result).toContainText('depths [-4, 4] mm');
  const counts = (await result.textContent())!.match(/([\d,]+) \/ ([\d,]+) vertices/)!;
  expect(Number(counts[1].replaceAll(',', ''))).toBeGreaterThan(1000);
  expect(counts[1]).toBe(counts[2]);

  const meanImage = await settledShot(page);
  expect(meanImage.length).toBeGreaterThan(5000);
  await page.locator('#normal-reducer').selectOption('max-abs');
  await expect(result).toContainText('5 samples; max-abs;');
  const maxAbsImage = await settledShot(page);
  expect(maxAbsImage.equals(meanImage)).toBe(false);

  await page.locator('#normal-steps').fill('1');
  await expect(result).toContainText('1 samples;');
  const oneSampleImage = await settledShot(page);
  expect(oneSampleImage.equals(maxAbsImage)).toBe(false);

  await page.locator('#normal-interpolation').selectOption('nearest');
  await page.waitForTimeout(100);
  const nearestImage = await settledShot(page);
  expect(nearestImage.equals(oneSampleImage)).toBe(false);

  // Deep samples only: every vertex still lands inside the volume grid.
  await page.locator('#normal-high').fill('0');
  await page.locator('#normal-low').fill('-12');
  await expect(result).toContainText('depths [-12, 0] mm');
  const deep = (await result.textContent())!.match(/([\d,]+) \/ ([\d,]+) vertices/)!;
  expect(deep[1]).toBe(deep[2]);
  expect(errors).toEqual([]);
});

test('volume layer modes report the sampling path they use', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openVolume(page, 'volume-projection');
  await page.getByRole('radio', { name: 'Volume layer' }).check();
  await expect(page.locator('#normal-steps')).toBeHidden();
  const path = page.locator('#volume-path');
  const perf = page.locator('#perf-text');
  await expect(perf).toContainText(/(CPU|GPU) compositing/);
  // With WebGL2 the chapter composites on the GPU, so vertex mode samples a 3D texture.
  const gpu = (await perf.textContent())!.includes('GPU compositing');
  await expect(path).toHaveText(gpu
    ? /^GPU 3D texture, (linear|nearest \(no float linear filtering\))$/
    : 'CPU per vertex, linear');
  await expect(page.locator('.film-corner-tr')).toContainText('VolumeProjectionLayer, vertex');
  const vertexImage = await settledShot(page);

  if (gpu && (await path.textContent()) === 'GPU 3D texture, linear') {
    // The sampling mode drives the 3D texture filter on the GPU vertex path.
    await page.locator('#volume-sampling').selectOption('nearest');
    await expect(path).toHaveText('GPU 3D texture, nearest');
    expect((await settledShot(page)).equals(vertexImage)).toBe(false);
    await page.locator('#volume-sampling').selectOption('linear');
    await expect(path).toHaveText('GPU 3D texture, linear');
  }

  await page.locator('#volume-mode').selectOption('ribbon');
  await expect(path).toContainText('CPU ribbon, 7 samples white→pial, mean');
  const ribbonImage = await settledShot(page);
  expect(ribbonImage.equals(vertexImage)).toBe(false);

  await page.locator('#volume-ribbon-reducer').selectOption('max');
  await expect(path).toContainText('CPU ribbon, 7 samples white→pial, max');
  expect((await settledShot(page)).equals(ribbonImage)).toBe(false);

  await page.locator('#volume-mode').selectOption('hybrid');
  await expect(path).toContainText('hybrid → vertex');
  await page.getByRole('radio', { name: 'Publication' }).check();
  await expect(path).toContainText('hybrid → ribbon');

  await page.locator('#volume-mode').selectOption('fragment');
  await expect(path).toContainText('CPU per vertex, linear');
  await page.locator('#volume-sampling').selectOption('nearest');
  await expect(path).toContainText('CPU per vertex, nearest');

  const beforeWindow = await settledShot(page);
  await page.locator('#volume-window').fill('1.5');
  await expect(page.locator('.film-corner-bl')).toContainText('±1.5');
  expect((await settledShot(page)).equals(beforeWindow)).toBe(false);

  await page.getByRole('radio', { name: 'Sample along normals' }).check();
  await expect(page.locator('#normal-steps')).toBeVisible();
  await expect(page.locator('#volume-mode')).toBeHidden();
  expect(errors).toEqual([]);
});

/** The middle of the viewer, clear of the film corners that print the colormap name. */
async function surfaceShot(page: Page) {
  const box = (await page.locator('#viewer-slot canvas').boundingBox())!;
  const clip = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.1, width: box.width * 0.5, height: box.height * 0.8 };
  const shot = () => page.screenshot({ clip });
  // Wait for two identical frames so camera fitting or a pending redraw is not mistaken for a recolour.
  let previous = await shot();
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(150);
    const next = await shot();
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error('viewer canvas did not settle');
}

test('volume chapter colormap select recolours every projection method and mode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openVolume(page);
  const colormap = page.locator('#volume-colormap');

  // Sample along normals: a DataLayer.
  let before = await surfaceShot(page);
  await colormap.selectOption('viridis');
  expect((await surfaceShot(page)).equals(before)).toBe(false);
  await colormap.selectOption('coolwarm');

  // Volume layer: the GPU 3D-texture path (vertex mode with WebGL2) and the CPU paths.
  await page.getByRole('radio', { name: 'Volume layer' }).check();
  const path = page.locator('#volume-path');
  for (const mode of ['vertex', 'fragment', 'ribbon'] as const) {
    await page.locator('#volume-mode').selectOption(mode);
    await expect(path).toContainText(mode === 'ribbon' ? 'CPU ribbon' : mode === 'vertex' ? /3D texture|CPU per vertex/ : 'CPU per vertex');
    await colormap.selectOption('coolwarm');
    before = await surfaceShot(page);
    await colormap.selectOption('viridis');
    expect((await surfaceShot(page)).equals(before), `${mode} mode recolours`).toBe(false);
  }
  expect(errors).toEqual([]);
});
