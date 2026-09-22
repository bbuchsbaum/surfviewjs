/**
 * @vitest-environment jsdom
 */
import React, { StrictMode, createRef } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import type { NeuroSurfaceViewer as CoreViewer } from '../../src';
import type { SurfacePickEvent } from '../../src/events/ViewerEvents';

interface MockViewer {
  surfaces: Map<string, unknown>;
  onSurfaceClick?: (event: SurfacePickEvent) => void;
  startRenderLoop: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  setViewpoint: ReturnType<typeof vi.fn>;
  requestRender: ReturnType<typeof vi.fn>;
}

const mockViewerState = vi.hoisted(() => ({
  instances: [] as MockViewer[],
  throwOnConstruct: false
}));

vi.mock('../../src/NeuroSurfaceViewer', () => {
  class NeuroSurfaceViewer {
    surfaces = new Map<string, unknown>();
    onSurfaceClick?: (event: SurfacePickEvent) => void;
    startRenderLoop = vi.fn();
    stop = vi.fn();
    dispose = vi.fn();
    resize = vi.fn();
    setViewpoint = vi.fn();
    requestRender = vi.fn();
    removeSurface = vi.fn((id: string) => this.surfaces.delete(id));
    addSurface = vi.fn((surface: unknown, id = `surface-${this.surfaces.size}`) => {
      this.surfaces.set(id, surface);
    });
    removeLayer = vi.fn();
    clearLayers = vi.fn();
    setLayerOrder = vi.fn(() => ({ ok: true, changed: false, order: [] }));
    centerCamera = vi.fn();
    resetCamera = vi.fn();
    setInteractionEnabled = vi.fn();
    toggleControls = vi.fn();

    constructor() {
      if (mockViewerState.throwOnConstruct) {
        throw new Error('viewer construction failed');
      }
      mockViewerState.instances.push(this);
    }
  }

  return { NeuroSurfaceViewer };
});

import {
  MultiLayerNeuroSurface,
  NeuroSurfaceViewerReact,
  SurfaceHelpers,
  useNeuroSurface
} from '../../src/index.react';
import type {
  NeuroSurfaceViewerHandle,
  UseNeuroSurfaceResult
} from '../../src/index.react';

