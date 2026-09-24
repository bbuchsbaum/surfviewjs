/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountSurfView } from '../../src/report';
import type { SurfViewSceneManifest } from '../../src/scene';

function manifestFixture(): SurfViewSceneManifest {
  const sha = (character: string) => character.repeat(64);
  const asset = (id: string, dtype: 'float32' | 'uint32', shape: number[], byteLength: number, c: string) => ({
    id,
    role: id,
    dtype,
    shape,
    byteLength,
    sha256: sha(c),
    endianness: 'little',
    encoding: 'base64',
    data: ''
  });
  return {
    schemaVersion: 'surfview.scene.v1',
    id: 'brain-view-fixture',
    assets: {
      vertices: asset('vertices', 'float32', [3, 3], 36, 'a'),
      faces: asset('faces', 'uint32', [1, 3], 12, 'b'),
      values: asset('values', 'float32', [3], 12, 'c')
    },
    geometries: {
      left: {
        id: 'left',
        hemisphere: 'left',
        vertices: 'vertices',
        faces: 'faces',
        vertexCount: 3,
        faceCount: 1
      }
    },
    layers: {
      statistic: {
        id: 'statistic',
        values: { left: { values: 'values' } },
        colorMap: 'viridis',
        limits: [-1, 1]
      }
    },
    selectedLayer: 'statistic'
  } as SurfViewSceneManifest;
}

class FakeIntersectionObserver {
  constructor(_callback: IntersectionObserverCallback) {}
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('scene mount whole-brain view handle', () => {
  it('accepts brain-view and inset commands before the lazy viewer mounts', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const requestFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountSurfView(container, manifestFixture(), {
      lazy: true,
      layout: 'anatomical',
      initialBrainView: 'dorsal',
      fitInsets: { top: 40 }
    });
    try {
      expect(typeof handle.setBrainView).toBe('function');
      expect(typeof handle.getBrainView).toBe('function');
      expect(typeof handle.setFitInsets).toBe('function');

      // No controller yet: commands are recorded without WebGL and do not throw.
      expect(handle.getBrainView()).toBeNull();
      expect(() => handle.setBrainView('left-medial')).not.toThrow();
      expect(() => handle.setFitInsets({ left: 120, right: 0 })).not.toThrow();
      expect(() => handle.resetView()).not.toThrow();
      expect(handle.getBrainView()).toBeNull();
      expect(handle.viewer).toBeNull();
      expect(container.querySelector('canvas')).toBeNull();
      expect(requestFrame).not.toHaveBeenCalled();
    } finally {
      handle.dispose();
      await expect(handle.ready).rejects.toMatchObject({ name: 'AbortError' });
    }
  });
});
