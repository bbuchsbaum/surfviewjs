import { invertVoxelToWorld } from '../volumeProjectionCore';
import { checkBudget, checkFinite, checkMask, DEFAULT_PLAN_BUDGET, GeometryError } from './GeometryError';
import { SurfaceDomain, SurfaceMetric, metricPositions } from './SurfaceDomain';
import { topologyData } from './SurfaceTopology';
import { SparsePlan, appendSparseRow, type ApplySurfaceOptions, type SparseWeights, type SurfaceComputationResult } from './SparsePlan';
import { runGeometrySync } from './GeometryExecutor';

type Point = [number, number, number];
type Tet = [Point, Point, Point, Point];
type Polyhedron = Point[][];
function determinant(a: Point, b: Point, c: Point, d: Point): number {
  const x = b.map((v, j) => v - a[j]!), y = c.map((v, j) => v - a[j]!), z = d.map((v, j) => v - a[j]!);
  return x[0]! * (y[1]! * z[2]! - y[2]! * z[1]!) - x[1]! * (y[0]! * z[2]! - y[2]! * z[0]!) + x[2]! * (y[0]! * z[1]! - y[1]! * z[0]!);
}
function tetraFaces(t: Tet): Polyhedron { return [[t[0], t[1], t[2]], [t[0], t[3], t[1]], [t[0], t[2], t[3]], [t[1], t[3], t[2]]]; }
function polyVolume(faces: Polyhedron): number {
  const center: Point = [0, 0, 0]; let count = 0;
  for (const face of faces) for (const p of face) { for (let j = 0; j < 3; j++) center[j]! += p[j]!; count++; }
  if (!count) return 0; for (let j = 0; j < 3; j++) center[j]! /= count;
  let volume = 0;
  for (const face of faces) for (let j = 1; j + 1 < face.length; j++) volume += Math.abs(determinant(center, face[0]!, face[j]!, face[j + 1]!)) / 6;
  return volume;
}
/** Clip a convex polyhedron against dot(normal,p) <= offset. */
function clip(faces: Polyhedron, normal: Point, offset: number): Polyhedron {
  const result: Polyhedron = [], cap: Point[] = [];
  const signed = (p: Point) => normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2] - offset;
  for (const face of faces) {
    const polygon: Point[] = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i]!, b = face[(i + 1) % face.length]!, da = signed(a), db = signed(b);
      if (da <= 0) polygon.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db), p = a.map((x, j) => x + t * (b[j]! - x)) as Point;
        polygon.push(p); cap.push(p);
      } else if (da === 0) cap.push(a);
    }
    if (polygon.length >= 3) result.push(polygon);
  }
  const unique: Point[] = [];
  for (const p of cap) if (!unique.some(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= 32 * Number.EPSILON * Math.max(1, ...p.map(Math.abs), ...q.map(Math.abs)))) unique.push(p);
  if (unique.length >= 3) {
    const center = [0, 1, 2].map(j => unique.reduce((s, p) => s + p[j]!, 0) / unique.length);
    const axis = Math.abs(normal[0]) > Math.abs(normal[1]) ? (Math.abs(normal[0]) > Math.abs(normal[2]) ? 0 : 2) : (Math.abs(normal[1]) > Math.abs(normal[2]) ? 1 : 2);
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    unique.sort((a, b) => Math.atan2(a[v]! - center[v]!, a[u]! - center[u]!) - Math.atan2(b[v]! - center[v]!, b[u]! - center[u]!));
    // A plane coincident with an existing face must not be appended twice.
    if (!result.some(face => face.every(p => signed(p) === 0))) result.push(unique);
  }
  return result;
}

