import { Binary32Chart } from './Binary32Chart';
import { checkBudget, GeometryError } from './GeometryError';
import { SurfaceMetric, metricPositions, domainFaces } from './SurfaceDomain';
import { triangleLocation, type SurfaceLocation } from './SurfaceLocation';
import { exactClosestTriangleWeights } from './ExactTriangleProjection';

export type SurfaceProjectionProfile = 'float64-closest' | 'binary32-chart-fma-v1';

/** Point and distance use the selected scoring arithmetic; barycentric evaluation may differ by rounding. */
export interface ClosestSurfacePoint { location: SurfaceLocation; point: Float64Array; distanceSquared: number; face: number }

/** Projection onto the face plane, then the three closed edges when outside. */
export function closestTrianglePoint(point: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>): { weights: [number, number, number]; distanceSquared: number; point: Float64Array } {
  const scale = Math.max(...[0, 1, 2].flatMap(j => [Math.abs(b[j]! - a[j]!), Math.abs(c[j]! - a[j]!)]));
  const ab = [0, 1, 2].map(j => (b[j]! - a[j]!) / scale), ac = [0, 1, 2].map(j => (c[j]! - a[j]!) / scale), bc = [0, 1, 2].map(j => (c[j]! - b[j]!) / scale);
  const squared = (x: readonly number[]) => x[0]! ** 2 + x[1]! ** 2 + x[2]! ** 2;
  const maxEdgeSquared = Math.max(squared(ab), squared(ac), squared(bc));
  const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
  const exact = Math.hypot(...cross) <= 1e-3 * maxEdgeSquared ? exactClosestTriangleWeights(point, a, b, c) : undefined;
  const dot = (x: ArrayLike<number>, y: ArrayLike<number>) => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!;
  let best = Infinity, weights: [number, number, number] = [1, 0, 0], output = new Float64Array(3);
  const test = (w: [number, number, number]) => {
    const p = Float64Array.from([0, 1, 2], j => w[0] * a[j]! + w[1] * b[j]! + w[2] * c[j]!);
    const d = (p[0]! - point[0]!) ** 2 + (p[1]! - point[1]!) ** 2 + (p[2]! - point[2]!) ** 2;
    if (d < best) { best = d; weights = w; output = p; }
  };
  if (exact) { test(exact); if (!Number.isFinite(best)) throw new GeometryError('degenerate-geometry', 'Projection arithmetic overflow; rescale the coordinate frame'); return { weights, distanceSquared: best, point: output }; }
  // Use the shortest edge as an orthogonal-chart base: for fixed area this
  // maximizes the other coordinate's altitude.  Build that coordinate from
  // the face normal rather than a Gram-determinant difference.
  const triangle = [a, b, c];
  const edgeVector = (start: number, end: number) => [0, 1, 2].map(axis => (triangle[end]![axis]! - triangle[start]![axis]!) / scale);
  const edges: Array<readonly [number, number, number]> = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
  let edge = edges[0]!, baseSquared = Infinity;
  for (const candidate of edges) {
    const base = edgeVector(candidate[0], candidate[1]);
    const squared = dot(base, base);
    if (squared < baseSquared) { baseSquared = squared; edge = candidate; }
  }
  const [start, end, third] = edge, base = edgeVector(start, end), other = edgeVector(start, third);
  const normal = [
    base[1]! * other[2]! - base[2]! * other[1]!,
    base[2]! * other[0]! - base[0]! * other[2]!,
    base[0]! * other[1]! - base[1]! * other[0]!,
  ];
  const baseLength = Math.sqrt(baseSquared), normalLength = Math.hypot(...normal);
  const side = [
    (normal[1]! * base[2]! - normal[2]! * base[1]!) / (normalLength * baseLength),
    (normal[2]! * base[0]! - normal[0]! * base[2]!) / (normalLength * baseLength),
    (normal[0]! * base[1]! - normal[1]! * base[0]!) / (normalLength * baseLength),
  ];
  if (normalLength > 0 && Number.isFinite(normalLength)) {
    const fromStart = [0, 1, 2].map(axis => (point[axis]! - triangle[start]![axis]!) / scale);
    const s = dot(fromStart, side) / dot(other, side);
    const t = (dot(fromStart, base) - s * dot(other, base)) / baseSquared;
    const w: [number, number, number] = [0, 0, 0]; w[start] = 1 - t - s; w[end] = t; w[third] = s;
    if (w.every(weight => weight >= 0)) test(w);
  }
  const vertices = [a, b, c];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3, start = vertices[i]!, end = vertices[j]!;
    const delta = [0, 1, 2].map(k => (end[k]! - start[k]!) / scale), to = [0, 1, 2].map(k => (point[k]! - start[k]!) / scale);
    const t = Math.max(0, Math.min(1, dot(to, delta) / dot(delta, delta)));
    const w: [number, number, number] = [0, 0, 0]; w[i] = 1 - t; w[j] = t; test(w);
  }
  if (!Number.isFinite(best)) throw new GeometryError('degenerate-geometry', 'Projection arithmetic overflow; rescale the coordinate frame');
  return { weights, distanceSquared: best, point: output };
}

