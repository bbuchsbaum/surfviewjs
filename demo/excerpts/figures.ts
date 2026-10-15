import { mountSurfView } from '@src/index.js';
import type { NeuroSurfaceViewer, SurfViewSceneManifest } from '@src/index.js';

export function exportFigure(viewer: NeuroSurfaceViewer) {
  const style = viewer.applyStylePreset('paper-light');
  return viewer.exportPNG({
    width: 1200, height: 900,
    background: style.background.clearColor, // or 'viewer' | 'transparent'
    colorbarLayer: 'contrast', // key: its colormap, range and masked interval
    title: 'Synthetic contrast',
    scaleBar: false, // perspective camera: no single mm length holds
    downloadFilename: 'surfview-figure.png'
  });
}

export async function showReport(container: HTMLElement, manifest: SurfViewSceneManifest) {
  const report = mountSurfView(container, manifest, {
    preset: 'report', layout: 'anatomical', oblique: 'auto',
    bilateralGroup: { id: 'cortex', leftSurfaceId: 'left', rightSurfaceId: 'right' }
  });
  await report.ready;
  report.setBrainView('left-medial');
  // A v2 manifest may include one binary role:'reference' with #rrggbb color.
  report.controlTarget?.setLayerOpacity({ surfaceId: 'left', layerId: 'reference' }, 0.25);
  report.selectLayer('contrast'); // preserves reference state
}
