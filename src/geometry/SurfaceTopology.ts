import { checkBudget, checkIndex, GeometryError } from './GeometryError';

/** Internal packed topology. Never return these mutable arrays from the public API. */
export interface TopologyData {
  neighborOffsets: Uint32Array;
  neighbors: Uint32Array;
  vertexFaceOffsets: Uint32Array;
  vertexFaces: Uint32Array;
  edgeVertices: Uint32Array;
  edgeFaceOffsets: Uint32Array;
  edgeFaces: Uint32Array;
  faceEdges: Uint32Array;
  boundary: Uint8Array;
  components: Uint32Array;
  componentCount: number;
  nonManifoldEdges: number;
  nonManifoldVertices: number;
  inconsistentEdges: number;
  byteLength: number;
}

/** Stable lexicographic radix sort of record indices, with uint32 keys. */
function radixOrder(keys: readonly Uint32Array[]): Uint32Array {
  const n = keys[0]!.length;
  let order = Uint32Array.from({ length: n }, (_, i) => i);
  let scratch = new Uint32Array(n);
  const counts = new Uint32Array(256);
  for (let key = keys.length - 1; key >= 0; key--) {
    for (let shift = 0; shift < 32; shift += 8) {
      counts.fill(0);
      for (let i = 0; i < n; i++) counts[(keys[key]![order[i]!]! >>> shift) & 255]!++;
      let offset = 0;
      for (let b = 0; b < 256; b++) { const count = counts[b]!; counts[b] = offset; offset += count; }
      for (let i = 0; i < n; i++) {
        const id = order[i]!;
        scratch[counts[(keys[key]![id]! >>> shift) & 255]!] = id;
        counts[(keys[key]![id]! >>> shift) & 255]!++;
      }
      [order, scratch] = [scratch, order];
    }
  }
  return order;
}

function offsets(counts: Uint32Array): Uint32Array {
  const result = new Uint32Array(counts.length + 1);
  let sum = 0;
  for (let i = 0; i < counts.length; i++) {
    sum += counts[i]!;
    if (sum > 0xffffffff) throw new GeometryError('budget-exceeded', 'CSR offset overflow');
    result[i + 1] = sum;
  }
  return result;
}

export function buildTopologyData(faces: Uint32Array, count: number, budget?: number): TopologyData {
  const fCount = faces.length / 3;
  // Conservative bound includes faces, radix keys/order/scratch, CSR and BFS queue.
  checkBudget(72 * faces.length + 64 * count + 4096, budget);
  const keys = [new Uint32Array(fCount), new Uint32Array(fCount), new Uint32Array(fCount)];
  for (let f = 0; f < fCount; f++) {
    const sorted = [faces[3 * f]!, faces[3 * f + 1]!, faces[3 * f + 2]!].sort((a, b) => a - b);
    if (sorted[0] === sorted[1] || sorted[1] === sorted[2]) throw new GeometryError('degenerate-geometry', `Repeated vertex in face ${f}`);
    for (let j = 0; j < 3; j++) keys[j]![f] = sorted[j]!;
  }
  const sortedFaces = radixOrder(keys);
  for (let i = 1; i < fCount; i++) {
    const a = sortedFaces[i - 1]!, b = sortedFaces[i]!;
    if (keys.every(key => key[a] === key[b])) throw new GeometryError('degenerate-geometry', `Duplicate faces ${a}, ${b}`);
  }
  const lo = new Uint32Array(faces.length), hi = new Uint32Array(faces.length);
  for (let c = 0; c < faces.length; c++) {
    const a = faces[c]!, b = faces[Math.floor(c / 3) * 3 + (c + 1) % 3]!;
    lo[c] = Math.min(a, b); hi[c] = Math.max(a, b);
  }
  const order = radixOrder([lo, hi]);
  let edgeCount = 0;
  for (let i = 0; i < order.length; i++) {
    const c = order[i]!, prev = order[i - 1];
    if (prev === undefined || lo[c] !== lo[prev] || hi[c] !== hi[prev]) edgeCount++;
  }
  const edgeVertices = new Uint32Array(2 * edgeCount);
  const edgeFaceOffsets = new Uint32Array(edgeCount + 1);
  const edgeFaces = new Uint32Array(faces.length), faceEdges = new Uint32Array(faces.length);
  const boundary = new Uint8Array(count), degree = new Uint32Array(count), faceDegree = new Uint32Array(count);
  let edge = -1, nonManifoldEdges = 0, inconsistentEdges = 0;
  for (let i = 0; i < order.length; i++) {
    const c = order[i]!, prev = order[i - 1];
    if (prev === undefined || lo[c] !== lo[prev] || hi[c] !== hi[prev]) {
      edge++;
      edgeVertices[edge * 2] = lo[c]!; edgeVertices[edge * 2 + 1] = hi[c]!;
      edgeFaceOffsets[edge] = i;
      degree[lo[c]!]!++; degree[hi[c]!]!++;
    }
    edgeFaces[i] = Math.floor(c / 3); faceEdges[c] = edge;
    faceDegree[faces[c]!]!++;
  }
  edgeFaceOffsets[edgeCount] = faces.length;
  for (let e = 0; e < edgeCount; e++) {
    const first = edgeFaceOffsets[e]!, end = edgeFaceOffsets[e + 1]!;
    if (end - first === 1) { boundary[edgeVertices[e * 2]!] = 1; boundary[edgeVertices[e * 2 + 1]!] = 1; }
    if (end - first > 2) nonManifoldEdges++;
    if (end - first === 2 && faces[order[first]!] === faces[order[first + 1]!]) inconsistentEdges++;
  }
  const neighborOffsets = offsets(degree), neighbors = new Uint32Array(edgeCount * 2);
  const next = neighborOffsets.slice(0, count);
  for (let e = 0; e < edgeCount; e++) {
    const a = edgeVertices[e * 2]!, b = edgeVertices[e * 2 + 1]!;
    neighbors[next[a]!] = b; next[a]!++;
    neighbors[next[b]!] = a; next[b]!++;
  }
  const vertexFaceOffsets = offsets(faceDegree), vertexFaces = new Uint32Array(faces.length);
  next.set(vertexFaceOffsets.subarray(0, count));
  for (let c = 0; c < faces.length; c++) { const v = faces[c]!; vertexFaces[next[v]!] = Math.floor(c / 3); next[v]!++; }
  // A manifold vertex has a single connected fan of incident faces. Edge counts
  // alone miss two triangle fans touching only at a bow-tie vertex.
  let nonManifoldVertices = 0;
  const visitedFaces = new Uint32Array(fCount), fanQueue = new Uint32Array(fCount);
  for (let v = 0; v < count; v++) {
    const begin = vertexFaceOffsets[v]!, end = vertexFaceOffsets[v + 1]!;
    if (begin === end) continue;
    let head = 0, tail = 1; fanQueue[0] = vertexFaces[begin]!; visitedFaces[fanQueue[0]!] = v + 1;
    while (head < tail) {
      const face = fanQueue[head++]!;
      for (let corner = 0; corner < 3; corner++) {
        const a = faces[face * 3 + corner]!, b = faces[face * 3 + (corner + 1) % 3]!;
        if (a !== v && b !== v) continue;
        const edge = faceEdges[face * 3 + corner]!;
        for (let j = edgeFaceOffsets[edge]!; j < edgeFaceOffsets[edge + 1]!; j++) {
          const other = edgeFaces[j]!;
          if (visitedFaces[other] !== v + 1) { visitedFaces[other] = v + 1; fanQueue[tail++] = other; }
        }
      }
    }
    if (tail !== end - begin) nonManifoldVertices++;
  }
  const components = new Uint32Array(count); components.fill(0xffffffff);
  const queue = new Uint32Array(count);
  let componentCount = 0;
  for (let root = 0; root < count; root++) {
    if (components[root] !== 0xffffffff) continue;
    let head = 0, tail = 1; queue[0] = root; components[root] = componentCount;
    while (head < tail) {
      const v = queue[head++]!;
      for (let j = neighborOffsets[v]!; j < neighborOffsets[v + 1]!; j++) {
        const n = neighbors[j]!;
        if (components[n] === 0xffffffff) { components[n] = componentCount; queue[tail++] = n; }
      }
    }
    componentCount++;
  }
  const arrays = { neighborOffsets, neighbors, vertexFaceOffsets, vertexFaces, edgeVertices, edgeFaceOffsets, edgeFaces, faceEdges, boundary, components };
  return { ...arrays, componentCount, nonManifoldEdges, nonManifoldVertices, inconsistentEdges,
    byteLength: Object.values(arrays).reduce((sum, array) => sum + array.byteLength, 0) };
}