/** Exact convex clipping for the piecewise-linear tetrahedral model, up to roundoff. */
export function tetrahedronVoxelIntersectionVolume(tetrahedron: readonly (readonly [number, number, number])[], voxel: readonly [number, number, number]): number {
  if (tetrahedron.length !== 4 || tetrahedron.some(p => p.length !== 3 || p.some(x => !Number.isFinite(x))) || voxel.some(x => !Number.isFinite(x))) throw new GeometryError('invalid-shape', 'Invalid tetrahedron or voxel');
  // Cell-local coordinates avoid cancellation at large voxel indices.
  let faces = tetraFaces(tetrahedron.map(p => p.map((x, j) => x - voxel[j]!)) as Tet);
  for (let axis = 0; axis < 3; axis++) {
    const plus: Point = [0, 0, 0], minus: Point = [0, 0, 0]; plus[axis] = 1; minus[axis] = -1;
    faces = clip(faces, plus, 0.5); if (!faces.length) return 0;
    faces = clip(faces, minus, 0.5); if (!faces.length) return 0;
  }
  return polyVolume(faces);
}
function overlapVolume(a: Tet, b: Tet): number {
  let faces = tetraFaces(a);
  for (let opposite = 0; opposite < 4; opposite++) {
    const ids = [0, 1, 2, 3].filter(i => i !== opposite), x = b[ids[0]!]!, y = b[ids[1]!]!, z = b[ids[2]!]!;
    const u = y.map((v, j) => v - x[j]!), v = z.map((w, j) => w - x[j]!);
    const normal: Point = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    let offset = normal.reduce((s, w, j) => s + w * x[j]!, 0);
    if (normal.reduce((s, w, j) => s + w * b[opposite]![j]!, 0) > offset) { for (let j = 0; j < 3; j++) normal[j]! *= -1; offset *= -1; }
    faces = clip(faces, normal, offset); if (!faces.length) return 0;
  }
  return polyVolume(faces);
}

export interface RibbonVolumeGrid {
  dims: readonly [number, number, number];
  /** Column-major, integer voxel centers; x fastest. */
  voxelToWorld: ArrayLike<number>;
  frame: string;
  units: 'mm';
}
export interface RibbonIntegrationInput { domain: SurfaceDomain; whiteMetric: SurfaceMetric; pialMetric: SurfaceMetric; volumeGrid: RibbonVolumeGrid }
export interface RibbonIntegrationOptions { budgetBytes?: number; maxCandidateCells?: number; maxCandidateCellsPerColumn?: number; /** Optional destination columns; unselected rows have no support. */ targets?: Uint8Array }
export interface RibbonIntegrationResult {
  values: Float64Array; valid: Uint8Array;
  totalVolumeMm3: Float64Array; inGridVolumeMm3: Float64Array; validVolumeMm3: Float64Array;
  geometricCoverage: Float64Array; validCoverage: Float64Array;
  status: Array<'valid' | 'insufficient-coverage' | 'no-support'>;
}
interface RibbonStorage { kernel: SparsePlan; total: Float64Array; inGrid: Float64Array }
const plans = new WeakMap<RibbonIntegrationPlan, RibbonStorage>();
export class RibbonIntegrationPlan {
  readonly method = 'tetrahedral-barycentric-columns' as const;
  readonly byteLength: number;
  readonly grid: Readonly<{ dims: readonly [number, number, number]; voxelToWorld: readonly number[]; frame: string; units: 'mm' }>;
  /** @internal Use buildRibbonIntegrationPlan. */
  constructor(readonly domain: SurfaceDomain, grid: RibbonVolumeGrid, kernel: SparsePlan, total: Float64Array, inGrid: Float64Array) {
    this.grid = Object.freeze({ dims: Object.freeze([...grid.dims]) as readonly [number, number, number], voxelToWorld: Object.freeze(Array.from(grid.voxelToWorld)), frame: grid.frame, units: 'mm' });
    plans.set(this, { kernel, total, inGrid }); this.byteLength = kernel.byteLength + total.byteLength + inGrid.byteLength; Object.freeze(this);
  }
  copyWeights(): Required<SparseWeights> { return plans.get(this)!.kernel.copyWeights(); }
  apply(values: ArrayLike<number>, options: Pick<ApplySurfaceOptions, 'validity' | 'minCoverage'> = {}): RibbonIntegrationResult {
    return this.describe(plans.get(this)!.kernel.apply(values, { ...options, missing: 'renormalize', minCoverage: options.minCoverage ?? 1 }));
  }
  applySteps(values: ArrayLike<number>, options: Pick<ApplySurfaceOptions, 'validity' | 'minCoverage'> = {}): Generator<void, RibbonIntegrationResult, void> {
    return this.finish(plans.get(this)!.kernel.applySteps(values, { ...options, missing: 'renormalize', minCoverage: options.minCoverage ?? 1 }));
  }
  private *finish(iterator: Generator<void, SurfaceComputationResult, void>): Generator<void, RibbonIntegrationResult, void> { return this.describe(yield* iterator); }
  private describe(result: SurfaceComputationResult): RibbonIntegrationResult {
    const { kernel, total, inGrid } = plans.get(this)!;
    return { values: result.values, valid: result.valid, totalVolumeMm3: total.slice(), inGridVolumeMm3: inGrid.slice(), validVolumeMm3: Float64Array.from(result.coverage, (c, i) => c * total[i]!), geometricCoverage: kernel.supportCoverage.slice(), validCoverage: result.coverage,
      status: Array.from(result.valid, (v, i) => v ? 'valid' : result.coverage[i]! > 0 ? 'insufficient-coverage' : 'no-support') };
  }
}

