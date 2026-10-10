import { ParcelPuzzleView, loadSurface } from '@src/index.js';
import type { ParcelData } from '@src/index.js';

export async function showPuzzle(container: HTMLElement, atlas: ParcelData & { vertexLabels: number[] }) {
  const mesh = await loadSurface('fs_LR.32k.L.inflated.surf.gii', 'gifti', 'left');
  const puzzle = new ParcelPuzzleView(container, {
    vertices: mesh.vertices, faces: mesh.faces, vertexLabels: atlas.vertexLabels, parcelData: atlas
  }, {
    thickness: 2, // illustrative shell depth, mm
    separation: 0.04,
    labelText: parcel => parcel.label,
    renderDetail: (panel, { parcel, piece }) => {
      panel.textContent = `${parcel.label}: ${piece.surfaceArea.toFixed(1)} mm²`;
    }
  });
  puzzle.on('selection:changed', ({ parcelId }) => console.log('pinned', parcelId));
  puzzle.setSeparation(0.22); // pull the pieces apart
  puzzle.setRelief(0.65); // flatten each piece towards its mean normal
  puzzle.setView('medial');
  return puzzle;
}
