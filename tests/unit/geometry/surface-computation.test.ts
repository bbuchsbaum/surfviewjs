import { describe, expect, it } from 'vitest';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { computeVertexAreas, summarizeSurfaceRegion, clusterSurfaceByArea } from '../../../src/geometry/SurfaceArea';
import { buildSurfaceSmoothingPlan, buildSurfaceSmoothingPlanSteps, smoothSurfaceValues } from '../../../src/geometry/SurfaceSmoothing';
import { GeometryExecutor } from '../../../src/geometry/GeometryExecutor';
import { SurfaceTriangleIndex } from '../../../src/geometry/SurfaceTriangleIndex';
import { SurfaceResamplingPlan, buildSurfaceResamplingPlan, exportSurfaceResamplingPlan, importSurfaceResamplingPlan } from '../../../src/geometry/SurfaceResampling';
import { buildRibbonIntegrationPlan, tetrahedronVoxelIntersectionVolume } from '../../../src/geometry/RibbonIntegration';

function triangle(z = 0) {
  const domain = new SurfaceDomain({ id: 'triangle', structure: 'left', vertexCount: 3, faces: [0, 1, 2] });
  return new SurfaceMetric(domain, { positions: [0, 0, z, 1, 0, z, 0, 1, z], frame: 'anatomical', units: 'mm' });
}
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('area estimands and reusable smoothing', () => {
  it('reduces sampling-density bias against the symmetric continuous Gaussian integral', () => {
    const xs = [...Array.from({ length: 21 }, (_, i) => -1 + i * 0.05), 0.5, 1], ys = [-1, -0.5, 0, 0.5, 1], positions: number[] = [], faces: number[] = [];
    for (const y of ys) for (const x of xs) positions.push(x, y, 0);
    for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) { const a = y * xs.length + x, b = a + 1, c = a + xs.length, d = c + 1; faces.push(a, b, d, a, d, c); }
    const domain = new SurfaceDomain({ id: 'nonuniform', structure: 'synthetic', vertexCount: positions.length / 3, faces }), metric = new SurfaceMetric(domain, { positions, frame: 'plane', units: 'mm' });
    const plan = buildSurfaceSmoothingPlan(metric, { fwhmMm: 1.5 }), seed = xs.length * 2 + 20, values = positions.filter((_, i) => i % 3 === 0), weights = plan.copyWeights(), areas = computeVertexAreas(metric);
    let sum = 0, denominator = 0;
    for (let i = weights.offsets[seed]!; i < weights.offsets[seed + 1]!; i++) { const v = weights.indices[i]!, weight = weights.weights[i]! / areas[v]!; sum += weight * values[v]!; denominator += weight; }
    // On [-1,1]^2, x*exp(-(x²+y²)/(2σ²)) is odd: its continuous integral is exactly zero.
    const areaWeightedError = Math.abs(plan.apply(values).values[seed]!), vertexWeightedError = Math.abs(sum / denominator);
    expect(vertexWeightedError).toBeGreaterThan(0.2);
    expect(areaWeightedError).toBeLessThan(0.08);
    expect(areaWeightedError).toBeLessThan(vertexWeightedError / 2);
  });
  it('integrates an analytic linear field and distinguishes parcel area semantics', () => {
    const metric = triangle(), areas = computeVertexAreas(metric);
    expect(Array.from(areas)).toEqual([1 / 6, 1 / 6, 1 / 6]);
    const member = summarizeSurfaceRegion(metric, [0, 1, 1], { mode: 'vertex-membership', roi: new Uint8Array([1, 0, 0]) });
    const piece = summarizeSurfaceRegion(metric, [0, 1, 1], { mode: 'label-partition', labels: [7, 8, 8], selectedLabels: [7] });
    expect(member.totalAreaMm2).toBeCloseTo(1 / 6, 14);
    expect(piece.totalAreaMm2).toBeCloseTo(1 / 8, 14);
    // Singleton piece is triangle (0,0),(.5,0),(0,.5), mean x+y=1/3.
    expect(piece.mean).toBeCloseTo(1 / 3, 14); expect(piece.integral).toBeCloseTo(1 / 24, 14);
    const missing = summarizeSurfaceRegion(metric, [0, NaN, 1], { mode: 'label-partition', labels: [7, 8, 8], selectedLabels: [7] });
    expect(missing.validAreaMm2).toBe(0); expect(missing.mean).toBeNaN();
  });
  it('preserves constants, distinguishes valid zero, and reports retained kernel support', async () => {
    const metric = triangle(), plan = buildSurfaceSmoothingPlan(metric, { fwhmMm: 2 });
    plan.apply([7, 7, 7]).values.forEach(x => expect(x).toBeCloseTo(7, 13));
    const weights = plan.copyWeights();
    expect(weights.weights[0]).toBeGreaterThan(weights.weights[1]!);
    const missing = plan.apply([0, NaN, 0]);
    expect(smoothSurfaceValues(metric, [0, NaN, 0], { fwhmMm: 2 })).toEqual(missing);
    const frame = new Float64Array([0, 2, 4]), queued = plan.applySteps(frame);
    frame.fill(100); const captured = await new GeometryExecutor().run(queued);
    expect(captured).toEqual(plan.apply([0, 2, 4]));
    expect([...missing.values]).toEqual([0, 0, 0]); expect(missing.coverage[0]).toBeLessThan(1);
    expect(plan.apply([0, NaN, 0], { minCoverage: 1 }).values[0]).toBeNaN();
    const executor = new GeometryExecutor(), asyncPlan = await executor.run(buildSurfaceSmoothingPlanSteps(metric, { fwhmMm: 2 }));
    expect(asyncPlan.copyWeights()).toEqual(weights); executor.dispose();
    expect([...buildSurfaceSmoothingPlan(metric, { fwhmMm: 0 }).apply([0, 2, 4]).values]).toEqual([0, 2, 4]);
    expect(() => buildSurfaceSmoothingPlan(metric, { fwhmMm: 2, budgetBytes: 8 })).toThrow(/budget/);
  });
  it('separates touching signs and filters by physical area', () => {
    const metric = triangle();
    const separate = clusterSurfaceByArea(metric, [3, -3, 3], { threshold: 2, minAreaMm2: 0.2 });
    expect([...separate.mask]).toEqual([1, 0, 1]); expect([...separate.areasMm2]).toEqual([1 / 3, 1 / 6]);
    expect([...clusterSurfaceByArea(metric, [3, -3, 3], { threshold: 2, minAreaMm2: 0.2, signMode: 'absolute' }).mask]).toEqual([1, 1, 1]);
  });
});

