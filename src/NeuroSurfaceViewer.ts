import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { SurfaceControls } from './SurfaceControls';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { NeuroSurface, ColorMappedNeuroSurface, SurfaceGeometry } from './classes';
import { MultiLayerNeuroSurface, ClearLayersOptions } from './MultiLayerNeuroSurface';
import { VariantSurface } from './VariantSurface';
import { Layer } from './layers';
import { debugLog } from './debug';
import ColorMap from './ColorMap';
import { EventEmitter } from './EventEmitter';
import type { EventArgsFor, TypedEventListener, UnsubscribeFn } from './EventEmitter';
import type { SurfaceEventMap, SurfaceEventType } from './events/SurfaceEvents';
import { BoundingBoxHelper } from './utils/BoundingBox';
import { detectCapabilities, ViewerCapabilities } from './utils/capabilities';
import { AnnotationManager, AnnotationRecord } from './annotations';
import { GPUPicker } from './utils/GPUPicker';
import { VolumeProjectedSurface } from './surfaces/VolumeProjectedSurface';
import type {
  LayerOrderDescriptor,
  LayerOrderResult,
  RibbonReducer,
  VolumeProjectionMode
} from './layers';
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
import type { ViewerState, ViewerStateV2, RestorationReport } from './serialization/ViewerState';
import type { SceneExportManifest, SceneExportOptions, StaticHTMLExportOptions } from './serialization/SceneExporter';
import type {
  FigureExportLabel,
  FigureExportOptions,
  SurfViewStylePreset,
  SurfViewStylePresetName
} from './StylePresets';
import {
  getAnatomicalViewAxes,
  normalizeAnatomicalHemisphere
} from './AnatomicalView';
import type {
  AnatomicalView,
  AnatomicalViewChangedEvent,
  AnatomicalViewCapabilities,
  AnatomicalViewOptions,
  AnatomicalViewResetResult,
  AnatomicalViewResult,
  BilateralSurfaceGroup,
  BilateralSurfaceGroupRemovalReason,
  BilateralSurfaceGroupResult
} from './AnatomicalView';
import {
  freezeInspectionSelection,
  inspectionSelectionsEqual,
  NO_INSPECTION_SELECTION
} from './Inspection';
import type {
  InspectionSelection,
  InspectionSelectionOptions,
  InspectionSelectionResult,
  VertexInspection,
  VertexInspectionAtlas,
  VertexInspectionLayerValue,
  VertexInspectionParcel
} from './Inspection';
import type {
  ParcelInteractionEvent,
  ParcelSelectionEvent,
  SurfacePickEvent,
  VertexHoverEvent,
  ViewerEventMap,
  ViewerEventType,
  ControlDomain,
  ViewerStateChangedEvent
} from './events/ViewerEvents';
import {
  controlDomainsForViewerEvent,
  ViewerStateChangeTracker
} from './viewer/ViewerStateChangeTracker';
import { BilateralSurfaceGroupRegistry } from './viewer/BilateralSurfaceGroupRegistry';
import { ViewerRenderScheduler } from './viewer/ViewerRenderScheduler';
import { drawFigureOverlays } from './viewer/FigureOverlayRenderer';
import { WebGLContextLifecycle } from './viewer/WebGLContextLifecycle';
import { ViewerPickingController } from './viewer/ViewerPickingController';
import {
  devicePixelRatio as normalizeDevicePixelRatio,
  finiteNumber,
  rgbInteger
} from './utils/validation';

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
  /** @deprecated Pane UI is no longer part of the viewer runtime. */
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

/** Fully normalized runtime viewer configuration; no required value is undefined. */
export type ResolvedNeuroSurfaceViewerConfig = Required<NeuroSurfaceViewerConfig>;

export interface ParcelFocusOptions {
  showCrosshair?: boolean;
  emitEvent?: boolean;
  screenX?: number;
  screenY?: number;
}

/** Immutable, control-neutral background state used by figure tooling. */
export interface ViewerFigureBackground {
  readonly color: number;
  readonly transparent: boolean;
}

export type Viewpoint = 'lateral' | 'medial' | 'ventral' | 'posterior' | 'anterior' | 'unknown_lateral';

export interface ViewpointConfig {
  /** Unit vector from origin toward camera position */
  direction: THREE.Vector3;
  /** Camera up vector for this view */
  up: THREE.Vector3;
}

