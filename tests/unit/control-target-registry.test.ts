import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createManagedViewerControlSession,
  createSurfViewControlSession,
  createViewerControlTarget,
  DataLayer,
  EventEmitter,
  getStylePreset,
  MultiLayerNeuroSurface,
  NeuroSurfaceViewer,
  SurfaceGeometry
} from '../../src';
import type { ViewerEventMap } from '../../src/events';
import { PluginHost } from '../../src/PluginHost';

interface ListenerTracker {
  readonly active: number;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeGeometry(): SurfaceGeometry {
  return new SurfaceGeometry(
    new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]),
    new Uint32Array([0, 1, 2]),
    'left'
  );
}

function makeViewer(): NeuroSurfaceViewer {
  const viewer = new EventEmitter<ViewerEventMap>() as any;
  Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);

  let clearColor = 0x000000;
  let clearAlpha = 1;
  const rendererElement = {
    parentNode: null,
    removeEventListener: vi.fn()
  };
  const renderer = {
    domElement: rendererElement,
    getPixelRatio: () => 1,
    getClearColor: (target: THREE.Color) => target.setHex(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: vi.fn((color: THREE.ColorRepresentation, alpha = 1) => {
      clearColor = new THREE.Color(color).getHex();
      clearAlpha = alpha;
    }),
    dispose: vi.fn(),
    forceContextLoss: vi.fn()
  };

  viewer.disposed = false;
  viewer.initializationFailed = false;
  viewer.stateRevision = 0;
  viewer.stateChangeBatchDepth = 0;
  viewer.pendingStateDomains = new Set();
  viewer.surfaceSubscriptions = new Map();
  viewer.bilateralSurfaceGroups = new Map();
  viewer.surfaceGroupMembership = new Map();
  viewer.inspectionSelection = Object.freeze({ kind: 'none' });
  viewer.currentAnatomicalView = null;
  viewer.container = { style: {} } as HTMLElement;
  viewer.width = 800;
  viewer.height = 600;
  viewer.surfaces = new Map();
  viewer.scene = new THREE.Scene();
  viewer.camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 1000);
  viewer.camera.position.set(0, 0, 20);
  viewer.cameraControls = {
    target: new THREE.Vector3(),
    update: vi.fn(),
    enabled: true,
    dispose: vi.fn()
  };
  viewer.renderer = renderer;
  viewer.config = {
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
  viewer.stylePreset = getStylePreset('default');
  viewer.viewpoint = 'lateral';
  viewer.currentViewpointKey = '';
  viewer.viewpointState = null;
  viewer.sceneBoundsRadius = 0;
  viewer.rimStrengthUniforms = [];
  viewer.environmentMap = null;
  viewer.ambientLight = new THREE.AmbientLight(0xffffff);
  viewer.directionalLight = new THREE.DirectionalLight(0xffffff);
  viewer.ssaoPass = null;
  viewer.composer = null;
  viewer.gpuPicker = null;
  viewer.selectedLayerId = null;
  viewer.selectedSurfaceId = null;
  viewer.cameraInteractionEnabled = true;
  viewer.animationId = null;
  viewer.options = new Map();
  viewer.crosshair = {
    visible: false,
    mode: null,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn()
  };
  viewer.annotations = {
    removeBySurface: vi.fn(),
    setDefaults: vi.fn(),
    dispose: vi.fn()
  };
  viewer.requestRender = vi.fn();
  viewer.setViewpoint = vi.fn();
  viewer.plugins = new PluginHost(viewer);

  const surface = new MultiLayerNeuroSurface(makeGeometry());
  surface.addLayer(new DataLayer('map-a', [1, 2, 3], null, 'viridis'));
  surface.addLayer(new DataLayer('map-b', [3, 2, 1], null, 'magma'));
  viewer.addSurface(surface, 'lh');
  return viewer;
}

function trackViewerListeners(viewer: NeuroSurfaceViewer): ListenerTracker {
  const originalOn = viewer.on.bind(viewer);
  let active = 0;
  viewer.on = ((event: string, listener: (...args: unknown[]) => void) => {
    const unsubscribe = originalOn(event, listener);
    let subscribed = true;
    active += 1;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      active -= 1;
      unsubscribe();
    };
  }) as typeof viewer.on;
  return {
    get active() {
      return active;
    }
  };
}

async function flushNotifications(): Promise<void> {
  await new Promise<void>(resolve => queueMicrotask(resolve));
}

