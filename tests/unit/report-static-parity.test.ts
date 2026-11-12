/**
 * @vitest-environment jsdom
 */
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURVATURE_SPREAD_PERCENTILE,
  CurvatureLayer,
  curvatureSpread
} from '../../src/layers/CurvatureLayer';
import { DataLayer } from '../../src/layers';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { SurfaceGeometry } from '../../src/classes';
import { getStylePreset } from '../../src/StylePresets';
import { mountSurfView, reportPresetWithBackground } from '../../src/report/SceneMount';
import { createViewerControlTarget } from '../../src/controls';
import {
  SCENE_UINT16_MAX_VERTICES,
  SceneManifestError,
  createSceneAsset,
  decodeUint16LE,
  encodeUint16LE,
  loadSceneAsset,
  sceneIndexDType,
  validateSceneManifest
} from '../../src/scene';
import { fixtureManifest } from './scene-manifest.test';
import { makeReportViewer } from './report-scene-fixture';

// Regression coverage for issue #18: report widgets should match the static
// (CPU-rendered) report figures and carry a self-explaining colour key.

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  }
});

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function grays(layer: CurvatureLayer, count: number): number[] {
  const rgba = layer.getRGBAData(count);
  return Array.from({ length: count }, (_, vertex) => Number(rgba[vertex * 4]!.toFixed(4)));
}

describe('curvature smoothness relative to the data spread', () => {
  it('measures the robust spread as a percentile of |value| over finite entries', () => {
    const values = Float32Array.from({ length: 100 }, (_, index) => (index % 2 ? -1 : 1) * (index + 1) / 100);
    values[0] = Number.NaN;
    expect(CURVATURE_SPREAD_PERCENTILE).toBe(98);
    expect(curvatureSpread(values)).toBeCloseTo(0.99, 6);
    expect(curvatureSpread(new Float32Array([Number.NaN]))).toBe(0);
  });

  it('gives the same continuous ramp whatever the anatomy normalisation', () => {
    // The same anatomy normalised to [-0.5, 0.5] and to [-1, 1].
    const half = Float32Array.from({ length: 51 }, (_, index) => (index - 25) / 50);
    const unit = half.map(value => value * 2);
    const options = { brightness: 0.815, contrast: 0.23, smoothness: 1, smoothnessScale: 'spread' as const };
    const a = new CurvatureLayer('a', half, options);
    const b = new CurvatureLayer('b', unit, options);
    expect(grays(a, 51)).toEqual(grays(b, 51));
    // Continuous: no two-tone saturation, and the band spans 0.70 to 0.93.
    const values = grays(a, 51);
    expect(new Set(values).size).toBeGreaterThan(40);
    expect(Math.min(...values)).toBeCloseTo(0.7, 2);
    expect(Math.max(...values)).toBeCloseTo(0.93, 2);

    // In data units the old report setting saturates [-0.5, 0.5] input.
    const legacy = new CurvatureLayer('legacy', half, { brightness: 0.73, contrast: 0.32, smoothness: 0.2 });
    const legacyValues = grays(legacy, 51);
    expect(legacyValues.filter(value => value === legacyValues[0]).length).toBeGreaterThan(15);
  });

  it('follows new data, round-trips its state and validates the scale', () => {
    const layer = new CurvatureLayer('c', new Float32Array([-1, 0, 1]), { smoothnessScale: 'spread' });
    expect(layer.getEffectiveSmoothness()).toBe(2);
    layer.setCurvature(new Float32Array([-4, 0, 4]));
    expect(layer.getEffectiveSmoothness()).toBe(8);
    layer.setSmoothness(0.5);
    expect(layer.getEffectiveSmoothness()).toBe(4);

    const state = layer.toStateJSON();
    expect(state.smoothnessScale).toBe('spread');
    const restored = new CurvatureLayer('c', new Float32Array([-4, 0, 4]));
    restored.fromStateJSON(state);
    expect(restored.getDisplayParams().smoothnessScale).toBe('spread');
    // Omitted at the default, so earlier states restore data units.
    restored.fromStateJSON({ ...state, smoothnessScale: undefined });
    expect(restored.getDisplayParams().smoothnessScale).toBe('data');
    expect(new CurvatureLayer('d', [0]).toStateJSON()).not.toHaveProperty('smoothnessScale');

    expect(() => layer.setSmoothnessScale('percent' as never)).toThrow(TypeError);
    expect(() => layer.update({ smoothnessScale: 'percent' as never, brightness: 0.1 })).toThrow(TypeError);
    expect(layer.getDisplayParams().brightness).toBe(0.5);
  });

  it('reaches surfaces through report mounts and preset application', () => {
    const report = getStylePreset('report');
    const geometry = new SurfaceGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      'left'
    );
    const surface = new MultiLayerNeuroSurface(geometry, {
      curvature: new Float32Array([-0.5, 0, 0.5]),
      curvatureOptions: report.curvature
    });
    try {
      expect(surface.getCurvatureLayer()!.getDisplayParams()).toMatchObject({
        brightness: 0.815,
        contrast: 0.23,
        smoothness: 1,
        smoothnessScale: 'spread'
      });
    } finally {
      surface.dispose();
    }
  });
});

