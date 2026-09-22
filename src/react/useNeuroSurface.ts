import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  MultiLayerNeuroSurface,
  NeuroSurfaceViewer as CoreViewer
} from '../index';
import type {
  ColorMappedNeuroSurface,
  NeuroSurface,
  SurfaceConfig,
  VertexColoredNeuroSurface
} from '../classes';
import type {
  ClearLayersOptions,
  LayerUpdate,
  MultiLayerSurfaceConfig
} from '../MultiLayerNeuroSurface';
import type {
  DataLayer,
  DataLayerConfig,
  Layer,
  LayerConfig,
  LayerOrderResult
} from '../layers';
import type {
  NeuroSurfaceViewerHandle
} from './NeuroSurfaceViewer';
import { SurfaceHelpers } from './NeuroSurfaceViewer';

type NumericData = Float32Array | number[];
type IndexData = Uint32Array | number[];

interface SurfaceDataBase {
  readonly vertices: NumericData;
  readonly faces: IndexData;
  readonly hemisphere?: string;
  readonly vertexCurv?: NumericData | null;
}

export interface MultiLayerSurfaceData extends SurfaceDataBase {
  readonly type?: 'multi-layer';
  readonly config?: MultiLayerSurfaceConfig;
}

export interface ColorMappedSurfaceData extends SurfaceDataBase {
  readonly type: 'color-mapped';
  readonly indices?: IndexData | null;
  readonly data: NumericData;
  readonly colorMap: ConstructorParameters<typeof ColorMappedNeuroSurface>[3];
  readonly config?: SurfaceConfig;
}

export interface VertexColoredSurfaceData extends SurfaceDataBase {
  readonly type: 'vertex-colored';
  readonly indices?: IndexData | null;
  readonly colors: ConstructorParameters<typeof VertexColoredNeuroSurface>[2];
  readonly config?: SurfaceConfig;
}

export type NeuroSurfaceData =
  | MultiLayerSurfaceData
  | ColorMappedSurfaceData
  | VertexColoredSurfaceData;

interface LayerDataBase {
  readonly id?: string;
}

export interface RGBALayerData extends LayerDataBase {
  readonly type: 'rgba';
  readonly rgbaData: NumericData;
  readonly config?: LayerConfig;
}

export interface ScalarLayerData extends LayerDataBase {
  readonly type: 'data';
  readonly data: NumericData;
  readonly indices?: IndexData | null;
  readonly colorMap: ConstructorParameters<typeof DataLayer>[3];
  readonly config?: DataLayerConfig;
}

export interface BaseLayerData extends LayerDataBase {
  readonly type: 'base';
  readonly color?: number;
  readonly config?: LayerConfig;
}

export type NeuroSurfaceLayerData =
  | RGBALayerData
  | ScalarLayerData
  | BaseLayerData;

export interface ManagedLayerUpdate {
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly [property: string]: unknown;
}

export type BackendLayerUpdate = Readonly<Omit<LayerUpdate, 'data'>> & {
  readonly data?: Float32Array;
  readonly rgbaData?: Float32Array;
};

export type ManagedSurfaceType =
  | 'multi-layer'
  | 'color-mapped'
  | 'vertex-colored';

export type ManagedLayerType = NonNullable<LayerUpdate['type']>;

export interface ManagedLayerState {
  readonly id: string;
  readonly type: ManagedLayerType;
  readonly visible: boolean;
  readonly opacity: number;
}

export interface ManagedSurfaceState {
  readonly id: string;
  readonly type: ManagedSurfaceType;
  readonly layers: ReadonlyMap<string, ManagedLayerState>;
}

export type NeuroSurfaceViewerRef = RefObject<
  CoreViewer | NeuroSurfaceViewerHandle | null
>;

export interface UseNeuroSurfaceOptions {
  readonly onError?: (error: Error) => void;
}

export interface UseNeuroSurfaceResult {
  readonly surfaces: ReadonlyMap<string, ManagedSurfaceState>;
  readonly error: Error | null;
  readonly clearError: () => void;
  readonly addSurface: (surfaceData: NeuroSurfaceData, id?: string) => string | null;
  readonly removeSurface: (surfaceId: string) => void;
  readonly addLayer: (
    surfaceId: string,
    layerData: NeuroSurfaceLayerData
  ) => string | null;
  readonly updateLayer: (
    surfaceId: string,
    layerId: string,
    updates: ManagedLayerUpdate
  ) => void;
  readonly removeLayer: (surfaceId: string, layerId: string) => void;
  readonly clearLayers: (
    surfaceId: string,
    options?: ClearLayersOptions
  ) => void;
  readonly updateLayersFromBackend: (
    surfaceId: string,
    layerUpdates: readonly BackendLayerUpdate[]
  ) => void;
  readonly setLayerOrder: (
    surfaceId: string,
    layerIds: readonly string[]
  ) => LayerOrderResult | null;
}

