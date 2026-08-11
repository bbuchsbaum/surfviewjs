import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_VERSION,
  decode,
  deserialize,
  encode,
  migrateViewerState,
  serialize
} from '../../src/serialization';
import type {
  SurfaceGroupState,
  ViewerStateV1,
  ViewerStateV2
} from '../../src/serialization';
import {
  BaseLayer,
  DataLayer,
  Layer,
  LayerStack
} from '../../src/layers';
import { CrosshairManager } from '../../src/CrosshairManager';
import { ClipPlane, ClipPlaneSet } from '../../src/utils/ClipPlane';
import { ConnectivityLayer } from '../../src/ConnectivityLayer';

function readV1Fixture(name: string): ViewerStateV1 {
  return JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
}

function makeMinimalState(): ViewerStateV2 {
  return {
    version: 2,
    camera: {
      position: [10, 20, 30],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1.5,
      fov: 50
    },
    config: {
      background: 0x112233,
      lighting: {
        ambientIntensity: 0.4,
        directionalIntensity: 0.8,
        directionalPosition: [1, 2, 3]
      }
    },
    surfaces: {},
    surfaceGroups: [],
    crosshair: {
      visible: false,
      surfaceId: null,
      vertexIndex: null,
      size: 1.5,
      color: 0xffcc00,
      mode: null
    },
    timeline: null,
    inspectionSelection: { kind: 'none' }
  };
}

function makeLayer(id: string, opacity = 1) {
  return {
    id,
    visible: true,
    opacity,
    blendMode: 'normal',
    needsUpdate: false,
    setVisible(value: boolean) { this.visible = value; },
    setOpacity(value: number) { this.opacity = value; },
    setBlendMode(value: string) { this.blendMode = value; },
    update: () => {},
    toStateJSON() {
      return {
        id,
        type: 'data',
        visible: this.visible,
        opacity: this.opacity,
        blendMode: this.blendMode,
        order: 99
      };
    }
  };
}

function makeSurface(
  ids: readonly string[],
  hemisphere: 'left' | 'right' = 'left',
  vertexCount = 3
) {
  const layers = new Map(ids.map(id => [id, makeLayer(id)]));
  let order = [...ids];
  const stack = {
    getLayer: (id: string) => layers.get(id),
    getOrderedLayers: () => order.map(id => layers.get(id)!),
    getAllLayers: () => order.map(id => layers.get(id)!),
    validateLayerOrder: (candidate: readonly string[]) => {
      const valid = candidate.length === order.length &&
        candidate.every(id => layers.has(id)) &&
        new Set(candidate).size === candidate.length;
      return valid
        ? { ok: true, changed: candidate.some((id, index) => id !== order[index]), order: [...candidate] }
        : { ok: false, code: 'invalid', message: 'invalid order' };
    },
    setLayerOrder: (candidate: readonly string[]) => {
      const result = stack.validateLayerOrder(candidate);
      if (result.ok) order = [...candidate];
      return result;
    }
  };
  return {
    hemisphere,
    vertexCount,
    mesh: { visible: true },
    layerStack: stack,
    clipPlanes: { toStateJSON: () => [], fromStateJSON: () => {} },
    validateLayerOrder: stack.validateLayerOrder,
    setLayerOrder: stack.setLayerOrder
  };
}