export function* buildRibbonIntegrationPlanSteps(input: RibbonIntegrationInput, options: RibbonIntegrationOptions = {}): Generator<void, RibbonIntegrationPlan, void> {
  const { domain, whiteMetric: white, pialMetric: pial, volumeGrid: grid } = input, budget = options.budgetBytes ?? DEFAULT_PLAN_BUDGET;
  if (white.domain !== domain || pial.domain !== domain || white.frame !== pial.frame || grid.frame !== white.frame || grid.units !== 'mm') throw new GeometryError('frame-mismatch', 'Ribbon surfaces and volume require matching domain and anatomical mm frame');
  domain.topology.requireManifold(true);
  if (grid.dims.length !== 3 || grid.dims.some(x => !Number.isSafeInteger(x) || x < 1) || !Number.isSafeInteger(grid.dims.reduce((a, b) => a * b, 1)) || grid.dims.reduce((a, b) => a * b, 1) > 0xffffffff) throw new GeometryError('invalid-shape', 'Invalid volume dimensions');
  const inverse = invertVoxelToWorld(grid.voxelToWorld), m = grid.voxelToWorld;
  const voxelVolume = Math.abs(m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) + m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!));
  if (!(voxelVolume > 0) || !Number.isFinite(voxelVolume)) throw new GeometryError('degenerate-geometry', 'Invalid voxel volume');
  const maxCells = checkFinite(options.maxCandidateCells ?? 20_000_000, 'maxCandidateCells', 1), maxColumn = checkFinite(options.maxCandidateCellsPerColumn ?? 100_000, 'maxCandidateCellsPerColumn', 1);
  const n = domain.vertexCount, topo = topologyData(domain.topology), edgeCount = domain.topology.edgeCount, pointCount = n + edgeCount + domain.faceCount;
  checkMask(options.targets, n); const targets = options.targets?.slice();
  checkBudget(pointCount * 48 + n * 128, budget);
  const points = [new Float64Array(pointCount * 3), new Float64Array(pointCount * 3)];
  for (let side = 0; side < 2; side++) {
    const p = points[side]!, source = metricPositions(side ? pial : white); p.set(source);
    for (let e = 0; e < edgeCount; e++) for (let j = 0; j < 3; j++) p[(n + e) * 3 + j] = (source[topo.edgeVertices[e * 2]! * 3 + j]! + source[topo.edgeVertices[e * 2 + 1]! * 3 + j]!) / 2;
    for (let f = 0; f < domain.faceCount; f++) { const ids = domain.triangle(f); for (let j = 0; j < 3; j++) p[(n + edgeCount + f) * 3 + j] = ids.reduce((s, v) => s + source[v * 3 + j]!, 0) / 3; }
  }
  const worldPoint = (side: number, id: number) => Array.from(points[side]!.subarray(id * 3, id * 3 + 3)) as Point;
  const voxelPoint = (p: Point): Point => [0, 1, 2].map(j => inverse[j]! * p[0] + inverse[j + 4]! * p[1] + inverse[j + 8]! * p[2] + inverse[j + 12]!) as Point;
  const rows = Array.from({ length: n }, () => new Map<number, number>()), total = new Float64Array(n), columnCandidates = new Float64Array(n);
  let candidates = 0, entries = 0;
  for (let face = 0; face < domain.faceCount; face++) {
    const vertices = domain.triangle(face), center = n + edgeCount + face, tets: Array<{ owner: number; tet: Tet; volume: number }> = [];
    if (targets && !vertices.some(v => targets[v])) continue;
    for (let corner = 0; corner < 3; corner++) {
      const owner = vertices[corner]!, next = n + topo.faceEdges[face * 3 + corner]!, previous = n + topo.faceEdges[face * 3 + (corner + 2) % 3]!;
      for (const ids of [[owner, next, center], [owner, center, previous]]) {
        const sorted = [...ids].sort((a, b) => a - b);
        const parity = ((ids[0]! > ids[1]! ? 1 : 0) + (ids[0]! > ids[2]! ? 1 : 0) + (ids[1]! > ids[2]! ? 1 : 0)) % 2 ? -1 : 1;
        const a = worldPoint(0, sorted[0]!), b = worldPoint(0, sorted[1]!), c = worldPoint(0, sorted[2]!);
        const A = worldPoint(1, sorted[0]!), B = worldPoint(1, sorted[1]!), C = worldPoint(1, sorted[2]!);
        const pieces: Tet[] = [[a, b, c, C], [a, b, B, C], [a, A, B, C]];
        pieces.forEach((tet, k) => {
          const signed = determinant(...tet) * parity * (k === 1 ? -1 : 1) / 6;
          const scale = Math.max(...tet.flatMap(p => p.map((x, j) => Math.abs(x - a[j]!))));
          if (!(signed > 64 * Number.EPSILON * scale ** 3)) throw new GeometryError('degenerate-geometry', `Collapsed or inverted ribbon tetrahedron at face ${face}, vertex ${owner}`);
          tets.push({ owner, tet, volume: signed });
        });
      }
    }
    // Detect overlapping pieces within each source face, beyond a relative roundoff allowance.
    for (let i = 0; i < tets.length; i++) for (let j = i + 1; j < tets.length; j++) {
      const a = tets[i]!, b = tets[j]!;
      if (overlapVolume(a.tet, b.tet) > Math.min(a.volume, b.volume) * 1e-9) throw new GeometryError('degenerate-geometry', `Locally overlapping ribbon at face ${face}`);
    }
    for (const { owner, tet: worldTet, volume } of tets) {
      if (targets && !targets[owner]) continue;
      total[owner]! += volume;
      const tet = worldTet.map(voxelPoint) as Tet;
      const low = [0, 1, 2].map(j => Math.max(0, Math.ceil(Math.min(...tet.map(p => p[j]!)) - 0.5)));
      const high = [0, 1, 2].map(j => Math.min(grid.dims[j]! - 1, Math.floor(Math.max(...tet.map(p => p[j]!)) + 0.5)));
      const count = [0, 1, 2].reduce((s, j) => s * Math.max(0, high[j]! - low[j]! + 1), 1);
      candidates += count; columnCandidates[owner]! += count;
      if (candidates > maxCells || columnCandidates[owner]! > maxColumn) throw new GeometryError('budget-exceeded', `Ribbon candidate-cell budget exceeded at vertex ${owner}`);
      for (let z = low[2]!; z <= high[2]!; z++) for (let y = low[1]!; y <= high[1]!; y++) for (let x = low[0]!; x <= high[0]!; x++) {
        const overlap = tetrahedronVoxelIntersectionVolume(tet, [x, y, z]) * voxelVolume;
        if (overlap > 0) {
          const index = x + grid.dims[0] * (y + grid.dims[1] * z), row = rows[owner]!;
          if (!row.has(index)) entries++;
          checkBudget(pointCount * 48 + n * 128 + entries * 80, budget);
          row.set(index, (row.get(index) ?? 0) + overlap);
        }
      }
      yield;
    }
  }
  const offsets = new Uint32Array(n + 1), indices: number[] = [], weights: number[] = [], coverage = new Float64Array(n), inGrid = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    for (const w of rows[v]!.values()) inGrid[v]! += w;
    if (inGrid[v]! > total[v]! * (1 + 1e-9)) throw new GeometryError('degenerate-geometry', `Overcounted ribbon volume at vertex ${v}`);
    coverage[v] = total[v] ? Math.min(1, inGrid[v]! / total[v]!) : 0;
    appendSparseRow(rows[v]!, indices, weights); offsets[v + 1] = indices.length;
    if (v % 128 === 127) yield;
  }
  return new RibbonIntegrationPlan(domain, grid, new SparsePlan(grid.dims.reduce((a, b) => a * b, 1), n, { offsets, indices, weights, supportCoverage: coverage }, budget), total, inGrid);
}
export function buildRibbonIntegrationPlan(input: RibbonIntegrationInput, options: RibbonIntegrationOptions = {}): RibbonIntegrationPlan { return runGeometrySync(buildRibbonIntegrationPlanSteps(input, options)); }
export function applyRibbonIntegration(plan: RibbonIntegrationPlan, values: ArrayLike<number>, options: Pick<ApplySurfaceOptions, 'validity' | 'minCoverage'> = {}): RibbonIntegrationResult { return plan.apply(values, options); }