async function render(root: Root, node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

beforeEach(() => {
  mockViewerState.instances.length = 0;
  mockViewerState.throwOnConstruct = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('legacy React public entry', () => {
  it('survives StrictMode, updates callbacks and exact dimensions, and disposes once', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const viewerRef = createRef<NeuroSurfaceViewerHandle>();
    const firstClick = vi.fn();
    const nextClick = vi.fn();
    const firstReady = vi.fn();
    const nextReady = vi.fn();
    let didUnmount = false;

    try {
      await render(root, (
        <StrictMode>
          <NeuroSurfaceViewerReact
            ref={viewerRef}
            width={640}
            height={480}
            viewpoint="lateral"
            onReady={firstReady}
            onSurfaceClick={firstClick}
          />
        </StrictMode>
      ));

      expect(mockViewerState.instances.length).toBeGreaterThanOrEqual(2);
      const liveViewer = mockViewerState.instances.at(-1)!;
      for (const disposed of mockViewerState.instances.slice(0, -1)) {
        expect(disposed.stop).toHaveBeenCalledTimes(1);
        expect(disposed.dispose).toHaveBeenCalledTimes(1);
      }
      expect(liveViewer.dispose).not.toHaveBeenCalled();
      expect(viewerRef.current?.viewer).toBe(liveViewer);

      const instanceCount = mockViewerState.instances.length;
      await render(root, (
        <StrictMode>
          <NeuroSurfaceViewerReact
            ref={viewerRef}
            width={0}
            height={0}
            viewpoint="medial"
            onReady={nextReady}
            onSurfaceClick={nextClick}
          />
        </StrictMode>
      ));

      expect(mockViewerState.instances).toHaveLength(instanceCount);
      expect(liveViewer.resize).toHaveBeenLastCalledWith(0, 0);
      expect(liveViewer.setViewpoint).toHaveBeenLastCalledWith('medial');
      const click: SurfacePickEvent = {
        surfaceId: 'lh',
        point: null,
        vertexIndex: 0
      };
      liveViewer.onSurfaceClick?.(click);
      expect(nextClick).toHaveBeenCalledExactlyOnceWith(click);
      expect(firstClick).not.toHaveBeenCalled();
      expect(nextReady).not.toHaveBeenCalled();

      const surface = SurfaceHelpers.createMultiLayerSurface(
        SurfaceHelpers.createGeometry(
          new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          new Uint32Array([0, 1, 2]),
          'lh'
        )
      );
      liveViewer.surfaces.set('lh', surface);
      const updateLayers = vi.spyOn(surface, 'updateLayers');
      const updates = [{
        id: 'activation',
        type: 'rgba' as const,
        data: new Float32Array(12)
      }];
      viewerRef.current?.updateLayers('lh', updates);
      expect(updateLayers).toHaveBeenCalledTimes(1);
      expect(updateLayers.mock.calls[0][0][0].data).toBe(updates[0].data);
      surface.dispose();

      viewerRef.current?.dispose();
      expect(liveViewer.stop).toHaveBeenCalledTimes(1);
      expect(liveViewer.dispose).toHaveBeenCalledTimes(1);

      await unmount(root);
      didUnmount = true;
      expect(liveViewer.dispose).toHaveBeenCalledTimes(1);
    } finally {
      if (!didUnmount) await unmount(root);
    }
  });

  it('reports construction failures as Error objects without exposing a handle', async () => {
    mockViewerState.throwOnConstruct = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const viewerRef = createRef<NeuroSurfaceViewerHandle>();
    const onError = vi.fn();
    try {
      await render(root, (
        <NeuroSurfaceViewerReact ref={viewerRef} onError={onError} />
      ));
      expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
      expect(viewerRef.current?.viewer).toBeNull();
    } finally {
      await unmount(root);
    }
  });
});

describe('useNeuroSurface', () => {
  it('uses the supported surface bulk API and preserves false, zero, empty, and typed data', async () => {
    // The mocked constructor is reached through the public React component.
    const bootstrapHost = document.createElement('div');
    document.body.appendChild(bootstrapHost);
    const bootstrapRoot = createRoot(bootstrapHost);
    const handleRef = createRef<NeuroSurfaceViewerHandle>();
    await render(bootstrapRoot, <NeuroSurfaceViewerReact ref={handleRef} />);
    const liveViewer = handleRef.current!.viewer as unknown as MockViewer;
    const viewerObjectRef = {
      current: liveViewer as unknown as CoreViewer
    } as RefObject<CoreViewer | null>;

    let hook: UseNeuroSurfaceResult | null = null;
    function Harness(): null {
      hook = useNeuroSurface(viewerObjectRef);
      return null;
    }
    const hookHost = document.createElement('div');
    document.body.appendChild(hookHost);
    const hookRoot = createRoot(hookHost);

    try {
      await render(hookRoot, <Harness />);
      let surfaceId: string | null = null;
      await act(async () => {
        surfaceId = hook!.addSurface({
          type: 'multi-layer',
          vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          faces: new Uint32Array([0, 1, 2]),
          hemisphere: ''
        }, 'lh');
      });
      expect(surfaceId).toBe('lh');

      const surface = liveViewer.surfaces.get('lh') as MultiLayerNeuroSurface;
      expect(surface).toBeInstanceOf(MultiLayerNeuroSurface);
      const batchSpy = vi.spyOn(surface, 'updateLayers');
      const rgba = new Float32Array([
        1, 0, 0, 1,
        0, 1, 0, 1,
        0, 0, 1, 1
      ]);

      await act(async () => {
        hook!.updateLayersFromBackend('lh', [{
          id: 'activation',
          type: 'rgba',
          rgbaData: rgba,
          opacity: 0,
          visible: false
        }]);
      });

      const normalized = batchSpy.mock.calls[0][0][0];
      expect(normalized.data).toBe(rgba);
      expect(normalized).not.toHaveProperty('rgbaData');
      const layer = hook!.surfaces.get('lh')!.layers.get('activation')!;
      expect(layer.opacity).toBe(0);
      expect(layer.visible).toBe(false);

      const updateLayerSpy = vi.spyOn(surface, 'updateLayer');
      await act(async () => {
        hook!.updateLayer('lh', 'activation', {
          opacity: 0,
          visible: false,
          label: ''
        });
      });
      const updated = hook!.surfaces.get('lh')!.layers.get('activation')!;
      expect(updated.opacity).toBe(0);
      expect(updated.visible).toBe(false);
      expect(updateLayerSpy).toHaveBeenCalledExactlyOnceWith(
        'activation',
        { opacity: 0, visible: false, label: '' }
      );
    } finally {
      await unmount(hookRoot);
      await unmount(bootstrapRoot);
    }
  });
});
