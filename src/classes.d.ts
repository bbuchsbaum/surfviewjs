import * as THREE from 'three';
import { ColorMap, ColorMapName } from './ColorMap';

export type Hemisphere = 'left' | 'right' | 'both' | 'unknown';

export interface SurfaceConfig {
  color?: THREE.Color | number;
  flatShading?: boolean;
  shininess?: number;
  specularColor?: number;
  alpha?: number;
  baseColor?: number;
}

export declare class SurfaceGeometry {
  vertices: Float32Array;
  faces: Uint32Array;
  hemi: Hemisphere;
  hemisphere: Hemisphere;
  vertexCurv: Float32Array | null;
  mesh: THREE.Mesh | null;

  constructor(
    vertices: Float32Array | number[],
    faces: Uint32Array | number[],
    hemi: Hemisphere,
    vertexCurv?: Float32Array | number[] | null
  );
  
  createMesh(): void;
  dispose(): void;
}

export declare class NeuroSurface {
  geometry: SurfaceGeometry;
  indices: Uint32Array;
  data: Float32Array;
  vertexCurv: Float32Array | null;
  mesh: THREE.Mesh | null;
  threshold: [number, number];
  irange: [number, number];
  hemisphere: Hemisphere;
  config: SurfaceConfig;

  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[],
    data: Float32Array | number[],
    config?: SurfaceConfig
  );
  
  update(property: string, value: any): void;
  updateConfig(newConfig: SurfaceConfig): void;
  createMesh(): THREE.Mesh;
  updateMesh(): THREE.Mesh;
  updateColors(): void;
  dispose(): void;
  removeColorMapListeners(): void;
}

export declare class ColorMappedNeuroSurface extends NeuroSurface {
  colorMap: ColorMap;
  rangeListener: (() => void) | null;
  thresholdListener: (() => void) | null;

  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[],
    data: Float32Array | number[],
    colorMap: ColorMapName | string | ColorMap | string[],
    config?: SurfaceConfig
  );
  
  setColorMap(colorMap: ColorMapName | string | ColorMap | string[]): void;
  setData(newData: Float32Array | number[]): void;
  removeColorMapListeners(): void;
  dispose(): void;
}

export declare class VertexColoredNeuroSurface extends NeuroSurface {
  colors: Float32Array;

  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[],
    colors: (number | string | THREE.Color)[],
    config?: SurfaceConfig
  );
  
  setColors(newColors: (number | string | THREE.Color)[]): void;
}

export declare class MultiLayerNeuroSurface extends NeuroSurface {
  layerStack: import('./layers').LayerStack;
  compositeBuffer: Float32Array;
  vertexCount: number;
  _updatePending: boolean;

  constructor(geometry: SurfaceGeometry, config?: SurfaceConfig & { baseColor?: number });
  
  addLayer(layer: import('./layers').Layer): void;
  removeLayer(id: string): boolean;
  clearLayers(options?: import('./MultiLayerNeuroSurface').ClearLayersOptions): void;
  updateLayer(id: string, updates: any): void;
  getLayer(id: string): import('./layers').Layer | undefined;
  setLayerOrder(ids: string[]): void;
  updateLayers(updates: import('./types').LayerUpdateDefinition[]): void;
  requestColorUpdate(): void;
  updateColors(): void;
  dispose(): void;
}
