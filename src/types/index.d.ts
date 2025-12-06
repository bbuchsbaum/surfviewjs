import * as THREE from 'three';

// Basic types
export type Hemisphere = 'left' | 'right' | 'both' | 'unknown';
export type BlendMode = 'normal' | 'additive' | 'multiply';
export type ColorMapName = 'jet' | 'hot' | 'cool' | 'spring' | 'summer' | 'autumn' | 'winter' | 
  'bone' | 'copper' | 'greys' | 'greens' | 'blues' | 'reds' | 'YIGnBu' | 'RdBu' | 
  'picnic' | 'rainbow' | 'portland' | 'blackbody' | 'earth' | 'electric' |
  'viridis' | 'inferno' | 'magma' | 'plasma' | 'warm' | 'bathymetry' |
  'cdom' | 'chlorophyll' | 'density' | 'freesurface-blue' | 'freesurface-red' |
  'oxygen' | 'par' | 'phase' | 'salinity' | 'temperature' | 'turbidity' |
  'velocity-blue' | 'velocity-green' | 'cubehelix';

// Configuration types
export interface ViewerConfig {
  showControls?: boolean;
  useControls?: boolean;
  ambientLightColor?: number;
  directionalLightColor?: number;
  directionalLightIntensity?: number;
  rotationSpeed?: number;
  initialZoom?: number;
  ssaoRadius?: number;
  ssaoKernelSize?: number;
  rimStrength?: number;
  metalness?: number;
  roughness?: number;
  useShaders?: boolean;
  useWideLines?: boolean;
  backgroundColor?: number;
  preset?: 'default' | 'presentation';
  linkHemispheres?: boolean;
  hoverCrosshair?: boolean;
  hoverCrosshairColor?: number;
  hoverCrosshairSize?: number;
  clickToAddAnnotation?: boolean;
}

export interface SurfaceConfig {
  color?: THREE.Color | number;
  flatShading?: boolean;
  shininess?: number;
  specularColor?: number;
  alpha?: number;
  baseColor?: number;
}

export interface LayerConfig {
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  order?: number;
  range?: [number, number];
  threshold?: [number, number];
}

export interface OutlineLayerOptions extends LayerConfig {
  roiLabels: Uint32Array | Int32Array | number[];
  color?: number | string | THREE.Color;
  width?: number;
  halo?: boolean;
  haloColor?: number | string | THREE.Color;
  haloWidth?: number;
  offset?: number;
  roiSubset?: number[] | null;
}

// Layer types
export interface LayerUpdateData {
  rgbaData?: Float32Array | number[];
  data?: Float32Array | number[];
  indices?: Uint32Array | number[];
  colorMap?: ColorMapName | string | ColorMap;
  opacity?: number;
  visible?: boolean;
  blendMode?: BlendMode;
  range?: [number, number];
  threshold?: [number, number];
  roiLabels?: Uint32Array | Int32Array | number[];
  width?: number;
  halo?: boolean;
  haloColor?: number | string | THREE.Color;
  haloWidth?: number;
  roiSubset?: number[] | null;
  offset?: number;
  labels?: Uint32Array | number[];
  labelDefs?: Array<{ id: number; color: THREE.ColorRepresentation; name?: string }>;
  defaultColor?: THREE.ColorRepresentation;
}

export interface LayerDefinition extends LayerUpdateData {
  id: string;
  type: 'base' | 'rgba' | 'data' | 'outline' | 'label';
  color?: number; // For base layer
  cmap?: ColorMapName | string; // For data layers
  roiLabels?: Uint32Array | Int32Array | number[]; // For outline
  width?: number;
  halo?: boolean;
  haloColor?: number | string | THREE.Color;
  haloWidth?: number;
  roiSubset?: number[] | null;
  offset?: number;
}

export type LayerUpdateDefinition = LayerUpdateData & {
  id: string;
  type?: LayerDefinition['type'];
};

export interface ClearLayersOptions {
  includeBase?: boolean;
}

export interface LabelLayerOptions extends LayerConfig {
  labels: Uint32Array | number[];
  labelDefs: Array<{ id: number; color: THREE.ColorRepresentation; name?: string }>;
  defaultColor?: THREE.ColorRepresentation;
}

export declare abstract class Layer {
  constructor(id: string, config?: LayerConfig);
  id: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  order: number;
  needsUpdate: boolean;
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  setBlendMode(mode: BlendMode): void;
  getRGBAData(vertexCount: number): Float32Array;
  update(data: LayerUpdateData): void;
  dispose(): void;
  static registerOutlineLayer(ctor: any): void;
  static fromConfig(config: Record<string, any>): Layer;
}

