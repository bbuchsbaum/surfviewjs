import { describe, it, expect } from 'vitest';
import { FlatMapChart } from '../../../src/flatmap/FlatMapChart';
import { buildFlatMapRaster } from '../../../src/flatmap/FlatMapRasterPlan';
import { FlatMapFrame, FlatMapSampler } from '../../../src/flatmap/FlatMapSamplingPlan';
import { FlatMapTileCache } from '../../../src/flatmap/FlatMapTileCache';
import { GeometryExecutor } from '../../../src/geometry/GeometryExecutor';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { triangleLocation, vertexLocation } from '../../../src/geometry/SurfaceLocation';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function fixture() {
  const domain = new SurfaceDomain({ id: 'slab', structure: 'left', vertexCount: 3, faces: [0, 1, 2] });
  const white = new SurfaceMetric(domain, { frame: 'test', units: 'mm', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] });
  const pial = new SurfaceMetric(domain, { frame: 'test', units: 'mm', positions: [0, 0, 2, 1, 0, 2, 0, 1, 2] });
  const chart = new FlatMapChart({ domain, coordinates: [0, 0, 1, 0, 0, 1], faces: [0, 1, 2], anatomicalFaces: [0], anatomicalVertices: [0, 1, 2], units: 'mm' });
  const location = triangleLocation(domain, 0, [0.5, 0.2, 0.3]);
  const values = Float64Array.from({ length: 27 }, (_, i) => i % 3 + 2 * (Math.floor(i / 3) % 3) + 3 * Math.floor(i / 9));
  return { domain, white, pial, chart, location, values };
}

describe('flatmap quantitative sampling', () => {
  it('interpolates an affine scalar, preserving zero and explicit support weights', () => {
    const { domain, location } = fixture(), sampler = new FlatMapSampler({ kind: 'vertex-scalar', domain });
    expect(sampler.inspect(location, new FlatMapFrame([0, 1, 2])).value).toBeCloseTo(0.8, 14);
    expect(sampler.inspect(vertexLocation(domain, 0), new FlatMapFrame([0, NaN, NaN])).status).toBe('valid');
    const masked = new FlatMapFrame([0, 1, 2], new Uint8Array([1, 0, 1]));
    const strict = sampler.inspect(location, masked);
    expect(strict.status).toBe('insufficient-coverage'); expect(strict.coverage).toBeCloseTo(0.8);
    expect(sampler.inspect(location, masked, { missing: 'renormalize', minCoverage: 0.75 }).value).toBeCloseTo(0.75);
    expect(sampler.inspect(location, masked, { missing: 'renormalize', minCoverage: 0.9 }).status).toBe('insufficient-coverage');
  });

  it('samples an affine volume and exact slab mean at midpoint quadrature', () => {
    const f = fixture();
    for (const samples of [1, 2, 8, 32]) {
      const sampler = new FlatMapSampler({ kind: 'volume-scalar', white: f.white, pial: f.pial, frame: 'test',
        dims: [3, 3, 3], voxelToWorld: identity, depth: { interval: [0, 1], samples } });
      const read = sampler.inspect(f.location, new FlatMapFrame(f.values));
      expect(read.value).toBeCloseTo(3.8, 13); expect(read.coverage).toBe(1); expect(read.geometricCoverage).toBe(1);
      expect(read.samples).toHaveLength(samples);
      for (const sample of read.samples) expect(sample.contributors.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 14);
    }
  });

  it('preserves strict trilinear samples when renormalizing across depths', () => {
    const f = fixture(), values = f.values.slice(); values.fill(NaN, 0, 9);
    const sampler = new FlatMapSampler({ kind: 'volume-scalar', white: f.white, pial: f.pial, frame: 'test', dims: [3, 3, 3],
      voxelToWorld: identity, depth: { interval: [0, 1], samples: 2 } });
    const frame = new FlatMapFrame(values), strict = sampler.inspect(f.location, frame);
    expect(strict.status).toBe('insufficient-coverage'); expect(strict.coverage).toBe(0.5);
    expect(strict.geometricCoverage).toBe(1);
    const result = sampler.inspect(f.location, frame, { missing: 'renormalize', minCoverage: 0.5 });
    expect(result.value).toBeCloseTo(5.3, 13);
    expect(result.samples.map(s => s.valid)).toEqual([false, true]);
  });

  it('ignores zero-weight invalid voxels and distinguishes geometric support', () => {
    const f = fixture(), values = new Float64Array(27).fill(NaN); values[0] = 0;
    const sampler = new FlatMapSampler({ kind: 'volume-scalar', white: f.white, pial: f.pial, frame: 'test',
      dims: [3, 3, 3], voxelToWorld: identity, depth: { fraction: 0 } });
    expect(sampler.inspect(vertexLocation(f.domain, 0), new FlatMapFrame(values)).value).toBe(0);
    const shifted = identity.slice(); shifted[12] = 10;
    const outside = new FlatMapSampler({ kind: 'volume-scalar', white: f.white, pial: f.pial, frame: 'test',
      dims: [3, 3, 3], voxelToWorld: shifted, depth: { fraction: 0.5 } });
    const read = outside.inspect(f.location, new FlatMapFrame(f.values));
    expect(read.status).toBe('out-of-volume'); expect(read.geometricCoverage).toBe(0);
  });

  it('transforms a rotated, sheared, anisotropic volume grid in the declared frame', () => {
    const f = fixture();
    const affine = [0, 2, 0, 0, -3, 0.5, 0, 0, 0.2, 0, 4, 0, 10, 20, 30, 1];
    const transform = (p: Float64Array) => Float64Array.from(p, (_, i) => {
      const v = Math.floor(i / 3) * 3, axis = i % 3;
      return affine[axis]! * p[v]! + affine[axis + 4]! * p[v + 1]! + affine[axis + 8]! * p[v + 2]! + affine[axis + 12]!;
    });
    const white = new SurfaceMetric(f.domain, { frame: 'test', units: 'mm', positions: transform(f.white.copyPositions()) });
    const pial = new SurfaceMetric(f.domain, { frame: 'test', units: 'mm', positions: transform(f.pial.copyPositions()) });
    const sampler = new FlatMapSampler({ kind: 'volume-scalar', white, pial, frame: 'test', dims: [3, 3, 3],
      voxelToWorld: affine, depth: { fraction: 0.5 } });
    expect(sampler.inspect(f.location, new FlatMapFrame(f.values)).value).toBeCloseTo(3.8, 12);
  });

  it('reuses prepared stencils for replacement frames and cooperative application', async () => {
    const f = fixture(), sampler = new FlatMapSampler({ kind: 'vertex-scalar', domain: f.domain });
    const grid = { bounds: f.chart.bounds, width: 12, height: 12 };
    const raster = buildFlatMapRaster(f.chart, grid, { x: 0, y: 0, width: 12, height: 12 });
    const plan = sampler.prepare(raster), input = [2, 2, 2], frame = new FlatMapFrame(input); input[0] = 99;
    const a = plan.apply(frame), executor = new GeometryExecutor({ timeSliceMs: 1 });
    const b = await executor.run(plan.applySteps(frame));
    expect(b.values).toEqual(a.values); expect(b.status).toEqual(a.status);
    for (let i = 0; i < a.values.length; i++) if (a.valid[i]) expect(a.values[i]).toBeCloseTo(2, 14);
    expect([...a.status]).toContain(0);
    const changed = plan.apply(new FlatMapFrame([4, 4, 4]));
    for (let i = 0; i < changed.values.length; i++) if (changed.valid[i]) expect(changed.values[i]).toBeCloseTo(4, 14);
    const abort = new AbortController(); abort.abort();
    await expect(executor.run(plan.applySteps(frame), { signal: abort.signal })).rejects.toThrow(/cancelled/);
    executor.dispose();
    expect(() => sampler.prepare(raster, 1)).toThrow(/budget/);
    expect(() => plan.apply(new FlatMapFrame([1]))).toThrow(/length/);
  });

  it('evicts least-recently-used owned resources within a byte budget', () => {
    const freed: string[] = [], cache = new FlatMapTileCache<string>(10, v => { freed.push(v); });
    cache.set('a', 'a', 4); cache.set('b', 'b', 4); cache.get('a'); cache.set('c', 'c', 4);
    expect(cache.get('b')).toBeUndefined(); expect(freed).toEqual(['b']); expect(cache.byteLength).toBe(8);
    expect(() => cache.set('huge', 'h', 11)).toThrow(/budget/);
    expect(cache.byteLength).toBe(8); cache.clear(); expect(cache.byteLength).toBe(0);
    expect(freed.sort()).toEqual(['a', 'b', 'c']);
  });
});

