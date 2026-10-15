import { parseGIfTIScalars } from '@src/index.js';

/** The synthetic Gaussian-splat metric shipped with the tests, on fs_LR 32k left. */
export const METRIC_URLS = {
  gaussianSplat: new URL('../../tests/data/gaussian_splat_demo.func.gii', import.meta.url).href
} as const;

export interface GiftiMetric {
  /** One value per vertex; non-finite file values stay NaN (drawn as no data). */
  values: Float32Array;
  /** Finite minimum and maximum, or [0, 0] when the array has no finite values. */
  range: [number, number];
  nonFinite: number;
}

export function parseGiftiMetric(xml: string): GiftiMetric {
  const parsed = parseGIfTIScalars(xml);
  const values = parsed instanceof Float32Array ? parsed : parsed[0]!;
  let min = Infinity, max = -Infinity, nonFinite = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) {
      values[i] = NaN;
      nonFinite++;
      continue;
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { values, range: min <= max ? [min, max] : [0, 0], nonFinite };
}

export async function loadGiftiMetric(url: string): Promise<GiftiMetric> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load metric: HTTP ${response.status}`);
  return parseGiftiMetric(await response.text());
}
