import { checkBudget, checkFraction, checkMask, GeometryError } from '../geometry/GeometryError';
import { SurfaceDomain, SurfaceMetric, geometryDigest } from '../geometry/SurfaceDomain';
import { runGeometrySync } from '../geometry/GeometryExecutor';
import { type SurfaceLocation } from '../geometry/SurfaceLocation';
import { invertVoxelToWorld } from '../volumeProjectionCore';
import { chartStorage } from './FlatMapChart';
import { type FlatMapRasterTile } from './FlatMapRasterPlan';

export type FlatMapSampleStatus = 'outside-chart' | 'out-of-volume' | 'missing-data' | 'insufficient-coverage' | 'valid';
export const FLATMAP_SAMPLE_STATUSES: readonly FlatMapSampleStatus[] = Object.freeze([
  'outside-chart', 'out-of-volume', 'missing-data', 'insufficient-coverage', 'valid'
]);
export interface FlatMapMissingPolicy { missing?: 'strict' | 'renormalize'; minCoverage?: number }
export interface FlatMapVertexSource { kind: 'vertex-scalar'; domain: SurfaceDomain }
export interface FlatMapVolumeSource {
  kind: 'volume-scalar';
  white: SurfaceMetric;
  pial: SurfaceMetric;
  dims: readonly [number, number, number];
  voxelToWorld: ArrayLike<number>;
  frame: string;
  interpolation?: 'nearest' | 'linear';
  /** A single depth, or midpoint quadrature over an interval, white=0 and pial=1. */
  depth: { fraction: number } | { interval: readonly [number, number]; samples: number };
}
export type FlatMapSource = FlatMapVertexSource | FlatMapVolumeSource;
interface FrameStorage { values: Float64Array; validity: Uint8Array | undefined; fingerprint?: Promise<string> }
const frames = new WeakMap<FlatMapFrame, FrameStorage>();
let frameSerial = 0;

/** An immutable owned frame. Construct a replacement to change values or validity. */
export class FlatMapFrame {
  readonly revision = `flatmap-frame-${++frameSerial}`;
  readonly length: number;
  readonly byteLength: number;
  constructor(values: ArrayLike<number>, validity?: Uint8Array, budgetBytes?: number) {
    if (!Number.isSafeInteger(values.length) || values.length < 1) throw new GeometryError('invalid-shape', 'Empty frame');
    checkMask(validity, values.length); checkBudget(values.length * 8 + (validity?.byteLength ?? 0), budgetBytes);
    const owned = Float64Array.from(values);
    frames.set(this, { values: owned, validity: validity?.slice() });
    this.length = owned.length; this.byteLength = owned.byteLength + (validity?.byteLength ?? 0); Object.freeze(this);
  }
  fingerprint(): Promise<string> {
    const storage = frames.get(this)!;
    return storage.fingerprint ??= geometryDigest({ method: 'flatmap-frame-v1' }, storage.validity ? [storage.values, Uint32Array.from(storage.validity)] : [storage.values]);
  }
  copyValues(): Float64Array { return frames.get(this)!.values.slice(); }
  copyValidity(): Uint8Array | undefined { return frames.get(this)!.validity?.slice(); }
}

export interface FlatMapSamples {
  values: Float64Array;
  geometricCoverage: Float64Array;
  coverage: Float64Array;
  valid: Uint8Array;
  /** Index in FLATMAP_SAMPLE_STATUSES. */
  status: Uint8Array;
  byteLength: number;
}
export interface FlatMapInspection {
  location: SurfaceLocation;
  value: number;
  coverage: number;
  geometricCoverage: number;
  status: FlatMapSampleStatus;
  samples: Array<{ depth: number | null; inGrid: boolean; valid: boolean; value: number;
    contributors: Array<{ index: number; weight: number; value: number; valid: boolean }> }>;
}

