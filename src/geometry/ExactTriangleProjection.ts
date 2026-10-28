/** Exact dyadic closest-point fallback for extremely skinny binary64 faces.
 * Coordinates are represented as common-scale signed BigInts, so all dot,
 * determinant, region, edge, and distance comparisons are exact. */
type Ratio = readonly [bigint, bigint];

function dyadic(x: number): readonly [bigint, number] {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x);
  const bits = view.getBigUint64(0), sign = bits >> 63n ? -1n : 1n;
  const exponent = Number((bits >> 52n) & 0x7ffn), fraction = bits & ((1n << 52n) - 1n);
  if (exponent === 0) return [sign * fraction, -1074];
  return [sign * ((1n << 52n) | fraction), exponent - 1075];
}
function dot(a: readonly bigint[], b: readonly bigint[]): bigint { return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!; }
function sub(a: readonly bigint[], b: readonly bigint[]): bigint[] { return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]; }
function ratio(n: bigint, d: bigint): number {
  if (n === 0n) return 0;
  const bn = n.toString(2).length, bd = d.toString(2).length, sn = Math.max(0, bn - 53), sd = Math.max(0, bd - 53);
  const mantissa = Number(n >> BigInt(sn)) / Number(d >> BigInt(sd)), exponent = sn - sd;
  return exponent < -1022 ? mantissa * 2 ** (exponent + 1022) * 2 ** -1022 : mantissa * 2 ** exponent;
}
function weightsFrom(start: number, end: number, t: Ratio): [number, number, number] {
  const w: [number, number, number] = [0, 0, 0]; w[start] = ratio(t[1] - t[0], t[1]); w[end] = ratio(t[0], t[1]); return w;
}

/** Returns exact-region weights, or undefined only for non-finite input. */
export function exactClosestTriangleWeights(point: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>): [number, number, number] | undefined {
  const raw = [point, a, b, c].flatMap(vertex => [vertex[0]!, vertex[1]!, vertex[2]!]); if (!raw.every(Number.isFinite)) return undefined;
  const decoded = raw.map(dyadic), minimum = Math.min(...decoded.filter(x => x[0] !== 0n).map(x => x[1]));
  const values = decoded.map(([m, e]) => m << BigInt(e - minimum));
  const p = values.slice(0, 3), vertices = [values.slice(3, 6), values.slice(6, 9), values.slice(9, 12)];
  const q = sub(p, vertices[0]!), u = sub(vertices[1]!, vertices[0]!), v = sub(vertices[2]!, vertices[0]!);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), qu = dot(q, u), qv = dot(q, v), determinant = uu * vv - uv * uv;
  if (determinant > 0n) {
    const y = qu * vv - qv * uv, z = qv * uu - qu * uv;
    if (y >= 0n && z >= 0n && y + z <= determinant) return [ratio(determinant - y - z, determinant), ratio(y, determinant), ratio(z, determinant)];
  }
  let bestN: bigint | undefined, bestD = 1n, answer: [number, number, number] = [1, 0, 0];
  for (const [start, end] of [[0, 1], [1, 2], [2, 0]] as const) {
    const from = sub(p, vertices[start]!), delta = sub(vertices[end]!, vertices[start]!), dd = dot(delta, delta), qd = dot(from, delta), qq = dot(from, from);
    let n = qd, d = dd;
    if (n <= 0n) { n = 0n; d = 1n; } else if (n >= d) { n = 1n; d = 1n; }
    const distanceN = qq * d * d - 2n * n * qd * d + n * n * dd, distanceD = d * d;
    if (bestN === undefined || distanceN * bestD < bestN * distanceD) { bestN = distanceN; bestD = distanceD; answer = weightsFrom(start, end, [n, d]); }
  }
  return answer;
}