describe('triangle projection and resampling', () => {
  it('projects onto interiors, edges and vertices with correct Euclidean ranking', () => {
    const index = new SurfaceTriangleIndex(triangle());
    const interior = index.closest([0.2, 0.3, 2]);
    expect(interior.distanceSquared).toBeCloseTo(4, 14); expect([...interior.point]).toEqual([0.2, 0.3, 0]);
    expect([...index.closest([1, 1, 0]).point]).toEqual([0.5, 0.5, 0]);
    expect([...index.closest([-1, -1, 0]).point]).toEqual([0, 0, 0]);
  });
  it('applies coalesced rows, weighted label votes, masks and checksummed round trips', async () => {
    const domain = triangle().domain;
    const plan = new SurfaceResamplingPlan(domain, domain, { offsets: [0, 3, 5, 5], indices: [1, 0, 1, 1, 2], weights: [0.25, 0.5, 0.25, 0.5, 0.5], supportCoverage: [1, 0.5, 0] }, { method: 'provided', correspondence: 'fixture' });
    expect([...plan.apply([0, 2, 4]).values].slice(0, 2)).toEqual([1, NaN]);
    expect(plan.apply([0, 2, 4], { minCoverage: 0.5 }).values[1]).toBe(3);
    expect(plan.applyLabels([9, -2, 20]).values[0]).toBe(-2);
    expect(plan.apply([0, NaN, 4]).values[0]).toBeNaN();
    expect(plan.apply([0, NaN, 4], { missing: 'renormalize' }).coverage[0]).toBe(0.5);
    const artifact = await exportSurfaceResamplingPlan(plan), restored = await importSurfaceResamplingPlan(artifact, domain, domain);
    expect(restored.copyWeights()).toEqual(plan.copyWeights());
    artifact.assets.weights.base64 = artifact.assets.weights.base64.replace(/^./, 'A');
    // Mutate a definitely significant byte, preserving a valid encoding.
    const bytes = atob(artifact.assets.weights.base64); artifact.assets.weights.base64 = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1));
    await expect(importSurfaceResamplingPlan(artifact, domain, domain)).rejects.toThrow(/checksum/);
    expect(() => new SurfaceResamplingPlan(domain, domain, { offsets: [0, 1, 1, 1], indices: [0], weights: [2] }, { method: 'provided', correspondence: 'fixture' })).toThrow(/sum/);
  });
  it('constructs registered sphere identity with both named methods and rejects frame mismatches', () => {
    const d = new SurfaceDomain({ id: 'octahedron', structure: 'left', vertexCount: 6, faces: [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5] });
    const sphere = new SurfaceMetric(d, { positions: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1], frame: 'registered', units: 'mm' });
    const pair = { source: sphere, target: sphere, registration: { id: 'identity-registration', frame: 'registered', center: [0, 0, 0] as const, radiusMm: 1 } };
    const values = [1, -1, 0.7, 0, 0.1, -0.9];
    for (const method of ['barycentric-closest', 'adaptive-barycentric-area'] as const) expect([...buildSurfaceResamplingPlan(pair, { method, sourceAreaMetric: sphere, targetAreaMetric: sphere }).apply(values).values]).toEqual(values);
    expect(() => buildSurfaceResamplingPlan({ ...pair, registration: { ...pair.registration, frame: 'wrong' } })).toThrow(/frame/);
  });
});

