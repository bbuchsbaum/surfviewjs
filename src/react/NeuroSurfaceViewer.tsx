import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  BaseLayer,
  ColorMappedNeuroSurface,
  DataLayer,
  MultiLayerNeuroSurface,
  NeuroSurfaceViewer as CoreViewer,
  RGBALayer,
  SurfaceGeometry,
  VertexColoredNeuroSurface
} from '../index';
import type { NeuroSurface, SurfaceConfig } from '../classes';
import type { NeuroSurfaceViewerConfig } from '../NeuroSurfaceViewer';
import type {
  ClearLayersOptions,
  LayerUpdate,
  MultiLayerSurfaceConfig
} from '../MultiLayerNeuroSurface';
import type {
  DataLayerConfig,
  Layer,
  LayerConfig,
  LayerOrderResult
} from '../layers';
import type { SurfacePickEvent } from '../events/ViewerEvents';

export interface NeuroSurfaceViewerReactProps {
  readonly width?: number;
  readonly height?: number;
  /** Viewer configuration captured when this component mounts. */
  readonly config?: NeuroSurfaceViewerConfig;
  readonly viewpoint?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly onReady?: (viewer: CoreViewer) => void;
  readonly onSurfaceClick?: (event: SurfacePickEvent) => void;
  readonly onError?: (error: Error) => void;
  readonly children?: ReactNode;
}

