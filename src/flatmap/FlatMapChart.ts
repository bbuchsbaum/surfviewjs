import { checkBudget, checkIndex, GeometryError } from '../geometry/GeometryError';
import { SurfaceDomain, geometryDigest } from '../geometry/SurfaceDomain';
import { triangleLocation, type SurfaceLocation } from '../geometry/SurfaceLocation';

export interface FlatMapChartOptions {
  domain: SurfaceDomain;
  /** Interleaved x/y coordinates. A chart is distinct from anatomical millimetres. */
  coordinates: ArrayLike<number>;
  faces: ArrayLike<number>;
  anatomicalVertices: ArrayLike<number>;
  anatomicalFaces: ArrayLike<number>;
  units: 'mm' | 'arbitrary';
  /** Explicit display calibration; never used to change anatomical measurements. */
  mmPerUnit?: number;
  budgetBytes?: number;
}

interface ChartStorage {
  xy: Float64Array;
  faces: Uint32Array;
  vertices: Uint32Array;
  anatomicalFaces: Uint32Array;
  permutations: Uint8Array;
  inverseFaces: Int32Array;
  vertexOffsets: Uint32Array;
  vertexCopies: Uint32Array;
  offsets: Uint32Array;
  entries: Uint32Array;
  columns: number;
  rows: number;
  fingerprint?: Promise<string>;
}

export interface FlatMapHit {
  chartFace: number;
  weights: readonly [number, number, number];
  location: SurfaceLocation;
}

const storage = new WeakMap<FlatMapChart, ChartStorage>();
let serial = 0;
/** @internal Borrowed storage is read-only. */
export function chartStorage(chart: FlatMapChart): ChartStorage { return storage.get(chart)!; }

function cross(ax: number, ay: number, bx: number, by: number): number { return ax * by - ay * bx; }

/** Positive-area intersection using separating axes. Shared edges are not overlap. */
function overlaps(xy: Float64Array, faces: Uint32Array, a: number, b: number): boolean {
  for (const f of [a, b]) {
    for (let edge = 0; edge < 3; edge++) {
      const u = faces[f * 3 + edge]! * 2, v = faces[f * 3 + (edge + 1) % 3]! * 2;
      const dx = xy[v]! - xy[u]!, dy = xy[v + 1]! - xy[u + 1]!;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (let k = 0; k < 3; k++) {
        const ai = faces[a * 3 + k]! * 2, bi = faces[b * 3 + k]! * 2;
        const av = cross(dx, dy, xy[ai]! - xy[u]!, xy[ai + 1]! - xy[u + 1]!);
        const bv = cross(dx, dy, xy[bi]! - xy[u]!, xy[bi + 1]! - xy[u + 1]!);
        amin = Math.min(amin, av); amax = Math.max(amax, av);
        bmin = Math.min(bmin, bv); bmax = Math.max(bmax, bv);
      }
      const tolerance = 64 * Number.EPSILON * Math.max(Math.abs(amin), Math.abs(amax), Math.abs(bmin), Math.abs(bmax));
      if (Math.min(amax, bmax) - Math.max(amin, bmin) <= tolerance) return false;
    }
  }
  return true;
}

/** An owned, validated cut chart with explicit anatomical correspondence. */
export class FlatMapChart {
  readonly domain: SurfaceDomain;
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly units: 'mm' | 'arbitrary';
  readonly mmPerUnit: number | undefined;
  readonly bounds: readonly [number, number, number, number];
  readonly snapshotId = `flatmap-chart-${++serial}`;
  readonly byteLength: number;

