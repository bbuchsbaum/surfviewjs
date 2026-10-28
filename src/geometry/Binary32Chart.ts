import { GeometryError } from './GeometryError';

type Vec = readonly [number, number, number];
const f = Math.fround;
const bits = new DataView(new ArrayBuffer(4));
function next(value: number, up: boolean): number {
  if (value === 0) return up ? 2 ** -149 : -(2 ** -149);
  bits.setFloat32(0, value); let n = bits.getUint32(0); n += (value > 0) === up ? 1 : -1; bits.setUint32(0, n); return bits.getFloat32(0);
}
function parts(value: number): { n: bigint; e: number } {
  bits.setFloat32(0, value); const b = bits.getUint32(0), exponent = (b >>> 23) & 255;
  return { n: BigInt((b & 0x7fffff) + (exponent ? 0x800000 : 0)) * (b >>> 31 ? -1n : 1n), e: exponent ? exponent - 150 : -149 };
}
/** Binary32 fused product/add; exact integer comparison resolves rare binary64 double-rounding ties. */
export function fma32(a: number, b: number, c: number): number {
  a = f(a); b = f(b); c = f(c);
  const value = a * b + c, rounded = f(value);
  if (!Number.isFinite(value) || value === rounded) return rounded;
  const overflowMidpoint = 2 ** 128 - 2 ** 103;
  if (!Number.isFinite(rounded) && Math.abs(value) !== overflowMidpoint) return rounded;
  const adjacent = next(rounded, value > rounded), midpoint = Number.isFinite(rounded) ? (rounded + adjacent) / 2 : Math.sign(value) * overflowMidpoint;
  if (value !== midpoint) return rounded;
  const x = parts(a), y = parts(b), z = parts(c), lo = parts(rounded), hi = parts(adjacent);
  const exponent = Math.min(x.e + y.e, z.e, lo.e - 1, hi.e - 1);
  const delta = (x.n * y.n << BigInt(x.e + y.e - exponent)) + (z.n << BigInt(z.e - exponent)) - (lo.n << BigInt(lo.e - 1 - exponent)) - (hi.n << BigInt(hi.e - 1 - exponent));
  return delta === 0n ? rounded : delta > 0n ? Math.max(rounded, adjacent) : Math.min(rounded, adjacent);
}
function dot(a: Vec, b: Vec): number { return fma32(a[2], b[2], fma32(a[0], b[0], f(a[1] * b[1]))); }
function dot2(a: readonly number[], b: readonly number[]): number { return fma32(a[0]!, b[0]!, f(a[1]! * b[1]!)); }
function norm(a: Vec): number { return f(Math.sqrt(dot(a, a))); }
function sub(a: Vec, b: Vec): Vec { return [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])]; }
function unit(a: Vec): Vec { const length = norm(a); if (!(length > 0) || !Number.isFinite(length)) throw new GeometryError('degenerate-geometry', 'Binary32 chart basis is undefined'); return [f(a[0] / length), f(a[1] / length), f(a[2] / length)]; }
function asVec(a: ArrayLike<number>): Vec { return [f(a[0]!), f(a[1]!), f(a[2]!)]; }
function reconstruct(a: Vec, x: Vec, y: Vec, u: number, v: number): Vec { return [0, 1, 2].map(j => f(f(f(u * x[j]!) + f(v * y[j]!)) + a[j]!)) as unknown as Vec; }

export function normalizeBinary32(point: ArrayLike<number>, center: readonly [number, number, number], radius: number): Vec {
  const p: Vec = [f(f(point[0]!) - f(center[0])), f(f(point[1]!) - f(center[1])), f(f(point[2]!) - f(center[2]))], length = norm(p);
  if (!(length > 0) || !Number.isFinite(length)) throw new GeometryError('degenerate-geometry', 'Binary32 sphere normalization is undefined');
  const scale = f(f(radius) / length);
  return [f(f(p[0] * scale) + f(center[0])), f(f(p[1] * scale) + f(center[1])), f(f(p[2] * scale) + f(center[2]))];
}

