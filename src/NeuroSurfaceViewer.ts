import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { SurfaceControls } from './SurfaceControls';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { NeuroSurface, ColorMappedNeuroSurface, VertexColoredNeuroSurface, SurfaceGeometry } from './classes';
import { MultiLayerNeuroSurface, ClearLayersOptions } from './MultiLayerNeuroSurface';
import { VariantSurface } from './VariantSurface';
import { RGBALayer, DataLayer } from './layers';
import { OutlineLayer } from './OutlineLayer';
import { debugLog } from './debug';
import ColorMap from './ColorMap';
import { EventEmitter } from './EventEmitter';
import { BoundingBoxHelper } from './utils/BoundingBox';
import { detectCapabilities, ViewerCapabilities } from './utils/capabilities';
import { AnnotationManager, AnnotationRecord } from './annotations';
import { GPUPicker, GPUPickResult } from './utils/GPUPicker';
import { VolumeProjectedSurface } from './surfaces/VolumeProjectedSurface';
import type { RibbonReducer, VolumeProjectionMode } from './layers';
import { CrosshairManager, CrosshairOptions } from './CrosshairManager';
import { PluginHost } from './PluginHost';
import type { ViewerPlugin, RegisterPluginOptions, PluginRegistration } from './PluginHost';
import { serialize } from './serialization/StateSerializer';
import { deserialize } from './serialization/StateDeserializer';
import {
  exportScene as buildSceneExport,
  exportSceneJSON as buildSceneExportJSON,
  exportSceneBlob as buildSceneExportBlob,
  exportStaticHTML as buildStaticHTMLExport
} from './serialization/SceneExporter';
import { resolveFigureExportOptions, resolveStylePreset } from './StylePresets';
import { encode, decode } from './serialization/ViewerState';
import type { ViewerStateV1, RestorationReport } from './serialization/ViewerState';
import type { SceneExportManifest, SceneExportOptions, StaticHTMLExportOptions } from './serialization/SceneExporter';
import type {
  FigureExportLabel,
  FigureExportOptions,
  ResolvedFigureExportOptions,
  SurfViewStylePreset,
  SurfViewStylePresetName
} from './StylePresets';
import type {
  ParcelInteractionEvent,
  ParcelSelectionEvent,
  SurfacePickEvent,
  VertexHoverEvent,
  ViewerEventMap
} from './events/ViewerEvents';

export interface NeuroSurfaceViewerConfig {
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
  /** @deprecated Tweakpane controls are no longer part of the viewer runtime. */
  showControls?: boolean;
  /** @deprecated Use the report mount controls or a ViewerPlugin. */
  useControls?: boolean;
  controlType?: 'trackball' | 'surface';
  backgroundColor?: number;
  preset?: SurfViewStylePresetName;
  linkHemispheres?: boolean;
  hoverCrosshair?: boolean;
  hoverCrosshairColor?: number;
  hoverCrosshairSize?: number;
  clickToAddAnnotation?: boolean;
  /** @deprecated Runtime CDN loading is disabled and will be removed in v3. */
  allowCDNFallback?: boolean;
  /** Use GPU-based picking for faster vertex selection on large meshes */
  useGPUPicking?: boolean;
}

export interface ParcelFocusOptions {
  showCrosshair?: boolean;
  emitEvent?: boolean;
  screenX?: number;
  screenY?: number;
}

type Viewpoint = 'lateral' | 'medial' | 'ventral' | 'posterior' | 'anterior' | 'unknown_lateral';

interface ViewpointConfig {
  /** Unit vector from origin toward camera position */
  direction: THREE.Vector3;
  /** Camera up vector for this view */
  up: THREE.Vector3;
}

