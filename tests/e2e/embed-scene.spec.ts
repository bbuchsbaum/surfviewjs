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
  await expect(page.getByRole('region', { name: 'Surface report controls' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Anatomical view' })).toBeVisible();
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
      reportTarget: Boolean(handle.controlTarget),
      displayedLayer: handle.controlTarget?.getSnapshot()
        .capabilities.exclusiveMap?.displayedLayerId,
      tweakpaneGlobal: Boolean((window as any).Tweakpane || (window as any).tweakpane)
    };
  });
  expect(runtime).toEqual({
    revision: '185',
    surfaces: ['left', 'right'],
    contexts: 1,
    background: 'paper-light',
    reportTarget: true,
    displayedLayer: 'contrast',
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

  const layerSwitch = await page.evaluate(() => {
    const handle = (window as any).__surfviewHandle;
    const viewer = handle.viewer;
    const before = viewer.getSurfaceIds().map((id: string) => viewer.getSurface(id).geometry);
    const legacySelectedLayer = viewer.selectedLayerId;
    handle.selectLayer('response');
    const after = viewer.getSurfaceIds().map((id: string) => viewer.getSurface(id).geometry);
    return {
      identityPreserved: before.every(
        (geometry: unknown, index: number) => geometry === after[index]
      ),
      displayedLayer: handle.controlTarget.getSnapshot()
        .capabilities.exclusiveMap.displayedLayerId,
      legacySelectionUntouched: viewer.selectedLayerId === legacySelectedLayer,
      responseVisibleEverywhere: viewer.getSurfaceIds().every((id: string) => {
        const layers = viewer.getOrderedLayers(id);
        return layers.find((layer: any) => layer.id === 'response')?.visible === true &&
          layers.find((layer: any) => layer.id === 'contrast')?.visible === false;
      })
    };
  });
  expect(layerSwitch).toEqual({
    identityPreserved: true,
    displayedLayer: 'response',
    legacySelectionUntouched: true,
    responseVisibleEverywhere: true
  });
  await expect(page.getByLabel('Displayed surface map')).toHaveValue('response');
  await expect(page.getByRole('status')).toHaveCount(0);

  expect(await page.evaluate(() => (window as any).__surfviewHandle.controlTarget
    .setDisplayedLayer('contrast'))).toEqual({ ok: true });
  await expect(page.getByLabel('Displayed surface map')).toHaveValue('contrast');
  expect(await page.evaluate(() => (window as any).__surfviewHandle.controlTarget
    .setDisplayedLayer('response'))).toEqual({ ok: true });
  await expect(page.getByLabel('Displayed surface map')).toHaveValue('response');

  await page.getByLabel('Displayed surface map').selectOption('contrast');
  await expect.poll(() => page.evaluate(() => (window as any).__surfviewHandle.controlTarget
    .getSnapshot().capabilities.exclusiveMap.displayedLayerId)).toBe('contrast');

  const lateral = page.getByRole('radio', { name: 'Lateral' });
  const medial = page.getByRole('radio', { name: 'Medial' });
  await lateral.focus();
  await lateral.press('ArrowRight');
  await expect(medial).toBeChecked();
  await expect.poll(() => page.evaluate(() => (window as any).__surfviewHandle.controlTarget
    .getSnapshot().view.current.view)).toBe('medial');

  for (const [name, view] of [
    ['Lateral', 'lateral'],
    ['Medial', 'medial'],
    ['Dorsal', 'dorsal'],
    ['Ventral', 'ventral']
  ] as const) {
    const radio = page.getByRole('radio', { name });
    await radio.check();
    await expect(radio).toBeChecked();
    await expect.poll(() => page.evaluate(() => (window as any).__surfviewHandle.controlTarget
      .getSnapshot().view.current.view)).toBe(view);
  }

  const toolbarDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export surface view as PNG' }).click();
  expect((await toolbarDownload).suggestedFilename()).toBe('offline-bilateral-scene.png');

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
  await expect(page.getByRole('region', { name: 'Surface report controls' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__surfviewHandle.controlTarget)).toBeNull();
  expect(await page.evaluate(() => (window as any).__activeAnimationFrames.size)).toBe(0);

  expect(remoteRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
