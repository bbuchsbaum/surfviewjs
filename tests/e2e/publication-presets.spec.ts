import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('figures chapter applies style presets and downloads an exported PNG', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/demo/index.html?scenario=publication-presets');
  await expect(page.locator('#status-text')).toHaveText('Running: Figures', { timeout: 20_000 });
  const status = page.locator('[data-publication-status]');
  await expect(status).toContainText('Ready');

  // Every preset from listStylePresets() is offered, including the 2.3.0 report preset.
  const presets = page.locator('#figures-preset');
  await expect(presets.getByRole('radio')).toHaveCount(9);
  await expect(presets.getByRole('radio', { name: 'Report' })).toHaveCount(1);

  const before = await page.locator('#viewer-slot canvas').screenshot();
  await presets.getByRole('radio', { name: 'Talk Dark', exact: true }).check();
  await expect(status).toContainText('Talk Dark');
  await expect(page.locator('#viewer-frame')).toContainText(/Preset\s*Talk Dark/);
  const viewerShot = await page.locator('#viewer-slot').screenshot();
  expect(viewerShot.length).toBeGreaterThan(5000);
  expect(viewerShot.equals(before)).toBe(false);
  // The live film keeps its base colour (the --d0 token, FILM_BASE #0b1118);
  // the preset background is an export choice.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.film-viewer')!).backgroundColor))
    .toBe('rgb(11, 17, 24)');

  // The colour key describes the map itself.
  await expect(page.locator('#figures-key')).toHaveText(/Synthetic contrast \(z\): −5\.0 to 5\.0, masked −1\.65 to 1\.65/);

  await page.locator('#figures-size').selectOption('640x480');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export png/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('surfview-figure.png');
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(bytes.readUInt32BE(16)).toBe(640);
  expect(bytes.readUInt32BE(20)).toBe(480);
  expect(bytes.length).toBeGreaterThan(10_000);
  await expect(status).toContainText(/PNG 640 × 480 px, \d+ KB, saved as surfview-figure\.png/);

  // The margin preview shows the file that was written, on the preset's opaque background.
  const preview = page.locator('img.figure-preview');
  await expect(preview).toBeVisible();
  const corner = await preview.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return { size: [image.naturalWidth, image.naturalHeight], pixel: Array.from(context.getImageData(1, 1, 1, 1).data) };
  });
  expect(corner.size).toEqual([640, 480]);
  const talkDark = await page.evaluate(async () => {
    const { getStylePreset } = await import('/src/index.ts');
    return getStylePreset('talk-dark').background.clearColor;
  });
  expect(corner.pixel).toEqual([(talkDark >> 16) & 255, (talkDark >> 8) & 255, talkDark & 255, 255]);

  // Transparent background really exports alpha.
  await page.locator('#figures-background').getByRole('radio', { name: 'Transparent', exact: true }).check();
  const transparentDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /export png/i }).click();
  await transparentDownload;
  const alpha = await preview.evaluate(async (image: HTMLImageElement) => {
    await new Promise(resolve => (image.complete ? resolve(null) : image.addEventListener('load', resolve, { once: true })));
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return context.getImageData(1, 1, 1, 1).data[3];
  });
  expect(alpha).toBe(0);
});

test('figures chapter mounts an anatomical report scene and exports from it', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/demo/index.html?scenario=figures');
  await expect(page.locator('#status-text')).toHaveText('Running: Figures', { timeout: 20_000 });
  await page.locator('#figures-mode').getByRole('radio', { name: 'Report scene', exact: true }).check();
  await expect(page.locator('.figure-report .surfview-mount')).toHaveCount(1);
  await expect(page.locator('#status-text')).toHaveText('Report scene ready', { timeout: 20_000 });
  await expect(page.locator('#viewer-frame')).toContainText(/Source\s*mountSurfView, anatomical/);
  await expect(page.locator('#figures-key')).toHaveText('Visual–motor contrast (z): −6.0 to 6.0, masked −2.30 to 2.30');

  const canvas = page.locator('.figure-report canvas');
  await expect(canvas).toHaveCount(1);
  const oblique = await canvas.screenshot();
  await page.locator('#figures-brain-view').getByRole('radio', { name: 'Left medial', exact: true }).check();
  await expect(page.locator('#viewer-frame')).toContainText(/View\s*Left medial/);
  await expect.poll(async () => (await canvas.screenshot()).equals(oblique)).toBe(false);

  await expect(page.getByLabel('Synthetic parietal reference')).toBeChecked();
  await page.getByLabel('Synthetic parietal reference').uncheck();
  await page.locator('#figures-reference-opacity').fill('0.6');
  await page.locator('#figures-reference-opacity').dispatchEvent('input');
  await page.locator('#figures-report-map').selectOption('frontoparietal');
  await expect(page.getByLabel('Synthetic parietal reference')).not.toBeChecked();
  await expect(page.locator('#figures-reference-opacity')).toHaveValue('0.6');
  await expect(page.locator('#figures-key')).toContainText('Frontoparietal contrast (z)');

  await page.locator('#figures-size').selectOption('640x480');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export png/i }).click();
  const bytes = await readFile((await (await downloadPromise).path())!);
  expect(bytes.readUInt32BE(16)).toBe(640);
  await expect(page.locator('[data-publication-status]')).toContainText(/PNG 640 × 480 px/);
});

test('explicit background wins over presentation preset at construction', async ({ page }) => {
  await page.goto('/demo/index.html');
  const result = await page.evaluate(async () => {
    const { NeuroSurfaceViewer } = await import('/src/index.ts');
    const host = document.createElement('div');
    host.style.width = '300px';
    host.style.height = '200px';
    document.body.append(host);
    let updates = 0;
    class ConstructorProbe extends NeuroSurfaceViewer {
      updateConfig(config: Parameters<NeuroSurfaceViewer['updateConfig']>[0]) {
        updates++;
        super.updateConfig(config);
      }
    }
    const viewer = new ConstructorProbe(host, 300, 200, {
      preset: 'presentation',
      backgroundColor: 0x101c25,
      directionalLightIntensity: 0.7,
      metalness: 0.2,
      roughness: 0.8,
      ssaoRadius: 6,
      ssaoKernelSize: 8,
      initialZoom: 100
    });
    const background = viewer.getFigureBackground();
    const css = host.style.background;
    const config = { intensity: viewer.directionalLight.intensity, metalness: viewer.config.metalness,
      roughness: viewer.config.roughness, ssaoRadius: viewer.config.ssaoRadius, ssaoKernelSize: viewer.config.ssaoKernelSize };
    const image = new Image();
    image.src = viewer.exportPNG({ width: 32, height: 32, transparent: false, colorbar: false, roiLabels: false, scaleBar: false });
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const exportPixel = Array.from(context.getImageData(0, 0, 1, 1).data);
    viewer.dispose();
    host.remove();
    return { background, css, config, updates, exportPixel };
  });

  expect(result.background).toEqual({ color: 0x101c25, transparent: false });
  expect(result.css).toBe('rgb(16, 28, 37)');
  expect(result.updates).toBe(0);
  expect(result.config).toEqual({ intensity: 0.7, metalness: 0.2, roughness: 0.8, ssaoRadius: 6, ssaoKernelSize: 8 });
  expect(result.exportPixel).toEqual([16, 28, 37, 255]);
});