interface ViewpointState {
  rotation: THREE.Quaternion;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

interface DataRange {
  min: number;
  max: number;
}

interface RangeValue {
  range: DataRange;
}

function colorToCSS(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

let legacyControlsWarningEmitted = false;

function warnLegacyControlsDeprecated(): void {
  if (legacyControlsWarningEmitted) return;
  legacyControlsWarningEmitted = true;
  console.warn(
    'surfview: Tweakpane controls are deprecated and disabled. ' +
    'Use the report mount controls or a ViewerPlugin instead.'
  );
}

export class NeuroSurfaceViewer extends EventEmitter<ViewerEventMap> {
  container: HTMLElement;
  width!: number;
  height!: number;
  config!: Required<NeuroSurfaceViewerConfig>;
  viewpoint!: string;
  scene!: THREE.Scene;
  environmentMap!: THREE.Texture | null;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  controls!: TrackballControls | SurfaceControls;
  composer!: EffectComposer;
  ssaoPass: SSAOPass | null = null;
  surfaces!: Map<string, NeuroSurface>;
  rimStrengthUniforms!: Array<{ value: number }>;
  raycaster!: THREE.Raycaster;
  mouse!: THREE.Vector2;
  intersectionPoint!: THREE.Vector3;
  animationId!: number | null;
  paneContainer!: HTMLElement | null;
  needsRender!: boolean;
  dataRange!: DataRange;
  intensityRange!: RangeValue;
  thresholdRange!: RangeValue;
  ambientLight!: THREE.AmbientLight;
  directionalLight!: THREE.DirectionalLight;
  pane: any | null;
  paneLoading!: boolean;
  controlsEnabled!: boolean;
  paneContentEl!: HTMLElement | null;
  paneHandleEl!: HTMLElement | null;
  paneMinimizeButtonEl: HTMLButtonElement | null = null;
  paneDragState!: { dragging: boolean; offsetX: number; offsetY: number; pointerId: number | null; minimized: boolean };
  resetCameraButton: any;
  fpsGraph: any;
  viewpoints!: Record<string, ViewpointConfig>;
  viewpointState!: ViewpointState | null;
  currentViewpointKey!: string;
  colormapBindingState!: { colormap: string } | null;
  viewBindingState!: { viewpoint: Viewpoint } | null;
  variantBindingState!: { variant: string } | null;
  layerOpacityBindingState: { opacity: number } = { opacity: 1 };
  annotations!: AnnotationManager;
  plugins!: PluginHost;
  capabilities!: ViewerCapabilities;
  stylePreset!: SurfViewStylePreset;
  options!: Map<string, any>;
  sceneBoundsRadius!: number;
  initializationFailed: boolean;
  selectedLayerId: string | null = null;
  selectedSurfaceId: string | null = null;
  onSurfaceClick?: (event: any) => void;
  /** GPU-based picker for fast vertex selection */
  gpuPicker: GPUPicker | null = null;
  crosshair!: CrosshairManager;
  handleSurfaceClick!: (event: MouseEvent) => void;
  private handleMouseMove?: (event: MouseEvent) => void;
  private handlePanePointerMove?: (event: PointerEvent) => void;
  private handlePanePointerUp?: (event: PointerEvent) => void;
  private disposed = false;

  constructor(
    container: HTMLElement, 
    width: number, 
    height: number, 
    config: NeuroSurfaceViewerConfig = {}, 
    viewpoint: string = 'lateral'
  ) {
    super(); // Initialize EventEmitter
    this.initializationFailed = false;
    this.container = container;
    this.plugins = new PluginHost(this);
    // Ensure absolute children (pane, etc.) position relative to the viewer container.
    if (typeof window !== 'undefined') {
      const computed = window.getComputedStyle(container);
      if (computed.position === 'static') {
        container.style.position = 'relative';
      }
    }
    if (!this.hasDOM()) {
      this.renderFallback('NeuroSurfaceViewer requires a browser DOM environment.');
      this.initializationFailed = true;
      return;
    }
    if (!this.isWebGLAvailable()) {
      this.renderFallback('WebGL is not available in this browser or on this hardware.');
      this.initializationFailed = true;
      return;
    }
    this.width = width;
    this.height = height;
    this.config = {
      ambientLightColor: 0xb5b5b5,  // Brighter ambient light
      directionalLightColor: 0xffffff,
      directionalLightIntensity: 1.6,  // Brighter directional light
      rotationSpeed: 2,
      initialZoom: 12,
      ssaoRadius: 4,
      ssaoKernelSize: 32,
      rimStrength: 0,
      metalness: 0.1,
      roughness: 0.6,
      useShaders: false,
      showControls: false,
      useControls: false,
      allowCDNFallback: false,
      backgroundColor: 0x000000,
      controlType: 'trackball', // 'trackball' or 'surface' - new natural controls
      preset: 'default',
      linkHemispheres: false,
      hoverCrosshair: false,
      hoverCrosshairColor: 0x66ccff,
      hoverCrosshairSize: 1.2,
      clickToAddAnnotation: false,
      useGPUPicking: false,
      ...config
    };
    if (config.showControls || config.useControls || config.allowCDNFallback) {
      warnLegacyControlsDeprecated();
      this.config.showControls = false;
      this.config.useControls = false;
      this.config.allowCDNFallback = false;
    }
    this.stylePreset = resolveStylePreset(this.config.preset);
    this.viewpoint = viewpoint;

    // Initialize core state before any setup functions that rely on it
    this.surfaces = new Map(); // Store multiple surfaces
    this.rimStrengthUniforms = [];
    this.options = new Map();
    this.sceneBoundsRadius = 0;
    this.selectedLayerId = null;
    this.selectedSurfaceId = null;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.intersectionPoint = new THREE.Vector3();

    this.scene = new THREE.Scene();
    this.environmentMap = null;
    this.camera = new THREE.PerspectiveCamera(35, this.width / this.height, 0.1, 1000);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (error) {
      this.renderFallback(
        `WebGL renderer initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
      this.initializationFailed = true;
      return;
    }
    this.annotations = new AnnotationManager(this);
    this.crosshair = new CrosshairManager(() => this.requestRender());

    this.setupRenderer();
    this.setupContextLossHandling();
    this.capabilities = detectCapabilities(this.renderer);
    this.setupCamera();
    this.setupLighting();
    this.setupControls();
    this.setupPicking();
    this.setupSurfaceClick();
    this.setupPostProcessing();

    if (this.config.preset !== 'default') {
      this.applyStylePreset(this.config.preset);
    }

    this.handleSurfaceClick = this.onSurfaceClickHandler.bind(this);

    this.animationId = null; // Store animation frame id for cleanup
    this.paneContainer = null; // Reference to tweakpane container
    this.needsRender = true; // Flag for on-demand rendering
    this.pane = null;
    this.paneLoading = false;
    this.controlsEnabled = true;
    this.paneContentEl = null;
    this.paneHandleEl = null;
    this.paneDragState = { dragging: false, offsetX: 0, offsetY: 0, pointerId: null, minimized: false };
    this.viewpointState = null;
    this.currentViewpointKey = '';
    this.colormapBindingState = null;
    this.viewBindingState = { viewpoint: viewpoint as Viewpoint };
    this.variantBindingState = null;

    this.dataRange = { min: 0, max: 500 }; // Initialize to default values
    this.intensityRange = { range: { min: 0, max: 500 } };
    this.thresholdRange = { range: { min: 0, max: 0 } }; // Set default threshold to [0, 0]

    // Bind methods to preserve context
    this.animate = this.animate.bind(this);

    // Viewpoint directions are expressed in RAS space (x=Left-Right, y=Posterior-Anterior, z=Inferior-Superior).
    // Camera 'up' is chosen per view to keep Superior at the top of the screen where possible and avoid
    // the up vector being parallel to the view direction (e.g., ventral/inferior views).
    this.viewpoints = {
      left_lateral:   { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
      left_medial:    { direction: new THREE.Vector3(1, 0, 0),  up: new THREE.Vector3(0, 0, 1) },
      left_ventral:   { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) }, // use anterior as up when viewing from below
      left_posterior: { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
      left_anterior:  { direction: new THREE.Vector3(0, 1, 0),  up: new THREE.Vector3(0, 0, 1) },
      right_lateral:  { direction: new THREE.Vector3(1, 0, 0),  up: new THREE.Vector3(0, 0, 1) },
      right_medial:   { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
      right_ventral:  { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
      right_posterior:{ direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
      right_anterior: { direction: new THREE.Vector3(0, 1, 0),  up: new THREE.Vector3(0, 0, 1) },
      unknown_lateral:{ direction: new THREE.Vector3(1, 0, 0),  up: new THREE.Vector3(0, 0, 1) }
    };

    // Start the animation loop
    this.animate();
  }

  registerPlugin(plugin: ViewerPlugin, options?: RegisterPluginOptions): PluginRegistration {
    return this.plugins.register(plugin, options);
  }

  unregisterPlugin(id: string): boolean {
    return this.plugins.unregister(id);
  }

  getPlugin(id: string): PluginRegistration | null {
    return this.plugins.get(id);
  }

  listPlugins(): PluginRegistration[] {
    return this.plugins.list();
  }

  setupRenderer(): void {
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(this.config.backgroundColor);
    const rendererAny = this.renderer as any;
    if ('outputColorSpace' in rendererAny) {
      rendererAny.outputColorSpace = (THREE as any).SRGBColorSpace ?? 'srgb';
    }
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
  }

  /**
   * Handle WebGL context loss and restoration.
   * Context loss can happen due to GPU driver resets, resource pressure, or tab throttling.
   */
  private setupContextLossHandling(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      console.warn('surfviewjs: WebGL context lost. Rendering paused.');
      if (this.animationId !== null) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
      this.emit('context:lost');
    });

    canvas.addEventListener('webglcontextrestored', () => {
      console.info('surfviewjs: WebGL context restored. Resuming rendering.');
      this.needsRender = true;
      this.animate();
      this.emit('context:restored');
    });
  }

  setupCamera(): void {
    this.camera.position.set(0, 0, this.config.initialZoom);
    this.camera.lookAt(new THREE.Vector3(0, 0, 0));
    this.camera.up.set(0, 1, 0);
    this.camera.updateProjectionMatrix();
  }

  setupLighting(): void {
    // Ambient light for overall illumination - bright enough to see surface clearly
    this.ambientLight = new THREE.AmbientLight(this.config.ambientLightColor, 1.25);
    this.scene.add(this.ambientLight);

    // Directional light for shading and definition
    this.directionalLight = new THREE.DirectionalLight(
      this.config.directionalLightColor, 
      this.config.directionalLightIntensity
    );
    this.directionalLight.position.set(1, 1, 1);
    this.directionalLight.castShadow = false;
    this.scene.add(this.directionalLight);

    // Add a fill light from the opposite direction for better visibility
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
    fillLight.position.set(-1, -0.5, -1);
    this.scene.add(fillLight);
  }

  setupControls(): void {
    if (this.config.controlType === 'surface') {
      // Use new natural surface controls
      this.controls = new SurfaceControls(this.camera, this.renderer.domElement);
      this.controls.rotateSpeed = this.config.rotationSpeed;
      this.controls.enableDamping = false;
      this.controls.dampingFactor = 0.05;
      this.controls.zoomSpeed = 0.8;
      this.controls.panSpeed = 0.8;
      (this.controls as any).minDistance = 0.05;
      (this.controls as any).maxDistance = Infinity;
      
      // Set initial target and position
      this.controls.target.set(0, 0, 0);
      this.camera.position.z = this.config.initialZoom;
    } else {
      // Use traditional trackball controls
      this.controls = new TrackballControls(this.camera, this.renderer.domElement);
      this.controls.rotateSpeed = this.config.rotationSpeed;
      this.controls.zoomSpeed = 0.8;
      this.controls.panSpeed = 0.8;
      this.controls.keys = ['KeyA', 'KeyS', 'KeyD'];
      (this.controls as any).minDistance = 0.05;
      (this.controls as any).maxDistance = Infinity;
      
      // Set initial position with larger zoom value
      this.controls.target.set(0, 0, 0);
      this.camera.position.z = this.config.initialZoom;
      this.controls.update();
    }

    // Add event listener for controls change
    if (this.controls.addEventListener) {
      (this.controls as any).addEventListener('change', this.onControlsChange);
    }
  }

  onControlsChange = (): void => {
    const target = this.controls && 'target' in this.controls
      ? ((this.controls as any).target as THREE.Vector3).clone()
      : null;
    this.emit('camera:changed', {
      camera: this.camera,
      position: this.camera.position.clone(),
      target
    });
    this.requestRender();
  }

  private computeRangeStep(): number {
    const span = this.dataRange.max - this.dataRange.min;
    const candidate = Math.abs(span) / 1000;
    if (!isFinite(candidate) || candidate === 0) {
      return 0.1;
    }
    return Math.max(0.001, candidate);
  }

  private getLayerOptions(): { options: Record<string, string>; selectedLayerId: string; surfaceId: string } | null {
    const multiEntry = this.getActiveMultiLayerEntry();
    if (!multiEntry) return null;
    const layers = multiEntry.surface.layerStack.getAllLayers();
    if (!layers.length) return null;
    const options: Record<string, string> = {};
    layers.forEach(layer => options[layer.id] = layer.id);
    const current = (this.selectedLayerId && layers.find(l => l.id === this.selectedLayerId))
      ? this.selectedLayerId
      : layers[0].id;
    return {
      options,
      selectedLayerId: current,
      surfaceId: multiEntry.id
    };
  }

  private getActiveMultiLayerEntry(): { id: string; surface: MultiLayerNeuroSurface } | null {
    let fallback: { id: string; surface: MultiLayerNeuroSurface } | null = null;
    this.surfaces.forEach((surface, id) => {
      if (surface instanceof MultiLayerNeuroSurface) {
        if (!fallback) fallback = { id, surface };
      }
    });
    if (!fallback) return null;
    if (this.selectedSurfaceId && this.surfaces.has(this.selectedSurfaceId)) {
      const candidate = this.surfaces.get(this.selectedSurfaceId);
      if (candidate instanceof MultiLayerNeuroSurface) {
        return { id: this.selectedSurfaceId, surface: candidate };
      }
    }
    return fallback;
  }

  private getActiveVariantEntry(): { id: string; surface: VariantSurface } | null {
    let fallback: { id: string; surface: VariantSurface } | null = null;
    this.surfaces.forEach((surface, id) => {
      if (surface instanceof VariantSurface) {
        if (!fallback) fallback = { id, surface };
      }
    });
    if (!fallback) return null;
    if (this.selectedSurfaceId && this.surfaces.has(this.selectedSurfaceId)) {
      const candidate = this.surfaces.get(this.selectedSurfaceId);
      if (candidate instanceof VariantSurface) {
        return { id: this.selectedSurfaceId, surface: candidate };
      }
    }
    return fallback;
  }

  private getActiveLayer(): { surface: MultiLayerNeuroSurface; layer: any; surfaceId: string } | null {
    const entry = this.getActiveMultiLayerEntry();
    if (!entry) return null;
    const layerId = this.selectedLayerId;
    const layers = entry.surface.layerStack.getAllLayers();
    const layer = layers.find(l => l.id === layerId) || layers[0];
    if (!layer) return null;
    return { surface: entry.surface, layer, surfaceId: entry.id };
  }

  private syncLayerBindingsFromSelection(): void {
    const active = this.getActiveLayer();
    if (!active) return;
    // Only sync if DataLayer-like
    if ('getRange' in active.layer && 'getThreshold' in active.layer) {
      const range = (active.layer as any).getRange();
      const threshold = (active.layer as any).getThreshold();
      this.intensityRange.range.min = range[0];
      this.intensityRange.range.max = range[1];
      this.thresholdRange.range.min = threshold[0];
      this.thresholdRange.range.max = threshold[1];
    }
    if ('getColorMapName' in active.layer) {
      const name = (active.layer as any).getColorMapName();
      if (this.colormapBindingState) {
        this.colormapBindingState.colormap = name;
      } else {
        this.colormapBindingState = { colormap: name };
      }
    }
    if ((active.layer as any).opacity !== undefined) {
      this.layerOpacityBindingState.opacity = (active.layer as any).opacity;
    }
    if (this.pane) {
      (this.pane as any).refresh();
    }
  }

  // Resolve the name of the colormap currently in use, preferring the active
  // multi-layer entry and falling back to the first single ColorMappedNeuroSurface.
  // Returns null when no colormapped content is present.
  private getActiveColorMapName(): string | null {
    const active = this.getActiveLayer();
    if (active && typeof (active.layer as any).getColorMapName === 'function') {
      return (active.layer as any).getColorMapName();
    }
    for (const surface of this.surfaces.values()) {
      if (surface instanceof ColorMappedNeuroSurface
          && typeof (surface as any).getColorMapName === 'function') {
        return (surface as any).getColorMapName();
      }
    }
    return null;
  }

  private applyColormapChange(colormapName: string): void {
    // 'custom' is a display-only sentinel for an externally-supplied palette;
    // there is no preset to apply, so selecting it is a no-op.
    if (colormapName === 'custom') {
      return;
    }
    const active = this.getActiveLayer();
    if (active && 'setColorMap' in active.layer) {
      (active.layer as any).setColorMap(colormapName);
      active.surface.requestColorUpdate?.();
      this.emit('layer:colormap', { surfaceId: active.surfaceId, layerId: active.layer.id, colormap: colormapName });
      this.requestRender();
      return;
    }
    // Fallback to global single-surface behavior
    this.surfaces.forEach((surface, surfaceId) => {
      if (surface instanceof ColorMappedNeuroSurface) {
        surface.setColorMap(colormapName);
        this.emit('surface:colormap', { surfaceId, colormap: colormapName });
      }
    });
    this.requestRender();
  }

  private applyIntensityRangeChange(): void {
    const range: [number, number] = [this.intensityRange.range.min, this.intensityRange.range.max];
    const active = this.getActiveLayer();
    if (active && 'setRange' in active.layer) {
      (active.layer as any).setRange(range);
      active.surface.requestColorUpdate?.();
      this.emit('layer:intensity', { surfaceId: active.surfaceId, layerId: active.layer.id, range });
      this.requestRender();
      return;
    }
    this.surfaces.forEach(surface => {
      if (surface instanceof ColorMappedNeuroSurface && surface.colorMap) {
        surface.colorMap.setRange(range);
      }
    });
    this.requestRender();
  }

  private applyThresholdChange(): void {
    const threshold: [number, number] = [this.thresholdRange.range.min, this.thresholdRange.range.max];
    const active = this.getActiveLayer();
    if (active && 'setThreshold' in active.layer) {
      (active.layer as any).setThreshold(threshold);
      active.surface.requestColorUpdate?.();
      this.emit('layer:threshold', { surfaceId: active.surfaceId, layerId: active.layer.id, threshold });
      this.requestRender();
      return;
    }
    this.surfaces.forEach(surface => {
      if (surface instanceof ColorMappedNeuroSurface && surface.colorMap) {
        surface.colorMap.setThreshold(threshold);
      }
    });
    this.requestRender();
  }

  private applyOpacityChange(opacity: number): void {
    const active = this.getActiveLayer();
    if (active && 'setOpacity' in active.layer) {
      (active.layer as any).setOpacity(opacity);
      active.surface.requestColorUpdate?.();
      this.emit('layer:opacity', { surfaceId: active.surfaceId, layerId: active.layer.id, opacity });
      this.requestRender();
    }
  }

  setupPostProcessing(): void {
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    if (this.config.useShaders) {
      this.ssaoPass = new SSAOPass(this.scene, this.camera, this.width, this.height);
      this.ssaoPass.kernelRadius = this.config.ssaoRadius;
      this.composer.addPass(this.ssaoPass);
    } else {
      this.ssaoPass = null;
    }
  }

  async setupTweakPane(): Promise<void> {
    warnLegacyControlsDeprecated();
    this.config.showControls = false;
    this.config.useControls = false;
    return;

    if (!this.config.useControls) return;
    if (this.pane || this.paneLoading) return;
    this.paneLoading = true;
    try {
      const { Pane, essentials } = await this.loadTweakpane();
      await this.buildTweakPane(Pane, essentials, null);

      // If controls were toggled off before pane finished loading, hide it.
      const paneContainer = this.paneContainer;
      if (!this.config.showControls && paneContainer) {
        paneContainer!.style.display = 'none';
      }
    } catch (err) {
      console.error('setupTweakPane failed', err);
      debugLog('setupTweakPane failed', err);
    } finally {
      this.paneLoading = false;
    }
  }

  /** @deprecated Tweakpane is no longer shipped or loaded by surfview. */
  private async loadTweakpane(): Promise<{ Pane: any; essentials: any | null }> {
    throw new Error('Tweakpane controls are deprecated and disabled.');
  }

  private async buildTweakPane(Pane: any, EssentialsPlugin: any | null, IntervalPlugin: any | null): Promise<void> {
    // Create a container for the pane
    this.paneContainer = document.createElement('div');
    this.paneContainer.style.position = 'absolute';
    this.paneContainer.style.top = '10px';
    this.paneContainer.style.right = '10px';
    this.paneContainer.style.zIndex = '1000';
    this.paneContainer.style.maxHeight = '90%';
    this.paneContainer.style.minWidth = '260px';
    this.paneContainer.style.pointerEvents = 'auto';
    this.paneContainer.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
    this.paneContainer.style.borderRadius = '6px';
    this.paneContainer.style.background = 'rgba(255,255,255,0.92)';
    this.paneContainer.style.backdropFilter = 'blur(4px)';
    this.paneContainer.style.overflow = 'hidden';

    // Drag handle
    this.paneHandleEl = document.createElement('div');
    this.paneHandleEl.style.height = '14px';
    this.paneHandleEl.style.cursor = 'grab';
    this.paneHandleEl.style.display = 'flex';
    this.paneHandleEl.style.alignItems = 'center';
    this.paneHandleEl.style.justifyContent = 'space-between';
    this.paneHandleEl.style.padding = '0 6px';
    this.paneHandleEl.style.background = 'linear-gradient(90deg, rgba(0,0,0,0.08), rgba(0,0,0,0.02))';
    this.paneHandleEl.style.borderBottom = '1px solid rgba(0,0,0,0.08)';
    this.paneHandleEl.style.userSelect = 'none';
    const dragLabel = document.createElement('span');
    dragLabel.textContent = '☰ drag';
    dragLabel.style.fontSize = '10px';
    dragLabel.style.opacity = '0.7';

    const minimizeBtn = document.createElement('button');
    minimizeBtn.textContent = '–';
    minimizeBtn.title = 'Minimize / restore controls';
    minimizeBtn.style.border = 'none';
    minimizeBtn.style.background = 'transparent';
    minimizeBtn.style.cursor = 'pointer';
    minimizeBtn.style.fontSize = '12px';
    minimizeBtn.style.lineHeight = '12px';
    minimizeBtn.style.padding = '0 4px';

    this.paneHandleEl.appendChild(dragLabel);
    this.paneHandleEl.appendChild(minimizeBtn);
    this.paneMinimizeButtonEl = minimizeBtn;
    this.paneContainer.appendChild(this.paneHandleEl);

    this.paneContentEl = document.createElement('div');
    this.paneContentEl.style.maxHeight = 'calc(90vh - 40px)';
    this.paneContentEl.style.overflow = 'auto';
    this.paneContainer.appendChild(this.paneContentEl);
    this.container.appendChild(this.paneContainer);

    // Create the pane
    this.pane = new Pane({
      container: this.paneContentEl
    });
    const essentials = EssentialsPlugin ? ((EssentialsPlugin as any).default ?? EssentialsPlugin) : null;
    const interval = IntervalPlugin ? ((IntervalPlugin as any).default ?? IntervalPlugin) : null;

    // Register plugins with error handling
    const supportsEssentials = !!essentials;
    if (essentials) {
      try {
        this.pane.registerPlugin(essentials);
      } catch (err) {
        console.warn('Failed to register Tweakpane essentials plugin:', err);
        debugLog('Failed to register essentials plugin', err);
      }
    }
    if (interval) {
      try {
        this.pane.registerPlugin(interval);
      } catch (err) {
        console.warn('Failed to register Tweakpane interval plugin (may be incompatible with Tweakpane v4):', err);
      }
    }

    // Minimize / restore behavior
    if (this.paneContentEl) {
      minimizeBtn.addEventListener('click', () => {
        this.togglePaneMinimized();
      });
    }

    // Enable dragging for the whole pane via handle
    this.setupPaneDragging();

    const layerFolder = (this.pane as any).addFolder({
      title: 'Layer',
      expanded: true
    });

    const layerOptions = this.getLayerOptions();
    if (layerOptions) {
      if (!this.selectedLayerId) {
        this.selectedLayerId = layerOptions.selectedLayerId;
        this.selectedSurfaceId = layerOptions.surfaceId;
      }
      const layerBindingState = { layer: this.selectedLayerId || layerOptions.selectedLayerId };
      layerFolder.addBinding(layerBindingState, 'layer', {
        label: 'active layer',
        options: layerOptions.options
      }).on('change', (ev: any) => {
        this.selectedLayerId = ev.value;
        this.selectedSurfaceId = layerOptions.surfaceId;
        this.syncLayerBindingsFromSelection();
      });
    }

    const variantEntry = this.getActiveVariantEntry();
    if (variantEntry) {
      const variantFolder = (this.pane as any).addFolder({
        title: 'Surface',
        expanded: true
      });
      const variantOptions = variantEntry.surface.variantNames().reduce((acc: Record<string, string>, name) => {
        acc[name] = name;
        return acc;
      }, {} as Record<string, string>);
      this.variantBindingState = { variant: variantEntry.surface.currentVariant() };
      variantFolder.addBinding(
        this.variantBindingState,
        'variant',
        { label: 'variant', options: variantOptions }
      ).on('change', (ev: any) => {
        this.selectedSurfaceId = variantEntry.id;
        this.setSurfaceVariant(variantEntry.id, ev.value, { animate: true });
      });
    } else {
      this.variantBindingState = null;
    }

    const colorFolder = (this.pane as any).addFolder({
      title: 'Colormap',
      expanded: true
    });

    const availableColormaps = ColorMap.getAvailableMaps();
    // Seed the dropdown from the colormap that is actually applied so the label
    // is honest. Named presets show their name; an externally-supplied color
    // array (e.g. a palette computed in R) reports 'custom' instead of
    // masquerading as a preset (such as 'jet') that was never applied.
    const activeColormapName = this.getActiveColorMapName();
    const defaultColormap = activeColormapName
      || this.colormapBindingState?.colormap
      || (availableColormaps.includes('jet') ? 'jet' : (availableColormaps[0] || 'jet'));
    this.colormapBindingState = { colormap: defaultColormap };
    const colormapOptions = (availableColormaps.length ? availableColormaps : [defaultColormap])
      .reduce((acc: Record<string, string>, preset) => {
        acc[preset] = preset;
        return acc;
      }, {});
    // Ensure the active selection is always a valid option. The 'custom'
    // sentinel for array-based colormaps is not part of the preset list, so add
    // it here; otherwise Tweakpane cannot display the current selection.
    if (!(defaultColormap in colormapOptions)) {
      colormapOptions[defaultColormap] = defaultColormap;
    }

    colorFolder.addBinding(
      this.colormapBindingState,
      'colormap',
      { options: colormapOptions, label: 'colormap' }
    ).on('change', (ev: any) => {
      this.colormapBindingState!.colormap = ev.value;
      this.applyColormapChange(ev.value);
    });

    const rangeStep = this.computeRangeStep();

    // Intensity range controls (using separate sliders instead of interval plugin)
    colorFolder.addBinding(
      this.intensityRange.range,
      'min',
      {
        label: 'intensity min',
        min: this.dataRange.min,
        max: this.dataRange.max,
        step: rangeStep
      }
    ).on('change', () => {
      // Ensure min doesn't exceed max
      if (this.intensityRange.range.min > this.intensityRange.range.max) {
        this.intensityRange.range.min = this.intensityRange.range.max;
      }
      this.applyIntensityRangeChange();
    });

    colorFolder.addBinding(
      this.intensityRange.range,
      'max',
      {
        label: 'intensity max',
        min: this.dataRange.min,
        max: this.dataRange.max,
        step: rangeStep
      }
    ).on('change', () => {
      // Ensure max doesn't go below min
      if (this.intensityRange.range.max < this.intensityRange.range.min) {
        this.intensityRange.range.max = this.intensityRange.range.min;
      }
      this.applyIntensityRangeChange();
    });

    // Threshold range controls (using separate sliders instead of interval plugin)
    colorFolder.addBinding(
      this.thresholdRange.range,
      'min',
      {
        label: 'threshold min',
        min: this.dataRange.min,
        max: this.dataRange.max,
        step: rangeStep
      }
    ).on('change', () => {
      // Ensure min doesn't exceed max
      if (this.thresholdRange.range.min > this.thresholdRange.range.max) {
        this.thresholdRange.range.min = this.thresholdRange.range.max;
      }
      this.applyThresholdChange();
    });

    colorFolder.addBinding(
      this.thresholdRange.range,
      'max',
      {
        label: 'threshold max',
        min: this.dataRange.min,
        max: this.dataRange.max,
        step: rangeStep
      }
    ).on('change', () => {
      // Ensure max doesn't go below min
      if (this.thresholdRange.range.max < this.thresholdRange.range.min) {
        this.thresholdRange.range.max = this.thresholdRange.range.min;
      }
      this.applyThresholdChange();
    });

    colorFolder.addBinding(
      this.layerOpacityBindingState,
      'opacity',
      {
        label: 'layer opacity',
        min: 0,
        max: 1,
        step: 0.01
      }
    ).on('change', (ev: any) => {
      this.applyOpacityChange(ev.value);
    });

    // Lighting folder
    const lightingFolder = (this.pane as any).addFolder({
      title: 'Lighting',
      expanded: false
    });

    lightingFolder.addBinding(
      { ambientColor: `#${this.config.ambientLightColor.toString(16).padStart(6, '0')}` },
      'ambientColor',
      { view: 'color' }
    ).on('change', (ev: any) => {
      // Convert hex string to number
      const colorValue = parseInt(ev.value.replace('#', ''), 16);
      this.updateConfig({ ambientLightColor: colorValue });
    });

    lightingFolder.addBinding(
      { directionalColor: `#${this.config.directionalLightColor.toString(16).padStart(6, '0')}` },
      'directionalColor',
      { view: 'color' }
    ).on('change', (ev: any) => {
      // Convert hex string to number
      const colorValue = parseInt(ev.value.replace('#', ''), 16);
      this.updateConfig({ directionalLightColor: colorValue });
    });

    lightingFolder.addBinding(
      { intensity: this.config.directionalLightIntensity },
      'intensity',
      {
        min: 0,
        max: 2,
        step: 0.1
      }
    ).on('change', (ev: any) => {
      this.updateDirectionalLightIntensity(ev.value);
      this.config.directionalLightIntensity = ev.value;
    });

    lightingFolder.addBinding(
      { background: `#${this.config.backgroundColor.toString(16).padStart(6, '0')}` },
      'background',
      { view: 'color' }
    ).on('change', (ev: any) => {
      const colorValue = parseInt(ev.value.replace('#', ''), 16);
      this.updateConfig({ backgroundColor: colorValue });
    });

    // Post processing folder
    const postProcessingFolder = (this.pane as any).addFolder({
      title: 'Post Processing',
      expanded: false
    });

    postProcessingFolder.addBinding(
      { ssaoRadius: this.config.ssaoRadius },
      'ssaoRadius',
      {
        min: 0,
        max: 32,
        step: 0.1
      }
    ).on('change', (ev: any) => {
      if (this.ssaoPass) {
        this.ssaoPass.kernelRadius = ev.value;
        this.requestRender();
      }
    });

    postProcessingFolder.addBinding(
      { ssaoKernelSize: this.config.ssaoKernelSize },
      'ssaoKernelSize',
      {
        min: 1,
        max: 128,
        step: 1
      }
    ).on('change', (ev: any) => {
      if (this.ssaoPass) {
        const kernelSize = Math.max(1, Math.floor(ev.value));
        if (typeof (this.ssaoPass as any).generateSampleKernel === 'function') {
          (this.ssaoPass as any).generateSampleKernel(kernelSize);
          this.requestRender();
        }
      }
    });

    // Material folder
    // Performance settings
    const performanceFolder = (this.pane as any).addFolder({
      title: 'Performance',
      expanded: false
    });

    performanceFolder.addBinding(
      { gpuCompositing: false },
      'gpuCompositing',
      {
        label: 'GPU Compositing'
      }
    ).on('change', (ev: any) => {
      // Toggle GPU compositing for all MultiLayerNeuroSurface instances
      this.surfaces.forEach(surface => {
        if ('setCompositingMode' in surface) {
          (surface as any).setCompositingMode(ev.value);
          debugLog(`Surface compositing mode: ${(surface as any).getCompositingMode()}`);
        }
      });
      this.requestRender();
    });

    performanceFolder.addBinding(
      { wideLines: true },
      'wideLines',
      { label: 'Wide Lines' }
    ).on('change', (ev: any) => {
      this.surfaces.forEach(surface => {
        if (surface instanceof MultiLayerNeuroSurface) {
          surface.setWideLines(ev.value);
        }
      });
      this.requestRender();
    });

    const materialFolder = (this.pane as any).addFolder({
      title: 'Material',
      expanded: false
    });

    const viewFolder = (this.pane as any).addFolder({
      title: 'View',
      expanded: true
    });

    if (this.viewBindingState) {
      this.viewBindingState.viewpoint = this.viewpoint as Viewpoint;
    } else {
      this.viewBindingState = { viewpoint: this.viewpoint as Viewpoint };
    }

    viewFolder.addBinding(
      this.viewBindingState,
      'viewpoint',
      {
        options: {
          lateral: 'lateral',
          medial: 'medial',
          ventral: 'ventral',
          posterior: 'posterior',
          anterior: 'anterior',
          unknown_lateral: 'unknown_lateral'
        }
      }
    ).on('change', (ev: any) => {
      this.setViewpoint(ev.value);
    });

    viewFolder.addButton({
      title: 'Fit View'
    }).on('click', () => {
      this.centerCamera();
    });

    materialFolder.addBinding(
      { metalness: this.config.metalness },
      'metalness',
      {
        min: 0,
        max: 1,
        step: 0.01
      }
    ).on('change', (ev: any) => {
      this.config.metalness = ev.value;
      this.updateMaterials();
    });

    materialFolder.addBinding(
      { roughness: this.config.roughness },
      'roughness',
      {
        min: 0,
        max: 1,
        step: 0.01
      }
    ).on('change', (ev: any) => {
      this.config.roughness = ev.value;
      this.updateMaterials();
    });

    materialFolder.addBinding(
      { rimStrength: this.config.rimStrength },
      'rimStrength',
      {
        min: 0,
        max: 2,
        step: 0.01
      }
    ).on('change', (ev: any) => {
      this.config.rimStrength = ev.value;
      
      // Update existing uniforms
      this.rimStrengthUniforms.forEach(uniform => {
        uniform.value = ev.value;
      });
      
      // Add rim lighting shaders to surfaces if not already added and rimStrength > 0
      if (this.config.useShaders && ev.value > 0) {
        Object.values(this.surfaces).forEach(surface => {
          if (surface.mesh && surface.mesh.material) {
            // Check if shader already applied
            const material = surface.mesh.material as any;
            if (!material.userData?.hasRimShader) {
              this.addRimLightingShader(surface.mesh);
              material.userData = { ...material.userData, hasRimShader: true };
            }
          }
        });
      }
      
      this.requestRender();
    });

    // Add reset camera button
    this.resetCameraButton = (this.pane as any).addButton({
      title: 'Reset Camera'
    });
    this.resetCameraButton.on('click', () => {
      this.resetCamera();
    });

    // Add FPS monitor only if essentials plugin is available (fpsgraph view comes from it)
    if (supportsEssentials) {
      try {
        this.fpsGraph = (this.pane as any).addBlade({
          view: 'fpsgraph',
          label: 'FPS',
          rows: 2
        }) as any;
      } catch (err) {
        console.warn('Failed to add fpsgraph blade; continuing without it', err);
        this.fpsGraph = null as any;
      }
    } else {
      this.fpsGraph = null as any;
    }
  }

  private setupPaneDragging(): void {
    if (!this.paneContainer || !this.paneHandleEl) return;
    const handle = this.paneHandleEl;
    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', (ev: PointerEvent) => {
      this.paneDragState.dragging = true;
      this.paneDragState.pointerId = ev.pointerId;
      handle.setPointerCapture(ev.pointerId);
      const rect = this.paneContainer!.getBoundingClientRect();
      this.paneDragState.offsetX = ev.clientX - rect.left;
      this.paneDragState.offsetY = ev.clientY - rect.top;
      handle.style.cursor = 'grabbing';
    });

    const onPointerMove = (ev: PointerEvent) => {
      if (!this.paneDragState.dragging || !this.paneContainer) return;
      const parentRect = this.container.getBoundingClientRect();
      const paneRect = this.paneContainer.getBoundingClientRect();

      let newLeft = ev.clientX - this.paneDragState.offsetX - parentRect.left;
      let newTop = ev.clientY - this.paneDragState.offsetY - parentRect.top;

      // Clamp to viewer bounds
      newLeft = Math.max(0, Math.min(newLeft, parentRect.width - paneRect.width));
      newTop = Math.max(0, Math.min(newTop, parentRect.height - paneRect.height));

      this.paneContainer.style.left = `${newLeft}px`;
      this.paneContainer.style.top = `${newTop}px`;
      this.paneContainer.style.right = 'auto';
      this.paneContainer.style.bottom = 'auto';
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (this.paneDragState.pointerId !== null && ev.pointerId !== this.paneDragState.pointerId) return;
      this.paneDragState.dragging = false;
      this.paneDragState.pointerId = null;
      handle.releasePointerCapture(ev.pointerId);
      handle.style.cursor = 'grab';
    };

    this.handlePanePointerMove = onPointerMove;
    this.handlePanePointerUp = onPointerUp;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  private normalizeHemisphere(hemi: string): string {
    if (!hemi) return 'unknown';
    const h = hemi.toLowerCase();
    if (h === 'lh' || h === 'l' || h === 'left') return 'left';
    if (h === 'rh' || h === 'r' || h === 'right') return 'right';
    return h;
  }

  setViewpoint(viewpoint: string): void {
    // Support both simple viewpoint names and full hemisphere+viewpoint names
    let fullViewpoint = viewpoint;
    
    // If not a full viewpoint name, try to construct it from the first surface
    const firstSurface = this.surfaces.values().next().value;
    if (firstSurface && firstSurface.hemisphere) {
      const hemi = this.normalizeHemisphere(firstSurface.hemisphere);
      if (!viewpoint.includes('_')) {
        fullViewpoint = `${hemi}_${viewpoint}`;
      }
    }
    
    if (!this.viewpoints[fullViewpoint]) {
      const fallbackKey = this.viewpoints[viewpoint] ? viewpoint : 'unknown_lateral';
      debugLog(`Viewpoint ${fullViewpoint} not found, falling back to ${fallbackKey}`);
      fullViewpoint = fallbackKey;
    }

    const viewConfig = this.viewpoints[fullViewpoint];
    if (!viewConfig) {
      debugLog(`Viewpoint ${fullViewpoint} still unavailable; skipping update`);
      return;
    }

    const { direction, up } = viewConfig;
    const distance = this.config.initialZoom;

    // Position camera along the requested direction at the configured distance
    const position = direction.clone().normalize().multiplyScalar(distance);

    // Update camera
    this.camera.position.copy(position);
    this.camera.up.copy(up).normalize();
    this.camera.lookAt(new THREE.Vector3(0, 0, 0));
    
    // Update controls
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
    
    // Store the viewpoint state
    this.viewpointState = {
      rotation: this.camera.quaternion.clone(),
      position: this.camera.position.clone(),
      target: new THREE.Vector3(0, 0, 0)
    };
    this.currentViewpointKey = fullViewpoint;
    const shortView = fullViewpoint.includes('_')
      ? fullViewpoint.split('_')[1] as Viewpoint
      : fullViewpoint as Viewpoint;
    this.viewpoint = shortView;
    if (this.viewBindingState && this.viewBindingState.viewpoint !== shortView) {
      this.viewBindingState.viewpoint = shortView;
      if (this.pane) {
        (this.pane as any).refresh();
      }
    }
    
    // Emit viewpoint changed event
    this.emit('viewpoint:changed', {
      viewpoint: fullViewpoint,
      position: this.camera.position.clone(),
      target: this.viewpointState.target.clone()
    });
    
    this.requestRender();
  }

  /**
   * Convenience wrapper to set common hemisphere-oriented views.
   * Accepts 'lateral', 'medial', 'anterior', 'posterior', 'inferior'.
   */
  setHemisphereView(view: 'lateral' | 'medial' | 'anterior' | 'posterior' | 'inferior'): void {
    const firstSurface = this.surfaces.values().next().value as any;
    const hemi = firstSurface?.hemisphere || 'unknown';
    const normalizedView = view === 'inferior' ? 'ventral' : view;
    const key = `${hemi}_${normalizedView}`;
    this.setViewpoint(key);
  }

  /**
   * Offset left/right hemispheres apart for clarity. Uses surface.hemisphere metadata.
   */
  separateHemispheres(offset = 20): void {
    const half = offset / 2;
    this.surfaces.forEach(surface => {
      if (!surface.mesh) return;
      if (surface.hemisphere === 'left') {
        surface.mesh.position.x = -half;
      } else if (surface.hemisphere === 'right') {
        surface.mesh.position.x = half;
      }
    });
    this.requestRender();
  }

  updateColormap(presetName: string): void {
    this.applyColormapChange(presetName);
  }

  updateAmbientLight(color: number): void {
    if (this.ambientLight) {
      this.ambientLight.color.setHex(color);
      this.requestRender();
    }
  }

  updateDirectionalLight(color: number): void {
    if (this.directionalLight) {
      this.directionalLight.color.setHex(color);
      this.requestRender();
    }
  }

  updateDirectionalLightIntensity(intensity: number): void {
    if (this.directionalLight) {
      this.directionalLight.intensity = intensity;
      this.requestRender();
    }
  }

  updateMaterials(): void {
    this.surfaces.forEach(surface => {
      if (!surface.mesh) return;
      if (!surface.mesh.material || !(surface.mesh.material as any).isMeshPhysicalMaterial) {
        // Convert to MeshPhysicalMaterial
        const oldMaterial = surface.mesh.material as THREE.Material;
        const newMaterial = new THREE.MeshPhysicalMaterial({
          color: (oldMaterial as any).color || 0xffffff,
          vertexColors: (oldMaterial as any).vertexColors || false,
          flatShading: (oldMaterial as any).flatShading || false,
          metalness: this.config.metalness,
          roughness: this.config.roughness,
          envMap: this.environmentMap,
          envMapIntensity: 1.0
        });
        surface.mesh.material = newMaterial;
        oldMaterial.dispose();
      } else {
        // Update existing material
        const material = surface.mesh.material as THREE.MeshPhysicalMaterial;
        material.metalness = this.config.metalness;
        material.roughness = this.config.roughness;
        material.envMap = this.environmentMap;
      }
    });
    this.requestRender();
  }

  updateIntensityRange(): void {
    this.applyIntensityRangeChange();
  }

  updateThresholdRange(): void {
    this.applyThresholdChange();
  }

  resetCamera(): void {
    if (this.camera && this.controls) {
      const minClamp = this.sceneBoundsRadius > 0 ? Math.max(0.05, this.sceneBoundsRadius * 0.6) : 0.05;
      const maxClamp = this.sceneBoundsRadius > 0 ? Math.max(this.sceneBoundsRadius * 20, this.config.initialZoom) : Infinity;
      (this.controls as any).minDistance = minClamp;
      (this.controls as any).maxDistance = maxClamp;
      this.camera.position.set(0, 0, this.config.initialZoom);
      this.camera.up.set(0, 1, 0);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.requestRender();
    }
  }

  addSurface(surface: NeuroSurface, id?: string): void {
    try {
      debugLog('Adding surface:', surface, 'with id:', id);
      
      if (!surface) {
        console.error('Surface is null or undefined');
        return;
      }

      if (!id) {
        id = `surface_${this.surfaces.size}`;
      }
      const surfaceId = id;

      // Set viewer reference on the surface
      surface.viewer = this;
      
      // Handle surfaces without mesh (MultiLayerNeuroSurface)
      if (!surface.mesh) {
        debugLog('Surface mesh not created. Creating now.');
        surface.createMesh();
      }
      
      if (!surface.mesh) {
        console.error('Failed to create surface mesh');
        return;
      }

      if (surface.mesh && surface.mesh.material) {
        if (this.config.useShaders && this.config.rimStrength > 0) {
          // Add rim lighting shader if enabled
          this.addRimLightingShader(surface.mesh);
          const material = surface.mesh.material as any;
          material.userData = { ...material.userData, hasRimShader: true };
        }
      }

      // Update data range based on surface data
      if (surface.data && surface.data.length > 0) {
        debugLog('Updating data range for surface with data');
        this.updateDataRange(surface.data);
      } else {
        debugLog('Surface has no data, using default ranges');
      }

      this.surfaces.set(id, surface);
      this.scene.add(surface.mesh);
      if (surface instanceof MultiLayerNeuroSurface) {
        surface.updateOutlineResolution(
          this.width,
          this.height,
          this.renderer.getPixelRatio()
        );
      }
      
      // Subscribe to surface events for automatic re-rendering
      surface.on('render:needed', () => this.requestRender());
      surface.on('visibility:changed', () => this.requestRender());
      surface.on('opacity:changed', () => this.requestRender());
      surface.on('material:updated', () => this.requestRender());
      surface.on('geometry:updated', () => this.requestRender());
      surface.on('layer:added', (event: any) => {
        const layer = event?.layer ?? null;
        const layerId = layer?.id ?? event?.layerId;
        if (!layerId) {
          this.requestRender();
          return;
        }
        this.emit('layer:added', {
          surfaceId,
          layerId,
          layer
        });
        this.requestRender();
      });
      surface.on('layer:removed', (event: any) => {
        if (!event?.layerId) {
          this.requestRender();
          return;
        }
        this.emit('layer:removed', {
          surfaceId,
          layerId: event.layerId,
          layer: null
        });
        this.requestRender();
      });
      surface.on('layer:updated', (event: any) => {
        const layer = event?.layer ?? null;
        const layerId = layer?.id ?? event?.layerId;
        if (!layerId) {
          this.requestRender();
          return;
        }
        this.emit('layer:updated', {
          surfaceId,
          layerId,
          layer,
          changes: event?.changes
        });
        this.requestRender();
      });
      
      // Emit viewer event
      this.emit('surface:added', { surface, id: surfaceId, surfaceId });

      // Fit camera/controls to current surfaces and set initial viewpoint
      this.centerCamera();
      if (this.surfaces.size === 1) {
        this.setViewpoint(this.viewpoint);
      }
      if (surface instanceof MultiLayerNeuroSurface && !this.selectedLayerId) {
        const layers = surface.layerStack.getAllLayers();
        if (layers.length) {
          this.selectedLayerId = layers[0].id;
          this.selectedSurfaceId = id;
        }
      }

      // Register with GPU picker if enabled
      if (this.gpuPicker && surface.mesh) {
        this.gpuPicker.addSurface(id, surface.mesh);
      }

      this.requestRender();
    } catch (error) {
      console.error('Error adding surface:', error);
      if (id && this.surfaces.has(id)) {
        this.surfaces.delete(id);
      }
    }
  }

  /**
   * Add a surface whose overlay values are sampled from a 3D volume texture on the GPU.
   *
   * Requires WebGL2 (sampler3D). Returns null when unsupported so callers can fall back
   * to a CPU-projected DataLayer path.
   */
  addVolumeProjectedSurface(
    geometry: SurfaceGeometry,
    handle: string,
    volumeConfig: {
      data: Float32Array | ArrayLike<number>;
      dims: [number, number, number];
      affineMatrix?: THREE.Matrix4 | ArrayLike<number>;
      worldToIJK?: THREE.Matrix4 | ArrayLike<number>;
      voxelSize?: [number, number, number];
      volumeOrigin?: [number, number, number];
      useHalfFloat?: boolean;
      fillValue?: number;
      projectionMode?: VolumeProjectionMode;
      pialPositions?: Float32Array | ArrayLike<number>;
      whitePositions?: Float32Array | ArrayLike<number>;
      ribbonSamples?: number;
      ribbonReducer?: RibbonReducer;
    },
    displayConfig: {
      colormap?: string;
      range?: [number, number];
      threshold?: [number, number];
      opacity?: number;
      baseColor?: THREE.ColorRepresentation;
    } = {}
  ): VolumeProjectedSurface | null {
    const supported = VolumeProjectedSurface.isSupported(this.renderer, {
      requireLinearFiltering: true,
      useHalfFloat: volumeConfig.useHalfFloat
    });

    if (!supported) {
      console.warn('GPU volume projection not supported (need WebGL2 + float linear filtering).');
      return null;
    }

    const surface = new VolumeProjectedSurface(geometry, {
      volumeData: volumeConfig.data,
      volumeDims: volumeConfig.dims,
      affineMatrix: volumeConfig.affineMatrix,
      worldToIJK: volumeConfig.worldToIJK,
      voxelSize: volumeConfig.voxelSize,
      volumeOrigin: volumeConfig.volumeOrigin,
      useHalfFloat: volumeConfig.useHalfFloat,
      fillValue: volumeConfig.fillValue ?? 0.0,
      projectionMode: volumeConfig.projectionMode,
      pialPositions: volumeConfig.pialPositions,
      whitePositions: volumeConfig.whitePositions,
      ribbonSamples: volumeConfig.ribbonSamples,
      ribbonReducer: volumeConfig.ribbonReducer,
      colormap: displayConfig.colormap ?? 'viridis',
      intensityRange: displayConfig.range ?? [0, 1],
      threshold: displayConfig.threshold ?? [0, 0],
      overlayOpacity: displayConfig.opacity ?? 1.0,
      baseColor: displayConfig.baseColor ?? 0x888888
    });

    this.addSurface(surface, handle);
    return surface;
  }

  setSurfaceVariant(surfaceId: string, variantName: string, options?: { animate?: boolean; duration?: number; ease?: (t: number) => number }): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) {
      console.warn(`NeuroSurfaceViewer: surface ${surfaceId} not found`);
      return;
    }
    if (!(surface instanceof VariantSurface)) {
      console.warn(`NeuroSurfaceViewer: surface ${surfaceId} does not support variants`);
      return;
    }
    surface.setVariant(variantName, options);
    if (this.variantBindingState) {
      this.variantBindingState.variant = variantName;
    }
    this.selectedSurfaceId = surfaceId;
    this.emit('surface:variant', { surfaceId, variant: variantName });
  }