describe('managed viewer control-target registry', () => {
  it('uses a DOM-free weak viewer registry', () => {
    const source = readFileSync(
      new URL('../../src/controls/ControlTargetRegistry.ts', import.meta.url),
      'utf8'
    );

    expect(source).toMatch(/new WeakMap<NeuroSurfaceViewer/);
    expect(source).not.toMatch(/\bdocument\b|\bcustomElements\b|\bHTMLElement\b/);
    expect(source).not.toMatch(/new Map<NeuroSurfaceViewer/);
  });

  it('shares one canonical adapter while retaining independent panel focus', () => {
    const viewer = makeViewer();
    const tracker = trackViewerListeners(viewer);
    const first = createManagedViewerControlSession(viewer, {
      target: { histogramBins: 4 },
      session: { focusedSurfaceId: 'lh', focusedLayerId: 'map-a' }
    });
    const second = createManagedViewerControlSession(viewer, {
      session: { focusedSurfaceId: 'lh', focusedLayerId: 'map-b' }
    });

    expect(first.getSnapshot().canonical).toBe(second.getSnapshot().canonical);
    expect(first.getSnapshot().state.focusedLayerId).toBe('map-a');
    expect(second.getSnapshot().state.focusedLayerId).toBe('map-b');
    expect(tracker.active).toBe(4);

    first.dispose();
    second.dispose();
    expect(tracker.active).toBe(0);
    viewer.dispose();
  });

  it('keeps the remaining owner operational and removes the final registry entry', () => {
    const viewer = makeViewer();
    const tracker = trackViewerListeners(viewer);
    const first = createManagedViewerControlSession(viewer);
    const second = createManagedViewerControlSession(viewer);
    const sharedCanonical = first.getSnapshot().canonical;

    first.dispose();
    first.dispose();

    expect(tracker.active).toBe(4);
    expect(second.setLayerOpacity({ surfaceId: 'lh', layerId: 'map-a' }, 0.4))
      .toEqual({ ok: true });
    expect(second.getSnapshot().canonical.surfaces[0].layers[1].opacity).toBe(0.4);

    second.dispose();
    second.dispose();
    expect(tracker.active).toBe(0);

    const replacement = createManagedViewerControlSession(viewer);
    expect(replacement.getSnapshot().canonical).not.toBe(sharedCanonical);
    expect(replacement.getSnapshot().canonical.surfaces[0].layers[1].opacity).toBe(0.4);
    expect(tracker.active).toBe(4);
    replacement.dispose();
    expect(tracker.active).toBe(0);
    viewer.dispose();
  });

  it('disposes all owners and cancels queued work when the viewer goes first', async () => {
    const viewer = makeViewer();
    const tracker = trackViewerListeners(viewer);
    const first = createManagedViewerControlSession(viewer);
    const second = createManagedViewerControlSession(viewer);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const firstSubscription = first.subscribe(firstListener);
    const secondSubscription = second.subscribe(secondListener);
    firstListener.mockClear();
    secondListener.mockClear();

    first.setAdvancedVisible(true);
    second.setSymmetricRangeLock(true);
    viewer.dispose();
    viewer.dispose();
    await flushNotifications();

    expect(first.isDisposed()).toBe(true);
    expect(second.isDisposed()).toBe(true);
    expect(firstSubscription.closed).toBe(true);
    expect(secondSubscription.closed).toBe(true);
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();
    expect(tracker.active).toBe(0);
    expect(() => createManagedViewerControlSession(viewer)).toThrow(/disposed viewer/);
  });

  it('keeps an explicitly supplied target caller-owned', () => {
    const viewer = makeViewer();
    const tracker = trackViewerListeners(viewer);
    const target = createViewerControlTarget(viewer);
    const session = createSurfViewControlSession(target);

    expect(tracker.active).toBe(3);
    session.dispose();
    session.dispose();

    expect(target.isDisposed()).toBe(false);
    expect(tracker.active).toBe(3);
    target.dispose();
    target.dispose();
    expect(tracker.active).toBe(0);
    viewer.dispose();
  });

  it('rejects incompatible adapter options without disturbing the owner', () => {
    const viewer = makeViewer();
    const tracker = trackViewerListeners(viewer);
    const session = createManagedViewerControlSession(viewer, {
      target: { histogramBins: 4 }
    });

    expect(() => createManagedViewerControlSession(viewer, {
      target: { histogramBins: 8 }
    })).toThrow(/different target options/);
    expect(session.setLayerOpacity({ surfaceId: 'lh', layerId: 'map-a' }, 0.7))
      .toEqual({ ok: true });
    expect(tracker.active).toBe(4);

    session.dispose();
    expect(tracker.active).toBe(0);
    viewer.dispose();
  });

  it('cleans up a newly created entry when session construction fails', () => {
    const viewer = makeViewer();
    const tracker = trackViewerListeners(viewer);

    expect(() => createManagedViewerControlSession(viewer, {
      session: {
        expandedSections: ['unknown-section'] as never
      }
    })).toThrow(/unknown control section/);
    expect(tracker.active).toBe(0);

    const session = createManagedViewerControlSession(viewer);
    expect(tracker.active).toBe(4);
    session.dispose();
    expect(tracker.active).toBe(0);
    viewer.dispose();
  });

  it('emits viewer disposal exactly once', () => {
    const viewer = makeViewer();
    const disposing = vi.fn();
    viewer.on('viewer:disposing', disposing);

    viewer.dispose();
    viewer.dispose();

    expect(disposing).toHaveBeenCalledOnce();
  });
});
