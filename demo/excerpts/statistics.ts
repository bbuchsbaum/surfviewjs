import { MultiLayerNeuroSurface, NeuroSurfaceViewer, StatisticalMapLayer, SurfaceGeometry, SurfaceMetric, getDisplayGeometryBinding } from '@src/index.js';

export function statMap(viewer: NeuroSurfaceViewer, geometry: SurfaceGeometry, t: Float32Array, p: Float32Array) {
  viewer.addSurface(new MultiLayerNeuroSurface(geometry), 'lh');
  const stat = new StatisticalMapLayer('tmap', t, null, 'coolwarm', {
    range: [-7, 7], threshold: [-2, 2], pValues: p, statType: 'tstat', degreesOfFreedom: 28
  });
  stat.setMeshAdjacency(geometry); // needed for cluster extent
  viewer.addLayer('lh', stat);

  stat.applyFDR(0.05); // or applyBonferroni(0.05), clearCorrection()
  stat.applyClusterThreshold(3, { minClusterSize: 20 });
  const domain = getDisplayGeometryBinding(viewer.getSurface('lh')!.mesh!).domain;
  const metric = new SurfaceMetric(domain, { positions: geometry.vertices, frame: 'fsaverage5-RAS', units: 'mm' });
  stat.applyClusterAreaThreshold(3, { metric, minAreaMm2: 100, signMode: 'separate' });
  // This replaces the correction mask with a descriptive area filter, not a cluster p-value.
  stat.setDualThreshold({ positiveColorMap: 'hot', negativeColorMap: 'cool', positiveRange: [2, 7], negativeRange: [-7, -2] });
  viewer.on('vertex:hover', ({ vertexIndex }) => {
    const info = vertexIndex === null ? null : stat.getVertexStatInfo(vertexIndex);
    if (info) console.log(info.value, info.pValue, info.clusterIndex, info.clusterSize);
  });
}

export function effectByConfidence(surface: MultiLayerNeuroSurface, effect: Float32Array, confidence: Float32Array) {
  const layer = surface.addTwoDataLayer('bivariate', effect, confidence, 'confidence', {
    rangeX: [-1.2, 1.2], rangeY: [0, 1], thresholdY: [0, 0.9] // hide confidence ≤ 0.9
  });
  layer.setColorMap('diverging');
}
