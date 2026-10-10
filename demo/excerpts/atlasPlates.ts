import { AtlasPlateView, buildAtlasPlate, loadSurface } from '@src/index.js';
import type { ParcelData } from '@src/index.js';

export async function showAtlasPlate(container: HTMLElement, atlas: ParcelData & { vertexLabels: number[] }) {
  const mesh = await loadSurface('fs_LR.32k.L.inflated.surf.gii', 'gifti', 'left');
  const input = { vertices: mesh.vertices, faces: mesh.faces, vertexLabels: atlas.vertexLabels, parcelData: atlas, hemisphere: 'left' as const };
  const plate = buildAtlasPlate(input, { view: 'lateral', width: 1200, height: 850, contourSmoothing: 4, detailScales: [2, 4] });

  const view = new AtlasPlateView(container, plate, {
    colors: new Map([[1, '#dfa363']]), // parcel ID -> fill
    onParcelClick: id => view.setSelection(id)
  });
  view.setStyle({ dashed: true, boundaryHaloWidth: 4.2 });
  view.setLabelEditing(true); // drag a name to pin it
  view.setZoom(2); // reveal denser labels; the export keeps the overview framing

  const svg = view.toSVG(); // editable text and region paths
  const png = await view.exportPNG(3);
  return { view, svg, png };
}