/** Independent orthonormal-chart face/closed-edge enumeration with specified finite arithmetic. */
export class Binary32Chart {
  readonly a: Vec;
  readonly x: Vec;
  readonly y: Vec;
  readonly vertices: readonly Vec[];
  readonly uv: readonly (readonly [number, number])[];
  readonly residual: number;
  constructor(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, packed?: ArrayLike<number>) {
    this.vertices = [asVec(a), asVec(b), asVec(c)]; this.a = this.vertices[0]!;
    if (packed) {
      this.x = [packed[0]!, packed[1]!, packed[2]!]; this.y = [packed[3]!, packed[4]!, packed[5]!];
      this.uv = [[0, 0], [packed[6]!, packed[7]!], [packed[8]!, packed[9]!]];
    } else {
    this.x = unit(sub(this.vertices[1]!, this.a)); const z = sub(this.vertices[2]!, this.a), projection = dot(this.x, z);
    this.y = unit([0, 1, 2].map(j => f(z[j]! - f(this.x[j]! * projection))) as unknown as Vec);
    this.uv = this.vertices.map(p => { const d = sub(p, this.a); return [dot(d, this.x), dot(d, this.y)] as const; });
    }
    this.residual = packed ? 0 : Math.max(...[a, b, c].map((p, i) => { const r = reconstruct(this.a, this.x, this.y, this.uv[i]![0], this.uv[i]![1]); return Math.hypot(...r.map((v, j) => v - p[j]!)); }));
  }
  project(query: ArrayLike<number>): { weights: [number, number, number]; distanceSquared: number; point: Float64Array } {
    const q = asVec(query);
    const d = sub(q, this.a), p = [dot(d, this.x), dot(d, this.y)];
    const uv = this.uv;
    // A rounded residual half-space is part of this profile's finite arithmetic.
    // A double barycentric predicate can disagree near a shared vertex or edge.
    const edges = [[0, 2], [1, 0], [2, 1]].map(([i, j]) => {
      const start = uv[i!]!, end = uv[j!]!, third = uv[3 - i! - j!]!;
      const e = [f(end[0] - start[0]), f(end[1] - start[1])], length = f(Math.sqrt(dot2(e, e)));
      const h = e.map(x => f(x / length)), z = [f(third[0] - start[0]), f(third[1] - start[1])], along = dot2(z, h);
      const inward = z.map((x, k) => fma32(-along, h[k]!, x));
      const delta = [f(p[0]! - start[0]), f(p[1]! - start[1])];
      return { i: i!, j: j!, start, length, h, delta, side: dot2(delta, inward) };
    });
    const inside = edges.every(e => e.side >= 0);
    let best = Infinity, chosen: readonly [number, number] = [p[0]!, p[1]!], edge = [0, 2], alpha = 0;
    // Enumerate active constraints only. An unrelated segment can have a smaller
    // rounded chart distance and select the wrong support at a shared vertex.
    if (!inside) for (const e of edges) {
      if (e.side >= 0) continue;
      const clipped = Math.max(0, Math.min(e.length, dot2(e.delta, e.h)));
      const candidate = [fma32(clipped, e.h[0]!, e.start[0]), fma32(clipped, e.h[1]!, e.start[1])] as const;
      const dx = f(p[0]! - candidate[0]), dy = f(p[1]! - candidate[1]), distance = f(f(dx * dx) + f(dy * dy));
      if (distance < best) { best = distance; chosen = candidate; edge = [e.i, e.j]; alpha = f(clipped / e.length); }
    }
    let world = reconstruct(this.a, this.x, this.y, inside ? p[0]! : chosen[0], inside ? p[1]! : chosen[1]);
    let weights: [number, number, number] = [0, 0, 0];
    if (inside) {
      const crossLength = (a: Vec, b: Vec) => norm([f(f(a[1] * b[2]) - f(a[2] * b[1])), f(f(a[2] * b[0]) - f(a[0] * b[2])), f(f(a[0] * b[1]) - f(a[1] * b[0]))]);
      const offsets = this.vertices.map(v => sub(v, world)), areas = [crossLength(offsets[1]!, offsets[2]!), crossLength(offsets[0]!, offsets[2]!), crossLength(offsets[0]!, offsets[1]!)], sum = f(f(areas[0]! + areas[1]!) + areas[2]!);
      weights = areas.map(a => f(a / sum)) as [number, number, number];
    } else {
      const i = edge[0]!, j = edge[1]!;
      if (alpha === 0 || alpha === 1) world = this.vertices[alpha === 0 ? i : j]!;
      const delta = sub(this.vertices[j]!, this.vertices[i]!), length = norm(delta), w = alpha === 0 ? 0 : alpha === 1 ? 1 : Math.max(0, Math.min(1, f(dot(unit(delta), sub(world, this.vertices[i]!)) / length)));
      weights[i] = f(1 - w); weights[j] = w;
    }
    const total = weights[0] + weights[1] + weights[2];
    if (!(total > 0) || weights.some(w => !Number.isFinite(w) || w < 0)) throw new GeometryError('degenerate-geometry', 'Binary32 projection weights are undefined');
    weights = weights.map(w => w / total) as [number, number, number];
    const distance = norm(sub(q, world));
    if (!Number.isFinite(distance)) throw new GeometryError('degenerate-geometry', 'Binary32 projection distance overflow');
    return { weights, distanceSquared: distance * distance, point: Float64Array.from(world) };
  }
}
