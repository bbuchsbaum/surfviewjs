import {
  SurfaceDomain, SurfaceMetric, GeodesicIndex, triangleLocation, computeVertexAreas,
  buildSurfaceBoundaryGraph, traceBoundaryCurves, buildSurfaceSmoothingPlan,
  SurfaceResamplingPlan, buildRibbonIntegrationPlan, GeometryWorkerClient, smoothSurfaceBatch, buildSurfaceResamplingPlan
} from '../../src';
import type { GeodesicNeighborhood, SurfaceComputationResult, SurfaceLocation, RibbonIntegrationResult, SurfaceProjectionProfile, SurfaceSmoothingBatchOptions } from '../../src';

const domain = new SurfaceDomain({ id: 'contract', structure: 'synthetic', vertexCount: 3, faces: [0, 1, 2] });
const metric = new SurfaceMetric(domain, { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], frame: 'RAS', units: 'mm' });
const location: SurfaceLocation = triangleLocation(domain, 0, [0.2, 0.3, 0.5]);
const neighborhood: GeodesicNeighborhood = new GeodesicIndex(metric).withinRadius([0], 5);
const curves = traceBoundaryCurves(buildSurfaceBoundaryGraph(domain, [1, 2, 2], { background: 0 }));
const area: Float64Array = computeVertexAreas(metric);
const smoothed: SurfaceComputationResult = buildSurfaceSmoothingPlan(metric, { fwhmMm: 3 }).apply([1, 2, 3]);
const mapping = new SurfaceResamplingPlan(domain, domain, { offsets: [0, 1, 2, 3], indices: [0, 1, 2], weights: [1, 1, 1] }, { method: 'provided', correspondence: 'identity' });
const labels: SurfaceComputationResult = mapping.applyLabels([1, 2, 3]);
declare const ribbon: ReturnType<typeof buildRibbonIntegrationPlan>;
const integrated: RibbonIntegrationResult = ribbon.apply(new Float64Array(8));
declare const worker: GeometryWorkerClient;
const query: Promise<GeodesicNeighborhood> = worker.withinRadius('index-handle', new Uint32Array([0]), 5);
const profile: SurfaceProjectionProfile = 'binary32-chart-fma-v1';
const batchOptions: SurfaceSmoothingBatchOptions = { frameValidity: [new Uint8Array(3)], missing: 'strict' };
const batch: SurfaceComputationResult[] = smoothSurfaceBatch(metric, [[1, 2, 3]], { fwhmMm: 4 }, batchOptions);
const streamed: Promise<SurfaceComputationResult[]> = worker.smoothBatch('metric-handle', [[1, 2, 3]], { fwhmMm: 4 }, batchOptions);
void [profile, batch, streamed, buildSurfaceResamplingPlan];
// @ts-expect-error the numeric projection profile is an explicit versioned choice
const invalidProfile: SurfaceProjectionProfile = 'workbench';
void invalidProfile;
// @ts-expect-error physical metrics require millimetres
new SurfaceMetric(domain, { positions: [], frame: 'RAS', units: 'voxels' });
// @ts-expect-error a display frame is not a physical metric
new GeodesicIndex({ domain, frame: 'display' });
// @ts-expect-error no exact continuous-distance claim
new GeodesicIndex(metric, { method: 'exact' });
// @ts-expect-error categorical maps do not use a floating-point interpolation selector
mapping.applyLabels([1, 2, 3], { interpolation: 'linear' });
void [location, neighborhood, curves, area, smoothed, labels, integrated, query];
