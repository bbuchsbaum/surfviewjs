import type { ParcelPuzzleInput } from './buildParcelPuzzle';
import { buildParcelPatches } from './parcelPatches';
import { finiteNumber } from '../utils/validation';

export interface ParcelMapMesh {
  readonly positions: Float64Array;
  readonly faces: Uint32Array;
  /** Index into parcelIds for each triangle. */
  readonly faceParcels: Uint32Array;
  readonly parcelIds: readonly number[];
  readonly sourceAreas: Float64Array;
  /** Undirected source edges, followed by their one or two parcel indices. */
  readonly edges: readonly { a: number; b: number; left: number; right: number }[];
  readonly boundary: Uint32Array;
  readonly neighbors: readonly ReadonlyMap<number, number>[];
}

export interface ParcelMapParameters {
  /** Weight of conformal distortion relative to the supplied 3D surface. */
  angleWeight: number;
  areaWeight: number;
  compactnessWeight: number;
  /** 0 = source-area proportions; 1 = equal parcel display areas. */
  equalArea: number;
  /** Number of smooth deformation controls along each axis. */
  resolution: number;
}

export interface ParcelMapMetrics {
  angleDistortion: number;
  areaError: number;
  meanCompactness: number;
  minimumCompactness: number;
  minimumAreaRatio: number;
  flippedTriangles: number;
  objective: number;
  parcelAreas: Float64Array;
  parcelCompactness: Float64Array;
  targetAreas: Float64Array;
}

export interface ParcelMapStep {
  accepted: boolean;
  stepSize: number;
  metrics: ParcelMapMetrics;
}

const cross2 = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Build the same indicator-interpolated parcel partition as the 3D puzzle. */
export function buildParcelMapMesh(input: ParcelPuzzleInput): ParcelMapMesh {
  const patches = buildParcelPatches(input);
  const lookup = new Map<string, number>();
  const positions: number[] = [], faces: number[] = [], owners: number[] = [], parcelIds: number[] = [];
  for (const [id, patch] of patches) {
    if (!patch.indices.length) continue;
    const owner = parcelIds.length; parcelIds.push(id);
    const ids = patch.points.map(point => {
      let index = lookup.get(point.key);
      if (index === undefined) {
        index = lookup.size; lookup.set(point.key, index);
        positions.push(point.position.x, point.position.y, point.position.z);
      }
      return index;
    });
    for (let t = 0; t < patch.indices.length; t += 3) {
      faces.push(ids[patch.indices[t]!]!, ids[patch.indices[t + 1]!]!, ids[patch.indices[t + 2]!]!);
      owners.push(owner);
    }
  }
  const edgeMap = new Map<string, { a: number; b: number; left: number; right: number }>();
  const neighbors = Array.from({ length: lookup.size }, () => new Map<number, number>());
  const sourceAreas = new Float64Array(parcelIds.length);
  const length = (a: number, b: number): number => Math.hypot(positions[a * 3]! - positions[b * 3]!,
    positions[a * 3 + 1]! - positions[b * 3 + 1]!, positions[a * 3 + 2]! - positions[b * 3 + 2]!);
  for (let f = 0; f < faces.length; f += 3) {
    const ids = faces.slice(f, f + 3), owner = owners[f / 3]!;
    const lengths = ids.map((a, j) => length(a, ids[(j + 1) % 3]!));
    const a = ids[0]!, b = ids[1]!, c = ids[2]!;
    const ux = positions[b * 3]! - positions[a * 3]!, uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!, uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!, vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!, vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    const twiceArea = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (!(twiceArea > 0)) throw new RangeError('Degenerate source map triangle');
    sourceAreas[owner]! += twiceArea / 2;
    const halfTangents = ids.map((_, j) => {
      const u = lengths[j]!, v = lengths[(j + 2) % 3]!, opposite = lengths[(j + 1) % 3]!;
      return twiceArea / Math.max(u * v + (u * u + v * v - opposite * opposite) / 2, 1e-15);
    });
    for (let j = 0; j < 3; j++) {
      const a = ids[j]!, b = ids[(j + 1) % 3]!, key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const previous = edgeMap.get(key);
      if (previous) {
        if (previous.right !== -1 || previous.a !== b || previous.b !== a) throw new RangeError('Map must be consistently wound and manifold');
        previous.right = owner;
      } else edgeMap.set(key, { a, b, left: owner, right: -1 });
      // Symmetrized positive mean-value weights give a positive harmonic system.
      const weight = (halfTangents[j]! + halfTangents[(j + 1) % 3]!) / lengths[j]!;
      neighbors[a]!.set(b, (neighbors[a]!.get(b) ?? 0) + weight);
      neighbors[b]!.set(a, (neighbors[b]!.get(a) ?? 0) + weight);
    }
  }
  const edges = [...edgeMap.values()], boundaryEdges = edges.filter(edge => edge.right === -1);
  if (lookup.size - edges.length + owners.length !== 1 || !boundaryEdges.length) throw new RangeError('Planar experiment requires one connected disk; supply an explicit opening first');
  const next = new Map<number, number>(), incoming = new Set<number>();
  for (const edge of boundaryEdges) {
    if (next.has(edge.a) || incoming.has(edge.b)) throw new RangeError('Map boundary is not a simple loop');
    next.set(edge.a, edge.b); incoming.add(edge.b);
  }
  const boundary = [boundaryEdges[0]!.a];
  while (next.get(boundary[boundary.length - 1]!) !== boundary[0]) {
    const n = next.get(boundary[boundary.length - 1]!);
    if (n === undefined || boundary.includes(n)) throw new RangeError('Map boundary is not a simple loop');
    boundary.push(n);
  }
  if (boundary.length !== boundaryEdges.length) throw new RangeError('Map has more than one boundary loop');
  const seen = new Set<number>([0]), queue = [0];
  for (let k = 0; k < queue.length; k++) for (const n of neighbors[queue[k]!]!.keys()) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  if (seen.size !== lookup.size) throw new RangeError('Map is disconnected');
  return { positions: new Float64Array(positions), faces: new Uint32Array(faces), faceParcels: new Uint32Array(owners),
    parcelIds, sourceAreas, edges, boundary: new Uint32Array(boundary), neighbors };
}