it('reproduces a multilinear volume oracle and snapshots queued raster/policy inputs', () => {
  const f = fixture();
  const formula = (x: number, y: number, z: number) => x * y + 2 * y * z + 0.5 * x * z + 0.3 * x * y * z;
  const values = Float64Array.from({ length: 27 }, (_, i) => formula(i % 3, Math.floor(i / 3) % 3, Math.floor(i / 9)));
  const sampler = new FlatMapSampler({ kind: 'volume-scalar', white: f.white, pial: f.pial, frame: 'test', dims: [3, 3, 3], voxelToWorld: identity, depth: { interval: [0, 1], samples: 8 } });
  const expected = Array.from({ length: 8 }, (_, i) => formula(0.2, 0.3, (i + 0.5) / 4)).reduce((a, b) => a + b, 0) / 8;
  expect(sampler.inspect(f.location, new FlatMapFrame(values)).value).toBeCloseTo(expected, 13);
  const raster = buildFlatMapRaster(f.chart, { bounds: f.chart.bounds, width: 8, height: 8 }, { x: 0, y: 0, width: 8, height: 8 });
  const steps = sampler.prepareSteps(raster); raster.faces.fill(-1); raster.weights.fill(NaN);
  let result = steps.next(); while (!result.done) result = steps.next();
  const prepared = result.value.apply(new FlatMapFrame(values)); expect(prepared.valid.some(Boolean)).toBe(true);
});

it('keeps depth-sample mean distinct from an area-expanding ribbon mean', () => {
  const f = fixture(), white = new SurfaceMetric(f.domain, { positions: [0,0,0,1,0,0,0,1,0], frame: 'test', units: 'mm' });
  const pial = new SurfaceMetric(f.domain, { positions: [0,0,1,2,0,1,0,2,1], frame: 'test', units: 'mm' });
  const sampler = new FlatMapSampler({ kind: 'volume-scalar', white, pial, dims: [3,3,3], frame: 'test', voxelToWorld: identity, depth: { interval: [0,1], samples: 32 } });
  const values = Float64Array.from({ length: 27 }, (_, i) => Math.floor(i / 9));
  const value = sampler.inspect(vertexLocation(f.domain, 0), new FlatMapFrame(values)).value;
  expect(value).toBeCloseTo(0.5, 14);
  // Independent continuum integral: area(d)=(1+d)^2, field(d)=d gives 17/28.
  expect(Math.abs(value - 17 / 28)).toBeGreaterThan(0.1);
});
