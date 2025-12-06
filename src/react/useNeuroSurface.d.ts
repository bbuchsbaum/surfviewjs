import React from 'react';
import { NeuroSurfaceViewerRef } from './NeuroSurfaceViewer';
import { ClearLayersOptions } from '../MultiLayerNeuroSurface';
import { SurfaceData, LayerDefinition, LayerUpdateData, LayerUpdateDefinition } from '../types';

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