export interface ParcelMapSolveOptions {
  signal?: AbortSignal;
  onProgress?: (iteration: number, relativeResidual: number) => void;
  /** Superellipse exponent: 2 = circle, 4 = rounded square. */
  boundaryShape?: number;
  aspectRatio?: number;
}

/** Positive harmonic disk map with a fixed convex boundary; fails rather than returning flipped faces. */
export async function flattenParcelMap(mesh: ParcelMapMesh, options: ParcelMapSolveOptions = {}): Promise<Float64Array> {
  const shape = finiteNumber(options.boundaryShape ?? 2, 'boundaryShape', { minimum: 2, maximum: 6 });
  const aspect = finiteNumber(options.aspectRatio ?? 1, 'aspectRatio', { minimum: 0.6, maximum: 1.8 });
  const n = mesh.positions.length / 3, uv = new Float64Array(n * 2), fixed = new Uint8Array(n);
  const boundaryLengths = Array.from(mesh.boundary, (a, i) => {
    const b = mesh.boundary[(i + 1) % mesh.boundary.length]!;
    return Math.hypot(...[0, 1, 2].map(k => mesh.positions[a * 3 + k]! - mesh.positions[b * 3 + k]!));
  });
  const perimeter = boundaryLengths.reduce((a, b) => a + b, 0);
  let length = 0;
  for (let j = 0; j < mesh.boundary.length; j++) {
    const i = mesh.boundary[j]!, theta = 2 * Math.PI * length / perimeter;
    const x = Math.cos(theta), y = Math.sin(theta);
    uv[2 * i] = Math.sign(x) * Math.abs(x) ** (2 / shape) * Math.sqrt(aspect);
    uv[2 * i + 1] = Math.sign(y) * Math.abs(y) ** (2 / shape) / Math.sqrt(aspect); fixed[i] = 1;
    length += boundaryLengths[j]!;
  }
  const offsets = new Uint32Array(n + 1), diagonal = new Float64Array(n);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i]! + mesh.neighbors[i]!.size;
  const indices = new Uint32Array(offsets[n]!), weights = new Float64Array(indices.length);
  for (let i = 0; i < n; i++) {
    let k = offsets[i]!;
    for (const [j, w] of mesh.neighbors[i]!) { indices[k] = j; weights[k++] = w; diagonal[i]! += w; }
  }
  for (const axis of [0, 1]) {
    const x = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), ap = new Float64Array(n);
    let b2 = 0, rz = 0;
    for (let i = 0; i < n; i++) if (!fixed[i]) {
      for (let k = offsets[i]!; k < offsets[i + 1]!; k++) if (fixed[indices[k]!]) r[i]! += weights[k]! * uv[indices[k]! * 2 + axis]!;
      z[i] = r[i]! / diagonal[i]!; p[i] = z[i]!; b2 += r[i]! * r[i]!; rz += r[i]! * z[i]!;
    }
    let residual = b2 === 0 ? 0 : 1, iteration = 0;
    for (; residual > 1e-10 && iteration < 3000; iteration++) {
      let pap = 0;
      for (let i = 0; i < n; i++) if (!fixed[i]) {
        let value = diagonal[i]! * p[i]!;
        for (let k = offsets[i]!; k < offsets[i + 1]!; k++) value -= weights[k]! * p[indices[k]!]!;
        ap[i] = value; pap += p[i]! * value;
      }
      if (!(pap > 0)) throw new Error('Harmonic map solver lost positive definiteness');
      const alpha = rz / pap;
      let nextRz = 0, r2 = 0;
      for (let i = 0; i < n; i++) if (!fixed[i]) {
        x[i]! += alpha * p[i]!; r[i]! -= alpha * ap[i]!;
        z[i] = r[i]! / diagonal[i]!; nextRz += r[i]! * z[i]!; r2 += r[i]! * r[i]!;
      }
      residual = Math.sqrt(r2 / b2);
      const beta = nextRz / rz; rz = nextRz;
      for (let i = 0; i < n; i++) if (!fixed[i]) p[i] = z[i]! + beta * p[i]!;
      if (iteration % 32 === 0) {
        options.signal?.throwIfAborted(); options.onProgress?.(axis * 3000 + iteration, residual);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    if (residual > 1e-10) throw new Error(`Harmonic map did not converge (relative residual ${residual})`);
    for (let i = 0; i < n; i++) if (!fixed[i]) uv[i * 2 + axis] = x[i]!;
  }
  options.signal?.throwIfAborted();
  for (let f = 0; f < mesh.faces.length; f += 3) {
    const a = mesh.faces[f]! * 2, b = mesh.faces[f + 1]! * 2, c = mesh.faces[f + 2]! * 2;
    if (!(cross2(uv[b]! - uv[a]!, uv[b + 1]! - uv[a + 1]!, uv[c]! - uv[a]!, uv[c + 1]! - uv[a + 1]!) > 0)) {
      throw new Error('Harmonic map contains a collapsed or flipped triangle');
    }
  }
  return uv;
}

