import { checkBudget, checkIndex, GeometryError } from './GeometryError';
import { SurfaceTopology } from './SurfaceTopology';

export interface SurfaceDomainOptions {
  id: string;
  structure: string;
  vertexCount: number;
  faces: ArrayLike<number>;
  budgetBytes?: number;
}
export interface SurfaceMetricOptions {
  positions: ArrayLike<number>;
  frame: string;
  units: 'mm';
  budgetBytes?: number;
}
interface DomainStorage { faces: Uint32Array; fingerprint?: Promise<string> }
interface MetricStorage { positions: Float64Array; fingerprint?: Promise<string> }
const domains = new WeakMap<SurfaceDomain, DomainStorage>();
const metrics = new WeakMap<SurfaceMetric, MetricStorage>();
let serial = 0;
/** @internal Borrow read-only storage inside computation kernels only. */
export function domainFaces(domain: SurfaceDomain): Uint32Array { return domains.get(domain)!.faces; }
/** @internal Borrow read-only storage inside computation kernels only. */
export function metricPositions(metric: SurfaceMetric): Float64Array { return metrics.get(metric)!.positions; }

export async function geometryDigest(descriptor: unknown, arrays: readonly (Float64Array | Uint32Array)[]): Promise<string> {
  const prefix = new TextEncoder().encode(JSON.stringify(descriptor));
  const bytes = new Uint8Array(4 + prefix.length + arrays.reduce((s, a) => s + 4 + a.byteLength, 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, prefix.length, true); bytes.set(prefix, 4);
  let offset = 4 + prefix.length;
  for (const array of arrays) {
    view.setUint32(offset, array.length, true); offset += 4;
    for (let i = 0; i < array.length; i++) {
      if (array instanceof Float64Array) view.setFloat64(offset, array[i]!, true);
      else view.setUint32(offset, array[i]!, true);
      offset += array.BYTES_PER_ELEMENT;
    }
  }
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

/** Owned topology and explicit vertex correspondence, independent of display embedding. */
export class SurfaceDomain {
  readonly id: string;
  readonly structure: string;
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly snapshotId: string;
  readonly topology: SurfaceTopology;
  readonly byteLength: number;

  constructor(options: SurfaceDomainOptions) {
    if (!options.id?.trim() || !options.structure?.trim()) throw new GeometryError('invalid-domain', 'Domain id and structure are required');
    const n = options.vertexCount, faces = options.faces;
    if (!Number.isSafeInteger(n) || n < 1 || n > 10_000_000 || !Number.isSafeInteger(faces.length) || !faces.length || faces.length % 3 || faces.length > 60_000_000) {
      throw new GeometryError('invalid-shape', 'Invalid vertex count or triangle layout');
    }
    checkBudget(76 * faces.length + 64 * n + 4096, options.budgetBytes);
    for (let i = 0; i < faces.length; i++) checkIndex(faces[i]!, n, `face index ${i}`);
    const owned = Uint32Array.from(faces);
    this.id = options.id; this.structure = options.structure; this.vertexCount = n; this.faceCount = faces.length / 3;
    this.snapshotId = `surface-domain-${++serial}`;
    this.topology = new SurfaceTopology(owned, n, options.budgetBytes);
    this.byteLength = owned.byteLength + this.topology.byteLength;
    domains.set(this, { faces: owned });
    Object.freeze(this);
  }

  copyFaces(): Uint32Array { return domainFaces(this).slice(); }
  triangle(face: number): readonly [number, number, number] {
    checkIndex(face, this.faceCount, 'face'); const f = domainFaces(this), i = face * 3;
    return [f[i]!, f[i + 1]!, f[i + 2]!];
  }
  fingerprint(): Promise<string> {
    const d = domains.get(this)!;
    return d.fingerprint ??= geometryDigest({ version: 1, id: this.id, structure: this.structure, vertexCount: this.vertexCount }, [d.faces]);
  }
}

/** An immutable anatomical embedding in millimetres. Updating positions creates a new metric. */
export class SurfaceMetric {
  readonly snapshotId: string;
  readonly frame: string;
  readonly units = 'mm' as const;
  readonly byteLength: number;
  constructor(readonly domain: SurfaceDomain, options: SurfaceMetricOptions) {
    if (!(domain instanceof SurfaceDomain)) throw new GeometryError('invalid-domain', 'Expected a SurfaceDomain');
    if (!options.frame?.trim() || options.units !== 'mm') throw new GeometryError('frame-mismatch', 'Metric requires a named frame and mm units');
    if (options.positions.length !== domain.vertexCount * 3) throw new GeometryError('invalid-shape', 'Position count does not match domain');
    checkBudget(domain.byteLength + options.positions.length * 16, options.budgetBytes);
    const positions = Float64Array.from(options.positions);
    if (positions.some(x => !Number.isFinite(x))) throw new GeometryError('invalid-shape', 'Positions must be finite');
    const faces = domainFaces(domain);
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f]! * 3, b = faces[f + 1]! * 3, c = faces[f + 2]! * 3;
      const u = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
      const v = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
      const scale = Math.max(...u.map(Math.abs), ...v.map(Math.abs));
      if (!(scale > 0) || !Number.isFinite(scale)) throw new GeometryError('degenerate-geometry', `Invalid face ${f / 3}`);
      for (let j = 0; j < 3; j++) { u[j]! /= scale; v[j]! /= scale; }
      const cross = Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!);
      if (cross <= 64 * Number.EPSILON || !(cross * scale * scale > 0) || !Number.isFinite(cross * scale * scale)) throw new GeometryError('degenerate-geometry', `Degenerate, underflowing or overflowing face ${f / 3}`);
    }
    this.frame = options.frame; this.snapshotId = `surface-metric-${++serial}`; this.byteLength = positions.byteLength;
    metrics.set(this, { positions }); Object.freeze(this);
  }
  copyPositions(): Float64Array { return metricPositions(this).slice(); }
  position(vertex: number, out = new Float64Array(3)): Float64Array {
    checkIndex(vertex, this.domain.vertexCount, 'vertex');
    if (out.length !== 3) throw new GeometryError('invalid-shape', 'Position output must have length 3');
    const p = metricPositions(this); for (let j = 0; j < 3; j++) out[j] = p[vertex * 3 + j]!;
    return out;
  }
  fingerprint(): Promise<string> {
    const m = metrics.get(this)!;
    return m.fingerprint ??= this.domain.fingerprint().then(domain => geometryDigest({ version: 1, domain, frame: this.frame, units: this.units }, [m.positions]));
  }
}
