import { describe, expect, it } from 'vitest';
import fixture from './binary32-fixture.json';
import halfspace from './binary32-halfspace-fixture.json';
import vertexFixture from './binary32-vertex-fixture.json';
import { fma32, normalizeBinary32, Binary32Chart } from '../../../src/geometry/Binary32Chart';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { SurfaceTriangleIndex } from '../../../src/geometry/SurfaceTriangleIndex';

describe('specified binary32 chart arithmetic', () => {
  it('resolves fused midpoint double-rounding independently of binary64 evaluation', () => {
    const a = (1 + 2 ** -23) * 2 ** -12, b = (1 - 2 ** -23) * 2 ** -12, c = 1 + 2 ** -23;
    // Exact product is 2^-24 - 2^-70, so the exact sum is below the midpoint.
    expect(Math.fround(a * b + c)).toBe(1 + 2 ** -22);
    expect(fma32(a, b, c)).toBe(c);
    expect(fma32(-a, b, -c)).toBe(-c);
    expect(fma32(1, 2, 3)).toBe(5);
  });
  it('matches the retained externally recovered edge without deleting interior weights', () => {
    const ids = [18022, 18039, 18040, 18056] as const;
    const raw = ids.flatMap(id => fixture.nodesRaw[String(id) as keyof typeof fixture.nodesRaw]);
    const points = ids.map(id => normalizeBinary32(fixture.nodesRaw[String(id) as keyof typeof fixture.nodesRaw], [0, 0, 0], 100));
    const query = normalizeBinary32(fixture.queryRaw, [0, 0, 0], 100);
    const faces = [2, 0, 1, 3, 2, 1];
    const domain = new SurfaceDomain({ id: 'external-edge', structure: 'left', vertexCount: 4, faces });
    const metric = new SurfaceMetric(domain, { positions: points.flat(), frame: 'sphere', units: 'mm' });
    const precise = new SurfaceTriangleIndex(metric, { leafSize: 1 }).closest(query);
    const profiled = new SurfaceTriangleIndex(metric, { leafSize: 1, projectionProfile: 'binary32-chart-fma-v1' }).closest(query);
    expect(precise.face).toBe(1); expect(profiled.face).toBe(0);
    const location = profiled.location; expect(location.kind).toBe('triangle');
    if (location.kind === 'triangle') {
      expect(location.weights[0]).toBe(0.6420423984527588);
      expect(location.weights[1]).toBe(0); expect(location.weights[2]).toBe(0.3579576015472412);
    }
    const inside = new Binary32Chart(points[3]!, points[2]!, points[1]!).project(query);
    expect(inside.weights[0]).toBeGreaterThan(0.0001);
    expect(raw.length).toBe(12);
  });
});

it('matches exact integer round-to-even FMA across exponents and cancellation', () => {
  const decode = (v: number) => {
    if (v === 0) return { n: 0n, e: 0 };
    const e = Math.floor(Math.log2(Math.abs(v))) - 23;
    return { n: BigInt(Math.round(v / 2 ** e)), e };
  };
  const reference = (a: number, b: number, c: number) => {
    const x = decode(a), y = decode(b), z = decode(c), exponent = Math.min(x.e + y.e, z.e);
    const sum = (x.n * y.n << BigInt(x.e + y.e - exponent)) + (z.n << BigInt(z.e - exponent));
    if (sum === 0n) return 0;
    const sign = sum < 0 ? -1 : 1, n = sum < 0 ? -sum : sum;
    const target = Math.max(exponent + n.toString(2).length - 24, -149), shift = target - exponent;
    let rounded: bigint;
    if (shift <= 0) rounded = n << BigInt(-shift);
    else {
      rounded = n >> BigInt(shift);
      const remainder = n - (rounded << BigInt(shift)), halfway = 1n << BigInt(shift - 1);
      if (remainder > halfway || (remainder === halfway && (rounded & 1n))) rounded++;
    }
    return Math.fround(sign * Number(rounded) * 2 ** target);
  };
  let state = 1729;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
  const operand = () => Math.fround((random() < 0.5 ? -1 : 1) * (1 + random()) * 2 ** Math.floor(random() * 276 - 149));
  for (let i = 0; i < 1500; i++) {
    const a = operand(), b = operand(), c = operand();
    expect(fma32(a, b, c)).toBe(reference(a, b, c));
  }
});

