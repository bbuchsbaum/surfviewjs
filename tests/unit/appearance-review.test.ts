import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { STYLE_PRESETS } from '../../src/StylePresets';
import type { SurfViewStylePresetName } from '../../src/StylePresets';
import { HEADLIGHT_FILL_OFFSET, HEADLIGHT_KEY_OFFSET } from '../../src/viewer/CameraHeadlight';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { SurfaceGeometry } from '../../src/classes';
import { CurvatureLayer } from '../../src/layers/CurvatureLayer';
import { ConnectivityLayer } from '../../src/ConnectivityLayer';
import { VolumeProjectionMaterial } from '../../src/materials/VolumeProjectionMaterial';
import { VOLUME_PROJECTION_FRAGMENT_SHADER } from '../../src/shaders/volumeProjection';
import { deserialize, serialize } from '../../src/serialization';
import type { ViewerStateV2 } from '../../src/serialization';
import { assertValidViewerStateNumbers } from '../../src/serialization/ViewerState';
import { ReportSceneController } from '../../src/report/ReportSceneController';
import { makeReportViewer, reportManifestFixture } from './report-scene-fixture';
import { DataLayer } from '../../src/layers';

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

/** sRGB electro-optical transfer function. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Cosine between the camera axis and a camera-space light direction. */
function cosToCamera(offset: readonly [number, number, number]): number {
  return new THREE.Vector3(...offset).normalize().z;
}

// ---------------------------------------------------------------------------
// 1. Exposure: head-on irradiance ≈ π for every preset under the headlight
// ---------------------------------------------------------------------------

