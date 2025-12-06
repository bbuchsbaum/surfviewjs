import React from 'react';
import { ViewerConfig, LayerUpdateData, LayerUpdateDefinition, LayerDefinition, SurfaceData } from './types';
import NeuroSurfaceViewer from './NeuroSurfaceViewer';
import { NeuroSurface } from './classes';
import { Layer } from './layers';
import { ClearLayersOptions } from './MultiLayerNeuroSurface';

export interface NeuroSurfaceViewerProps {
  width?: number;
  height?: number;
  config?: ViewerConfig;
  viewpoint?: string;
  className?: string;
  style?: React.CSSProperties;
  onReady?: (viewer: NeuroSurfaceViewer) => void;
  onError?: (error: Error) => void;
  onSurfaceClick?: (event: any) => void;
  children?: React.ReactNode;
}

export interface NeuroSurfaceViewerRef {
  viewer: NeuroSurfaceViewer | null;
  addSurface: (surface: NeuroSurface, id?: string) => void;
  removeSurface: (id: string) => void;
  getSurface: (id: string) => NeuroSurface | undefined;
  addLayer: (surfaceId: string, layer: Layer) => void;
  removeLayer: (surfaceId: string, layerId: string) => void;
  clearLayers: (surfaceId: string, options?: ClearLayersOptions) => void;
  updateLayer: (surfaceId: string, layerId: string, updates: LayerUpdateData) => void;
  updateLayers: (surfaceId: string, updates: LayerUpdateDefinition[]) => void;
  setViewpoint: (viewpoint: string) => void;
  centerCamera: () => void;
  resetCamera: () => void;
  toggleControls: (show?: boolean) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

export interface SurfaceState {
  id: string;
  type: string;
  layers: Map<string, any>;
}

export interface UseNeuroSurfaceReturn {
  surfaces: Map<string, SurfaceState>;
  addSurface: (surfaceData: SurfaceData, id?: string) => string | null;
  removeSurface: (surfaceId: string) => void;
  addLayer: (surfaceId: string, layerData: LayerDefinition) => string | null;
  updateLayer: (surfaceId: string, layerId: string, updates: LayerUpdateData) => void;
  removeLayer: (surfaceId: string, layerId: string) => void;
  clearLayers: (surfaceId: string, options?: ClearLayersOptions) => void;
  updateLayersFromBackend: (surfaceId: string, layerUpdates: LayerUpdateDefinition[]) => void;
  setLayerOrder: (surfaceId: string, layerIds: string[]) => void;
}

export declare function useNeuroSurface(
  viewerRef: React.RefObject<NeuroSurfaceViewerRef>
): UseNeuroSurfaceReturn;

export { default as NeuroSurfaceViewerReact } from './react/NeuroSurfaceViewer.jsx';
export { SurfaceHelpers } from './react/SurfaceHelpers';

declare const _default: React.ForwardRefExoticComponent<
  NeuroSurfaceViewerProps & React.RefAttributes<NeuroSurfaceViewerRef>
>;
export default _default;
