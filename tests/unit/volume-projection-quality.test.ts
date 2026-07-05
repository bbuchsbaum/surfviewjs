import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VolumeProjectionLayer } from '../../src/layers';

function attachLayer(layer: VolumeProjectionLayer, vertices: Float32Array) {
  const mesh = new THREE.Mesh();
  mesh.updateMatrixWorld(true);
  layer.attach({
    geometry: { vertices },
    mesh
  });
}

describe('VolumeProjectionLayer quality modes', () => {
  it('distinguishes nearest and linear scalar sampling', () => {
    const data = new Float32Array([
      0, 1,
      10, 11,
      100, 101,
      110, 111
    ]);

    const nearest = new VolumeProjectionLayer('nearest', data, [2, 2, 2], {
      worldToIJK: new THREE.Matrix4(),
      sampling: 'nearest'
    });
    const linear = new VolumeProjectionLayer('linear', data, [2, 2, 2], {
      worldToIJK: new THREE.Matrix4(),
      sampling: 'linear'
    });

    expect(nearest.sampleValueAtWorld(new THREE.Vector3(0.5, 0.5, 0.5))).toBe(111);
    expect(linear.sampleValueAtWorld(new THREE.Vector3(0.5, 0.5, 0.5))).toBeCloseTo(55.5);
  });

  it('returns null for out-of-bounds transformed samples', () => {
    const layer = new VolumeProjectionLayer('bounds', new Float32Array([1]), [1, 1, 1], {
      worldToIJK: new THREE.Matrix4()
    });

    expect(layer.sampleValueAtWorld(new THREE.Vector3(0, 0, 0))).toBe(1);
    expect(layer.sampleValueAtWorld(new THREE.Vector3(2, 0, 0))).toBeNull();
  });

  it('samples and reduces values along a pial-white ribbon', () => {
    const data = new Float32Array([0, 1, 2, 3, 4]);
    const vertices = new Float32Array([0, 0, 2]);
    const white = new Float32Array([0, 0, 0]);
    const pial = new Float32Array([0, 0, 4]);

    const mean = new VolumeProjectionLayer('mean', data, [1, 1, 5], {
      worldToIJK: new THREE.Matrix4(),
      projectionMode: 'ribbon',
      fillValue: -1,
      ribbon: { white, pial, samples: 5, reducer: 'mean' }
    });
    attachLayer(mean, vertices);
    expect(mean.sampleValueAtVertex(0)).toBe(2);

    mean.update({ ribbon: { reducer: 'max' } });
    expect(mean.sampleValueAtVertex(0)).toBe(4);

    mean.update({ ribbon: { reducer: 'median' } });
    expect(mean.sampleValueAtVertex(0)).toBe(2);
  });

  it('uses ribbon for hybrid publication mode and vertex for interactive mode', () => {
    const data = new Float32Array([0, 1, 2, 3, 4]);
    const vertices = new Float32Array([0, 0, 0]);
    const white = new Float32Array([0, 0, 0]);
    const pial = new Float32Array([0, 0, 4]);
    const layer = new VolumeProjectionLayer('hybrid', data, [1, 1, 5], {
      worldToIJK: new THREE.Matrix4(),
      projectionMode: 'hybrid',
      quality: 'interactive',
      fillValue: -1,
      ribbon: { white, pial, samples: 5, reducer: 'mean' }
    });
    attachLayer(layer, vertices);

    expect(layer.sampleValueAtVertex(0)).toBe(0);
    layer.setQuality('publication');
    expect(layer.sampleValueAtVertex(0)).toBe(2);
  });

  it('validates ribbon surface vertex counts', () => {
    const layer = new VolumeProjectionLayer('bad-ribbon', new Float32Array([1]), [1, 1, 1], {
      projectionMode: 'ribbon',
      ribbon: {
        white: new Float32Array([0, 0, 0, 1, 1, 1]),
        pial: new Float32Array([0, 0, 0, 1, 1, 1])
      }
    });
    attachLayer(layer, new Float32Array([0, 0, 0]));

    expect(() => layer.getRGBAData(1)).toThrow(/vertex count mismatch/);
  });

  it('serializes projection mode, sampling, quality, and ribbon metadata', () => {
    const layer = new VolumeProjectionLayer('state', new Float32Array([1]), [1, 1, 1], {
      projectionMode: 'ribbon',
      sampling: 'linear',
      quality: 'publication',
      ribbon: {
        white: new Float32Array([0, 0, 0]),
        pial: new Float32Array([0, 0, 0]),
        samples: 3,
        reducer: 'median'
      }
    });

    expect(layer.toStateJSON()).toMatchObject({
      projectionMode: 'ribbon',
      sampling: 'linear',
      quality: 'publication',
      ribbon: {
        samples: 3,
        reducer: 'median',
        hasSurfaces: true
      }
    });
  });
});
