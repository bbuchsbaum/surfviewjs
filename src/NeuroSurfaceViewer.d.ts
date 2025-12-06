import * as THREE from 'three';
import { Pane } from 'tweakpane';
import { NeuroSurface } from './classes';
import { Layer } from './layers';
import { OutlineLayer } from './OutlineLayer';
import { LayerDefinition, LayerUpdateData, SurfaceClickEvent } from './types';
import { AnnotationManager, AnnotationRecord, AnnotationOptions } from './annotations';

export interface ViewerConfig {
  showControls?: boolean;
  useControls?: boolean;
  allowCDNFallback?: boolean;
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
  backgroundColor?: number;
  preset?: 'default' | 'presentation';
  linkHemispheres?: boolean;
  hoverCrosshair?: boolean;
  hoverCrosshairColor?: number;
  hoverCrosshairSize?: number;
  clickToAddAnnotation?: boolean;
}

export declare class NeuroSurfaceViewer {
  container: HTMLElement;
  width: number;
  height: number;
  config: ViewerConfig;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  surfaces: Map<string, NeuroSurface>;
  surfaceGroup: THREE.Group;
  clock: THREE.Clock;
  pane: Pane | null;
  paneContainer: HTMLElement | null;
  controls: any; // OrbitControls
  needsRender: boolean;
  isAnimating: boolean;
  effectComposer: any;
  renderTarget: THREE.WebGLRenderTarget;
  renderPass: any;
  ssaoPass: any;
  fxaaPass: any;
  shaderMaterial: THREE.ShaderMaterial | null;
  lastDimensions: { width: number; height: number };
  annotations: AnnotationManager;

  constructor(
    container: HTMLElement,
    width: number,
    height: number,
    config?: ViewerConfig,
    viewpoint?: string
  );
  
  // Initialization
  setupLights(): void;
  setupTweakPane(): void;
  setupPaneContainer(): void;
  setupOrbitControls(): void;
  initializeEffects(): void;
  
  // Surface management
  addSurface(surface: NeuroSurface, id: string): void;
  removeSurface(id: string): void;
  getSurface(id: string): NeuroSurface | undefined;
  
  // Layer management
  addLayer(surfaceId: string, layer: Layer | OutlineLayer): void;
  removeLayer(surfaceId: string, layerId: string): void;
  clearLayers(surfaceId: string, options?: import('./MultiLayerNeuroSurface').ClearLayersOptions): void;
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
  setCameraViewpoint(viewpoint: string): void;
  
  // Rendering
  startRenderLoop(): void;
  start(): void;
  stop(): void;
  animate(): void;
  requestRender(): void;
  render(): void;
  resize(width: number, height: number, options?: { dpr?: number }): { width: number; height: number; dpr: number };
  applyPresentationPreset(): void;

  // Picking
  pick(options?: { x?: number; y?: number; opacityThreshold?: number }): { surfaceId: string | null; vertexIndex: number | null; point: THREE.Vector3 | null };

  // Annotations
  addAnnotation(surfaceId: string, vertexIndex: number, data?: any, options?: AnnotationOptions): string | null;
  listAnnotations(surfaceId?: string): AnnotationRecord[];
  moveAnnotation(id: string, vertexIndex: number): boolean;
  removeAnnotations(surfaceId: string): void;
  removeAnnotation(id: string): void;
  clearAnnotations(): void;
  activateAnnotation(id: string, options?: { exclusive?: boolean }): void;
  getAnnotation(id: string): AnnotationRecord | undefined;
  showCrosshair(surfaceId: string, vertexIndex: number, options?: { size?: number; color?: number; mode?: 'selection' | 'hover' }): void;
  hideCrosshair(): void;
  toggleCrosshair(surfaceId?: string, vertexIndex?: number, options?: { size?: number; color?: number; mode?: 'selection' | 'hover' }): void;
  
  // UI control
  toggleControls(show?: boolean): void;
  getControlsVisible(): boolean;
  
  // Data updates
  setData(id: string, newData: Float32Array | number[]): void;
  setVertexColors(id: string, colors: (number | string | THREE.Color)[]): void;
  
  // Events
  onSurfaceClick?: (event: SurfaceClickEvent) => void;
  
  // Post-processing
  createShaderMaterial(): THREE.ShaderMaterial;
  
  // Cleanup
  dispose(): void;
  
  // Debugging
  static setDebug(enabled: boolean): void;
}

export default NeuroSurfaceViewer;
