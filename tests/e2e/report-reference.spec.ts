import { expect, test } from '@playwright/test';

test('binary reference pixels, keyboard controls, map isolation and offline remount', async ({ page }) => {
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (!['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)) remote.push(request.url()); });
  await page.goto('/tests/report-reference.html');
  await page.waitForFunction(() => (window as any).fixtureReady);
  const observe = () => page.evaluate(() => (window as any).observeFixture());
  const command = (visible: boolean, opacity: number) => page.evaluate(({ visible, opacity }) => {
    const target = (window as any).fixtureHandle.controlTarget;
    const address = { surfaceId: 'left', layerId: 'reference' };
    return [target.setLayerVisibility(address, visible), target.setLayerOpacity(address, opacity)];
  }, { visible, opacity });
  const initial = await observe();
  expect(initial.displayed).toBe('a');
  expect(initial.order).toEqual(['curvature', 'base', 'reference', 'a', 'b']);
  await expect(page.getByLabel('Displayed surface map').locator('option')).toHaveCount(2);
  await expect(page.getByRole('group', { name: 'Anatomical reference' })).toBeVisible();
  await command(false, 0.25);
  const off = await observe();
  await command(true, 1);
  const full = await observe();
  expect(full.pixels[0][0]).toBeGreaterThan(full.pixels[0][1] + 30);
  expect(initial.pixels[0][1]).toBeGreaterThan(full.pixels[0][1] + 10);
  expect(off.pixels[0][1]).toBeGreaterThan(initial.pixels[0][1] + 5);
  expect(full.pixels[1]).toEqual(off.pixels[1]); // opaque effect occludes reference
  expect(full.pixels[1][1]).toBeGreaterThan(full.pixels[1][0] + 30);
  expect(full.pixels[2]).toEqual(off.pixels[2]); // zero membership is transparent
  expect(full.pixels[3][0]).toBeGreaterThan(full.pixels[3][1] + 30);
  expect(full.pixels[4]).toEqual(off.pixels[4]); // mixed triangle, outside fixed midpoint
  for (const result of [off, full]) {
    expect(result.mapping).toEqual(initial.mapping);
    expect(result.legend).toEqual(initial.legend);
    expect(result.inspection).toEqual(initial.inspection);
    expect(result.inspection.values.every((value: any) => value.layerId !== 'reference')).toBe(true);
  }
  const toggle = page.getByRole('checkbox', { name: 'Synthetic region' });
  await toggle.focus();
  await toggle.press('Space');
  await expect(toggle).not.toBeChecked();
  const opacity = page.getByRole('slider', { name: 'Reference opacity' });
  await opacity.focus();
  await opacity.press('Home');
  await opacity.press('ArrowRight');
  await expect(opacity).toHaveValue('0.05');
  await page.getByLabel('Displayed surface map').selectOption('b');
  await page.getByLabel('Displayed surface map').selectOption('a');
  const switched = await observe();
  expect(switched.reference).toMatchObject({ visible: false, opacity: 0.05 });
  expect(switched.mapping).toEqual(initial.mapping);
  expect(switched.order).toEqual(initial.order);
  await page.getByRole('radio', { name: 'Medial' }).check();
  await page.evaluate(() => (window as any).fixtureHandle.resize(640, 400));
  expect((await observe()).reference).toMatchObject({ visible: false, opacity: 0.05 });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  expect((await observe()).reference).toMatchObject({ visible: true, opacity: 0.25 });
  await command(false, 0.8);
  await page.evaluate(() => (window as any).fixtureHandle.resetView());
  expect((await observe()).reference).toMatchObject({ visible: true, opacity: 0.25 });
  await page.screenshot({ path: '/tmp/surfview-reference-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/surfview-reference-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => {
    const oldTarget = (window as any).fixtureHandle.controlTarget;
    (window as any).fixtureHandle.dispose();
    (window as any).fixtureHandle.dispose();
    if (!oldTarget.isDisposed()) throw new Error('Target was not disposed');
    await (window as any).mountFixture(true);
  });
  await expect(page.locator('#viewer canvas')).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Anatomical reference' })).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).fixtureFetches)).toBeGreaterThan(0);
  expect((await observe()).reference).toMatchObject({ visible: true, opacity: 0.25 });
  await command(false, 0.5); // host restores state using supported target commands
  await page.evaluate(() => (window as any).fixtureHandle.dispose());
  await expect(page.locator('#viewer canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});

test('unmasked maps remain above the reference and palette edits retain its state', async ({ page }) => {
  await page.goto('/tests/report-reference.html');
  await page.waitForFunction(() => (window as any).fixtureReady);
  const result = await page.evaluate(async () => {
    const handle = (window as any).fixtureHandle;
    const target = handle.controlTarget;
    const reference = { surfaceId: 'left', layerId: 'reference' };
    const map = { surfaceId: 'left', layerId: 'a' };
    target.setLayerOpacity(reference, 0.6);
    const before = await (window as any).observeFixture();
    const edit = target.updateScalarMapping(map, { colorMapId: 'magma' });
    const palette = await (window as any).observeFixture();
    const unmask = target.updateScalarMapping(map, { maskInterval: [0, 0] });
    const on = await (window as any).observeFixture();
    target.setLayerVisibility(reference, false);
    const off = await (window as any).observeFixture();
    handle.dispose();
    return { before, edit, palette, unmask, on, off };
  });
  expect(result.edit).toEqual({ ok: true });
  expect(result.palette.reference).toMatchObject({ visible: true, opacity: 0.6 });
  expect(result.palette.pixels[0]).toEqual(result.before.pixels[0]);
  expect(result.unmask).toEqual({ ok: true });
  expect(result.on.pixels).toEqual(result.off.pixels);
});