  constructor(options: FlatMapChartOptions) {
    const { domain, coordinates, faces, anatomicalVertices, anatomicalFaces } = options;
    const n = coordinates.length / 2, count = faces.length / 3;
    if (!(domain instanceof SurfaceDomain) || !Number.isSafeInteger(n) || n < 3 ||
        !Number.isSafeInteger(count) || count < 1 || anatomicalVertices.length !== n || anatomicalFaces.length !== count) {
      throw new GeometryError('invalid-shape', 'Chart coordinates, triangles and correspondence have incompatible shapes');
    }
    if (options.units !== 'mm' && options.units !== 'arbitrary') throw new GeometryError('frame-mismatch', 'Chart units are required');
    if (options.mmPerUnit !== undefined && (!(options.mmPerUnit > 0) || !Number.isFinite(options.mmPerUnit))) {
      throw new GeometryError('frame-mismatch', 'Chart mmPerUnit must be positive and finite');
    }
    if (options.units === 'mm' && options.mmPerUnit !== undefined && options.mmPerUnit !== 1) {
      throw new GeometryError('frame-mismatch', 'Millimetre chart calibration must be one');
    }
    checkBudget(n * 28 + count * 43 + domain.faceCount * 4, options.budgetBytes);
    const xy = Float64Array.from(coordinates), f = Uint32Array.from(faces), vertices = Uint32Array.from(anatomicalVertices);
    const ids = Uint32Array.from(anatomicalFaces), permutation = new Uint8Array(count * 3);
    const inverseFaces = new Int32Array(domain.faceCount).fill(-1);
    if (xy.some(x => !Number.isFinite(x))) throw new GeometryError('invalid-shape', 'Chart coordinates must be finite');
    for (let i = 0; i < faces.length; i++) checkIndex(faces[i]!, n, 'chart vertex');
    for (let i = 0; i < n; i++) checkIndex(anatomicalVertices[i]!, domain.vertexCount, 'anatomical vertex');
    const parents = Uint32Array.from({ length: n }, (_, i) => i), signs = new Int8Array(n);
    const root = (v: number): number => { while (parents[v] !== v) { parents[v] = parents[parents[v]!]!; v = parents[v]!; } return v; };
    const faceSigns = new Int8Array(count), boxes = new Float64Array(count * 4);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let face = 0; face < count; face++) {
      checkIndex(anatomicalFaces[face]!, domain.faceCount, 'anatomical face');
      const original = domain.triangle(ids[face]!);
      if (inverseFaces[ids[face]!] !== -1) throw new GeometryError('invalid-domain', `Repeated anatomical face ${ids[face]}`);
      inverseFaces[ids[face]!] = face;
      const a = f[face * 3]!, b = f[face * 3 + 1]!, c = f[face * 3 + 2]!;
      if (a === b || b === c || a === c) throw new GeometryError('degenerate-geometry', `Repeated chart corner in face ${face}`);
      const used = new Set<number>();
      for (let k = 0; k < 3; k++) {
        const corner = original.indexOf(vertices[f[face * 3 + k]!]!);
        if (corner < 0 || used.has(corner)) throw new GeometryError('invalid-domain', `Chart face ${face} does not match its anatomical face`);
        permutation[face * 3 + k] = corner; used.add(corner);
      }
      parents[root(b)] = root(a); parents[root(c)] = root(a);
      const ux = xy[b * 2]! - xy[a * 2]!, uy = xy[b * 2 + 1]! - xy[a * 2 + 1]!;
      const vx = xy[c * 2]! - xy[a * 2]!, vy = xy[c * 2 + 1]! - xy[a * 2 + 1]!;
      const scale = Math.max(Math.abs(ux), Math.abs(uy), Math.abs(vx), Math.abs(vy));
      const area = cross(ux / scale, uy / scale, vx / scale, vy / scale);
      if (!Number.isFinite(area) || Math.abs(area) <= 64 * Number.EPSILON) throw new GeometryError('degenerate-geometry', `Degenerate chart face ${face}`);
      // Account for allowed corner permutation when checking orientation.
      const p = permutation.subarray(face * 3, face * 3 + 3);
      const parity = ((p[0]! > p[1]! ? 1 : 0) + (p[0]! > p[2]! ? 1 : 0) + (p[1]! > p[2]! ? 1 : 0)) % 2;
      faceSigns[face] = Math.sign(area) * (parity ? -1 : 1);
      const loX = Math.min(xy[a * 2]!, xy[b * 2]!, xy[c * 2]!);
      const loY = Math.min(xy[a * 2 + 1]!, xy[b * 2 + 1]!, xy[c * 2 + 1]!);
      const hiX = Math.max(xy[a * 2]!, xy[b * 2]!, xy[c * 2]!);
      const hiY = Math.max(xy[a * 2 + 1]!, xy[b * 2 + 1]!, xy[c * 2 + 1]!);
      boxes.set([loX, loY, hiX, hiY], face * 4);
      minX = Math.min(minX, loX); minY = Math.min(minY, loY); maxX = Math.max(maxX, hiX); maxY = Math.max(maxY, hiY);
    }
    for (let face = 0; face < count; face++) {
      const r = root(f[face * 3]!);
      if (signs[r] && signs[r] !== faceSigns[face]) throw new GeometryError('degenerate-geometry', `Folded chart at face ${face}`);
      signs[r] = faceSigns[face]!;
    }
    this.bounds = Object.freeze([minX, minY, maxX, maxY] as const);
    const side = Math.min(512, Math.max(1, Math.ceil(Math.sqrt(count / 8))));
    const columns = side, rows = side, offsets = new Uint32Array(side * side + 1);
    const cells = (face: number): [number, number, number, number] => [
      Math.max(0, Math.min(side - 1, Math.floor((boxes[face * 4]! - minX) / (maxX - minX) * side))),
      Math.max(0, Math.min(side - 1, Math.floor((boxes[face * 4 + 1]! - minY) / (maxY - minY) * side))),
      Math.max(0, Math.min(side - 1, Math.floor((boxes[face * 4 + 2]! - minX) / (maxX - minX) * side))),
      Math.max(0, Math.min(side - 1, Math.floor((boxes[face * 4 + 3]! - minY) / (maxY - minY) * side)))
    ];
    let entriesCount = 0;
    for (let face = 0; face < count; face++) {
      const [x0, y0, x1, y1] = cells(face);
      entriesCount += (x1 - x0 + 1) * (y1 - y0 + 1);
      checkBudget(n * 28 + count * 43 + domain.faceCount * 4 + offsets.byteLength * 2 + entriesCount * 4, options.budgetBytes);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) offsets[y * side + x + 1]!++;
    }
    for (let i = 1; i < offsets.length; i++) offsets[i]! += offsets[i - 1]!;
    const entries = new Uint32Array(entriesCount), cursors = offsets.slice();
    for (let face = 0; face < count; face++) {
      const [x0, y0, x1, y1] = cells(face);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cell = y * side + x, offset = cursors[cell]!;
        entries[offset] = face; cursors[cell] = offset + 1;
      }
    }
    // A pair is checked only in the first cell shared by its bounding boxes.
    for (let cell = 0; cell + 1 < offsets.length; cell++) {
      for (let i = offsets[cell]!; i < offsets[cell + 1]!; i++) for (let j = i + 1; j < offsets[cell + 1]!; j++) {
        const a = entries[i]!, b = entries[j]!;
        if (boxes[a * 4]! >= boxes[b * 4 + 2]! || boxes[b * 4]! >= boxes[a * 4 + 2]! ||
            boxes[a * 4 + 1]! >= boxes[b * 4 + 3]! || boxes[b * 4 + 1]! >= boxes[a * 4 + 3]!) continue;
        const ac = cells(a), bc = cells(b);
        if (cell !== Math.max(ac[1], bc[1]) * side + Math.max(ac[0], bc[0])) continue;
        if (overlaps(xy, f, a, b)) throw new GeometryError('degenerate-geometry', `Overlapping chart faces ${a} and ${b}`);
      }
    }
    this.domain = domain; this.vertexCount = n; this.faceCount = count;
    this.units = options.units; this.mmPerUnit = options.units === 'mm' ? 1 : options.mmPerUnit;
    const active = new Uint8Array(n); f.forEach(v => { active[v] = 1; });
    const vertexOffsets = new Uint32Array(domain.vertexCount + 1);
    for (let v = 0; v < n; v++) if (active[v]) vertexOffsets[vertices[v]! + 1]!++;
    for (let v = 1; v < vertexOffsets.length; v++) vertexOffsets[v]! += vertexOffsets[v - 1]!;
    const vertexCopies = new Uint32Array(vertexOffsets[domain.vertexCount]!), copyCursors = vertexOffsets.slice();
    for (let v = 0; v < n; v++) if (active[v]) {
      const id = vertices[v]!, offset = copyCursors[id]!;
      vertexCopies[offset] = v; copyCursors[id] = offset + 1;
    }
    this.byteLength = xy.byteLength + f.byteLength + vertices.byteLength + ids.byteLength + permutation.byteLength + inverseFaces.byteLength + offsets.byteLength + entries.byteLength + vertexOffsets.byteLength + vertexCopies.byteLength;
    checkBudget(this.byteLength + boxes.byteLength + parents.byteLength + copyCursors.byteLength + cursors.byteLength, options.budgetBytes);
    storage.set(this, { xy, faces: f, vertices, anatomicalFaces: ids, permutations: permutation, inverseFaces, vertexOffsets, vertexCopies, offsets, entries, columns, rows });
    Object.freeze(this);
  }

  copyCoordinates(): Float64Array { return storage.get(this)!.xy.slice(); }
  copyFaces(): Uint32Array { return storage.get(this)!.faces.slice(); }
  copyAnatomicalVertices(): Uint32Array { return storage.get(this)!.vertices.slice(); }
  copyAnatomicalFaces(): Uint32Array { return storage.get(this)!.anatomicalFaces.slice(); }

  location(face: number, weights: readonly [number, number, number]): SurfaceLocation {
    checkIndex(face, this.faceCount, 'chart face');
    const s = storage.get(this)!, original: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) original[s.permutations[face * 3 + k]!] = weights[k]!;
    return triangleLocation(this.domain, s.anatomicalFaces[face]!, original);
  }

  /** Bounded local lookup; boundary ties go to the lowest chart face ID. */
  locate(x: number, y: number): FlatMapHit | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new GeometryError('invalid-shape', 'Chart point must be finite');
    const [x0, y0, x1, y1] = this.bounds;
    if (x < x0 || x > x1 || y < y0 || y > y1) return null;
    const s = storage.get(this)!;
    const column = Math.min(s.columns - 1, Math.floor((x - x0) / (x1 - x0) * s.columns));
    const row = Math.min(s.rows - 1, Math.floor((y - y0) / (y1 - y0) * s.rows)), cell = row * s.columns + column;
    for (let i = s.offsets[cell]!; i < s.offsets[cell + 1]!; i++) {
      const face = s.entries[i]!, a = s.faces[face * 3]! * 2, b = s.faces[face * 3 + 1]! * 2, c = s.faces[face * 3 + 2]! * 2;
      const ux = s.xy[b]! - s.xy[a]!, uy = s.xy[b + 1]! - s.xy[a + 1]!;
      const vx = s.xy[c]! - s.xy[a]!, vy = s.xy[c + 1]! - s.xy[a + 1]!;
      const px = x - s.xy[a]!, py = y - s.xy[a + 1]!, det = cross(ux, uy, vx, vy);
      const wb = cross(px, py, vx, vy) / det, wc = cross(ux, uy, px, py) / det, wa = 1 - wb - wc;
      if (Math.min(wa, wb, wc) < -32 * Number.EPSILON) continue;
      const weights: [number, number, number] = [Math.max(0, wa), Math.max(0, wb), Math.max(0, wc)];
      const sum = weights[0] + weights[1] + weights[2];
      for (let k = 0; k < 3; k++) weights[k]! /= sum;
      return { chartFace: face, weights, location: this.location(face, weights) };
    }
    return null;
  }

  chartPoints(location: SurfaceLocation): Array<readonly [number, number]> {
    if (location.domain !== this.domain) throw new GeometryError('invalid-domain', 'Location belongs to another anatomical domain');
    const s = storage.get(this)!;
    if (location.kind === 'vertex') {
      const result: Array<readonly [number, number]> = [];
      for (let j = s.vertexOffsets[location.vertex]!; j < s.vertexOffsets[location.vertex + 1]!; j++) {
        const i = s.vertexCopies[j]!; result.push([s.xy[i * 2]!, s.xy[i * 2 + 1]!]);
      }
      return result;
    }
    const face = s.inverseFaces[location.face]!;
    if (face < 0) return [];
    let x = 0, y = 0;
    for (let k = 0; k < 3; k++) {
      const v = s.faces[face * 3 + k]!, w = location.weights[s.permutations[face * 3 + k]!]!;
      x += s.xy[v * 2]! * w; y += s.xy[v * 2 + 1]! * w;
    }
    return [[x, y]];
  }

  fingerprint(): Promise<string> {
    const s = storage.get(this)!;
    return s.fingerprint ??= this.domain.fingerprint().then(domain => geometryDigest(
      { method: 'flatmap-chart-v1', domain, units: this.units, mmPerUnit: this.mmPerUnit },
      [s.xy, s.faces, s.vertices, s.anatomicalFaces]));
  }
}
