import { vi } from 'vitest';
import * as THREE from 'three';
import {
  createReportSceneControlTarget,
  DataLayer,
  EventEmitter,
  getStylePreset,
  MultiLayerNeuroSurface,
  NeuroSurfaceViewer,
  ReportSceneController,
  SurfaceGeometry
} from '../../src';
import type {
  ReportSceneControlTarget,
  SurfViewSceneManifest,
  ViewerEventMap
} from '../../src';
import { PluginHost } from '../../src/PluginHost';

export interface ReportSceneFixture {
  readonly viewer: NeuroSurfaceViewer;
  readonly manifest: SurfViewSceneManifest;
  readonly controller: ReportSceneController;
  readonly target: ReportSceneControlTarget;
  readonly left: MultiLayerNeuroSurface;
  readonly right: MultiLayerNeuroSurface;
  readonly leftResponse: DataLayer;
  readonly leftUncertainty: DataLayer;
  dispose(): void;
}

function geometry(hemisphere: 'left' | 'right'): SurfaceGeometry {
  const offset = hemisphere === 'left' ? -2 : 2;
  return new SurfaceGeometry(
    new Float32Array([
      offset, 0, 0,
      offset + 1, 0, 0,
      offset, 2, 0,
      offset, 0, 3
    ]),
    new Uint32Array([
      0, 1, 2,
      0, 2, 3
    ]),
    hemisphere
  );
}

export function reportManifestFixture(): SurfViewSceneManifest {
  return {
    schemaVersion: 'surfview.scene.v1',
    id: 'report-fixture',
    assets: {},
    geometries: {
      lh: {
        id: 'lh',
        hemisphere: 'left',
        vertices: 'lh-vertices',
        faces: 'lh-faces',
        vertexCount: 4,
        faceCount: 2,
        metadata: { subject: 'template', surface: 'pial' }
      },
      rh: {
        id: 'rh',
        hemisphere: 'right',
        vertices: 'rh-vertices',
        faces: 'rh-faces',
        vertexCount: 4,
        faceCount: 2
      }
    },
    layers: {
      response: {
        id: 'response',
        label: 'Response fallback',
        values: {
          lh: { values: 'lh-response' },
          rh: { values: 'rh-response' }
        },
        colorMap: 'viridis',
        limits: [-3, 5],
        units: 'fallback-units',
        legend: {
          title: 'Language response',
          units: 'z',
          visible: true,
          metadata: { ticks: [-3, 0, 5] }
        },
        metadata: { contrast: 'language-control' },
        provenance: { pipeline: 'report-builder', version: 2 }
      },
      uncertainty: {
        id: 'uncertainty',
        label: 'Standard error',
        values: {
          lh: { values: 'lh-uncertainty' },
          rh: { values: 'rh-uncertainty' }
        },
        colorMap: 'magma',
        limits: [0, 1],
        units: 'SE',
        legend: { visible: false }
      }
    },
    selectedLayer: 'response',
    metadata: { report: 'fixture' },
    provenance: { generator: 'unit-test' }
  };
}