// Surface data types
export interface SurfaceData {
  type?: 'multi-layer' | 'color-mapped' | 'vertex-colored';
  vertices: Float32Array | number[];
  faces: Uint32Array | number[];
  hemisphere?: Hemisphere;
  vertexCurv?: Float32Array | number[];
  indices?: Uint32Array | number[];
  data?: Float32Array | number[];
  colors?: (number | string | THREE.Color)[];
  colorMap?: ColorMapName | string;
  surfaceSet?: SurfaceSet;
  variants?: Record<string, Float32Array | number[]>;
  defaultVariant?: string;
  curv?: Record<string, Float32Array | number[]>;
  config?: SurfaceConfig;
  layers?: LayerDefinition[];
}

export interface SurfaceDefinition extends SurfaceData {
  type: 'multi-layer' | 'color-mapped' | 'vertex-colored' | 'variant' | 'labeled';
}

export interface LabelDefinition {
  id: number;
  name: string;
  color: THREE.ColorRepresentation;
}

export declare class LabeledNeuroSurface extends NeuroSurface {
  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[] | null,
    labels: Uint32Array | number[],
    labelDefs: LabelDefinition[],
    config?: SurfaceConfig
  );
  labels: Uint32Array;
  labelMap: Map<number, { name: string; color: THREE.Color }>;
  colors: Float32Array;
  getLabelName(id: number): string | undefined;
  setLabelColor(id: number, color: THREE.ColorRepresentation): void;
  setLabels(labels: Uint32Array | number[]): void;
  addOrUpdateLabel(def: LabelDefinition): void;
}

// Event types
export interface SurfaceClickEvent {
  surfaceId: string;
  point: THREE.Vector3;
  face: THREE.Face3;
  faceIndex: number;
  distance: number;
}

// Main classes
export declare class SurfaceGeometry {
  constructor(
    vertices: Float32Array | number[],
    faces: Uint32Array | number[],
    hemi: Hemisphere,
    vertexCurv?: Float32Array | number[] | null
  );
  vertices: Float32Array;
  faces: Uint32Array;
  hemi: Hemisphere;
  hemisphere: Hemisphere;
  vertexCurv: Float32Array | null;
  mesh: THREE.Mesh | null;
  getVertexCount(): number;
  getBounds(): { min: THREE.Vector3; max: THREE.Vector3; center: THREE.Vector3; size: THREE.Vector3; radius: number };
  invalidateBounds(): void;
  createMesh(): void;
  dispose(): void;
}

export declare class Layer {
  constructor(id: string, config?: LayerConfig);
  id: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  order: number;
  needsUpdate: boolean;
  
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  setBlendMode(mode: BlendMode): void;
  getRGBAData(vertexCount: number): Float32Array;
  update(data: LayerUpdateData): void;
  dispose(): void;
  static registerOutlineLayer(ctor: any): void;
  static fromConfig(config: Record<string, any>): Layer;
}

export declare class RGBALayer extends Layer {
  constructor(id: string, rgbaData: Float32Array | number[], config?: LayerConfig);
  rgbaData: Float32Array;
  setRGBAData(rgbaData: Float32Array | number[]): void;
}

export declare class DataLayer extends Layer {
  constructor(
    id: string,
    data: Float32Array | number[],
    indices: Uint32Array | number[] | null,
    colorMap: ColorMapName | string | ColorMap,
    config?: LayerConfig & { range?: [number, number]; threshold?: [number, number] }
  );
  data: Float32Array;
  indices: Uint32Array;
  colorMap: ColorMap;
  range: [number, number];
  threshold: [number, number];
  
  setData(data: Float32Array | number[], indices?: Uint32Array | number[] | null): void;
  getData(): Float32Array | null;
  setColorMap(colorMap: ColorMapName | string | ColorMap): void;
  setRange(range: [number, number]): void;
  setThreshold(threshold: [number, number]): void;
}

export declare class BaseLayer extends Layer {
  constructor(color?: number, config?: LayerConfig);
  color: number;
  setColor(color: number): void;
}

export declare class LabelLayer extends Layer {
  constructor(id: string, options: LabelLayerOptions);
  setLabels(labels: Uint32Array | number[]): void;
  setLabelDefs(labelDefs: Array<{ id: number; color: THREE.ColorRepresentation }>): void;
  getRGBAData(vertexCount: number): Float32Array;
}

