import React from 'react';
import { ViewerConfig, SurfaceClickEvent } from '../types';
import NeuroSurfaceViewer from '../NeuroSurfaceViewer';

export interface NeuroSurfaceViewerProps {
  width?: number;
  height?: number;
  config?: ViewerConfig;
  viewpoint?: string;
  className?: string;
  style?: React.CSSProperties;
  onReady?: (viewer: NeuroSurfaceViewer) => void;
  onError?: (error: Error) => void;
  onSurfaceClick?: (event: SurfaceClickEvent) => void;
  children?: React.ReactNode;
}

export interface NeuroSurfaceViewerRef {
  viewer: NeuroSurfaceViewer | null;
  addSurface: (surface: import('../classes').NeuroSurface, id: string) => void;
  removeSurface: (id: string) => void;
  getSurface: (id: string) => import('../classes').NeuroSurface | undefined;
  addLayer: (surfaceId: string, layer: import('../layers').Layer) => void;
  removeLayer: (surfaceId: string, layerId: string) => void;
  clearLayers: (surfaceId: string, options?: import('../MultiLayerNeuroSurface').ClearLayersOptions) => void;
  updateLayer: (surfaceId: string, layerId: string, updates: import('../types').LayerUpdateData) => void;
  updateLayers: (surfaceId: string, updates: import('../types').LayerUpdateDefinition[]) => void;
  setViewpoint: (viewpoint: string) => void;
  centerCamera: () => void;
  resetCamera: () => void;
  toggleControls: (show?: boolean) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

declare const NeuroSurfaceViewerReact: React.ForwardRefExoticComponent<
  NeuroSurfaceViewerProps & React.RefAttributes<NeuroSurfaceViewerRef>
>;

export default NeuroSurfaceViewerReact;
