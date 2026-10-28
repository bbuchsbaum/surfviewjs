import { AlignmentQAWorkspace, loadSurfaceFromFile, SurfaceResamplingPlan, exportSurfaceResamplingPlan, importSurfaceResamplingPlan } from '@src/index.js';
import type { AlignmentQAConfig, NeuroSurfaceViewer, SurfaceDomain } from '@src/index.js';

// In: a GIFTI, ASCII PLY or FreeSurfer surface picked by the user.
export async function readSurface(file: File) {
  return loadSurfaceFromFile(file, 'auto'); // format detected from the file name
}

export async function reusableMapping(domain: SurfaceDomain, values: Float32Array, labels: Uint32Array) {
  const n = domain.vertexCount;
  const plan = new SurfaceResamplingPlan(domain, domain, {
    offsets: Uint32Array.from({ length: n + 1 }, (_, i) => i),
    indices: Uint32Array.from({ length: n }, (_, i) => i), weights: new Float64Array(n).fill(1)
  }, { method: 'provided', correspondence: 'explicit-identity' });
  const artifact = await exportSurfaceResamplingPlan(plan); // serialize as JSON
  const restored = await importSurfaceResamplingPlan(artifact, domain, domain); // identity + checksum validation
  return { scalars: restored.apply(values), categories: restored.applyLabels(labels), artifact };
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