export declare class LayerStack {
  constructor();
  layers: Map<string, Layer>;
  layerOrder: string[];
  needsComposite: boolean;
  
  addLayer(layer: Layer): void;
  removeLayer(id: string): boolean;
  getLayer(id: string): Layer | undefined;
  updateLayer(id: string, updates: LayerUpdateData): void;
  setLayerOrder(ids: string[]): void;
  updateLayerOrder(): void;
  getVisibleLayers(): Layer[];
  getAllLayers(): Layer[];
  clear(): void;
  dispose(): void;
}

export declare class OutlineLayer extends Layer {
  constructor(id: string, options: OutlineLayerOptions);
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
  update(update: Partial<OutlineLayerOptions>): void;
  getRGBAData(vertexCount: number): Float32Array;
}

export declare class ColorMap {
  constructor(colors: (string | number[])[], options?: { range?: [number, number]; threshold?: [number, number]; alpha?: number | number[] });
  colors: number[][];
  range: [number, number];
  threshold: [number, number];
  hasAlpha: boolean;
  
  setRange(range: [number, number]): void;
  setThreshold(threshold: [number, number]): void;
  setAlpha(alpha?: number | number[]): void;
  getColor(value: number): number[];
  getColorArray(values: Float32Array | number[]): Float32Array;
  
  static fromPreset(name: ColorMapName, options?: { range?: [number, number]; threshold?: [number, number]; alpha?: number | number[] }): ColorMap;
   static fromArray(colors: (string | number[])[], options?: { range?: [number, number]; threshold?: [number, number]; alpha?: number | number[] }): ColorMap;
   static toHex(color: number | string): number;
  static getAvailableMaps(): string[];
}

export declare class NeuroSurface {
  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[],
    data: Float32Array | number[],
    config?: SurfaceConfig
  );
  geometry: SurfaceGeometry;
  indices: Uint32Array;
  data: Float32Array;
  vertexCurv: Float32Array | null;
  mesh: THREE.Mesh | null;
  threshold: [number, number];
  irange: [number, number];
  hemisphere: Hemisphere;
  config: SurfaceConfig;
  
  update(property: string, value: any): void;
  updateConfig(newConfig: SurfaceConfig): void;
  createMesh(): THREE.Mesh;
  updateMesh(): THREE.Mesh;
  updateColors(): void;
  dispose(): void;
}

export declare class ColorMappedNeuroSurface extends NeuroSurface {
  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[],
    data: Float32Array | number[],
    colorMap: ColorMapName | string | ColorMap,
    config?: SurfaceConfig
  );
  colorMap: ColorMap;
  
  setColorMap(colorMap: ColorMapName | string | ColorMap): void;
  setData(newData: Float32Array | number[]): void;
}

export declare class VertexColoredNeuroSurface extends NeuroSurface {
  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[],
    colors: (number | string | THREE.Color)[],
    config?: SurfaceConfig
  );
  colors: Float32Array;
  
  setColors(newColors: (number | string | THREE.Color)[]): void;
}

export declare class MultiLayerNeuroSurface extends NeuroSurface {
  constructor(geometry: SurfaceGeometry, config?: SurfaceConfig & { baseColor?: number; metalness?: number; roughness?: number; useGPUCompositing?: boolean; useWideLines?: boolean });
  layerStack: LayerStack;
  compositeBuffer: Float32Array;
  vertexCount: number;
  
  addLayer(layer: Layer): void;
  removeLayer(id: string): boolean;
  clearLayers(options?: ClearLayersOptions): void;
  updateLayer(id: string, updates: LayerUpdateData): void;
  updateLayerData(id: string, data: Float32Array | number[], indices?: Uint32Array | number[] | null): void;
  updateLayerVisibility(id: string, visible: boolean): void;
  getLayer(id: string): Layer | undefined;
  setLayerOrder(ids: string[]): void;
  updateLayers(updates: LayerUpdateDefinition[]): void;
  setWideLines(useWide: boolean): void;
  requestColorUpdate(): void;
  updateColors(): void;
}