const data = new WeakMap<SurfaceTopology, TopologyData>();
export function topologyData(topology: SurfaceTopology): TopologyData { return data.get(topology)!; }

/** Immutable compact topology; array accessors return owned copies. */
export class SurfaceTopology {
  readonly vertexCount: number;
  readonly edgeCount: number;
  readonly faceCount: number;
  readonly componentCount: number;
  readonly byteLength: number;
  readonly nonManifoldEdges: number;
  readonly nonManifoldVertices: number;
  readonly inconsistentEdges: number;

  /** @internal Construct through SurfaceDomain. */
  constructor(faces: Uint32Array, vertexCount: number, budget?: number) {
    const d = buildTopologyData(faces, vertexCount, budget);
    data.set(this, d);
    this.vertexCount = vertexCount; this.faceCount = faces.length / 3; this.edgeCount = d.edgeVertices.length / 2;
    this.componentCount = d.componentCount; this.byteLength = d.byteLength;
    this.nonManifoldEdges = d.nonManifoldEdges; this.inconsistentEdges = d.inconsistentEdges;
    this.nonManifoldVertices = d.nonManifoldVertices;
    Object.freeze(this);
  }

  neighbors(vertex: number): Uint32Array {
    checkIndex(vertex, this.vertexCount, 'vertex');
    const d = topologyData(this);
    return d.neighbors.slice(d.neighborOffsets[vertex], d.neighborOffsets[vertex + 1]);
  }

  incidentFaces(vertex: number): Uint32Array {
    checkIndex(vertex, this.vertexCount, 'vertex');
    const d = topologyData(this);
    return d.vertexFaces.slice(d.vertexFaceOffsets[vertex], d.vertexFaceOffsets[vertex + 1]);
  }

  isBoundary(vertex: number): boolean { checkIndex(vertex, this.vertexCount); return topologyData(this).boundary[vertex] === 1; }
  component(vertex: number): number { checkIndex(vertex, this.vertexCount); return topologyData(this).components[vertex]!; }
  requireManifold(oriented = false): void {
    if (this.nonManifoldEdges || this.nonManifoldVertices || (oriented && this.inconsistentEdges)) {
      throw new GeometryError('unsupported-topology', `Mesh has ${this.nonManifoldEdges} non-manifold edges, ${this.nonManifoldVertices} non-manifold vertices and ${this.inconsistentEdges} inconsistently wound edges`);
    }
  }
}