export const DEFAULT_PARCEL_MAP_PARAMETERS: Readonly<ParcelMapParameters> = Object.freeze({
  angleWeight: 0.3, areaWeight: 2, compactnessWeight: 0.3, equalArea: 0.35, resolution: 14
});

function parameters(value: ParcelMapParameters): ParcelMapParameters {
  return {
    angleWeight: finiteNumber(value.angleWeight, 'angleWeight', { minimum: 0, maximum: 20 }),
    areaWeight: finiteNumber(value.areaWeight, 'areaWeight', { minimum: 0, maximum: 20 }),
    compactnessWeight: finiteNumber(value.compactnessWeight, 'compactnessWeight', { minimum: 0, maximum: 20 }),
    equalArea: finiteNumber(value.equalArea, 'equalArea', { minimum: 0, maximum: 1 }),
    resolution: finiteNumber(value.resolution, 'resolution', { minimum: 4, maximum: 32, integer: true })
  };
}

/** Experimental constrained descent. All accepted maps retain the same fixed convex outer boundary. */
export class ParcelMapOptimizer {
  readonly coordinates: Float64Array;
  readonly reference: Float64Array;
  private readonly fixed: Uint8Array;
  private readonly frames: Float64Array;
  private readonly referenceAreas: Float64Array;
  private readonly sourceTotal: number;
  private readonly mapArea: number;
  private readonly gradient: Float64Array;
  private readonly halfWidth: number;
  private readonly halfHeight: number;
  private settings: ParcelMapParameters;

