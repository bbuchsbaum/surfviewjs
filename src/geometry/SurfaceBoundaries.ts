import { SurfaceDomain } from './SurfaceDomain';
import { topologyData } from './SurfaceTopology';
import { checkBudget, checkIndex, GeometryError } from './GeometryError';
import { triangleLocation, type SurfaceLocation } from './SurfaceLocation';
import { partitionLabelTriangle, type BarycentricPoint } from './labelPartition';

export interface SurfaceBoundarySegment { readonly from: number; readonly to: number; readonly left: number; readonly right: number; readonly face: number }
export interface BoundarySelection { parcels?: readonly number[]; includeBackground?: boolean }
export interface SurfaceBoundaryCurve {
  locations: SurfaceLocation[];
  locationIds: Uint32Array;
  labels: readonly [number, number];
  closed: boolean;
  terminals: readonly ['closed' | 'junction' | 'mesh-boundary', 'closed' | 'junction' | 'mesh-boundary'];
}

/** Owns labels and per-face interfaces; neighboring parcels share every interface once. */
export class SurfaceBoundaryGraph {
  private labels: Float64Array;
  private faceSegments = new Map<number, SurfaceBoundarySegment[]>();
  private points: SurfaceLocation[] = [];
  private pointKeys = new Map<number, number>();
  private _revision = 0;
  private segmentCount = 0;
  private budget: number | undefined;
  readonly background: number;
  constructor(readonly domain: SurfaceDomain, labels: ArrayLike<number>, options: { background: number; budgetBytes?: number }) {
    domain.topology.requireManifold(true);
    if (labels.length !== domain.vertexCount || !Number.isSafeInteger(options.background)) throw new GeometryError('invalid-shape', 'Labels and background must match the domain');
    this.budget = options.budgetBytes;
    checkBudget(domain.byteLength + domain.vertexCount * 8, options.budgetBytes);
    this.labels = Float64Array.from(labels); this.background = options.background;
    for (const label of this.labels) this.validateLabel(label);
    for (let face = 0; face < domain.faceCount; face++) this.updateFace(face);
  }
  get revision(): number { return this._revision; }
  get byteLength(): number { return this.labels.byteLength + this.points.length * 192 + this.segmentCount * 128 + this.faceSegments.size * 64; }
  get locations(): readonly SurfaceLocation[] { return Object.freeze([...this.points]); }
  location(id: number): SurfaceLocation { checkIndex(id, this.points.length, 'boundary location'); return this.points[id]!; }
  copyLabels(): Float64Array { return this.labels.slice(); }
  segments(selection: BoundarySelection = {}): readonly SurfaceBoundarySegment[] {
    const parcels = selection.parcels ? new Set(selection.parcels) : null;
    const output: SurfaceBoundarySegment[] = [];
    for (const face of [...this.faceSegments.keys()].sort((a, b) => a - b)) {
      for (const s of this.faceSegments.get(face)!) {
        if (selection.includeBackground === false && (s.left === this.background || s.right === this.background)) continue;
        if (parcels && !parcels.has(s.left) && !parcels.has(s.right)) continue;
        output.push(s);
      }
    }
    return output;
  }
  updateLabels(changes: readonly { vertex: number; label: number }[]): { revision: number; affectedFaces: number } {
    for (const c of changes) { checkIndex(c.vertex, this.domain.vertexCount); this.validateLabel(c.label); }
    const affected = new Set<number>(), topo = topologyData(this.domain.topology);
    for (const c of changes) {
      if (this.labels[c.vertex] === c.label) continue;
      for (let i = topo.vertexFaceOffsets[c.vertex]!; i < topo.vertexFaceOffsets[c.vertex + 1]!; i++) affected.add(topo.vertexFaces[i]!);
    }
    // Reserve the worst-case new points/segments before changing labels, so a
    // rejected edit cannot leave a partially updated graph.
    checkBudget(this.domain.byteLength + this.byteLength + affected.size * 1344, this.budget);
    for (const c of changes) this.labels[c.vertex] = c.label;
    for (const face of affected) this.updateFace(face);
    if (affected.size) this._revision++;
    return { revision: this._revision, affectedFaces: affected.size };
  }
  private validateLabel(label: number): void {
    if (!Number.isSafeInteger(label) || label < -0x80000000 || label > 0xffffffff) throw new GeometryError('invalid-shape', `Invalid integer label ${label}`);
  }
  private point(face: number, weights: BarycentricPoint): number {
    const topo = topologyData(this.domain.topology);
    const zero = weights.indexOf(0);
    // An edge opposite local vertex z starts at local vertex (z+1)%3.
    const key = zero < 0 ? this.domain.topology.edgeCount + face : topo.faceEdges[face * 3 + (zero + 1) % 3]!;
    const found = this.pointKeys.get(key);
    if (found !== undefined) return found;
    checkBudget(this.domain.byteLength + this.byteLength + 192, this.budget);
    const id = this.points.length; this.points.push(triangleLocation(this.domain, face, weights)); this.pointKeys.set(key, id); return id;
  }
  private updateFace(face: number): void {
    const ids = this.domain.triangle(face);
    const labels = ids.map(v => this.labels[v]!) as [number, number, number];
    const result = partitionLabelTriangle(labels).boundaries.map(b => Object.freeze({ from: this.point(face, b.from), to: this.point(face, b.to), left: b.left, right: b.right, face }));
    const change = result.length - (this.faceSegments.get(face)?.length ?? 0);
    checkBudget(this.domain.byteLength + this.byteLength + Math.max(0, change) * 192, this.budget);
    this.segmentCount += change;
    if (result.length) this.faceSegments.set(face, result); else this.faceSegments.delete(face);
  }
}

