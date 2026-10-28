import { SurfaceMetric, domainFaces, metricPositions } from './SurfaceDomain';
import { topologyData } from './SurfaceTopology';
import { checkBudget, checkFinite, checkIndex, checkMask, GeometryError } from './GeometryError';
import { runGeometrySync } from './GeometryExecutor';
import { triangleLocation, vertexLocation, evaluateSurfaceLocation, type SurfaceLocation } from './SurfaceLocation';

export type GeodesicMethod = 'edge' | 'triangle-pair';
export interface GeodesicOptions {
  method?: GeodesicMethod | undefined;
  /** Allowed traversal vertices. Shortcuts require all four incident vertices. */
  barrier?: Uint8Array | undefined;
  budgetBytes?: number;
}
export interface GeodesicNeighborhood {
  vertices: Uint32Array;
  distances: Float64Array;
  method: 'edge' | 'triangle-pair';
  units: 'mm';
}
export interface SurfacePath {
  locations: SurfaceLocation[];
  lengthMm: number;
  cost: number;
  method: 'edge' | 'triangle-pair';
}

/** Indexed heap: bounded by V, deterministic equal-distance ordering. */
class VertexHeap {
  private vertices: Uint32Array;
  private locations: Int32Array;
  size = 0;
  constructor(count: number, private keys: Float64Array) {
    this.vertices = new Uint32Array(count); this.locations = new Int32Array(count); this.locations.fill(-1);
  }
  clear(): void { for (let i = 0; i < this.size; i++) this.locations[this.vertices[i]!] = -1; this.size = 0; }
  private less(a: number, b: number): boolean { return this.keys[a]! < this.keys[b]! || (this.keys[a] === this.keys[b] && a < b); }
  private swap(a: number, b: number): void {
    const x = this.vertices[a]!, y = this.vertices[b]!;
    this.vertices[a] = y; this.vertices[b] = x; this.locations[x] = b; this.locations[y] = a;
  }
  update(vertex: number): void {
    let at = this.locations[vertex]!;
    if (at < 0) { at = this.size++; this.vertices[at] = vertex; this.locations[vertex] = at; }
    while (at > 0) { const parent = (at - 1) >>> 1; if (!this.less(this.vertices[at]!, this.vertices[parent]!)) break; this.swap(at, parent); at = parent; }
  }
  pop(): number {
    const vertex = this.vertices[0]!;
    this.size--; this.locations[vertex] = -1;
    if (this.size) {
      const last = this.vertices[this.size]!; this.vertices[0] = last; this.locations[last] = 0;
      let at = 0;
      while (at * 2 + 1 < this.size) {
        let child = at * 2 + 1;
        if (child + 1 < this.size && this.less(this.vertices[child + 1]!, this.vertices[child]!)) child++;
        if (!this.less(this.vertices[child]!, this.vertices[at]!)) break;
        this.swap(at, child); at = child;
      }
    }
    return vertex;
  }
}

/** Exact graph search on edge or unfolded-triangle-pair approximations to surface distance. */
export class GeodesicIndex {
  readonly method: 'edge' | 'triangle-pair';
  readonly byteLength: number;
  private offsets: Uint32Array;
  private neighbors: Uint32Array;
  private lengths: Float64Array;
  private crossingEdges: Int32Array;
  private crossingT: Float64Array;
  private distance: Float64Array;
  private keys: Float64Array;
  private parent: Int32Array;
  private parentArc: Int32Array;
  private generation: Uint32Array;
  private settled: Uint32Array;
  private epoch = 0;
  private heap: VertexHeap;
  private busy = false;
  private barrier: Uint8Array | undefined;
  private virtualEnd = -1;
  private virtualCost = Infinity;

