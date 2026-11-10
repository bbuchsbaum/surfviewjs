import { gunzipSync } from 'fflate';
import { SurfaceDomain, SurfaceMetric } from '@src/index.js';
import { FlatMapChart, FlatMapFrame, flatMapAreaCalibration } from '@src/index.flatmap.js';
import manifest from '../data/flatmap/manifest.json';
import bundleUrl from '../data/flatmap/s1-lh.bin.gz?url';

/** Verified local, matched reconstruction. No third-party network request at demo runtime. */
export async function loadMatchedFlatMap(signal?: AbortSignal, options: { volumePattern?: 'affine' | 'depth-demo' } = {}) {
  const response = await fetch(bundleUrl, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Cortical dataset: HTTP ${response.status}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', compressed)), b => b.toString(16).padStart(2, '0')).join('');
  // Vite may serve .gz with Content-Encoding, which fetch transparently decodes.
  if (hash !== manifest.sha256 && hash !== manifest.uncompressedSha256) throw new Error('Cortical dataset checksum mismatch');
  const bytes = hash === manifest.sha256 ? gunzipSync(compressed) : compressed;
  if (bytes.byteLength !== manifest.uncompressedBytes) throw new Error('Cortical dataset length mismatch');
  function floats(name: 'white' | 'pial' | 'inflated' | 'coordinates') {
    const a = manifest.arrays[name]; return new Float32Array(bytes.buffer, bytes.byteOffset + a.offset, a.length);
  }
  function indices(name: 'faces' | 'chartFaces' | 'anatomicalFaces' | 'anatomicalVertices') {
    const a = manifest.arrays[name]; return new Uint32Array(bytes.buffer, bytes.byteOffset + a.offset, a.length);
  }
  const domain = new SurfaceDomain({ id: 'pycortex-S1-lh', structure: 'left', vertexCount: manifest.vertexCount, faces: indices('faces') });
  const white = new SurfaceMetric(domain, { positions: floats('white'), units: 'mm', frame: manifest.frame });
  const pial = new SurfaceMetric(domain, { positions: floats('pial'), units: 'mm', frame: manifest.frame });
  const inflated = new SurfaceMetric(domain, { positions: floats('inflated'), units: 'mm', frame: manifest.frame });
  const chart = new FlatMapChart({ domain, coordinates: floats('coordinates'), faces: indices('chartFaces'),
    anatomicalVertices: indices('anatomicalVertices'), anatomicalFaces: indices('anatomicalFaces'), units: 'arbitrary' });
  const calibration = flatMapAreaCalibration(chart, pial);
  const points = pial.copyPositions();
  const values = new Float64Array(domain.vertexCount), validity = new Uint8Array(domain.vertexCount).fill(1);
  for (let v = 0; v < values.length; v++) {
    const x = points[v * 3]!, y = points[v * 3 + 1]!, z = points[v * 3 + 2]!;
    values[v] = Math.sin(y / 28) * 0.55 + Math.cos(z / 24) * 0.3 + x / 160;
    if (Math.hypot(y + 35, z - 25) < 12) validity[v] = 0;
  }
  // Keep the affine numerical witness as the default. The interactive demo uses
  // resolved spatial waves so a few millimetres through the ribbon visibly matter.
  // Both are fixed 3D fields: changing depth never changes the source values.
  const dims = [64, 80, 64] as const, origin = [-100, -120, -80], spacing = 3;
  const volume = new Float64Array(dims[0] * dims[1] * dims[2]), mask = new Uint8Array(volume.length).fill(1);
  for (let i = 0; i < volume.length; i++) {
    const x = origin[0]! + i % dims[0] * spacing, y = origin[1]! + Math.floor(i / dims[0]) % dims[1] * spacing;
    const z = origin[2]! + Math.floor(i / (dims[0] * dims[1])) * spacing;
    volume[i] = options.volumePattern === 'depth-demo'
      ? 0.5 * Math.sin(x / 2) + 0.4 * Math.cos(y / 2.5) + 0.3 * Math.sin(z / 3)
      : (x + 2 * y + z) / 200;
    if (Math.abs(y + 35) < 6 && z > 20 && z < 45) mask[i] = 0;
  }
  return { domain, white, pial, inflated, chart, calibration, scalar: new FlatMapFrame(values, validity),
    volume: new FlatMapFrame(volume, mask), dims, voxelToWorld: [spacing, 0, 0, 0, 0, spacing, 0, 0, 0, 0, spacing, 0, ...origin, 1], manifest };
}
