import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { SurfaceGeometry } from '../../src/classes';
import { BaseLayer, DataLayer } from '../../src/layers';
import { CurvatureLayer } from '../../src/layers/CurvatureLayer';
import { STYLE_PRESETS, getStylePreset } from '../../src/StylePresets';
import { deserialize, serialize } from '../../src/serialization';
import type { ViewerStateV2 } from '../../src/serialization';
import { assertValidViewerStateNumbers } from '../../src/serialization/ViewerState';
import { ReportSceneController } from '../../src/report/ReportSceneController';
import { makeReportViewer, reportManifestFixture } from './report-scene-fixture';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function triangle(hemi: 'left' | 'right' = 'left'): SurfaceGeometry {
  return new SurfaceGeometry(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]), hemi);
}

function baseColorOf(surface: MultiLayerNeuroSurface): unknown {
  return surface.getLayer('base')!.toStateJSON().color;
}

/** A report-fixture viewer with one curvature surface, enough for serialize/deserialize. */
function stateViewer() {
  const viewer = makeReportViewer();
  const surface = new MultiLayerNeuroSurface(triangle(), {
    baseColor: 0x336699,
    curvature: new Float32Array([0, 0.5, -0.5]),
    curvatureOptions: { brightness: 0.3, contrast: 0.7, smoothness: 0.4, invert: true }
  });
  viewer.addSurface(surface, 'lh');
  return { viewer, surface };
}