export function makeReportViewer(): NeuroSurfaceViewer {
  const viewer = new EventEmitter<ViewerEventMap>() as unknown as NeuroSurfaceViewer;
  Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);

  let clearColor = 0x000000;
  let clearAlpha = 1;
  const renderer = {
    getPixelRatio: () => 1,
    getClearColor: (target: THREE.Color) => target.setHex(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: vi.fn((color: THREE.ColorRepresentation, alpha = 1) => {
      clearColor = new THREE.Color(color).getHex();
      clearAlpha = alpha;
    }),
    render: vi.fn()
  };
  const mutable = viewer as any;
  mutable.disposed = false;
  mutable.initializationFailed = false;
  mutable.stateRevision = 0;
  mutable.stateChangeBatchDepth = 0;
  mutable.pendingStateDomains = new Set();
  mutable.surfaceSubscriptions = new Map();
  mutable.bilateralSurfaceGroups = new Map();
  mutable.surfaceGroupMembership = new Map();
  mutable.inspectionSelection = Object.freeze({ kind: 'none' });
  mutable.container = { style: {} } as HTMLElement;
  mutable.width = 800;
  mutable.height = 600;
  mutable.surfaces = new Map();
  mutable.scene = new THREE.Scene();
  mutable.camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 1000);
  mutable.camera.position.set(0, 0, 20);
  mutable.cameraControls = {
    target: new THREE.Vector3(),
    update: vi.fn(),
    enabled: true,
    dispose: vi.fn()
  };
  mutable.renderer = renderer;
  mutable.config = {
    useShaders: false,
    rimStrength: 0,
    initialZoom: 12,
    hoverCrosshairSize: 1.2,
    hoverCrosshairColor: 0x66ccff,
    preset: 'default',
    backgroundColor: 0x000000,
    ambientLightColor: 0xb5b5b5,
    directionalLightColor: 0xffffff,
    directionalLightIntensity: 1.6,
    metalness: 0.1,
    roughness: 0.6,
    ssaoRadius: 4,
    ssaoKernelSize: 32
  };
  mutable.stylePreset = getStylePreset('default');
  mutable.viewpoint = 'lateral';
  mutable.currentViewpointKey = '';
  mutable.currentAnatomicalView = null;
  mutable.viewpointState = null;
  mutable.sceneBoundsRadius = 0;
  mutable.rimStrengthUniforms = [];
  mutable.environmentMap = null;
  mutable.ambientLight = new THREE.AmbientLight(0xffffff);
  mutable.directionalLight = new THREE.DirectionalLight(0xffffff);
  mutable.ssaoPass = null;
  mutable.gpuPicker = null;
  mutable.selectedLayerId = null;
  mutable.selectedSurfaceId = null;
  mutable.cameraInteractionEnabled = true;
  mutable.animationId = null;
  mutable.options = new Map();
  mutable.crosshair = {
    visible: false,
    mode: null,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn()
  };
  mutable.annotations = {
    removeBySurface: vi.fn(),
    setDefaults: vi.fn(),
    dispose: vi.fn()
  };
  mutable.requestRender = vi.fn();
  mutable.setViewpoint = vi.fn();
  mutable.exportPNG = vi.fn(() => 'data:image/png;base64,cmVwb3J0');
  mutable.plugins = new PluginHost(viewer);
  return viewer;
}

export function makeReportFixture(): ReportSceneFixture {
  const viewer = makeReportViewer();
  const manifest = reportManifestFixture();
  const left = new MultiLayerNeuroSurface(geometry('left'));
  const right = new MultiLayerNeuroSurface(geometry('right'));
  const leftResponse = new DataLayer(
    'response',
    [1, 2, 3, 4],
    null,
    'viridis',
    { range: [-3, 5], visible: true }
  );
  const leftUncertainty = new DataLayer(
    'uncertainty',
    [0.1, 0.2, 0.3, 0.4],
    null,
    'magma',
    { range: [0, 1], visible: false }
  );
  left.addLayer(leftResponse);
  left.addLayer(leftUncertainty);
  right.addLayer(new DataLayer(
    'response',
    [4, 3, 2, 1],
    null,
    'viridis',
    { range: [-3, 5], visible: true }
  ));
  right.addLayer(new DataLayer(
    'uncertainty',
    [0.4, 0.3, 0.2, 0.1],
    null,
    'magma',
    { range: [0, 1], visible: false }
  ));
  viewer.addSurface(left, 'lh');
  viewer.addSurface(right, 'rh');
  const group = {
    id: 'cortex',
    leftSurfaceId: 'lh',
    rightSurfaceId: 'rh'
  } as const;
  const registration = viewer.registerBilateralSurfaceGroup(group);
  if (!registration.ok) throw new Error(registration.message);
  const controller = new ReportSceneController(viewer, manifest, {
    bilateralGroup: group,
    initialView: 'lateral',
    hemisphereGap: 12
  });
  const target = createReportSceneControlTarget(controller, { histogramBins: 4 });
  return {
    viewer,
    manifest,
    controller,
    target,
    left,
    right,
    leftResponse,
    leftUncertainty,
    dispose() {
      target.dispose();
      controller.dispose();
      left.dispose();
      right.dispose();
    }
  };
}
