import { SurfaceDomain, SurfaceMetric } from './SurfaceDomain';
import { checkFinite, checkIndex, GeometryError } from './GeometryError';

export type SurfaceLocation = Readonly<{ domain: SurfaceDomain; kind: 'vertex'; vertex: number }> |
  Readonly<{ domain: SurfaceDomain; kind: 'triangle'; face: number; weights: readonly [number, number, number] }>;

export interface SurfacePositionBinding {
  readonly domain: SurfaceDomain;
  position(vertex: number, out?: Float64Array): Float64Array;
}
export interface SurfaceAnchor {
  readonly location: SurfaceLocation;
  readonly offset?: number;
  readonly offsetFrame?: 'metric' | 'display';
}

export function vertexLocation(domain: SurfaceDomain, vertex: number): SurfaceLocation {
  checkIndex(vertex, domain.vertexCount, 'vertex');
  return Object.freeze({ domain, kind: 'vertex', vertex });
}

export function triangleLocation(domain: SurfaceDomain, face: number, weights: ArrayLike<number>): SurfaceLocation {
  checkIndex(face, domain.faceCount, 'face');
  if (weights.length !== 3) throw new GeometryError('invalid-weights', 'Barycentric weights require three values');
  const w = Array.from(weights);
  if (w.some(x => !Number.isFinite(x) || x < -1e-12) || Math.abs(w[0]! + w[1]! + w[2]! - 1) > 1e-10) {
    throw new GeometryError('invalid-weights', 'Barycentric weights must be nonnegative and sum to one');
  }
  const clamped = w.map(x => Math.max(0, x)), sum = clamped.reduce((a, b) => a + b, 0);
  const normalized = Object.freeze(clamped.map(x => x / sum)) as readonly [number, number, number];
  return Object.freeze({ domain, kind: 'triangle', face, weights: normalized });
}

export function evaluateSurfaceLocation(location: SurfaceLocation, binding: SurfacePositionBinding, out = new Float64Array(3)): Float64Array {
  if (location.domain !== binding.domain) throw new GeometryError('invalid-domain', 'Surface location and embedding must share the registered domain');
  if (out.length !== 3) throw new GeometryError('invalid-shape', 'Position output must have length three');
  if (location.kind === 'vertex') return binding.position(location.vertex, out);
  const ids = location.domain.triangle(location.face);
  out.fill(0); const p = new Float64Array(3);
  for (let j = 0; j < 3; j++) {
    binding.position(ids[j]!, p);
    for (let axis = 0; axis < 3; axis++) out[axis]! += location.weights[j]! * p[axis]!;
  }
  return out;
}

/** Face-normal offset. Vertex anchors average incident area-weighted face normals. */
export function evaluateSurfaceAnchor(anchor: SurfaceAnchor, binding: SurfacePositionBinding, out = new Float64Array(3)): Float64Array {
  if (anchor.offsetFrame !== undefined && anchor.offsetFrame !== 'metric' && anchor.offsetFrame !== 'display') throw new GeometryError('frame-mismatch', 'Unknown anchor offset frame');
  evaluateSurfaceLocation(anchor.location, binding, out);
  const offset = checkFinite(anchor.offset ?? 0, 'offset');
  if (!offset) return out;
  if ((anchor.offsetFrame ?? 'display') === 'metric' && !(binding instanceof SurfaceMetric)) {
    throw new GeometryError('frame-mismatch', 'Metric offsets require a SurfaceMetric');
  }
  const location = anchor.location;
  const faces = location.kind === 'triangle' ? [location.face] : location.domain.topology.incidentFaces(location.vertex);
  const normal = [0, 0, 0];
  for (const face of faces) {
    const ids = location.domain.triangle(face);
    const a = binding.position(ids[0]), b = binding.position(ids[1]), c = binding.position(ids[2]);
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    normal[0]! += uy * vz - uz * vy; normal[1]! += uz * vx - ux * vz; normal[2]! += ux * vy - uy * vx;
  }
  const length = Math.hypot(...normal);
  if (!Number.isFinite(length) || length === 0) throw new GeometryError('degenerate-geometry', 'Anchor normal is undefined');
  for (let i = 0; i < 3; i++) out[i]! += offset * normal[i]! / length;
  return out;
}

export interface SerializedSurfaceLocations {
  schema: 'surfview.surface-locations.v1';
  topology: string;
  locations: Array<{ kind: 'vertex'; vertex: number } | { kind: 'triangle'; face: number; weights: number[] }>;
}
export async function exportSurfaceLocations(domain: SurfaceDomain, locations: readonly SurfaceLocation[]): Promise<SerializedSurfaceLocations> {
  return { schema: 'surfview.surface-locations.v1', topology: await domain.fingerprint(), locations: locations.map(location => {
    if (location.domain !== domain) throw new GeometryError('invalid-domain', 'Mixed domains in location collection');
    return location.kind === 'vertex' ? { kind: 'vertex', vertex: location.vertex } : { kind: 'triangle', face: location.face, weights: [...location.weights] };
  }) };
}
export async function importSurfaceLocations(domain: SurfaceDomain, artifact: SerializedSurfaceLocations): Promise<SurfaceLocation[]> {
  if (artifact?.schema !== 'surfview.surface-locations.v1' || artifact.topology !== await domain.fingerprint()) {
    throw new GeometryError('invalid-domain', 'Location artifact schema or topology does not match');
  }
  if (!Array.isArray(artifact.locations)) throw new GeometryError('invalid-shape', 'Missing locations array');
  return artifact.locations.map(location => {
    if (!location) throw new GeometryError('invalid-shape', 'Invalid location');
    if (location.kind === 'vertex') return vertexLocation(domain, location.vertex);
    if (location.kind === 'triangle') return triangleLocation(domain, location.face, location.weights);
    throw new GeometryError('invalid-shape', 'Unknown location kind');
  });
}

