import { createLineProjector, createVoxelSampler, invertVoxelToWorld } from './volumeProjectionCore';

/** A borrowed scalar volume; no data copy, file loading, or neuroimjs dependency. */
export interface VolumeDescriptor {
  /** Exactly nx * ny * nz values, x fastest: i + nx * (j + ny * k). */
  readonly data: ArrayLike<number>;
  readonly dims: readonly [number, number, number];
  /** Column-major affine from integer voxel centres to anatomical world millimetres. */
  readonly voxelToWorld: ArrayLike<number> | { readonly elements: ArrayLike<number> };
  /** Optional aligned mask. Zero or non-finite means invalid; other values mean valid. */
  readonly mask?: ArrayLike<number>;
}

export interface ProjectionSurface {
  /** Packed xyz positions in the volume's anatomical world frame, in millimetres. */
  readonly positions: ArrayLike<number>;
  /** Packed xyz normals in the same world frame; normalized internally. */
  readonly normals: ArrayLike<number>;
}

export type NormalProjectionReducer = 'mean' | 'max-abs';

export interface ProjectVolumeOptions {
  /** Ordered, finite interval. Positive depths follow the supplied normal. */
  readonly depthMm: readonly [number, number];
  /** Inclusive, evenly spaced samples (1–256). One samples the midpoint. Default 5. */
  readonly steps?: number;
  /** Default linear. Nearest uses half-open voxel extents; linear uses voxel centres. */
  readonly interpolation?: 'nearest' | 'linear';
  /** Default mean. max-abs retains the sign; ties choose the earliest depth. */
  readonly reducer?: NormalProjectionReducer;
}

export interface ProjectVolumeResult {
  /** One value per vertex. NaN denotes no valid samples. */
  readonly values: Float32Array;
  /** Number of valid depth samples per vertex (not the number of voxel contributors). */
  readonly validSamples: Uint32Array;
}

/**
 * Project a volume along anatomical surface normals, without creating a layer or texture.
 *
 * Zero is valid. Non-finite/masked/outside samples are omitted from reduction. A linear
 * sample requires every contributor with nonzero weight to be valid; weights are never
 * renormalized. Positions and normals must be anatomical, before inflation or viewer
 * layout transforms. Normals must be finite and nonzero; their orientation is caller-owned.
 *
 * Inputs are borrowed for this synchronous call and never mutated. Work is O(vertices ×
 * steps), with one affine inverse per call, no per-sample allocation and no volume scan.
 * Throws for malformed inputs or results outside finite Float32 range. Arithmetic uses
 * JavaScript doubles; numerical overflow is an error, not a missing-data sentinel.
 */
export function projectVolume(
  volume: VolumeDescriptor,
  surface: ProjectionSurface,
  options: ProjectVolumeOptions
): ProjectVolumeResult {
  const { dims, data, mask } = volume;
  if (dims.length !== 3 || !dims.every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new RangeError('dims must contain three positive safe integers');
  }
  const length = dims[0] * dims[1] * dims[2];
  if (!Number.isSafeInteger(length) || data.length !== length) {
    throw new RangeError('data length must equal dims[0] * dims[1] * dims[2]');
  }
  if (mask && mask.length !== length) throw new RangeError('mask length must match data length');
  const { positions, normals } = surface;
  if (!Number.isSafeInteger(positions.length) || positions.length % 3 !== 0 || normals.length !== positions.length) {
    throw new RangeError('positions and normals must contain matching packed xyz triplets');
  }
  const { depthMm } = options;
  if (depthMm.length !== 2 || !Number.isFinite(depthMm[0]) || !Number.isFinite(depthMm[1]) || depthMm[0] > depthMm[1]) {
    throw new RangeError('depthMm must be an ordered pair of finite depths');
  }
  const steps = options.steps ?? 5;
  if (!Number.isInteger(steps) || steps < 1 || steps > 256) throw new RangeError('steps must be an integer from 1 to 256');
  const interpolation = options.interpolation ?? 'linear';
  if (interpolation !== 'linear' && interpolation !== 'nearest') throw new RangeError('Unknown interpolation');
  const reducer = options.reducer ?? 'mean';
  if (reducer !== 'mean' && reducer !== 'max-abs') throw new RangeError('Unknown normal projection reducer');
  const affine = volume.voxelToWorld;
  const m = invertVoxelToWorld('elements' in affine ? affine.elements : affine);
  const parameters = new Float64Array(steps);
  for (let s = 0; s < steps; s++) {
    const t = steps === 1 ? 0.5 : s / (steps - 1);
    parameters[s] = (1 - t) * depthMm[0] + t * depthMm[1];
  }
  const project = createLineProjector(createVoxelSampler(data, dims, interpolation, 'strict', mask), parameters, reducer);
  const values = new Float32Array(positions.length / 3);
  const validSamples = new Uint32Array(values.length);
  for (let v = 0; v < values.length; v++) {
    const i = v * 3;
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    let nx = normals[i]!, ny = normals[i + 1]!, nz = normals[i + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) ||
        !Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
      throw new RangeError(`Vertex ${v}: positions and normals must be finite`);
    }
    const scale = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    if (scale === 0) throw new RangeError(`Vertex ${v}: normal must be nonzero`);
    nx /= scale; ny /= scale; nz /= scale;
    const norm = Math.hypot(nx, ny, nz);
    nx /= norm; ny /= norm; nz /= norm;
    const ox = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const oy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    const oz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    // Transform the world unit normal as a direction, WITHOUT renormalizing in voxels.
    const dx = m[0]! * nx + m[4]! * ny + m[8]! * nz;
    const dy = m[1]! * nx + m[5]! * ny + m[9]! * nz;
    const dz = m[2]! * nx + m[6]! * ny + m[10]! * nz;
    // A finite path must have finite endpoints; checking here keeps error checks
    // outside the sample loop and distinguishes overflow from out-of-volume samples.
    const first = parameters[0]!, last = parameters[steps - 1]!;
    if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz) ||
        !Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz) ||
        !Number.isFinite(ox + first * dx) || !Number.isFinite(oy + first * dy) || !Number.isFinite(oz + first * dz) ||
        !Number.isFinite(ox + last * dx) || !Number.isFinite(oy + last * dy) || !Number.isFinite(oz + last * dz)) {
      throw new RangeError(`Vertex ${v}: transformed coordinates overflow`);
    }
    const result = project(ox, oy, oz, dx, dy, dz);
    values[v] = result.value;
    validSamples[v] = result.count;
    if (result.count > 0 && !Number.isFinite(values[v])) throw new RangeError(`Vertex ${v}: projection exceeds finite Float32 range`);
  }
  return { values, validSamples };
}