export interface ViewerEventMap {
  'surface:added': { surface: NeuroSurface; id: string };
  'surface:removed': { surface: NeuroSurface; id: string };
  'surface:variant': { surfaceId: string; variant: string };
  'surface:colormap': { surfaceId: string; colormap: ColorMapName | string };
  'surface:click': { surfaceId: string | null; vertexIndex: number | null; point: THREE.Vector3 | null };
  'layer:added': { surface: MultiLayerNeuroSurface; layer: Layer };
  'layer:removed': { surface: MultiLayerNeuroSurface; layerId: string };
  'layer:updated': { surface: MultiLayerNeuroSurface; layer?: Layer };
  'layer:colormap': { surfaceId: string; layerId: string; colormap: ColorMapName | string };
  'layer:intensity': { surfaceId: string; layerId: string; range: [number, number] };
  'layer:threshold': { surfaceId: string; layerId: string; threshold: [number, number] };
  'layer:opacity': { surfaceId: string; layerId: string; opacity: number };
  'viewpoint:changed': { viewpoint: string };
  'render:before': void;
  'render:after': void;
  'render:needed': { surface: NeuroSurface };
  'annotation:added': { annotation: AnnotationRecord };
  'annotation:moved': { annotation: AnnotationRecord };
  'annotation:removed': { annotation: AnnotationRecord };
  'annotation:reset': {};
  'annotation:activated': { annotation: AnnotationRecord };
  'controls:changed': { enabled: boolean };
  'controls:error': { error: Error };
}

export interface SurfaceSetConfig {
  faces: Uint32Array | number[];
  hemi: string;
  defaultVariant: string;
  variants: Record<string, Float32Array | number[]>;
  curv?: Record<string, Float32Array | number[]>;
  meta?: Record<string, any>;
}

export declare class SurfaceSet {
  constructor(config: SurfaceSetConfig);
  faces: Uint32Array;
  hemi: string;
  defaultVariant: string;
  vertexCount: number;
  variants: Record<string, Float32Array>;
  curv: Record<string, Float32Array>;
  meta: Record<string, any>;
  getVariantNames(): string[];
  hasVariant(name: string): boolean;
  getPositions(name: string): Float32Array;
  getCurv(name: string): Float32Array | null;
}

export declare class VariantSurface extends MultiLayerNeuroSurface {
  constructor(surfaceSet: SurfaceSet, config?: SurfaceConfig & { baseColor?: number; metalness?: number; roughness?: number; useGPUCompositing?: boolean; useWideLines?: boolean });
  surfaceSet: SurfaceSet;
  currentVariant(): string;
  variantNames(): string[];
  setVariant(name: string, options?: { animate?: boolean; duration?: number; ease?: (t: number) => number }): void;
}

export declare class NeuroSurfaceViewer {
  constructor(
    container: HTMLElement,
    width: number,
    height: number,
    config?: ViewerConfig,
    viewpoint?: string
  );
  
  container: HTMLElement;
  width: number;
  height: number;
  config: ViewerConfig;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  surfaces: Map<string, NeuroSurface>;
  
  // Surface management
  addSurface(surface: NeuroSurface, id: string): void;
  removeSurface(id: string): void;
  getSurface(id: string): NeuroSurface | undefined;
  
  // Layer management
  addLayer(surfaceId: string, layer: Layer): void;
  removeLayer(surfaceId: string, layerId: string): void;
  clearLayers(surfaceId: string, options?: ClearLayersOptions): void;
  updateLayer(surfaceId: string, layerId: string, updates: LayerUpdateData): void;
  updateLayerData(surfaceId: string, layerId: string, data: Float32Array | number[], indices?: Uint32Array | number[] | null): void;
  updateLayerVisibility(surfaceId: string, layerId: string, visible: boolean): void;
  setLayerOrder(surfaceId: string, layerIds: string[]): void;
  updateLayers(surfaceId: string, updates: LayerUpdateDefinition[]): void;
  
  // Camera control
  setViewpoint(viewpoint: string): void;
  centerCamera(): void;
  resetCamera(): void;
  setZoom(distance: number, options?: { updateInitial?: boolean }): void;
  
  // Rendering
  startRenderLoop(): void;
  start(): void;
  stop(): void;
  animate(): void;
  requestRender(): void;
  resize(width: number, height: number, options?: { dpr?: number }): { width: number; height: number; dpr: number };
  
  // Picking
  pick(options?: { x?: number; y?: number; opacityThreshold?: number }): { surfaceId: string | null; vertexIndex: number | null; point: THREE.Vector3 | null };
  
  // Annotations
  addAnnotation(surfaceId: string, vertexIndex: number, data?: any, options?: AnnotationOptions): string | null;
  removeAnnotation(id: string): void;
  clearAnnotations(): void;
  activateAnnotation(id: string, options?: { exclusive?: boolean }): void;
  getAnnotation(id: string): AnnotationRecord | undefined;
  listAnnotations(surfaceId?: string): AnnotationRecord[];
  moveAnnotation(id: string, vertexIndex: number): boolean;
  removeAnnotations(surfaceId: string): void;
  