  constructor(readonly mesh: ParcelMapMesh, coordinates: ArrayLike<number>, settings = DEFAULT_PARCEL_MAP_PARAMETERS) {
    if (coordinates.length !== mesh.positions.length / 3 * 2 || !Array.from(coordinates).every(Number.isFinite)) throw new RangeError('Map coordinates must be finite and match the mesh');
    this.settings = parameters(settings); this.coordinates = new Float64Array(coordinates); this.reference = new Float64Array(coordinates);
    this.fixed = new Uint8Array(coordinates.length / 2); mesh.boundary.forEach(i => { this.fixed[i] = 1; });
    this.frames = new Float64Array(mesh.faces.length); this.referenceAreas = new Float64Array(mesh.faces.length / 3);
    this.gradient = new Float64Array(coordinates.length);
    this.halfWidth = Math.max(...Array.from(mesh.boundary, i => Math.abs(coordinates[i * 2]!)));
    this.halfHeight = Math.max(...Array.from(mesh.boundary, i => Math.abs(coordinates[i * 2 + 1]!)));
    this.sourceTotal = mesh.sourceAreas.reduce((a, b) => a + b, 0);
    let mapArea = 0;
    for (let f = 0; f < mesh.faces.length; f += 3) {
      const a = mesh.faces[f]!, b = mesh.faces[f + 1]!, c = mesh.faces[f + 2]!;
      const u = [0, 1, 2].map(k => mesh.positions[b * 3 + k]! - mesh.positions[a * 3 + k]!);
      const v = [0, 1, 2].map(k => mesh.positions[c * 3 + k]! - mesh.positions[a * 3 + k]!);
      const l = Math.hypot(...u), p = u.reduce((sum, x, k) => sum + x * v[k]!, 0) / l;
      const h = Math.sqrt(Math.max(0, v.reduce((sum, x) => sum + x * x, 0) - p * p));
      this.frames.set([l, p, h], f);
      const area = cross2(coordinates[b * 2]! - coordinates[a * 2]!, coordinates[b * 2 + 1]! - coordinates[a * 2 + 1]!,
        coordinates[c * 2]! - coordinates[a * 2]!, coordinates[c * 2 + 1]! - coordinates[a * 2 + 1]!) / 2;
      if (!(area > 0) || !(h > 0)) throw new RangeError('Optimizer requires positive nondegenerate triangles');
      this.referenceAreas[f / 3] = area; mapArea += area;
    }
    // The fixed boundary must be convex, not merely a loop with positive local triangles.
    let convex = true, totalTurn = 0;
    for (let i = 0; i < mesh.boundary.length; i++) {
      const a = mesh.boundary[i]! * 2, b = mesh.boundary[(i + 1) % mesh.boundary.length]! * 2, c = mesh.boundary[(i + 2) % mesh.boundary.length]! * 2;
      const ux = coordinates[b]! - coordinates[a]!, uy = coordinates[b + 1]! - coordinates[a + 1]!;
      const vx = coordinates[c]! - coordinates[b]!, vy = coordinates[c + 1]! - coordinates[b + 1]!;
      const turn = cross2(ux, uy, vx, vy);
      if (turn < -1e-12 || Math.hypot(ux, uy) < 1e-14) convex = false;
      totalTurn += Math.atan2(turn, ux * vx + uy * vy);
    }
    if (!convex || Math.abs(totalTurn - 2 * Math.PI) > 1e-6) throw new RangeError('Optimizer requires a simple convex boundary traversed once');
    // Strictly positive triangles plus a simple convex boundary imply an injective disk map.
    // Check segment intersections too: consistent local turns alone can accept a star polygon.
    const turns = (a: number, b: number, c: number): number => cross2(coordinates[b * 2]! - coordinates[a * 2]!,
      coordinates[b * 2 + 1]! - coordinates[a * 2 + 1]!, coordinates[c * 2]! - coordinates[a * 2]!, coordinates[c * 2 + 1]! - coordinates[a * 2 + 1]!);
    for (let i = 0; i < mesh.boundary.length; i++) for (let j = i + 2; j < mesh.boundary.length; j++) {
      if (i === 0 && j === mesh.boundary.length - 1) continue;
      const a = mesh.boundary[i]!, b = mesh.boundary[(i + 1) % mesh.boundary.length]!, c = mesh.boundary[j]!, d = mesh.boundary[(j + 1) % mesh.boundary.length]!;
      if (turns(a, b, c) * turns(a, b, d) < 0 && turns(c, d, a) * turns(c, d, b) < 0) throw new RangeError('Map boundary intersects itself');
    }
    this.mapArea = mapArea;
  }

