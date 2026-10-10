import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VolumeProjectionLayer } from '../../src/layers';
import { VolumeTexture3D } from '../../src/textures/VolumeTexture3D';

const DIMS: [number, number, number] = [2, 2, 2];
const DATA = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);

function fakeRenderer(extensions: string[]): THREE.WebGLRenderer {
  const gl = { getExtension: (name: string) => (extensions.includes(name) ? {} : null) };
  return { getContext: () => gl, capabilities: { isWebGL2: true, maxVertexTextures: 16 } } as any;
}

function filters(texture: THREE.Data3DTexture) {
  return [texture.minFilter, texture.magFilter];
}

describe('VolumeProjectionLayer GPU sampling', () => {
  it('filters the 3D texture the way the layer samples', () => {
    const nearest = new VolumeProjectionLayer('nearest', DATA, DIMS);
    expect(nearest.getSamplingMode()).toBe('nearest');
    expect(filters(nearest.getVolumeTexture().texture)).toEqual([THREE.NearestFilter, THREE.NearestFilter]);

    const linear = new VolumeProjectionLayer('linear', DATA, DIMS, { sampling: 'linear' });
    expect(filters(linear.getVolumeTexture().texture)).toEqual([THREE.LinearFilter, THREE.LinearFilter]);
    nearest.dispose();
    linear.dispose();
  });

  it('updates the texture filter when the sampling mode changes', () => {
    const layer = new VolumeProjectionLayer('v', DATA, DIMS, { sampling: 'linear' });
    const texture = layer.getVolumeTexture().texture;
    const version = texture.version;

    layer.setSamplingMode('nearest');
    expect(filters(texture)).toEqual([THREE.NearestFilter, THREE.NearestFilter]);
    expect(texture.version).toBeGreaterThan(version);

    layer.update({ sampling: 'linear' });
    expect(filters(texture)).toEqual([THREE.LinearFilter, THREE.LinearFilter]);
    expect(layer.needsUpdate).toBe(true);
    layer.dispose();
  });
});

describe('VolumeTexture3D linear-filtering fallback', () => {
  it('falls back to nearest for float data without OES_texture_float_linear', () => {
    const volume = new VolumeTexture3D(DATA, 2, 2, 2);
    expect(volume.getFilter()).toBe('linear');

    volume.prepareForRenderer(fakeRenderer([]));
    expect(filters(volume.texture)).toEqual([THREE.NearestFilter, THREE.NearestFilter]);
    expect(volume.getFilter()).toBe('linear');
    expect(volume.getEffectiveFilter()).toBe('nearest');

    // A sampling change keeps the fallback while the renderer lacks support.
    volume.setFilter('linear');
    expect(volume.texture.magFilter).toBe(THREE.NearestFilter);

    volume.prepareForRenderer(fakeRenderer(['OES_texture_float_linear']));
    expect(filters(volume.texture)).toEqual([THREE.LinearFilter, THREE.LinearFilter]);
    expect(volume.getEffectiveFilter()).toBe('linear');
    volume.dispose();
  });

  it('keeps linear filtering for half-float data, which WebGL2 filters natively', () => {
    const volume = new VolumeTexture3D(DATA, 2, 2, 2, { useHalfFloat: true });
    volume.prepareForRenderer(fakeRenderer([]));
    expect(volume.texture.magFilter).toBe(THREE.LinearFilter);
    expect(VolumeTexture3D.isSupported(fakeRenderer([]), { useHalfFloat: true })).toBe(true);
    expect(VolumeTexture3D.isSupported(fakeRenderer([]))).toBe(false);
    volume.dispose();
  });

  it('restores explicit three.js filters after a fallback', () => {
    const volume = new VolumeTexture3D(DATA, 2, 2, 2, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.LinearFilter
    });
    volume.prepareForRenderer(fakeRenderer([]));
    expect(filters(volume.texture)).toEqual([THREE.NearestFilter, THREE.NearestFilter]);
    volume.prepareForRenderer(fakeRenderer(['OES_texture_float_linear']));
    expect(filters(volume.texture)).toEqual([THREE.NearestFilter, THREE.LinearFilter]);

    // setFilter replaces the explicit filters.
    volume.setFilter('linear');
    expect(filters(volume.texture)).toEqual([THREE.LinearFilter, THREE.LinearFilter]);
    volume.dispose();
  });

  it('falls back when only an explicit minFilter needs linear filtering', () => {
    const volume = new VolumeTexture3D(DATA, 2, 2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.NearestFilter
    });
    volume.prepareForRenderer(fakeRenderer([]));
    expect(filters(volume.texture)).toEqual([THREE.NearestFilter, THREE.NearestFilter]);
    expect(volume.getEffectiveFilter()).toBe('nearest');
    volume.dispose();
  });

  it('leaves nearest sampling alone', () => {
    const volume = new VolumeTexture3D(DATA, 2, 2, 2, { filter: 'nearest' });
    const version = volume.texture.version;
    volume.prepareForRenderer(fakeRenderer([]));
    expect(volume.texture.version).toBe(version);
    expect(volume.getEffectiveFilter()).toBe('nearest');
    volume.dispose();
  });
});