  // UI control
  toggleControls(show?: boolean): void;
  getControlsVisible(): boolean;
  
  // Data updates
  setData(id: string, newData: Float32Array | number[]): void;
  setVertexColors(id: string, colors: (number | string | THREE.Color)[]): void;
  
  // Crosshair marker
  showCrosshair(surfaceId: string, vertexIndex: number, options?: { size?: number; color?: number; mode?: 'selection' | 'hover' }): void;
  hideCrosshair(): void;
  toggleCrosshair(surfaceId?: string, vertexIndex?: number, options?: { size?: number; color?: number; mode?: 'selection' | 'hover' }): void;
  
  // Events
  onSurfaceClick?: (event: SurfaceClickEvent) => void;
  
  // Cleanup
  dispose(): void;
}

// React types
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
  addSurface: (surface: NeuroSurface, id: string) => void;
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
  showCrosshair: (surfaceId: string, vertexIndex: number, options?: { size?: number; color?: number; mode?: 'selection' | 'hover' }) => void;
  hideCrosshair: () => void;
  toggleCrosshair: (surfaceId?: string, vertexIndex?: number, options?: { size?: number; color?: number; mode?: 'selection' | 'hover' }) => void;
  addAnnotation: (surfaceId: string, vertexIndex: number, data?: any, options?: AnnotationOptions) => string | null;
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;
  listAnnotations: (surfaceId?: string) => AnnotationRecord[];
  moveAnnotation: (id: string, vertexIndex: number) => boolean;
  removeAnnotations: (surfaceId: string) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

export declare const NeuroSurfaceViewerReact: React.ForwardRefExoticComponent<
  NeuroSurfaceViewerProps & React.RefAttributes<NeuroSurfaceViewerRef>
>;

export interface UseNeuroSurfaceReturn {
  surfaces: Map<string, { id: string; type: string; layers: Map<string, any> }>;
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

export declare const SurfaceHelpers: {
  createGeometry: (
    vertices: Float32Array | number[],
    faces: Uint32Array | number[],
    hemisphere: Hemisphere,
    vertexCurv?: Float32Array | number[] | null
  ) => SurfaceGeometry;
  
  createMultiLayerSurface: (
    geometry: SurfaceGeometry,
    config?: SurfaceConfig & { baseColor?: number }
  ) => MultiLayerNeuroSurface;
  
  createColorMappedSurface: (
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[],
    data: Float32Array | number[],
    colorMap: ColorMapName | string | ColorMap,
    config?: SurfaceConfig
  ) => ColorMappedNeuroSurface;
  
  createVertexColoredSurface: (
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[],
    colors: (number | string | THREE.Color)[],
    config?: SurfaceConfig
  ) => VertexColoredNeuroSurface;
  
  createRGBALayer: (
    id: string,
    rgbaData: Float32Array | number[],
    config?: LayerConfig
  ) => RGBALayer;
  
  createDataLayer: (
    id: string,
    data: Float32Array | number[],
    indices: Uint32Array | number[] | null,
    colorMap: ColorMapName | string | ColorMap,
    config?: LayerConfig & { range?: [number, number]; threshold?: [number, number] }
  ) => DataLayer;
  
  createBaseLayer: (
    color?: number,
    config?: LayerConfig
  ) => BaseLayer;
};

// Utility functions
export declare function debugLog(...args: any[]): void;
export declare function setDebug(enabled: boolean): void;

// Loader types
export type SurfaceFormat = 'freesurfer' | 'gifti' | 'ply' | 'auto';

export interface ParsedSurfaceData {
  vertices: Float32Array;
  faces: Uint32Array;
}

export declare function parseFreeSurferSurface(buffer: ArrayBuffer): ParsedSurfaceData;
export declare function parseGIfTISurface(xmlString: string): ParsedSurfaceData;
export declare function parsePLY(data: string | ArrayBuffer): ParsedSurfaceData;

export declare function loadSurface(
  url: string, 
  format?: SurfaceFormat, 
  hemisphere?: Hemisphere
): Promise<SurfaceGeometry>;

export declare function loadSurfaceFromFile(
  file: File, 
  format?: SurfaceFormat, 
  hemisphere?: Hemisphere
): Promise<SurfaceGeometry>;

export declare function parseFreeSurferCurvature(data: string | ArrayBuffer): Float32Array;

// Re-export Three.js
export { THREE };
