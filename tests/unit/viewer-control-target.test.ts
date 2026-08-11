/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createViewerControlTarget,
  createSurfViewControlSession,
  ColorMap,
  DataLayer,
  EventEmitter,
  getStylePreset,
  Layer,
  MultiLayerNeuroSurface,
  NeuroSurfaceViewer,
  ParcelSurface,
  SurfaceGeometry,
  TwoDataLayer
} from '../../src';
import type {
  ParcelData,
  SurfViewControlSnapshot,
  ViewerControlTarget
} from '../../src';
import { PluginHost } from '../../src/PluginHost';
import {
  defineSurfViewControlsElement,
  SURFVIEW_CONTROLS_TAG,
  SurfViewControlsElement
} from '../../src/controls-ui';
import type { RestorationReport } from '../../src/serialization/ViewerState';
import type { ViewerEventMap } from '../../src/events';
import {
  runControlTargetContractLaws
} from './control-target-laws';

interface ViewerFixture {
  readonly viewer: NeuroSurfaceViewer;
  readonly target: ViewerControlTarget;
  readonly left: MultiLayerNeuroSurface;
  readonly activation: DataLayer;
  readonly variance: DataLayer;
  readonly exportPNG: ReturnType<typeof vi.fn>;
  dispose(): void;
}

class PriorityLayer extends Layer {
  constructor(id: string, priority: number) {
    super(id, { presentation: { label: id } }, {
      role: 'data',
      pinned: null,
      reorderable: true,
      priority
    });
  }

  getRGBAData(vertexCount: number): Float32Array {
    return new Float32Array(vertexCount * 4);
  }

  update(): void {}
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeGeometry(hemisphere: 'left' | 'right'): SurfaceGeometry {
  return new SurfaceGeometry(
    new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 2, 0,
      0, 0, 3
    ]),
    new Uint32Array([
      0, 1, 2,
      0, 2, 3
    ]),
    hemisphere
  );
}

function makeViewer(): NeuroSurfaceViewer {
  const viewer = new EventEmitter<ViewerEventMap>() as any;
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

  viewer.disposed = false;
  viewer.initializationFailed = false;
  viewer.stateRevision = 0;
  viewer.stateChangeBatchDepth = 0;
  viewer.pendingStateDomains = new Set();
  viewer.surfaceSubscriptions = new Map();
  viewer.bilateralSurfaceGroups = new Map();
  viewer.surfaceGroupMembership = new Map();
  viewer.inspectionSelection = Object.freeze({ kind: 'none' });
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
  return viewer;
}

function makeFixture(options: { paired?: boolean } = {}): ViewerFixture {
  const viewer = makeViewer();
  const left = new MultiLayerNeuroSurface(makeGeometry('left'));
  const activation = new DataLayer(
    'activation',
    new Float32Array([1, Number.NaN, -2, 4]),
    null,
    'viridis',
    {
      range: [-3, 5],
      threshold: [-1, 1],
      presentation: {
        label: 'Task activation',
        description: 'Language contrast',
        units: 'z',
        missingValueLabel: 'Not estimated',
        provenance: { pipeline: 'fmriprep', smoothing: 4 }
      }
    }
  );
  const variance = new DataLayer(
    'variance',
    new Float32Array([1, 2, 3, 4]),
    null,
    'magma',
    { presentation: { label: 'Variance', units: 'a.u.' } }
  );
  left.addLayer(activation);
  left.addLayer(variance);
  viewer.addSurface(left, 'lh');

  let right: MultiLayerNeuroSurface | null = null;
  if (options.paired) {
    right = new MultiLayerNeuroSurface(makeGeometry('right'));
    right.addLayer(new DataLayer('activation', [4, 3, 2, 1], null, 'viridis'));
    viewer.addSurface(right, 'rh');
    expect(viewer.registerBilateralSurfaceGroup({
      id: 'cortex',
      leftSurfaceId: 'lh',
      rightSurfaceId: 'rh'
    })).toMatchObject({ ok: true });
  }

  const exportPNG = vi.fn(() => 'data:image/png;base64,c3VyZnZpZXc=');
  viewer.exportPNG = exportPNG;
  const target = createViewerControlTarget(viewer, { histogramBins: 4 });

  return {
    viewer,
    target,
    left,
    activation,
    variance,
    exportPNG,
    dispose() {
      target.dispose();
      if (viewer.getSurface('lh')) left.dispose();
      if (right && viewer.getSurface('rh')) right.dispose();
    }
  };
}