  setParameters(settings: ParcelMapParameters): void { this.settings = parameters(settings); }
  getParameters(): ParcelMapParameters { return { ...this.settings }; }
  reset(): void { this.coordinates.set(this.reference); }

  /** Recheck restored coordinates against the original boundary and triangle orientation. */
  restore(coordinates: ArrayLike<number>): void {
    if (coordinates.length !== this.coordinates.length || !Array.from(coordinates).every(Number.isFinite)) throw new RangeError('Invalid saved map coordinates');
    for (const i of this.mesh.boundary) if (coordinates[i * 2] !== this.reference[i * 2] || coordinates[i * 2 + 1] !== this.reference[i * 2 + 1]) throw new RangeError('Saved map changed the fixed boundary');
    const copy = new Float64Array(coordinates), metrics = this.evaluate(copy);
    if (metrics.flippedTriangles || metrics.minimumAreaRatio < 1e-4) throw new RangeError('Saved map contains collapsed or flipped triangles');
    this.coordinates.set(copy);
  }

  measure(): ParcelMapMetrics { return this.evaluate(this.coordinates); }

  /** Analytic objective gradient; exposed to support independent numerical verification. */
  objectiveGradient(): Float64Array { this.evaluate(this.coordinates, this.gradient); return this.gradient.slice(); }

