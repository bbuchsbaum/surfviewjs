import { PreparedSurfaceSmoothing } from './PreparedSmoothing';
import { checkBudget, checkFinite, checkFraction, checkMask, DEFAULT_PLAN_BUDGET, GeometryError } from './GeometryError';
import { GeodesicIndex, type GeodesicMethod } from './GeodesicIndex';
import { runGeometrySync } from './GeometryExecutor';
import { computeVertexAreas } from './SurfaceArea';
import { SurfaceMetric } from './SurfaceDomain';
import { ownSparsePlan, SparsePlan, type ApplySurfaceOptions, type SurfaceComputationResult, type SparseWeights } from './SparsePlan';

export interface SurfaceSmoothingOptions {
  fwhmMm: number;
  kernelCutoffSigma?: number;
  method?: GeodesicMethod;
  roi?: Uint8Array;
  maskMode?: 'support' | 'barrier';
  budgetBytes?: number;
}
const kernels = new WeakMap<SurfaceSmoothingPlan, SparsePlan>();
export class SurfaceSmoothingPlan {
  readonly byteLength: number;
  readonly method = 'area-gaussian' as const;
  /** @internal Use buildSurfaceSmoothingPlan. */
  constructor(readonly metric: SurfaceMetric, readonly fwhmMm: number, readonly cutoffSigma: number, readonly distanceMethod: GeodesicMethod, kernel: SparsePlan) {
    kernels.set(this, kernel); this.byteLength = kernel.byteLength; Object.freeze(this);
  }
  prepare(options: ApplySurfaceOptions = {}, budgetBytes = DEFAULT_PLAN_BUDGET): PreparedSurfaceSmoothing { return new PreparedSurfaceSmoothing(kernels.get(this)!, { missing: 'renormalize', ...options }, budgetBytes); }
  prepareSteps(options: ApplySurfaceOptions = {}, budgetBytes = DEFAULT_PLAN_BUDGET): Generator<void, PreparedSurfaceSmoothing, void> {
    return PreparedSurfaceSmoothing.createSteps(kernels.get(this)!, { missing: 'renormalize', ...options, ...(options.validity ? { validity: options.validity.slice() } : {}) }, budgetBytes);
  }
  copyWeights(): Required<SparseWeights> { return kernels.get(this)!.copyWeights(); }
  apply(values: ArrayLike<number>, options: ApplySurfaceOptions = {}, output?: SurfaceComputationResult): SurfaceComputationResult { return kernels.get(this)!.apply(values, { missing: 'renormalize', ...options }, false, output); }
  applySteps(values: ArrayLike<number>, options: ApplySurfaceOptions = {}): Generator<void, SurfaceComputationResult, void> { return kernels.get(this)!.applySteps(values, { missing: 'renormalize', ...options }); }
}

