import { checkBudget, checkFinite, checkMask, DEFAULT_PLAN_BUDGET, GeometryError } from './GeometryError';
import { SurfaceDomain, SurfaceMetric, geometryDigest, metricPositions } from './SurfaceDomain';
import { SparsePlan, appendSparseRow, type ApplySurfaceOptions, type SparseWeights, type SurfaceComputationResult } from './SparsePlan';
import { normalizeBinary32 } from './Binary32Chart';
import { SurfaceTriangleIndex, type SurfaceProjectionProfile } from './SurfaceTriangleIndex';
import { computeVertexAreas } from './SurfaceArea';
import { runGeometrySync } from './GeometryExecutor';

export type SurfaceResamplingMethod = 'provided' | 'barycentric-closest' | 'adaptive-barycentric-area';
export interface ResamplingProvenance {
  method: SurfaceResamplingMethod;
  correspondence: string;
  sourceSphere?: string;
  targetSphere?: string;
  sourceAreaMetric?: string;
  targetAreaMetric?: string;
  projectionProfile?: SurfaceProjectionProfile;
  sphereNormalization?: { policy: 'radius'; center: readonly [number, number, number]; radiusMm: number };
}
const storage = new WeakMap<SurfaceResamplingPlan, SparsePlan>();
const provenanceMetrics = new WeakMap<SurfaceResamplingPlan, { source: SurfaceMetric; target: SurfaceMetric; sourceArea?: SurfaceMetric; targetArea?: SurfaceMetric }>();
export class SurfaceResamplingPlan {
  readonly byteLength: number;
  readonly provenance: Readonly<ResamplingProvenance>;
  constructor(readonly source: SurfaceDomain, readonly target: SurfaceDomain, weights: SparseWeights, provenance: ResamplingProvenance, budgetBytes?: number) {
    if (!provenance.correspondence?.trim() || !['provided', 'barycentric-closest', 'adaptive-barycentric-area'].includes(provenance.method)) throw new GeometryError('invalid-domain', 'Named correspondence and method required');
    if (provenance.projectionProfile !== undefined && !['float64-closest', 'binary32-chart-fma-v1'].includes(provenance.projectionProfile)) throw new GeometryError('invalid-domain', 'Unknown projection profile');
    const normalization = provenance.sphereNormalization;
    if (normalization && (normalization.policy !== 'radius' || !Array.isArray(normalization.center) || normalization.center.length !== 3 || normalization.center.some(x => !Number.isFinite(x)) || !(normalization.radiusMm > 0) || !Number.isFinite(normalization.radiusMm))) throw new GeometryError('invalid-domain', 'Invalid sphere normalization provenance');
    // Coalesce duplicates deterministically, while retaining validation of original row sums.
    checkBudget((target.vertexCount + 1) * 32 + weights.indices.length * 80, budgetBytes ?? DEFAULT_PLAN_BUDGET);
    if (weights.offsets.length !== target.vertexCount + 1 || weights.offsets[0] !== 0 || weights.offsets[target.vertexCount] !== weights.indices.length || weights.indices.length !== weights.weights.length) throw new GeometryError('invalid-weights', 'Invalid CSR shape');
    const offsets = new Uint32Array(target.vertexCount + 1), indices: number[] = [], normalized: number[] = [];
    for (let row = 0; row < target.vertexCount; row++) {
      const start = weights.offsets[row]!, end = weights.offsets[row + 1]!;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > weights.indices.length) throw new GeometryError('invalid-weights', 'Invalid CSR offsets');
      let sum = 0; const entries = new Map<number, number>();
      for (let j = start; j < end; j++) {
        const col = weights.indices[j]!, w = weights.weights[j]!;
        if (!Number.isSafeInteger(col) || col < 0 || col >= source.vertexCount || !Number.isFinite(w) || w < 0) throw new GeometryError('invalid-weights', 'Invalid sparse contributor');
        sum += w; if (w) entries.set(col, (entries.get(col) ?? 0) + w);
      }
      if (end > start && Math.abs(sum - 1) > 1e-10) throw new GeometryError('invalid-weights', 'Rows must sum to one');
      appendSparseRow(entries, indices, normalized); offsets[row + 1] = indices.length;
    }
    const kernel = new SparsePlan(source.vertexCount, target.vertexCount, { offsets, indices, weights: normalized, ...(weights.supportCoverage ? { supportCoverage: weights.supportCoverage } : {}) }, budgetBytes);
    storage.set(this, kernel); this.byteLength = kernel.byteLength; this.provenance = Object.freeze({ ...provenance, ...(normalization ? { sphereNormalization: Object.freeze({ ...normalization, center: Object.freeze([...normalization.center]) as readonly [number, number, number] }) } : {}) }); Object.freeze(this);
  }
  copyWeights(): Required<SparseWeights> { return storage.get(this)!.copyWeights(); }
  apply(values: ArrayLike<number>, options: ApplySurfaceOptions = {}, output?: SurfaceComputationResult): SurfaceComputationResult { return storage.get(this)!.apply(values, options, false, output); }
  applyLabels(values: ArrayLike<number>, options: ApplySurfaceOptions = {}, output?: SurfaceComputationResult): SurfaceComputationResult { return storage.get(this)!.apply(values, options, true, output); }
  applySteps(values: ArrayLike<number>, options: ApplySurfaceOptions = {}, labels = false): Generator<void, SurfaceComputationResult, void> { return storage.get(this)!.applySteps(values, options, labels); }
}
export function applyScalarResampling(plan: SurfaceResamplingPlan, values: ArrayLike<number>, options: ApplySurfaceOptions = {}): SurfaceComputationResult { return plan.apply(values, options); }
export function applyLabelResampling(plan: SurfaceResamplingPlan, values: ArrayLike<number>, options: ApplySurfaceOptions = {}): SurfaceComputationResult { return plan.applyLabels(values, options); }

