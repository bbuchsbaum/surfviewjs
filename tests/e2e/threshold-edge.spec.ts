import { test, expect } from '@playwright/test';

interface CoverageStats {
  shown: number;
  shownColoured: number;
  nearShown: number;
  nearShownColoured: number;
  hidden: number;
  hiddenTinted: number;
  nearHidden: number;
  nearHiddenTinted: number;
}

interface ThresholdEdgeResult {
  skipped: boolean;
  error?: string;
  initial?: CoverageStats;
  afterThresholdChange?: { mismatches: number; vertices: number };
}

test('threshold edges colour every shown vertex and no hidden one at its pixel', async ({ page }) => {
  await page.goto('/tests/threshold-edge.html');
  const handle = await page.waitForFunction(
    () => (window as unknown as { __THRESHOLD_EDGE_TEST__?: unknown }).__THRESHOLD_EDGE_TEST__,
    null,
    { timeout: 30_000 }
  );
  const result = await handle.jsonValue() as ThresholdEdgeResult;
  expect(result.skipped, result.error ?? 'WebGL2 must be available').toBe(false);
  expect(result.error).toBeUndefined();

  const stats = result.initial!;
  const detail = JSON.stringify(result);
  // The fixture places enough vertices on both sides of the threshold.
  expect(stats.nearShown).toBeGreaterThan(20);
  expect(stats.nearHidden).toBeGreaterThan(20);
  // Shown vertices, including those barely above threshold, are coloured at
  // their own pixel (no erosion of real suprathreshold vertices) ...
  expect(stats.shownColoured, detail).toBe(stats.shown);
  expect(stats.nearShownColoured, detail).toBe(stats.nearShown);
  // ... and hidden vertices, including those barely below it, carry no
  // tint (no "ghost rings" from a symmetric anti-aliasing ramp).
  expect(stats.hiddenTinted, detail).toBe(0);
  expect(stats.nearHiddenTinted, detail).toBe(0);

  // The contour follows an interactive threshold change.
  expect(result.afterThresholdChange!.mismatches, detail).toBe(0);
});