  step(): ParcelMapStep {
    const before = this.evaluate(this.coordinates, this.gradient);
    const size = this.settings.resolution, controls = new Float64Array(size * size * 2), mass = new Float64Array(size * size);
    const ids = new Uint32Array(this.fixed.length * 4), basis = new Float64Array(ids.length);
    for (let i = 0; i < this.fixed.length; i++) if (!this.fixed[i]) {
      const x = this.coordinates[2 * i]!, y = this.coordinates[2 * i + 1]!;
      const nx = x / this.halfWidth, ny = y / this.halfHeight;
      const gx = Math.max(0, Math.min(size - 1.000001, (nx + 1) / 2 * (size - 1)));
      const gy = Math.max(0, Math.min(size - 1.000001, (ny + 1) / 2 * (size - 1)));
      const ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy;
      const taper = Math.max(0, (1 - nx * nx) * (1 - ny * ny));
      const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      const nodes = [iy * size + ix, iy * size + ix + 1, (iy + 1) * size + ix, (iy + 1) * size + ix + 1];
      for (let k = 0; k < 4; k++) {
        const node = nodes[k]!, w = weights[k]! * taper;
        ids[i * 4 + k] = node; basis[i * 4 + k] = w;
        controls[node * 2]! += w * this.gradient[i * 2]!; controls[node * 2 + 1]! += w * this.gradient[i * 2 + 1]!;
        mass[node]! += w * w;
      }
    }
    for (let i = 0; i < mass.length; i++) if (mass[i]! > 1e-12) { controls[i * 2]! /= mass[i]!; controls[i * 2 + 1]! /= mass[i]!; }
    const direction = new Float64Array(this.coordinates.length);
    let maximum = 0, derivative = 0;
    for (let i = 0; i < this.fixed.length; i++) if (!this.fixed[i]) {
      for (let k = 0; k < 4; k++) {
        const node = ids[i * 4 + k]!, w = basis[i * 4 + k]!;
        direction[i * 2]! -= w * controls[node * 2]!; direction[i * 2 + 1]! -= w * controls[node * 2 + 1]!;
      }
      maximum = Math.max(maximum, Math.hypot(direction[i * 2]!, direction[i * 2 + 1]!));
      derivative += direction[i * 2]! * this.gradient[i * 2]! + direction[i * 2 + 1]! * this.gradient[i * 2 + 1]!;
    }
    if (!(maximum > 1e-12) || !(derivative < 0)) return { accepted: false, stepSize: 0, metrics: before };
    const candidate = new Float64Array(this.coordinates.length);
    let step = 0.06 / maximum;
    for (let attempt = 0; attempt < 25; attempt++, step *= 0.5) {
      for (let i = 0; i < candidate.length; i++) candidate[i] = this.coordinates[i]! + step * direction[i]!;
      const after = this.evaluate(candidate);
      if (!after.flippedTriangles && after.minimumAreaRatio >= 1e-4 &&
          after.objective <= before.objective + 1e-4 * step * derivative) {
        this.coordinates.set(candidate);
        return { accepted: true, stepSize: step * maximum, metrics: after };
      }
    }
    return { accepted: false, stepSize: 0, metrics: before };
  }