export interface RegisteredSpherePair {
  source: SurfaceMetric;
  target: SurfaceMetric;
  registration: { id: string; frame: string; center: readonly [number, number, number]; radiusMm: number; relativeTolerance?: number };
}
export interface BuildResamplingOptions {
  projectionProfile?: SurfaceProjectionProfile;
  /** Explicit radial preprocessing; default preserves supplied sphere coordinates. */
  sphereNormalization?: 'none' | 'radius';
  method?: Exclude<SurfaceResamplingMethod, 'provided'>;
  sourceAreaMetric?: SurfaceMetric;
  targetAreaMetric?: SurfaceMetric;
  sourceROI?: Uint8Array;
  sourceIndex?: SurfaceTriangleIndex;
  budgetBytes?: number;
}

function validateSpherePair(pair: RegisteredSpherePair): void {
  const { source, target, registration: r } = pair;
  if (!r.id?.trim() || source.frame !== r.frame || target.frame !== r.frame || source.domain.structure !== target.domain.structure) throw new GeometryError('frame-mismatch', 'Registered spheres require a common named registration frame and structure');
  checkFinite(r.radiusMm, 'sphere radius', Number.EPSILON);
  const tolerance = checkFinite(r.relativeTolerance ?? 1e-3, 'sphere tolerance', 0);
  if (r.center.length !== 3 || r.center.some(x => !Number.isFinite(x))) throw new GeometryError('invalid-shape', 'Invalid sphere center');
  for (const metric of [source, target]) {
    const p = metricPositions(metric);
    for (let i = 0; i < p.length; i += 3) if (Math.abs(Math.hypot(p[i]! - r.center[0], p[i + 1]! - r.center[1], p[i + 2]! - r.center[2]) - r.radiusMm) > tolerance * r.radiusMm) throw new GeometryError('invalid-domain', `Positions exceed declared sphere tolerance at vertex ${i / 3}`);
  }
}