  constructor(readonly metric: SurfaceMetric, options: GeodesicOptions = {}) {
    this.method = options.method ?? 'triangle-pair';
    if (this.method !== 'edge' && this.method !== 'triangle-pair') throw new GeometryError('invalid-shape', 'Unknown geodesic method');
    metric.domain.topology.requireManifold();
    const n = metric.domain.vertexCount, topo = topologyData(metric.domain.topology), p = metricPositions(metric), faces = domainFaces(metric.domain);
    checkMask(options.barrier, n); this.barrier = options.barrier?.slice();
    checkBudget(metric.byteLength + metric.domain.byteLength + n * 64 + metric.domain.topology.edgeCount * 160, options.budgetBytes);
    const capacity = this.method === 'triangle-pair' ? metric.domain.topology.edgeCount : 0;
    const shortcutA = new Uint32Array(capacity), shortcutB = new Uint32Array(capacity), shortcutEdges = new Uint32Array(capacity);
    const shortcutLengths = new Float64Array(capacity), shortcutT = new Float64Array(capacity); let shortcutCount = 0;
    const length = (a: number, b: number) => Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);
    if (this.method === 'triangle-pair') {
      for (let e = 0; e < metric.domain.topology.edgeCount; e++) {
        const first = topo.edgeFaceOffsets[e]!;
        if (topo.edgeFaceOffsets[e + 1]! - first !== 2) continue;
        const a = topo.edgeVertices[2 * e]!, b = topo.edgeVertices[2 * e + 1]!;
        const opposite = (face: number) => {
          for (let j = 0; j < 3; j++) { const v = faces[face * 3 + j]!; if (v !== a && v !== b) return v; }
          throw new GeometryError('degenerate-geometry', 'Missing opposite vertex');
        };
        const c = opposite(topo.edgeFaces[first]!), d = opposite(topo.edgeFaces[first + 1]!);
        if (this.barrier && [a, b, c, d].some(v => !this.barrier![v])) continue;
        const edgeLength = length(a, b);
        const axis = [0, 1, 2].map(j => (p[b * 3 + j]! - p[a * 3 + j]!) / edgeLength);
        const projection = (v: number) => {
          const delta = [0, 1, 2].map(j => p[v * 3 + j]! - p[a * 3 + j]!);
          const x = delta.reduce((s, x, j) => s + x * axis[j]!, 0);
          return [x, Math.hypot(...delta.map((xj, j) => xj - x * axis[j]!))] as const;
        };
        const [x, h] = projection(c), [y, k] = projection(d);
        const crossing = (x * k + y * h) / (h + k);
        if (crossing <= 0 || crossing >= edgeLength) continue;
        const slot = shortcutCount++; shortcutA[slot] = c; shortcutB[slot] = d; shortcutLengths[slot] = Math.hypot(x - y, h + k); shortcutEdges[slot] = e; shortcutT[slot] = crossing / edgeLength;
      }
    }
    const degrees = new Uint32Array(n);
    const allowed = (a: number, b: number) => !this.barrier || !!(this.barrier[a] && this.barrier[b]);
    for (let e = 0; e < topo.edgeVertices.length; e += 2) {
      const a = topo.edgeVertices[e]!, b = topo.edgeVertices[e + 1]!;
      if (allowed(a, b)) { degrees[a]!++; degrees[b]!++; }
    }
    for (let i = 0; i < shortcutCount; i++) { degrees[shortcutA[i]!]!++; degrees[shortcutB[i]!]!++; }
    this.offsets = new Uint32Array(n + 1);
    for (let v = 0; v < n; v++) this.offsets[v + 1] = this.offsets[v]! + degrees[v]!;
    const size = this.offsets[n]!;
    this.neighbors = new Uint32Array(size); this.lengths = new Float64Array(size);
    this.crossingEdges = new Int32Array(size); this.crossingEdges.fill(-1); this.crossingT = new Float64Array(size);
    const cursor = this.offsets.slice(0, n);
    const add = (a: number, b: number, distance: number, edge = -1, t = 0) => {
      const j = cursor[a]!; cursor[a]!++; this.neighbors[j] = b; this.lengths[j] = distance; this.crossingEdges[j] = edge; this.crossingT[j] = t;
    };
    for (let e = 0; e < topo.edgeVertices.length; e += 2) {
      const a = topo.edgeVertices[e]!, b = topo.edgeVertices[e + 1]!;
      if (allowed(a, b)) { const d = length(a, b); add(a, b, d); add(b, a, d); }
    }
    for (let i = 0; i < shortcutCount; i++) { add(shortcutA[i]!, shortcutB[i]!, shortcutLengths[i]!, shortcutEdges[i]!, shortcutT[i]!); add(shortcutB[i]!, shortcutA[i]!, shortcutLengths[i]!, shortcutEdges[i]!, shortcutT[i]!); }
    this.distance = new Float64Array(n); this.keys = new Float64Array(n);
    this.parent = new Int32Array(n); this.parentArc = new Int32Array(n);
    this.generation = new Uint32Array(n); this.settled = new Uint32Array(n);
    this.heap = new VertexHeap(n, this.keys);
    this.byteLength = (n + 1) * 4 + size * 24 + n * 40 + (this.barrier?.byteLength ?? 0);
  }

  withinRadius(seeds: ArrayLike<number>, radiusMm: number): GeodesicNeighborhood {
    checkFinite(radiusMm, 'radiusMm', 0);
    return runGeometrySync(this.querySteps(seeds, radiusMm));
  }
  distanceToRegion(seeds: ArrayLike<number>): Float64Array {
    const result = runGeometrySync(this.querySteps(seeds));
    const dense = new Float64Array(this.metric.domain.vertexCount); dense.fill(Infinity);
    result.vertices.forEach((v, i) => { dense[v] = result.distances[i]!; }); return dense;
  }
  allows(vertex: number): boolean { checkIndex(vertex, this.metric.domain.vertexCount); return !this.barrier || !!this.barrier[vertex]; }

  /** Resumable, single-owner search. Do not run concurrent queries on one index. */
  querySteps(seeds: ArrayLike<number>, radiusMm = Infinity, endpoint?: number,
    penalty?: Float64Array, strength = 0,
    virtual?: { initial: Float64Array; targets: Map<number, number>; point: Float64Array }): Generator<void, GeodesicNeighborhood, void> {
    return this.searchSteps(Array.from(seeds), radiusMm, endpoint, penalty?.slice(), strength, virtual ? { initial: virtual.initial.slice(), targets: new Map(virtual.targets), point: virtual.point.slice() } : undefined);
  }
  private *searchSteps(seeds: ArrayLike<number>, radiusMm: number, endpoint?: number,
    penalty?: Float64Array, strength = 0,
    virtual?: { initial: Float64Array; targets: Map<number, number>; point: Float64Array }): Generator<void, GeodesicNeighborhood, void> {
    if (this.busy) throw new GeometryError('invalid-domain', 'A geodesic query is already using this index');
    if (!(radiusMm >= 0) || (radiusMm !== Infinity && !Number.isFinite(radiusMm))) throw new GeometryError('invalid-shape', 'Invalid radius');
    const n = this.metric.domain.vertexCount;
    checkFinite(strength, 'strength', 0);
    if (penalty && (penalty.length !== n || penalty.some(x => Number.isFinite(x) && (x < 0 || x > 1)))) throw new GeometryError('invalid-shape', 'Penalty must be in [0,1] or missing');
    if (endpoint !== undefined) checkIndex(endpoint, n, 'endpoint');
    for (let i = 0; i < seeds.length; i++) { checkIndex(seeds[i]!, n, 'seed'); if (this.barrier && !this.barrier[seeds[i]!]) throw new GeometryError('invalid-domain', 'Seed excluded by barrier'); }
    this.busy = true;
    try {
      this.heap.clear();
      this.epoch = (this.epoch + 1) >>> 0;
      if (this.epoch === 0) { this.generation.fill(0); this.settled.fill(0); this.epoch = 1; }
      const p = metricPositions(this.metric);
      this.virtualEnd = -1; this.virtualCost = Infinity;
      const heuristic = (v: number) => virtual ? Math.hypot(p[v * 3]! - virtual.point[0]!, p[v * 3 + 1]! - virtual.point[1]!, p[v * 3 + 2]! - virtual.point[2]!) : endpoint === undefined ? 0 : Math.hypot(p[v * 3]! - p[endpoint * 3]!, p[v * 3 + 1]! - p[endpoint * 3 + 1]!, p[v * 3 + 2]! - p[endpoint * 3 + 2]!);
      for (let i = 0; i < seeds.length; i++) {
        const v = seeds[i]!;
        if (penalty && !Number.isFinite(penalty[v])) continue;
        this.generation[v] = this.epoch; this.distance[v] = virtual?.initial[i] ?? 0; this.keys[v] = this.distance[v]! + heuristic(v);
        this.parent[v] = -1; this.parentArc[v] = -1; this.heap.update(v);
      }
      const reached: number[] = [], distances: number[] = [];
      let pops = 0;
      while (this.heap.size) {
        const v = this.heap.pop(), distance = this.distance[v]!;
        if (virtual && this.keys[v]! > this.virtualCost) break;
        if (distance > radiusMm) continue;
        this.settled[v] = this.epoch; reached.push(v); distances.push(distance);
        const tail = virtual?.targets.get(v);
        if (tail !== undefined && distance + tail < this.virtualCost) { this.virtualCost = distance + tail; this.virtualEnd = v; }
        if (v === endpoint) break;
        for (let j = this.offsets[v]!; j < this.offsets[v + 1]!; j++) {
          const next = this.neighbors[j]!;
          if (this.settled[next] === this.epoch || (penalty && (!Number.isFinite(penalty[v]) || !Number.isFinite(penalty[next])))) continue;
          const edge = this.crossingEdges[j]!;
          if (penalty && edge >= 0) {
            const edges = topologyData(this.metric.domain.topology).edgeVertices;
            if (!Number.isFinite(penalty[edges[edge * 2]!]) || !Number.isFinite(penalty[edges[edge * 2 + 1]!])) continue;
          }
          const cost = this.lengths[j]! * (1 + strength * (penalty ? (penalty[v]! + penalty[next]!) / 2 : 0));
          const candidate = distance + cost;
          if (candidate > radiusMm) continue;
          if (this.generation[next] !== this.epoch || candidate < this.distance[next]!) {
            this.generation[next] = this.epoch; this.distance[next] = candidate; this.keys[next] = candidate + heuristic(next);
            this.parent[next] = v; this.parentArc[next] = j; this.heap.update(next);
          }
        }
        if (++pops % 128 === 0) yield;
      }
      return { vertices: Uint32Array.from(reached), distances: Float64Array.from(distances), method: this.method, units: 'mm' };
    } finally { this.busy = false; this.heap.clear(); }
  }

  shortestPath(start: number, end: number, options: { penalty?: ArrayLike<number>; strength?: number } = {}): SurfacePath {
    const n = this.metric.domain.vertexCount;
    const penalty = options.penalty ? Float64Array.from(options.penalty) : undefined;
    const strength = checkFinite(options.strength ?? 0, 'strength', 0);
    if (penalty && (penalty.length !== n || penalty.some(x => Number.isFinite(x) && (x < 0 || x > 1)))) throw new GeometryError('invalid-shape', 'Penalty must be in [0,1] or missing');
    runGeometrySync(this.querySteps([start], Infinity, end, penalty, strength));
    return this.reconstruct(end);
  }

  /** Virtual endpoints connect to their containing triangles; no nearest-vertex snapping. */
  shortestPathLocations(start: SurfaceLocation, end: SurfaceLocation): SurfacePath {
    if (start.domain !== this.metric.domain || end.domain !== this.metric.domain) throw new GeometryError('invalid-domain', 'Path endpoints must share the metric domain');
    const a = evaluateSurfaceLocation(start, this.metric), b = evaluateSurfaceLocation(end, this.metric);
    const distance = (p: ArrayLike<number>, q: ArrayLike<number>) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
    const vertices = (location: SurfaceLocation) => location.kind === 'vertex' ? [location.vertex] : [...this.metric.domain.triangle(location.face)];
    const starts = vertices(start), ends = vertices(end);
    if (starts.some(v => !this.allows(v)) || ends.some(v => !this.allows(v))) throw new GeometryError('invalid-domain', 'Endpoint triangle intersects a geodesic barrier');
    const sameFace = start.kind === 'triangle' && end.kind === 'triangle' && start.face === end.face;
    const direct = sameFace || (start.kind === 'vertex' && ends.includes(start.vertex)) || (end.kind === 'vertex' && starts.includes(end.vertex));
    if (direct) { const lengthMm = distance(a, b); return { locations: [start, end], lengthMm, cost: lengthMm, method: this.method }; }
    const initial = Float64Array.from(starts, v => distance(a, this.metric.position(v))), targets = new Map(ends.map(v => [v, distance(b, this.metric.position(v))]));
    runGeometrySync(this.querySteps(starts, Infinity, undefined, undefined, 0, { initial, targets, point: b }));
    if (this.virtualEnd < 0) return { locations: [], lengthMm: Infinity, cost: Infinity, method: this.method };
    const path = this.reconstruct(this.virtualEnd), first = path.locations[0]!;
    const lengthMm = path.lengthMm + distance(a, evaluateSurfaceLocation(first, this.metric)) + targets.get(this.virtualEnd)!;
    return { locations: [start, ...path.locations, end], lengthMm, cost: this.virtualCost, method: this.method };
  }

  private reconstruct(end: number): SurfacePath {
    if (this.settled[end] !== this.epoch) return { locations: [], lengthMm: Infinity, cost: Infinity, method: this.method };
    const locations: SurfaceLocation[] = [], topo = topologyData(this.metric.domain.topology);
    let vertex = end, lengthMm = 0;
    while (vertex >= 0) {
      locations.push(vertexLocation(this.metric.domain, vertex));
      const arc = this.parentArc[vertex]!;
      if (arc >= 0) {
        lengthMm += this.lengths[arc]!;
        const edge = this.crossingEdges[arc]!;
        if (edge >= 0) {
          const a = topo.edgeVertices[edge * 2]!, b = topo.edgeVertices[edge * 2 + 1]!, t = this.crossingT[arc]!;
          const face = topo.edgeFaces[topo.edgeFaceOffsets[edge]!]!;
          locations.push(triangleLocation(this.metric.domain, face, this.metric.domain.triangle(face).map(v => v === a ? 1 - t : v === b ? t : 0)));
        }
      }
      vertex = this.parent[vertex]!;
    }
    return { locations: locations.reverse(), lengthMm, cost: this.distance[end]!, method: this.method };
  }
}

