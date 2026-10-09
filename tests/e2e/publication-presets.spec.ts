import { test, expect } from '@playwright/test';

test('publication preset demo renders and exports a PNG figure', async ({ page }) => {
  await page.goto('/demo/index.html');

  await page.getByRole('button', { name: /publication presets/i }).click();
  await expect(page.locator('[data-publication-status]')).toContainText('Ready', { timeout: 10000 });

  await page.getByRole('button', { name: /talk dark/i }).click();
  await expect(page.locator('[data-publication-status]')).toContainText('Talk Dark');

  const viewerShot = await page.locator('#viewer-slot').screenshot();
  expect(viewerShot.length).toBeGreaterThan(5000);

  const dataUrl = await page.evaluate(() => {
    const demo = (window as any).__surfviewPublicationDemo;
    if (!demo) return null;
    return demo.exportPNG();
  });

  expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(dataUrl!.length).toBeGreaterThan(10000);

  await page.getByRole('button', { name: /export png/i }).click();
  await expect(page.locator('[data-publication-status]')).toContainText(/PNG \d+ chars/);
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