describe('uint16 index assets', () => {
  it('round-trips little-endian uint16 bytes and rejects values that do not fit', async () => {
    expect(Array.from(decodeUint16LE(encodeUint16LE([0, 1, 65535])))).toEqual([0, 1, 65535]);
    expect(() => encodeUint16LE([65536])).toThrow(RangeError);
    expect(() => encodeUint16LE([1.5])).toThrow(RangeError);
    const { descriptor, bytes } = await createSceneAsset([0, 1, 2], { role: 'faces', dtype: 'uint16', shape: [1, 3] });
    expect(descriptor.byteLength).toBe(6);
    expect(bytes.byteLength).toBe(6);
    const loaded = await loadSceneAsset(descriptor);
    expect(loaded).toBeInstanceOf(Uint16Array);
    expect(Array.from(loaded)).toEqual([0, 1, 2]);
  });

  it('chooses uint16 up to 65,536 vertices', () => {
    expect(SCENE_UINT16_MAX_VERTICES).toBe(65536);
    expect(sceneIndexDType(10242)).toBe('uint16');
    expect(sceneIndexDType(65536)).toBe('uint16');
    expect(sceneIndexDType(65537)).toBe('uint32');
    expect(() => sceneIndexDType(-1)).toThrow(RangeError);
  });

  it('accepts uint16 faces and sparse indices only where every vertex index fits', async () => {
    const manifest = await fixtureManifest();
    const faces = await createSceneAsset([0, 1, 2], { role: 'faces', dtype: 'uint16', shape: [1, 3] });
    const indices = await createSceneAsset([0, 2], { role: 'indices', dtype: 'uint16', shape: [2] });
    const values = await createSceneAsset([1, -1], { role: 'values', dtype: 'float32', shape: [2] });
    for (const asset of [faces, indices, values]) manifest.assets[asset.descriptor.id] = asset.descriptor;
    for (const geometry of Object.values(manifest.geometries)) geometry.faces = faces.descriptor.id;
    manifest.layers.statistic!.values.left = {
      values: values.descriptor.id,
      indices: indices.descriptor.id
    };
    expect(() => validateSceneManifest(manifest)).not.toThrow();

    // A geometry with one vertex more than uint16 can index. Validation reads
    // descriptors only, so the vertices asset needs no bytes.
    const large = structuredClone(manifest);
    const vertexCount = SCENE_UINT16_MAX_VERTICES + 1;
    large.assets['large-vertices'] = {
      id: 'large-vertices',
      role: 'vertices',
      dtype: 'float32',
      shape: [vertexCount, 3],
      byteLength: vertexCount * 12,
      sha256: 'a'.repeat(64),
      endianness: 'little',
      encoding: 'base64',
      data: ''
    };
    large.geometries.left!.vertices = 'large-vertices';
    large.geometries.left!.vertexCount = vertexCount;
    expect(() => validateSceneManifest(large)).toThrow(SceneManifestError);
    expect(() => validateSceneManifest(large)).toThrow(/uint16 with at most 65536 vertices/);
  });
});