function resolveViewer(viewerRef: NeuroSurfaceViewerRef): CoreViewer | null {
  const current = viewerRef.current;
  if (!current) return null;
  return 'viewer' in current ? current.viewer : current;
}

function updateManagedLayers(
  previous: ReadonlyMap<string, ManagedSurfaceState>,
  surfaceId: string,
  update: (layers: Map<string, ManagedLayerState>) => void
): ReadonlyMap<string, ManagedSurfaceState> {
  const surface = previous.get(surfaceId);
  if (!surface) return previous;
  const layers = new Map(surface.layers);
  update(layers);
  const next = new Map(previous);
  next.set(surfaceId, { ...surface, layers });
  return next;
}

function normalizeError(context: string, error: unknown): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  const normalized = new Error(`${context}: ${cause.message}`);
  (normalized as Error & { cause?: unknown }).cause = cause;
  return normalized;
}

/**
 * Manage surfaces and layers attached to a core viewer or React viewer handle.
 * Hook state is an immutable snapshot; Three.js objects remain owned by the viewer.
 */
export function useNeuroSurface(
  viewerRef: NeuroSurfaceViewerRef,
  options: UseNeuroSurfaceOptions = {}
): UseNeuroSurfaceResult {
  const [surfaces, setSurfaces] = useState<ReadonlyMap<string, ManagedSurfaceState>>(
    () => new Map()
  );
  const [error, setError] = useState<Error | null>(null);
  const surfaceIdCounter = useRef(0);
  const layerIdCounter = useRef(0);
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const reportError = useCallback((context: string, cause: unknown): void => {
    const nextError = normalizeError(context, cause);
    setError(nextError);
    onErrorRef.current?.(nextError);
  }, []);

  const clearError = useCallback((): void => setError(null), []);

  const addSurface = useCallback((
    surfaceData: NeuroSurfaceData,
    id?: string
  ): string | null => {
    const viewer = resolveViewer(viewerRef);
    if (!viewer) return null;
    const surfaceId = id ?? `surface-${surfaceIdCounter.current++}`;

    try {
      const geometry = SurfaceHelpers.createGeometry(
        surfaceData.vertices,
        surfaceData.faces,
        surfaceData.hemisphere ?? 'unknown',
        surfaceData.vertexCurv
      );
      let surface: NeuroSurface | undefined;
      switch (surfaceData.type) {
        case 'color-mapped':
          surface = SurfaceHelpers.createColorMappedSurface(
            geometry,
            surfaceData.indices ?? null,
            surfaceData.data,
            surfaceData.colorMap,
            surfaceData.config
          );
          break;
        case 'vertex-colored':
          surface = SurfaceHelpers.createVertexColoredSurface(
            geometry,
            surfaceData.indices ?? null,
            surfaceData.colors,
            surfaceData.config
          );
          break;
        case 'multi-layer':
        case undefined:
          surface = SurfaceHelpers.createMultiLayerSurface(
            geometry,
            surfaceData.config
          );
          break;
      }

      if (!surface) {
        throw new TypeError(`Unsupported surface type: ${String(surfaceData.type)}`);
      }

      viewer.addSurface(surface, surfaceId);
      if (viewer.surfaces.get(surfaceId) !== surface) {
        surface.dispose();
        throw new Error(`viewer rejected surface "${surfaceId}"`);
      }
      const type = surfaceData.type ?? 'multi-layer';
      setSurfaces(previous => {
        const next = new Map(previous);
        next.set(surfaceId, { id: surfaceId, type, layers: new Map() });
        return next;
      });
      return surfaceId;
    } catch (cause) {
      reportError('Failed to add surface', cause);
      return null;
    }
  }, [reportError, viewerRef]);

  const removeSurface = useCallback((surfaceId: string): void => {
    const viewer = resolveViewer(viewerRef);
    if (!viewer) return;
    viewer.removeSurface(surfaceId);
    setSurfaces(previous => {
      if (!previous.has(surfaceId)) return previous;
      const next = new Map(previous);
      next.delete(surfaceId);
      return next;
    });
  }, [viewerRef]);

  const addLayer = useCallback((
    surfaceId: string,
    layerData: NeuroSurfaceLayerData
  ): string | null => {
    const viewer = resolveViewer(viewerRef);
    if (!viewer) return null;
    const surface = viewer.surfaces.get(surfaceId);
    if (!(surface instanceof MultiLayerNeuroSurface)) return null;

    try {
      const requestedId = layerData.id ?? `layer-${layerIdCounter.current++}`;
      let layer: Layer;
      switch (layerData.type) {
        case 'rgba':
          layer = SurfaceHelpers.createRGBALayer(
            requestedId,
            layerData.rgbaData,
            layerData.config
          );
          break;
        case 'data':
          layer = SurfaceHelpers.createDataLayer(
            requestedId,
            layerData.data,
            layerData.indices ?? null,
            layerData.colorMap,
            layerData.config
          );
          break;
        case 'base':
          layer = SurfaceHelpers.createBaseLayer(
            layerData.color,
            layerData.config
          );
          break;
      }

      surface.addLayer(layer);
      viewer.requestRender();
      const layerId = layer.id;
      setSurfaces(previous => updateManagedLayers(previous, surfaceId, layers => {
        layers.set(layerId, {
          id: layerId,
          type: layerData.type,
          visible: layer.visible,
          opacity: layer.opacity
        });
      }));
      return layerId;
    } catch (cause) {
      reportError('Failed to add layer', cause);
      return null;
    }
  }, [reportError, viewerRef]);

  const updateLayer = useCallback((
    surfaceId: string,
    layerId: string,
    updates: ManagedLayerUpdate
  ): void => {
    const viewer = resolveViewer(viewerRef);
    if (!viewer) return;
    const surface = viewer.surfaces.get(surfaceId);
    if (!(surface instanceof MultiLayerNeuroSurface)) return;
    try {
      surface.updateLayer(layerId, { ...updates });
      viewer.requestRender();
      setSurfaces(previous => updateManagedLayers(previous, surfaceId, layers => {
        const layer = layers.get(layerId);
        if (!layer) return;
        layers.set(layerId, {
          ...layer,
          visible: updates.visible ?? layer.visible,
          opacity: updates.opacity ?? layer.opacity
        });
      }));
    } catch (cause) {
      reportError('Failed to update layer', cause);
    }
  }, [reportError, viewerRef]);

  const removeLayer = useCallback((surfaceId: string, layerId: string): void => {
    const viewer = resolveViewer(viewerRef);
    if (!viewer) return;
    const surface = viewer.surfaces.get(surfaceId);
    if (!(surface instanceof MultiLayerNeuroSurface)) return;
    surface.removeLayer(layerId);
    viewer.requestRender();
    setSurfaces(previous => updateManagedLayers(previous, surfaceId, layers => {
      layers.delete(layerId);
    }));
  }, [viewerRef]);

  const clearLayers = useCallback((
    surfaceId: string,
    clearOptions: ClearLayersOptions = {}
  ): void => {
    const viewer = resolveViewer(viewerRef);
    if (!viewer) return;
    const surface = viewer.surfaces.get(surfaceId);
    if (!(surface instanceof MultiLayerNeuroSurface)) return;
    surface.clearLayers(clearOptions);
    viewer.requestRender();
    const includeBase = clearOptions.includeBase ?? false;
    setSurfaces(previous => updateManagedLayers(previous, surfaceId, layers => {
      for (const [layerId, layer] of layers) {
        if (!includeBase && layer.type === 'base') continue;
        layers.delete(layerId);
      }
    }));
  }, [viewerRef]);

  const updateLayersFromBackend = useCallback((
    surfaceId: string,
    layerUpdates: readonly BackendLayerUpdate[]
  ): void => {
    const viewer = resolveViewer(viewerRef);
    if (!viewer) return;
    const surface = viewer.surfaces.get(surfaceId);
    if (!(surface instanceof MultiLayerNeuroSurface)) return;

    try {
      const normalized = layerUpdates.map((update): LayerUpdate => {
        const { rgbaData, ...rest } = update;
        if (update.type === 'rgba' && update.data === undefined && rgbaData !== undefined) {
          return { ...rest, data: rgbaData };
        }
        return { ...rest };
      });
      surface.updateLayers(normalized);
      viewer.requestRender();

      setSurfaces(previous => updateManagedLayers(previous, surfaceId, layers => {
        for (const update of layerUpdates) {
          const existing = layers.get(update.id);
          if (update.type) {
            layers.set(update.id, {
              id: update.id,
              type: update.type,
              visible: update.visible ?? true,
              opacity: update.opacity ?? 1
            });
          } else if (existing) {
            layers.set(update.id, {
              ...existing,
              visible: update.visible ?? existing.visible,
              opacity: update.opacity ?? existing.opacity
            });
          }
        }
      }));
    } catch (cause) {
      reportError('Failed to update layers', cause);
    }
  }, [reportError, viewerRef]);

  const setLayerOrder = useCallback((
    surfaceId: string,
    layerIds: readonly string[]
  ): LayerOrderResult | null => {
    const viewer = resolveViewer(viewerRef);
    return viewer?.setLayerOrder(surfaceId, layerIds) ?? null;
  }, [viewerRef]);

  return {
    surfaces,
    error,
    clearError,
    addSurface,
    removeSurface,
    addLayer,
    updateLayer,
    removeLayer,
    clearLayers,
    updateLayersFromBackend,
    setLayerOrder
  };
}