it('keeps indexed float scoring equal to exhaustive enumeration at several scales', () => {
  let state = 20261027;
  const random = () => ((state = (1103515245 * state + 12345) >>> 0) / 2 ** 32);
  const points = Float64Array.from({ length: 36 * 9 }, () => Math.fround((random() - 0.5) * 200));
  const domain = new SurfaceDomain({ id: 'float-soup', structure: 'test', vertexCount: 108, faces: Array.from({ length: 108 }, (_, i) => i) });
  const metric = new SurfaceMetric(domain, { positions: points, frame: 'test', units: 'mm' });
  const charts = Array.from({ length: 36 }, (_, face) => new Binary32Chart(points.subarray(face * 9, face * 9 + 3), points.subarray(face * 9 + 3, face * 9 + 6), points.subarray(face * 9 + 6, face * 9 + 9)));
  for (const leafSize of [1, 8]) {
    const index = new SurfaceTriangleIndex(metric, { projectionProfile: 'binary32-chart-fma-v1', leafSize });
    for (let i = 0; i < 60; i++) {
      const point = Float64Array.from({ length: 3 }, () => (random() - 0.5) * (i % 2 ? 200 : 2000));
      const expected = charts.map((chart, face) => ({ ...chart.project(point), face })).sort((a, b) => a.distanceSquared - b.distanceSquared || a.face - b.face)[0]!;
      const got = index.closest(point);
      expect(got.face).toBe(expected.face); expect(got.distanceSquared).toBe(expected.distanceSquared);
    }
  }
});

it('round-trips the explicit numeric profile and retains the raw default', async () => {
  const { buildSurfaceResamplingPlan, exportSurfaceResamplingPlan, importSurfaceResamplingPlan } = await import('../../../src/geometry/SurfaceResampling');
  const ids = [18022, 18039, 18040, 18056] as const, positions = ids.flatMap(id => fixture.nodesRaw[String(id) as keyof typeof fixture.nodesRaw]);
  const sourceDomain = new SurfaceDomain({ id: 'profile-source', structure: 'left', vertexCount: 4, faces: [2, 0, 1, 3, 2, 1] });
  const targetDomain = new SurfaceDomain({ id: 'profile-target', structure: 'left', vertexCount: 3, faces: [0, 1, 2] });
  const source = new SurfaceMetric(sourceDomain, { positions, frame: 'registered', units: 'mm' }), target = new SurfaceMetric(targetDomain, { positions: [...fixture.queryRaw, ...positions.slice(0, 3), ...positions.slice(9, 12)], frame: 'registered', units: 'mm' });
  const pair = { source, target, registration: { id: 'external-fixture', frame: 'registered', center: [0, 0, 0] as const, radiusMm: 100 } };
  const raw = buildSurfaceResamplingPlan(pair), profiled = buildSurfaceResamplingPlan(pair, { projectionProfile: 'binary32-chart-fma-v1', sphereNormalization: 'radius' });
  expect(raw.provenance.projectionProfile).toBeUndefined();
  const artifact = await exportSurfaceResamplingPlan(profiled), restored = await importSurfaceResamplingPlan(artifact, sourceDomain, targetDomain);
  expect(restored.provenance.projectionProfile).toBe('binary32-chart-fma-v1');
  expect(restored.apply([0, 1, 2, 3])).toEqual(profiled.apply([0, 1, 2, 3]));
});

it('keeps common-vertex weights valid across translated small charts', () => {
  let state = 119351;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 100; i++) {
    const vertices = Array.from({ length: 3 }, () => [Math.fround(-60 + random() * 3), Math.fround(20 + random() * 3), Math.fround(75 + random() * 3)]);
    const chart = new Binary32Chart(vertices[0]!, vertices[1]!, vertices[2]!);
    for (let j = 0; j < 3; j++) {
      const result = chart.project(vertices[j]!);
      expect(result.weights.every(w => w >= 0 && Number.isFinite(w))).toBe(true);
      expect(result.weights.reduce((a, b) => a + b)).toBeCloseTo(1, 14);
    }
  }
});