function layerState(state: ViewerStateV2, type: string): Record<string, unknown> {
  return state.surfaces.lh!.layers.find(layer => layer.type === type)! as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 3. Curvature and base-layer state is validated before anything is applied
// ---------------------------------------------------------------------------

describe('saved-state validation of anatomy layers', () => {
  it('rejects invalid curvature display values in the validation phase', () => {
    const { viewer, surface } = stateViewer();
    const good = serialize(viewer);
    for (const [key, value] of [
      ['invert', 'yes'], ['brightness', 1.5], ['contrast', -0.1], ['smoothness', 0]
    ] as const) {
      const state = structuredClone(good);
      layerState(state, 'curvature')[key] = value;
      expect(() => assertValidViewerStateNumbers(state), key).toThrow();
    }
    surface.dispose();
  });

  it('rejects an invalid base colour in the validation phase', () => {
    const { viewer, surface } = stateViewer();
    const state = serialize(viewer);
    layerState(state, 'base').color = 0x1000000;
    expect(() => assertValidViewerStateNumbers(state)).toThrow();
    surface.dispose();
  });

  it('leaves the camera and every layer untouched when a curvature value is invalid', () => {
    const { viewer, surface } = stateViewer();
    const state = serialize(viewer);
    state.camera.position = [1, 2, 3];
    layerState(state, 'curvature').invert = 'yes';
    const before = viewer.camera.position.toArray();
    const report = deserialize(viewer, state);
    expect(report.success).toBe(false);
    expect(viewer.camera.position.toArray()).toEqual(before);
    expect(surface.getCurvatureLayer()!.getDisplayParams().invert).toBe(true);
    surface.dispose();
  });
});

// ---------------------------------------------------------------------------
// 4. Style presets recolour only a base the user has not chosen
// ---------------------------------------------------------------------------

describe('user base colour protection', () => {
  const PRESET = 'talk-dark' as const;
  const presetColor = () => STYLE_PRESETS[PRESET].material.baseColor;

  function setup(config: ConstructorParameters<typeof MultiLayerNeuroSurface>[1] = {}) {
    const viewer = makeReportViewer();
    const surface = new MultiLayerNeuroSurface(triangle(), config);
    viewer.addSurface(surface, 'lh');
    return { viewer, surface };
  }

  it('recolours a default base, and keeps following later presets', () => {
    const { viewer, surface } = setup();
    viewer.applyStylePreset(PRESET);
    expect(baseColorOf(surface)).toBe(presetColor());
    viewer.applyStylePreset('paper-light');
    expect(baseColorOf(surface)).toBe(STYLE_PRESETS['paper-light'].material.baseColor);
  });

  const routes: Array<[string, (surface: MultiLayerNeuroSurface) => void]> = [
    ['updateConfig({ color })', surface => surface.updateConfig({ color: 0x123456 })],
    ['updateLayer(base, { color })', surface => surface.updateLayer('base', { color: 0x123456 })],
    ['BaseLayer.setColor', surface => (surface.getLayer('base') as BaseLayer).setColor(0x123456)],
    ['updateLayers({ type: base })', surface => surface.updateLayers([{ id: 'base', type: 'base', color: 0x123456 }])],
    ['updateLayers({ color })', surface => surface.updateLayers([{ id: 'base', color: 0x123456 }])]
  ];
  for (const [name, route] of routes) {
    it(`keeps a colour set through ${name}`, () => {
      const { viewer, surface } = setup();
      route(surface);
      viewer.applyStylePreset(PRESET);
      expect(baseColorOf(surface)).toBe(0x123456);
    });
  }

  it('keeps a constructor baseColor or color', () => {
    for (const config of [{ baseColor: 0x123456 }, { color: 0x123456 }]) {
      const { viewer, surface } = setup(config);
      expect(baseColorOf(surface)).toBe(0x123456);
      viewer.applyStylePreset(PRESET);
      expect(baseColorOf(surface)).toBe(0x123456);
    }
  });

  it('hands the base back to presets with resetBaseColor()', () => {
    const { viewer, surface } = setup({ baseColor: 0x123456 });
    viewer.applyStylePreset(PRESET);
    expect(baseColorOf(surface)).toBe(0x123456);
    surface.resetBaseColor();
    expect(baseColorOf(surface)).toBe(presetColor());
    viewer.applyStylePreset('paper-light');
    expect(baseColorOf(surface)).toBe(STYLE_PRESETS['paper-light'].material.baseColor);
  });
});

// ---------------------------------------------------------------------------
// 5. The base colour is restored from saved state
// ---------------------------------------------------------------------------

describe('base colour state', () => {
  it('round-trips through BaseLayer.fromStateJSON', () => {
    const source = new BaseLayer(0x336699);
    const target = new BaseLayer(0xcccccc);
    target.fromStateJSON(source.toStateJSON());
    expect(target.toStateJSON().color).toBe(0x336699);
    expect(() => target.fromStateJSON({ color: 'red' })).toThrow();
    expect(target.toStateJSON().color).toBe(0x336699);
  });

  it('restores through viewer deserialization and then counts as user-chosen', () => {
    const { viewer, surface } = stateViewer();
    const state = serialize(viewer);
    surface.getLayer('base')!.update({ color: 0xcccccc });
    surface.resetBaseColor();
    expect(deserialize(viewer, state).success).toBe(true);
    expect(baseColorOf(surface)).toBe(0x336699);
    viewer.applyStylePreset('talk-dark');
    expect(baseColorOf(surface)).toBe(0x336699);
  });
});

// ---------------------------------------------------------------------------
// 6. States saved before the headlight existed
// ---------------------------------------------------------------------------

describe('pre-headlight states', () => {
  it('keeps a headlight-on viewer camera-lit and drops the stale world key position', () => {
    const { viewer, surface } = stateViewer();
    viewer.config.headlight = true;
    const state = serialize(viewer);
    delete (state.config.lighting as Record<string, unknown>).headlight;
    state.config.lighting!.directionalPosition = [9, 8, 7];
    viewer.directionalLight.position.set(1, 1, 1);
    expect(deserialize(viewer, state).success).toBe(true);
    expect(viewer.config.headlight).toBe(true);
    expect(viewer.directionalLight.position.toArray()).toEqual([1, 1, 1]);
    surface.dispose();
  });

  it('applies the stored world key position when the viewer headlight is off', () => {
    const { viewer, surface } = stateViewer();
    viewer.config.headlight = false;
    const state = serialize(viewer);
    delete (state.config.lighting as Record<string, unknown>).headlight;
    state.config.lighting!.directionalPosition = [9, 8, 7];
    expect(deserialize(viewer, state).success).toBe(true);
    expect(viewer.directionalLight.position.toArray()).toEqual([9, 8, 7]);
    surface.dispose();
  });
});

// ---------------------------------------------------------------------------
// 7. Nested report controllers share the headlight override
// ---------------------------------------------------------------------------

function reportViewer() {
  const viewer = makeReportViewer();
  const manifest = reportManifestFixture();
  for (const [id, hemi] of [['lh', 'left'], ['rh', 'right']] as const) {
    const surface = new MultiLayerNeuroSurface(triangle(hemi));
    surface.addLayer(new DataLayer('response', [1, 2, 3], null, 'viridis', { range: [0, 4] }));
    viewer.addSurface(surface, id);
  }
  for (const id of ['lh', 'rh'] as const) {
    manifest.geometries[id]!.vertexCount = 3;
    manifest.geometries[id]!.faceCount = 1;
  }
  const group = { id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' };
  viewer.registerBilateralSurfaceGroup(group);
  return { viewer, manifest, group };
}

describe('nested report headlight overrides', () => {
  it('keeps a live report\'s override when an earlier report is disposed', () => {
    const { viewer, manifest, group } = reportViewer();
    const a = new ReportSceneController(viewer, manifest, { bilateralGroup: group, headlight: false });
    expect(viewer.config.headlight).toBe(false);
    const b = new ReportSceneController(viewer, manifest, { bilateralGroup: group, headlight: true });
    expect(viewer.config.headlight).toBe(true);
    a.dispose();
    expect(viewer.config.headlight).toBe(true);
    b.dispose();
    expect(viewer.config.headlight).toBe(true);
  });

  it('falls back to the earlier override when the later report goes first', () => {
    const { viewer, manifest, group } = reportViewer();
    const a = new ReportSceneController(viewer, manifest, { bilateralGroup: group, headlight: false });
    const b = new ReportSceneController(viewer, manifest, { bilateralGroup: group, headlight: true });
    b.dispose();
    expect(viewer.config.headlight).toBe(false);
    a.dispose();
    expect(viewer.config.headlight).toBe(true);
  });

  it('lets an explicit setHeadlight() outlive every live override', () => {
    const { viewer, manifest, group } = reportViewer();
    const a = new ReportSceneController(viewer, manifest, { bilateralGroup: group, headlight: true });
    const b = new ReportSceneController(viewer, manifest, { bilateralGroup: group, headlight: true });
    viewer.setHeadlight(false);
    a.dispose();
    b.dispose();
    expect(viewer.config.headlight).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. The viewer applies preset light intensities to its lights
// ---------------------------------------------------------------------------

describe('preset intensities reach the lights', () => {
  it('applyStylePreset sets ambient, key and fill intensities', () => {
    const viewer = makeReportViewer();
    (viewer as unknown as { fillLight: THREE.DirectionalLight }).fillLight = new THREE.DirectionalLight();
    for (const name of ['report', 'freesurfer', 'talk-dark'] as const) {
      viewer.applyStylePreset(name);
      const lighting = getStylePreset(name).lighting;
      expect(viewer.ambientLight.intensity).toBe(lighting.ambientIntensity);
      expect(viewer.ambientLight.color.getHex()).toBe(lighting.ambientColor);
      expect(viewer.directionalLight.intensity).toBe(lighting.directionalIntensity);
      expect(viewer.fillLight.intensity).toBe(lighting.fillIntensity);
    }
  });

  it('setupLighting builds the default preset rig', () => {
    const host: Record<string, unknown> = {
      scene: new THREE.Scene(),
      config: { ambientLightColor: 0xffffff, directionalLightColor: 0xffffff, directionalLightIntensity: 1.84 },
      stylePreset: getStylePreset('default'),
      invalidateState: () => {}
    };
    NeuroSurfaceViewer.prototype.setupLighting.call(host as unknown as NeuroSurfaceViewer);
    const lighting = getStylePreset('default').lighting;
    expect((host.ambientLight as THREE.AmbientLight).intensity).toBe(lighting.ambientIntensity);
    expect((host.directionalLight as THREE.DirectionalLight).intensity).toBe(lighting.directionalIntensity);
    expect((host.fillLight as THREE.DirectionalLight).intensity).toBe(lighting.fillIntensity);
  });
});

describe('CurvatureLayer validation stays transactional', () => {
  it('rejects invalid state without changing the layer', () => {
    const layer = new CurvatureLayer('curvature', new Float32Array([0]), { brightness: 0.3 });
    expect(() => layer.fromStateJSON({ brightness: 0.9, invert: 'yes' })).toThrow();
    expect(layer.getDisplayParams().brightness).toBe(0.3);
  });
});