function smoothingContext(metric: SurfaceMetric, options: SurfaceSmoothingOptions) {
  const fwhm = checkFinite(options.fwhmMm, 'fwhmMm', 0), cutoff = checkFinite(options.kernelCutoffSigma ?? 4, 'kernelCutoffSigma', Number.EPSILON);
  const n = metric.domain.vertexCount, budget = options.budgetBytes ?? DEFAULT_PLAN_BUDGET;
  checkMask(options.roi, n);
  if (options.maskMode !== undefined && options.maskMode !== 'support' && options.maskMode !== 'barrier') throw new GeometryError('invalid-shape', 'Invalid smoothing mask mode');
  const method = options.method ?? 'triangle-pair';
  if (method !== 'edge' && method !== 'triangle-pair') throw new GeometryError('invalid-shape', 'Unknown geodesic method');
  const roi = options.roi?.slice(), sigma = fwhm / Math.sqrt(8 * Math.log(2)), areas = fwhm ? computeVertexAreas(metric) : new Float64Array();
  const index = fwhm ? new GeodesicIndex(metric, { method, barrier: options.maskMode === 'barrier' ? roi : undefined, budgetBytes: budget }) : undefined;
  return { fwhm, cutoff, n, budget, roi, sigma, areas, index, method };
}
function* smoothingRow(v: number, context: ReturnType<typeof smoothingContext>): Generator<void, Map<number, number>, void> {
  const { fwhm, cutoff, roi, sigma, areas, index } = context;
  const row = new Map<number, number>();
    if (!roi || roi[v]) {
      if (!fwhm) row.set(v, 1);
      else {
        const neighborhood = yield* index!.querySteps([v], cutoff * sigma);
        neighborhood.vertices.forEach((w, j) => { if ((!roi || roi[w]) && areas[w]! > 0) row.set(w, Math.exp(-0.5 * (neighborhood.distances[j]! / sigma) ** 2) * areas[w]!); });
      }
    }
  return row;
}
export function* buildSurfaceSmoothingPlanSteps(metric: SurfaceMetric, options: SurfaceSmoothingOptions): Generator<void, SurfaceSmoothingPlan, void> {
  const context = smoothingContext(metric, options), { n, budget, index, fwhm, cutoff } = context;
  const offsets = new Uint32Array(n + 1);
  const setupBytes = (index?.byteLength ?? 0) + context.areas.byteLength + (context.roi?.byteLength ?? 0);
  let entries = 0, largestRow = 0;
  // Count first so final buffers have exact sizes; no growing JS arrays or final CSR copy.
  for (let v = 0; v < n; v++) {
    const row = yield* smoothingRow(v, context);
    largestRow = Math.max(largestRow, row.size);
    for (const weight of row.values()) if (weight > 0) entries++;
    if (entries > 0xffffffff) throw new GeometryError('budget-exceeded', 'CSR entry count exceeds uint32 capacity');
    offsets[v + 1] = entries;
    checkBudget(setupBytes + offsets.byteLength + n * 8 + entries * 12 + largestRow * 128, budget);
    yield;
  }
  const indices = new Uint32Array(entries), weights = new Float64Array(entries);
  for (let v = 0; v < n; v++) {
    const row = yield* smoothingRow(v, context);
    let mass = 0; for (const weight of row.values()) mass += weight;
    let cursor = offsets[v]!;
    for (const vertex of [...row.keys()].sort((a, b) => a - b)) {
      const weight = row.get(vertex)!;
      if (weight > 0) { indices[cursor] = vertex; weights[cursor++] = weight / mass; }
    }
    if (cursor !== offsets[v + 1]) throw new GeometryError('invalid-weights', 'Smoothing support changed during construction');
    yield;
  }
  return new SurfaceSmoothingPlan(metric, fwhm, cutoff, context.method, ownSparsePlan(n, n, offsets, indices, weights, budget));
}
export function buildSurfaceSmoothingPlan(metric: SurfaceMetric, options: SurfaceSmoothingOptions): SurfaceSmoothingPlan { return runGeometrySync(buildSurfaceSmoothingPlanSteps(metric, options)); }
export function applySurfaceSmoothing(plan: SurfaceSmoothingPlan, values: ArrayLike<number>, options: ApplySurfaceOptions = {}, output?: SurfaceComputationResult): SurfaceComputationResult { return plan.apply(values, options, output); }

/** Bounded row-at-a-time alternative: retains no K-entry plan, but recomputes neighborhoods per call. */
export function smoothSurfaceValuesSteps(metric: SurfaceMetric, values: ArrayLike<number>, smoothing: SurfaceSmoothingOptions, options: ApplySurfaceOptions = {}): Generator<void, SurfaceComputationResult, void> {
  return streamSmoothing(metric, Float64Array.from(values), { ...smoothing, ...(smoothing.roi ? { roi: smoothing.roi.slice() } : {}) }, { ...options, ...(options.validity ? { validity: options.validity.slice() } : {}) });
}
function* streamSmoothing(metric: SurfaceMetric, values: ArrayLike<number>, smoothing: SurfaceSmoothingOptions, options: ApplySurfaceOptions): Generator<void, SurfaceComputationResult, void> {
  const context = smoothingContext(metric, smoothing), { n, index, budget } = context;
  if (values.length !== n) throw new GeometryError('invalid-shape', 'Values must match metric');
  checkMask(options.validity, n);
  if (options.missing !== undefined && options.missing !== 'strict' && options.missing !== 'renormalize') throw new GeometryError('invalid-shape', 'Invalid missing-data policy');
  const min = checkFraction(options.minCoverage ?? (options.missing === 'strict' ? 1 : 0), 'minCoverage');
  const result = { values: new Float64Array(n), coverage: new Float64Array(n), valid: new Uint8Array(n) }; result.values.fill(NaN);
  for (let v = 0; v < n; v++) {
    const row = yield* smoothingRow(v, context);
    checkBudget((index?.byteLength ?? 0) + n * 32 + row.size * 128, budget);
    let nominal = 0, mass = 0, sum = 0, complete = true;
    for (const w of row.values()) nominal += w;
    for (const vertex of [...row.keys()].sort((a, b) => a - b)) {
      const weight = row.get(vertex)! / nominal, value = values[vertex]!;
      if (!Number.isFinite(value) || (options.validity && !options.validity[vertex])) { complete = false; continue; }
      mass += weight; sum += weight * value;
    }
    result.coverage[v] = Math.min(1, mass);
    if (mass > 0 && mass + 1e-12 >= min && (options.missing !== 'strict' || complete)) { result.values[v] = sum / mass; result.valid[v] = 1; }
    yield;
  }
  return result;
}
export function smoothSurfaceValues(metric: SurfaceMetric, values: ArrayLike<number>, smoothing: SurfaceSmoothingOptions, options: ApplySurfaceOptions = {}): SurfaceComputationResult {
  return runGeometrySync(streamSmoothing(metric, values, smoothing, options));
}