function layerFrom(
  snapshot: SurfViewControlSnapshot,
  surfaceId: string,
  layerId: string
) {
  return snapshot.surfaces
    .find(surface => surface.id === surfaceId)?.layers
    .find(layer => layer.id === layerId);
}

runControlTargetContractLaws('ViewerControlTarget', () => {
  const fixture = makeFixture();
  return {
    target: fixture.target,
    getCanonicalRevision: () => fixture.viewer.getStateRevision(),
    runSuccessfulCommand: () => fixture.target.setLayerOpacity(
      { surfaceId: 'lh', layerId: 'activation' },
      0.4
    ),
    assertSuccessfulSnapshot: snapshot => {
      expect(layerFrom(snapshot, 'lh', 'activation')?.opacity).toBe(0.4);
    },
    runInvalidCommand: () => fixture.target.setLayerOpacity(
      { surfaceId: 'lh', layerId: 'activation' },
      Number.NaN
    ),
    runExternalMutation: () => fixture.activation.setVisible(false),
    disposeFixture: () => fixture.dispose()
  };
});

describe('ViewerControlTarget descriptors', () => {
  it('does not depend on pane state, PluginHost control expansion, or render inference', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/controls/ViewerControlTarget.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/selectedLayerId|selectedSurfaceId|PluginHostViewer/);
    expect(source).not.toMatch(/render:(?:before|after|needed)/);
    expect(source).not.toMatch(/\b(?:buildTweakPane|paneContainer|fpsGraph)\b/);
  });

  it('represents an initialization-failed viewer without touching absent runtime objects', () => {
    const viewer = new EventEmitter<ViewerEventMap>() as any;
    Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
    viewer.disposed = false;
    viewer.initializationFailed = true;
    viewer.stateRevision = 0;
    viewer.inspectionSelection = Object.freeze({ kind: 'none' });
    const target = createViewerControlTarget(viewer);
    try {
      expect(target.getSnapshot()).toMatchObject({
        revision: 0,
        surfaces: [],
        view: {
          current: null,
          fit: { enabled: false },
          reset: { enabled: false }
        },
        capabilities: {
          anatomicalViews: { enabled: false },
          exportPNG: { enabled: false }
        }
      });
      expect(target.fitView()).toMatchObject({ ok: false, code: 'unsupported' });
      expect(target.setLayerOpacity(
        { surfaceId: 'lh', layerId: 'activation' },
        0.5
      )).toMatchObject({ ok: false, code: 'unsupported' });
      expect(target.applyFigurePreset('paper-light')).toEqual({
        ok: false,
        code: 'unsupported',
        message: 'The viewer did not initialize successfully.'
      });
    } finally {
      target.dispose();
    }
  });

  it('derives ordered, metadata-rich scalar descriptors without raw domain objects', () => {
    const fixture = makeFixture();
    try {
      const snapshot = fixture.target.getSnapshot();
      const surface = snapshot.surfaces[0];
      const layer = layerFrom(snapshot, 'lh', 'activation');

      expect(surface).toMatchObject({
        id: 'lh',
        label: 'Lh',
        hemisphere: 'left',
        visible: true,
        groupId: null
      });
      expect(surface.layers.map(candidate => candidate.id)).toEqual([
        'base',
        'activation',
        'variance'
      ]);
      expect(layer).toMatchObject({
        label: 'Task activation',
        description: 'Language contrast',
        units: 'z',
        index: 1,
        role: 'data',
        reorderable: true,
        moveUp: { enabled: false, reason: expect.any(String) },
        moveDown: { enabled: true },
        metadata: {
          provenance: { pipeline: 'fmriprep', smoothing: 4 },
          missingValueLabel: 'Not estimated'
        },
        scalarMapping: {
          dataRevision: 0,
          colorMap: { id: 'viridis' },
          displayRange: { value: [-3, 5] },
          maskInterval: { value: [-1, 1] },
          summary: {
            finiteCount: 3,
            missingCount: 1,
            minimum: -2,
            maximum: 4
          }
        }
      });
      expect(layer?.scalarMapping?.summary?.histogram).toBeUndefined();
      const firstSummary = fixture.target.getLayerDataSummary({
        surfaceId: 'lh',
        layerId: 'activation'
      });
      const cachedSummary = fixture.target.getLayerDataSummary({
        surfaceId: 'lh',
        layerId: 'activation'
      });
      expect(firstSummary).toMatchObject({
        ok: true,
        value: { histogram: { counts: expect.any(Array), edges: expect.any(Array) } }
      });
      expect(cachedSummary.ok && firstSummary.ok
        ? cachedSummary.value
        : null).toBe(firstSummary.ok ? firstSummary.value : null);
      expect(layer?.colorPreview?.css).toMatch(/^linear-gradient/);
      expect(snapshot.capabilities).not.toHaveProperty('exclusiveMap');
      expect(Object.values(snapshot).some(value => value === fixture.viewer)).toBe(false);
      expect(Object.values(surface).some(value => value === fixture.left)).toBe(false);
      expect(Object.values(layer ?? {}).some(value => value === fixture.activation)).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  it('includes a non-reconstructable current custom colormap in its option list', () => {
    const fixture = makeFixture();
    try {
      fixture.activation.setColorMap(new ColorMap([
        [0.1, 0.2, 0.3],
        [0.8, 0.9, 1]
      ]));
      const scalar = layerFrom(
        fixture.target.getSnapshot(),
        'lh',
        'activation'
      )?.scalarMapping;

      expect(scalar?.colorMap).toMatchObject({
        id: 'custom',
        availability: { enabled: true }
      });
      expect(scalar?.availableColorMaps[0]).toBe(scalar?.colorMap);
      expect(scalar?.availableColorMaps.some(option => option.id === 'viridis')).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  it('reuses a lazy histogram across mapping edits and refreshes it after data changes', () => {
    const fixture = makeFixture();
    try {
      const address = { surfaceId: 'lh', layerId: 'activation' };
      const initial = fixture.target.getLayerDataSummary(address);
      expect(initial.ok).toBe(true);

      fixture.activation.setRange([-8, 8]);
      fixture.activation.setThreshold([-2, 2]);
      const mappingOnly = fixture.target.getLayerDataSummary(address);
      expect(initial.ok && mappingOnly.ok ? mappingOnly.value : null)
        .toBe(initial.ok ? initial.value : null);
      expect(layerFrom(
        fixture.target.getSnapshot(),
        'lh',
        'activation'
      )?.scalarMapping?.dataRevision).toBe(0);

      fixture.activation.setData([10, 20, 30, 40]);
      const afterData = fixture.target.getLayerDataSummary(address);
      expect(initial.ok && afterData.ok ? afterData.value : null)
        .not.toBe(initial.ok ? initial.value : null);
      expect(afterData).toMatchObject({
        ok: true,
        value: { minimum: 10, maximum: 40 }
      });
      expect(layerFrom(
        fixture.target.getSnapshot(),
        'lh',
        'activation'
      )?.scalarMapping?.dataRevision).toBeGreaterThan(0);
    } finally {
      fixture.dispose();
    }
  });

  it('publishes authoritative per-direction move constraints including priority', () => {
    const fixture = makeFixture();
    try {
      fixture.left.addLayer(new PriorityLayer('priority-low', 5));
      fixture.left.addLayer(new PriorityLayer('priority-high', 10));
      const snapshot = fixture.target.getSnapshot();
      const low = layerFrom(snapshot, 'lh', 'priority-low');
      const high = layerFrom(snapshot, 'lh', 'priority-high');

      expect(low?.moveDown).toMatchObject({
        enabled: false,
        reason: expect.stringMatching(/ordering boundary/i)
      });
      expect(high?.moveUp).toMatchObject({
        enabled: false,
        reason: expect.stringMatching(/ordering boundary/i)
      });
      expect(fixture.target.setLayerOrder('lh', [
        'base',
        'activation',
        'variance',
        'priority-high',
        'priority-low'
      ])).toMatchObject({ ok: false, code: 'conflict' });
    } finally {
      fixture.dispose();
    }
  });

  it('exposes specialized capability families compositionally and honestly', () => {
    const fixture = makeFixture();
    try {
      const bivariate = new TwoDataLayer(
        'effect-confidence',
        [0, 1, 2, 3],
        [1, 0.8, 0.4, 0.1],
        null,
        'confidence',
        { rangeX: [-1, 4], rangeY: [0, 1] }
      );
      fixture.left.addLayer(bivariate);

      const layer = layerFrom(
        fixture.target.getSnapshot(),
        'lh',
        'effect-confidence'
      );
      expect(layer?.bivariateMapping).toMatchObject({
        availability: {
          enabled: false,
          reason: expect.stringContaining('deferred')
        },
        xRange: { value: [-1, 4] },
        yRange: { value: [0, 1] },
        colorMapId: 'confidence'
      });
      expect(layer).not.toHaveProperty('scalarMapping');
      expect(layer).not.toHaveProperty('temporal');
      expect(layer).not.toHaveProperty('parcels');
      expect(layer).not.toHaveProperty('outline');
    } finally {
      fixture.dispose();
    }
  });

  it('uses explicit targets and never invents a bilateral group', () => {
    const ordinary = makeFixture();
    const paired = makeFixture({ paired: true });
    try {
      expect(ordinary.target.getSnapshot().view.targets).toEqual([
        {
          target: { kind: 'surface', surfaceId: 'lh' },
          label: 'Lh',
          availability: { enabled: true }
        }
      ]);
      expect(paired.target.getSnapshot().view.targets).toEqual(expect.arrayContaining([
        expect.objectContaining({ target: { kind: 'surface', surfaceId: 'lh' } }),
        expect.objectContaining({ target: { kind: 'surface', surfaceId: 'rh' } }),
        expect.objectContaining({ target: { kind: 'group', groupId: 'cortex' } })
      ]));
    } finally {
      ordinary.dispose();
      paired.dispose();
    }
  });

  it('hydrates the current anatomical view when controls mount after orientation', () => {
    const fixture = makeFixture();
    let remounted: ViewerControlTarget | null = null;
    let afterCameraMutation: ViewerControlTarget | null = null;
    try {
      expect(fixture.viewer.setAnatomicalView('posterior', {
        layout: 'single',
        surfaceId: 'lh'
      })).toMatchObject({ ok: true });
      fixture.target.dispose();

      remounted = createViewerControlTarget(fixture.viewer);
      expect(remounted.getSnapshot().view.current).toEqual({
        view: 'posterior',
        target: { kind: 'surface', surfaceId: 'lh' }
      });

      fixture.viewer.setCameraState({ position: [0, 0, 24] });
      remounted.dispose();
      afterCameraMutation = createViewerControlTarget(fixture.viewer);
      expect(afterCameraMutation.getSnapshot().view.current).toBeNull();
    } finally {
      remounted?.dispose();
      afterCameraMutation?.dispose();
      fixture.dispose();
    }
  });
});

describe('ViewerControlTarget commands', () => {
  it('maps view, surface, layer, scalar, selection, and figure mutations', async () => {
    const fixture = makeFixture({ paired: true });
    try {
      expect(fixture.target.setAnatomicalView({
        view: 'lateral',
        target: { kind: 'group', groupId: 'cortex' }
      })).toEqual({ ok: true });
      expect(fixture.target.getSnapshot().view.current).toEqual({
        view: 'lateral',
        target: { kind: 'group', groupId: 'cortex' }
      });

      expect(fixture.target.setSurfaceVisibility('lh', false)).toEqual({ ok: true });
      expect(fixture.target.getSnapshot().surfaces.find(surface => surface.id === 'lh')?.visible)
        .toBe(false);

      expect(fixture.target.setLayerVisibility(
        { surfaceId: 'lh', layerId: 'activation' },
        false
      )).toEqual({ ok: true });
      expect(fixture.target.setLayerOpacity(
        { surfaceId: 'lh', layerId: 'activation' },
        0.35
      )).toEqual({ ok: true });
      expect(fixture.target.setLayerBlendMode(
        { surfaceId: 'lh', layerId: 'activation' },
        'multiply'
      )).toEqual({ ok: true });
      expect(layerFrom(fixture.target.getSnapshot(), 'lh', 'activation')).toMatchObject({
        visible: false,
        opacity: 0.35,
        blendMode: 'multiply'
      });

      expect(fixture.target.setLayerOrder('lh', [
        'base',
        'variance',
        'activation'
      ])).toEqual({ ok: true });
      expect(fixture.target.getSnapshot().surfaces
        .find(surface => surface.id === 'lh')?.layers.map(layer => layer.id))
        .toEqual(['base', 'variance', 'activation']);

      expect(fixture.target.updateScalarMapping(
        { surfaceId: 'lh', layerId: 'activation' },
        {
          colorMapId: 'magma',
          displayRange: [-5, 5],
          maskInterval: [-2, 2]
        }
      )).toEqual({ ok: true });
      expect(layerFrom(fixture.target.getSnapshot(), 'lh', 'activation')?.scalarMapping)
        .toMatchObject({
          colorMap: { id: 'magma' },
          displayRange: { value: [-5, 5] },
          maskInterval: { value: [-2, 2] }
        });

      expect(fixture.target.setInspectionSelection({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 2
      })).toEqual({ ok: true });
      expect(fixture.target.getSnapshot().selection).toMatchObject({
        current: { kind: 'vertex', surfaceId: 'lh', vertexIndex: 2 },
        inspection: {
          surfaceId: 'lh',
          vertexIndex: 2,
          values: expect.arrayContaining([
            expect.objectContaining({
              layerId: 'activation',
              value: -2,
              units: 'z',
              missing: false
            })
          ])
        }
      });

      expect(fixture.target.applyFigurePreset('paper-light')).toEqual({ ok: true });
      expect(fixture.target.getSnapshot().figure).toMatchObject({
        preset: { id: 'paper-light' },
        defaultWidth: 2400,
        defaultHeight: 1800,
        defaultDpi: 300,
        defaultTransparent: true,
        defaultColorbar: true
      });
      expect(fixture.target.setFigureBackground(0x123456, false)).toEqual({ ok: true });
      expect(fixture.target.getSnapshot().figure).toMatchObject({
        background: 0x123456,
        transparent: false
      });

      await expect(fixture.target.exportFigure({
        width: 1200,
        height: 900,
        dpi: 300,
        filename: 'brain.png'
      })).resolves.toEqual({
        ok: true,
        value: {
          dataUrl: 'data:image/png;base64,c3VyZnZpZXc=',
          mimeType: 'image/png',
          width: 1200,
          height: 900,
          filename: 'brain.png'
        }
      });
      expect(fixture.exportPNG).toHaveBeenCalledWith(expect.objectContaining({
        width: 1200,
        height: 900,
        dpi: 300,
        backgroundColor: 0x123456,
        // Preset export transparency is independent of the live background.
        transparent: true,
        downloadFilename: 'brain.png'
      }));
      expect(fixture.target.setDisplayedLayer('activation')).toMatchObject({
        ok: false,
        code: 'unsupported'
      });
    } finally {
      fixture.dispose();
    }
  });

  it('maps fit and reset through canonical camera revisions', () => {
    const fixture = makeFixture();
    try {
      expect(fixture.target.setAnatomicalView({
        view: 'lateral',
        target: { kind: 'surface', surfaceId: 'lh' },
        fit: false
      })).toEqual({ ok: true });
      const initialRevision = fixture.target.getSnapshot().revision;
      expect(fixture.target.fitView()).toEqual({ ok: true });
      expect(fixture.target.getSnapshot().revision).toBeGreaterThan(initialRevision);
      expect(fixture.target.getSnapshot().view.current).toEqual({
        view: 'lateral',
        target: { kind: 'surface', surfaceId: 'lh' }
      });
      expect(fixture.target.resetView()).toEqual({ ok: true });
      expect(fixture.target.getSnapshot().view.current).toBeNull();
    } finally {
      fixture.dispose();
    }
  });

  it('rejects invalid commands without mutating viewer or snapshot state', async () => {
    const fixture = makeFixture();
    try {
      const invalidCommands = [
        () => fixture.target.setLayerOpacity(
          { surfaceId: 'lh', layerId: 'activation' },
          2
        ),
        () => fixture.target.setLayerBlendMode(
          { surfaceId: 'lh', layerId: 'activation' },
          'screen' as any
        ),
        () => fixture.target.setLayerOrder('lh', ['base', 'activation']),
        () => fixture.target.updateScalarMapping(
          { surfaceId: 'lh', layerId: 'activation' },
          { colorMapId: 'does-not-exist' }
        ),
        () => fixture.target.updateScalarMapping(
          { surfaceId: 'lh', layerId: 'activation' },
          { displayRange: [2, -2] }
        ),
        () => fixture.target.setInspectionSelection({
          kind: 'vertex',
          surfaceId: 'lh',
          vertexIndex: 100
        }),
        () => fixture.target.applyFigurePreset('not-a-preset'),
        () => fixture.target.setFigureBackground(-1)
      ];

      for (const command of invalidCommands) {
        const before = fixture.target.getSnapshot();
        const revision = fixture.viewer.getStateRevision();
        expect(command()).toMatchObject({ ok: false });
        expect(fixture.target.getSnapshot()).toBe(before);
        expect(fixture.viewer.getStateRevision()).toBe(revision);
      }

      const before = fixture.target.getSnapshot();
      const revision = fixture.viewer.getStateRevision();
      await expect(fixture.target.exportFigure({ width: 0 })).resolves.toMatchObject({
        ok: false,
        code: 'invalid-value'
      });
      expect(fixture.target.getSnapshot()).toBe(before);
      expect(fixture.viewer.getStateRevision()).toBe(revision);
    } finally {
      fixture.dispose();
    }
  });

  it('distinguishes missing surfaces and layers with typed failures', () => {
    const fixture = makeFixture();
    try {
      expect(fixture.target.setLayerOpacity(
        { surfaceId: 'missing', layerId: 'activation' },
        0.5
      )).toMatchObject({ ok: false, code: 'surface-not-found' });
      expect(fixture.target.setLayerOpacity(
        { surfaceId: 'lh', layerId: 'missing' },
        0.5
      )).toMatchObject({ ok: false, code: 'layer-not-found' });
    } finally {
      fixture.dispose();
    }
  });
});

describe('ViewerControlTarget frame timing', () => {
  it('composites a scalar command before the next scheduled viewer paint', () => {
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
    const fixture = makeFixture();
    try {
      fixture.left.flushPendingColorUpdate();
      frames.clear();
      const sequence: string[] = [];
      const updateColors = fixture.left.updateColors.bind(fixture.left);
      vi.spyOn(fixture.left, 'updateColors').mockImplementation(() => {
        sequence.push('composite');
        updateColors();
      });
      (fixture.viewer.renderer.render as ReturnType<typeof vi.fn>)
        .mockImplementation(() => sequence.push('paint'));
      fixture.viewer.requestRender = NeuroSurfaceViewer.prototype.requestRender
        .bind(fixture.viewer);
      (fixture.viewer as any).needsRender = false;

      fixture.viewer.animate();
      const scheduledViewerFrame = [...frames.entries()][0];
      expect(scheduledViewerFrame).toBeDefined();
      expect(fixture.target.updateScalarMapping(
        { surfaceId: 'lh', layerId: 'activation' },
        { displayRange: [-2.5, 4.5] }
      )).toEqual({ ok: true });

      frames.delete(scheduledViewerFrame[0]);
      scheduledViewerFrame[1].call(fixture.viewer, 16);
      expect(sequence.slice(0, 2)).toEqual(['composite', 'paint']);
    } finally {
      fixture.dispose();
    }
  });
});

describe('ViewerControlTarget external synchronization', () => {
  it('renders exact dense and sparse values through a mounted real target', async () => {
    const fixture = makeFixture();
    fixture.left.addLayer(new DataLayer(
      'sparse',
      [9],
      [1],
      'magma',
      { presentation: { label: 'Sparse statistic', units: 't' } }
    ));
    const session = createSurfViewControlSession(fixture.target, {
      focusedSurfaceId: 'lh',
      focusedLayerId: 'activation'
    });
    defineSurfViewControlsElement();
    const element = document.createElement(
      SURFVIEW_CONTROLS_TAG
    ) as SurfViewControlsElement;
    element.session = session;
    document.body.appendChild(element);
    try {
      fixture.viewer.setInspectionSelection({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 1
      });
      await Promise.resolve();
      await element.updateComplete;

      const root = element.shadowRoot!;
      expect(root.querySelector('[data-layer-value="activation"]')?.textContent
        ?.replace(/\s+/g, ' ').trim()).toContain('Task activation Focused layer Missing z');
      expect(root.querySelector('[data-layer-value="sparse"]')?.textContent
        ?.replace(/\s+/g, ' ').trim()).toBe('Sparse statistic 9 t');

      fixture.viewer.setInspectionSelection({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 2
      });
      await Promise.resolve();
      await element.updateComplete;

      expect(root.querySelector('[data-layer-value="activation"]')?.textContent
        ?.replace(/\s+/g, ' ').trim()).toContain('Task activation Focused layer -2 z');
      expect(root.querySelector('[data-layer-value="sparse"]')?.textContent
        ?.replace(/\s+/g, ' ').trim()).toBe('Sparse statistic Missing t');
    } finally {
      element.remove();
      session.dispose();
      fixture.dispose();
    }
  });

  it('renders parcel and atlas metadata with representative-vertex values', async () => {
    const viewer = makeViewer();
    const parcelData: ParcelData = {
      schema_version: '1.0',
      atlas: {
        id: 'toy-atlas',
        name: 'Toy Atlas',
        representation: 'surface',
        confidence: 'exact',
        n_parcels: 2
      },
      parcels: [
        { id: 1, label: 'Visual', hemi: 'L' },
        { id: 2, label: 'Motor', hemi: 'L' }
      ]
    };
    const surface = new ParcelSurface(makeGeometry('left'), {
      parcelData,
      vertexLabels: [1, 1, 2, 0]
    });
    surface.addLayer(new DataLayer(
      'statistic',
      [4, 5, Number.NaN, 8],
      null,
      'viridis',
      { presentation: { label: 'Statistic', units: 'a.u.' } }
    ));
    viewer.addSurface(surface, 'parcel');
    const target = createViewerControlTarget(viewer);
    const session = createSurfViewControlSession(target, {
      focusedSurfaceId: 'parcel',
      focusedLayerId: 'statistic'
    });
    defineSurfViewControlsElement();
    const element = document.createElement(
      SURFVIEW_CONTROLS_TAG
    ) as SurfViewControlsElement;
    element.session = session;
    document.body.appendChild(element);
    try {
      expect(target.setInspectionSelection({
        kind: 'parcel',
        surfaceId: 'parcel',
        parcelId: 2,
        representativeVertexIndex: 2,
        atlasId: 'toy-atlas'
      })).toMatchObject({ ok: true });
      await Promise.resolve();
      await element.updateComplete;

      const root = element.shadowRoot!;
      const normalized = root.textContent?.replace(/\s+/g, ' ');
      expect(normalized).toContain('Parcel ID 2 · Motor');
      expect(normalized).toContain('Atlas Toy Atlas · toy-atlas');
      expect(root.querySelector('.selection-values-heading')?.textContent)
        .toBe('Layer values at representative vertex 2');
      expect(root.querySelector('[data-layer-value="statistic"]')?.textContent
        ?.replace(/\s+/g, ' ').trim()).toBe('Statistic Focused layer Missing a.u.');
    } finally {
      element.remove();
      session.dispose();
      target.dispose();
      surface.dispose();
    }
  });

  it('updates a mounted inspector after direct layer mutations', async () => {
    const fixture = makeFixture();
    const session = createSurfViewControlSession(fixture.target, {
      focusedSurfaceId: 'lh',
      focusedLayerId: 'activation'
    });
    defineSurfViewControlsElement();
    const element = document.createElement(
      SURFVIEW_CONTROLS_TAG
    ) as SurfViewControlsElement;
    element.session = session;
    document.body.appendChild(element);
    try {
      await element.updateComplete;
      fixture.activation.setRange([-2.25, 3.75]);
      fixture.activation.setThreshold([0, 0]);
      fixture.activation.setColorMap('plasma');
      fixture.activation.setOpacity(0.375);
      await Promise.resolve();
      await element.updateComplete;

      const root = element.shadowRoot!;
      expect(root.querySelector<HTMLSelectElement>(
        '[aria-label="Task activation colormap"]'
      )?.value).toBe('plasma');
      expect(root.querySelector<HTMLInputElement>(
        'input[type="number"][data-range-kind="display"][data-bound="lower"]'
      )?.value).toBe('-2.25');
      expect(root.querySelector<HTMLInputElement>(
        'input[type="number"][data-range-kind="display"][data-bound="upper"]'
      )?.value).toBe('3.75');
      expect(root.querySelector<HTMLInputElement>(
        '[aria-label="Task activation opacity"]'
      )?.value).toBe('0.375');
      expect(root.textContent).toContain('Masking off (equal endpoints).');
      expect(root.querySelector('.mask-band')).toBeNull();

      fixture.activation.setColorMap(new ColorMap([
        [0, 0, 0],
        [1, 0.5, 0]
      ]));
      await Promise.resolve();
      await element.updateComplete;
      const customSelect = root.querySelector<HTMLSelectElement>(
        '[aria-label="Task activation colormap"]'
      )!;
      expect(customSelect.value).toBe('custom');
      expect(customSelect.selectedOptions[0]?.textContent).toBe('Custom');
      expect(fixture.target.updateScalarMapping(
        { surfaceId: 'lh', layerId: 'activation' },
        { colorMapId: 'custom' }
      )).toEqual({ ok: true });

      fixture.left.addLayer(new DataLayer(
        'activation',
        [100, 200, 300, 400],
        null,
        'magma',
        {
          range: [100, 400],
          threshold: [0, 0],
          presentation: { label: 'Replacement activation', units: 'z' }
        }
      ));
      await Promise.resolve();
      await element.updateComplete;
      expect(root.querySelector('.selected-layer-title')?.textContent)
        .toBe('Replacement activation');
      expect(root.querySelector('.summary-line')?.textContent?.replace(/\s+/g, ' '))
        .toContain('4 finite values · 0 missing · data 100 to 400');
      expect(root.querySelector('.histogram')?.getAttribute('aria-label'))
        .toContain('Histogram of 4 finite values');
    } finally {
      element.remove();
      session.dispose();
      fixture.dispose();
    }
  });

  it('observes camera, layer, selection, metadata, and restoration mutations', () => {
    const fixture = makeFixture();
    try {
      const listener = vi.fn();
      fixture.target.subscribe(listener);
      listener.mockClear();

      expect(fixture.viewer.setAnatomicalView('medial', {
        layout: 'single',
        surfaceId: 'lh'
      })).toMatchObject({ ok: true });
      expect(fixture.target.getSnapshot().view.current).toEqual({
        view: 'medial',
        target: { kind: 'surface', surfaceId: 'lh' }
      });

      fixture.viewer.setCameraState({ position: [0, 0, 30] });
      expect(fixture.target.getSnapshot().view.current).toBeNull();

      fixture.activation.setOpacity(0.27);
      expect(layerFrom(fixture.target.getSnapshot(), 'lh', 'activation')?.opacity).toBe(0.27);

      fixture.activation.setPresentation({
        label: 'Externally renamed',
        units: 't'
      });
      expect(layerFrom(fixture.target.getSnapshot(), 'lh', 'activation')).toMatchObject({
        label: 'Externally renamed',
        units: 't'
      });

      expect(fixture.viewer.setInspectionSelection({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 0
      })).toMatchObject({ ok: true });
      expect(fixture.target.getSnapshot().selection.current).toEqual({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 0
      });

      fixture.viewer.stylePreset = getStylePreset('talk-dark');
      fixture.viewer.config.preset = 'talk-dark';
      fixture.viewer.setFigureBackground(0x0b0f14, false);
      const report: RestorationReport = {
        success: true,
        sourceVersion: 2,
        restoredVersion: 2,
        errors: [],
        warnings: [],
        surfacesRestored: ['lh'],
        surfacesSkipped: []
      };
      fixture.viewer.emit('state:restored', report);
      expect(fixture.target.getSnapshot().figure).toMatchObject({
        preset: { id: 'talk-dark' },
        defaultWidth: 1920,
        defaultHeight: 1080,
        defaultDpi: 150,
        defaultTransparent: false,
        defaultColorbar: true
      });
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(6);
      expect(fixture.target.getSnapshot().revision).toBe(fixture.viewer.getStateRevision());
    } finally {
      fixture.dispose();
    }
  });

  it('preserves unrelated descriptor references across domain-local changes', () => {
    const fixture = makeFixture();
    try {
      const initial = fixture.target.getSnapshot();
      fixture.activation.setOpacity(0.5);
      const afterLayer = fixture.target.getSnapshot();
      expect(afterLayer.surfaces).not.toBe(initial.surfaces);
      expect(afterLayer.view).toBe(initial.view);
      expect(afterLayer.selection).toBe(initial.selection);
      expect(afterLayer.figure).toBe(initial.figure);

      fixture.viewer.setInspectionSelection({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 1
      });
      const afterSelection = fixture.target.getSnapshot();
      expect(afterSelection.selection).not.toBe(afterLayer.selection);
      expect(afterSelection.surfaces).toBe(afterLayer.surfaces);
      expect(afterSelection.view).toBe(afterLayer.view);
      expect(afterSelection.figure).toBe(afterLayer.figure);

      fixture.viewer.setFigureBackground(0xffffff, false);
      const afterAppearance = fixture.target.getSnapshot();
      expect(afterAppearance.figure).not.toBe(afterSelection.figure);
      expect(afterAppearance.surfaces).toBe(afterSelection.surfaces);
      expect(afterAppearance.view).toBe(afterSelection.view);
      expect(afterAppearance.selection).toBe(afterSelection.selection);
    } finally {
      fixture.dispose();
    }
  });

  it('recomputes selected vertex values after an external layer data mutation', () => {
    const fixture = makeFixture();
    try {
      fixture.viewer.setInspectionSelection({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 0
      });
      expect(fixture.target.getSnapshot().selection.inspection?.values
        .find(value => value.layerId === 'activation')?.value).toBe(1);

      fixture.activation.setData([9, 8, 7, 6]);

      expect(fixture.target.getSnapshot().selection.inspection?.values
        .find(value => value.layerId === 'activation')?.value).toBe(9);
    } finally {
      fixture.dispose();
    }
  });

  it('treats externally disposed viewers as disposed command targets', () => {
    const fixture = makeFixture();
    try {
      const subscription = fixture.target.subscribe(vi.fn());
      (fixture.viewer as any).disposed = true;
      expect(fixture.target.isDisposed()).toBe(true);
      expect(subscription.closed).toBe(true);
      expect(fixture.target.setLayerOpacity(
        { surfaceId: 'lh', layerId: 'activation' },
        0.5
      )).toMatchObject({ ok: false, code: 'disposed' });
    } finally {
      (fixture.viewer as any).disposed = false;
      fixture.dispose();
    }
  });
});
