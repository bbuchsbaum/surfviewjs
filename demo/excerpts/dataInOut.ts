import { AlignmentQAWorkspace, loadSurfaceFromFile } from '@src/index.js';
import type { AlignmentQAConfig, NeuroSurfaceViewer } from '@src/index.js';

// In: a GIFTI, ASCII PLY or FreeSurfer surface picked by the user.
export async function readSurface(file: File) {
  return loadSurfaceFromFile(file, 'auto'); // format detected from the file name
}

// Out: state, a share link, and a scene manifest.
export function saveAndShare(viewer: NeuroSurfaceViewer) {
  const state = viewer.toJSON(); // camera, layer settings, selection
  viewer.fromJSON(state);
  const link = viewer.toURL(); // state in a #svjs=… fragment
  viewer.fromURL(new URL(link).hash); // or viewer.fromURL() on page load
  return viewer.exportSceneJSON({ provenance: { generator: 'my-app' } });
}

// Check a surface-to-volume transform against a reference volume.
export function checkAlignment(host: HTMLElement, config: AlignmentQAConfig) {
  const qa = new AlignmentQAWorkspace(host, config);
  return qa.getReport().metrics.surfaceVoxelDistance.outOfBoundsFraction;
}