interface SamplerStorage {
  source: FlatMapSource;
  inverse: Float64Array | undefined;
  depths: Float64Array;
  point: Float64Array<ArrayBuffer>;
}
const samplers = new WeakMap<FlatMapSampler, SamplerStorage>();
let samplerSerial = 0;
const OUTSIDE = 0xffffffff;

/** Geometry/depth snapshot, reused across data frames, tiles and presentation changes. */
export class FlatMapSampler {
  readonly domain: SurfaceDomain;
  readonly sourceCount: number;
  readonly sampleCount: number;
  readonly slots: number;
  readonly kind: FlatMapSource['kind'];
  readonly revision = `flatmap-sampler-${++samplerSerial}`;
  get byteLength(): number { const s = samplers.get(this)!; return s.point.byteLength + s.depths.byteLength + (s.inverse?.byteLength ?? 0); }
  constructor(source: FlatMapSource) {
    this.kind = source.kind;
    if (source.kind === 'vertex-scalar') {
      if (!(source.domain instanceof SurfaceDomain)) throw new GeometryError('invalid-domain', 'Scalar source requires a domain');
      this.domain = source.domain; this.sourceCount = source.domain.vertexCount; this.sampleCount = 1; this.slots = 3;
      samplers.set(this, { source: Object.freeze({ ...source }), point: new Float64Array(), inverse: undefined, depths: new Float64Array([0]) });
    } else if (source.kind === 'volume-scalar') {
      if (!(source.white instanceof SurfaceMetric) || !(source.pial instanceof SurfaceMetric) || source.white.domain !== source.pial.domain ||
          source.white.frame !== source.frame || source.pial.frame !== source.frame) throw new GeometryError('frame-mismatch', 'White, pial and volume must share a registered anatomical domain/frame');
      if (source.dims.length !== 3 || source.dims.some(d => !Number.isSafeInteger(d) || d < 1) ||
          !Number.isSafeInteger(source.dims.reduce((a, b) => a * b, 1)) || source.dims.reduce((a, b) => a * b, 1) >= OUTSIDE) {
        throw new GeometryError('invalid-shape', 'Invalid volume dimensions');
      }
      if (source.interpolation !== undefined && source.interpolation !== 'linear' && source.interpolation !== 'nearest') throw new GeometryError('invalid-shape', 'Unknown interpolation');
      let depths: Float64Array;
      if ('fraction' in source.depth) depths = new Float64Array([checkFraction(source.depth.fraction, 'depth')]);
      else {
        const [lo, hi] = source.depth.interval, n = source.depth.samples;
        checkFraction(lo, 'depth start'); checkFraction(hi, 'depth end');
        if (hi < lo || !Number.isSafeInteger(n) || n < 1 || n > 256) throw new GeometryError('invalid-shape', 'Invalid depth interval or sample count');
        depths = Float64Array.from({ length: n }, (_, i) => lo + (i + 0.5) / n * (hi - lo));
      }
      const inverse = invertVoxelToWorld(source.voxelToWorld);
      const owned: FlatMapVolumeSource = Object.freeze({ ...source, dims: Object.freeze([...source.dims]) as readonly [number, number, number],
        voxelToWorld: Object.freeze(Array.from(source.voxelToWorld)), depth: 'fraction' in source.depth ? Object.freeze({ ...source.depth }) :
          Object.freeze({ interval: Object.freeze([...source.depth.interval]) as readonly [number, number], samples: source.depth.samples }) });
      this.domain = source.white.domain; this.sourceCount = source.dims.reduce((a, b) => a * b, 1);
      this.sampleCount = depths.length; this.slots = source.interpolation === 'nearest' ? 1 : 8;
      samplers.set(this, { source: owned, inverse, depths, point: new Float64Array(3) });
    } else throw new GeometryError('invalid-shape', 'Unknown flatmap source kind');
    Object.freeze(this);
  }

  describe(): FlatMapSource { return samplers.get(this)!.source; }

