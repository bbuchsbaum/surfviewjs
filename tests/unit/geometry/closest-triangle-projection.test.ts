import { describe, expect, it } from 'vitest';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { SurfaceTriangleIndex } from '../../../src/geometry/SurfaceTriangleIndex';

type Point = readonly [number, number, number];

function add(a: Point, b: Point): Point { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a: Point, amount: number): Point { return [a[0] * amount, a[1] * amount, a[2] * amount]; }
function cross(a: Point, b: Point): Point { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

function metricFor(vertices: readonly Point[]) {
  const domain = new SurfaceDomain({ id: 'skinny-triangle', structure: 'synthetic', vertexCount: 3, faces: [0, 1, 2] });
  return new SurfaceMetric(domain, { positions: vertices.flat(), frame: 'analytic', units: 'mm' });
}

function interpolate(result: ReturnType<SurfaceTriangleIndex['closest']>, values: readonly number[]) {
  expect(result.location.kind).toBe('triangle');
  if (result.location.kind !== 'triangle') throw new Error('Expected a triangle location');
  return result.location.weights.reduce((sum, weight, vertex) => sum + weight * values[vertex]!, 0);
}

describe('SurfaceTriangleIndex well-conditioned closest projection', () => {
  it('preserves analytic interior interpolation for skinny triangles across scale, orientation, and winding permutations', () => {
    const canonical: readonly Point[] = [[0, 0, 0], [1, 0, 0], [1, 1e-7, 0]];
    const weights = [0.25, 0.5, 0.25] as const;
    const orientations = [
      (p: Point): Point => p,
      (p: Point): Point => [p[2], -p[0], p[1]],
    ];
    for (const factor of [1e-5, 1, 1e5]) for (const orient of orientations) for (const permutation of [[0, 1, 2], [2, 0, 1], [1, 0, 2]] as const) {
      const transformed = canonical.map(point => orient(scale(point, factor)));
      const vertices = permutation.map(vertex => transformed[vertex]!);
      const query = weights.reduce<Point>((sum, weight, vertex) => add(sum, scale(transformed[vertex]!, weight)), [0, 0, 0]);
      const result = new SurfaceTriangleIndex(metricFor(vertices)).closest(query);
      const values = permutation.map(vertex => [0, 0, 100][vertex]!);
      expect(interpolate(result, values)).toBeCloseTo(25, 10);
      const expectedLocalWeights = permutation.map(vertex => weights[vertex]!);
      expect(result.location.kind).toBe('triangle');
      if (result.location.kind === 'triangle') result.location.weights.forEach((weight, vertex) => expect(weight).toBeCloseTo(expectedLocalWeights[vertex]!, 12));
      expect(result.distanceSquared).toBeCloseTo(0, 20);
    }
  });

  it('keeps interior weights under a normal offset and selects the analytic edge projection', () => {
    const vertices: readonly Point[] = [[0, 0, 0], [1, 0, 0], [1, 1e-7, 0]];
    const metric = metricFor(vertices), index = new SurfaceTriangleIndex(metric);
    const normal = cross([1, 0, 0], [1, 1e-7, 0]);
    const interior = add([0.75, 2.5e-8, 0], scale(normal, 3e6));
    const projectedInterior = index.closest(interior);
    expect([...projectedInterior.point]).toEqual(expect.arrayContaining([0.75, 2.5e-8, 0]));
    expect(interpolate(projectedInterior, [0, 0, 100])).toBeCloseTo(25, 10);
    expect(projectedInterior.distanceSquared).toBeCloseTo(0.09, 13);

    const edge = index.closest([1.2, 2.5e-8, 0]);
    expect(edge.point[0]).toBeCloseTo(1, 14); expect(edge.point[1]).toBeCloseTo(2.5e-8, 14); expect(edge.point[2]).toBe(0);
    expect(interpolate(edge, [0, 0, 100])).toBeCloseTo(25, 10);
    expect(edge.distanceSquared).toBeCloseTo(0.04, 13);
  });

  it('projects a rotated 10^7-aspect triangle from off its plane without losing scalar interpolation', () => {
    // Python Fraction.from_float on these exact IEEE-754 inputs gives these
    // weights; the oracle deliberately does not reuse production arithmetic.
    const vertices: readonly Point[] = [[0, 0, 0], [0.7071067811865475, 0.7071067811865475, 0], [0.7071067403617184, 0.7071068220113765, 8.164965809277262e-8]];
    const query: Point = [0.7035351564335889, 0.3571250153462323, 0.17320510118330643];
    const expected = [0.25, 0.5007455864702661, 0.2492544135297339] as const;
    const result = new SurfaceTriangleIndex(metricFor(vertices)).closest(query);
    const tolerance = 1e-8; // O(10^7 * epsilon) barycentric sensitivity for this aspect ratio.
    expect(interpolate(result, [0, 0, 100])).toBeCloseTo(expected[2]! * 100, 5);
    expect(result.location.kind).toBe('triangle');
    if (result.location.kind === 'triangle') result.location.weights.forEach((weight, vertex) => expect(Math.abs(weight - expected[vertex]!)).toBeLessThan(tolerance));
    expect(result.distanceSquared).toBeCloseTo(0.09, 10);
  });

  it('uses exact IEEE-754 region arithmetic for the midpoint skinny sliver', () => {
    const vertices: readonly Point[] = [[0, 0, 0], [0.7071067811865475, 0.7071067811865475, 0], [0.35355334976844466, 0.3535534314181028, 8.164965809277262e-8]];
    const result = new SurfaceTriangleIndex(metricFor(vertices)).closest([0.6151468087852705, 0.2687366676979139, 0.17320510118330643]);
    const expected = [0.25037279334844464, 0.5003727933484448, 0.24925441330311057] as const;
    expect(result.location.kind).toBe('triangle');
    if (result.location.kind === 'triangle') result.location.weights.forEach((weight, vertex) => expect(weight).toBeCloseTo(expected[vertex]!, 13));
  });

  it('keeps an off-plane query dominated by its exact closest thin edge', () => {
    const vertices: readonly Point[] = [[0, 0, 0], [1, 0, 0], [1, 1e-7, 0]];
    const result = new SurfaceTriangleIndex(metricFor(vertices)).closest([1.2, 2.5e-8, 1e100]);
    expect(interpolate(result, [0, 0, 100])).toBeCloseTo(25, 12);
  });

  it('retains an analytic in-plane witness just above the exact-fallback shape gate', () => {
    const vertices: readonly Point[] = [[0, 0, 0], [1, 0, 0], [1, 0.0011, 0]];
    const result = new SurfaceTriangleIndex(metricFor(vertices)).closest([0.75, 0.000275, 0]);
    expect(interpolate(result, [0, 0, 100])).toBeCloseTo(25, 11);
  });
});
