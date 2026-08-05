import { expect, test } from '@playwright/test';

test('offline embed mounts once, switches maps, exports, and disposes cleanly', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const remoteRequests: string[] = [];

  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => failedRequests.push(request.url()));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      remoteRequests.push(request.url());
    }
  });

  await page.goto('/tests/embed-scene.html');
  await page.waitForFunction(() => (window as any).__surfviewReady === true);

  await expect(page.locator('#viewer canvas')).toHaveCount(1);
  await expect(page.getByRole('toolbar', { name: 'Surface report controls' })).toBeVisible();
  await expect(page.getByLabel('Displayed surface map')).toHaveValue('contrast');
  await expect(page.locator('.surfview-report-controls')).not.toContainText('Tweakpane');

  const runtime = await page.evaluate(() => {
    const global = (window as any).surfview;
    const handle = (window as any).__surfviewHandle;
    const viewer = handle.viewer;
    return {
      revision: global.SURFVIEW_EMBED_THREE_REVISION,
      surfaces: viewer.getSurfaceIds(),
      contexts: (window as any).__webglContexts.size,
      background: viewer.stylePreset.name,
      tweakpaneGlobal: Boolean((window as any).Tweakpane || (window as any).tweakpane)
    };
  });
  expect(runtime).toEqual({
    revision: '185',
    surfaces: ['left', 'right'],
    contexts: 1,
    background: 'paper-light',
    tweakpaneGlobal: false
  });

  const remountCheck = await page.evaluate(async () => {
    const handle = (window as any).__surfviewHandle;
    const originalViewer = handle.viewer;
    const spacer = document.createElement('div');
    spacer.style.height = '1800px';
    document.body.appendChild(spacer);
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(resolve => setTimeout(resolve, 50));
    window.scrollTo(0, 0);
    await new Promise(resolve => setTimeout(resolve, 50));
    return {
      sameViewer: handle.viewer === originalViewer,
      contexts: (window as any).__webglContexts.size,
      canvases: document.querySelectorAll('#viewer canvas').length
    };
  });
  expect(remountCheck).toEqual({ sameViewer: true, contexts: 1, canvases: 1 });

  const identityPreserved = await page.evaluate(() => {
    const handle = (window as any).__surfviewHandle;
    const viewer = handle.viewer;
    const before = viewer.getSurfaceIds().map((id: string) => viewer.getSurface(id).geometry);
    handle.selectLayer('response');
    const after = viewer.getSurfaceIds().map((id: string) => viewer.getSurface(id).geometry);
    return before.every((geometry: unknown, index: number) => geometry === after[index]);
  });
  expect(identityPreserved).toBe(true);
  await expect(page.getByLabel('Displayed surface map')).toHaveValue('response');
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.getByRole('button', { name: 'Medial' }).click();
  await expect(page.getByRole('button', { name: 'Medial' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Dorsal' }).click();
  await expect(page.getByRole('button', { name: 'Dorsal' })).toHaveAttribute('aria-pressed', 'true');

  const png = await page.evaluate(() => (window as any).__surfviewHandle.exportPNG({
    width: 320,
    height: 240,
    colorbar: true
  }));
  expect(png).toMatch(/^data:image\/png;base64,/);

  await page.evaluate(() => {
    const handle = (window as any).__surfviewHandle;
    handle.dispose();
    handle.dispose();
  });
  await page.waitForTimeout(50);
  await expect(page.locator('#viewer canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__activeAnimationFrames.size)).toBe(0);

  expect(remoteRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
