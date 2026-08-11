import { expect, test } from '@playwright/test';

test('React StrictMode fixture renders and controls one live viewer panel', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/tests/fixtures/react-controls/index.html');
  await page.waitForTimeout(250);
  expect(pageErrors).toEqual([]);
  const controls = page.getByRole('region', { name: 'React cortical controls' });
  await expect(controls).toBeVisible({ timeout: 15000 });
  await expect(controls.locator('[data-layer-id]')).toHaveCount(2);
  await expect(controls.getByRole('button', { name: 'Focus Activation for editing' }))
    .toBeVisible();

  const strictState = await page.evaluate(() => {
    const fixture = window.__surfviewReactControlsFixture;
    return {
      mounts: fixture.mounted.length,
      disposals: fixture.disposed.length,
      plugins: fixture.viewer.listPlugins().length,
      liveHandles: fixture.mounted.filter(handle => !handle.disposed).length
    };
  });
  expect(strictState.mounts).toBeGreaterThanOrEqual(2);
  expect(strictState.disposals).toBe(strictState.mounts - 1);
  expect(strictState.plugins).toBe(1);
  expect(strictState.liveHandles).toBe(1);

  const activation = controls.getByRole('checkbox', { name: 'Show Activation' });
  await activation.uncheck();
  expect(await page.evaluate(() =>
    window.__surfviewReactControlsFixture.viewer
      .getSurface('lh')
      ?.getLayer('activation')
      ?.visible
  )).toBe(false);
  await activation.check();

  await controls.getByRole('combobox', { name: 'Figure style preset' })
    .selectOption('paper-light');
  expect(await page.evaluate(() =>
    window.__surfviewReactControlsFixture.viewer.stylePreset.name
  )).toBe('paper-light');

  await page.evaluate(() => window.__surfviewReactControlsFixture.unmount());
  await expect(controls).toHaveCount(0);
  const released = await page.evaluate(() => {
    const fixture = window.__surfviewReactControlsFixture;
    return {
      mounts: fixture.mounted.length,
      disposals: fixture.disposed.length,
      plugins: fixture.viewer.listPlugins().length,
      allDisposed: fixture.mounted.every(handle => handle.disposed)
    };
  });
  expect(released.disposals).toBe(released.mounts);
  expect(released.plugins).toBe(0);
  expect(released.allDisposed).toBe(true);
  await page.evaluate(() => window.__surfviewReactControlsFixture.disposeViewer());
});
