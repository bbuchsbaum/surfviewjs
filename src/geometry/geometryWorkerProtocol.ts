import type { SurfaceDomainOptions, SurfaceMetricOptions } from './SurfaceDomain';
import type { SurfaceSmoothingOptions, SurfaceSmoothingBatchOptions } from './SurfaceSmoothing';
import type { BuildResamplingOptions, RegisteredSpherePair } from './SurfaceResampling';
import type { RibbonIntegrationOptions, RibbonVolumeGrid } from './RibbonIntegration';
import type { ApplySurfaceOptions } from './SparsePlan';
import type { GeometryErrorCode } from './GeometryError';
import type { GeodesicOptions } from './GeodesicIndex';
import type { FlatMapChartOptions } from '../flatmap/FlatMapChart';
import type { FlatMapRasterGrid, FlatMapTile } from '../flatmap/FlatMapRasterPlan';
import type { FlatMapVolumeSource, FlatMapMissingPolicy, FlatMapSamples } from '../flatmap/FlatMapSamplingPlan';
import type { SurfaceReliefOptions } from '../relief/SurfaceRelief';

export interface GeometryWorkerDiagnostics { resources: number; retainedBytes: number; pendingJobs: number }
export type GeometryWorkerCommand =
  | { type: 'diagnostics' }
  | { type: 'flatmap-chart'; domain: string; options: Omit<FlatMapChartOptions, 'domain'> }
  | { type: 'flatmap-frame'; values: Float64Array; validity?: Uint8Array }
  | { type: 'flatmap-sampler'; domain: string; volume?: Omit<FlatMapVolumeSource, 'white' | 'pial'> & { white: string; pial: string } }
  | { type: 'flatmap-prepare'; chart: string; sampler: string; grid: FlatMapRasterGrid; tile: FlatMapTile }
  | { type: 'flatmap-apply'; plan: string; frame: string; options?: FlatMapMissingPolicy }
  | { type: 'flatmap-relief'; chart: string; white: string; pial: string; options?: SurfaceReliefOptions }
  | { type: 'configure'; budgetBytes: number; planBudgetBytes: number }
  | { type: 'domain'; options: SurfaceDomainOptions }
  | { type: 'metric'; domain: string; options: SurfaceMetricOptions }
  | { type: 'smoothing'; metric: string; options: SurfaceSmoothingOptions }
  | { type: 'smooth-batch-stream'; metric: string; frames: Float64Array[]; smoothing: SurfaceSmoothingOptions; options?: SurfaceSmoothingBatchOptions }
  | { type: 'smooth-stream'; metric: string; values: Float64Array; smoothing: SurfaceSmoothingOptions; options?: ApplySurfaceOptions }
  | { type: 'resampling'; source: string; target: string; registration: RegisteredSpherePair['registration']; options?: Omit<BuildResamplingOptions, 'sourceAreaMetric' | 'targetAreaMetric' | 'sourceIndex'>; sourceAreaMetric?: string; targetAreaMetric?: string }
  | { type: 'ribbon'; domain: string; white: string; pial: string; grid: RibbonVolumeGrid; options?: RibbonIntegrationOptions }
  | { type: 'prepare-smoothing'; plan: string; options?: ApplySurfaceOptions; budgetBytes?: number }
  | { type: 'apply-batch'; prepared: string; frames: Float64Array[] }
  | { type: 'apply'; plan: string; values: Float64Array; options?: ApplySurfaceOptions; labels?: boolean }
  | { type: 'geodesic'; metric: string; seeds: Uint32Array; radiusMm: number; method?: 'edge' | 'triangle-pair'; barrier?: Uint8Array }
  | { type: 'geodesic-index'; metric: string; options?: GeodesicOptions }
  | { type: 'geodesic-query'; index: string; seeds: Uint32Array; radiusMm: number }
  | { type: 'release'; handle: string };
/** Result types for the quantitative feature's protocol boundary. */
export interface FlatMapWorkerResults {
  'flatmap-chart': string;
  'flatmap-frame': string;
  'flatmap-sampler': string;
  'flatmap-prepare': string;
  'flatmap-apply': FlatMapSamples;
  'flatmap-relief': {
    rawHeightMm: Float64Array; heightMm: Float64Array; valid: Uint8Array; attributes: Float32Array;
    method: 'log-gaussian-relief-v1'; mmPerUnit: number; regularizationFwhmMm: number; detrendFwhmMm: number;
  };
}
export type FlatMapWorkerCommand = Extract<GeometryWorkerCommand, { type: keyof FlatMapWorkerResults }>;
/**
 * `clientId` scopes request ids for workers shared by independently-created
 * clients (including clients from separate copies of the package).
 */
export interface GeometryWorkerRequest { protocol: 1; clientId: string; id: number; command: GeometryWorkerCommand }
export interface GeometryWorkerCancellation { protocol: 1; clientId: string; cancel: number }
export type GeometryWorkerResponse = { protocol: 1; clientId: string; id: number; value: unknown } | { protocol: 1; clientId: string; id: number; error: { code: GeometryErrorCode; message: string } };
