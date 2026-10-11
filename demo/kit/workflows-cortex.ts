import { DataLayer, MultiLayerNeuroSurface } from '@src/index.js';
import type { AnatomicalView, NeuroSurfaceViewer, SurfaceGeometry } from '@src/index.js';
import { CURVATURE_UNDERLAY, FOCI, addFields, blobField, curvatureOf, loadBilateral, mirror, smoothNoise } from './data';

/**
 * Shared scene for the workflow chapters (Figures, Controls panel, Data in & out):
 * both fsaverage5 pial hemispheres with a curvature underlay and one synthetic contrast.
 */

export type Side = 'left' | 'right';
export type HemisphereId = 'lh' | 'rh';

export const SYNTHETIC_CONTRAST_NOTE =
  'The contrast is constructed (Gaussian effects at visual, motor, auditory, intraparietal and inferior frontal foci, plus smooth noise), not a result.';

/** A synthetic task contrast in z units, placed at anatomical foci. Deterministic. */
export function syntheticContrast(vertices: Float32Array, side: Side): Float32Array {
  const at = (point: readonly [number, number, number]) => (side === 'left' ? point : mirror(point));
  const signal = blobField(vertices, [
    { center: at(FOCI.primaryVisual), amplitude: 5.4, sigma: 13 },
    { center: at(FOCI.motorHand), amplitude: side === 'left' ? 4.8 : 2.2, sigma: 10 },
    { center: at(FOCI.auditory), amplitude: 3.2, sigma: 9 },
    { center: at(FOCI.intraparietal), amplitude: 3.6, sigma: 11 },
    { center: at(FOCI.inferiorFrontal), amplitude: -3.6, sigma: 11 },
    { center: at(FOCI.posteriorCingulate), amplitude: -3.1, sigma: 10 }
  ]);
  return addFields(signal, smoothNoise(vertices, side === 'left' ? 21 : 22, 0.8, 34));
}

export interface CortexHemisphere {
  id: HemisphereId;
  side: Side;
  geometry: SurfaceGeometry;
  surface: MultiLayerNeuroSurface;
  contrast: Float32Array;
}

export interface CortexScene {
  hemispheres: Record<HemisphereId, CortexHemisphere>;
  vertexCount: number;
}

export interface CortexOptions {
  /** Colour window of the contrast layer (±z). */
  window?: number;
  /** Values inside ±threshold are not drawn. */
  threshold?: number;
  colorMap?: string;
}

/** Load both hemispheres into `viewer` as `lh`/`rh` with a `contrast` layer and a `cortex` group. */
export async function addCortex(viewer: NeuroSurfaceViewer, options: CortexOptions = {}): Promise<CortexScene> {
  const { window = 5, threshold = 1.65, colorMap = 'coolwarm' } = options;
  const { left, right } = await loadBilateral();
  const hemispheres = {} as Record<HemisphereId, CortexHemisphere>;
  for (const [id, side, geometry, mesh] of [
    ['lh', 'left', left, 'fsaverage5Left'],
    ['rh', 'right', right, 'fsaverage5Right']
  ] as const) {
    const surface = new MultiLayerNeuroSurface(geometry, {
      curvature: curvatureOf(mesh, geometry),
      showCurvature: true,
      curvatureOptions: CURVATURE_UNDERLAY
    });
    surface.hemisphere = side;
    viewer.addSurface(surface, id);
    const contrast = syntheticContrast(geometry.vertices, side);
    viewer.addLayer(id, new DataLayer('contrast', contrast, null, colorMap, {
      range: [-window, window],
      threshold: [-threshold, threshold],
      presentation: { label: 'Synthetic contrast', units: 'z', description: 'Constructed task contrast' }
    }));
    hemispheres[id] = { id, side, geometry, surface, contrast };
  }
  viewer.registerBilateralSurfaceGroup({ id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' });
  return { hemispheres, vertexCount: (left.vertices.length + right.vertices.length) / 3 };
}

/**
 * Pose the `cortex` pair in an anatomical view framed as tightly as `fitToView` frames it.
 * fitToView clears the viewer's current anatomical view (and with it a controls panel's
 * checked view), so the view is posed again with `fit: false`, which keeps fitToView's
 * camera distance and restores the view state.
 */
export function showCortexView(viewer: NeuroSurfaceViewer, view: AnatomicalView, padding = 0.05): void {
  const pose = (fit: boolean) =>
    viewer.setAnatomicalView(view, { layout: 'paired', groupId: 'cortex', fit });
  pose(true);
  viewer.fitToView({ padding });
  pose(false);
}