/** Closest-triangle registration transfer. Adaptive mode is independent, not certified Workbench parity. */
export function* buildSurfaceResamplingPlanSteps(pair: RegisteredSpherePair, options: BuildResamplingOptions = {}): Generator<void, SurfaceResamplingPlan, void> {
  validateSpherePair(pair);
  const method = options.method ?? 'barycentric-closest', budget = options.budgetBytes ?? DEFAULT_PLAN_BUDGET;
  if (options.sphereNormalization !== undefined && options.sphereNormalization !== 'none' && options.sphereNormalization !== 'radius') throw new GeometryError('invalid-shape', 'Unknown sphere normalization policy');
  const profile = options.projectionProfile ?? 'float64-closest';
  if (!['float64-closest', 'binary32-chart-fma-v1'].includes(profile)) throw new GeometryError('invalid-shape', 'Unknown projection profile');
  const normalized = options.sphereNormalization === 'radius';
  if (normalized && options.sourceIndex) throw new GeometryError('invalid-domain', 'Radial normalization constructs its own index');
  const normalize = (metric: SurfaceMetric) => {
    const positions = metric.copyPositions(), { center, radiusMm } = pair.registration;
    for (let v = 0; v < metric.domain.vertexCount; v++) {
      if (profile === 'binary32-chart-fma-v1') { positions.set(normalizeBinary32(positions.subarray(v * 3, v * 3 + 3), center, radiusMm), v * 3); continue; }
      const x = positions[v * 3]! - center[0], y = positions[v * 3 + 1]! - center[1], z = positions[v * 3 + 2]! - center[2], scale = radiusMm / Math.hypot(x, y, z);
      positions[v * 3] = center[0] + x * scale; positions[v * 3 + 1] = center[1] + y * scale; positions[v * 3 + 2] = center[2] + z * scale;
    }
    return new SurfaceMetric(metric.domain, { positions, frame: metric.frame, units: metric.units, budgetBytes: budget });
  };
  if (normalized) checkBudget((pair.source.domain.vertexCount + pair.target.domain.vertexCount) * 48 + pair.target.domain.vertexCount * 256, budget);
  const source = normalized ? normalize(pair.source) : pair.source, target = normalized ? normalize(pair.target) : pair.target;
  if (method !== 'barycentric-closest' && method !== 'adaptive-barycentric-area') throw new GeometryError('invalid-shape', 'Unknown construction method');
  checkMask(options.sourceROI, source.domain.vertexCount);
  const roi = options.sourceROI?.slice(), n = target.domain.vertexCount;
  checkBudget(n * 256 + source.domain.vertexCount * 32, budget);
  const sourceIndex = options.sourceIndex ?? new SurfaceTriangleIndex(source, { budgetBytes: budget, projectionProfile: profile });
  if (sourceIndex.projectionProfile !== profile) throw new GeometryError('invalid-domain', 'Source index projection profile mismatch');
  if (sourceIndex.metric !== source) throw new GeometryError('invalid-domain', 'Source index belongs to another metric');
  const rows: Map<number, number>[] = [];
  for (let v = 0; v < n; v++) {
    const hit = sourceIndex.closest(target.position(v)), row = new Map<number, number>();
    if (hit.location.kind !== 'triangle') throw new GeometryError('invalid-domain', 'Expected triangle projection');
    source.domain.triangle(hit.face).forEach((w, j) => { if (hit.location.kind === 'triangle' && hit.location.weights[j]! > 0) row.set(w, hit.location.weights[j]!); }); rows.push(row);
    if (v % 64 === 63) yield;
  }
  if (method === 'adaptive-barycentric-area') {
    const sm = options.sourceAreaMetric, tm = options.targetAreaMetric;
    if (!sm || !tm || sm.domain !== source.domain || tm.domain !== target.domain || sm.frame !== tm.frame) throw new GeometryError('invalid-domain', 'Adaptive resampling requires anatomical area metrics bound to both domains and a common frame');
    const sa = computeVertexAreas(sm), ta = computeVertexAreas(tm);
    if (sa.some(x => !(x > 0)) || ta.some(x => !(x > 0))) throw new GeometryError('degenerate-geometry', 'Adaptive areas must be positive');
    const targetIndex = new SurfaceTriangleIndex(target, { budgetBytes: budget, projectionProfile: profile }), reverse = Array.from({ length: n }, () => new Map<number, number>());
    for (let v = 0; v < source.domain.vertexCount; v++) {
      const hit = targetIndex.closest(source.position(v));
      if (hit.location.kind === 'triangle') { const weights = hit.location.weights; target.domain.triangle(hit.face).forEach((w, j) => { if (weights[j]! > 0) reverse[w]!.set(v, weights[j]!); }); }
      if (v % 64 === 63) yield;
    }
    const scatter = new Float64Array(source.domain.vertexCount);
    for (let row = 0; row < n; row++) {
      if ([...reverse[row]!.keys()].some(v => !rows[row]!.has(v))) rows[row] = reverse[row]!;
      for (const [v, w] of rows[row]!) { const weighted = w * ta[row]!; rows[row]!.set(v, weighted); scatter[v]! += weighted; }
    }
    for (const row of rows) for (const [v, w] of row) row.set(v, w * sa[v]! / scatter[v]!);
  }
  const offsets = new Uint32Array(n + 1), indices: number[] = [], weights: number[] = [], supportCoverage = new Float64Array(n);
  for (let row = 0; row < n; row++) {
    let full = 0, kept = 0;
    for (const [v, w] of rows[row]!) { full += w; if (!roi || roi[v]) kept += w; else rows[row]!.delete(v); }
    supportCoverage[row] = full ? kept / full : 0;
    checkBudget((indices.length + rows[row]!.size) * 80 + n * 256, budget);
    appendSparseRow(rows[row]!, indices, weights); offsets[row + 1] = indices.length;
    if (row % 128 === 127) yield;
  }
  const plan = new SurfaceResamplingPlan(source.domain, target.domain, { offsets, indices, weights, supportCoverage }, {
    ...(options.projectionProfile ? { projectionProfile: profile } : {}),
    ...(normalized ? { sphereNormalization: { policy: 'radius' as const, center: pair.registration.center, radiusMm: pair.registration.radiusMm } } : {}),
    method, correspondence: pair.registration.id, sourceSphere: source.snapshotId, targetSphere: target.snapshotId,
    ...(options.sourceAreaMetric ? { sourceAreaMetric: options.sourceAreaMetric.snapshotId } : {}), ...(options.targetAreaMetric ? { targetAreaMetric: options.targetAreaMetric.snapshotId } : {})
  }, budget);
  provenanceMetrics.set(plan, { source, target, ...(options.sourceAreaMetric ? { sourceArea: options.sourceAreaMetric } : {}), ...(options.targetAreaMetric ? { targetArea: options.targetAreaMetric } : {}) });
  return plan;
}
export function buildSurfaceResamplingPlan(pair: RegisteredSpherePair, options: BuildResamplingOptions = {}): SurfaceResamplingPlan { return runGeometrySync(buildSurfaceResamplingPlanSteps(pair, options)); }

