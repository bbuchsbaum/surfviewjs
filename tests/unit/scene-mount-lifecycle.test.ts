/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountSurfView } from '../../src/report';
import type { SurfViewSceneManifest } from '../../src/scene';

function manifestFixture(): SurfViewSceneManifest {
  const sha = (character: string) => character.repeat(64);
  return {
    schemaVersion: 'surfview.scene.v1',
    id: 'lazy-fixture',
    assets: {
      vertices: {
        id: 'vertices',
        role: 'vertices',
        dtype: 'float32',
        shape: [3, 3],
        byteLength: 36,
        sha256: sha('a'),
        endianness: 'little',
        encoding: 'base64',
        data: ''
      },
      faces: {
        id: 'faces',
        role: 'faces',
        dtype: 'uint32',
        shape: [1, 3],
        byteLength: 12,
        sha256: sha('b'),
        endianness: 'little',
        encoding: 'base64',
        data: ''
      },
      values: {
        id: 'values',
        role: 'values',
        dtype: 'float32',
        shape: [3],
        byteLength: 12,
        sha256: sha('c'),
        endianness: 'little',
        encoding: 'base64',
        data: ''
      }
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
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('lazy scene mount lifecycle', () => {
  it('validates unknown schemas before creating observers or WebGL', () => {
    const observer = vi.fn();
    vi.stubGlobal('IntersectionObserver', observer);
    const manifest = manifestFixture() as SurfViewSceneManifest & { schemaVersion: string };
    manifest.schemaVersion = 'surfview.scene.v99';

    expect(() => mountSurfView(document.createElement('div'), manifest)).toThrow(
      '$.schemaVersion: unsupported schema surfview.scene.v99'
    );
    expect(observer).not.toHaveBeenCalled();
  });

  it('creates no frame or renderer before intersection and disposes idempotently', async () => {
    let disconnects = 0;
    let observations = 0;
    class FakeIntersectionObserver {
      constructor(_callback: IntersectionObserverCallback) {}
      observe(): void { observations += 1; }
      disconnect(): void { disconnects += 1; }
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] { return []; }
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const requestFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountSurfView(container, manifestFixture(), { lazy: true });

    expect(observations).toBe(1);
    expect(handle.viewer).toBeNull();
    expect(handle.controlTarget).toBeNull();
    expect(handle.getAnatomicalViewCapabilities()).toEqual({
      views: ['lateral', 'medial', 'dorsal', 'ventral', 'anterior', 'posterior'],
      singleSurfaceIds: ['left'],
      bilateralGroups: []
    });
    expect(container.querySelector('canvas')).toBeNull();
    expect(requestFrame).not.toHaveBeenCalled();

    handle.dispose();
    handle.dispose();
    await expect(handle.ready).rejects.toMatchObject({ name: 'AbortError' });
    expect(disconnects).toBe(1);
    expect(handle.controlTarget).toBeNull();
    expect(container.childElementCount).toBe(0);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('aborts pending adjacent asset fetches on dispose', async () => {
    const manifest = manifestFixture();
    for (const asset of Object.values(manifest.assets)) {
      delete asset.data;
      delete asset.encoding;
      asset.uri = `${asset.id}.bin`;
    }
    let fetchSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        fetchSignal?.addEventListener('abort', () => reject(
          new DOMException('aborted', 'AbortError')
        ));
      });
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountSurfView(container, manifest, {
      lazy: false,
      fetcher: fetcher as typeof fetch
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    handle.dispose();
    await expect(handle.ready).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchSignal?.aborted).toBe(true);
    expect(container.childElementCount).toBe(0);
  });

  it('rejects ready with the mount failure even when the onError observer throws', async () => {
    const manifest = manifestFixture();
    for (const asset of Object.values(manifest.assets)) {
      delete asset.data;
      delete asset.encoding;
      asset.uri = `${asset.id}.bin`;
    }
    const mountFailure = new Error('fixture asset unavailable');
    const onError = vi.fn(() => {
      throw new Error('observer failed');
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountSurfView(container, manifest, {
      lazy: false,
      fetcher: vi.fn(async () => {
        throw mountFailure;
      }) as typeof fetch,
      onError
    });

    await expect(handle.ready).rejects.toBe(mountFailure);
    expect(onError).toHaveBeenCalledWith(mountFailure);
    expect(handle.viewer).toBeNull();
    expect(handle.controlTarget).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain('fixture asset unavailable');

    handle.dispose();
    expect(container.childElementCount).toBe(0);
  });
});
