import { describe, expect, it } from 'vitest';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { smoothSurfaceBatch, smoothSurfaceBatchSteps, buildSurfaceSmoothingPlan } from '../../../src/geometry/SurfaceSmoothing';
import { GeometryExecutor } from '../../../src/geometry/GeometryExecutor';

const domain = new SurfaceDomain({ id: 'batch-triangle', structure: 'test', vertexCount: 3, faces: [0, 1, 2] });
const metric = new SurfaceMetric(domain, { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], frame: 'mm', units: 'mm' });
describe('bounded shared-neighborhood streaming', () => {
  it('matches the independent Gaussian mean for distinct missingness in each frame', () => {
    const frames = [[0, 2, 4], [7, NaN, 3]], masks = [new Uint8Array([1, 1, 0]), new Uint8Array([1, 0, 1])];
    const results = smoothSurfaceBatch(metric, frames, { fwhmMm: 2 }, { frameValidity: masks });
    const sigma = 2 / Math.sqrt(8 * Math.log(2));
    for (let f = 0; f < 2; f++) for (let row = 0; row < 3; row++) {
      const point = metric.position(row), distance2 = (v: number) => metric.position(v).reduce((s, x, j) => s + (x - point[j]!) ** 2, 0);
      const w = [0, 1, 2].map(v => Math.exp(-distance2(v) / (2 * sigma ** 2))), keep = [0, 1, 2].filter(v => masks[f]![v]);
      const mass = keep.reduce((s, v) => s + w[v]!, 0), mean = keep.reduce((s, v) => s + w[v]! * frames[f]![v]!, 0) / mass;
      expect(results[f]!.values[row]).toBeCloseTo(mean, 12);
      expect(results[f]!.coverage[row]).toBeCloseTo(mass / w.reduce((a, b) => a + b), 12);
    }
  });
  it('matches retained plans for strict/renormalized masks and zero-width identity', () => {
    for (const fwhmMm of [0, 2]) for (const missing of ['strict', 'renormalize'] as const) {
      const values = [[0, 2, 4], [NaN, 3, 0]], validity = new Uint8Array([1, 0, 1]);
      const result = smoothSurfaceBatch(metric, values, { fwhmMm }, { validity, missing, minCoverage: 0.3 });
      const plan = buildSurfaceSmoothingPlan(metric, { fwhmMm });
      for (let f = 0; f < values.length; f++) expect(result[f]).toEqual(plan.apply(values[f]!, { validity, missing, minCoverage: 0.3 }));
    }
  });
  it('captures queued frames and masks and rejects malformed/unbounded requests', async () => {
    const frame = new Float64Array([1, 1, 1]), mask = new Uint8Array([1, 1, 1]), steps = smoothSurfaceBatchSteps(metric, [frame], { fwhmMm: 2 }, { frameValidity: [mask] });
    frame.fill(9); mask.fill(0); const executor = new GeometryExecutor();
    try { expect([...(await executor.run(steps))[0]!.values]).toEqual([1, 1, 1]); } finally { executor.dispose(); }
    expect(() => smoothSurfaceBatch(metric, [], { fwhmMm: 2 })).toThrow(/1 to 16/);
    expect(() => smoothSurfaceBatch(metric, [frame], { fwhmMm: 2 }, { frameValidity: [] })).toThrow(/masks/);
    expect(() => smoothSurfaceBatch(metric, [frame], { fwhmMm: 2, budgetBytes: 10 })).toThrow(/budget/i);
  });
});