export function buildSurfaceBoundaryGraph(domain: SurfaceDomain, labels: ArrayLike<number>, options: { background: number; budgetBytes?: number }): SurfaceBoundaryGraph {
  return new SurfaceBoundaryGraph(domain, labels, options);
}

/** Trace label-pair curves; topology IDs, rather than approximate XYZ welding, define connectivity. */
export function traceBoundaryCurves(graph: SurfaceBoundaryGraph, selection: BoundarySelection = {}): SurfaceBoundaryCurve[] {
  const segments = graph.segments(selection), locations = graph.locations;
  const adjacency = new Map<number, number[]>();
  const allDegrees = new Map<number, number>();
  for (const s of graph.segments()) for (const v of [s.from, s.to]) allDegrees.set(v, (allDegrees.get(v) ?? 0) + 1);
  segments.forEach((s, i) => { for (const v of [s.from, s.to]) { const list = adjacency.get(v) ?? []; list.push(i); adjacency.set(v, list); } });
  const used = new Uint8Array(segments.length), curves: SurfaceBoundaryCurve[] = [];
  const pair = (s: SurfaceBoundarySegment): [number, number] => [Math.min(s.left, s.right), Math.max(s.left, s.right)];
  const same = (a: SurfaceBoundarySegment, b: SurfaceBoundarySegment) => Math.min(a.left, a.right) === Math.min(b.left, b.right) && Math.max(a.left, a.right) === Math.max(b.left, b.right);
  const isTerminal = (v: number, edge: number) => {
    const list = adjacency.get(v)!;
    return list.length !== 2 || !list.every(i => same(segments[edge]!, segments[i]!));
  };
  const reason = (v: number): 'junction' | 'mesh-boundary' => (allDegrees.get(v) ?? 0) > 1 ? 'junction' : 'mesh-boundary';
  const trace = (first: number, start: number) => {
    if (used[first]) return;
    const ids = [start]; let vertex = start, edge = first;
    for (;;) {
      used[edge] = 1; const s = segments[edge]!; vertex = vertex === s.from ? s.to : s.from; ids.push(vertex);
      if (vertex === start || isTerminal(vertex, edge)) break;
      const next = adjacency.get(vertex)!.find(i => !used[i]); if (next === undefined) break; edge = next;
    }
    const closed = vertex === start;
    curves.push({ locations: ids.map(id => locations[id]!), locationIds: Uint32Array.from(ids), labels: pair(segments[first]!), closed,
      terminals: closed ? ['closed', 'closed'] : [reason(start), reason(vertex)] });
  };
  segments.forEach((s, i) => { if (isTerminal(s.from, i)) trace(i, s.from); else if (isTerminal(s.to, i)) trace(i, s.to); });
  segments.forEach((s, i) => trace(i, s.from));
  return curves;
}