describe('preset exposure', () => {
  const keyCos = cosToCamera(HEADLIGHT_KEY_OFFSET);
  const fillCos = cosToCamera(HEADLIGHT_FILL_OFFSET);

  for (const name of Object.keys(STYLE_PRESETS) as SurfViewStylePresetName[]) {
    it(`${name}: a camera-facing matte surface receives π irradiance (±3%)`, () => {
      const lighting = STYLE_PRESETS[name].lighting;
      // Luminance of the (linear) ambient colour; key and fill are white.
      const ambient = new THREE.Color(lighting.ambientColor);
      const ambientLuminance = 0.2126 * ambient.r + 0.7152 * ambient.g + 0.0722 * ambient.b;
      const key = new THREE.Color(lighting.directionalColor);
      const keyLuminance = 0.2126 * key.r + 0.7152 * key.g + 0.0722 * key.b;
      const irradiance = ambientLuminance * lighting.ambientIntensity +
        keyLuminance * lighting.directionalIntensity * keyCos +
        (lighting.fillIntensity ?? 0.45) * fillCos;
      expect(irradiance / Math.PI).toBeGreaterThan(0.97);
      expect(irradiance / Math.PI).toBeLessThan(1.03);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Serialization of the headlight
// ---------------------------------------------------------------------------

function lightingViewer(headlight: boolean) {
  const viewer: any = {
    camera: {
      position: { x: 0, y: 0, z: 200, set() {} },
      quaternion: { x: 0, y: 0, z: 0, w: 1, set() {} },
      up: { x: 0, y: 1, z: 0, set() {} },
      zoom: 1, fov: 45, updateProjectionMatrix: () => {}
    },
    cameraControls: { target: { x: 0, y: 0, z: 0, set() {} }, update: () => {} },
    config: { backgroundColor: 0, headlight },
    ambientLight: { intensity: 1 },
    directionalLight: {
      intensity: 1.8,
      position: { x: 5, y: 6, z: 7, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } }
    },
    scene: { background: null },
    surfaces: new Map(),
    crosshair: { toStateJSON: () => ({ visible: false, surfaceId: null, vertexIndex: null, size: 1, color: 0, mode: null }), fromStateJSON: () => {} },
    getInspectionSelection: () => ({ kind: 'none' }),
    setInspectionSelection: (selection: unknown) => ({ ok: true, changed: false, selection }),
    getBilateralSurfaceGroups: () => [],
    emit: () => {},
    requestRender: () => {},
    setHeadlight: vi.fn(function (this: any, value: boolean) { this.config.headlight = value; })
  };
  return viewer;
}

describe('headlight serialization', () => {
  it('records the headlight and omits a camera-dependent key position while it is on', () => {
    const state = serialize(lightingViewer(true));
    expect(state.config.lighting?.headlight).toBe(true);
    expect(state.config.lighting?.directionalPosition).toBeUndefined();
  });

  it('records the world key position when the headlight is off', () => {
    const state = serialize(lightingViewer(false));
    expect(state.config.lighting?.headlight).toBe(false);
    expect(state.config.lighting?.directionalPosition).toEqual([5, 6, 7]);
  });

  it('restores the headlight through setHeadlight and ignores a stale position while it is on', () => {
    const source = serialize(lightingViewer(true));
    (source.config.lighting as any).directionalPosition = [9, 9, 9];
    const target = lightingViewer(false);
    expect(deserialize(target, source).success).toBe(true);
    expect(target.setHeadlight).toHaveBeenCalledWith(true);
    expect(target.config.headlight).toBe(true);
    expect([target.directionalLight.position.x, target.directionalLight.position.y]).toEqual([5, 6]);
  });

  it('restores headlight: false and then the world key position', () => {
    const source = serialize(lightingViewer(false));
    const target = lightingViewer(true);
    target.directionalLight.position.set(0, 0, 0);
    expect(deserialize(target, source).success).toBe(true);
    expect(target.setHeadlight).toHaveBeenCalledWith(false);
    expect([target.directionalLight.position.x, target.directionalLight.position.y, target.directionalLight.position.z]).toEqual([5, 6, 7]);
  });

  it('leaves the headlight alone for states saved before it existed', () => {
    const source = serialize(lightingViewer(false));
    delete (source.config.lighting as any).headlight;
    const target = lightingViewer(true);
    expect(deserialize(target, source).success).toBe(true);
    expect(target.setHeadlight).not.toHaveBeenCalled();
    expect(target.config.headlight).toBe(true);
  });

  it('rejects a non-boolean headlight', () => {
    const state = serialize(lightingViewer(true)) as ViewerStateV2;
    (state.config.lighting as any).headlight = 'yes';
    expect(() => assertValidViewerStateNumbers(state)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. CurvatureLayer state round trip
// ---------------------------------------------------------------------------

describe('CurvatureLayer state', () => {
  it('round-trips brightness, contrast, smoothness and invert', () => {
    const source = new CurvatureLayer('curvature', new Float32Array([0, 1]), {
      brightness: 0.3, contrast: 0.7, smoothness: 0.4, invert: true
    });
    const target = new CurvatureLayer('curvature', new Float32Array([0, 1]));
    target.fromStateJSON(source.toStateJSON());
    expect(target.getDisplayParams()).toEqual({ brightness: 0.3, contrast: 0.7, smoothness: 0.4, invert: true });
  });

  it('defaults invert to false when the state omits it', () => {
    const target = new CurvatureLayer('curvature', new Float32Array([0, 1]), { invert: true });
    target.fromStateJSON({ id: 'curvature', type: 'curvature', brightness: 0.5, contrast: 0.5, smoothness: 1 });
    expect(target.getDisplayParams().invert).toBe(false);
  });

  it('restores through viewer deserialization', () => {
    const surface = new MultiLayerNeuroSurface(triangle(), {
      curvature: new Float32Array([0, 0.5, -0.5]),
      curvatureOptions: { brightness: 0.3, contrast: 0.7, smoothness: 0.4, invert: true }
    });
    const viewer: any = lightingViewer(true);
    viewer.surfaces.set('lh', surface);
    const state = serialize(viewer);
    surface.getCurvatureLayer()!.update({ brightness: 0.9, invert: false });
    expect(deserialize(viewer, state).success).toBe(true);
    expect(surface.getCurvatureLayer()!.getDisplayParams()).toEqual({ brightness: 0.3, contrast: 0.7, smoothness: 0.4, invert: true });
    surface.dispose();
  });
});

// ---------------------------------------------------------------------------
// 4. Presets keep an explicit base colour
// ---------------------------------------------------------------------------

function baseColorOf(surface: MultiLayerNeuroSurface): unknown {
  return surface.getLayer('base')!.toStateJSON().color;
}

describe('style presets and base colours', () => {
  it('keeps a base colour the caller set and recolours a default one', () => {
    const viewer = makeReportViewer();
    const explicit = new MultiLayerNeuroSurface(triangle('left'), { baseColor: 0x123456 });
    const implicit = new MultiLayerNeuroSurface(triangle('right'));
    viewer.addSurface(explicit, 'lh');
    viewer.addSurface(implicit, 'rh');
    viewer.applyStylePreset('talk-dark');
    expect(baseColorOf(explicit)).toBe(0x123456);
    expect(baseColorOf(implicit)).toBe(STYLE_PRESETS['talk-dark'].material.baseColor);
    explicit.dispose();
    implicit.dispose();
  });

  it('treats a later updateConfig({ color }) as explicit', () => {
    const viewer = makeReportViewer();
    const surface = new MultiLayerNeuroSurface(triangle());
    viewer.addSurface(surface, 'lh');
    surface.updateConfig({ color: 0x654321 });
    viewer.applyStylePreset('paper-light');
    expect(baseColorOf(surface)).toBe(0x654321);
    surface.dispose();
  });
});

// ---------------------------------------------------------------------------
// 6. Connectivity edges decode colormap colours
// ---------------------------------------------------------------------------

function edgeSurface() {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
  return { geometry: { vertices }, mesh: new THREE.Group() };
}

describe('connectivity edge colours', () => {
  const edges = [{ source: 0, target: 1, weight: 0.5 }, { source: 1, target: 2, weight: 0.8 }];

  it('writes linear colours to line vertex colours', () => {
    const layer = new ConnectivityLayer('c', edges, { renderMode: 'line', colorMap: 'viridis', weightRange: [0, 1] });
    layer.attach(edgeSurface());
    const display = layer.getEdgeColors();
    const lines = layer.getGroup().children.find(child => (child as THREE.LineSegments).isLineSegments) as THREE.LineSegments;
    const colors = (lines.geometry.getAttribute('color') as THREE.BufferAttribute).array;
    for (const [edge, channel] of [[0, 0], [0, 1], [1, 2]] as const) {
      expect(colors[edge * 6 + channel]).toBeCloseTo(srgbToLinear(display[edge * 4 + channel]!), 5);
      expect(colors[edge * 6 + 3 + channel]).toBeCloseTo(srgbToLinear(display[edge * 4 + channel]!), 5);
    }
  });

  it('writes linear instance colours to tubes', () => {
    const layer = new ConnectivityLayer('t', edges, { renderMode: 'tube', colorMap: 'viridis', weightRange: [0, 1] });
    layer.attach(edgeSurface());
    const display = layer.getEdgeColors();
    const tubes = layer.getGroup().children.find(child => (child as THREE.InstancedMesh).isInstancedMesh && child.name.includes('tubes')) as THREE.InstancedMesh;
    const color = new THREE.Color();
    tubes.getColorAt(1, color);
    expect(color.r).toBeCloseTo(srgbToLinear(display[4]!), 5);
    expect(color.g).toBeCloseTo(srgbToLinear(display[5]!), 5);
  });
});

// ---------------------------------------------------------------------------
// 7. Volume projection colour encoding
// ---------------------------------------------------------------------------

describe('volume projection colour management', () => {
  it('decodes the colormap and encodes the output colour space', () => {
    expect(VOLUME_PROJECTION_FRAGMENT_SHADER).toContain('sRGBTransferEOTF( texture(uColormapSampler');
    expect(VOLUME_PROJECTION_FRAGMENT_SHADER).toMatch(/outColor = linearToOutputTexel\( vec4\( baseRgb, 1\.0 \) \);/);
    expect(VOLUME_PROJECTION_FRAGMENT_SHADER).toMatch(/outColor = linearToOutputTexel\( vec4\( finalRgb, 1\.0 \) \);/);
    expect(VolumeProjectionMaterial).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Report disposal respects a user headlight choice
// ---------------------------------------------------------------------------

function reportViewer() {
  const viewer = makeReportViewer();
  const manifest = reportManifestFixture();
  for (const [id, hemi] of [['lh', 'left'], ['rh', 'right']] as const) {
    const geometry = manifest.geometries[id]!;
    void geometry;
    const surface = new MultiLayerNeuroSurface(triangle(hemi));
    surface.addLayer(new DataLayer('response', [1, 2, 3], null, 'viridis', { range: [0, 4] }));
    viewer.addSurface(surface, id);
  }
  manifest.geometries.lh!.vertexCount = 3;
  manifest.geometries.lh!.faceCount = 1;
  manifest.geometries.rh!.vertexCount = 3;
  manifest.geometries.rh!.faceCount = 1;
  const group = { id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' };
  viewer.registerBilateralSurfaceGroup(group);
  return { viewer, manifest, group };
}

describe('report headlight ownership', () => {
  it('restores the viewer setting on dispose when the user did not change it', () => {
    const { viewer, manifest, group } = reportViewer();
    const controller = new ReportSceneController(viewer, manifest, { bilateralGroup: group });
    expect(viewer.config.headlight).toBe(false);
    controller.dispose();
    expect(viewer.config.headlight).toBe(true);
  });

  it('keeps a setHeadlight() the user made while the report was live', () => {
    // The report leaves an already-on headlight alone; the user then turns it off.
    const { viewer, manifest, group } = reportViewer();
    const controller = new ReportSceneController(viewer, manifest, { bilateralGroup: group, layout: 'anatomical' });
    expect(viewer.config.headlight).toBe(true);
    viewer.setHeadlight(false);
    controller.dispose();
    expect(viewer.config.headlight).toBe(false);

    // The report turns it off (split); the user turns it on again while live.
    const second = reportViewer();
    const report = new ReportSceneController(second.viewer, second.manifest, { bilateralGroup: second.group });
    expect(second.viewer.config.headlight).toBe(false);
    second.viewer.setHeadlight(true);
    second.viewer.setHeadlight(false);
    report.dispose();
    // Still what the report set, so the viewer's own setting comes back.
    expect(second.viewer.config.headlight).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. The headlight follows reassigned light objects
// ---------------------------------------------------------------------------

describe('headlight light ownership', () => {
  it('aims lights assigned after the first render', () => {
    const viewer = makeReportViewer();
    viewer.config.headlight = true;
    viewer.render();
    const replacement = new THREE.DirectionalLight();
    viewer.directionalLight = replacement;
    viewer.camera.position.set(-100, 0, 0);
    viewer.camera.lookAt(0, 0, 0);
    viewer.camera.updateMatrixWorld(true);
    viewer.render();
    const direction = replacement.position.clone().sub(replacement.target.position).normalize();
    const expected = new THREE.Vector3(...HEADLIGHT_KEY_OFFSET).normalize().applyQuaternion(viewer.camera.quaternion);
    expect(direction.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('is a NeuroSurfaceViewer method', () => {
    expect(typeof NeuroSurfaceViewer.prototype.setHeadlight).toBe('function');
  });
});