  private evaluate(uv: Float64Array, gradient?: Float64Array): ParcelMapMetrics {
    gradient?.fill(0);
    const n = this.mesh.parcelIds.length, areas = new Float64Array(n), perimeters = new Float64Array(n), targets = new Float64Array(n);
    const { angleWeight, areaWeight, compactnessWeight, equalArea } = this.settings;
    let angleDistortion = 0, minimumAreaRatio = Infinity, flippedTriangles = 0;
    for (let f = 0; f < this.mesh.faces.length; f += 3) {
      const a = this.mesh.faces[f]! * 2, b = this.mesh.faces[f + 1]! * 2, c = this.mesh.faces[f + 2]! * 2;
      const ux = uv[b]! - uv[a]!, uy = uv[b + 1]! - uv[a + 1]!, vx = uv[c]! - uv[a]!, vy = uv[c + 1]! - uv[a + 1]!;
      const area = cross2(ux, uy, vx, vy) / 2;
      areas[this.mesh.faceParcels[f / 3]!]! += area;
      minimumAreaRatio = Math.min(minimumAreaRatio, area / this.referenceAreas[f / 3]!);
      if (!(area > 0)) { flippedTriangles++; continue; }
      const l = this.frames[f]!, p = this.frames[f + 1]!, h = this.frames[f + 2]!;
      const j00 = ux / l, j10 = uy / l, j01 = (vx - p * j00) / h, j11 = (vy - p * j10) / h;
      const det = j00 * j11 - j01 * j10, norm = j00 * j00 + j10 * j10 + j01 * j01 + j11 * j11;
      const weight = l * h / 2 / this.sourceTotal;
      angleDistortion += weight * (norm / (2 * det) - 1);
      if (gradient && angleWeight) {
        const k = norm / (2 * det * det), w = weight * angleWeight;
        const g00 = (j00 / det - k * j11) * w, g10 = (j10 / det + k * j01) * w;
        const g01 = (j01 / det + k * j10) * w, g11 = (j11 / det - k * j00) * w;
        const bx = g00 / l - g01 * p / (h * l), by = g10 / l - g11 * p / (h * l), cx = g01 / h, cy = g11 / h;
        gradient[b]! += bx; gradient[b + 1]! += by; gradient[c]! += cx; gradient[c + 1]! += cy;
        gradient[a]! -= bx + cx; gradient[a + 1]! -= by + cy;
      }
    }
    for (const edge of this.mesh.edges) if (edge.left !== edge.right) {
      const length = Math.hypot(uv[edge.a * 2]! - uv[edge.b * 2]!, uv[edge.a * 2 + 1]! - uv[edge.b * 2 + 1]!);
      perimeters[edge.left]! += length; if (edge.right !== -1) perimeters[edge.right]! += length;
    }
    const areaDerivatives = new Float64Array(n), perimeterDerivatives = new Float64Array(n), compactness = new Float64Array(n);
    let areaError = 0, compactnessCost = 0, meanCompactness = 0, minimumCompactness = Infinity;
    for (let i = 0; i < n; i++) {
      targets[i] = this.mapArea * ((1 - equalArea) * this.mesh.sourceAreas[i]! / this.sourceTotal + equalArea / n);
      const a = areas[i]!, p = perimeters[i]!, t = targets[i]!;
      if (!(a > 0)) { compactness[i] = 0; continue; }
      const c = 4 * Math.PI * a / (p * p);
      compactness[i] = c; meanCompactness += c / n; minimumCompactness = Math.min(minimumCompactness, c);
      compactnessCost += (1 / c - 1) / n; areaError += (a - t) ** 2 / t / this.mapArea;
      areaDerivatives[i] = areaWeight * 2 * (a - t) / t / this.mapArea - compactnessWeight * p * p / (4 * Math.PI * a * a * n);
      perimeterDerivatives[i] = compactnessWeight * p / (2 * Math.PI * a * n);
    }
    if (gradient) {
      for (let f = 0; f < this.mesh.faces.length; f += 3) {
        const a = this.mesh.faces[f]! * 2, b = this.mesh.faces[f + 1]! * 2, c = this.mesh.faces[f + 2]! * 2;
        const w = areaDerivatives[this.mesh.faceParcels[f / 3]!]! / 2;
        gradient[a]! += w * (uv[b + 1]! - uv[c + 1]!); gradient[a + 1]! += w * (uv[c]! - uv[b]!);
        gradient[b]! += w * (uv[c + 1]! - uv[a + 1]!); gradient[b + 1]! += w * (uv[a]! - uv[c]!);
        gradient[c]! += w * (uv[a + 1]! - uv[b + 1]!); gradient[c + 1]! += w * (uv[b]! - uv[a]!);
      }
      for (const edge of this.mesh.edges) if (edge.left !== edge.right) {
        const a = edge.a * 2, b = edge.b * 2, dx = uv[a]! - uv[b]!, dy = uv[a + 1]! - uv[b + 1]!, length = Math.hypot(dx, dy);
        if (!length) continue;
        const w = (perimeterDerivatives[edge.left]! + (edge.right === -1 ? 0 : perimeterDerivatives[edge.right]!)) / length;
        gradient[a]! += w * dx; gradient[a + 1]! += w * dy; gradient[b]! -= w * dx; gradient[b + 1]! -= w * dy;
      }
    }
    return { angleDistortion, areaError, meanCompactness, minimumCompactness, minimumAreaRatio, flippedTriangles,
      objective: flippedTriangles ? Infinity : angleWeight * angleDistortion + areaWeight * areaError + compactnessWeight * compactnessCost,
      parcelAreas: areas, parcelCompactness: compactness, targetAreas: targets };
  }
}