it('uses the rounded edge half-space at the retained nested-template boundary', async () => {
  const query = normalizeBinary32(halfspace.queryRaw, [0, 0, 0], 100);
  const triangles = halfspace.trianglesRaw.map(t => t.vertices.map(v => normalizeBinary32(v, [0, 0, 0], 100)));
  for (let face = 0; face < 2; face++) {
    const t = triangles[face]!, raw = halfspace.trianglesRaw[face]!;
    const result = new Binary32Chart(t[0]!, t[1]!, t[2]!).project(query);
    const expected = halfspace.expectedIsolatedWeightsBySourceVertex[String(raw.face) as keyof typeof halfspace.expectedIsolatedWeightsBySourceVertex] as Record<string, number>;
    expect(result.weights).toEqual(raw.nodes.map(v => expected[String(v)] ?? 0));
  }
  const ids = [2674, 754, 2673, 2675], positions = [...triangles[0]!.flat(), ...triangles[1]![1]!];
  const domain = new SurfaceDomain({ id: 'halfspace-source', structure: 'left', vertexCount: 4, faces: [0, 1, 2, 0, 3, 1] });
  const source = new SurfaceMetric(domain, { positions, frame: 'registered', units: 'mm' });
  for (const leafSize of [1, 8]) {
    const got = new SurfaceTriangleIndex(source, { projectionProfile: 'binary32-chart-fma-v1', leafSize }).closest(query);
    expect(got.face).toBe(1); expect(got.distanceSquared).toBe(0);
    if (got.location.kind === 'triangle') expect(got.location.weights).toEqual([2 ** -22, 0, 1 - 2 ** -22]);
  }
  const { buildSurfaceResamplingPlan } = await import('../../../src/geometry/SurfaceResampling');
  const targetDomain = new SurfaceDomain({ id: 'halfspace-target', structure: 'left', vertexCount: 3, faces: [0, 1, 2] });
  const target = new SurfaceMetric(targetDomain, { positions: [...query, ...triangles[0]![0]!, ...triangles[0]![2]!], frame: 'registered', units: 'mm' });
  const plan = buildSurfaceResamplingPlan({ source, target, registration: { id: 'halfspace', frame: 'registered', center: [0, 0, 0], radiusMm: 100 } }, {
    projectionProfile: 'binary32-chart-fma-v1', sourceROI: Uint8Array.from(ids.map(id => +(id !== 754)))
  });
  const result = plan.apply(ids, { missing: 'renormalize' });
  expect(result.valid[0]).toBe(1); expect(result.values[0]).toBe(2674);
});


it('retains the reference tiny neighbor at an exactly normalized shared vertex', async () => {
  const vertices = vertexFixture.triangleRaw.vertices.map(v => normalizeBinary32(v, [0, 0, 0], 100));
  const query = normalizeBinary32(vertexFixture.queryRaw, [0, 0, 0], 100);
  expect(query).toEqual(vertices[1]);
  const result = new Binary32Chart(vertices[0]!, vertices[1]!, vertices[2]!).project(query);
  expect(result.weights).toEqual([0, 1 - 2 ** -24, 2 ** -24]); expect(result.distanceSquared).toBe(0);
  const domain = new SurfaceDomain({ id: 'vertex-profile', structure: 'left', vertexCount: 3, faces: [0, 1, 2] });
  const metric = new SurfaceMetric(domain, { positions: vertices.flat(), frame: 'registered', units: 'mm' });
  const precise = new SurfaceTriangleIndex(metric).closest(query);
  if (precise.location.kind === 'triangle') expect(precise.location.weights).toEqual([0, 1, 0]);
  const { buildSurfaceResamplingPlan } = await import('../../../src/geometry/SurfaceResampling');
  const plan = buildSurfaceResamplingPlan({ source: metric, target: metric, registration: { id: 'vertex', frame: 'registered', center: [0, 0, 0], radiusMm: 100 } }, {
    projectionProfile: 'binary32-chart-fma-v1', sourceROI: Uint8Array.from([1, 0, 1])
  });
  const masked = plan.apply(vertexFixture.triangleRaw.nodes, { missing: 'renormalize' });
  expect(masked.valid[1]).toBe(1); expect(masked.values[1]).toBe(7981);
});