  updateDataRange(data: Float32Array): void {
    if (!data || data.length === 0) {
      debugLog('No data provided to updateDataRange, using defaults');
      return;
    }

    // Filter out non-finite values for robust statistics
    const validData = Array.from(data).filter(v => isFinite(v));
    debugLog('Valid data points:', validData.length, 'out of', data.length);

    if (validData.length === 0) {
      debugLog('No valid data points found, using defaults');
      return;
    }

    let min = validData[0];
    let max = validData[0];
    for (let i = 1; i < validData.length; i++) {
      const v = validData[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }

    if (min === max) {
      // Prevent collapsed sliders/ranges
      const epsilon = Math.max(0.1, Math.abs(min) * 0.01 || 0.1);
      max = min + epsilon;
    }
    
    debugLog('Data range - Min:', min, 'Max:', max);
    
    this.dataRange = { min, max };

    if (this.intensityRange.range) {
      this.intensityRange.range.min = min;
      this.intensityRange.range.max = max;
    } else {
      this.intensityRange.range = { min, max };
    }

    // Keep threshold at 0 initially
    if (this.thresholdRange.range) {
      this.thresholdRange.range.min = 0;
      this.thresholdRange.range.max = 0;
    } else {
      this.thresholdRange.range = { min: 0, max: 0 };
    }

  }

  removeSurface(id: string): void {
    const surface = this.surfaces.get(id);
    if (surface && surface.mesh) {
      // Clean up event listeners
      surface.removeAllListeners();

      // Unregister from GPU picker
      if (this.gpuPicker) {
        this.gpuPicker.removeSurface(id);
      }

      this.scene.remove(surface.mesh);
      surface.dispose();
      this.surfaces.delete(id);

      // Emit viewer event
      this.emit('surface:removed', { surface, id, surfaceId: id });

      this.requestRender();
    }
  }

  addLayer(surfaceId: string, layer: RGBALayer | DataLayer | OutlineLayer): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface && surface instanceof MultiLayerNeuroSurface) {
      surface.addLayer(layer);
      if (layer instanceof DataLayer) {
        const layerData = layer.getData();
        if (layerData) {
          this.updateDataRange(layerData);
        }
      }
      // Make the newly added layer the active one for UI bindings
      this.selectedSurfaceId = surfaceId;
      this.selectedLayerId = layer.id;
      this.syncLayerBindingsFromSelection();
      this.requestRender();
    }
  }

  updateLayer(surfaceId: string, layerId: string, updates: Record<string, any>): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface && surface instanceof MultiLayerNeuroSurface) {
      surface.updateLayer(layerId, updates);
      this.requestRender();
    }
  }

  updateLayerData(surfaceId: string, layerId: string, data: Float32Array | number[], indices?: Uint32Array | number[] | null): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface && surface instanceof MultiLayerNeuroSurface) {
      surface.updateLayerData(layerId, data, indices);
      this.requestRender();
    }
  }

  updateLayerVisibility(surfaceId: string, layerId: string, visible: boolean): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface && surface instanceof MultiLayerNeuroSurface) {
      surface.updateLayerVisibility(layerId, visible);
      this.requestRender();
    }
  }

  removeLayer(surfaceId: string, layerId: string): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface && surface instanceof MultiLayerNeuroSurface) {
      surface.removeLayer(layerId);
      this.requestRender();
    }
  }

  clearLayers(surfaceId: string, options?: ClearLayersOptions): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface && surface instanceof MultiLayerNeuroSurface) {
      surface.clearLayers(options);
      this.requestRender();
    }
  }

  clearSurfaces(): void {
    // Detach any crosshair before surfaces are removed
    if (this.crosshair.visible) {
      this.hideCrosshair();
    }
    this.surfaces.forEach((surface, id) => {
      if (surface.mesh) {
        this.scene.remove(surface.mesh);
      }
      surface.dispose();
      this.annotations.removeBySurface(id);
    });
    this.surfaces.clear();
    this.requestRender();
  }

  addRimLightingShader(mesh: THREE.Mesh): void {
    const material = mesh.material as THREE.Material;
    if ((material as any).userData?.hasRimShader) {
      return;
    }
    const rimStrengthUniform = { value: this.config.rimStrength };
    this.rimStrengthUniforms.push(rimStrengthUniform);

    material.onBeforeCompile = (shader) => {
      shader.uniforms.rimStrength = rimStrengthUniform;
      
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `
        #include <common>
        uniform float rimStrength;
        `
      );
      
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
        #include <dithering_fragment>
        
        // Rim lighting
        #ifndef FLAT_SHADED
          vec3 surfviewRimNormal = normalize(vNormal);
          vec3 surfviewViewDir = normalize(vViewPosition);
          float surfviewRim = 1.0 - abs(dot(surfviewViewDir, surfviewRimNormal));
          surfviewRim = pow(surfviewRim, 2.0);
          gl_FragColor.rgb += surfviewRim * rimStrength;
        #endif
        `
      );
    };
    
    material.userData = { ...(material as any).userData, hasRimShader: true };
    material.needsUpdate = true;
  }

  setupPicking(): void {
    // Initialize GPU picker if enabled and supported
    if (this.config.useGPUPicking && GPUPicker.isSupported(this.renderer)) {
      this.gpuPicker = new GPUPicker(this.renderer);
      debugLog('GPU picking enabled');
    }

    // Mouse event handlers
    this.handleMouseMove = (event: MouseEvent) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.emit('mouse:move', {
        position: this.mouse.clone(),
        intersection: this.getIntersectionPoint().clone()
      });
      this.updateHoverCrosshair(event);
    };
    this.renderer.domElement.addEventListener('mousemove', this.handleMouseMove);
  }

  private setupSurfaceClick(): void {
    if (!this.handleSurfaceClick) {
      this.handleSurfaceClick = this.onSurfaceClickHandler.bind(this);
    }
    this.renderer.domElement.addEventListener('click', this.handleSurfaceClick);
  }

  private onSurfaceClickHandler(event: MouseEvent): void {
    const hit = this.pick({ x: event.clientX, y: event.clientY });
    const rect = this.renderer.domElement.getBoundingClientRect();
    const position = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.emit('mouse:click', {
      position,
      surface: hit.surfaceId ? this.surfaces.get(hit.surfaceId) ?? null : null,
      point: hit.point
    });

    if (!hit.surfaceId || hit.vertexIndex === null) return;

    const surface = this.surfaces.get(hit.surfaceId);
    const pickMetadata = surface?.getPickMetadata(hit.vertexIndex) || {};
    const payload = {
      surfaceId: hit.surfaceId,
      point: hit.point!,
      vertexIndex: hit.vertexIndex,
      ...pickMetadata
    } as SurfacePickEvent;

    const parcelPayload: ParcelInteractionEvent = {
      surfaceId: payload.surfaceId,
      point: payload.point,
      vertexIndex: payload.vertexIndex,
      parcelId: payload.parcelId ?? null,
      parcel: (payload.parcel as Record<string, unknown> | null | undefined) ?? null,
      parcelLabel: payload.parcelLabel ?? null,
      atlasId: payload.atlasId ?? null
    };

    // Emit callback/event
    if (this.onSurfaceClick) {
      this.onSurfaceClick(payload as any);
    }
    this.emit('surface:click', payload);
    if (parcelPayload.parcelId !== null) {
      this.emit('parcel:click', parcelPayload);
    }

    // Optional click-to-annotate
    if (this.config.clickToAddAnnotation) {
      const id = this.addAnnotation(hit.surfaceId, hit.vertexIndex);
      if (id) {
        this.activateAnnotation(id, { exclusive: true });
      }
    }

    // Always show selection crosshair on click
    this.showCrosshair(hit.surfaceId, hit.vertexIndex, { size: this.crosshair.size, color: this.crosshair.color, mode: 'selection' });
  }

  private updateHoverCrosshair(event?: MouseEvent): void {
    if (!this.crosshair.canHoverUpdate()) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = event ? event.clientX : (rect.left + rect.width / 2);
    const y = event ? event.clientY : (rect.top + rect.height / 2);

    const hit = this.pick({ x, y });
    if (hit.surfaceId && hit.vertexIndex !== null) {
      const surface = this.surfaces.get(hit.surfaceId);
      const pickMetadata = surface?.getPickMetadata(hit.vertexIndex) || {};
      const payload = {
        surfaceId: hit.surfaceId,
        vertexIndex: hit.vertexIndex,
        screenX: x,
        screenY: y,
        ...pickMetadata
      } as VertexHoverEvent;

      const parcelPayload: ParcelInteractionEvent = {
        surfaceId: payload.surfaceId,
        vertexIndex: payload.vertexIndex,
        screenX: payload.screenX,
        screenY: payload.screenY,
        parcelId: payload.parcelId ?? null,
        parcel: (payload.parcel as Record<string, unknown> | null | undefined) ?? null,
        parcelLabel: payload.parcelLabel ?? null,
        atlasId: payload.atlasId ?? null
      };

      if (this.config.hoverCrosshair && this.crosshair.mode !== 'selection') {
        this.showCrosshair(hit.surfaceId, hit.vertexIndex, {
          size: this.config.hoverCrosshairSize ?? 1.2,
          color: this.config.hoverCrosshairColor ?? 0x66ccff,
          mode: 'hover'
        });
      }
      this.emit('vertex:hover', payload);
      this.emit('parcel:hover', parcelPayload);
    } else {
      if (this.crosshair.mode === 'hover') {
        this.hideCrosshair();
      }
      this.emit('vertex:hover', {
        surfaceId: null,
        vertexIndex: null,
        screenX: x,
        screenY: y
      });
      this.emit('parcel:hover', {
        surfaceId: null,
        vertexIndex: null,
        screenX: x,
        screenY: y,
        parcelId: null,
        parcel: null,
        parcelLabel: null,
        atlasId: null
      } as ParcelInteractionEvent);
    }
  }

  setParcelHover(
    surfaceId: string,
    parcelId: number | null,
    options: ParcelFocusOptions = {}
  ): boolean {
    return this.setParcelFocus('hover', surfaceId, parcelId, options);
  }

  setParcelSelection(
    surfaceId: string,
    parcelId: number | null,
    options: ParcelFocusOptions = {}
  ): boolean {
    return this.setParcelFocus('selection', surfaceId, parcelId, options);
  }

  clearParcelHover(options: ParcelFocusOptions = {}): void {
    if (this.crosshair.mode === 'hover') {
      this.hideCrosshair();
    }
    if (options.emitEvent ?? true) {
      this.emit('parcel:hover', {
        surfaceId: null,
        vertexIndex: null,
        screenX: options.screenX,
        screenY: options.screenY,
        parcelId: null,
        parcel: null,
        parcelLabel: null,
        atlasId: null
      } as ParcelInteractionEvent);
      this.emit('vertex:hover', {
        surfaceId: null,
        vertexIndex: null,
        screenX: options.screenX ?? 0,
        screenY: options.screenY ?? 0
      } as VertexHoverEvent);
    }
  }

  clearParcelSelection(options: ParcelFocusOptions = {}): void {
    if (this.crosshair.mode === 'selection') {
      this.hideCrosshair();
    }
    if (options.emitEvent ?? true) {
      this.emit('parcel:selected', {
        surfaceId: null,
        point: null,
        vertexIndex: null,
        parcelId: null,
        parcel: null,
        parcelLabel: null,
        atlasId: null,
        selected: false
      } as ParcelSelectionEvent);
    }
  }

  pick(options: { x?: number; y?: number; opacityThreshold?: number; useGPU?: boolean } = {}): { surfaceId: string | null; vertexIndex: number | null; point: THREE.Vector3 | null } {
    // Allow callers to override the last mouse position with screen coordinates
    if (options.x !== undefined && options.y !== undefined) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((options.x - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((options.y - rect.top) / rect.height) * 2 + 1;
    }

    // Use GPU picking if enabled and available
    const useGPU = options.useGPU ?? true;
    if (useGPU && this.gpuPicker && options.x !== undefined && options.y !== undefined) {
      const result = this.gpuPicker.pick(options.x, options.y, this.camera);
      return {
        surfaceId: result.surfaceId,
        vertexIndex: result.vertexIndex,
        point: result.point
      };
    }

    const opacityThreshold = options.opacityThreshold ?? 0.1;

    // Update the raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Collect intersections (Three.js sorts by distance)
    const intersects: THREE.Intersection[] = [];
    this.surfaces.forEach((surface, id) => {
      if (!surface.mesh) return;
      const material = surface.mesh.material as THREE.Material | THREE.Material[];

      const isTransparent = Array.isArray(material)
        ? material.every(mat => (mat as any).opacity !== undefined && (mat as any).opacity < opacityThreshold)
        : ((material as any).opacity !== undefined && (material as any).opacity < opacityThreshold);
      if (isTransparent) return;

      const surfaceIntersects = this.raycaster.intersectObject(surface.mesh, false);
      surfaceIntersects.forEach(intersect => {
        (intersect as any).surfaceId = id;
      });
      intersects.push(...surfaceIntersects);
    });

    if (intersects.length === 0) {
      return { surfaceId: null, vertexIndex: null, point: null };
    }

    const hit = intersects[0];
    const face = hit.face;
    const mesh = hit.object as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;

    if (!face || !positionAttr) {
      return { surfaceId: (hit as any).surfaceId || null, vertexIndex: null, point: hit.point.clone() };
    }

    // Find the closest vertex of the intersected face in world space
    const faceIndices = [face.a, face.b, face.c];
    const worldMatrix = mesh.matrixWorld;
    let closestIndex = faceIndices[0];
    let closestDist = Infinity;
    const tmp = new THREE.Vector3();

    for (const idx of faceIndices) {
      tmp.set(
        positionAttr.getX(idx),
        positionAttr.getY(idx),
        positionAttr.getZ(idx)
      ).applyMatrix4(worldMatrix);

      const dist = tmp.distanceToSquared(hit.point);
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = idx;
      }
    }

    return {
      surfaceId: (hit as any).surfaceId || null,
      vertexIndex: closestIndex,
      point: hit.point.clone()
    };
  }

  // Lightweight option bag for embed environments (e.g. R HTML widgets)
  setOption(key: string, value: any): void {
    this.options.set(key, value);
  }

  getOption<T = any>(key: string, fallback?: T): T | undefined {
    return (this.options.has(key) ? this.options.get(key) : fallback) as T | undefined;
  }

  /**
   * Enable GPU-based picking for faster vertex selection.
   * Automatically registers all existing surfaces with the GPU picker.
   */
  enableGPUPicking(): boolean {
    if (this.gpuPicker) {
      this.gpuPicker.setEnabled(true);
      return true;
    }
    if (!GPUPicker.isSupported(this.renderer)) {
      console.warn('GPU picking not supported on this device');
      return false;
    }
    this.gpuPicker = new GPUPicker(this.renderer);
    // Register all existing surfaces
    this.surfaces.forEach((surface, id) => {
      if (surface.mesh) {
        this.gpuPicker!.addSurface(id, surface.mesh);
      }
    });
    debugLog('GPU picking enabled');
    return true;
  }

  /**
   * Disable GPU-based picking. Falls back to raycasting.
   */
  disableGPUPicking(): void {
    if (this.gpuPicker) {
      this.gpuPicker.setEnabled(false);
    }
  }

  /**
   * Check if GPU picking is currently enabled and available.
   */
  isGPUPickingEnabled(): boolean {
    return this.gpuPicker !== null && this.gpuPicker.isEnabled();
  }

  /**
   * Get the GPU picker instance (for advanced usage).
   */
  getGPUPicker(): GPUPicker | null {
    return this.gpuPicker;
  }

  addAnnotation(surfaceId: string, vertexIndex: number, data?: any, options?: { radius?: number; colorOn?: number; colorOff?: number; active?: boolean }): string | null {
    return this.annotations.add(surfaceId, vertexIndex, data, options);
  }

  listAnnotations(surfaceId?: string): AnnotationRecord[] {
    return this.annotations.list(surfaceId);
  }

  moveAnnotation(id: string, vertexIndex: number): boolean {
    return this.annotations.move(id, vertexIndex);
  }

  removeAnnotations(surfaceId: string): void {
    this.annotations.removeBySurface(surfaceId);
  }

  removeAnnotation(id: string): void {
    this.annotations.remove(id);
  }

  clearAnnotations(): void {
    this.annotations.reset();
  }

  activateAnnotation(id: string, options?: { exclusive?: boolean }): void {
    this.annotations.activate(id, options);
  }

  getAnnotation(id: string) {
    return this.annotations.get(id);
  }

  showCrosshair(surfaceId: string, vertexIndex: number, options?: CrosshairOptions): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface || !surface.mesh) {
      console.warn(`Crosshair: surface ${surfaceId} not found or missing mesh`);
      return;
    }
    this.crosshair.show(surface.mesh, surfaceId, vertexIndex, options);
  }

  hideCrosshair(): void {
    this.crosshair.hide();
  }

  private setParcelFocus(
    mode: 'hover' | 'selection',
    surfaceId: string,
    parcelId: number | null,
    options: ParcelFocusOptions = {}
  ): boolean {
    if (parcelId === null) {
      if (mode === 'hover') {
        this.clearParcelHover(options);
      } else {
        this.clearParcelSelection(options);
      }
      return true;
    }

    const payload = this.buildParcelInteractionPayload(surfaceId, parcelId, options);
    if (!payload) {
      return false;
    }

    const focusVertexIndex = payload.vertexIndex;
    if (focusVertexIndex === null) {
      return false;
    }

    if (options.showCrosshair ?? true) {
      this.showCrosshair(surfaceId, focusVertexIndex, {
        size: mode === 'hover'
          ? (this.config.hoverCrosshairSize ?? 1.2)
          : this.crosshair.size,
        color: mode === 'hover'
          ? (this.config.hoverCrosshairColor ?? 0x66ccff)
          : this.crosshair.color,
        mode
      });
    }

    if (options.emitEvent ?? true) {
      if (mode === 'hover') {
        this.emit('vertex:hover', {
          surfaceId: payload.surfaceId,
          vertexIndex: payload.vertexIndex,
          screenX: options.screenX ?? 0,
          screenY: options.screenY ?? 0,
          parcelId: payload.parcelId,
          parcel: payload.parcel,
          parcelLabel: payload.parcelLabel,
          atlasId: payload.atlasId
        } as VertexHoverEvent);
        this.emit('parcel:hover', {
          ...payload,
          screenX: options.screenX,
          screenY: options.screenY
        } as ParcelInteractionEvent);
      } else {
        this.emit('parcel:selected', {
          ...payload,
          selected: true
        } as ParcelSelectionEvent);
      }
    }

    this.requestRender();
    return true;
  }

  private buildParcelInteractionPayload(
    surfaceId: string,
    parcelId: number,
    _options: ParcelFocusOptions = {}
  ): ParcelInteractionEvent | null {
    const surface = this.surfaces.get(surfaceId) as any;
    if (!surface) {
      return null;
    }

    let vertexIndex: number | null = null;
    if (typeof surface.getRepresentativeVertexIndex === 'function') {
      vertexIndex = surface.getRepresentativeVertexIndex(parcelId);
    }

    if (vertexIndex === null || vertexIndex === undefined) {
      return null;
    }

    const point = this.getWorldPositionForVertex(surface, vertexIndex);
    const parcel = typeof surface.getParcelRecord === 'function'
      ? (surface.getParcelRecord(parcelId) ?? null)
      : null;

    return {
      surfaceId,
      point,
      vertexIndex,
      parcelId,
      parcel,
      parcelLabel: parcel?.label ?? null,
      atlasId: typeof surface.getParcelData === 'function'
        ? surface.getParcelData()?.atlas?.id ?? null
        : null
    };
  }

  private getWorldPositionForVertex(surface: NeuroSurface, vertexIndex: number): THREE.Vector3 | null {
    if (!surface.mesh) {
      return null;
    }

    const geometry = surface.mesh.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position || vertexIndex < 0 || vertexIndex >= position.count) {
      return null;
    }

    return new THREE.Vector3(
      position.getX(vertexIndex),
      position.getY(vertexIndex),
      position.getZ(vertexIndex)
    ).applyMatrix4(surface.mesh.matrixWorld);
  }

  toggleCrosshair(surfaceId?: string, vertexIndex?: number, options?: CrosshairOptions): void {
    const targetSurface = surfaceId ?? this.crosshair.surfaceId;
    const mesh = targetSurface ? this.surfaces.get(targetSurface)?.mesh ?? null : null;
    this.crosshair.toggle(mesh, surfaceId, vertexIndex, options);
  }

  requestRender(): void {
    const shouldEmit = this.needsRender !== true;
    this.needsRender = true;
    if (shouldEmit) {
      this.emit('render:needed');
    }
  }

  animate(): void {
    if (this.initializationFailed) return;
    this.animationId = requestAnimationFrame(this.animate);
    
    // Update FPS graph if it exists
    if (this.fpsGraph) {
      (this.fpsGraph as any).begin();
    }
    
    // Update controls
    if (this.controls && this.controlsEnabled) {
      this.controls.update();
    }
    
    // Render only if needed
    if (this.needsRender || (this.controls as any).enableDamping) {
      this.render();
      this.needsRender = false;
    }
    
    if (this.fpsGraph) {
      (this.fpsGraph as any).end();
    }
  }

  render(): void {
    if (this.initializationFailed) return;
    // Emit before render event
    this.emit('render:before');
    
    if (this.config.useShaders && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    
    // Emit after render event
    this.emit('render:after');
  }

  startRenderLoop(): void {
    // Prevent multiple animation loops
    if (this.animationId) return;
    
    // Start the animation loop
    this.animate();
  }

  /**
   * Back-compat alias for htmlwidgets callers.
   */
  start(): void {
    this.startRenderLoop();
  }

  /**
   * Stop the animation loop if running.
   */
  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  centerCamera(): void {
    // Collect all surface geometries
    const surfaceGeometries: Array<{ vertices: Float32Array }> = [];
    
    this.surfaces.forEach(surface => {
      if (surface.geometry && surface.geometry.vertices) {
        surfaceGeometries.push({ vertices: surface.geometry.vertices });
      }
    });
    
    if (surfaceGeometries.length === 0) {
      // No surfaces found, use default positioning
      this.camera.position.set(0, 0, this.config.initialZoom);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);
      if (this.controls) {
        this.controls.target.set(0, 0, 0);
        (this.controls as any).minDistance = 0.05;
        (this.controls as any).maxDistance = Infinity;
        this.controls.update();
      }
      return;
    }
    
    // Compute combined bounds for all surfaces
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    surfaceGeometries.forEach(surface => {
      const b = BoundingBoxHelper.calculateBounds(surface.vertices);
      minX = Math.min(minX, b.min.x);
      minY = Math.min(minY, b.min.y);
      minZ = Math.min(minZ, b.min.z);
      maxX = Math.max(maxX, b.max.x);
      maxY = Math.max(maxY, b.max.y);
      maxZ = Math.max(maxZ, b.max.z);
    });

    const center = new THREE.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    );
    const size = new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ);
    const radius = size.length() / 2;
    this.sceneBoundsRadius = radius;

    // Calculate optimal camera distance with padding
    const optimalDistance = BoundingBoxHelper.calculateCameraDistance(
      radius,
      this.camera.fov,
      this.camera.aspect
    );

    // Position camera straight on +Z looking at center; reset roll
    this.camera.position.copy(center).add(new THREE.Vector3(0, 0, optimalDistance));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);

    // Update controls target and zoom limits
    if (this.controls) {
      this.controls.target.copy(center);
      (this.controls as any).minDistance = Math.max(radius * 0.6, 0.05);
      (this.controls as any).maxDistance = Math.max(radius * 20, optimalDistance * 2);
      this.controls.update();
    }

    // Update near/far planes for scene size
    this.camera.near = Math.max(optimalDistance / 1000, 0.001);
    this.camera.far = optimalDistance * 10;
    this.camera.updateProjectionMatrix();

    // Store initial zoom for reset
    this.config.initialZoom = optimalDistance;
    
    this.requestRender();
  }

  setZoom(distance: number, options: { updateInitial?: boolean } = {}): void {
    const target = this.controls?.target ?? new THREE.Vector3(0, 0, 0);
    const dir = new THREE.Vector3().subVectors(this.camera.position, target).normalize();
    const minClamp = this.sceneBoundsRadius > 0 ? Math.max(0.05, this.sceneBoundsRadius * 0.6) : 0.05;
    const maxClamp = this.sceneBoundsRadius > 0 ? Math.max(this.sceneBoundsRadius * 20, distance) : Infinity;
    const safeDistance = Math.min(maxClamp, Math.max(minClamp, distance));
    this.camera.position.copy(target).addScaledVector(dir, safeDistance);
    this.camera.updateProjectionMatrix();
    if (this.controls?.update) {
      this.controls.update();
    }
    if (options.updateInitial !== false) {
      this.config.initialZoom = safeDistance;
    }
    this.requestRender();
  }

  resize(width: number, height: number, options: { dpr?: number } = {}): { width: number; height: number; dpr: number } {
    const dpr = options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);
    this.renderer.setPixelRatio(dpr);
    this.width = width;
    this.height = height;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    
    this.renderer.setSize(width, height);
    
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    
    if (this.ssaoPass) {
      this.ssaoPass.setSize(width, height);
    }

    this.surfaces.forEach(surface => {
      if (surface instanceof MultiLayerNeuroSurface) {
        surface.updateOutlineResolution(width, height, dpr);
      }
    });
    
    this.emit('resize', { width, height });
    this.requestRender();
    return { width, height, dpr };
  }

  // -------------------------------------------------------------------------
  // State Serialization
  // -------------------------------------------------------------------------

  /** Capture the entire viewer state as a JSON-compatible object. */
  toJSON(): ViewerStateV1 {
    return serialize(this);
  }

  /** Restore viewer state from a serialized object. */
  fromJSON(state: ViewerStateV1): RestorationReport {
    return deserialize(this, state);
  }

  /** Export viewer state plus provenance as a portable SurfView scene manifest. */
  exportScene(options?: SceneExportOptions): SceneExportManifest {
    return buildSceneExport(this, options);
  }

  /** Export viewer state plus provenance as a JSON scene manifest string. */
  exportSceneJSON(options?: SceneExportOptions): string {
    return buildSceneExportJSON(this, options);
  }

  /** Export viewer state plus provenance as a scene manifest Blob. */
  exportSceneBlob(options?: SceneExportOptions): Blob {
    return buildSceneExportBlob(this, options);
  }

  /** Export a standalone HTML shell that embeds the scene manifest. */
  exportStaticHTML(options?: StaticHTMLExportOptions): string {
    return buildStaticHTMLExport(this, options);
  }

  /**
   * Export the current view as a high-resolution PNG data URL.
   *
   * The renderer is temporarily resized to the requested pixel dimensions, rendered,
   * copied into a 2D export canvas, annotated with optional figure overlays, and then
   * restored to its previous interactive size.
   */
  exportPNG(options: FigureExportOptions = {}): string {
    if (!this.renderer || !this.renderer.domElement) {
      throw new Error('exportPNG requires an initialized WebGL renderer');
    }
    if (typeof document === 'undefined') {
      throw new Error('exportPNG requires a browser document');
    }

    const exportOptions = resolveFigureExportOptions(
      options.preset ?? this.stylePreset ?? this.config.preset,
      options,
      { width: this.width, height: this.height }
    );

    const previousSize = new THREE.Vector2();
    this.renderer.getSize(previousSize);
    const previousPixelRatio = this.renderer.getPixelRatio();
    const previousClearColor = new THREE.Color();
    this.renderer.getClearColor(previousClearColor);
    const previousClearAlpha = this.renderer.getClearAlpha();
    const previousBackground = this.container.style.background;

    try {
      this.renderer.setPixelRatio(1);
      this.resize(exportOptions.width, exportOptions.height, { dpr: 1 });
      this.renderer.setClearColor(
        exportOptions.backgroundColor,
        exportOptions.transparent ? 0 : 1
      );
      this.render();

      const canvas = document.createElement('canvas');
      canvas.width = exportOptions.width;
      canvas.height = exportOptions.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('exportPNG could not create a 2D canvas context');
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!exportOptions.transparent) {
        ctx.fillStyle = colorToCSS(exportOptions.backgroundColor);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(this.renderer.domElement, 0, 0, canvas.width, canvas.height);
      this.drawFigureOverlays(ctx, exportOptions);

      const dataUrl = canvas.toDataURL('image/png');
      if (exportOptions.downloadFilename) {
        this.downloadDataURL(dataUrl, exportOptions.downloadFilename);
      }
      return dataUrl;
    } finally {
      this.renderer.setClearColor(previousClearColor, previousClearAlpha);
      this.container.style.background = previousBackground;
      this.resize(previousSize.x, previousSize.y, { dpr: previousPixelRatio });
      this.render();
    }
  }

  private drawFigureOverlays(ctx: CanvasRenderingContext2D, options: ResolvedFigureExportOptions): void {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const fontScale = options.fontScale;

    if (options.title) {
      ctx.save();
      ctx.fillStyle = options.transparent ? '#111827' : this.readableTextColor(options.backgroundColor);
      ctx.font = `${Math.round(24 * fontScale)}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(options.title, 28 * fontScale, 24 * fontScale);
      if (options.subtitle) {
        ctx.font = `${Math.round(14 * fontScale)}px sans-serif`;
        ctx.fillText(options.subtitle, 28 * fontScale, 56 * fontScale);
      }
      ctx.restore();
    }

    if (options.colorbar) {
      this.drawExportColorbar(ctx, options);
    }
    if (options.scaleBar) {
      this.drawExportScaleBar(ctx, options);
    }
    if (options.roiLabels) {
      this.drawExportLabels(ctx, options.roiLabels, options);
    }

    // Keep exports visibly bounded when transparent output is requested.
    if (options.transparent) {
      ctx.save();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.12)';
      ctx.lineWidth = Math.max(1, width / 1600);
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
      ctx.restore();
    }
  }

  private drawExportColorbar(ctx: CanvasRenderingContext2D, options: ResolvedFigureExportOptions): void {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const fontScale = options.fontScale;
    const barWidth = Math.max(16, Math.round(width * 0.018));
    const barHeight = Math.max(140, Math.round(height * 0.28));
    const x = width - barWidth - Math.round(40 * fontScale);
    const y = height - barHeight - Math.round(44 * fontScale);
    const gradient = ctx.createLinearGradient(0, y + barHeight, 0, y);

    const colors = options.colorbarColors.length > 0 ? options.colorbarColors : ['#000000', '#ffffff'];
    colors.forEach((color, index) => {
      gradient.addColorStop(colors.length === 1 ? 0 : index / (colors.length - 1), color);
    });

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.fillRect(x - 8, y - 8, barWidth + 58 * fontScale, barHeight + 36 * fontScale);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.lineWidth = Math.max(1, fontScale);
    ctx.strokeRect(x, y, barWidth, barHeight);

    ctx.fillStyle = '#111827';
    ctx.font = `${Math.round(12 * fontScale)}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(options.colorbarLabel, x + barWidth + 10 * fontScale, y + barHeight / 2);
    if (options.colorbarRange) {
      const [min, max] = options.colorbarRange;
      ctx.font = `${Math.round(10 * fontScale)}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(String(max), x + barWidth + 10 * fontScale, y - 1);
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(min), x + barWidth + 10 * fontScale, y + barHeight + 1);
    }
    ctx.restore();
  }

  private drawExportScaleBar(ctx: CanvasRenderingContext2D, options: ResolvedFigureExportOptions): void {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const fontScale = options.fontScale;
    const barWidth = Math.max(64, Math.round(width * options.scaleBarLength));
    const x = Math.round(44 * fontScale);
    const y = height - Math.round(48 * fontScale);
    const color = options.transparent ? '#111827' : this.readableTextColor(options.backgroundColor);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, Math.round(3 * fontScale));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + barWidth, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - 7 * fontScale);
    ctx.lineTo(x, y + 7 * fontScale);
    ctx.moveTo(x + barWidth, y - 7 * fontScale);
    ctx.lineTo(x + barWidth, y + 7 * fontScale);
    ctx.stroke();
    if (options.scaleBarLabel) {
      ctx.fillStyle = color;
      ctx.font = `${Math.round(12 * fontScale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(options.scaleBarLabel, x + barWidth / 2, y - 10 * fontScale);
    }
    ctx.restore();
  }

  private drawExportLabels(
    ctx: CanvasRenderingContext2D,
    labels: boolean | FigureExportLabel[],
    options: ResolvedFigureExportOptions
  ): void {
    const fontScale = options.fontScale;
    const resolvedLabels = Array.isArray(labels)
      ? labels
      : this.annotationLabelsForExport();
    if (resolvedLabels.length === 0) return;

    ctx.save();
    ctx.font = `${Math.round(12 * fontScale)}px sans-serif`;
    ctx.textBaseline = 'middle';
    resolvedLabels.forEach(label => {
      const x = label.normalized ? label.x * ctx.canvas.width : label.x;
      const y = label.normalized ? label.y * ctx.canvas.height : label.y;
      const text = label.text;
      const paddingX = 5 * fontScale;
      const paddingY = 3 * fontScale;
      const metrics = ctx.measureText(text);
      const boxWidth = metrics.width + paddingX * 2;
      const boxHeight = 16 * fontScale + paddingY * 2;
      ctx.fillStyle = label.background ?? 'rgba(255, 255, 255, 0.82)';
      ctx.fillRect(x - paddingX, y - boxHeight / 2, boxWidth, boxHeight);
      ctx.fillStyle = label.color ?? options.preset.roi.labelColor;
      ctx.fillText(text, x, y);
    });
    ctx.restore();
  }

  private annotationLabelsForExport(): FigureExportLabel[] {
    return this.annotations.list().map(record => {
      const projected = record.position.clone().project(this.camera);
      const text = String(
        record.data?.label ??
        record.data?.name ??
        record.id
      );
      return {
        text,
        x: (projected.x * 0.5 + 0.5) * this.width,
        y: (-projected.y * 0.5 + 0.5) * this.height
      };
    });
  }

  private readableTextColor(backgroundColor: number): string {
    const r = (backgroundColor >> 16) & 255;
    const g = (backgroundColor >> 8) & 255;
    const b = backgroundColor & 255;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance > 0.55 ? '#111827' : '#f8fafc';
  }

  private downloadDataURL(dataUrl: string, filename: string): void {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
  }

  /** Encode the current viewer state as a URL hash fragment. */
  toURL(baseUrl?: string): string {
    const state = this.toJSON();
    const hash = encode(state);
    const base = baseUrl ?? (typeof window !== 'undefined' ? window.location.href.split('#')[0] : '');
    return `${base}#${hash}`;
  }

  /** Restore viewer state from a URL hash fragment. */
  fromURL(url?: string): RestorationReport {
    const src = url ?? (typeof window !== 'undefined' ? window.location.hash : '');
    const state = decode(src);
    return this.fromJSON(state);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.initializationFailed) return;
    // Stop animation loop
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }

    this.plugins.dispose();
    
    // Dispose of all surfaces
    this.clearSurfaces();
    
    // Dispose of controls
    if (this.controls) {
      if ('removeEventListener' in this.controls) {
        (this.controls as any).removeEventListener('change', this.onControlsChange);
      }
      this.controls.dispose();
    }
    
    // Dispose of post-processing
    if (this.composer) {
      this.composer.dispose();
    }

    // Dispose of GPU picker
    if (this.gpuPicker) {
      this.gpuPicker.dispose();
      this.gpuPicker = null;
    }

    // Dispose of environment map
    if (this.environmentMap) {
      this.environmentMap.dispose();
    }

    // Detach listeners
    this.renderer.domElement.removeEventListener('click', this.handleSurfaceClick);
    if (this.handleMouseMove) {
      this.renderer.domElement.removeEventListener('mousemove', this.handleMouseMove);
    }
    if (this.handlePanePointerMove) {
      window.removeEventListener('pointermove', this.handlePanePointerMove);
    }
    if (this.handlePanePointerUp) {
      window.removeEventListener('pointerup', this.handlePanePointerUp);
      window.removeEventListener('pointercancel', this.handlePanePointerUp);
    }

    // Dispose of crosshair resources
    this.crosshair.dispose();

    // Dispose annotations
    if (this.annotations) {
      this.annotations.dispose();
    }

    // Dispose of renderer
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    
    // Remove from DOM
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    
    // Dispose of Tweakpane
    if (this.pane) {
      this.pane.dispose();
    }
    if (this.paneContainer && this.paneContainer.parentNode) {
      this.paneContainer.parentNode.removeChild(this.paneContainer);
    }
  }

  private hasDOM(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined' && !!document.createElement;
  }

  private isWebGLAvailable(): boolean {
    if (!this.hasDOM()) return false;
    return typeof WebGLRenderingContext !== 'undefined' ||
      typeof WebGL2RenderingContext !== 'undefined';
  }

  private renderFallback(message: string): void {
    if (!this.hasDOM() || !this.container) {
      console.warn(message);
      return;
    }
    const fallback = document.createElement('div');
    fallback.textContent = message;
    fallback.style.color = '#fff';
    fallback.style.background = '#000';
    fallback.style.padding = '12px';
    fallback.style.fontFamily = 'sans-serif';
    fallback.style.fontSize = '14px';
    fallback.style.textAlign = 'center';
    fallback.style.width = '100%';
    fallback.style.height = '100%';
    fallback.style.display = 'flex';
    fallback.style.alignItems = 'center';
    fallback.style.justifyContent = 'center';
    fallback.style.boxSizing = 'border-box';
    this.container.innerHTML = '';
    this.container.appendChild(fallback);
  }

  // Get current visibility state of controls
  getControlsVisible(): boolean {
    return false;
  }

  /** @deprecated Tweakpane controls are disabled; use report controls or a plugin. */
  toggleControls(show?: boolean): void {
    void show;
    warnLegacyControlsDeprecated();
    this.config.showControls = false;
    this.config.useControls = false;
  }

  togglePaneMinimized(): void {
    this.setPaneMinimized(!this.paneDragState.minimized);
  }

  minimizeControlsPane(): void {
    this.setPaneMinimized(true);
  }

  restoreControlsPane(): void {
    this.setPaneMinimized(false);
  }

  private disposePane(): void {
    if (this.pane) {
      try {
        this.pane.dispose();
      } catch (err) {
        console.warn('Failed to dispose pane', err);
      }
    }
    if (this.paneContainer && this.paneContainer.parentElement) {
      this.paneContainer.parentElement.removeChild(this.paneContainer);
    }
    this.pane = null;
    this.paneContainer = null;
    this.paneContentEl = null;
    this.paneHandleEl = null;
    this.paneMinimizeButtonEl = null;
    this.paneLoading = false;
  }

  private setPaneMinimized(minimized: boolean): void {
    this.paneDragState.minimized = minimized;
    if (this.paneContentEl) {
      this.paneContentEl.style.display = minimized ? 'none' : 'block';
    }
    if (this.paneMinimizeButtonEl) {
      this.paneMinimizeButtonEl.textContent = minimized ? '+' : '–';
      this.paneMinimizeButtonEl.title = minimized ? 'Restore controls' : 'Minimize controls';
    }
  }

  enableControls(): void {
    this.controlsEnabled = true;
    this.emit('controls:changed', { enabled: true });
  }

  disableControls(): void {
    this.controlsEnabled = false;
    this.emit('controls:changed', { enabled: false });
  }

  getIntersectionPoint(): THREE.Vector3 {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Create a plane at origin facing the camera
    const planeNormal = new THREE.Vector3(0, 0, 1);
    planeNormal.applyQuaternion(this.camera.quaternion);
    const plane = new THREE.Plane(planeNormal, 0);
    
    // Get intersection with plane
    this.raycaster.ray.intersectPlane(plane, this.intersectionPoint);
    
    return this.intersectionPoint;
  }

  getRayDirection(): THREE.Vector3 {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    return this.raycaster.ray.direction.clone();
  }

  updateSurfaceData(surfaceId: string, data: Float32Array, indices?: Uint32Array): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface instanceof ColorMappedNeuroSurface) {
      surface.setData(data);
      this.updateDataRange(data);
      this.requestRender();
    }
  }

  updateColorMap(surfaceId: string, colormap: ColorMap | string): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface instanceof ColorMappedNeuroSurface) {
      surface.setColorMap(colormap);
      this.requestRender();
    }
  }

  getSurface(id: string): NeuroSurface | undefined {
    return this.surfaces.get(id);
  }

  getSurfaceIds(): string[] {
    return Array.from(this.surfaces.keys());
  }

  updateConfig(newConfig: Partial<NeuroSurfaceViewerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Apply relevant updates
    if (newConfig.ambientLightColor !== undefined) {
      this.updateAmbientLight(newConfig.ambientLightColor);
      this.config.ambientLightColor = newConfig.ambientLightColor;
    }
    if (newConfig.directionalLightColor !== undefined) {
      this.updateDirectionalLight(newConfig.directionalLightColor);
      this.config.directionalLightColor = newConfig.directionalLightColor;
    }
    if (newConfig.directionalLightIntensity !== undefined) {
      this.updateDirectionalLightIntensity(newConfig.directionalLightIntensity);
      this.config.directionalLightIntensity = newConfig.directionalLightIntensity;
    }
    if (newConfig.backgroundColor !== undefined && this.renderer) {
      this.renderer.setClearColor(newConfig.backgroundColor);
      this.config.backgroundColor = newConfig.backgroundColor;
    }
    if (newConfig.metalness !== undefined || newConfig.roughness !== undefined) {
      this.updateMaterials();
    }
    if (newConfig.ssaoRadius !== undefined && this.ssaoPass) {
      this.ssaoPass.kernelRadius = newConfig.ssaoRadius;
    }
    if (newConfig.rimStrength !== undefined) {
      this.rimStrengthUniforms.forEach(uniform => {
        uniform.value = newConfig.rimStrength!;
      });
    }

    if (newConfig.preset !== undefined) {
      this.applyStylePreset(newConfig.preset);
    }
    
    this.requestRender();
  }

  /**
   * Apply a named publication/presentation style preset to the viewer and current surfaces.
   *
   * Presets update background, lighting, material defaults, curvature contrast,
   * annotation defaults, ROI/export style metadata, and default figure export size.
   * Existing data layers are not recolored automatically; use `stylePreset.colormaps`
   * as the default palette policy for newly created layers.
   */
  applyStylePreset(preset: SurfViewStylePresetName | SurfViewStylePreset): SurfViewStylePreset {
    const style = resolveStylePreset(preset);
    this.stylePreset = style;
    this.config.preset = style.name;
    this.config.backgroundColor = style.background.clearColor;
    this.config.ambientLightColor = style.lighting.ambientColor;
    this.config.directionalLightColor = style.lighting.directionalColor;
    this.config.directionalLightIntensity = style.lighting.directionalIntensity;
    this.config.metalness = style.material.metalness;
    this.config.roughness = style.material.roughness;
    this.config.rimStrength = style.lighting.rimStrength;
    this.config.ssaoRadius = style.lighting.ssaoRadius;
    this.config.ssaoKernelSize = style.lighting.ssaoKernelSize;

    if (this.container) {
      this.container.style.background = style.background.css;
    }
    if (this.renderer) {
      this.renderer.setClearColor(style.background.clearColor, style.background.clearAlpha);
    }
    if (this.ambientLight) {
      this.ambientLight.color.setHex(style.lighting.ambientColor);
      this.ambientLight.intensity = style.lighting.ambientIntensity;
    }
    if (this.directionalLight) {
      this.directionalLight.color.setHex(style.lighting.directionalColor);
      this.directionalLight.intensity = style.lighting.directionalIntensity;
      this.directionalLight.position.set(...style.lighting.directionalPosition);
    }
    if (this.ssaoPass) {
      this.ssaoPass.kernelRadius = style.lighting.ssaoRadius;
      if (typeof (this.ssaoPass as any).generateSampleKernel === 'function') {
        (this.ssaoPass as any).kernelSize = style.lighting.ssaoKernelSize;
        (this.ssaoPass as any).generateSampleKernel(style.lighting.ssaoKernelSize);
      }
    }
    this.rimStrengthUniforms.forEach(uniform => {
      uniform.value = style.lighting.rimStrength;
    });
    this.annotations.setDefaults({
      radius: style.annotation.radius,
      colorOn: style.annotation.colorOn,
      colorOff: style.annotation.colorOff
    });

    this.surfaces.forEach(surface => {
      if (typeof (surface as any).updateConfig === 'function') {
        (surface as any).updateConfig({
          color: style.material.baseColor,
          materialType: style.material.materialType,
          metalness: style.material.metalness,
          roughness: style.material.roughness,
          alpha: style.material.alpha
        });
      }
      if (surface instanceof MultiLayerNeuroSurface) {
        const curvature = surface.getCurvatureLayer();
        if (curvature) {
          curvature.setBrightness(style.curvature.brightness);
          curvature.setContrast(style.curvature.contrast);
          curvature.setSmoothness(style.curvature.smoothness);
        }
      }
    });

    this.requestRender();
    return style;
  }

  /**
   * Back-compat wrapper for the original presentation preset API.
   */
  applyPresentationPreset(): void {
    this.applyStylePreset('presentation');
  }

  takeScreenshot(filename: string = 'neurosurface.png'): void {
    this.render();
    this.renderer.domElement.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  getCameraState(): any {
    return {
      position: this.camera.position.toArray(),
      rotation: this.camera.rotation.toArray(),
      target: this.controls.target.toArray()
    };
  }

  setCameraState(state: any): void {
    if (state.position) {
      this.camera.position.fromArray(state.position);
    }
    if (state.rotation) {
      this.camera.rotation.fromArray(state.rotation);
    }
    if (state.target) {
      this.controls.target.fromArray(state.target);
    }
    this.controls.update();
    this.requestRender();
  }
}
