import { ColorMap } from './ColorMap';
import * as THREE from 'three';

export type BlendMode = 'normal' | 'additive' | 'multiply';

export interface LayerConfig {
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  order?: number;
}

export interface DataLayerConfig extends LayerConfig {
  range?: [number, number];
  threshold?: [number, number];
}

export declare abstract class Layer {
  id: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  order: number;
  needsUpdate: boolean;
  private static _outlineCtor;

  constructor(id: string, config?: LayerConfig);
  
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  setBlendMode(mode: BlendMode): void;
  abstract getRGBAData(vertexCount: number): Float32Array;
  abstract update(data: any): void;
  dispose(): void;
  static registerOutlineLayer(ctor: any): void;
  static fromConfig(config: Record<string, any>): Layer;
}

export declare class RGBALayer extends Layer {
  rgbaData: Float32Array;

  constructor(id: string, rgbaData: Float32Array | number[], config?: LayerConfig);
  
  setRGBAData(rgbaData: Float32Array | number[]): void;
  getRGBAData(vertexCount: number): Float32Array;
  update(data: {
    rgbaData?: Float32Array | number[];
    opacity?: number;
    visible?: boolean;
    blendMode?: BlendMode;
  }): void;
}

export declare class DataLayer extends Layer {
  data: Float32Array;
  indices: Uint32Array;
  colorMap: ColorMap;
  range: [number, number];
  threshold: [number, number];

  constructor(
    id: string,
    data: Float32Array | number[],
    indices: Uint32Array | number[] | null,
    colorMap: string | ColorMap | string[],
    config?: DataLayerConfig
  );
  
  setData(data: Float32Array | number[], indices?: Uint32Array | number[] | null): void;
  getData(): Float32Array | null;
  setColorMap(colorMap: string | ColorMap | string[]): void;
  setRange(range: [number, number]): void;
  setThreshold(threshold: [number, number]): void;
  getRGBAData(vertexCount: number): Float32Array;
  update(updates: {
    data?: Float32Array | number[];
    indices?: Uint32Array | number[];
    colorMap?: string | ColorMap | string[];
    range?: [number, number];
    threshold?: [number, number];
    opacity?: number;
    visible?: boolean;
    blendMode?: BlendMode;
  }): void;
  dispose(): void;
}

export declare class BaseLayer extends Layer {
  color: number;

  constructor(color?: number, config?: LayerConfig);
  
  setColor(color: number): void;
  getRGBAData(vertexCount: number): Float32Array;
  update(updates: {
    color?: number;
    opacity?: number;
    visible?: boolean;
  }): void;
}

export interface LabelLayerOptions extends LayerConfig {
  labels: Uint32Array | number[];
  labelDefs: Array<{ id: number; color: THREE.ColorRepresentation; name?: string }>;
  defaultColor?: THREE.ColorRepresentation;
}

export declare class LabelLayer extends Layer {
  constructor(id: string, options: LabelLayerOptions);
  setLabels(labels: Uint32Array | number[]): void;
  setLabelDefs(labelDefs: Array<{ id: number; color: THREE.ColorRepresentation }>): void;
  getRGBAData(vertexCount: number): Float32Array;
  update(data: LabelLayerOptions & {
    opacity?: number;
    visible?: boolean;
    blendMode?: BlendMode;
  }): void;
}

export declare class LayerStack {
  layers: Map<string, Layer>;
  layerOrder: string[];
  needsComposite: boolean;

  constructor();
  
  addLayer(layer: Layer): void;
  removeLayer(id: string): boolean;
  getLayer(id: string): Layer | undefined;
  updateLayer(id: string, updates: any): void;
  setLayerOrder(ids: string[]): void;
  updateLayerOrder(): void;
  getVisibleLayers(): Layer[];
  getAllLayers(): Layer[];
  clear(): void;
  dispose(): void;
}

export interface OutlineLayerOptions extends LayerConfig {
  roiLabels: Uint32Array | Int32Array | number[];
  color?: number | string;
  width?: number;
  halo?: boolean;
  haloColor?: number | string;
  haloWidth?: number;
  offset?: number;
  roiSubset?: number[] | null;
}

export declare class OutlineLayer extends Layer {
  roiLabels: Uint32Array;
  color: number;
  width: number;
  halo: boolean;
  haloColor: number;
  haloWidth: number;
  offset: number;
  roiSubset: number[] | null;
  lineObject: THREE.Object3D | null;
  haloObject: THREE.Object3D | null;

  constructor(id: string, options: OutlineLayerOptions);
  getRGBAData(vertexCount: number): Float32Array;
  update(update: Partial<OutlineLayerOptions>): void;
  dispose(): void;
}
