import { DataLayer, NeuroSurfaceViewer, VolumeProjectionLayer, projectVolume } from '@src/index.js';

// 2 mm voxels; voxel (0, 0, 0) is centred at (-80, -120, -60) mm. Column-major affine.
const voxelToWorld = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -80, -120, -60, 1];

export function sampleAlongNormals(viewer: NeuroSurfaceViewer, data: Float32Array, dims: [number, number, number],
  positions: Float32Array, normals: Float32Array) {
  const { values, validSamples } = projectVolume({ data, dims, voxelToWorld }, { positions, normals }, {
    depthMm: [-4, 4], steps: 5, interpolation: 'linear', reducer: 'mean' // or 'max-abs'
  });
  viewer.addLayer('lh', new DataLayer('projected', values, null, 'coolwarm', { range: [-4, 4], threshold: [-0.5, 0.5] }));
  return validSamples; // samples that fell inside the volume, per vertex
}

export function volumeLayer(viewer: NeuroSurfaceViewer, data: Float32Array, dims: [number, number, number],
  pial: Float32Array, white: Float32Array) {
  viewer.addLayer('lh', new VolumeProjectionLayer('volume', data, dims, {
    affineMatrix: voxelToWorld, colormap: 'coolwarm', range: [-4, 4], threshold: [-0.5, 0.5],
    projectionMode: 'vertex', sampling: 'linear', ribbon: { pial, white, samples: 7, reducer: 'mean' }
  }));
  viewer.updateLayer('lh', 'volume', { projectionMode: 'ribbon', ribbon: { reducer: 'median' } });
}
