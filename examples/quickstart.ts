import {
  DataLayer,
  MultiLayerNeuroSurface,
  NeuroSurfaceViewer,
  SurfaceGeometry
} from 'surfview';

const container = document.querySelector<HTMLElement>('#viewer');
if (!container) throw new Error('Expected a #viewer element.');

const geometry = new SurfaceGeometry(
  new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
  new Uint32Array([0, 1, 2]),
  'left'
);
const surface = new MultiLayerNeuroSurface(geometry, { baseColor: 0xb8bec8 });
surface.addLayer(new DataLayer(
  'activation',
  new Float32Array([-2, 0, 2]),
  null,
  'coolwarm',
  { range: [-2, 2] }
));

const viewer = new NeuroSurfaceViewer(container, 800, 600, { preset: 'paper-light' });
viewer.addSurface(surface, 'left-cortex');

window.addEventListener('pagehide', () => viewer.dispose(), { once: true });