function makeMockViewer() {
  const events: Array<{ name: string; data: any }> = [];
  const groups: SurfaceGroupState[] = [];
  const viewer = {
    camera: {
      position: { x: 0, y: 0, z: 200, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
      quaternion: { x: 0, y: 0, z: 0, w: 1, set(x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; } },
      up: { x: 0, y: 1, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
      zoom: 1,
      fov: 45,
      updateProjectionMatrix: () => {}
    },
    cameraControls: {
      target: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
      update: () => {}
    },
    config: { backgroundColor: 0x000000 },
    ambientLight: { intensity: 0.5 },
    directionalLight: {
      intensity: 1,
      position: { x: 1, y: 1, z: 1, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } }
    },
    scene: { background: null as unknown },
    surfaces: new Map<string, ReturnType<typeof makeSurface>>(),
    crosshair: new CrosshairManager(() => {}),
    selectedSurfaceId: null as string | null,
    selectedLayerId: null as string | null,
    inspectionSelection: { kind: 'none' } as any,
    getInspectionSelection() { return this.inspectionSelection; },
    setInspectionSelection(selection: any) {
      const changed = JSON.stringify(selection) !== JSON.stringify(this.inspectionSelection);
      this.inspectionSelection = selection;
      return { ok: true, changed, selection };
    },
    inspectVertex(surfaceId: string, vertexIndex: number) {
      const surface = this.surfaces.get(surfaceId);
      return surface && Number.isInteger(vertexIndex) && vertexIndex >= 0 && vertexIndex < surface.vertexCount
        ? { surfaceId, vertexIndex, world: [0, 0, 0], values: [] }
        : null;
    },
    getBilateralSurfaceGroups: () => groups.map(group => ({ ...group })),
    registerBilateralSurfaceGroup(group: Omit<SurfaceGroupState, 'kind'>) {
      const registered = { kind: 'bilateral' as const, ...group };
      groups.push(registered);
      return { ok: true, group: registered };
    },
    unregisterBilateralSurfaceGroup(groupId: string) {
      const index = groups.findIndex(group => group.id === groupId);
      if (index < 0) return { ok: false, code: 'group-not-found', message: 'not found' };
      const [group] = groups.splice(index, 1);
      return { ok: true, group };
    },
    emit: (name: string, data: any) => events.push({ name, data }),
    requestRender: () => {},
    _events: events
  };
  return viewer;
}

describe('viewer state serialization', () => {
  describe('encoding and version migration', () => {
    it('round-trips the current v2 state through a URL-safe hash', () => {
      const state = makeMinimalState();
      const hash = encode(state);
      expect(hash).toMatch(/^svjs=/);
      expect(hash.slice(5)).not.toMatch(/[+/=]/);
      expect(hash.length).toBeLessThan(2048);
      expect(decode('#' + hash)).toEqual(state);
    });

    it('rejects a hash without the surfview prefix', () => {
      expect(() => decode('invalid')).toThrow('missing "svjs="');
    });

    it('rejects an empty state payload', () => {
      expect(() => decode('svjs=')).toThrow('empty payload');
    });

    it('rejects corrupted compressed data', () => {
      expect(() => decode('svjs=!!!not-valid-base64!!!')).toThrow();
    });

    it('rejects future schema versions', () => {
      const future = { ...makeMinimalState(), version: 99 };
      expect(() => decode(encode(future as any))).toThrow('newer than supported');
    });

    it('uses legacy order 0 for missing values and source position for stable ties', () => {
      const migrated = migrateViewerState(readV1Fixture('viewer-state-v1-pane-focus.json'));
      expect(CURRENT_VERSION).toBe(2);
      expect(migrated.surfaces.lh.layerOrder).toEqual([
        'base',
        'equal-a',
        'missing-order',
        'equal-b'
      ]);
      expect(migrated.surfaces.lh.layers.map(layer => layer.order)).toEqual([-10, 0, 0, 0]);
    });

    it('never promotes legacy pane focus to scientific selection', () => {
      const migrated = migrateViewerState(readV1Fixture('viewer-state-v1-pane-focus.json'));
      expect(migrated.inspectionSelection).toEqual({ kind: 'none' });
      expect(migrated).not.toHaveProperty('selection');
    });

    it('migrates only a visible, structurally valid selection-mode crosshair', () => {
      const migrated = migrateViewerState(
        readV1Fixture('viewer-state-v1-selection-crosshair.json')
      );
      expect(migrated.inspectionSelection).toEqual({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 1
      });

      const hidden = readV1Fixture('viewer-state-v1-selection-crosshair.json');
      hidden.crosshair.visible = false;
      expect(migrateViewerState(hidden).inspectionSelection).toEqual({ kind: 'none' });
    });
  });

  describe('component state', () => {
    it('serializes scalar mapping state', () => {
      const scalar = new DataLayer(
        'act', new Float32Array([1, 2, 3]), null, 'hot',
        { range: [-3, 3], threshold: [-1, 1], opacity: 0.8 }
      );
      expect(scalar.toStateJSON()).toMatchObject({
        type: 'data',
        colorMapName: 'hot',
        range: [-3, 3],
        threshold: [-1, 1],
        opacity: expect.closeTo(0.8, 5)
      });
    });

    it('serializes base-layer state', () => {
      const base = new BaseLayer(0xff0000, { opacity: 0.5 });
      expect(base.toStateJSON()).toMatchObject({
        type: 'base',
        color: 0xff0000,
        opacity: 0.5
      });
    });

    it('serializes crosshair state', () => {
      const crosshair = new CrosshairManager(() => {});
      crosshair.size = 2;
      crosshair.color = 0x00ff00;
      crosshair.visible = true;
      crosshair.surfaceId = 'lh';
      crosshair.vertexIndex = 42;
      crosshair.mode = 'selection';
      expect(crosshair.toStateJSON()).toMatchObject({
        visible: true,
        surfaceId: 'lh',
        vertexIndex: 42,
        size: 2,
        color: 0x00ff00,
        mode: 'selection'
      });
    });

    it('serializes clip-plane state', () => {
      const plane = new ClipPlane();
      plane.setFromAxisDistance('x', 5, false);
      plane.setEnabled(true);
      expect(plane.toStateJSON()).toMatchObject({ axis: 'x', distance: 5, enabled: true });

      const planes = new ClipPlaneSet();
      planes.setClipPlane('y', 10, true, false);
      expect(planes.toStateJSON()).toHaveLength(3);
      expect(planes.toStateJSON()[1]).toMatchObject({ axis: 'y', enabled: true });
    });

    it('serializes connectivity state', () => {
      const connectivity = new ConnectivityLayer('conn', [
        { source: 0, target: 1, weight: 0.8 }
      ], { renderMode: 'line', threshold: 0.3, topN: 50 });
      expect(connectivity.toStateJSON()).toMatchObject({
        type: 'connectivity',
        renderMode: 'line',
        threshold: 0.3,
        topN: 50
      });
    });
  });

  describe('v2 serialization', () => {
    it('captures camera state', () => {
      const viewer = makeMockViewer();
      const state = serialize(viewer as any);
      expect(state.camera).toMatchObject({ position: [0, 0, 200], fov: 45 });
    });

    it('captures viewer configuration state', () => {
      const viewer = makeMockViewer();
      const state = serialize(viewer as any);
      expect(state.config).toMatchObject({
        background: 0x000000,
        lighting: { ambientIntensity: 0.5 }
      });
    });

    it('captures crosshair state', () => {
      const viewer = makeMockViewer();
      viewer.crosshair.size = 3;
      viewer.crosshair.color = 0xff0000;
      const state = serialize(viewer as any);
      expect(state.crosshair).toMatchObject({ size: 3, color: 0xff0000 });
    });

    it('uses a null timeline when no controller is attached', () => {
      const viewer = makeMockViewer();
      const state = serialize(viewer as any);
      expect(state.timeline).toBeNull();
    });

    it('captures canonical order, sorted groups, and scientific selection only', () => {
      const viewer = makeMockViewer();
      viewer.surfaces.set('lh', makeSurface(['bottom', 'top'], 'left'));
      viewer.surfaces.set('rh', makeSurface([], 'right'));
      viewer.registerBilateralSurfaceGroup({
        id: 'cortex',
        leftSurfaceId: 'lh',
        rightSurfaceId: 'rh'
      });
      viewer.selectedSurfaceId = 'pane-surface';
      viewer.selectedLayerId = 'pane-layer';
      viewer.inspectionSelection = { kind: 'vertex', surfaceId: 'lh', vertexIndex: 1 };

      const state = serialize(viewer as any);

      expect(state.version).toBe(2);
      expect(state.surfaces.lh.layerOrder).toEqual(['bottom', 'top']);
      expect(state.surfaces.lh.layers.map(layer => layer.order)).toEqual([0, 1]);
      expect(state.surfaceGroups).toEqual([{
        kind: 'bilateral',
        id: 'cortex',
        leftSurfaceId: 'lh',
        rightSurfaceId: 'rh'
      }]);
      expect(state.inspectionSelection).toEqual({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 1
      });
      expect(state).not.toHaveProperty('selection');
      expect(state).not.toHaveProperty('focusedSurfaceId');
      expect(state).not.toHaveProperty('focusedLayerId');
    });

    it('round-trips groups, order, and selection into another target', () => {
      const source = makeMockViewer();
      source.surfaces.set('lh', makeSurface(['base', 'a', 'b'], 'left'));
      source.surfaces.set('rh', makeSurface([], 'right'));
      source.surfaces.get('lh')!.setLayerOrder(['base', 'b', 'a']);
      source.registerBilateralSurfaceGroup({
        id: 'cortex',
        leftSurfaceId: 'lh',
        rightSurfaceId: 'rh'
      });
      source.inspectionSelection = { kind: 'vertex', surfaceId: 'lh', vertexIndex: 2 };

      const target = makeMockViewer();
      target.surfaces.set('lh', makeSurface(['base', 'a', 'b'], 'left'));
      target.surfaces.set('rh', makeSurface([], 'right'));
      const state = decode(encode(serialize(source as any)));
      const report = deserialize(target as any, state);

      expect(report).toMatchObject({ success: true, sourceVersion: 2, restoredVersion: 2 });
      expect(target.surfaces.get('lh')!.layerStack.getOrderedLayers().map(layer => layer.id))
        .toEqual(['base', 'b', 'a']);
      expect(target.getBilateralSurfaceGroups()).toEqual([{
        kind: 'bilateral',
        id: 'cortex',
        leftSurfaceId: 'lh',
        rightSurfaceId: 'rh'
      }]);
      expect(target.getInspectionSelection()).toEqual({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 2
      });
    });
  });

  describe('validation-first restoration', () => {
    it('restores a supported v1 fixture but leaves pane focus untouched', () => {
      const viewer = makeMockViewer();
      viewer.surfaces.set(
        'lh',
        makeSurface(['base', 'equal-b', 'missing-order', 'equal-a'], 'left')
      );
      viewer.selectedSurfaceId = 'existing-pane-surface';
      viewer.selectedLayerId = 'existing-pane-layer';

      const report = deserialize(
        viewer as any,
        readV1Fixture('viewer-state-v1-pane-focus.json')
      );

      expect(report).toMatchObject({ success: true, sourceVersion: 1, restoredVersion: 2 });
      expect(viewer.surfaces.get('lh')!.layerStack.getOrderedLayers().map(layer => layer.id))
        .toEqual(['base', 'equal-a', 'missing-order', 'equal-b']);
      expect(viewer.camera.position).toMatchObject({ x: 10, y: 20, z: 30 });
      expect(viewer.selectedSurfaceId).toBe('existing-pane-surface');
      expect(viewer.selectedLayerId).toBe('existing-pane-layer');
      expect(viewer.getInspectionSelection()).toEqual({ kind: 'none' });
    });

    it('restores the explicitly documented legacy crosshair selection rule', () => {
      const viewer = makeMockViewer();
      viewer.surfaces.set('lh', makeSurface([], 'left', 3));

      const report = deserialize(
        viewer as any,
        readV1Fixture('viewer-state-v1-selection-crosshair.json')
      );

      expect(report.success).toBe(true);
      expect(viewer.getInspectionSelection()).toEqual({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 1
      });
    });

    it('reports unknown surface IDs and performs no partial mutation', () => {
      const viewer = makeMockViewer();
      const state = makeMinimalState();
      state.surfaces.missing = {
        id: 'missing',
        type: 'MultiLayerNeuroSurface',
        visible: true,
        layers: [],
        layerOrder: [],
        clipPlanes: []
      };

      const report = deserialize(viewer as any, state);

      expect(report.success).toBe(false);
      expect(report.errors).toContainEqual(expect.objectContaining({
        code: 'surface-not-found',
        path: 'surfaces.missing'
      }));
      expect(viewer.camera.position).toMatchObject({ x: 0, y: 0, z: 200 });
      expect(report.surfacesRestored).toEqual([]);
      expect(report.surfacesSkipped).toEqual(['missing']);
    });

    it('reports missing and unknown layer-order IDs before changing layer properties', () => {
      const viewer = makeMockViewer();
      const surface = makeSurface(['a', 'b']);
      viewer.surfaces.set('lh', surface);
      const state = makeMinimalState();
      state.surfaces.lh = {
        id: 'lh',
        type: 'MultiLayerNeuroSurface',
        hemisphere: 'left',
        visible: false,
        layers: [
          { id: 'a', type: 'data', visible: false, opacity: 0.25, blendMode: 'normal' },
          { id: 'b', type: 'data', visible: true, opacity: 1, blendMode: 'normal' }
        ],
        layerOrder: ['a', 'unknown'],
        clipPlanes: []
      };

      const report = deserialize(viewer as any, state);

      expect(report.errors.some(issue => issue.code === 'invalid-layer-order')).toBe(true);
      expect(surface.mesh.visible).toBe(true);
      expect(surface.layerStack.getLayer('a')!.opacity).toBe(1);
      expect(viewer.camera.position.x).toBe(0);
    });

    it('reports invalid group and selection references without replacing existing state', () => {
      const viewer = makeMockViewer();
      viewer.surfaces.set('lh', makeSurface([], 'left', 3));
      viewer.inspectionSelection = { kind: 'vertex', surfaceId: 'lh', vertexIndex: 0 };
      const state = makeMinimalState();
      state.surfaces.lh = {
        id: 'lh',
        type: 'MultiLayerNeuroSurface',
        hemisphere: 'left',
        visible: true,
        layers: [],
        layerOrder: [],
        clipPlanes: []
      };
      state.surfaceGroups = [{
        kind: 'bilateral',
        id: 'bad',
        leftSurfaceId: 'lh',
        rightSurfaceId: 'missing'
      }];
      state.inspectionSelection = { kind: 'vertex', surfaceId: 'lh', vertexIndex: 99 };

      const report = deserialize(viewer as any, state);

      expect(report.errors.map(issue => issue.code)).toEqual(expect.arrayContaining([
        'invalid-surface-group',
        'invalid-selection'
      ]));
      expect(viewer.getBilateralSurfaceGroups()).toEqual([]);
      expect(viewer.getInspectionSelection()).toEqual({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 0
      });
    });

    it('emits a report for success and failure', () => {
      const viewer = makeMockViewer();
      expect(deserialize(viewer as any, makeMinimalState()).success).toBe(true);
      const invalid = { ...makeMinimalState(), version: 99 };
      expect(deserialize(viewer as any, invalid as any).success).toBe(false);
      expect(viewer._events.filter(event => event.name === 'state:restored')).toHaveLength(2);
    });
  });

  it('restores the same canonical order used by visible-layer compositing', () => {
    const stack = new LayerStack();
    stack.addLayer(new BaseLayer(0xcccccc));
    stack.addLayer(new DataLayer('a', new Float32Array([1, 2, 3]), null, 'viridis'));
    stack.addLayer(new DataLayer('b', new Float32Array([4, 5, 6]), null, 'viridis'));
    const viewer = makeMockViewer() as any;
    viewer.surfaces.set('lh', {
      hemisphere: 'left',
      mesh: { visible: true },
      layerStack: stack,
      clipPlanes: { fromStateJSON: () => {} }
    });
    const state = makeMinimalState();
    state.surfaces.lh = {
      id: 'lh',
      type: 'MultiLayerNeuroSurface',
      hemisphere: 'left',
      visible: true,
      layers: stack.getOrderedLayers().map(layer => layer.toStateJSON() as any),
      layerOrder: ['base', 'b', 'a'],
      clipPlanes: []
    };

    const report = deserialize(viewer, state);

    expect(report.success).toBe(true);
    expect(stack.getOrderedLayers().map(layer => layer.id)).toEqual(['base', 'b', 'a']);
    expect(stack.getVisibleLayers().map(layer => layer.id)).toEqual(['base', 'b', 'a']);
  });
});
