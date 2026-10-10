import { ConnectivityLayer, NeuroSurfaceViewer, ParcelSurface, loadSurface } from '@src/index.js';
import type { ParcelData } from '@src/index.js';

export async function showConnectivity(container: HTMLElement, atlas: ParcelData & { vertexLabels: number[] }, matrix: Float32Array, anchors: number[]) {
  const viewer = new NeuroSurfaceViewer(container, container.clientWidth, container.clientHeight);
  const geometry = await loadSurface('fs_LR.32k.L.inflated.surf.gii', 'gifti', 'left');
  const surface = new ParcelSurface(geometry, { parcelData: atlas, vertexLabels: atlas.vertexLabels });
  viewer.addSurface(surface, 'lh');

  // Paint the surface by one row of the parcel x parcel matrix.
  const seedMap = surface.addParcelConnectivityLayer('seed-map', matrix, 'coolwarm', { range: [-1, 1], threshold: 0.18 });
  viewer.on('parcel:hover', ({ parcelId }) => seedMap.setSeedParcel(parcelId));
  viewer.on('parcel:click', ({ parcelId }) => viewer.setParcelSelection('lh', parcelId));

  // The same matrix as edges between parcel anchor vertices.
  const edges = ConnectivityLayer.fromMatrix('edges', matrix, {
    vertexIndices: anchors, threshold: 0.5, topN: 150, renderMode: 'tube', weightRange: [-1, 1], colorMap: 'coolwarm'
  });
  surface.addLayer(edges);
  viewer.setAnatomicalView('lateral', { layout: 'single', surfaceId: 'lh' });
  viewer.startRenderLoop();
  return viewer;
}
