import type { GeometryWorkerClient } from '../geometry/GeometryWorkerClient';
import type { GeometryJobOptions } from '../geometry/GeometryExecutor';
import { FlatMapChart, chartStorage } from '../flatmap/FlatMapChart';
import { checkBudget, checkFinite, GeometryError } from '../geometry/GeometryError';
import { SurfaceDomain, SurfaceMetric } from '../geometry/SurfaceDomain';
import { computeVertexAreas } from '../geometry/SurfaceArea';
import { smoothSurfaceValuesSteps } from '../geometry/SurfaceSmoothing';
import { runGeometrySync } from '../geometry/GeometryExecutor';

export interface SurfaceReliefOptions {
  /** Required for an arbitrary-unit chart without a built-in calibration. */
  mmPerUnit?: number;
  /** Gaussian FWHM on the cut chart in calibrated mm; zero disables smoothing. */
  regularizationFwhmMm?: number;
  /** Optional broad trend removal, retaining the area-weighted mean. */
  detrendFwhmMm?: number;
  budgetBytes?: number;
}
interface ReliefStorage { raw: Float64Array; height: Float64Array; valid: Uint8Array; packed: Float32Array }
const fields = new WeakMap<SurfaceRelief, ReliefStorage>();
export class SurfaceRelief {
  readonly method = 'log-gaussian-relief-v1' as const;
  readonly byteLength: number;
  /** @internal Build through buildSurfaceRelief. */
  constructor(readonly chart: FlatMapChart, readonly mmPerUnit: number,
    readonly regularizationFwhmMm: number, readonly detrendFwhmMm: number, data: ReliefStorage) {
    fields.set(this, data); this.byteLength = data.raw.byteLength + data.height.byteLength + data.valid.byteLength + data.packed.byteLength;
    Object.freeze(this);
  }
  copyRawHeightMm(): Float64Array { return fields.get(this)!.raw.slice(); }
  copyHeightMm(): Float64Array { return fields.get(this)!.height.slice(); }
  copyValidity(): Uint8Array { return fields.get(this)!.valid.slice(); }
  /** Per chart vertex: height in chart units, dh/dx, dh/dy. */
  copyDisplayAttributes(): Float32Array { return fields.get(this)!.packed.slice(); }
}

export function buildSurfaceRelief(chart: FlatMapChart, white: SurfaceMetric, pial: SurfaceMetric, options: SurfaceReliefOptions = {}): SurfaceRelief {
  return runGeometrySync(buildSurfaceReliefSteps(chart, white, pial, options));
}