export interface SurfaceSmoothingBatchOptions extends ApplySurfaceOptions {
  /** Additional per-frame validity; combined with the optional shared mask. */
  frameValidity?: readonly Uint8Array[];
}

/** Recompute each neighborhood once for a bounded batch, retaining no full kernel. */
export function smoothSurfaceBatchSteps(metric: SurfaceMetric, frames: readonly ArrayLike<number>[], smoothing: SurfaceSmoothingOptions, options: SurfaceSmoothingBatchOptions = {}): Generator<void, SurfaceComputationResult[], void> {
  const n = metric.domain.vertexCount, count = frames.length, budget = smoothing.budgetBytes ?? DEFAULT_PLAN_BUDGET;
  if (!count || count > 16 || frames.some(frame => frame.length !== n)) throw new GeometryError('invalid-shape', 'Supply 1 to 16 frames matching the metric');
  checkMask(options.validity, n);
  if (options.frameValidity && options.frameValidity.length !== count) throw new GeometryError('invalid-shape', 'Per-frame masks must match the batch');
  options.frameValidity?.forEach(mask => checkMask(mask, n));
  if (options.missing !== undefined && options.missing !== 'strict' && options.missing !== 'renormalize') throw new GeometryError('invalid-shape', 'Invalid missing-data policy');
  checkFraction(options.minCoverage ?? (options.missing === 'strict' ? 1 : 0), 'minCoverage');
  checkBudget(n * (count * 25 + (options.frameValidity ? count : 0) + (options.validity ? 1 : 0)), budget);
  return streamBatch(metric, frames.map(frame => Float64Array.from(frame)), { ...smoothing, ...(smoothing.roi ? { roi: smoothing.roi.slice() } : {}) }, {
    ...options, ...(options.validity ? { validity: options.validity.slice() } : {}), ...(options.frameValidity ? { frameValidity: options.frameValidity.map(mask => mask.slice()) } : {})
  });
}
function* streamBatch(metric: SurfaceMetric, frames: readonly Float64Array[], smoothing: SurfaceSmoothingOptions, options: SurfaceSmoothingBatchOptions): Generator<void, SurfaceComputationResult[], void> {
  const context = smoothingContext(metric, smoothing), { n, budget, index } = context;
  const ownedBytes = n * (frames.length * 25 + 8 + (context.roi ? 1 : 0) + (options.validity ? 1 : 0) + (options.frameValidity ? frames.length : 0)) + (index?.byteLength ?? 0);
  checkBudget(ownedBytes, budget);
  const min = options.minCoverage ?? (options.missing === 'strict' ? 1 : 0);
  const results = frames.map(() => ({ values: new Float64Array(n).fill(NaN), coverage: new Float64Array(n), valid: new Uint8Array(n) }));
  for (let row = 0; row < n; row++) {
    const weights = yield* smoothingRow(row, context);
    checkBudget(ownedBytes + weights.size * 144, budget);
    let nominal = 0; for (const w of weights.values()) nominal += w;
    const columns = [...weights.keys()].sort((a, b) => a - b);
    const normalized = Float64Array.from(columns, col => weights.get(col)! / nominal);
    for (let f = 0; f < frames.length; f++) {
      let mass = 0, sum = 0, complete = true;
      const frame = frames[f]!, mask = options.frameValidity?.[f], result = results[f]!;
      for (let j = 0; j < columns.length; j++) {
        const col = columns[j]!, value = frame[col]!;
        if (!Number.isFinite(value) || (options.validity && !options.validity[col]) || (mask && !mask[col])) { complete = false; continue; }
        const w = normalized[j]!; mass += w; sum += w * value;
      }
      result.coverage[row] = Math.min(1, mass);
      if (mass > 0 && mass + 1e-12 >= min && (options.missing !== 'strict' || complete)) { result.values[row] = sum / mass; result.valid[row] = 1; }
    }
    yield;
  }
  return results;
}
export function smoothSurfaceBatch(metric: SurfaceMetric, frames: readonly ArrayLike<number>[], smoothing: SurfaceSmoothingOptions, options: SurfaceSmoothingBatchOptions = {}): SurfaceComputationResult[] {
  return runGeometrySync(smoothSurfaceBatchSteps(metric, frames, smoothing, options));
}