  prepare(raster: FlatMapRasterTile, budgetBytes?: number): PreparedFlatMapTile {
    return runGeometrySync(this.prepareSteps(raster, budgetBytes));
  }

  prepareSteps(raster: FlatMapRasterTile, budgetBytes?: number): Generator<void, PreparedFlatMapTile, void> {
    const n = raster.width * raster.height;
    if (!Number.isSafeInteger(n) || n < 1 || raster.faces.length !== n || raster.weights.length !== n * 3) throw new GeometryError('invalid-shape', 'Invalid raster buffers');
    checkBudget(n * (56 + this.sampleCount * (this.slots * 12 + 1) + 1), budgetBytes);
    return this.prepareOwnedSteps({ ...raster, faces: raster.faces.slice(), weights: raster.weights.slice() }, budgetBytes);
  }
  private *prepareOwnedSteps(raster: FlatMapRasterTile, budgetBytes?: number): Generator<void, PreparedFlatMapTile, void> {
    if (raster.chart.domain !== this.domain) throw new GeometryError('invalid-domain', 'Raster and sampler domains differ');
    const size = raster.faces.length;
    checkBudget(size * this.sampleCount * (this.slots * 12 + 1) + size, budgetBytes);
    const indices = new Uint32Array(size * this.sampleCount * this.slots).fill(OUTSIDE);
    const weights = new Float64Array(indices.length), inGrid = new Uint8Array(size * this.sampleCount), present = new Uint8Array(size);
    const chart = chartStorage(raster.chart), vertexIds = new Uint32Array(3), barycentric = new Float64Array(3);
    for (let pixel = 0; pixel < size; pixel++) {
      const face = raster.faces[pixel]!;
      if (face < -1 || face >= raster.chart.faceCount) throw new GeometryError('invalid-shape', 'Raster face outside chart');
      if (face >= 0) {
        const a = raster.weights[pixel * 3]!, b = raster.weights[pixel * 3 + 1]!, c = raster.weights[pixel * 3 + 2]!;
        if (![a, b, c].every(x => Number.isFinite(x) && x >= 0) || Math.abs(a + b + c - 1) > 1e-10) throw new GeometryError('invalid-weights', 'Invalid raster barycentric weights');
        present[pixel] = 1;
        for (let k = 0; k < 3; k++) {
          vertexIds[k] = chart.vertices[chart.faces[face * 3 + k]!]!;
          barycentric[k] = raster.weights[pixel * 3 + k]!;
        }
        writeStencil(this, vertexIds, barycentric, indices, weights, inGrid, pixel);
      }
      if (pixel % 128 === 127) yield;
    }
    return new PreparedFlatMapTile(this, { indices, weights, inGrid, present });
  }

  inspect(location: SurfaceLocation, frame: FlatMapFrame, policy: FlatMapMissingPolicy = {}): FlatMapInspection {
    if (location.domain !== this.domain) throw new GeometryError('invalid-domain', 'Inspection domain differs');
    validateFrame(this, frame);
    const vertices = location.kind === 'vertex' ? [location.vertex, location.vertex, location.vertex] : this.domain.triangle(location.face);
    const bary = location.kind === 'vertex' ? [1, 0, 0] : location.weights;
    const data: PreparedStorage = { indices: new Uint32Array(this.sampleCount * this.slots).fill(OUTSIDE),
      weights: new Float64Array(this.sampleCount * this.slots), inGrid: new Uint8Array(this.sampleCount), present: new Uint8Array([1]) };
    writeStencil(this, vertices, bary, data.indices, data.weights, data.inGrid, 0);
    const tile = new PreparedFlatMapTile(this, data), result = tile.apply(frame, policy), f = frames.get(frame)!;
    const depths = samplers.get(this)!.depths;
    const samples: FlatMapInspection['samples'] = [];
    for (let s = 0; s < this.sampleCount; s++) {
      const contributors: FlatMapInspection['samples'][number]['contributors'] = [];
      for (let k = 0; k < this.slots; k++) {
        const index = data.indices[s * this.slots + k]!, weight = data.weights[s * this.slots + k]!;
        if (!weight || index === OUTSIDE) continue;
        contributors.push({ index, weight, value: f.values[index]!, valid: isValid(f, index) });
      }
      const valid = !!data.inGrid[s] && contributors.every(c => c.valid);
      samples.push({ depth: this.kind === 'volume-scalar' ? depths[s]! : null, inGrid: !!data.inGrid[s], valid,
        value: valid ? contributors.reduce((sum, c) => sum + c.value * c.weight, 0) : NaN, contributors });
    }
    return { location, value: result.values[0]!, coverage: result.coverage[0]!, geometricCoverage: result.geometricCoverage[0]!,
      status: FLATMAP_SAMPLE_STATUSES[result.status[0]!]!, samples };
  }
}