export interface NeuroSurfaceViewerHandle {
  readonly viewer: CoreViewer | null;
  addSurface(surface: NeuroSurface, id?: string): void;
  removeSurface(id: string): void;
  getSurface(id: string): NeuroSurface | undefined;
  addLayer(surfaceId: string, layer: Layer): void;
  removeLayer(surfaceId: string, layerId: string): void;
  clearLayers(surfaceId: string, options?: ClearLayersOptions): void;
  updateLayer(
    surfaceId: string,
    layerId: string,
    updates: Readonly<Record<string, unknown>>
  ): void;
  updateLayers(surfaceId: string, updates: readonly LayerUpdate[]): void;
  setLayerOrder(surfaceId: string, layerIds: readonly string[]): LayerOrderResult;
  setViewpoint(viewpoint: string): void;
  centerCamera(): void;
  resetCamera(): void;
  setInteractionEnabled(enabled: boolean): void;
  /** @deprecated Controls UI is no longer owned by the viewer. */
  toggleControls(show?: boolean): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getMultiLayerSurface(
  viewer: CoreViewer | null,
  surfaceId: string
): MultiLayerNeuroSurface | null {
  const surface = viewer?.surfaces.get(surfaceId);
  return surface instanceof MultiLayerNeuroSurface ? surface : null;
}

/**
 * React owner for a single {@link CoreViewer}. The viewer is constructed once
 * per mount and disposed exactly once, including React StrictMode remounts.
 */
const NeuroSurfaceViewer = forwardRef<
  NeuroSurfaceViewerHandle,
  NeuroSurfaceViewerReactProps
>(function NeuroSurfaceViewer({
  width = 800,
  height = 600,
  config = {},
  viewpoint = 'lateral',
  className = '',
  style = {},
  onReady,
  onSurfaceClick,
  onError,
  children
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CoreViewer | null>(null);
  const disposedViewersRef = useRef(new WeakSet<CoreViewer>());
  const initialOptionsRef = useRef({ width, height, config, viewpoint });
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const disposeViewer = (viewer: CoreViewer): void => {
    if (disposedViewersRef.current.has(viewer)) return;
    disposedViewersRef.current.add(viewer);
    viewer.stop();
    viewer.dispose();
    if (viewerRef.current === viewer) viewerRef.current = null;
  };

  useImperativeHandle(ref, (): NeuroSurfaceViewerHandle => ({
    get viewer() {
      return viewerRef.current;
    },
    addSurface(surface, id) {
      viewerRef.current?.addSurface(surface, id);
    },
    removeSurface(id) {
      viewerRef.current?.removeSurface(id);
    },
    getSurface(id) {
      return viewerRef.current?.surfaces.get(id);
    },
    addLayer(surfaceId, layer) {
      const viewer = viewerRef.current;
      const surface = getMultiLayerSurface(viewer, surfaceId);
      if (!surface) return;
      surface.addLayer(layer);
      viewer?.requestRender();
    },
    removeLayer(surfaceId, layerId) {
      viewerRef.current?.removeLayer(surfaceId, layerId);
    },
    clearLayers(surfaceId, options) {
      viewerRef.current?.clearLayers(surfaceId, options);
    },
    updateLayer(surfaceId, layerId, updates) {
      const viewer = viewerRef.current;
      const surface = getMultiLayerSurface(viewer, surfaceId);
      if (!surface) return;
      surface.updateLayer(layerId, { ...updates });
      viewer?.requestRender();
    },
    updateLayers(surfaceId, updates) {
      const viewer = viewerRef.current;
      const surface = getMultiLayerSurface(viewer, surfaceId);
      if (!surface) return;
      surface.updateLayers(updates.map(update => ({ ...update })));
      viewer?.requestRender();
    },
    setLayerOrder(surfaceId, layerIds) {
      const viewer = viewerRef.current;
      if (!viewer) {
        return Object.freeze({
          ok: false,
          code: 'surface-not-found',
          message: `Surface "${surfaceId}" does not expose a layer stack.`
        });
      }
      return viewer.setLayerOrder(surfaceId, layerIds);
    },
    setViewpoint(nextViewpoint) {
      viewerRef.current?.setViewpoint(nextViewpoint);
    },
    centerCamera() {
      viewerRef.current?.centerCamera();
    },
    resetCamera() {
      viewerRef.current?.resetCamera();
    },
    setInteractionEnabled(enabled) {
      viewerRef.current?.setInteractionEnabled(enabled);
    },
    toggleControls(show) {
      viewerRef.current?.toggleControls(show);
    },
    resize(nextWidth, nextHeight) {
      viewerRef.current?.resize(nextWidth, nextHeight);
    },
    dispose() {
      const viewer = viewerRef.current;
      if (viewer) disposeViewer(viewer);
    }
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const initial = initialOptionsRef.current;
    let viewer: CoreViewer | null = null;
    try {
      viewer = new CoreViewer(
        container,
        initial.width,
        initial.height,
        initial.config,
        initial.viewpoint
      );
      viewerRef.current = viewer;
      viewer.onSurfaceClick = onSurfaceClick;
      viewer.startRenderLoop();
      onReadyRef.current?.(viewer);
    } catch (error) {
      if (viewer) disposeViewer(viewer);
      onErrorRef.current?.(toError(error));
    }

    return () => {
      if (viewer) disposeViewer(viewer);
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    viewer.onSurfaceClick = onSurfaceClick;
    return () => {
      if (viewer.onSurfaceClick === onSurfaceClick) {
        viewer.onSurfaceClick = undefined;
      }
    };
  }, [onSurfaceClick]);

  useEffect(() => {
    viewerRef.current?.resize(width, height);
  }, [width, height]);

  useEffect(() => {
    viewerRef.current?.setViewpoint(viewpoint);
  }, [viewpoint]);

  const classes = ['neurosurface-viewer', className].filter(Boolean).join(' ');
  return (
    <div
      ref={containerRef}
      className={classes}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        position: 'relative',
        ...style
      }}
    >
      {children}
    </div>
  );
});

NeuroSurfaceViewer.displayName = 'NeuroSurfaceViewer';

/** Strictly typed factories for the common React integration path. */
export const SurfaceHelpers = Object.freeze({
  createGeometry(
    vertices: Float32Array | number[],
    faces: Uint32Array | number[],
    hemisphere: string,
    vertexCurv: Float32Array | number[] | null = null
  ): SurfaceGeometry {
    return new SurfaceGeometry(vertices, faces, hemisphere, vertexCurv);
  },

  createMultiLayerSurface(
    geometry: SurfaceGeometry,
    config: MultiLayerSurfaceConfig = {}
  ): MultiLayerNeuroSurface {
    return new MultiLayerNeuroSurface(geometry, config);
  },

  createColorMappedSurface(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[] | null,
    data: Float32Array | number[],
    colorMap: ConstructorParameters<typeof ColorMappedNeuroSurface>[3],
    config: SurfaceConfig = {}
  ): ColorMappedNeuroSurface {
    return new ColorMappedNeuroSurface(geometry, indices, data, colorMap, config);
  },

  createVertexColoredSurface(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[] | null,
    colors: ConstructorParameters<typeof VertexColoredNeuroSurface>[2],
    config: SurfaceConfig = {}
  ): VertexColoredNeuroSurface {
    return new VertexColoredNeuroSurface(geometry, indices, colors, config);
  },

  createRGBALayer(
    id: string,
    rgbaData: Float32Array | number[],
    config: LayerConfig = {}
  ): RGBALayer {
    return new RGBALayer(id, rgbaData, config);
  },

  createDataLayer(
    id: string,
    data: Float32Array | number[],
    indices: Uint32Array | number[] | null,
    colorMap: ConstructorParameters<typeof DataLayer>[3],
    config: DataLayerConfig = {}
  ): DataLayer {
    return new DataLayer(id, data, indices, colorMap, config);
  },

  createBaseLayer(color = 0xcccccc, config: LayerConfig = {}): BaseLayer {
    return new BaseLayer(color, config);
  }
});

export default NeuroSurfaceViewer;
