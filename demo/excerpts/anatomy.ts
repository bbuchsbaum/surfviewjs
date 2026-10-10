import { FlatMapView, LaplacianSmoothing, LinkedBrainWorkspace, MorphableSurface, SurfaceSet, VariantSurface, roiToSVG } from '@src/index.js';
import type { MultiLayerNeuroSurface, NeuroSurfaceViewer, SurfaceGeometry } from '@src/index.js';

export function anatomy(viewer: NeuroSurfaceViewer, lh: MultiLayerNeuroSurface, pial: SurfaceGeometry, flat: { vertices: Float32Array; faces: Uint32Array }, sheet: HTMLElement, onROI: (svg: string) => void) {
  viewer.registerBilateralSurfaceGroup({ id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' });
  viewer.separateHemispheres(24); // mm between the pair
  viewer.setAnatomicalView('medial', { layout: 'single', surfaceId: 'lh', fit: true });
  lh.setClipPlane('y', -20, true, false); // keep y ≥ −20 (coronal cut)

  const inflated = LaplacianSmoothing.smooth(pial.vertices.slice(), pial.faces, 25, 0.6);
  const morph = new MorphableSurface(pial, { morphTargets: [{ name: 'inflated', positions: inflated }] });
  morph.mesh!.geometry.morphTargetsRelative = true; // targets are stored as deltas (see report)
  void morph.morphTo('inflated', { duration: 900 }); // or morph.setMorphValue(0.5)

  const set = new SurfaceSet({ hemi: 'left', faces: pial.faces, defaultVariant: 'folded', variants: { folded: pial.vertices, inflated } });
  viewer.addSurface(new VariantSurface(set), 'lh-linked');
  const flatmap = new FlatMapView(sheet, { surfaceId: 'lh-linked', ...flat });
  const workspace = new LinkedBrainWorkspace({ viewer, flatmap }); // hover and selection follow across views
  flatmap.on('roi:created', ({ roi }) => onROI(roiToSVG(roi)));
  flatmap.startROIDrawing({ mode: 'lasso', name: 'ROI_1' });
  return () => { workspace.dispose(); flatmap.dispose(); morph.dispose(); };
}