function validateFrame(sampler: FlatMapSampler, frame: FlatMapFrame): void {
  if (!(frame instanceof FlatMapFrame) || frame.length !== sampler.sourceCount) throw new GeometryError('invalid-shape', 'Frame length does not match sampling source');
}
function isValid(frame: FrameStorage, i: number): boolean { return Number.isFinite(frame.values[i]) && (!frame.validity || !!frame.validity[i]); }

/** Write each sample separately, preserving strict trilinear stencil validity. */
function writeStencil(sampler: FlatMapSampler, vertices: ArrayLike<number>, bary: ArrayLike<number>, indices: Uint32Array,
  weights: Float64Array, inGrid: Uint8Array, pixel: number): void {
  const { source, inverse: m, depths, point } = samplers.get(sampler)!;
  const base = pixel * sampler.sampleCount * sampler.slots;
  if (source.kind === 'vertex-scalar') {
    for (let k = 0; k < 3; k++) { indices[base + k] = vertices[k]!; weights[base + k] = bary[k]!; }
    inGrid[pixel] = 1; return;
  }
  let wx = 0, wy = 0, wz = 0, px = 0, py = 0, pz = 0;
  for (let k = 0; k < 3; k++) {
    const v = vertices[k]!, w = bary[k]!;
    source.white.position(v, point);
    wx += point[0]! * w; wy += point[1]! * w; wz += point[2]! * w;
    source.pial.position(v, point);
    px += point[0]! * w; py += point[1]! * w; pz += point[2]! * w;
  }
  const ox = m![0]! * wx + m![4]! * wy + m![8]! * wz + m![12]!;
  const oy = m![1]! * wx + m![5]! * wy + m![9]! * wz + m![13]!;
  const oz = m![2]! * wx + m![6]! * wy + m![10]! * wz + m![14]!;
  const dx = m![0]! * (px - wx) + m![4]! * (py - wy) + m![8]! * (pz - wz);
  const dy = m![1]! * (px - wx) + m![5]! * (py - wy) + m![9]! * (pz - wz);
  const dz = m![2]! * (px - wx) + m![6]! * (py - wy) + m![10]! * (pz - wz);
  const [nx, ny, nz] = source.dims;
  for (let s = 0; s < depths.length; s++) {
    const t = depths[s]!, x = ox + t * dx, y = oy + t * dy, z = oz + t * dz;
    const start = base + s * sampler.slots;
    if (sampler.slots === 1) {
      if (!(x >= -0.5 && x < nx - 0.5 && y >= -0.5 && y < ny - 0.5 && z >= -0.5 && z < nz - 0.5)) continue;
      indices[start] = Math.floor(x + 0.5) + nx * (Math.floor(y + 0.5) + ny * Math.floor(z + 0.5)); weights[start] = 1;
    } else {
      if (!(x >= 0 && x <= nx - 1 && y >= 0 && y <= ny - 1 && z >= 0 && z <= nz - 1)) continue;
      const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), tx = x - x0, ty = y - y0, tz = z - z0;
      for (let k = 0; k < 8; k++) {
        const bx = k & 1, by = (k >> 1) & 1, bz = (k >> 2) & 1;
        const w = (bx ? tx : 1 - tx) * (by ? ty : 1 - ty) * (bz ? tz : 1 - tz);
        weights[start + k] = w;
        if (w > 0) indices[start + k] = (x0 + bx) + nx * ((y0 + by) + ny * (z0 + bz));
      }
    }
    inGrid[pixel * sampler.sampleCount + s] = 1;
  }
}

