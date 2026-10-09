/** Internal CPU sampling shared by numerical projection and the rendering layer. */
export type VoxelSampler = (x: number, y: number, z: number) => number | null;
type Sampling = 'nearest' | 'linear';
type BoundsPolicy = 'strict' | 'legacyClamped';
type Reducer = 'mean' | 'max-abs' | 'min' | 'max' | 'median';

/** Select policy once; no allocations are made while sampling. Inputs are validated by callers. */
export function createVoxelSampler(
  data: ArrayLike<number>,
  dims: readonly [number, number, number],
  sampling: Sampling,
  policy: BoundsPolicy,
  mask?: ArrayLike<number>
): VoxelSampler {
  const [nx, ny, nz] = dims;
  const strideZ = nx * ny;
  const legacy = policy === 'legacyClamped';
  const inside = legacy
    ? (x: number, y: number, z: number) => {
      const u = (x + 0.5) / nx, v = (y + 0.5) / ny, w = (z + 0.5) / nz;
      return !(u < 0 || u > 1 || v < 0 || v > 1 || w < 0 || w > 1);
    }
    : sampling === 'nearest'
      ? (x: number, y: number, z: number) =>
        x >= -0.5 && x < nx - 0.5 && y >= -0.5 && y < ny - 0.5 && z >= -0.5 && z < nz - 0.5
      : (x: number, y: number, z: number) =>
        x >= 0 && x <= nx - 1 && y >= 0 && y <= ny - 1 && z >= 0 && z <= nz - 1;
  const read = legacy
    ? (index: number) => data[index]!
    : (index: number) => {
      const value = data[index]!;
      return Number.isFinite(value) && (!mask || (Number.isFinite(mask[index]) && mask[index] !== 0))
        ? value : NaN;
    };

  if (sampling === 'nearest') {
    return (x, y, z) => {
      if (!inside(x, y, z)) return null;
      const i = Math.min(nx - 1, Math.max(0, Math.floor(x + 0.5)));
      const j = Math.min(ny - 1, Math.max(0, Math.floor(y + 0.5)));
      const k = Math.min(nz - 1, Math.max(0, Math.floor(z + 0.5)));
      return read(i + nx * j + strideZ * k);
    };
  }

  // Legacy interpolation deliberately retains 0 * NaN contamination. The numerical
  // contract ignores contributors of zero weight, including masked neighbours.
  const lerp = legacy
    ? (a: number, b: number, t: number) => a * (1 - t) + b * t
    : (a: number, b: number, t: number) => t === 0 ? a : t === 1 ? b : a * (1 - t) + b * t;
  return (x, y, z) => {
    if (!inside(x, y, z)) return null;
    const x0 = Math.min(nx - 1, Math.max(0, Math.floor(x)));
    const y0 = Math.min(ny - 1, Math.max(0, Math.floor(y)));
    const z0 = Math.min(nz - 1, Math.max(0, Math.floor(z)));
    const x1 = Math.min(nx - 1, x0 + 1);
    const y1 = Math.min(ny - 1, y0 + 1);
    const z1 = Math.min(nz - 1, z0 + 1);
    const tx = Math.min(1, Math.max(0, x - x0));
    const ty = Math.min(1, Math.max(0, y - y0));
    const tz = Math.min(1, Math.max(0, z - z0));
    const yz00 = nx * y0 + strideZ * z0, yz10 = nx * y1 + strideZ * z0;
    const yz01 = nx * y0 + strideZ * z1, yz11 = nx * y1 + strideZ * z1;
    const c00 = lerp(read(x0 + yz00), read(x1 + yz00), tx);
    const c10 = lerp(read(x0 + yz10), read(x1 + yz10), tx);
    const c01 = lerp(read(x0 + yz01), read(x1 + yz01), tx);
    const c11 = lerp(read(x0 + yz11), read(x1 + yz11), tx);
    return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
  };
}

export interface LineProjectionResult { value: number; count: number }
/** The returned result is scratch storage: consume it before projecting another line. */
export type LineProjector = (
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number
) => LineProjectionResult;

export function createLineProjector(
  sample: VoxelSampler,
  parameters: ArrayLike<number>,
  reducer: Reducer,
  accept: (value: number) => boolean = Number.isFinite
): LineProjector {
  const result: LineProjectionResult = { value: NaN, count: 0 };
  const medianValues: number[] | null = reducer === 'median' ? [] : null;
  const accumulate = reducer === 'max' ? Math.max
    : reducer === 'min' ? Math.min
      : reducer === 'max-abs' ? (a: number, b: number) => Math.abs(b) > Math.abs(a) ? b : a
        : (a: number, b: number) => a + b;
  return (ox, oy, oz, dx, dy, dz) => {
    let count = 0;
    let value = 0;
    if (medianValues) medianValues.length = 0;
    for (let s = 0; s < parameters.length; s++) {
      const t = parameters[s]!;
      const v = sample(ox + t * dx, oy + t * dy, oz + t * dz);
      if (v === null || !accept(v)) continue;
      if (medianValues) medianValues.push(v);
      value = count === 0 && reducer !== 'mean' ? v : accumulate(value, v);
      count++;
    }
    if (medianValues && count > 0) {
      medianValues.sort((a, b) => a - b);
      const mid = Math.floor(count / 2);
      value = count % 2 === 0 ? (medianValues[mid - 1]! + medianValues[mid]!) / 2 : medianValues[mid]!;
    } else if (reducer === 'mean') {
      value /= count;
    }
    result.value = count === 0 ? NaN : value;
    result.count = count;
    return result;
  };
}

/** Invert a finite affine with partial pivoting; independent of Three.js and DOM. */
export function invertVoxelToWorld(matrix: ArrayLike<number>): Float64Array {
  if (matrix.length !== 16) throw new RangeError('voxelToWorld must contain 16 column-major elements');
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(matrix[i])) throw new RangeError('voxelToWorld must be finite');
  }
  if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) {
    throw new RangeError('voxelToWorld must be affine (last row [0, 0, 0, 1])');
  }
  // Three rows of [linear transform | identity]. No fixed determinant tolerance:
  // small voxel units alone do not make an invertible matrix singular.
  const rows = Array.from({ length: 3 }, (_, r) => [
    matrix[r]!, matrix[r + 4]!, matrix[r + 8]!, r === 0 ? 1 : 0, r === 1 ? 1 : 0, r === 2 ? 1 : 0
  ]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(rows[r]![col]!) > Math.abs(rows[pivot]![col]!)) pivot = r;
    }
    const swap = rows[col]!;
    rows[col] = rows[pivot]!;
    rows[pivot] = swap;
    const row = rows[col]!;
    const divisor = row[col]!;
    if (divisor === 0) throw new RangeError('voxelToWorld must be invertible');
    for (let j = 0; j < 6; j++) row[j] = row[j]! / divisor;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const target = rows[r]!;
      const factor = target[col]!;
      for (let j = 0; j < 6; j++) target[j] = target[j]! - factor * row[j]!;
    }
  }
  const inverse = new Float64Array(16);
  inverse[15] = 1;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) inverse[r + 4 * c] = rows[r]![3 + c]!;
    inverse[r + 12] = -(inverse[r]! * matrix[12]! + inverse[r + 4]! * matrix[13]! + inverse[r + 8]! * matrix[14]!);
  }
  if (!inverse.every(Number.isFinite)) throw new RangeError('voxelToWorld inverse is not finite');
  return inverse;
}