export interface SurfacePlanAsset { dtype: 'uint32-le' | 'float64-le'; length: number; base64: string }
export interface SurfaceResamplingArtifact {
  schema: 'surfview.resampling-plan.v1';
  source: string; target: string; provenance: ResamplingProvenance;
  assets: { offsets: SurfacePlanAsset; indices: SurfacePlanAsset; weights: SurfacePlanAsset; supportCoverage: SurfacePlanAsset };
  checksum: string;
}
function encode(array: Uint32Array | Float64Array): SurfacePlanAsset {
  const bytes = new Uint8Array(array.byteLength), view = new DataView(bytes.buffer), float = array instanceof Float64Array;
  for (let i = 0; i < array.length; i++) if (float) view.setFloat64(i * 8, array[i]!, true); else view.setUint32(i * 4, array[i]!, true);
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { dtype: float ? 'float64-le' : 'uint32-le', length: array.length, base64: btoa(binary) };
}
function decode(asset: SurfacePlanAsset, dtype: SurfacePlanAsset['dtype'], budget: number): Uint32Array | Float64Array {
  if (!asset || asset.dtype !== dtype || !Number.isSafeInteger(asset.length) || asset.length < 0 || typeof asset.base64 !== 'string') throw new GeometryError('invalid-shape', 'Invalid plan asset');
  const size = dtype === 'float64-le' ? 8 : 4; checkBudget(asset.length * size * 3, budget);
  if (asset.base64.length !== 4 * Math.ceil(asset.length * size / 3)) throw new GeometryError('invalid-shape', 'Asset byte length mismatch');
  let binary: string; try { binary = atob(asset.base64); } catch { throw new GeometryError('invalid-shape', 'Invalid base64'); }
  if (binary.length !== asset.length * size) throw new GeometryError('invalid-shape', 'Asset byte length mismatch');
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0)), view = new DataView(bytes.buffer), output = dtype === 'float64-le' ? new Float64Array(asset.length) : new Uint32Array(asset.length);
  for (let i = 0; i < output.length; i++) output[i] = dtype === 'float64-le' ? view.getFloat64(i * 8, true) : view.getUint32(i * 4, true);
  return output;
}
export async function exportSurfaceResamplingPlan(plan: SurfaceResamplingPlan): Promise<SurfaceResamplingArtifact> {
  const kernel = storage.get(plan)!, source = await plan.source.fingerprint(), target = await plan.target.fingerprint(), provenance = { ...plan.provenance };
  const metrics = provenanceMetrics.get(plan);
  if (metrics) {
    provenance.sourceSphere = await metrics.source.fingerprint(); provenance.targetSphere = await metrics.target.fingerprint();
    if (metrics.sourceArea) provenance.sourceAreaMetric = await metrics.sourceArea.fingerprint();
    if (metrics.targetArea) provenance.targetAreaMetric = await metrics.targetArea.fingerprint();
  }
  const descriptor = { schema: 'surfview.resampling-plan.v1' as const, source, target, provenance };
  const checksum = await geometryDigest(descriptor, [kernel.offsets, kernel.indices, kernel.weights, kernel.supportCoverage]);
  return { ...descriptor, assets: { offsets: encode(kernel.offsets), indices: encode(kernel.indices), weights: encode(kernel.weights), supportCoverage: encode(kernel.supportCoverage) }, checksum };
}
export async function importSurfaceResamplingPlan(artifact: SurfaceResamplingArtifact, source: SurfaceDomain, target: SurfaceDomain, budgetBytes = DEFAULT_PLAN_BUDGET): Promise<SurfaceResamplingPlan> {
  if (artifact?.schema !== 'surfview.resampling-plan.v1' || artifact.source !== await source.fingerprint() || artifact.target !== await target.fingerprint()) throw new GeometryError('invalid-domain', 'Plan domain identity mismatch');
  if (!artifact.assets) throw new GeometryError('invalid-shape', 'Missing assets');
  const { offsets: o, indices: i, weights: w, supportCoverage: c } = artifact.assets;
  if (!o || !i || !w || !c) throw new GeometryError('invalid-shape', 'Missing assets');
  checkBudget((o.length * 4 + i.length * 4 + w.length * 8 + c.length * 8) * 4, budgetBytes);
  const offsets = decode(o, 'uint32-le', budgetBytes) as Uint32Array, indices = decode(i, 'uint32-le', budgetBytes) as Uint32Array;
  const weights = decode(w, 'float64-le', budgetBytes) as Float64Array, supportCoverage = decode(c, 'float64-le', budgetBytes) as Float64Array;
  const descriptor = { schema: artifact.schema, source: artifact.source, target: artifact.target, provenance: artifact.provenance };
  if (await geometryDigest(descriptor, [offsets, indices, weights, supportCoverage]) !== artifact.checksum) throw new GeometryError('checksum-mismatch', 'Plan checksum mismatch');
  return new SurfaceResamplingPlan(source, target, { offsets, indices, weights, supportCoverage }, artifact.provenance, budgetBytes);
}