/** Packed deterministic AABB tree; double closest-point by default, explicit arithmetic profiles otherwise. */
export class SurfaceTriangleIndex {
  private order: Uint32Array;
  private bounds: Float64Array;
  private left: Int32Array;
  private right: Int32Array;
  private start: Uint32Array;
  private count: Uint32Array;
  readonly byteLength: number;
  readonly projectionProfile: SurfaceProjectionProfile;
  private chartData: Float32Array | undefined;
  private projectionPadding = 0;
  constructor(readonly metric: SurfaceMetric, options: { budgetBytes?: number; leafSize?: number; projectionProfile?: SurfaceProjectionProfile } = {}) {
    const f = domainFaces(metric.domain), p = metricPositions(metric), n = metric.domain.faceCount, leafSize = options.leafSize ?? 8;
    if (!Number.isSafeInteger(leafSize) || leafSize < 1) throw new GeometryError('invalid-shape', 'Invalid leaf size');
    this.projectionProfile = options.projectionProfile ?? 'float64-closest';
    if (!['float64-closest', 'binary32-chart-fma-v1'].includes(this.projectionProfile)) throw new GeometryError('invalid-shape', 'Unknown projection profile');
    checkBudget(n * (this.projectionProfile === 'float64-closest' ? 156 : 196) + metric.byteLength + metric.domain.byteLength, options.budgetBytes);
    this.order = Uint32Array.from({ length: n }, (_, i) => i);
    this.bounds = new Float64Array(n * 2 * 6); this.left = new Int32Array(n * 2); this.right = new Int32Array(n * 2);
    this.start = new Uint32Array(n * 2); this.count = new Uint32Array(n * 2); this.left.fill(-1); this.right.fill(-1);
    const centers = new Float64Array(n * 3);
    for (let face = 0; face < n; face++) for (let axis = 0; axis < 3; axis++) centers[face * 3 + axis] = (p[f[face * 3]! * 3 + axis]! + p[f[face * 3 + 1]! * 3 + axis]! + p[f[face * 3 + 2]! * 3 + axis]!) / 3;
    let nodes = 0;
    const build = (start: number, end: number): number => {
      const node = nodes++, base = node * 6;
      for (let axis = 0; axis < 3; axis++) { this.bounds[base + axis] = Infinity; this.bounds[base + axis + 3] = -Infinity; }
      for (let j = start; j < end; j++) for (let k = 0; k < 3; k++) {
        const vertex = f[this.order[j]! * 3 + k]!;
        for (let axis = 0; axis < 3; axis++) { const x = p[vertex * 3 + axis]!; this.bounds[base + axis] = Math.min(this.bounds[base + axis]!, x); this.bounds[base + axis + 3] = Math.max(this.bounds[base + axis + 3]!, x); }
      }
      this.start[node] = start; this.count[node] = end - start;
      if (end - start > leafSize) {
        let axis = 0;
        for (let k = 1; k < 3; k++) if (this.bounds[base + k + 3]! - this.bounds[base + k]! > this.bounds[base + axis + 3]! - this.bounds[base + axis]!) axis = k;
        this.order.subarray(start, end).sort((a, b) => centers[a * 3 + axis]! - centers[b * 3 + axis]! || a - b);
        const middle = (start + end) >>> 1;
        this.left[node] = build(start, middle); this.right[node] = build(middle, end);
      }
      return node;
    };
    build(0, n);
    if (this.projectionProfile === 'binary32-chart-fma-v1') {
      this.chartData = new Float32Array(n * 10); let scale = 1;
      for (let face = 0; face < n; face++) {
        const tri = [0, 1, 2].map(k => p.subarray(f[face * 3 + k]! * 3, f[face * 3 + k]! * 3 + 3));
        const chart = new Binary32Chart(tri[0]!, tri[1]!, tri[2]!);
        this.chartData.set([...chart.x, ...chart.y, ...chart.uv[1]!, ...chart.uv[2]!], face * 10);
        this.projectionPadding = Math.max(this.projectionPadding, chart.residual);
        for (const point of tri) for (const x of point) scale = Math.max(scale, Math.abs(x));
      }
      // Cover vertex reconstruction residuals and float operation roundoff.
      this.projectionPadding += 128 * 2 ** -23 * scale;
    }
    this.byteLength = this.order.byteLength + this.bounds.byteLength + this.left.byteLength + this.right.byteLength + this.start.byteLength + this.count.byteLength + (this.chartData?.byteLength ?? 0);
  }
  closest(point: ArrayLike<number>): ClosestSurfacePoint {
    if (point.length !== 3 || ![point[0], point[1], point[2]].every(Number.isFinite)) throw new GeometryError('invalid-shape', 'Expected finite 3D query point');
    const f = domainFaces(this.metric.domain), p = metricPositions(this.metric);
    let best: ClosestSurfacePoint | undefined;
    const bound = (node: number) => { let d = 0; for (let j = 0; j < 3; j++) { const x = point[j]!, lo = this.bounds[node * 6 + j]!, hi = this.bounds[node * 6 + j + 3]!; d += (x < lo ? lo - x : x > hi ? x - hi : 0) ** 2; } return d; };
    const padding = this.projectionPadding + (this.chartData ? 128 * 2 ** -23 * Math.max(1, Math.abs(point[0]!), Math.abs(point[1]!), Math.abs(point[2]!)) : 0);
    const stack = [0];
    while (stack.length) {
      const node = stack.pop()!;
      const lowerBound = bound(node), limit = best?.distanceSquared ?? Infinity;
      if (this.chartData ? Math.sqrt(lowerBound) > Math.sqrt(limit) + padding : lowerBound > limit) continue;
      if (this.left[node]! >= 0) {
        const a = this.left[node]!, b = this.right[node]!;
        if (bound(a) <= bound(b)) stack.push(b, a); else stack.push(a, b);
      } else for (let i = this.start[node]!; i < this.start[node]! + this.count[node]!; i++) {
        const face = this.order[i]!, ids = [f[face * 3]!, f[face * 3 + 1]!, f[face * 3 + 2]!];
        const tri = ids.map(v => p.subarray(v * 3, v * 3 + 3));
        const candidate = this.chartData ? new Binary32Chart(tri[0]!, tri[1]!, tri[2]!, this.chartData.subarray(face * 10, face * 10 + 10)).project(point) : closestTrianglePoint(point, tri[0]!, tri[1]!, tri[2]!);
        if (!best || candidate.distanceSquared < best.distanceSquared || (candidate.distanceSquared === best.distanceSquared && face < best.face)) best = { location: triangleLocation(this.metric.domain, face, candidate.weights), point: candidate.point, distanceSquared: candidate.distanceSquared, face };
      }
    }
    return best!;
  }
}
