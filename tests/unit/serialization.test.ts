import { describe, it, expect } from 'vitest';
import {
  encode,
  decode,
  CURRENT_VERSION,
  serialize,
  deserialize
} from '../../src/serialization';
import type { ViewerStateV1 } from '../../src/serialization';
import { DataLayer, BaseLayer, TwoDataLayer, Layer } from '../../src/layers';
import { CrosshairManager } from '../../src/CrosshairManager';
import { ClipPlane, ClipPlaneSet } from '../../src/utils/ClipPlane';
import { ConnectivityLayer } from '../../src/ConnectivityLayer';
import ColorMap from '../../src/ColorMap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalState(): ViewerStateV1 {
  return {
    version: 1,
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
    surfaces: {
      lh: {
        id: 'lh',
        type: 'MultiLayerNeuroSurface',
        hemisphere: 'left',
        visible: true,
        layers: [
          {
            id: 'base',
            type: 'base',
            visible: true,
            opacity: 1,
            blendMode: 'normal',
            order: -1,
            color: 0xcccccc
          },
          {
            id: 'activation',
            type: 'data',
            visible: true,
            opacity: 0.8,
            blendMode: 'normal',
            order: 1,
            colorMapName: 'hot',
            range: [-3, 3],
            threshold: [-1, 1]
          }
        ],
        clipPlanes: [
          { axis: 'x', normal: [1, 0, 0], distance: 0, enabled: false, flip: false }
        ]
      }
    },
    crosshair: {
      visible: false,
      surfaceId: null,
      vertexIndex: null,
      size: 1.5,
      color: 0xffcc00,
      mode: null
    },
    timeline: null,
    selection: { surfaceId: null, layerId: null }
  };
}