export function createGeodesicIndex(metric: SurfaceMetric, options: GeodesicOptions = {}): GeodesicIndex { return new GeodesicIndex(metric, options); }

export function dilateSurfaceROI(index: GeodesicIndex, mask: Uint8Array, radiusMm: number): Uint8Array {
  checkMask(mask, index.metric.domain.vertexCount); checkFinite(radiusMm, 'radiusMm', 0);
  if (!radiusMm) return mask.slice();
  const seeds: number[] = []; mask.forEach((x, v) => { if (x && index.allows(v)) seeds.push(v); });
  const result = new Uint8Array(mask.length);
  index.withinRadius(seeds, radiusMm).vertices.forEach(v => { result[v] = 1; }); return result;
}

export function erodeSurfaceROI(index: GeodesicIndex, mask: Uint8Array, radiusMm: number, boundary: 'outside-is-background' | 'ignore-open-boundary' = 'ignore-open-boundary'): Uint8Array {
  checkMask(mask, index.metric.domain.vertexCount); checkFinite(radiusMm, 'radiusMm', 0);
  if (!radiusMm) return mask.slice();
  const seeds: number[] = [];
  mask.forEach((x, v) => { if (index.allows(v) && (!x || (boundary === 'outside-is-background' && index.metric.domain.topology.isBoundary(v)))) seeds.push(v); });
  const result = Uint8Array.from(mask, (x, v) => index.allows(v) ? x : 0); index.withinRadius(seeds, radiusMm).vertices.forEach(v => { result[v] = 0; }); return result;
}