export interface ViewpointState {
  rotation: THREE.Quaternion;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

function colorToCSS(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

const legacyPaneWarnings = new Set<string>();
function warnLegacyPaneMember(member: string, replacement: string): void {
  if (legacyPaneWarnings.has(member)) return;
  legacyPaneWarnings.add(member);
  console.warn(
    `surfview: ${member} is a deprecated pane-era compatibility API and does not create or control viewer UI. ` +
    `${replacement} It will be removed in SurfView 3.`
  );
}

function warnLegacyControlsDeprecated(): void {
  warnLegacyPaneMember(
    'showControls/useControls/allowCDNFallback',
    'Use report controls, a ViewerPlugin, or the optional first-party controls package instead.'
  );
}

function warnLegacyInteractionMember(member: string): void {
  if (legacyPaneWarnings.has(member)) return;
  legacyPaneWarnings.add(member);
  console.warn(
    `surfview: ${member} is deprecated because it ambiguously refers to UI controls. ` +
    'Use setInteractionEnabled() for camera and surface interaction. It will be removed in SurfView 3.'
  );
}

function normalizeLegacyViewerConfig(
  config: Partial<NeuroSurfaceViewerConfig>
): Partial<NeuroSurfaceViewerConfig> {
  const normalized = { ...config };
  if (normalized.showControls || normalized.useControls || normalized.allowCDNFallback) {
    warnLegacyControlsDeprecated();
  }
  if (normalized.showControls !== undefined) normalized.showControls = false;
  if (normalized.useControls !== undefined) normalized.useControls = false;
  if (normalized.allowCDNFallback !== undefined) normalized.allowCDNFallback = false;
  return normalized;
}

const DEFAULT_VIEWER_CONFIG: Readonly<ResolvedNeuroSurfaceViewerConfig> = Object.freeze({
  ambientLightColor: 0xb5b5b5,
  directionalLightColor: 0xffffff,
  directionalLightIntensity: 1.6,
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
  controlType: 'trackball',
  preset: 'default',
  linkHemispheres: false,
  hoverCrosshair: false,
  hoverCrosshairColor: 0x66ccff,
  hoverCrosshairSize: 1.2,
  clickToAddAnnotation: false,
  useGPUPicking: false
});

function normalizeViewerConfig(
  input: Partial<NeuroSurfaceViewerConfig>,
  base: Partial<ResolvedNeuroSurfaceViewerConfig> = DEFAULT_VIEWER_CONFIG
): ResolvedNeuroSurfaceViewerConfig {
  const legacyNormalized = normalizeLegacyViewerConfig(input);
  const merged: ResolvedNeuroSurfaceViewerConfig = {
    ...DEFAULT_VIEWER_CONFIG,
    ...base
  };
  for (const [key, value] of Object.entries(legacyNormalized)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  merged.ambientLightColor = rgbInteger(merged.ambientLightColor, 'ambientLightColor');
  merged.directionalLightColor = rgbInteger(merged.directionalLightColor, 'directionalLightColor');
  merged.backgroundColor = rgbInteger(merged.backgroundColor, 'backgroundColor');
  merged.hoverCrosshairColor = rgbInteger(merged.hoverCrosshairColor, 'hoverCrosshairColor');
  merged.directionalLightIntensity = finiteNumber(
    merged.directionalLightIntensity,
    'directionalLightIntensity',
    { minimum: 0 }
  );
  merged.rotationSpeed = finiteNumber(merged.rotationSpeed, 'rotationSpeed', {
    minimum: 0,
    minimumExclusive: true
  });
  merged.initialZoom = finiteNumber(merged.initialZoom, 'initialZoom', {
    minimum: 0,
    minimumExclusive: true
  });
  merged.ssaoRadius = finiteNumber(merged.ssaoRadius, 'ssaoRadius', { minimum: 0 });
  merged.ssaoKernelSize = finiteNumber(merged.ssaoKernelSize, 'ssaoKernelSize', {
    minimum: 1,
    maximum: 64,
    integer: true
  });
  merged.rimStrength = finiteNumber(merged.rimStrength, 'rimStrength', { minimum: 0 });
  merged.metalness = finiteNumber(merged.metalness, 'metalness', { minimum: 0, maximum: 1 });
  merged.roughness = finiteNumber(merged.roughness, 'roughness', { minimum: 0, maximum: 1 });
  merged.hoverCrosshairSize = finiteNumber(merged.hoverCrosshairSize, 'hoverCrosshairSize', {
    minimum: 0,
    minimumExclusive: true
  });
  return merged;
}

export class NeuroSurfaceViewer extends EventEmitter<ViewerEventMap> {
  container: HTMLElement;
  width!: number;
  height!: number;
  config!: ResolvedNeuroSurfaceViewerConfig;
  viewpoint!: string;
  scene!: THREE.Scene;
  environmentMap!: THREE.Texture | null;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  cameraControls!: TrackballControls | SurfaceControls;
  composer!: EffectComposer;
  ssaoPass: SSAOPass | null = null;
  surfaces!: Map<string, NeuroSurface>;
  rimStrengthUniforms!: Array<{ value: number }>;
  raycaster!: THREE.Raycaster;
  mouse!: THREE.Vector2;
  intersectionPoint!: THREE.Vector3;
  private renderScheduler?: ViewerRenderScheduler;
  private pickingController?: ViewerPickingController;
  ambientLight!: THREE.AmbientLight;
  directionalLight!: THREE.DirectionalLight;
  viewpoints!: Record<string, ViewpointConfig>;
  viewpointState!: ViewpointState | null;
  currentViewpointKey!: string;
  annotations!: AnnotationManager;
  plugins!: PluginHost;
  capabilities!: ViewerCapabilities;
  stylePreset!: SurfViewStylePreset;
  options!: Map<string, any>;
  sceneBoundsRadius!: number;
  initializationFailed: boolean;
  selectedLayerId: string | null = null;
  selectedSurfaceId: string | null = null;
  onSurfaceClick: ((event: any) => void) | undefined = undefined;
  /** GPU-based picker for fast vertex selection */
  gpuPicker: GPUPicker | null = null;
  crosshair!: CrosshairManager;
  handleSurfaceClick!: (event: MouseEvent) => void;
  private handleMouseMove!: (event: MouseEvent) => void;
  private contextLifecycle?: WebGLContextLifecycle;
  private cameraInteractionEnabled = true;
  private disposed = false;
  private stateChanges?: ViewerStateChangeTracker;
  private surfaceSubscriptions = new Map<string, UnsubscribeFn[]>();
  private surfaceGroups?: BilateralSurfaceGroupRegistry;
  private inspectionSelection: InspectionSelection = NO_INSPECTION_SELECTION;
  private currentAnatomicalView: AnatomicalViewChangedEvent | null = null;

  /** Pending requestAnimationFrame id retained for backward compatibility. */
  get animationId(): number | null {
    return this.ensureRenderScheduler().pendingFrameId;
  }

  set animationId(value: number | null) {
    this.ensureRenderScheduler().pendingFrameId = value;
  }

  /** Whether a canvas paint is queued; retained for backward compatibility. */
  get needsRender(): boolean {
    return this.ensureRenderScheduler().needsRender;
  }

  set needsRender(value: boolean) {
    this.ensureRenderScheduler().needsRender = value;
  }

  /** @deprecated Use cameraControls. This alias will be removed in SurfView 3. */
  get controls(): TrackballControls | SurfaceControls {
    return this.cameraControls;
  }

  /** @deprecated Use cameraControls. This alias will be removed in SurfView 3. */
  set controls(value: TrackballControls | SurfaceControls) {
    this.cameraControls = value;
    if ('enabled' in value) {
      value.enabled = this.cameraInteractionEnabled;
    }
  }

  /** @deprecated Use isInteractionEnabled() and setInteractionEnabled(). */
  get controlsEnabled(): boolean {
    return this.cameraInteractionEnabled;
  }

  /** @deprecated Use setInteractionEnabled(). */
  set controlsEnabled(enabled: boolean) {
    this.setInteractionEnabled(enabled);
  }

  constructor(
    container: HTMLElement, 
    width: number, 
    height: number, 
    config: NeuroSurfaceViewerConfig = {}, 
    viewpoint: string = 'lateral'
  ) {
    super(); // Initialize EventEmitter
    this.stateChanges = new ViewerStateChangeTracker(event => this.emitStateChange(event));
    const normalizedWidth = finiteNumber(width, 'width', { minimum: 0, minimumExclusive: true });
    const normalizedHeight = finiteNumber(height, 'height', { minimum: 0, minimumExclusive: true });
    const normalizedConfig = normalizeViewerConfig(config);
    this.initializationFailed = false;
    this.container = container;
    this.plugins = new PluginHost(this);
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
    this.width = normalizedWidth;
    this.height = normalizedHeight;
    this.config = normalizedConfig;
    this.stylePreset = resolveStylePreset(this.config.preset);
    this.viewpoint = viewpoint;

    // Initialize core state before any setup functions that rely on it
    this.surfaces = new Map(); // Store multiple surfaces
    this.surfaceGroups = this.createSurfaceGroupRegistry();
    this.rimStrengthUniforms = [];
    this.options = new Map();
    this.sceneBoundsRadius = 0;
    this.selectedLayerId = null;
    this.selectedSurfaceId = null;
    this.inspectionSelection = NO_INSPECTION_SELECTION;

    this.pickingController = this.createPickingController();
    this.raycaster = this.pickingController.raycaster;
    this.mouse = this.pickingController.mouse;
    this.intersectionPoint = this.pickingController.intersectionPoint;

    // Establish callback identity and scheduling state before setup methods can
    // invalidate the viewer or attach listeners.
    this.renderScheduler = this.createRenderScheduler(true);
    this.animate = this.animate.bind(this);
    this.handleSurfaceClick = this.onSurfaceClickHandler.bind(this);
    this.handleMouseMove = this.onMouseMoveHandler.bind(this);
    this.onControlsChange = this.onControlsChange.bind(this);
    this.onControlsStart = this.onControlsStart.bind(this);
    this.onControlsEnd = this.onControlsEnd.bind(this);

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

    this.cameraInteractionEnabled = true;
    this.viewpointState = null;
    this.currentViewpointKey = '';

    // Viewpoint directions are expressed in RAS space (x=Left-Right, y=Posterior-Anterior, z=Inferior-Superior).
    // Camera 'up' is chosen per view to keep Superior at the top of the screen where possible and avoid
    // the up vector being parallel to the view direction (e.g., ventral/inferior views).
    this.viewpoints = {
      left_lateral:   { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
      left_medial:    { direction: new THREE.Vector3(1, 0, 0),  up: new THREE.Vector3(0, 0, 1) },
      left_dorsal:    { direction: new THREE.Vector3(0, 0, 1),  up: new THREE.Vector3(0, 1, 0) },
      left_ventral:   { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) }, // use anterior as up when viewing from below
      left_posterior: { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
      left_anterior:  { direction: new THREE.Vector3(0, 1, 0),  up: new THREE.Vector3(0, 0, 1) },
      right_lateral:  { direction: new THREE.Vector3(1, 0, 0),  up: new THREE.Vector3(0, 0, 1) },
      right_medial:   { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
      right_dorsal:   { direction: new THREE.Vector3(0, 0, 1),  up: new THREE.Vector3(0, 1, 0) },
      right_ventral:  { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
      right_posterior:{ direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
      right_anterior: { direction: new THREE.Vector3(0, 1, 0),  up: new THREE.Vector3(0, 0, 1) },
      unknown_lateral:{ direction: new THREE.Vector3(1, 0, 0),  up: new THREE.Vector3(0, 0, 1) }
    };

    // Construction establishes revision zero; only post-construction mutations
    // are observable by callers.
    this.stateChanges.reset();

    // Setup invalidations coalesce into a single initial frame.
    this.requestRender();
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

  /** Current monotonic revision of observable control-relevant state. */
  getStateRevision(): number {
    return this.ensureStateChanges().getRevision();
  }

  /** Whether this viewer has completed its idempotent disposal lifecycle. */
  isDisposed(): boolean {
    return this.disposed;
  }

  emit<K extends ViewerEventType>(event: K, ...args: EventArgsFor<ViewerEventMap, K>): void {
    if (this.disposed) return;
    const domains = controlDomainsForViewerEvent(event, args[0]);
    try {
      super.emit(event, ...args);
    } finally {
      if (event !== 'state:changed' && domains.length > 0) {
        this.invalidateState(domains);
      }
    }
  }

  private ensureStateChanges(): ViewerStateChangeTracker {
    this.stateChanges ??= new ViewerStateChangeTracker(event => this.emitStateChange(event));
    return this.stateChanges;
  }

  private emitStateChange(event: ViewerStateChangedEvent): void {
    super.emit('state:changed', event);
  }

  private invalidateState(domains: readonly ControlDomain[]): void {
    if (this.disposed) return;
    this.ensureStateChanges().invalidate(domains);
  }

  private beginStateChangeBatch(): void {
    this.ensureStateChanges().beginBatch();
  }

  private endStateChangeBatch(): void {
    this.ensureStateChanges().endBatch();
  }

  private withStateChangeBatch<T>(operation: () => T): T {
    return this.ensureStateChanges().runBatch(operation);
  }

  setupRenderer(): void {
    this.renderer.setPixelRatio(normalizeDevicePixelRatio(window.devicePixelRatio || 1));
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
    this.invalidateState(['appearance']);
  }

  /**
   * Handle WebGL context loss and restoration.
   * Context loss can happen due to GPU driver resets, resource pressure, or tab throttling.
   */
  private setupContextLossHandling(): void {
    this.ensureContextLifecycle().attach();
  }

  private teardownContextLossHandling(): void {
    this.contextLifecycle?.dispose();
  }

  private ensureContextLifecycle(): WebGLContextLifecycle {
    this.contextLifecycle ??= new WebGLContextLifecycle(this.renderer.domElement, {
      onLost: () => {
        this.cancelPendingFrame();
        console.warn('surfviewjs: WebGL context lost. Rendering paused.');
        this.emit('context:lost');
      },
      onRestored: () => {
        console.info('surfviewjs: WebGL context restored. Rendering resumed.');
        this.requestRender();
        this.emit('context:restored');
      }
    });
    return this.contextLifecycle;
  }

  private createPickingController(): ViewerPickingController {
    return new ViewerPickingController({
      getCanvas: () => this.renderer.domElement,
      getCamera: () => this.camera,
      getSurfaces: () => this.surfaces,
      getGPUPicker: () => this.gpuPicker,
      setGPUPicker: picker => { this.gpuPicker = picker; }
    });
  }

  private ensurePickingController(): ViewerPickingController {
    if (!this.pickingController) {
      this.pickingController = this.createPickingController();
      this.raycaster = this.pickingController.raycaster;
      this.mouse = this.pickingController.mouse;
      this.intersectionPoint = this.pickingController.intersectionPoint;
    } else {
      // These fields have historically been public. Honor advanced consumers
      // that replace one of the Three.js helpers after viewer construction.
      if (this.raycaster && this.raycaster !== this.pickingController.raycaster) {
        this.pickingController.raycaster = this.raycaster;
      }
      if (this.mouse && this.mouse !== this.pickingController.mouse) {
        this.pickingController.mouse = this.mouse;
      }
      if (this.intersectionPoint &&
          this.intersectionPoint !== this.pickingController.intersectionPoint) {
        this.pickingController.intersectionPoint = this.intersectionPoint;
      }
    }
    return this.pickingController;
  }

  setupCamera(): void {
    this.camera.position.set(0, 0, this.config.initialZoom);
    this.camera.lookAt(new THREE.Vector3(0, 0, 0));
    this.camera.up.set(0, 1, 0);
    this.camera.updateProjectionMatrix();
    this.invalidateState(['camera']);
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
    this.invalidateState(['appearance']);
  }

  setupControls(): void {
    if (this.config.controlType === 'surface') {
      // Use new natural surface controls
      this.cameraControls = new SurfaceControls(this.camera, this.renderer.domElement);
      this.cameraControls.rotateSpeed = this.config.rotationSpeed;
      this.cameraControls.enableDamping = false;
      this.cameraControls.dampingFactor = 0.05;
      this.cameraControls.zoomSpeed = 0.8;
      this.cameraControls.panSpeed = 0.8;
      (this.cameraControls as any).minDistance = 0.05;
      (this.cameraControls as any).maxDistance = Infinity;
      
      // Set initial target and position
      this.cameraControls.target.set(0, 0, 0);
      this.camera.position.z = this.config.initialZoom;
    } else {
      // Use traditional trackball controls
      this.cameraControls = new TrackballControls(this.camera, this.renderer.domElement);
      this.cameraControls.rotateSpeed = this.config.rotationSpeed;
      this.cameraControls.zoomSpeed = 0.8;
      this.cameraControls.panSpeed = 0.8;
      this.cameraControls.keys = ['KeyA', 'KeyS', 'KeyD'];
      (this.cameraControls as any).minDistance = 0.05;
      (this.cameraControls as any).maxDistance = Infinity;
      
      // Set initial position with larger zoom value
      this.cameraControls.target.set(0, 0, 0);
      this.camera.position.z = this.config.initialZoom;
      this.cameraControls.update();
    }

    this.attachControlListeners();
    this.invalidateState(['camera']);
  }

  private attachControlListeners(): void {
    if (!this.cameraControls?.addEventListener) return;
    (this.cameraControls as any).addEventListener('change', this.onControlsChange);
    (this.cameraControls as any).addEventListener('start', this.onControlsStart);
    (this.cameraControls as any).addEventListener('end', this.onControlsEnd);
  }

  private detachControlListeners(): void {
    if (!this.cameraControls?.removeEventListener) return;
    (this.cameraControls as any).removeEventListener('change', this.onControlsChange);
    (this.cameraControls as any).removeEventListener('start', this.onControlsStart);
    (this.cameraControls as any).removeEventListener('end', this.onControlsEnd);
  }

  onControlsChange(): void {
    if (this.disposed) return;
    this.ensureRenderScheduler().noteControlsChanged();
    this.currentAnatomicalView = null;
    const target = this.cameraControls && 'target' in this.cameraControls
      ? ((this.cameraControls as any).target as THREE.Vector3).clone()
      : null;
    this.emit('camera:changed', {
      camera: this.camera,
      position: this.camera.position.clone(),
      target
    });
    this.requestRender();
  }

  private onControlsStart(): void {
    if (this.disposed) return;
    this.ensureRenderScheduler().beginControlsInteraction();
  }

  private onControlsEnd(): void {
    if (this.disposed) return;
    this.ensureRenderScheduler().endControlsInteraction();
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
    this.invalidateState(['appearance']);
  }

  private normalizeHemisphere(hemi: string): string {
    if (!hemi) return 'unknown';
    return normalizeAnatomicalHemisphere(hemi) ?? hemi.toLowerCase();
  }

  private createSurfaceGroupRegistry(): BilateralSurfaceGroupRegistry {
    return new BilateralSurfaceGroupRegistry({
      isDisposed: () => this.disposed,
      getSurface: id => this.surfaces?.get(id),
      surfaceEntries: () => this.surfaces?.entries() ?? []
    });
  }

  private ensureSurfaceGroups(): BilateralSurfaceGroupRegistry {
    this.surfaceGroups ??= this.createSurfaceGroupRegistry();
    return this.surfaceGroups;
  }

  /** Register a deliberate left/right coordination group. No group is inferred from loaded surfaces. */
  registerBilateralSurfaceGroup(group: BilateralSurfaceGroup): BilateralSurfaceGroupResult {
    return this.withStateChangeBatch(() => {
      const result = this.ensureSurfaceGroups().register(group);
      if (result.ok) this.emit('surface-group:registered', { group: result.group });
      return result;
    });
  }

  unregisterBilateralSurfaceGroup(groupId: string): BilateralSurfaceGroupResult {
    return this.withStateChangeBatch(() => {
      const result = this.ensureSurfaceGroups().unregister(groupId);
      if (result.ok) {
        this.emit('surface-group:removed', { group: result.group, reason: 'explicit' });
      }
      return result;
    });
  }

  getBilateralSurfaceGroup(groupId: string): BilateralSurfaceGroup | null {
    return this.ensureSurfaceGroups().get(groupId);
  }

  getBilateralSurfaceGroups(): readonly BilateralSurfaceGroup[] {
    return this.ensureSurfaceGroups().getAll();
  }

  getAnatomicalViewCapabilities(): AnatomicalViewCapabilities {
    return this.ensureSurfaceGroups().getCapabilities();
  }

  /** Last explicit anatomical orientation, or null after a free camera mutation. */
  getCurrentAnatomicalView(): AnatomicalViewChangedEvent | null {
    return this.currentAnatomicalView;
  }

  /**
   * Apply a camera-oriented anatomical view to one explicit surface or group.
   * Paired camera views use the registered left member as the lateral/medial
   * reference; report adapters may instead orient each member independently.
   */
  setAnatomicalView(
    view: AnatomicalView,
    options: AnatomicalViewOptions
  ): AnatomicalViewResult {
    if (this.disposed) {
      return Object.freeze({
        ok: false,
        code: 'disposed',
        message: 'The viewer has been disposed.'
      });
    }

    let referenceSurfaceId: string;
    let surfaceIds: readonly string[];
    if (options.layout === 'single') {
      referenceSurfaceId = options.surfaceId;
      surfaceIds = Object.freeze([options.surfaceId]);
    } else {
      if (options.hemisphereGap !== undefined &&
          (!Number.isFinite(options.hemisphereGap) || options.hemisphereGap < 0)) {
        return Object.freeze({
          ok: false,
          code: 'invalid-gap',
          message: 'hemisphereGap must be a finite, non-negative number.'
        });
      }
      const group = this.ensureSurfaceGroups().get(options.groupId);
      if (!group) {
        return Object.freeze({
          ok: false,
          code: 'group-not-found',
          message: `Bilateral surface group "${options.groupId}" was not found.`
        });
      }
      referenceSurfaceId = group.leftSurfaceId;
      surfaceIds = Object.freeze([group.leftSurfaceId, group.rightSurfaceId]);
    }

    const referenceSurface = this.surfaces?.get(referenceSurfaceId);
    if (!referenceSurface) {
      return Object.freeze({
        ok: false,
        code: 'surface-not-found',
        message: `Surface "${referenceSurfaceId}" was not found.`
      });
    }
    const hemisphere = normalizeAnatomicalHemisphere(referenceSurface.hemisphere);
    if (!hemisphere) {
      return Object.freeze({
        ok: false,
        code: 'invalid-hemisphere',
        message: `Surface "${referenceSurfaceId}" has unsupported hemisphere metadata.`
      });
    }

    const bounds = new THREE.Box3();
    for (const surfaceId of surfaceIds) {
      const surface = this.surfaces?.get(surfaceId);
      if (!surface) {
        return Object.freeze({
          ok: false,
          code: 'surface-not-found',
          message: `Surface "${surfaceId}" was not found.`
        });
      }
      surface.mesh?.updateMatrixWorld(true);
      if (surface.mesh) bounds.expandByObject(surface.mesh);
    }
    const target = bounds.isEmpty()
      ? new THREE.Vector3()
      : bounds.getCenter(new THREE.Vector3());
    const { direction: directionTuple, up: upTuple } = getAnatomicalViewAxes(hemisphere, view);
    const direction = new THREE.Vector3(...directionTuple).normalize();
    const up = new THREE.Vector3(...upTuple).normalize();
    const fit = options.fit ?? true;
    const previousTarget = this.cameraControls?.target?.clone?.() ?? new THREE.Vector3();
    let distance = this.camera.position.distanceTo(previousTarget);
    if (!Number.isFinite(distance) || distance <= 0) {
      distance = this.config.initialZoom;
    }

    if (fit && !bounds.isEmpty()) {
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
      const limitingFov = Math.max(0.01, Math.min(verticalFov, horizontalFov));
      distance = Math.max(sphere.radius / Math.sin(limitingFov / 2) * 1.08, 1);
    }

    this.withStateChangeBatch(() => {
      this.camera.position.copy(target).addScaledVector(direction, distance);
      this.camera.up.copy(up);
      this.camera.lookAt(target);
      if (fit) {
        this.camera.near = Math.max(distance / 1000, 0.001);
        this.camera.far = Math.max(distance * 10, 100);
        this.camera.updateProjectionMatrix();
        this.sceneBoundsRadius = bounds.isEmpty()
          ? 0
          : bounds.getBoundingSphere(new THREE.Sphere()).radius;
      }
      if (this.cameraControls) {
        this.cameraControls.target.copy(target);
        if (fit) {
          (this.cameraControls as any).minDistance = Math.max(this.sceneBoundsRadius * 0.6, 0.05);
          (this.cameraControls as any).maxDistance = Math.max(this.sceneBoundsRadius * 20, distance * 2);
        }
        this.cameraControls.update();
      }
      this.viewpointState = {
        rotation: this.camera.quaternion.clone(),
        position: this.camera.position.clone(),
        target: target.clone()
      };
      this.currentViewpointKey = `${options.layout}:${view}`;
      this.viewpoint = view;
      this.currentAnatomicalView = Object.freeze({
        view,
        layout: options.layout,
        surfaceIds,
        fit
      });
      this.emit('anatomical-view:changed', this.currentAnatomicalView);
      this.emit('viewpoint:changed', {
        viewpoint: this.currentViewpointKey,
        position: this.camera.position.clone(),
        target: target.clone()
      });
      this.requestRender();
    });

    return Object.freeze({
      ok: true,
      view,
      layout: options.layout,
      surfaceIds
    });
  }

  /** Reset the ordinary viewer camera to its configured origin and zoom. */
  resetAnatomicalView(): AnatomicalViewResetResult {
    if (this.disposed) {
      return Object.freeze({
        ok: false,
        code: 'disposed',
        message: 'The viewer has been disposed.'
      });
    }
    if (this.initializationFailed || !this.camera || !this.cameraControls) {
      return Object.freeze({
        ok: false,
        code: 'unsupported',
        message: 'An anatomical camera view is unavailable because viewer initialization failed.'
      });
    }
    this.withStateChangeBatch(() => {
      this.currentAnatomicalView = null;
      this.resetCamera();
      this.emit('anatomical-view:reset');
    });
    return Object.freeze({ ok: true });
  }

  private removeBilateralSurfaceGroup(
    groupId: string,
    reason: BilateralSurfaceGroupRemovalReason,
    removedSurfaceId?: string
  ): BilateralSurfaceGroup | null {
    const group = this.ensureSurfaceGroups().remove(groupId);
    if (!group) return null;
    this.emit('surface-group:removed', {
      group,
      reason,
      ...(removedSurfaceId ? { removedSurfaceId } : {})
    });
    return group;
  }

  private removeBilateralSurfaceGroupForSurface(
    surfaceId: string,
    reason: BilateralSurfaceGroupRemovalReason
  ): void {
    const group = this.ensureSurfaceGroups().removeForSurface(surfaceId);
    if (!group) return;
    this.emit('surface-group:removed', { group, reason, removedSurfaceId: surfaceId });
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
      debugLog('Viewpoint', fullViewpoint, 'not found, falling back to', fallbackKey);
      fullViewpoint = fallbackKey;
    }

    const viewConfig = this.viewpoints[fullViewpoint];
    if (!viewConfig) {
      debugLog('Viewpoint', fullViewpoint, 'still unavailable; skipping update');
      return;
    }

    this.currentAnatomicalView = null;

    const { direction, up } = viewConfig;
    const distance = this.config.initialZoom;

    // Position camera along the requested direction at the configured distance
    const position = direction.clone().normalize().multiplyScalar(distance);

    // Update camera
    this.camera.position.copy(position);
    this.camera.up.copy(up).normalize();
    this.camera.lookAt(new THREE.Vector3(0, 0, 0));
    
    // Update camera interaction controls
    if (this.cameraControls) {
      this.cameraControls.target.set(0, 0, 0);
      this.cameraControls.update();
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
   * Accepts 'lateral', 'medial', 'dorsal', 'anterior', 'posterior', 'inferior'.
   */
  setHemisphereView(
    view: 'lateral' | 'medial' | 'dorsal' | 'anterior' | 'posterior' | 'inferior'
  ): void {
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
    const half = finiteNumber(offset, 'offset', { minimum: 0 }) / 2;
    this.surfaces.forEach(surface => {
      if (!surface.mesh) return;
      if (surface.hemisphere === 'left') {
        surface.mesh.position.x = -half;
      } else if (surface.hemisphere === 'right') {
        surface.mesh.position.x = half;
      }
    });
    this.invalidateState(['surfaces']);
    this.requestRender();
  }

  /**
   * @deprecated Use updateLayer(surfaceId, layerId, { colorMap }) or
   * updateColorMap(surfaceId, colorMap). This compatibility helper is removed in v3.
   */
  updateColormap(presetName: string): void {
    warnLegacyPaneMember(
      'updateColormap()',
      'Use updateLayer(surfaceId, layerId, { colorMap }) or updateColorMap(surfaceId, colorMap).'
    );
    if (presetName === 'custom') return;

    let targetSurfaceId: string | null = null;
    let targetSurface: MultiLayerNeuroSurface | null = null;
    if (this.selectedSurfaceId) {
      const selectedSurface = this.surfaces.get(this.selectedSurfaceId);
      if (selectedSurface instanceof MultiLayerNeuroSurface) {
        targetSurfaceId = this.selectedSurfaceId;
        targetSurface = selectedSurface;
      }
    }
    if (!targetSurface) {
      for (const [surfaceId, surface] of this.surfaces) {
        if (surface instanceof MultiLayerNeuroSurface) {
          targetSurfaceId = surfaceId;
          targetSurface = surface;
          break;
        }
      }
    }

    if (targetSurface && targetSurfaceId) {
      const layers = targetSurface.layerStack.getAllLayers();
      const targetLayer = layers.find(layer => layer.id === this.selectedLayerId) ?? layers[0];
      if (targetLayer && 'setColorMap' in targetLayer) {
        targetSurface.updateLayer(targetLayer.id, { colorMap: presetName });
        this.emit('layer:colormap', {
          surfaceId: targetSurfaceId,
          layerId: targetLayer.id,
          colormap: presetName
        });
        this.requestRender();
        return;
      }
    }

    this.surfaces.forEach((surface, surfaceId) => {
      if (surface instanceof ColorMappedNeuroSurface) {
        surface.setColorMap(presetName);
        this.emit('surface:colormap', { surfaceId, colormap: presetName });
      }
    });
    this.requestRender();
  }

  updateAmbientLight(color: number): void {
    const nextColor = rgbInteger(color, 'ambientLightColor');
    if (this.ambientLight) {
      this.ambientLight.color.setHex(nextColor);
      this.invalidateState(['appearance']);
      this.requestRender();
    }
  }

  updateDirectionalLight(color: number): void {
    const nextColor = rgbInteger(color, 'directionalLightColor');
    if (this.directionalLight) {
      this.directionalLight.color.setHex(nextColor);
      this.invalidateState(['appearance']);
      this.requestRender();
    }
  }

  updateDirectionalLightIntensity(intensity: number): void {
    const nextIntensity = finiteNumber(intensity, 'directionalLightIntensity', { minimum: 0 });
    if (this.directionalLight) {
      this.directionalLight.intensity = nextIntensity;
      this.invalidateState(['appearance']);
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
    this.invalidateState(['appearance']);
    this.requestRender();
  }

  /** @deprecated Pane range bindings no longer exist. This no-op is removed in v3. */
  updateIntensityRange(): void {
    warnLegacyPaneMember(
      'updateIntensityRange()',
      'Use updateLayer(surfaceId, layerId, { range }) or the layer setRange() API.'
    );
  }

  /** @deprecated Pane threshold bindings no longer exist. This no-op is removed in v3. */
  updateThresholdRange(): void {
    warnLegacyPaneMember(
      'updateThresholdRange()',
      'Use updateLayer(surfaceId, layerId, { threshold }) or the layer setThreshold() API.'
    );
  }

  resetCamera(): void {
    if (this.camera && this.cameraControls) {
      this.currentAnatomicalView = null;
      const minClamp = this.sceneBoundsRadius > 0 ? Math.max(0.05, this.sceneBoundsRadius * 0.6) : 0.05;
      const maxClamp = this.sceneBoundsRadius > 0 ? Math.max(this.sceneBoundsRadius * 20, this.config.initialZoom) : Infinity;
      (this.cameraControls as any).minDistance = minClamp;
      (this.cameraControls as any).maxDistance = maxClamp;
      this.camera.position.set(0, 0, this.config.initialZoom);
      this.camera.up.set(0, 1, 0);
      this.cameraControls.target.set(0, 0, 0);
      this.cameraControls.update();
      this.invalidateState(['camera']);
      this.requestRender();
    }
  }

  private detachSurfaceSubscriptions(surfaceId: string): void {
    const subscriptions = this.surfaceSubscriptions.get(surfaceId);
    if (!subscriptions) return;
    this.surfaceSubscriptions.delete(surfaceId);
    subscriptions.forEach(unsubscribe => unsubscribe());
  }

  addSurface(surface: NeuroSurface, id?: string): void {
    this.beginStateChangeBatch();
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
      this.detachSurfaceSubscriptions(surfaceId);

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

      if (surface instanceof MultiLayerNeuroSurface) {
        surface.activateConfiguredCompositor();
      }

      if (surface.mesh && surface.mesh.material) {
        if (this.config.useShaders && this.config.rimStrength > 0) {
          // Add rim lighting shader if enabled
          this.addRimLightingShader(surface.mesh);
          const material = surface.mesh.material as any;
          material.userData = { ...material.userData, hasRimShader: true };
        }
      }

      if (this.surfaces.has(surfaceId)) {
        this.removeBilateralSurfaceGroupForSurface(surfaceId, 'surface-replaced');
        const inspectionSelection = this.getInspectionSelection();
        if (inspectionSelection.kind !== 'none' &&
            inspectionSelection.surfaceId === surfaceId) {
          this.clearInspectionSelection();
        }
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
      
      // Subscribe to surface events for rendering and observable state propagation.
      const subscriptions: UnsubscribeFn[] = [];
      const subscribe = <K extends SurfaceEventType>(
        event: K,
        listener: TypedEventListener<SurfaceEventMap[K]>
      ): void => {
        subscriptions.push(surface.on(event, listener));
      };
      subscribe('render:needed', () => this.requestRender());
      subscribe('visibility:changed', () => {
        this.invalidateState(['surfaces', 'appearance']);
        this.requestRender();
      });
      subscribe('opacity:changed', () => {
        this.invalidateState(['appearance']);
        this.requestRender();
      });
      subscribe('color:changed', () => {
        this.invalidateState(['appearance']);
        this.requestRender();
      });
      subscribe('material:updated', () => {
        this.invalidateState(['appearance']);
        this.requestRender();
      });
      subscribe('data:updated', () => {
        this.invalidateState(['layers']);
        this.requestRender();
      });
      subscribe('geometry:updated', () => {
        this.invalidateState(['surfaces']);
        this.requestRender();
      });
      subscribe('variant:changed', (event: any) => {
        this.emit('surface:variant', { surfaceId, variant: event.variant });
        this.requestRender();
      });
      subscribe('morph:changed', () => {
        this.invalidateState(['surfaces']);
        this.requestRender();
      });
      subscribe('morph:animating', () => {
        this.invalidateState(['surfaces']);
        this.requestRender();
      });
      subscribe('morph:complete', () => {
        this.invalidateState(['surfaces']);
        this.requestRender();
      });
      subscribe('morph:cancelled', () => {
        this.invalidateState(['surfaces']);
        this.requestRender();
      });
      subscribe('layer:added', (event: any) => {
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
      subscribe('layer:removed', (event: any) => {
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
      subscribe('layer:updated', (event: any) => {
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
      subscribe('layer:reordered', (event: any) => {
        this.emit('layer:reordered', {
          surfaceId,
          order: event.order,
          previousOrder: event.previousOrder,
          movedLayerId: event.movedLayerId
        });
        this.requestRender();
      });
      subscribe('dispose', () => {
        if (this.surfaces.get(surfaceId) !== surface) return;
        this.withStateChangeBatch(() => {
          this.removeBilateralSurfaceGroupForSurface(surfaceId, 'surface-removed');
          const inspectionSelection = this.getInspectionSelection();
          if (inspectionSelection.kind !== 'none' &&
              inspectionSelection.surfaceId === surfaceId) {
            this.clearInspectionSelection();
          }
          this.detachSurfaceSubscriptions(surfaceId);
          if (surface.mesh) {
            this.scene.remove(surface.mesh);
          }
          this.ensurePickingController().removeSurface(surfaceId);
          this.annotations.removeBySurface(surfaceId);
          this.surfaces.delete(surfaceId);
          if (this.selectedSurfaceId === surfaceId) {
            this.selectedSurfaceId = null;
            this.selectedLayerId = null;
            this.invalidateState(['selection']);
          }
          this.emit('surface:removed', { surface, id: surfaceId, surfaceId });
        });
      });
      this.surfaceSubscriptions.set(surfaceId, subscriptions);
      
      // Emit viewer event
      this.emit('surface:added', { surface, id: surfaceId, surfaceId });

      // Fit camera/controls to current surfaces and set initial viewpoint
      this.centerCamera();
      if (this.surfaces.size === 1) {
        this.setViewpoint(this.viewpoint);
      }
      if (surface instanceof MultiLayerNeuroSurface && !this.selectedLayerId) {
        const layers = surface.layerStack.getAllLayers();
        const firstLayer = layers[0];
        if (firstLayer) {
          this.selectedLayerId = firstLayer.id;
          this.selectedSurfaceId = id;
          this.invalidateState(['selection']);
        }
      }

      // Register with GPU picker if enabled
      this.ensurePickingController().addSurface(id, surface.mesh);

      this.requestRender();
    } catch (error) {
      console.error('Error adding surface:', error);
      if (id && this.surfaces.has(id)) {
        this.detachSurfaceSubscriptions(id);
        this.surfaces.delete(id);
      }
    } finally {
      this.endStateChangeBatch();
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
      ...(volumeConfig.useHalfFloat === undefined
        ? {}
        : { useHalfFloat: volumeConfig.useHalfFloat })
    });

    if (!supported) {
      console.warn('GPU volume projection not supported (need WebGL2 + float linear filtering).');
      return null;
    }

    const surface = new VolumeProjectedSurface(geometry, {
      volumeData: volumeConfig.data,
      volumeDims: volumeConfig.dims,
      fillValue: volumeConfig.fillValue ?? 0.0,
      colormap: displayConfig.colormap ?? 'viridis',
      intensityRange: displayConfig.range ?? [0, 1],
      threshold: displayConfig.threshold ?? [0, 0],
      overlayOpacity: displayConfig.opacity ?? 1.0,
      baseColor: displayConfig.baseColor ?? 0x888888,
      ...(volumeConfig.affineMatrix === undefined ? {} : { affineMatrix: volumeConfig.affineMatrix }),
      ...(volumeConfig.worldToIJK === undefined ? {} : { worldToIJK: volumeConfig.worldToIJK }),
      ...(volumeConfig.voxelSize === undefined ? {} : { voxelSize: volumeConfig.voxelSize }),
      ...(volumeConfig.volumeOrigin === undefined ? {} : { volumeOrigin: volumeConfig.volumeOrigin }),
      ...(volumeConfig.useHalfFloat === undefined ? {} : { useHalfFloat: volumeConfig.useHalfFloat }),
      ...(volumeConfig.projectionMode === undefined ? {} : { projectionMode: volumeConfig.projectionMode }),
      ...(volumeConfig.pialPositions === undefined ? {} : { pialPositions: volumeConfig.pialPositions }),
      ...(volumeConfig.whitePositions === undefined ? {} : { whitePositions: volumeConfig.whitePositions }),
      ...(volumeConfig.ribbonSamples === undefined ? {} : { ribbonSamples: volumeConfig.ribbonSamples }),
      ...(volumeConfig.ribbonReducer === undefined ? {} : { ribbonReducer: volumeConfig.ribbonReducer })
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
    this.selectedSurfaceId = surfaceId;
    this.invalidateState(['selection']);
  }

  /** @deprecated Pane data-range bindings no longer exist. This no-op is removed in v3. */
  updateDataRange(data: Float32Array): void {
    void data;
    warnLegacyPaneMember(
      'updateDataRange()',
      'Read ranges from individual layers and mutate them through layer APIs.'
    );
  }

  removeSurface(id: string): void {
    this.withStateChangeBatch(() => {
      const surface = this.surfaces.get(id);
      if (!surface) return;

      this.removeBilateralSurfaceGroupForSurface(id, 'surface-removed');
      const inspectionSelection = this.getInspectionSelection();
      if (inspectionSelection.kind !== 'none' && inspectionSelection.surfaceId === id) {
        this.clearInspectionSelection();
      }
      this.detachSurfaceSubscriptions(id);
      this.ensurePickingController().removeSurface(id);
      if (surface.mesh) {
        this.scene.remove(surface.mesh);
      }
      surface.dispose();
      this.surfaces.delete(id);

      if (this.selectedSurfaceId === id) {
        this.selectedSurfaceId = null;
        this.selectedLayerId = null;
        this.invalidateState(['selection']);
      }
      this.emit('surface:removed', { surface, id, surfaceId: id });
      this.requestRender();
    });
  }

  addLayer(surfaceId: string, layer: Layer): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface && surface instanceof MultiLayerNeuroSurface) {
      surface.addLayer(layer);
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

  getOrderedLayers(surfaceId: string): readonly Layer[] {
    const surface = this.surfaces.get(surfaceId);
    return surface instanceof MultiLayerNeuroSurface
      ? surface.getOrderedLayers()
      : Object.freeze([]);
  }

  getLayerOrderDescriptors(surfaceId: string): readonly LayerOrderDescriptor[] {
    const surface = this.surfaces.get(surfaceId);
    return surface instanceof MultiLayerNeuroSurface
      ? surface.getLayerOrderDescriptors()
      : Object.freeze([]);
  }

  setLayerOrder(surfaceId: string, layerIds: readonly string[]): LayerOrderResult {
    const surface = this.surfaces.get(surfaceId);
    if (!(surface instanceof MultiLayerNeuroSurface)) {
      return Object.freeze({
        ok: false,
        code: 'surface-not-found',
        message: `Surface "${surfaceId}" does not expose a layer stack.`
      });
    }
    return surface.setLayerOrder(layerIds);
  }

  moveLayer(surfaceId: string, layerId: string, destinationIndex: number): LayerOrderResult {
    const surface = this.surfaces.get(surfaceId);
    if (!(surface instanceof MultiLayerNeuroSurface)) {
      return Object.freeze({
        ok: false,
        code: 'surface-not-found',
        message: `Surface "${surfaceId}" does not expose a layer stack.`
      });
    }
    return surface.moveLayer(layerId, destinationIndex);
  }

  clearSurfaces(): void {
    this.withStateChangeBatch(() => {
      if (this.crosshair.visible) {
        this.hideCrosshair();
      }
      if (this.getInspectionSelection().kind !== 'none') {
        this.clearInspectionSelection();
      }
      for (const groupId of this.getBilateralSurfaceGroups().map(group => group.id)) {
        this.removeBilateralSurfaceGroup(groupId, 'surfaces-cleared');
      }
      this.surfaces.forEach((surface, id) => {
        this.detachSurfaceSubscriptions(id);
        if (surface.mesh) {
          this.scene.remove(surface.mesh);
        }
        surface.dispose();
        this.annotations.removeBySurface(id);
        this.emit('surface:removed', { surface, id, surfaceId: id });
      });
      this.surfaces.clear();
      if (this.selectedSurfaceId !== null || this.selectedLayerId !== null) {
        this.selectedSurfaceId = null;
        this.selectedLayerId = null;
        this.invalidateState(['selection']);
      }
      this.requestRender();
    });
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
    this.invalidateState(['appearance']);
  }

  setupPicking(): void {
    if (this.ensurePickingController().initializeGPU(this.renderer, this.config.useGPUPicking)) {
      debugLog('GPU picking enabled');
    }

    this.renderer.domElement.addEventListener('mousemove', this.handleMouseMove);
    this.invalidateState(['selection']);
  }

  private onMouseMoveHandler(event: MouseEvent): void {
    if (this.disposed) return;
    this.ensurePickingController().updateScreenPosition(event.clientX, event.clientY);
    this.emit('mouse:move', {
      position: this.mouse.clone(),
      intersection: this.getIntersectionPoint().clone()
    });
    this.updateHoverCrosshair(event);
  }

  private setupSurfaceClick(): void {
    this.renderer.domElement.addEventListener('click', this.handleSurfaceClick);
  }

  private onSurfaceClickHandler(event: MouseEvent): void {
    if (this.disposed) return;
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

    this.setInspectionSelection({
      kind: 'vertex',
      surfaceId: hit.surfaceId,
      vertexIndex: hit.vertexIndex
    });

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

  /** Return the canonical scientific inspection selection. */
  getInspectionSelection(): InspectionSelection {
    return this.inspectionSelection ?? NO_INSPECTION_SELECTION;
  }

  /**
   * Validate and atomically replace the scientific inspection selection.
   * Panel focus, annotations, and crosshair state are deliberately separate.
   */
  setInspectionSelection(
    selection: InspectionSelection,
    options: InspectionSelectionOptions = {}
  ): InspectionSelectionResult {
    if (this.disposed) {
      return Object.freeze({
        ok: false,
        code: 'disposed',
        message: 'The viewer has been disposed.'
      });
    }

    let normalized: InspectionSelection;
    if (selection.kind === 'none') {
      normalized = NO_INSPECTION_SELECTION;
    } else {
      const surface = this.surfaces?.get(selection.surfaceId);
      if (!surface) {
        return Object.freeze({
          ok: false,
          code: 'surface-not-found',
          message: `Surface "${selection.surfaceId}" was not found.`
        });
      }

      if (selection.kind === 'vertex') {
        if (!this.isValidSurfaceVertex(surface, selection.vertexIndex)) {
          return Object.freeze({
            ok: false,
            code: 'invalid-vertex',
            message: `Vertex ${selection.vertexIndex} is outside surface "${selection.surfaceId}".`
          });
        }
        normalized = freezeInspectionSelection(selection);
      } else {
        const parcelSurface = surface as any;
        if (typeof parcelSurface.getParcelRecord !== 'function') {
          return Object.freeze({
            ok: false,
            code: 'unsupported',
            message: `Surface "${selection.surfaceId}" does not expose parcel inspection.`
          });
        }
        if (!Number.isInteger(selection.parcelId)) {
          return Object.freeze({
            ok: false,
            code: 'parcel-not-found',
            message: `Parcel ${selection.parcelId} is not a valid parcel ID.`
          });
        }

        let parcelRecord: unknown;
        try {
          parcelRecord = parcelSurface.getParcelRecord(selection.parcelId);
        } catch {
          parcelRecord = null;
        }
        if (!parcelRecord) {
          return Object.freeze({
            ok: false,
            code: 'parcel-not-found',
            message: `Parcel ${selection.parcelId} was not found on surface "${selection.surfaceId}".`
          });
        }

        let representativeVertexIndex = selection.representativeVertexIndex;
        if (representativeVertexIndex === undefined &&
            typeof parcelSurface.getRepresentativeVertexIndex === 'function') {
          try {
            representativeVertexIndex = parcelSurface.getRepresentativeVertexIndex(selection.parcelId) ?? undefined;
          } catch {
            representativeVertexIndex = undefined;
          }
        }
        if (representativeVertexIndex !== undefined) {
          if (!this.isValidSurfaceVertex(surface, representativeVertexIndex)) {
            return Object.freeze({
              ok: false,
              code: 'invalid-vertex',
              message: `Representative vertex ${representativeVertexIndex} is outside surface ` +
                `"${selection.surfaceId}".`
            });
          }
          if (typeof parcelSurface.getParcelIdForVertex === 'function') {
            let representativeParcelId: number | null;
            try {
              representativeParcelId = parcelSurface.getParcelIdForVertex(representativeVertexIndex);
            } catch {
              representativeParcelId = null;
            }
            if (representativeParcelId !== null && representativeParcelId !== selection.parcelId) {
              return Object.freeze({
                ok: false,
                code: 'invalid-vertex',
                message: `Representative vertex ${representativeVertexIndex} belongs to parcel ` +
                  `${representativeParcelId}, not ${selection.parcelId}.`
              });
            }
          }
        }

        let actualAtlasId: string | undefined;
        if (typeof parcelSurface.getParcelData === 'function') {
          try {
            const id = parcelSurface.getParcelData()?.atlas?.id;
            if (typeof id === 'string' && id.length > 0) actualAtlasId = id;
          } catch {
            actualAtlasId = undefined;
          }
        }
        if (selection.atlasId !== undefined && actualAtlasId !== undefined &&
            selection.atlasId !== actualAtlasId) {
          return Object.freeze({
            ok: false,
            code: 'atlas-mismatch',
            message: `Atlas "${selection.atlasId}" does not match surface atlas "${actualAtlasId}".`
          });
        }

        normalized = freezeInspectionSelection({
          kind: 'parcel',
          surfaceId: selection.surfaceId,
          parcelId: selection.parcelId,
          ...(representativeVertexIndex !== undefined ? { representativeVertexIndex } : {}),
          ...(actualAtlasId !== undefined || selection.atlasId !== undefined
            ? { atlasId: actualAtlasId ?? selection.atlasId }
            : {})
        });
      }
    }

    const previous = this.getInspectionSelection();
    const changed = !inspectionSelectionsEqual(previous, normalized);
    if (changed) {
      this.inspectionSelection = normalized;
      this.emit('selection:changed', { selection: normalized, previous });
    }
    this.updateInspectionCrosshair(normalized, options);
    return Object.freeze({ ok: true, changed, selection: normalized });
  }

  clearInspectionSelection(
    options: InspectionSelectionOptions = {}
  ): InspectionSelectionResult {
    return this.setInspectionSelection(NO_INSPECTION_SELECTION, options);
  }

  /**
   * Inspect one vertex through stable surface/layer IDs. Missing scalar values
   * are represented as null; no live viewer, layer, surface, Three.js, or typed
   * array object escapes in the returned snapshot.
   */
  inspectVertex(surfaceId: string, vertexIndex: number): VertexInspection | null {
    if (this.disposed) return null;
    const surface = this.surfaces?.get(surfaceId);
    if (!surface || !this.isValidSurfaceVertex(surface, vertexIndex)) return null;

    surface.mesh?.updateMatrixWorld(true);
    const worldPosition = this.getWorldPositionForVertex(surface, vertexIndex);
    if (!worldPosition || !worldPosition.toArray().every(Number.isFinite)) return null;
    const world = Object.freeze(worldPosition.toArray()) as readonly [number, number, number];

    const values: VertexInspectionLayerValue[] = [];
    const orderedLayers = typeof (surface as any).getOrderedLayers === 'function'
      ? ((surface as any).getOrderedLayers() as readonly Layer[])
      : [];
    for (const layer of orderedLayers) {
      const sampler = (layer as Layer & {
        sampleValueAtVertex?: (index: number) => number | string | null;
      }).sampleValueAtVertex;
      if (typeof sampler !== 'function') continue;

      let sampled: number | string | null;
      try {
        const value = sampler.call(layer, vertexIndex);
        sampled = typeof value === 'number'
          ? (Number.isFinite(value) ? value : null)
          : typeof value === 'string'
            ? value
            : null;
      } catch {
        sampled = null;
      }
      const presentation = layer.getPresentation();
      values.push(Object.freeze({
        layerId: layer.id,
        label: presentation.label,
        value: sampled,
        ...(presentation.units !== undefined ? { units: presentation.units } : {}),
        missing: sampled === null
      }));
    }

    let parcel: VertexInspectionParcel | undefined;
    let atlas: VertexInspectionAtlas | undefined;
    const parcelSurface = surface as any;
    let parcelId: number | null = null;
    if (typeof parcelSurface.getParcelIdForVertex === 'function') {
      try {
        parcelId = parcelSurface.getParcelIdForVertex(vertexIndex);
      } catch {
        parcelId = null;
      }
    }
    let parcelLabel: string | undefined;
    if (parcelId !== null && Number.isInteger(parcelId)) {
      if (typeof parcelSurface.getParcelRecord === 'function') {
        try {
          const label = parcelSurface.getParcelRecord(parcelId)?.label;
          if (typeof label === 'string') parcelLabel = label;
        } catch {
          parcelLabel = undefined;
        }
      }
      parcel = Object.freeze({
        id: parcelId,
        ...(parcelLabel !== undefined ? { label: parcelLabel } : {})
      });
    }

    if (typeof parcelSurface.getParcelData === 'function') {
      try {
        const atlasMetadata = parcelSurface.getParcelData()?.atlas;
        if (typeof atlasMetadata?.id === 'string' && atlasMetadata.id.length > 0) {
          atlas = Object.freeze({
            id: atlasMetadata.id,
            ...(typeof atlasMetadata.name === 'string' ? { name: atlasMetadata.name } : {})
          });
        }
      } catch {
        atlas = undefined;
      }
    }

    return Object.freeze({
      surfaceId,
      vertexIndex,
      world,
      ...(parcel ? { parcel } : {}),
      ...(atlas ? { atlas } : {}),
      values: Object.freeze(values)
    });
  }

  private isValidSurfaceVertex(surface: NeuroSurface, vertexIndex: number): boolean {
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0) return false;
    const position = surface.mesh?.geometry.getAttribute('position');
    if (position) return vertexIndex < position.count;
    return vertexIndex < surface.geometry.vertices.length / 3;
  }

  private updateInspectionCrosshair(
    selection: InspectionSelection,
    options: InspectionSelectionOptions
  ): void {
    if (!options.showCrosshair) return;
    if (selection.kind === 'none') {
      if (this.crosshair?.mode === 'selection') this.hideCrosshair();
      return;
    }
    const vertexIndex = selection.kind === 'vertex'
      ? selection.vertexIndex
      : selection.representativeVertexIndex;
    if (vertexIndex !== undefined) {
      this.showCrosshair(selection.surfaceId, vertexIndex, { mode: 'selection' });
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
    const currentSelection = this.getInspectionSelection();
    const clearsCanonicalParcel = currentSelection.kind === 'parcel';
    if (clearsCanonicalParcel) {
      this.clearInspectionSelection();
    }
    if (clearsCanonicalParcel && this.crosshair.mode === 'selection') {
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
    return this.ensurePickingController().pick(options);
  }

  // Lightweight option bag for embed environments (e.g. R HTML widgets)
  setOption(key: string, value: any): void {
    this.options.set(key, value);
    this.invalidateState(['appearance']);
  }

  getOption<T = any>(key: string, fallback?: T): T | undefined {
    return (this.options.has(key) ? this.options.get(key) : fallback) as T | undefined;
  }

  /**
   * Enable GPU-based picking for faster vertex selection.
   * Automatically registers all existing surfaces with the GPU picker.
   */
  enableGPUPicking(): boolean {
    if (!this.ensurePickingController().enableGPU(this.renderer)) {
      console.warn('GPU picking not supported on this device');
      return false;
    }
    debugLog('GPU picking enabled');
    this.invalidateState(['selection']);
    return true;
  }

  /**
   * Disable GPU-based picking. Falls back to raycasting.
   */
  disableGPUPicking(): void {
    if (this.ensurePickingController().isGPUEnabled()) {
      this.ensurePickingController().disableGPU();
      this.invalidateState(['selection']);
    }
  }

  /**
   * Check if GPU picking is currently enabled and available.
   */
  isGPUPickingEnabled(): boolean {
    return this.ensurePickingController().isGPUEnabled();
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
    this.invalidateState(['selection']);
  }

  hideCrosshair(): void {
    this.crosshair.hide();
    this.invalidateState(['selection']);
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

    if (mode === 'selection') {
      const selectionResult = this.setInspectionSelection({
        kind: 'parcel',
        surfaceId,
        parcelId,
        representativeVertexIndex: focusVertexIndex,
        ...(payload.atlasId ? { atlasId: payload.atlasId } : {})
      });
      if (!selectionResult.ok) return false;
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
    this.invalidateState(['selection']);
  }

  /** Coalesce an invalidation into the next animation frame. */
  requestRender(): void {
    this.ensureRenderScheduler().requestRender();
  }

  animate(): void {
    this.ensureRenderScheduler().runFrame();
  }

  private cancelPendingFrame(): void {
    this.renderScheduler?.cancelPendingFrame();
  }

  private createRenderScheduler(initiallyDirty = false): ViewerRenderScheduler {
    return new ViewerRenderScheduler({
      canInvalidate: () => !this.disposed && !this.initializationFailed,
      canRun: () => !this.disposed && !this.initializationFailed &&
        !(this.contextLifecycle?.isLost() ?? false),
      updateControls: () => {
        if (this.cameraControls && this.cameraInteractionEnabled) {
          this.cameraControls.update();
        }
      },
      render: () => this.render(),
      controlsHaveDamping: () => this.controlsHaveDamping(),
      onRenderNeeded: () => this.emit('render:needed')
    }, { initiallyDirty });
  }

  private ensureRenderScheduler(): ViewerRenderScheduler {
    this.renderScheduler ??= this.createRenderScheduler(false);
    return this.renderScheduler;
  }

  private controlsHaveDamping(): boolean {
    if (!this.cameraControls) return false;
    if ('staticMoving' in this.cameraControls) {
      return this.cameraControls.staticMoving === false;
    }
    // SurfaceControls exposes the legacy flag for compatibility but performs
    // its camera updates synchronously in input handlers.
    return false;
  }

  render(): void {
    if (
      this.disposed ||
      this.initializationFailed ||
      (this.contextLifecycle?.isLost() ?? false)
    ) return;
    // Surface compositing uses its own throttled RAF. Flush pending work here
    // so this canvas paint always observes layer changes made before the frame.
    for (const surface of this.surfaces.values()) {
      if (surface instanceof MultiLayerNeuroSurface) {
        surface.flushPendingColorUpdate();
      }
    }
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

  /** Enable automatic on-demand rendering and request one frame. */
  startRenderLoop(): void {
    if (this.disposed || this.initializationFailed) return;
    this.ensureRenderScheduler().start();
  }

  /** Stop automatic on-demand rendering until startRenderLoop() is called. */
  stopRenderLoop(): void {
    this.stop();
  }

  /**
   * Back-compat alias for htmlwidgets callers.
   */
  start(): void {
    this.startRenderLoop();
  }

  /** Pause automatic rendering and cancel the currently pending frame. */
  stop(): void {
    this.ensureRenderScheduler().stop();
  }

  centerCamera(): void {
    this.currentAnatomicalView = null;
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
      if (this.cameraControls) {
        this.cameraControls.target.set(0, 0, 0);
        (this.cameraControls as any).minDistance = 0.05;
        (this.cameraControls as any).maxDistance = Infinity;
        this.cameraControls.update();
      }
      this.invalidateState(['camera']);
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
    if (this.cameraControls) {
      this.cameraControls.target.copy(center);
      (this.cameraControls as any).minDistance = Math.max(radius * 0.6, 0.05);
      (this.cameraControls as any).maxDistance = Math.max(radius * 20, optimalDistance * 2);
      this.cameraControls.update();
    }

    // Update near/far planes for scene size
    this.camera.near = Math.max(optimalDistance / 1000, 0.001);
    this.camera.far = optimalDistance * 10;
    this.camera.updateProjectionMatrix();

    // Store initial zoom for reset
    this.config.initialZoom = optimalDistance;
    this.invalidateState(['camera']);
    this.requestRender();
  }

  setZoom(distance: number, options: { updateInitial?: boolean } = {}): void {
    const requestedDistance = finiteNumber(distance, 'distance', {
      minimum: 0,
      minimumExclusive: true
    });
    const target = this.cameraControls?.target ?? new THREE.Vector3(0, 0, 0);
    const dir = new THREE.Vector3().subVectors(this.camera.position, target).normalize();
    const minClamp = this.sceneBoundsRadius > 0 ? Math.max(0.05, this.sceneBoundsRadius * 0.6) : 0.05;
    const maxClamp = this.sceneBoundsRadius > 0
      ? Math.max(this.sceneBoundsRadius * 20, requestedDistance)
      : Infinity;
    const safeDistance = Math.min(maxClamp, Math.max(minClamp, requestedDistance));
    this.camera.position.copy(target).addScaledVector(dir, safeDistance);
    this.camera.updateProjectionMatrix();
    if (this.cameraControls?.update) {
      this.cameraControls.update();
    }
    if (options.updateInitial !== false) {
      this.config.initialZoom = safeDistance;
    }
    this.invalidateState(['camera']);
    this.requestRender();
  }

  resize(width: number, height: number, options: { dpr?: number } = {}): { width: number; height: number; dpr: number } {
    const nextWidth = finiteNumber(width, 'width', { minimum: 0, minimumExclusive: true });
    const nextHeight = finiteNumber(height, 'height', { minimum: 0, minimumExclusive: true });
    const dpr = normalizeDevicePixelRatio(
      options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
    );
    this.renderer.setPixelRatio(dpr);
    this.width = nextWidth;
    this.height = nextHeight;
    
    this.camera.aspect = nextWidth / nextHeight;
    this.camera.updateProjectionMatrix();
    
    this.renderer.setSize(nextWidth, nextHeight);
    
    if (this.composer) {
      this.composer.setSize(nextWidth, nextHeight);
    }
    
    if (this.ssaoPass) {
      this.ssaoPass.setSize(nextWidth, nextHeight);
    }

    this.surfaces.forEach(surface => {
      if (surface instanceof MultiLayerNeuroSurface) {
        surface.updateOutlineResolution(nextWidth, nextHeight, dpr);
      }
    });
    
    this.emit('resize', { width: nextWidth, height: nextHeight });
    this.requestRender();
    return { width: nextWidth, height: nextHeight, dpr };
  }

  // -------------------------------------------------------------------------
  // State Serialization
  // -------------------------------------------------------------------------

  /** Capture the entire viewer state as a JSON-compatible object. */
  toJSON(): ViewerStateV2 {
    return serialize(this);
  }

  /** Restore viewer state from a serialized object. */
  fromJSON(state: ViewerState): RestorationReport {
    return this.withStateChangeBatch(() => deserialize(this, state));
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
      drawFigureOverlays(ctx, exportOptions, this.annotationLabelsForExport());

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
    this.renderScheduler?.dispose();
    try {
      super.emit('viewer:disposing');
    } catch (error) {
      console.error('surfview: viewer disposal listener failed', error);
    }
    this.inspectionSelection = NO_INSPECTION_SELECTION;
    this.currentAnatomicalView = null;
    try {
      this.plugins.dispose();
    } catch (error) {
      console.error('surfview: plugin teardown failed during viewer disposal', error);
    }
    if (this.initializationFailed) {
      this.stateChanges?.dispose();
      this.removeAllListeners();
      return;
    }
    // Dispose of all surfaces
    this.clearSurfaces();
    
    // Dispose of camera interaction controls
    if (this.cameraControls) {
      this.detachControlListeners();
      this.cameraControls.dispose();
    }
    
    // Dispose of post-processing
    if (this.composer) {
      this.composer.dispose();
    }

    this.pickingController?.dispose();

    // Dispose of environment map
    if (this.environmentMap) {
      this.environmentMap.dispose();
    }

    // Detach listeners
    this.teardownContextLossHandling();
    this.renderer.domElement.removeEventListener('click', this.handleSurfaceClick);
    this.renderer.domElement.removeEventListener('mousemove', this.handleMouseMove);

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
    this.stateChanges?.dispose();
    this.removeAllListeners();
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

  /** @deprecated Pane controls no longer exist. This always returns false. */
  getControlsVisible(): boolean {
    warnLegacyPaneMember(
      'getControlsVisible()',
      'Track application-owned panel visibility in the application.'
    );
    return false;
  }

  /** @deprecated Pane controls no longer exist. This no-op is removed in v3. */
  toggleControls(show?: boolean): void {
    void show;
    warnLegacyPaneMember(
      'toggleControls()',
      'Track application-owned panel visibility in the application.'
    );
  }

  /** @deprecated Pane controls no longer exist. This no-op is removed in v3. */
  togglePaneMinimized(): void {
    warnLegacyPaneMember(
      'togglePaneMinimized()',
      'Track application-owned panel disclosure in the application.'
    );
  }

  /** @deprecated Pane controls no longer exist. This no-op is removed in v3. */
  minimizeControlsPane(): void {
    warnLegacyPaneMember(
      'minimizeControlsPane()',
      'Track application-owned panel disclosure in the application.'
    );
  }

  /** @deprecated Pane controls no longer exist. This no-op is removed in v3. */
  restoreControlsPane(): void {
    warnLegacyPaneMember(
      'restoreControlsPane()',
      'Track application-owned panel disclosure in the application.'
    );
  }

  isInteractionEnabled(): boolean {
    return this.cameraInteractionEnabled;
  }

  setInteractionEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    if (this.cameraInteractionEnabled === next) return;
    this.cameraInteractionEnabled = next;
    if (this.cameraControls && 'enabled' in this.cameraControls) {
      this.cameraControls.enabled = next;
    }
    this.emit('controls:changed', { enabled: next });
    this.requestRender();
  }

  /** @deprecated Use setInteractionEnabled(true). */
  enableControls(): void {
    warnLegacyInteractionMember('enableControls()');
    this.setInteractionEnabled(true);
  }

  /** @deprecated Use setInteractionEnabled(false). */
  disableControls(): void {
    warnLegacyInteractionMember('disableControls()');
    this.setInteractionEnabled(false);
  }

  getIntersectionPoint(): THREE.Vector3 {
    return this.ensurePickingController().getIntersectionPoint();
  }

  getRayDirection(): THREE.Vector3 {
    return this.ensurePickingController().getRayDirection();
  }

  updateSurfaceData(surfaceId: string, data: Float32Array, indices?: Uint32Array): void {
    void indices;
    const surface = this.surfaces.get(surfaceId);
    if (surface instanceof ColorMappedNeuroSurface) {
      surface.setData(data);
      this.invalidateState(['layers']);
      this.requestRender();
    }
  }

  updateColorMap(surfaceId: string, colormap: ColorMap | string): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface instanceof ColorMappedNeuroSurface) {
      this.withStateChangeBatch(() => {
        surface.setColorMap(colormap);
        this.emit('surface:colormap', {
          surfaceId,
          colormap: typeof colormap === 'string' ? colormap : 'custom'
        });
        this.requestRender();
      });
    }
  }

  getSurface(id: string): NeuroSurface | undefined {
    return this.surfaces.get(id);
  }

  getSurfaceIds(): string[] {
    return Array.from(this.surfaces.keys());
  }

  /** Return the renderer background without exposing renderer objects. */
  getFigureBackground(): ViewerFigureBackground {
    const color = this.renderer && typeof this.renderer.getClearColor === 'function'
      ? this.renderer.getClearColor(new THREE.Color()).getHex()
      : this.config?.backgroundColor ?? 0x000000;
    const alpha = this.renderer && typeof this.renderer.getClearAlpha === 'function'
      ? this.renderer.getClearAlpha()
      : this.stylePreset?.background.clearAlpha ?? 1;
    return Object.freeze({
      color,
      transparent: alpha < 1
    });
  }

  /**
   * Set the interactive and figure-export background as one observable
   * appearance mutation. Returns false when the requested state is unchanged
   * or the viewer is unavailable.
   */
  setFigureBackground(backgroundColor: number, transparent = false): boolean {
    if (this.disposed || this.initializationFailed || !this.renderer) return false;
    if (!Number.isInteger(backgroundColor) || backgroundColor < 0 || backgroundColor > 0xffffff) {
      throw new RangeError(
        'Figure background must be an integer RGB value between 0x000000 and 0xffffff.'
      );
    }
    const nextColor = Math.trunc(backgroundColor);
    const nextTransparent = Boolean(transparent);
    const current = this.getFigureBackground();
    if (current.color === nextColor && current.transparent === nextTransparent) return false;

    this.withStateChangeBatch(() => {
      this.config.backgroundColor = nextColor;
      this.renderer.setClearColor(nextColor, nextTransparent ? 0 : 1);
      if (this.container?.style) {
        this.container.style.background = nextTransparent ? 'transparent' : colorToCSS(nextColor);
      }
      this.invalidateState(['appearance']);
      this.requestRender();
    });
    return true;
  }

  updateConfig(newConfig: Partial<NeuroSurfaceViewerConfig>): void {
    const normalizedConfig = normalizeViewerConfig(newConfig, this.config);
    const resolvedPreset = newConfig.preset !== undefined
      ? resolveStylePreset(newConfig.preset)
      : null;
    this.withStateChangeBatch(() => {
      this.config = normalizedConfig;

      // Apply relevant updates
      if (newConfig.ambientLightColor !== undefined) {
        this.updateAmbientLight(normalizedConfig.ambientLightColor);
      }
      if (newConfig.directionalLightColor !== undefined) {
        this.updateDirectionalLight(normalizedConfig.directionalLightColor);
      }
      if (newConfig.directionalLightIntensity !== undefined) {
        this.updateDirectionalLightIntensity(normalizedConfig.directionalLightIntensity);
      }
      if (newConfig.backgroundColor !== undefined && this.renderer) {
        this.renderer.setClearColor(normalizedConfig.backgroundColor);
      }
      if (newConfig.metalness !== undefined || newConfig.roughness !== undefined) {
        this.updateMaterials();
      }
      if (newConfig.ssaoRadius !== undefined && this.ssaoPass) {
        this.ssaoPass.kernelRadius = normalizedConfig.ssaoRadius;
      }
      if (newConfig.rimStrength !== undefined) {
        this.rimStrengthUniforms.forEach(uniform => {
          uniform.value = normalizedConfig.rimStrength;
        });
      }

      if (resolvedPreset) {
        this.applyStylePreset(resolvedPreset);
      }

      const observableKeys = Object.keys(newConfig).filter(key =>
        key !== 'showControls' && key !== 'useControls' && key !== 'allowCDNFallback'
      );
      if (observableKeys.length > 0) {
        this.invalidateState(['appearance']);
      }
      this.requestRender();
    });
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
    return this.withStateChangeBatch(() => {
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

      this.invalidateState(['appearance']);
      this.requestRender();
      return style;
    });
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
      target: this.cameraControls.target.toArray()
    };
  }

  setCameraState(state: any): void {
    const finiteTuple = (value: unknown, parameter: string): [number, number, number] => {
      if (!Array.isArray(value) || value.length < 3) {
        throw new RangeError(`${parameter} must contain at least three numeric components.`);
      }
      return [
        finiteNumber(value[0], `${parameter}[0]`),
        finiteNumber(value[1], `${parameter}[1]`),
        finiteNumber(value[2], `${parameter}[2]`)
      ];
    };
    const nextPosition = state.position === undefined
      ? null
      : finiteTuple(state.position, 'position');
    const nextTarget = state.target === undefined
      ? null
      : finiteTuple(state.target, 'target');
    let nextRotation: [number, number, number, THREE.EulerOrder?] | null = null;
    if (state.rotation !== undefined) {
      const tuple = finiteTuple(state.rotation, 'rotation');
      const order = state.rotation[3];
      if (order !== undefined && !['XYZ', 'YZX', 'ZXY', 'XZY', 'YXZ', 'ZYX'].includes(order)) {
        throw new TypeError(`rotation[3] must be a valid Euler order; received ${String(order)}.`);
      }
      nextRotation = order === undefined ? tuple : [...tuple, order];
    }

    this.currentAnatomicalView = null;
    if (nextPosition) {
      this.camera.position.fromArray(nextPosition);
    }
    if (nextRotation) {
      this.camera.rotation.fromArray(nextRotation);
    }
    if (nextTarget) {
      this.cameraControls.target.fromArray(nextTarget);
    }
    this.cameraControls.update();
    this.invalidateState(['camera']);
    this.requestRender();
  }
}
