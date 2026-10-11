import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GPULayerCompositor } from '../../src/GPULayerCompositor';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { SurfaceGeometry } from '../../src/classes';
import { DataLayer, VolumeProjectionLayer } from '../../src/layers';

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
}

// A triangle inside a 3x3x3 volume on a 1 mm grid; every voxel holds its x index.
const VERTICES = new Float32Array([0.2, 0.5, 0.5, 1.8, 0.5, 0.5, 1, 1.5, 0.5]);
const WHITE = new Float32Array([0.2, 0.5, 0.3, 1.8, 0.5, 0.3, 1, 1.5, 0.3]);
const DIMS: [number, number, number] = [3, 3, 3];
const VOLUME = new Float32Array(27).map((_, i) => i % 3);

function triangle(): SurfaceGeometry {
  return new SurfaceGeometry(VERTICES.slice(), new Uint32Array([0, 1, 2]), 'left');
}

function volumeLayer(projectionMode: 'vertex' | 'fragment' | 'hybrid' | 'ribbon'): VolumeProjectionLayer {
  return new VolumeProjectionLayer('volume', VOLUME, DIMS, {
    voxelSize: [1, 1, 1],
    volumeOrigin: [0, 0, 0],
    colormap: 'coolwarm',
    range: [0, 2],
    threshold: [0, 0],
    fillValue: -1e6,
    projectionMode,
    ribbon: { pial: VERTICES, white: WHITE, samples: 3, reducer: 'mean' }
  });
}

describe('colormap updates', () => {
  // The canonical update field for a colour map is `colorMap` on every
  // scalar layer, so one updateLayer call can restyle any of them.
  it('accepts the canonical colorMap field on DataLayer and VolumeProjectionLayer alike', () => {
    const surface = new MultiLayerNeuroSurface(triangle(), {});
    const data = new DataLayer('projected', new Float32Array([0, 1, 2]), null, 'coolwarm', {
      range: [0, 2], threshold: [0, 0]
    });
    const volume = volumeLayer('fragment');
    surface.addLayer(data);
    surface.addLayer(volume);

    const before = volume.getRGBAData(3).slice();
    for (const id of ['projected', 'volume']) {
      expect(() => surface.updateLayer(id, { colorMap: 'hot' })).not.toThrow();
    }
    expect(data.getColorMapName()).toBe('hot');
    expect(volume.toStateJSON().colorMapName).toBe('hot');
    expect(Array.from(volume.getRGBAData(3))).not.toEqual(Array.from(before));
    surface.dispose();
  });

  it.each(['vertex', 'fragment', 'hybrid', 'ribbon'] as const)(
    'recolours a %s-mode volume layer on the CPU path',
    mode => {
      const surface = new MultiLayerNeuroSurface(triangle(), {});
      const volume = volumeLayer(mode);
      surface.addLayer(volume);
      const before = volume.getRGBAData(3).slice();
      surface.updateLayer('volume', { colorMap: 'hot' });
      expect(volume.needsUpdate).toBe(true);
      expect(Array.from(volume.getRGBAData(3))).not.toEqual(Array.from(before));
      surface.dispose();
    }
  );

  it('keeps the legacy colormap field on VolumeProjectionLayer', () => {
    const volume = volumeLayer('vertex');
    volume.update({ colormap: 'hot' });
    expect(volume.toStateJSON().colorMapName).toBe('hot');
    volume.dispose();
  });

  it('rejects conflicting colorMap and colormap fields without mutating', () => {
    const volume = volumeLayer('vertex');
    expect(() => volume.update({ colorMap: 'hot', colormap: 'viridis' })).toThrow(/colorMap/);
    expect(volume.toStateJSON().colorMapName).toBe('coolwarm');
    expect(() => volume.update({ colorMap: 3 as unknown as string })).toThrow(TypeError);
    volume.dispose();
  });

  it('re-uploads the GPU colormap slice when a GPU-sampled volume layer changes colour map', () => {
    const compositor = new GPULayerCompositor(3, 2);
    const volume = volumeLayer('vertex');
    volume.attach({ geometry: { vertices: VERTICES } });
    expect(volume.usesGPUVertexProjection()).toBe(true);
    compositor.updateLayers([volume]);

    const lut = (compositor as any).volumeColormapsTexture as THREE.DataArrayTexture;
    const slice = () => Array.from((lut.image.data as Uint8Array).subarray(0, 256 * 4));
    const before = slice();
    const versionBefore = lut.version;

    volume.update({ colorMap: 'hot' });
    compositor.updateLayers([volume]);

    expect(slice()).not.toEqual(before);
    expect(slice()).toEqual(Array.from(volume.getColormapTexture().image.data as Uint8Array));
    expect(lut.version).toBeGreaterThan(versionBefore);
    compositor.dispose();
    volume.dispose();
  });
});