export interface SerializedSurfaceAnchors {
  schema: 'surfview.surface-anchors.v1';
  locations: SerializedSurfaceLocations;
  offsets: Array<{ value: number; frame: 'metric' | 'display' }>;
  metadata: unknown[];
}
/** Separate artifact: does not change portable scene schemas or silently round to vertices. */
export async function exportSurfaceAnchors(domain: SurfaceDomain, anchors: readonly SurfaceAnchor[], metadata: readonly unknown[] = anchors.map(() => null)): Promise<SerializedSurfaceAnchors> {
  if (metadata.length !== anchors.length) throw new GeometryError('invalid-shape', 'Anchor metadata count differs');
  const offsets = anchors.map(anchor => {
    const frame = anchor.offsetFrame ?? 'display';
    if (frame !== 'metric' && frame !== 'display') throw new GeometryError('frame-mismatch', 'Invalid offset frame');
    return { value: checkFinite(anchor.offset ?? 0, 'offset'), frame };
  });
  return { schema: 'surfview.surface-anchors.v1', locations: await exportSurfaceLocations(domain, anchors.map(a => a.location)), offsets, metadata: JSON.parse(JSON.stringify(metadata)) as unknown[] };
}
export async function importSurfaceAnchors(domain: SurfaceDomain, artifact: SerializedSurfaceAnchors): Promise<Array<{ anchor: SurfaceAnchor; metadata: unknown }>> {
  if (artifact?.schema !== 'surfview.surface-anchors.v1' || !Array.isArray(artifact.offsets) || !Array.isArray(artifact.metadata)) throw new GeometryError('invalid-shape', 'Invalid anchor artifact');
  const locations = await importSurfaceLocations(domain, artifact.locations);
  if (artifact.offsets.length !== locations.length || artifact.metadata.length !== locations.length) throw new GeometryError('invalid-shape', 'Anchor artifact counts differ');
  return locations.map((location, i) => {
    const offset = artifact.offsets[i];
    if (!offset || (offset.frame !== 'metric' && offset.frame !== 'display')) throw new GeometryError('frame-mismatch', 'Invalid offset frame');
    return { anchor: Object.freeze({ location, offset: checkFinite(offset.value, 'offset'), offsetFrame: offset.frame }), metadata: artifact.metadata[i] };
  });
}

/** Explicit one-to-one vertex correspondence; triangle weights follow the mapped vertex order. */
export function remapSurfaceLocation(location: SurfaceLocation, target: SurfaceDomain, vertexMap: ArrayLike<number>): SurfaceLocation {
  if (vertexMap.length !== location.domain.vertexCount) throw new GeometryError('invalid-shape', 'Vertex correspondence must match source domain');
  const sourceVertices = location.kind === 'vertex' ? [location.vertex] : location.domain.triangle(location.face), mapped = sourceVertices.map(v => vertexMap[v]!);
  for (const v of mapped) checkIndex(v, target.vertexCount, 'mapped vertex');
  if (location.kind === 'vertex') return vertexLocation(target, mapped[0]!);
  if (new Set(mapped).size !== 3) throw new GeometryError('invalid-domain', 'Mapped triangle collapses');
  for (const face of target.topology.incidentFaces(mapped[0]!)) {
    const ids = target.triangle(face);
    if (ids.every(v => mapped.includes(v))) return triangleLocation(target, face, ids.map(v => location.weights[mapped.indexOf(v)]!));
  }
  throw new GeometryError('invalid-domain', 'Correspondence does not map to a target triangle');
}

/** Display-only, bounded miter at shared edges/vertices. Measurement coordinates stay unchanged. */
export function evaluateSurfaceStrokePoint(location: SurfaceLocation, binding: SurfacePositionBinding, offset = 0.2): Float64Array {
  const point = evaluateSurfaceLocation(location, binding);
  checkFinite(offset, 'offset');
  if (!offset) return point;
  const support = location.kind === 'vertex' ? [location.vertex] : location.domain.triangle(location.face).filter((_, i) => location.weights[i]! > 1e-12);
  const faces = [...location.domain.topology.incidentFaces(support[0]!)].filter(face => support.every(v => location.domain.triangle(face).includes(v)));
  const normals: number[][] = [];
  for (const face of faces) {
    const ids = location.domain.triangle(face), a = binding.position(ids[0]), b = binding.position(ids[1]), c = binding.position(ids[2]);
    const u = b.map((x, i) => x - a[i]!), v = c.map((x, i) => x - a[i]!);
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!], length = Math.hypot(...n);
    if (length > 0) normals.push(n.map(x => x / length));
  }
  const sum = [0, 1, 2].map(i => normals.reduce((s, n) => s + n[i]!, 0)), length = Math.hypot(...sum);
  if (!length) return point;
  const direction = sum.map(x => x / length);
  const projection = Math.min(...normals.map(n => n.reduce((s, x, i) => s + x * direction[i]!, 0)));
  // Bound the display displacement at near-foldbacks; never move scientific endpoints.
  const distance = offset / Math.max(0.25, projection);
  for (let i = 0; i < 3; i++) point[i]! += direction[i]! * distance;
  return point;
}