function makeMockViewer(state?: Partial<ViewerStateV1>) {
  const s = state ?? {};
  const events: Array<{ name: string; data: any }> = [];

  return {
    camera: {
      position: { x: 0, y: 0, z: 200, set: function (x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
      quaternion: { x: 0, y: 0, z: 0, w: 1, set: function (x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; } },
      up: { x: 0, y: 1, z: 0, set: function (x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
      zoom: 1,
      fov: 45,
      updateProjectionMatrix: () => {}
    },
    controls: {
      target: { x: 0, y: 0, z: 0, set: function (x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
      update: () => {}
    },
    config: { backgroundColor: 0x000000 },
    ambientLight: { intensity: 0.5 },
    directionalLight: {
      intensity: 1.0,
      position: { x: 1, y: 1, z: 1, set: function (x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } }
    },
    scene: { background: null },
    surfaces: new Map(),
    crosshair: new CrosshairManager(() => {}),
    selectedSurfaceId: s.selection?.surfaceId ?? null,
    selectedLayerId: s.selection?.layerId ?? null,
    emit: (name: string, data: any) => events.push({ name, data }),
    requestRender: () => {},
    _events: events
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Serialization', () => {

  // --- Encode / Decode roundtrip -------------------------------------------

  describe('encode / decode', () => {
    it('roundtrips a full state object', () => {
      const state = makeMinimalState();
      const hash = encode(state);
      expect(hash).toMatch(/^svjs=/);

      const decoded = decode(hash);
      expect(decoded).toEqual(state);
    });

    it('roundtrips with hash prefix (#)', () => {
      const state = makeMinimalState();
      const hash = '#' + encode(state);
      const decoded = decode(hash);
      expect(decoded).toEqual(state);
    });

    it('produces URL-safe characters only', () => {
      const state = makeMinimalState();
      const hash = encode(state);
      const payload = hash.slice(5); // remove "svjs="
      expect(payload).not.toMatch(/[+/=]/);
    });

    it('typical state compresses to < 2KB', () => {
      const state = makeMinimalState();
      const hash = encode(state);
      expect(hash.length).toBeLessThan(2048);
    });

    it('throws on missing svjs= prefix', () => {
      expect(() => decode('invalid')).toThrow('missing "svjs="');
    });

    it('throws on empty payload', () => {
      expect(() => decode('svjs=')).toThrow('empty payload');
    });

    it('throws on corrupted data', () => {
      expect(() => decode('svjs=!!!not-valid-base64!!!')).toThrow();
    });
  });

  // --- Schema versioning ---------------------------------------------------

  describe('versioning', () => {
    it('state always includes version: 1', () => {
      const state = makeMinimalState();
      expect(state.version).toBe(CURRENT_VERSION);
      expect(state.version).toBe(1);
    });

    it('rejects future version', () => {
      const state = makeMinimalState();
      (state as any).version = 99;
      const hash = encode(state as ViewerStateV1);
      expect(() => decode(hash)).toThrow('newer than supported');
    });
  });

  // --- Component toStateJSON ------------------------------------------------

  describe('component toStateJSON', () => {
    it('DataLayer serializes colormap, range, threshold', () => {
      const layer = new DataLayer(
        'act', new Float32Array([1, 2, 3]), null, 'hot',
        { range: [-3, 3], threshold: [-1, 1], opacity: 0.8 }
      );
      const json = layer.toStateJSON();
      expect(json.type).toBe('data');
      expect(json.colorMapName).toBe('hot');
      expect(json.range).toEqual([-3, 3]);
      expect(json.threshold).toEqual([-1, 1]);
      expect(json.opacity).toBeCloseTo(0.8, 5);
    });

    it('BaseLayer serializes color', () => {
      const layer = new BaseLayer(0xff0000, { opacity: 0.5 });
      const json = layer.toStateJSON();
      expect(json.type).toBe('base');
      expect(json.color).toBe(0xff0000);
    });

    it('CrosshairManager serializes state', () => {
      const ch = new CrosshairManager(() => {});
      ch.size = 2.0;
      ch.color = 0x00ff00;
      ch.visible = true;
      ch.surfaceId = 'lh';
      ch.vertexIndex = 42;
      ch.mode = 'selection';

      const json = ch.toStateJSON();
      expect(json.visible).toBe(true);
      expect(json.surfaceId).toBe('lh');
      expect(json.vertexIndex).toBe(42);
      expect(json.size).toBe(2.0);
      expect(json.color).toBe(0x00ff00);
      expect(json.mode).toBe('selection');
    });

    it('ClipPlane serializes axis, distance, enabled, flip', () => {
      const cp = new ClipPlane();
      cp.setFromAxisDistance('x', 5.0, false);
      cp.setEnabled(true);
      const json = cp.toStateJSON();
      expect(json.axis).toBe('x');
      expect(json.distance).toBeCloseTo(5.0, 3);
      expect(json.enabled).toBe(true);
      expect(json.flip).toBe(false);
    });

    it('ClipPlaneSet serializes all 3 planes', () => {
      const cps = new ClipPlaneSet();
      cps.setClipPlane('y', 10, true, false);
      const json = cps.toStateJSON();
      expect(json).toHaveLength(3);
      expect(json[1].axis).toBe('y');
      expect(json[1].enabled).toBe(true);
    });

    it('ConnectivityLayer serializes renderMode, threshold, topN', () => {
      const layer = new ConnectivityLayer('conn', [
        { source: 0, target: 1, weight: 0.8 }
      ], { renderMode: 'line', threshold: 0.3, topN: 50 });
      const json = layer.toStateJSON();
      expect(json.type).toBe('connectivity');
      expect(json.renderMode).toBe('line');
      expect(json.threshold).toBe(0.3);
      expect(json.topN).toBe(50);
    });
  });

  // --- StateSerializer -----------------------------------------------------

  describe('serialize', () => {
    it('captures camera state from mock viewer', () => {
      const viewer = makeMockViewer();
      const state = serialize(viewer as any);
      expect(state.version).toBe(1);
      expect(state.camera.position).toEqual([0, 0, 200]);
      expect(state.camera.fov).toBe(45);
    });

    it('captures config state', () => {
      const viewer = makeMockViewer();
      const state = serialize(viewer as any);
      expect(state.config.background).toBe(0x000000);
      expect(state.config.lighting?.ambientIntensity).toBe(0.5);
    });

    it('captures crosshair state', () => {
      const viewer = makeMockViewer();
      viewer.crosshair.size = 3.0;
      viewer.crosshair.color = 0xff0000;
      const state = serialize(viewer as any);
      expect(state.crosshair.size).toBe(3.0);
      expect(state.crosshair.color).toBe(0xff0000);
    });

    it('captures selection state', () => {
      const viewer = makeMockViewer();
      viewer.selectedSurfaceId = 'rh';
      viewer.selectedLayerId = 'act';
      const state = serialize(viewer as any);
      expect(state.selection.surfaceId).toBe('rh');
      expect(state.selection.layerId).toBe('act');
    });

    it('returns null timeline when no controller exists', () => {
      const viewer = makeMockViewer();
      const state = serialize(viewer as any);
      expect(state.timeline).toBeNull();
    });
  });

  // --- StateDeserializer ---------------------------------------------------

  describe('deserialize', () => {
    it('restores camera position', () => {
      const viewer = makeMockViewer();
      const state = makeMinimalState();
      state.surfaces = {}; // no surfaces to avoid missing-surface warnings
      const report = deserialize(viewer as any, state);

      expect(viewer.camera.position.x).toBe(10);
      expect(viewer.camera.position.y).toBe(20);
      expect(viewer.camera.position.z).toBe(30);
      expect(report.success).toBe(true);
    });

    it('restores selection', () => {
      const viewer = makeMockViewer();
      const state = makeMinimalState();
      state.selection = { surfaceId: 'lh', layerId: 'act' };
      deserialize(viewer as any, state);

      expect(viewer.selectedSurfaceId).toBe('lh');
      expect(viewer.selectedLayerId).toBe('act');
    });

    it('reports missing surfaces as warnings', () => {
      const viewer = makeMockViewer();
      const state = makeMinimalState();
      const report = deserialize(viewer as any, state);

      expect(report.surfacesSkipped).toContain('lh');
      expect(report.warnings.length).toBeGreaterThan(0);
    });

    it('emits state:restored event', () => {
      const viewer = makeMockViewer();
      const state = makeMinimalState();
      state.surfaces = {}; // no surfaces to skip
      deserialize(viewer as any, state);

      const events = viewer._events;
      expect(events.some((e: any) => e.name === 'state:restored')).toBe(true);
    });

    it('each section applies independently — missing surface yields warning but camera still works', () => {
      const viewer = makeMockViewer();
      const state = makeMinimalState();
      // Surface 'lh' exists in state but not in viewer → warning
      const report = deserialize(viewer as any, state);

      // Camera should still be applied despite surface warning
      expect(viewer.camera.position.x).toBe(10);
      expect(report.surfacesSkipped).toContain('lh');
      expect(report.warnings.length).toBeGreaterThan(0);
    });
  });

  // --- Full roundtrip: serialize → encode → decode → deserialize -----------

  describe('full roundtrip', () => {
    it('serialize → encode → decode produces identical state', () => {
      const viewer = makeMockViewer();
      viewer.crosshair.size = 2.5;
      viewer.selectedSurfaceId = 'lh';

      const state = serialize(viewer as any);
      const hash = encode(state);
      const decoded = decode(hash);

      expect(decoded.camera).toEqual(state.camera);
      expect(decoded.crosshair).toEqual(state.crosshair);
      expect(decoded.selection).toEqual(state.selection);
      expect(decoded.version).toBe(1);
    });
  });
});
