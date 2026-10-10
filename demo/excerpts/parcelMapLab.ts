import { ParcelMapOptimizer, buildParcelMapMesh, flattenParcelMap, loadSurface } from '@src/index.js';
import type { ParcelData } from '@src/index.js';

export async function flattenParcels(atlas: ParcelData & { vertexLabels: number[] }) {
  const surface = await loadSurface('fs_LR.32k.L.inflated.surf.gii', 'gifti', 'left');
  // One connected sheet: the medial-wall opening becomes the outside edge.
  const mesh = buildParcelMapMesh({
    vertices: surface.vertices, faces: surface.faces, vertexLabels: atlas.vertexLabels, parcelData: atlas
  });
  const start = await flattenParcelMap(mesh, { boundaryShape: 4, aspectRatio: 1.4 }); // rounded square

  const optimizer = new ParcelMapOptimizer(mesh, start, {
    angleWeight: 0.3, areaWeight: 3, compactnessWeight: 0.6, equalArea: 0.35, resolution: 14
  });
  for (let i = 0; i < 80; i++) {
    if (!optimizer.step().accepted) break; // only decreasing, flip-free steps are accepted
  }
  const { areaError, angleDistortion, meanCompactness, flippedTriangles } = optimizer.measure();
  return { uv: optimizer.coordinates, areaError, angleDistortion, meanCompactness, flippedTriangles };
}