export function* buildSurfaceReliefSteps(chart: FlatMapChart, white: SurfaceMetric, pial: SurfaceMetric,
  options: SurfaceReliefOptions = {}): Generator<void, SurfaceRelief, void> {
  if (white.domain !== chart.domain || pial.domain !== chart.domain || white.frame !== pial.frame) {
    throw new GeometryError('frame-mismatch', 'Relief requires matched white/pial anatomy in one frame');
  }
  const mmPerUnit = options.mmPerUnit ?? chart.mmPerUnit;
  if (mmPerUnit === undefined || !Number.isFinite(mmPerUnit) || mmPerUnit <= 0) throw new GeometryError('frame-mismatch', 'Relief requires an explicit positive chart calibration');
  if (chart.units === 'mm' && mmPerUnit !== 1) throw new GeometryError('frame-mismatch', 'Millimetre chart calibration must be one');
  const regularization = checkFinite(options.regularizationFwhmMm ?? 0, 'regularizationFwhmMm', 0);
  const detrend = checkFinite(options.detrendFwhmMm ?? 0, 'detrendFwhmMm', 0);
  const c = chartStorage(chart), n = chart.vertexCount;
  checkBudget(n * 100 + chart.domain.vertexCount * 64, options.budgetBytes);
  const aw = computeVertexAreas(white), ap = computeVertexAreas(pial), w = white.copyPositions(), p = pial.copyPositions();
  const raw = new Float64Array(n).fill(NaN), validity = new Uint8Array(n), active = new Uint8Array(n);
  c.faces.forEach(v => { active[v] = 1; });
  for (let v = 0; v < n; v++) {
    const original = c.vertices[v]!, i = original * 3;
    if (active[v] && aw[original]! > 0 && ap[original]! > 0) {
      const thickness = Math.hypot(p[i]! - w[i]!, p[i + 1]! - w[i + 1]!, p[i + 2]! - w[i + 2]!);
      const ratio = Math.sqrt(ap[original]! / aw[original]!);
      const height = thickness * (1 + ratio + ratio * ratio) / 3;
      if (height > 0 && Number.isFinite(height)) { raw[v] = height; validity[v] = 1; }
    }
    if (v % 1024 === 1023) yield;
  }
  let height = raw.slice();
  if (regularization || detrend) {
    const domain = new SurfaceDomain({ id: `${chart.snapshotId}-cut`, structure: chart.domain.structure, vertexCount: n,
      faces: c.faces, ...(options.budgetBytes === undefined ? {} : { budgetBytes: options.budgetBytes }) });
    const coordinates = new Float64Array(n * 3);
    for (let v = 0; v < n; v++) { coordinates[v * 3] = c.xy[v * 2]! * mmPerUnit; coordinates[v * 3 + 1] = c.xy[v * 2 + 1]! * mmPerUnit; }
    const metric = new SurfaceMetric(domain, { positions: coordinates, units: 'mm', frame: chart.snapshotId,
      ...(options.budgetBytes === undefined ? {} : { budgetBytes: options.budgetBytes }) });
    if (regularization) {
      const result = yield* smoothSurfaceValuesSteps(metric, Float64Array.from(raw, h => Math.log(h)),
        { fwhmMm: regularization, roi: validity, maskMode: 'barrier', ...(options.budgetBytes === undefined ? {} : { budgetBytes: options.budgetBytes }) },
        { validity, missing: 'renormalize', minCoverage: 0 });
      height = Float64Array.from(result.values, (h, v) => validity[v] && result.valid[v] ? Math.exp(h) : NaN);
    }
    if (detrend) {
      const result = yield* smoothSurfaceValuesSteps(metric, height,
        { fwhmMm: detrend, roi: validity, maskMode: 'barrier', ...(options.budgetBytes === undefined ? {} : { budgetBytes: options.budgetBytes }) },
        { validity, missing: 'renormalize', minCoverage: 0 });
      const area = computeVertexAreas(metric); let sum = 0, mass = 0;
      for (let v = 0; v < n; v++) if (validity[v] && result.valid[v]) { sum += area[v]! * result.values[v]!; mass += area[v]!; }
      const mean = sum / mass;
      for (let v = 0; v < n; v++) if (validity[v]) height[v]! -= result.values[v]! - mean;
    }
  }
  const sx = new Float64Array(n), sy = new Float64Array(n), mass = new Float64Array(n);
  for (let face = 0; face < chart.faceCount; face++) {
    const a = c.faces[face * 3]!, b = c.faces[face * 3 + 1]!, d = c.faces[face * 3 + 2]!;
    if (validity[a] && validity[b] && validity[d]) {
      const ux = c.xy[b * 2]! - c.xy[a * 2]!, uy = c.xy[b * 2 + 1]! - c.xy[a * 2 + 1]!;
      const vx = c.xy[d * 2]! - c.xy[a * 2]!, vy = c.xy[d * 2 + 1]! - c.xy[a * 2 + 1]!;
      const det = ux * vy - uy * vx, area = Math.abs(det) / 2;
      const dh1 = (height[b]! - height[a]!) / mmPerUnit, dh2 = (height[d]! - height[a]!) / mmPerUnit;
      const dx = (dh1 * vy - uy * dh2) / det, dy = (ux * dh2 - dh1 * vx) / det;
      for (const v of [a, b, d]) { sx[v]! += dx * area; sy[v]! += dy * area; mass[v]! += area; }
    }
    if (face % 1024 === 1023) yield;
  }
  const packed = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    if (validity[v] && mass[v]! > 0) {
      packed[v * 3] = height[v]! / mmPerUnit; packed[v * 3 + 1] = sx[v]! / mass[v]!; packed[v * 3 + 2] = sy[v]! / mass[v]!;
      if (![packed[v * 3], packed[v * 3 + 1], packed[v * 3 + 2]].every(Number.isFinite)) throw new GeometryError('degenerate-geometry', `Relief overflows float32 at vertex ${v}`);
    } else { validity[v] = 0; height[v] = NaN; }
  }
  return new SurfaceRelief(chart, mmPerUnit, regularization, detrend, { raw, height, valid: validity, packed });
}

/** The same relief builder through an explicitly owned or injected module worker. */
export async function buildSurfaceReliefInWorker(worker: GeometryWorkerClient, chart: FlatMapChart,
  white: SurfaceMetric, pial: SurfaceMetric, options: SurfaceReliefOptions = {}, job?: GeometryJobOptions): Promise<SurfaceRelief> {
  const result = await worker.computeSurfaceRelief(chart, white, pial, options, job);
  return new SurfaceRelief(chart, result.mmPerUnit, result.regularizationFwhmMm, result.detrendFwhmMm,
    { raw: result.rawHeightMm, height: result.heightMm, valid: result.valid, packed: result.attributes });
}
