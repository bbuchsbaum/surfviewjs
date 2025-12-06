import { ColorMappedNeuroSurface, SurfaceGeometry, THREE } from '../dist/neurosurface.es.js';

// Build a tiny non-indexed triangle geometry (positions only)
const positions = new Float32Array([
  0, 0, 0,
  1, 0, 0,
  0, 1, 0
]);

// Faces intentionally empty to simulate non-indexed input
const faces = new Uint32Array(0);
const data = new Float32Array(positions.length / 3).fill(1);

const geom = new SurfaceGeometry(positions, faces, 'test');
const surface = new ColorMappedNeuroSurface(geom, null, data, 'jet');

if (!surface.mesh) {
  throw new Error('Mesh was not created for non-indexed geometry');
}

const indexAttr = surface.mesh.geometry.getIndex();
if (!indexAttr || indexAttr.count === 0) {
  throw new Error('Index buffer was not generated for non-indexed geometry');
}

console.log('Non-indexed geometry test passed: index count =', indexAttr.count);
