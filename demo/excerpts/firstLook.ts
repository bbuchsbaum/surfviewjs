import { DataLayer, MultiLayerNeuroSurface, NeuroSurfaceViewer, loadSurface } from '@src/index.js';

export async function showMap(container: HTMLElement, values: { lh: Float32Array; rh: Float32Array }) {
  const viewer = new NeuroSurfaceViewer(container, container.clientWidth, container.clientHeight);
  for (const [id, hemisphere] of [['lh', 'left'], ['rh', 'right']] as const) {
    const geometry = await loadSurface(`fsaverage5-${id}-pial.gii`, 'gifti', hemisphere);
    const surface = new MultiLayerNeuroSurface(geometry);
    surface.hemisphere = hemisphere;
    viewer.addSurface(surface, id);
    viewer.addLayer(id, new DataLayer('map', values[id], null, 'coolwarm', {
      range: [-4, 4],
      threshold: [-2, 2] // values inside (−2, 2) are not drawn
    }));
  }
  viewer.registerBilateralSurfaceGroup({ id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' });
  viewer.setAnatomicalView('lateral', {
    layout: 'paired', groupId: 'cortex', fit: true,
    hemisphereGap: 6 // mm between the medial walls
  });
  viewer.startRenderLoop();
  return viewer;
}
