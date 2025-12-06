#!/usr/bin/env node

/**
 * Sanity checks for layer ordering and GPU/CPU compositing switches.
 */
import {
  SurfaceGeometry,
  MultiLayerNeuroSurface,
  DataLayer
} from '../dist/neurosurface.es.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makeSurface() {
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  }
  const geom = new SurfaceGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    new Uint32Array([0, 1, 2]),
    'left'
  );
  return new MultiLayerNeuroSurface(geom, { useGPUCompositing: false });
}

function testLayerOrder() {
  const surface = makeSurface();
  const a = new DataLayer('a', new Float32Array([0, 0, 0]), null, 'jet');
  const b = new DataLayer('b', new Float32Array([1, 1, 1]), null, 'jet');
  surface.addLayer(a);
  surface.addLayer(b);

  surface.setLayerOrder(['b', 'a']);
  const ordered = surface.layerStack.getVisibleLayers().map(l => l.id).filter(id => id === 'a' || id === 'b');
  assert(ordered[0] === 'b' && ordered[1] === 'a', 'setLayerOrder should reorder visible layers');
}

function testCompositingMode() {
  const surface = makeSurface();
  // Mock a WebGL2-capable renderer
  surface.viewer = { renderer: { capabilities: { isWebGL2: true } } };

  surface.setCompositingMode(true);
  assert(surface.getCompositingMode() === 'GPU', 'Should switch to GPU compositing when WebGL2 is available');

  surface.setCompositingMode(false);
  assert(surface.getCompositingMode() === 'CPU', 'Should switch back to CPU compositing');
}

function run() {
  testLayerOrder();
  testCompositingMode();
  console.log('✓ Layer ordering and GPU/CPU compositing tests passed');
}

run();