interface PreparedStorage { indices: Uint32Array; weights: Float64Array; inGrid: Uint8Array; present: Uint8Array }
const prepared = new WeakMap<PreparedFlatMapTile, PreparedStorage>();
export class PreparedFlatMapTile {
  readonly byteLength: number;
  readonly pixelCount: number;
  /** @internal Construct through FlatMapSampler.prepare. */
  constructor(readonly sampler: FlatMapSampler, data: PreparedStorage) {
    prepared.set(this, data); this.pixelCount = data.present.length;
    this.byteLength = data.indices.byteLength + data.weights.byteLength + data.inGrid.byteLength + data.present.byteLength;
    Object.freeze(this);
  }
  apply(frame: FlatMapFrame, options: FlatMapMissingPolicy = {}): FlatMapSamples { return runGeometrySync(this.applySteps(frame, options)); }
  applySteps(frame: FlatMapFrame, options: FlatMapMissingPolicy = {}): Generator<void, FlatMapSamples, void> {
    return this.applyOwnedSteps(frame, { ...options });
  }
  private *applyOwnedSteps(frame: FlatMapFrame, options: FlatMapMissingPolicy): Generator<void, FlatMapSamples, void> {
    validateFrame(this.sampler, frame);
    if (options.missing !== undefined && options.missing !== 'strict' && options.missing !== 'renormalize') throw new GeometryError('invalid-shape', 'Unknown missingness policy');
    const min = checkFraction(options.minCoverage ?? 1, 'minCoverage'), strict = options.missing !== 'renormalize';
    const { values: input, validity } = frames.get(frame)!, data = prepared.get(this)!;
    const n = this.pixelCount, { sampleCount, slots, kind } = this.sampler;
    const values = new Float64Array(n).fill(NaN), coverage = new Float64Array(n), geometricCoverage = new Float64Array(n);
    const valid = new Uint8Array(n), status = new Uint8Array(n);
    for (let pixel = 0; pixel < n; pixel++) {
      if (data.present[pixel]) {
        let mass = 0, total = 0, geometric = 0, allValid = true;
        for (let s = 0; s < sampleCount; s++) {
          if (!data.inGrid[pixel * sampleCount + s]) { allValid = false; continue; }
          geometric++;
          let sampleValue = 0, sampleMass = 0, complete = true;
          const start = (pixel * sampleCount + s) * slots;
          for (let k = 0; k < slots; k++) {
            const w = data.weights[start + k]!;
            if (!w) continue;
            const index = data.indices[start + k]!, value = input[index]!;
            if (!Number.isFinite(value) || (validity && !validity[index])) { complete = false; continue; }
            sampleValue += w * value; sampleMass += w;
          }
          if (!complete) allValid = false;
          if (kind === 'vertex-scalar') { total += sampleValue; mass += sampleMass; }
          else if (complete) { total += sampleValue; mass++; }
        }
        coverage[pixel] = Math.min(1, mass / sampleCount); geometricCoverage[pixel] = geometric / sampleCount;
        if (mass > 0 && coverage[pixel]! + 1e-12 >= min && (!strict || allValid)) {
          values[pixel] = total / mass; valid[pixel] = 1; status[pixel] = 4;
        } else status[pixel] = geometric === 0 ? 1 : mass === 0 ? 2 : 3;
      }
      if (pixel % 128 === 127) yield;
    }
    return { values, coverage, geometricCoverage, valid, status, byteLength: n * 26 };
  }
}
