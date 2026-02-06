import { test, expect } from '@playwright/test';

test('VolumeProjectionLayer renders via WebGL2 (CPU vs GPU match)', async ({ page }) => {
  await page.goto('/tests/test-volume-layer-webgl2.html');

  const handle = await page.waitForFunction(() => (window as any).__VOLUME_LAYER_WEBGL2_TEST__, null, {
    timeout: 30000
  });

  const result = await handle.jsonValue() as any;
  test.skip(!!result?.skipped, result?.reason || 'WebGL2 not available');

  expect(result?.pass).toBe(true);
  expect(Array.isArray(result?.cases)).toBe(true);
  expect(result.cases.length).toBeGreaterThanOrEqual(3);
  expect(result.cases.every((c: any) => c.ok)).toBe(true);
});