describe('tetrahedral ribbon integration', () => {
  it('clips tetrahedra against analytic voxel halfspaces, including contacts', () => {
    const tet = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] as const;
    // Volume remaining after excluding the three disjoint corner tets (each volume 1/48).
    expect(tetrahedronVoxelIntersectionVolume(tet, [0, 0, 0])).toBeCloseTo(5 / 48, 13);
    expect(tetrahedronVoxelIntersectionVolume(tet, [1, 0, 0])).toBeCloseTo(1 / 48, 13);
    expect(tetrahedronVoxelIntersectionVolume(tet, [2, 0, 0])).toBe(0);
  });
  it('tiles a slab with positive column volumes, valid zeros and explicit partial coverage', () => {
    const white = triangle(), pial = new SurfaceMetric(white.domain, { positions: [0, 0, 1, 1, 0, 1, 0, 1, 1], frame: white.frame, units: 'mm' });
    const plan = buildRibbonIntegrationPlan({ domain: white.domain, whiteMetric: white, pialMetric: pial, volumeGrid: { dims: [2, 2, 2], voxelToWorld: identity, units: 'mm', frame: white.frame } });
    const result = plan.apply([0, 0, 0, 0, 2, 2, 2, 2]);
    expect(result.totalVolumeMm3.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5, 13);
    for (let v = 0; v < 3; v++) { expect(result.totalVolumeMm3[v]).toBeCloseTo(1 / 6, 13); expect(result.values[v]).toBeCloseTo(1, 12); expect(result.validCoverage[v]).toBeCloseTo(1, 12); }
    const missing = plan.apply([0, 0, 0, 0, NaN, NaN, NaN, NaN]);
    expect([...missing.values].every(Number.isNaN)).toBe(true);
    const partial = plan.apply([0, 0, 0, 0, NaN, NaN, NaN, NaN], { minCoverage: 0.49 });
    expect([...partial.values]).toEqual([0, 0, 0]); partial.validCoverage.forEach(c => expect(c).toBeCloseTo(0.5, 12));
    expect(() => buildRibbonIntegrationPlan({ domain: white.domain, whiteMetric: pial, pialMetric: white, volumeGrid: { dims: [2, 2, 2], voxelToWorld: identity, units: 'mm', frame: white.frame } })).toThrow(/inverted/);
  });
  it('keeps voxel volumes under shear/scaling and accepts a reflected grid affine', () => {
    const source = triangle(), transformed = [0, 0, 0, 2, 0, 0, 0.5, 3, 0];
    const white = new SurfaceMetric(source.domain, { positions: transformed, frame: source.frame, units: 'mm' });
    const pial = new SurfaceMetric(source.domain, { positions: transformed.map((x, i) => i % 3 === 2 ? x + 4 : x), frame: source.frame, units: 'mm' });
    const affine = [2, 0, 0, 0, 0.5, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1];
    const result = buildRibbonIntegrationPlan({ domain: source.domain, whiteMetric: white, pialMetric: pial, volumeGrid: { dims: [2, 2, 2], voxelToWorld: affine, frame: source.frame, units: 'mm' } }).apply([0, 0, 0, 0, 2, 2, 2, 2]);
    expect(result.totalVolumeMm3.reduce((a, b) => a + b, 0)).toBeCloseTo(12, 11);
    result.values.forEach(x => expect(x).toBeCloseTo(1, 11));
    const ordinaryPial = new SurfaceMetric(source.domain, { positions: [0, 0, 1, 1, 0, 1, 0, 1, 1], frame: source.frame, units: 'mm' });
    const reflected = [...identity]; reflected[0] = -1; reflected[12] = 1;
    const mirror = buildRibbonIntegrationPlan({ domain: source.domain, whiteMetric: source, pialMetric: ordinaryPial, volumeGrid: { dims: [2, 2, 2], voxelToWorld: reflected, frame: source.frame, units: 'mm' } }).apply([0, 0, 0, 0, 2, 2, 2, 2]);
    mirror.values.forEach(x => expect(x).toBeCloseTo(1, 11));
  });
});
