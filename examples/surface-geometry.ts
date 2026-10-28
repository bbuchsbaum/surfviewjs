import {
  SurfaceDomain, SurfaceMetric, buildSurfaceBoundaryGraph, traceBoundaryCurves,
  GeodesicIndex, triangleLocation, evaluateSurfaceLocation, computeVertexAreas,
  summarizeSurfaceRegion, buildSurfaceSmoothingPlan, SurfaceResamplingPlan,
  exportSurfaceResamplingPlan, importSurfaceResamplingPlan, buildRibbonIntegrationPlan
} from 'surfview';

const domain = new SurfaceDomain({
  id: 'example-triangle', structure: 'synthetic', vertexCount: 3, faces: [0, 1, 2]
});
const white = new SurfaceMetric(domain, {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], frame: 'example-RAS', units: 'mm'
});
const pial = new SurfaceMetric(domain, {
  positions: [0, 0, 1, 1, 0, 1, 0, 1, 1], frame: white.frame, units: 'mm'
});

const border = traceBoundaryCurves(buildSurfaceBoundaryGraph(domain, [1, 2, 2], { background: 0 }));
const distances = new GeodesicIndex(white).withinRadius([0], 1.1);
const attachment = triangleLocation(domain, 0, [0.2, 0.3, 0.5]);
const point = evaluateSurfaceLocation(attachment, pial); // [0.3, 0.5, 1]
const areas = computeVertexAreas(white); // each vertex owns 1/6 mm²
const summary = summarizeSurfaceRegion(white, [0, 1, 1], {
  mode: 'label-partition', labels: [1, 2, 2], selectedLabels: [1]
}); // area = 1/8 mm²; mean of the linear field x+y = 1/3
const smoothed = buildSurfaceSmoothingPlan(white, { fwhmMm: 2 }).apply([0, 2, 4]);

// An explicit identity mapping, not a registration algorithm.
const mapping = new SurfaceResamplingPlan(domain, domain, {
  offsets: [0, 1, 2, 3], indices: [0, 1, 2], weights: [1, 1, 1]
}, { method: 'provided', correspondence: 'explicit-identity' });
const artifact = await exportSurfaceResamplingPlan(mapping);
const restored = await importSurfaceResamplingPlan(artifact, domain, domain);
const mapped = restored.apply([0, 2, 4]);

const ribbon = buildRibbonIntegrationPlan({
  domain, whiteMetric: white, pialMetric: pial,
  volumeGrid: {
    dims: [2, 2, 2], frame: white.frame, units: 'mm',
    voxelToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }
});
const integrated = ribbon.apply([0, 0, 0, 0, 2, 2, 2, 2]); // means = 1, coverage = 1
if (Math.abs(summary.mean - 1 / 3) > 1e-12 || integrated.values.some(x => Math.abs(x - 1) > 1e-12)) {
  throw new Error('Surface geometry example failed its analytic checks');
}
void [border, distances, point, areas, smoothed, mapped];