describe('report mount background', () => {
  it('replaces the live and export background with a transparent or chosen colour', () => {
    const report = getStylePreset('report');
    const transparent = reportPresetWithBackground(report, 'transparent');
    expect(transparent.background).toEqual({ css: 'transparent', clearColor: report.background.clearColor, clearAlpha: 0 });
    expect(transparent.figure.transparent).toBe(true);
    expect(transparent.lighting).toEqual(report.lighting);
    expect(transparent.curvature).toEqual(report.curvature);

    expect(reportPresetWithBackground(report, '#fff').background)
      .toEqual({ css: '#ffffff', clearColor: 0xffffff, clearAlpha: 1 });
    expect(reportPresetWithBackground(report, '#0A141E').background.clearColor).toBe(0x0a141e);
    const colored = reportPresetWithBackground(report, 0x102030);
    expect(colored.background.css).toBe('#102030');
    expect(colored.figure.transparent).toBe(false);
    // The source preset is untouched.
    expect(getStylePreset('report').background.clearColor).toBe(0xf3f5f5);
  });

  it('rejects an invalid background before creating observers, fetches or WebGL', async () => {
    const observer = vi.fn();
    vi.stubGlobal('IntersectionObserver', observer);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const manifest = await fixtureManifest();
    for (const background of ['red', '#12345', 0x1000000, -1, 1.5, 'rgb(0,0,0)']) {
      expect(() => mountSurfView(container, manifest, {
        background: background as never,
        bilateralGroup: { id: 'cortex', leftSurfaceId: 'left', rightSurfaceId: 'right' }
      })).toThrow(/background/);
    }
    expect(observer).not.toHaveBeenCalled();
    expect(container.childElementCount).toBe(0);
  });
});

describe('colour previews from the layer itself', () => {
  it('samples custom colour arrays and the colour-key range', () => {
    const viewer = makeReportViewer();
    const geometry = new SurfaceGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      'left'
    );
    const surface = new MultiLayerNeuroSurface(geometry);
    surface.addLayer(new DataLayer('named', [0, 1, 2], null, 'viridis', { range: [0, 1] }));
    surface.addLayer(new DataLayer('map', [0, 1, 2], null, ['#0000ff', '#ffffff', '#ff0000'], { range: [-2, 2] }));
    viewer.addSurface(surface, 'left');
    const target = createViewerControlTarget(viewer);
    try {
      const layer = target.getSnapshot().surfaces[0]!.layers.find(candidate => candidate.id === 'map')!;
      expect(layer.colorPreview?.kind).toBe('colormap');
      expect(layer.colorPreview?.range).toEqual([-2, 2]);
      expect(layer.colorPreview?.stops).toHaveLength(33);
      expect(layer.colorPreview?.stops?.[0]).toBe('rgb(0, 0, 255)');
      expect(layer.colorPreview?.stops?.[16]).toBe('rgb(255, 255, 255)');
      expect(layer.colorPreview?.stops?.[32]).toBe('rgb(255, 0, 0)');
      expect(layer.colorPreview?.css).toBe(`linear-gradient(90deg, ${layer.colorPreview!.stops!.join(', ')})`);

      // A named preset keeps its compact three-stop swatch, with full stops alongside.
      const named = target.getSnapshot().surfaces[0]!.layers.find(candidate => candidate.id === 'named')!;
      expect(named.colorPreview?.css.match(/rgb\(/g)).toHaveLength(3);
      expect(named.colorPreview?.stops).toHaveLength(33);
      expect(named.colorPreview?.range).toEqual([0, 1]);
    } finally {
      target.dispose();
      surface.dispose();
    }
  });
});
