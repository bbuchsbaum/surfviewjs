#!/usr/bin/env node

/**
 * Regression tests for VolumeProjectionLayer integration with LayerStack/GPULayerCompositor.
 *
 * These tests run in Node (no WebGL context) and validate:
 * - CPU fallback sampling + masking semantics
 * - GPU compositor uniform plumbing (shader setup only)
 */
import {
  SurfaceGeometry,
  MultiLayerNeuroSurface,
  VolumeProjectionLayer
} from '../dist/neurosurface.es.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

function makeSurface(vertices) {
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  }
  const geom = new SurfaceGeometry(
    new Float32Array(vertices),
    new Uint32Array([0, 1, 2]), // minimal face index; extra vertices may be unused
    'left'
  );
  return new MultiLayerNeuroSurface(geom, { useGPUCompositing: false });
}

function testCpuSamplingAndMasking() {
  // 2x2x2 volume, flattened i + nx*j + nx*ny*k
  const dims = [2, 2, 2];
  const volume = new Float32Array([
    0.0, 1.0,
    0.25, 0.5,
    0.5, 0.75,
    1.0, 0.0
  ]);

  // Vertex positions are in voxel-index world coords for identity world->IJK.
  const vertices = [
    0, 0, 0,   // v0 -> 0.0
    1, 0, 0,   // v1 -> 1.0
    0, 0, 1,   // v2 -> 0.5
    -10, 0, 0, // v3 -> out-of-bounds
    0, 1, 1    // v4 -> 1.0
  ];

  const surface = makeSurface(vertices);

  const layer = new VolumeProjectionLayer('vol', volume, dims, {
    colormap: 'viridis',
    range: [0, 1],
    threshold: [0, 0],
    fillValue: -9999
  });
  surface.addLayer(layer);

  const rgba = layer.getRGBAData(vertices.length / 3);
  assert(rgba.length === (vertices.length / 3) * 4, 'RGBA length should match vertexCount*4');

  // v3 is out-of-bounds -> transparent
  const v3a = rgba[3 * 4 + 3];
  assert(approxEqual(v3a, 0), 'Out-of-bounds vertices should be transparent');

  // v1 is value=1.0 -> visible
  const v1a = rgba[1 * 4 + 3];
  assert(v1a > 0, 'In-bounds, non-thresholded values should be visible');

  // Threshold hides values inside [0.2, 0.8]
  layer.setThreshold([0.2, 0.8]);
  const rgbaThresh = layer.getRGBAData(vertices.length / 3);
  const v2a = rgbaThresh[2 * 4 + 3]; // v2 value=0.5
  assert(approxEqual(v2a, 0), 'Values inside threshold range should be transparent');

  // Fill value treated as transparent
  layer.setThreshold([0, 0]);
  layer.setFillValue(0.5);
  const rgbaFill = layer.getRGBAData(vertices.length / 3);
  const v2aFill = rgbaFill[2 * 4 + 3];
  assert(approxEqual(v2aFill, 0), 'Fill values should be transparent');
}

function testGpuUniformPlumbing() {
  const dims = [2, 2, 2];
  const volume = new Float32Array(8).fill(1.0);

  const surface = makeSurface([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0
  ]);

  // Mock a WebGL2-capable renderer for switching into GPU compositing mode.
  surface.viewer = { renderer: { capabilities: { isWebGL2: true } } };
  surface.setCompositingMode(true);

  const layer = new VolumeProjectionLayer('vol', volume, dims, {
    colormap: 'viridis',
    range: [0, 1],
    threshold: [0, 0]
  });
  surface.addLayer(layer);
  surface.updateColors();

  const material = surface.mesh.material;
  assert(material && material.isShaderMaterial, 'GPU compositing should use ShaderMaterial');

  const uniforms = material.uniforms;
  assert(uniforms.layerKind, 'Shader should expose layerKind uniform');

  // Visible layers are base (slot 0) + volume (slot 1).
  const kinds = uniforms.layerKind.value;
  assert(kinds[1] === 1, 'Volume layer should be marked as kind=1 in compositor slot 1');

  assert(uniforms.volume1 && uniforms.volume1.value, 'Volume sampler should be assigned for slot 1');
  assert(uniforms.volumeColormaps && uniforms.volumeColormaps.value, 'Colormap array texture should be assigned');

  const cmapTex = uniforms.volumeColormaps.value;
  assert(cmapTex && cmapTex.isDataArrayTexture, 'volumeColormaps should be a DataArrayTexture');
  const cmapData = cmapTex.image && cmapTex.image.data;
  assert(cmapData instanceof Uint8Array, 'Colormap array data should be a Uint8Array');

  const sliceOffset = 1 * 256 * 4;
  assert(cmapData[sliceOffset + 3] === 255, 'Colormap slice should be populated (alpha=255)');
}

function run() {
  testCpuSamplingAndMasking();
  testGpuUniformPlumbing();
  console.log('✓ VolumeProjectionLayer tests passed');
}

run();
