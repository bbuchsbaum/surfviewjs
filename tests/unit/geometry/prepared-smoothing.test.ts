import { describe, expect, it } from 'vitest';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { buildSurfaceSmoothingPlan } from '../../../src/geometry/SurfaceSmoothing';

describe('prepared shared-validity smoothing', () => {
  const domain = new SurfaceDomain({ id: 'tiny', structure: 'test', vertexCount: 3, faces: [0, 1, 2] });
  const metric = new SurfaceMetric(domain, { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], units: 'mm', frame: 'mm' });
  const plan = buildSurfaceSmoothingPlan(metric, { fwhmMm: 2 });
  for (const missing of ['strict', 'renormalize'] as const) it(`matches dense area-Gaussian arithmetic and ordinary apply (${missing})`, () => {
    const validity = new Uint8Array([1, 0, 1]);
    const prepared = plan.prepare({ validity, missing }); validity.fill(0);
    const frames = [[0, NaN, 4], [7, 9, 3], [-2, Infinity, 8]];
    const results = prepared.applyBatch(frames);
    for (let f = 0; f < frames.length; f++) {
      expect(results[f]).toEqual(plan.apply(frames[f]!, { validity: new Uint8Array([1, 0, 1]), missing }));
      if (missing === 'renormalize') for (let row = 0; row < 3; row++) {
        const a = metric.position(row), sigma = 2 / Math.sqrt(8 * Math.log(2));
        const weights = [0, 2].map(v => Math.exp(-0.5 * metric.position(v).reduce((s, x, i) => s + (x - a[i]!) ** 2, 0) / sigma ** 2));
        const expected = (weights[0]! * frames[f]![0]! + weights[1]! * frames[f]![2]!) / (weights[0]! + weights[1]!);
        expect(results[f]!.values[row]).toBeCloseTo(expected, 12);
      }
    }
    results[0]!.coverage.fill(0); expect(prepared.apply(frames[0]!).coverage[0]).toBeGreaterThan(0);
  });
  it('rejects validity drift, unbounded batches and insufficient budgets', () => {
    const prepared = plan.prepare();
    expect(() => prepared.apply([0, NaN, 4])).toThrow(/validity/);
    expect(() => prepared.applyBatch([])).toThrow(/1 to 16/);
    expect(() => prepared.applyBatch(Array(17).fill([0, 2, 4]))).toThrow(/1 to 16/);
    expect(() => plan.prepare({}, 1)).toThrow(/budget/i);
    const empty = plan.prepare({ validity: new Uint8Array(3) }).apply([NaN, NaN, NaN]);
    expect([...empty.valid]).toEqual([0, 0, 0]); expect([...empty.coverage]).toEqual([0, 0, 0]);
  });
});
