import { DataLayer, MultiLayerNeuroSurface, NeuroSurfaceViewer, RGBALayer, SurfaceGeometry } from '@src/index.js';

export function layerStack(
  viewer: NeuroSurfaceViewer, geometry: SurfaceGeometry,
  depth: Float32Array, // sulcal depth from the folded midthickness: the inflated mesh has no folds
  tint: Float32Array, activation: Float32Array, func: Float32Array,
  ramp: [number, number, number, number][] // RGBA stops; alpha rises from 0 so low values fade out
) {
  const surface = new MultiLayerNeuroSurface(geometry, {
    curvature: depth, curvatureOptions: { brightness: 0.6, contrast: 0.36, smoothness: 0.5 },
    shading: { thresholdEdges: true, thresholdOutline: 0, silhouetteDarkening: 0.25 }
  });
  viewer.addSurface(surface, 'lh');
  // Bottom to top: RGBA colours, an additive activation, a thresholded map.
  viewer.addLayer('lh', new RGBALayer('tint', tint, { opacity: 0.75 }));
  viewer.addLayer('lh', new DataLayer('activation', activation, null, 'hot', {
    range: [0, 3], threshold: [-0.6, 0.6], blendMode: 'additive', opacity: 0.55
  }));
  viewer.addLayer('lh', new DataLayer('func', func, null, ramp, { range: [0, 1], threshold: [-0.03, 0.03], opacity: 0.8 }));

  viewer.updateLayer('lh', 'func', { opacity: 0.8, threshold: [-0.2, 0.2] });
  surface.moveLayer('tint', surface.getOrderedLayers().length - 1); // raise to the top
  surface.getCurvatureLayer()?.setContrast(0.6);
  surface.setShading({ thresholdOutline: 3 }); // isoline outline band (CPU path)
  surface.setCompositingMode(true); // GPU compositing; stays CPU without WebGL2
  return surface;
}
