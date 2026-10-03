/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  ColorMap,
  DataLayer,
  getStylePreset,
  MultiLayerNeuroSurface,
  NeuroSurfaceViewer,
  RGBALayer,
  StatisticalMapLayer,
  SurfaceGeometry,
  VolumeProjectionLayer,
  resolveFigureExportOptions
} from '../../src';
import type { FigureColorbarSource } from '../../src';
import { drawFigureOverlays, formatColorbarTick } from '../../src/viewer/FigureOverlayRenderer';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SOURCE: FigureColorbarSource = {
  label: 'Task activation (z)',
  colors: ['rgb(255, 0, 0)', 'rgb(0, 0, 255)'],
  range: [-3, 5],
  threshold: [-1, 1],
  caps: { low: false, high: true }
};

describe('figure export background', () => {
  it('exports report figures opaque by default', () => {
    expect(getStylePreset('report').figure.transparent).toBe(false);
    const resolved = resolveFigureExportOptions('report', {}, undefined, {
      background: { color: 0xfbfbf8, transparent: false }
    });
    expect(resolved.transparent).toBe(false);
    // The live viewer background, not the preset's clear colour.
    expect(resolved.backgroundColor).toBe(0xfbfbf8);
  });

  it('keeps the preset clear colour without a viewer context', () => {
    const resolved = resolveFigureExportOptions('report');
    expect(resolved.transparent).toBe(false);
    expect(resolved.backgroundColor).toBe(getStylePreset('report').background.clearColor);
  });

  it('keeps transparency for presets that declare transparent publication figures', () => {
    const resolved = resolveFigureExportOptions('paper-light', {}, undefined, {
      background: { color: 0x123456, transparent: false }
    });
    expect(resolved.transparent).toBe(true);
  });

  it("honours an explicit background over 'transparent' and 'backgroundColor'", () => {
    const viewer = { background: { color: 0x202020, transparent: false } };
    expect(resolveFigureExportOptions('paper-light', { background: 'viewer' }, undefined, viewer))
      .toMatchObject({ transparent: false, backgroundColor: 0x202020 });
    expect(resolveFigureExportOptions('default', {
      background: 'transparent',
      transparent: false
    }, undefined, viewer)).toMatchObject({ transparent: true, backgroundColor: 0x202020 });
    expect(resolveFigureExportOptions('paper-light', {
      background: 0xabcdef,
      transparent: true,
      backgroundColor: 0x000000
    }, undefined, viewer)).toMatchObject({ transparent: false, backgroundColor: 0xabcdef });
  });

  it("'viewer' reproduces a transparent viewer canvas", () => {
    const resolved = resolveFigureExportOptions('default', { background: 'viewer' }, undefined, {
      background: { color: 0x000000, transparent: true }
    });
    expect(resolved.transparent).toBe(true);
  });

  it('still honours the legacy transparent/backgroundColor options', () => {
    expect(resolveFigureExportOptions('report', { transparent: true, backgroundColor: 0x111111 }))
      .toMatchObject({ transparent: true, backgroundColor: 0x111111 });
  });

  it.each([
    [-1],
    [0x1000000],
    [1.5],
    ['white' as never]
  ])('rejects background %s', background => {
    expect(() => resolveFigureExportOptions('default', { background })).toThrow();
  });
});

describe('figure export colour key', () => {
  it('describes the context layer instead of a generic viridis "Value" bar', () => {
    const resolved = resolveFigureExportOptions('report', {}, undefined, { colorbar: SOURCE });
    expect(resolved.colorbarLabel).toBe('Task activation (z)');
    expect(resolved.colorbarColors).toEqual(['rgb(255, 0, 0)', 'rgb(0, 0, 255)']);
    expect(resolved.colorbarRange).toEqual([-3, 5]);
    expect(resolved.colorbarThreshold).toEqual([-1, 1]);
    expect(resolved.colorbarCaps).toEqual({ low: false, high: true });
  });

  it('falls back to preset defaults without a layer', () => {
    const resolved = resolveFigureExportOptions('report', {}, undefined, { colorbar: null });
    expect(resolved.colorbarLabel).toBe('Value');
    expect(resolved.colorbarRange).toBeUndefined();
    expect(resolved.colorbarThreshold).toBeUndefined();
    expect(resolved.colorbarCaps).toEqual({ low: false, high: false });
  });

  it('lets explicit options override the layer', () => {
    const resolved = resolveFigureExportOptions('report', {
      colorbarLabel: 'z',
      colorbarRange: [0, 1],
      colorbarColors: ['#000', '#fff'],
      colorbarThreshold: null,
      colorbarCaps: { high: false, low: true }
    }, undefined, { colorbar: SOURCE });
    expect(resolved).toMatchObject({
      colorbarLabel: 'z',
      colorbarRange: [0, 1],
      colorbarColors: ['#000', '#fff'],
      colorbarCaps: { low: true, high: false }
    });
    expect(resolved.colorbarThreshold).toBeUndefined();
  });

  it('formats tick values compactly', () => {
    expect(formatColorbarTick(5)).toBe('5');
    expect(formatColorbarTick(-3.09016)).toBe('-3.09');
    expect(formatColorbarTick(0.0012345)).toBe('0.00123');
  });
});

describe('colormap sampling for keys', () => {
  it('ignores the threshold mask', () => {
    const map = new ColorMap(['#ff0000', '#0000ff'], { range: [0, 1], threshold: [0.2, 0.8] });
    expect(map.getColor(0.5)).toEqual([0, 0, 0, 0]);
    expect(map.getUnmaskedColor(0.5)).not.toEqual([0, 0, 0, 0]);
    expect(map.getUnmaskedColor(0.9)).toEqual(map.getColor(0.9));
  });

  it('samples a data layer colormap end to end across its range', () => {
    const layer = new DataLayer('map', [0, 1], null, ['#ff0000', '#00ff00', '#0000ff'], {
      range: [10, 20],
      threshold: [12, 18]
    });
    const samples = layer.sampleColorMap(5)!;
    expect(samples).toHaveLength(5);
    expect(samples[0]!.slice(0, 3)).toEqual([1, 0, 0]);
    expect(samples[4]!.slice(0, 3)).toEqual([0, 0, 1]);
    // The masked middle of the range still has its colour in the key.
    expect(samples[2]!.slice(0, 3)).toEqual([0, 1, 0]);
    expect(() => layer.sampleColorMap(1)).toThrow(RangeError);
  });
});

describe('colour keys for other scalar layers', () => {
  it('spans both scales of a dual-threshold statistical map', () => {
    const layer = new StatisticalMapLayer('stat', [3, -4, 0.5], null, 'viridis', {
      range: [-1, 1],
      threshold: [0, 0]
    });
    expect(layer.getColorKeyRange()).toEqual([-1, 1]);
    layer.setDualThreshold({
      positiveColorMap: 'hot',
      negativeColorMap: 'cool',
      positiveRange: [2, 6],
      negativeRange: [-6, -2]
    });
    expect(layer.getColorKeyRange()).toEqual([-6, 6]);
    const samples = layer.sampleColorMap(9)!;
    // Ends take the colours getRGBAData draws -6 and 6 with.
    const drawn = new StatisticalMapLayer('ref', [-6, 6], null, 'viridis', { threshold: [0, 0] });
    drawn.setDualThreshold({
      positiveColorMap: 'hot',
      negativeColorMap: 'cool',
      positiveRange: [2, 6],
      negativeRange: [-6, -2]
    });
    const rgba = drawn.getRGBAData(2);
    for (let channel = 0; channel < 3; channel++) {
      expect(samples[0]![channel]).toBeCloseTo(rgba[channel]!, 6);
      expect(samples[8]![channel]).toBeCloseTo(rgba[4 + channel]!, 6);
    }
    // Negative and positive ends use different colormaps.
    expect(samples[0]!.slice(0, 3)).not.toEqual(samples[8]!.slice(0, 3));
    layer.clearDualThreshold();
    expect(layer.getColorKeyRange()).toEqual([-1, 1]);
  });

  it('samples a volume projection layer colormap', () => {
    const layer = new VolumeProjectionLayer('vol', new Float32Array(8), [2, 2, 2], {
      worldToIJK: new THREE.Matrix4(),
      colormap: 'viridis',
      range: [0, 10],
      threshold: [2, 8]
    });
    const samples = layer.sampleColorMap(3);
    expect(samples).toHaveLength(3);
    expect(samples[1]![3] ?? 1).toBeGreaterThan(0);
    expect(layer.getColorKeyRange()).toEqual([0, 10]);
    expect(() => layer.sampleColorMap(0)).toThrow(RangeError);
  });
});

function overlayContext() {
  const gradient = { addColorStop: vi.fn() };
  const fills: Array<{ style: string; rect: number[] }> = [];
  const ctx = {
    canvas: { width: 1000, height: 800 },
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn((...rect: number[]) => fills.push({ style: String(ctx.fillStyle), rect })),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    createLinearGradient: vi.fn(() => gradient),
    fillStyle: '' as unknown,
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: '',
    textAlign: ''
  };
  return { ctx, gradient, fills };
}

describe('colour key drawing', () => {
  it('draws the layer colormap, a striped threshold band, its bounds and cap markers', () => {
    const { ctx, gradient, fills } = overlayContext();
    const resolved = resolveFigureExportOptions('report', {
      colorbar: true,
      roiLabels: false,
      scaleBar: false
    }, undefined, { colorbar: SOURCE });
    drawFigureOverlays(ctx as unknown as CanvasRenderingContext2D, resolved);

    expect(gradient.addColorStop).toHaveBeenCalledWith(0, 'rgb(255, 0, 0)');
    expect(gradient.addColorStop).toHaveBeenCalledWith(1, 'rgb(0, 0, 255)');
    const bar = fills.find(fill => fill.style === String(gradient))!;
    expect(bar).toBeDefined();
    const [, barTop, , barHeight] = bar.rect as [number, number, number, number];
    const yOf = (value: number) => barTop + barHeight - ((value + 3) / 8) * barHeight;

    // Neutral band over the masked interval [-1, 1].
    const band = fills.find(fill => fill.style === '#eef0f2')!;
    expect(band.rect[1]).toBeCloseTo(yOf(1), 6);
    expect(band.rect[1]! + band.rect[3]!).toBeCloseTo(yOf(-1), 6);
    expect(fills.filter(fill => fill.style === '#c4c8cc').length).toBeGreaterThan(1);

    // Tick labels: range ends and threshold bounds.
    const texts = ctx.fillText.mock.calls.map(call => call[0]);
    expect(texts).toEqual(expect.arrayContaining(['Task activation (z)', '5', '-3', '-1', '1']));
    expect(texts).not.toContain('Value');

    // One cap (high end), filled with the top colour.
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });

  it('draws both caps and no band when the key says so', () => {
    const { ctx, fills } = overlayContext();
    const resolved = resolveFigureExportOptions('report', {
      colorbar: true,
      roiLabels: false,
      scaleBar: false,
      colorbarThreshold: null,
      colorbarCaps: { low: true, high: true }
    }, undefined, { colorbar: SOURCE });
    drawFigureOverlays(ctx as unknown as CanvasRenderingContext2D, resolved);
    expect(fills.some(fill => fill.style === '#eef0f2')).toBe(false);
    expect(ctx.closePath).toHaveBeenCalledTimes(2);
  });
});

function geometry(): SurfaceGeometry {
  return new SurfaceGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3]),
    new Uint32Array([0, 1, 2, 0, 2, 3]),
    'left'
  );
}

interface ExportFixture {
  viewer: NeuroSurfaceViewer;
  surface: MultiLayerNeuroSurface;
  activation: DataLayer;
  variance: DataLayer;
}

function exportFixture(): ExportFixture {
  const viewer = Object.create(NeuroSurfaceViewer.prototype) as NeuroSurfaceViewer & Record<string, unknown>;
  let clearColor = 0xf3f5f5;
  let clearAlpha = 1;
  const domElement = document.createElement('canvas');
  viewer.renderer = {
    domElement,
    getSize: (target: THREE.Vector2) => target.set(800, 600),
    getPixelRatio: () => 1,
    setPixelRatio: vi.fn(),
    getClearColor: (target: THREE.Color) => target.setHex(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: vi.fn((color: THREE.ColorRepresentation, alpha = 1) => {
      clearColor = new THREE.Color(color).getHex();
      clearAlpha = alpha;
    })
  } as unknown as THREE.WebGLRenderer;
  viewer.container = { style: {} } as HTMLElement;
  viewer.width = 800;
  viewer.height = 600;
  viewer.camera = new THREE.PerspectiveCamera();
  viewer.stylePreset = getStylePreset('report');
  viewer.config = { preset: 'report' } as never;
  viewer.selectedLayerId = null;
  viewer.selectedSurfaceId = null;
  viewer.annotations = { list: () => [] } as never;
  viewer.resize = vi.fn() as never;
  viewer.render = vi.fn() as never;

  const surface = new MultiLayerNeuroSurface(geometry());
  const activation = new DataLayer('activation', new Float32Array([-4, 0.5, 2, 6]), null, ['#ff0000', '#0000ff'], {
    range: [-3, 5],
    threshold: [-1, 1],
    presentation: { label: 'Task activation', units: 'z' }
  });
  const variance = new DataLayer('variance', new Float32Array([1, 2, 3, 4]), null, 'magma', {
    range: [0, 4],
    presentation: { label: 'Variance' }
  });
  surface.addLayer(variance);
  surface.addLayer(activation);
  viewer.surfaces = new Map([['lh', surface]]);
  return { viewer, surface, activation, variance };
}

describe('NeuroSurfaceViewer figure colour key', () => {
  it('describes the top visible scalar layer by default', () => {
    const { viewer, surface } = exportFixture();
    try {
      const source = viewer.getFigureColorbarSource()!;
      expect(source.label).toBe('Task activation (z)');
      expect(source.range).toEqual([-3, 5]);
      expect(source.threshold).toEqual([-1, 1]);
      // Data run from -4 to 6, beyond both ends of the colour scale.
      expect(source.caps).toEqual({ low: true, high: true });
      expect(source.colors[0]).toBe('rgb(255, 0, 0)');
      expect(source.colors[source.colors.length - 1]).toBe('rgb(0, 0, 255)');
    } finally {
      surface.dispose();
    }
  });

  it('prefers the selected layer, skips hidden and non-scalar layers, and honours an explicit id', () => {
    const { viewer, surface, activation } = exportFixture();
    try {
      surface.addLayer(new RGBALayer('paint', new Float32Array(16)));
      viewer.selectedLayerId = 'variance';
      expect(viewer.getFigureColorbarSource()!.label).toBe('Variance');
      viewer.selectedLayerId = null;
      activation.setVisible(false);
      const variance = viewer.getFigureColorbarSource()!;
      expect(variance.label).toBe('Variance');
      expect(variance.threshold).toBeUndefined();
      expect(variance.caps).toEqual({ low: false, high: false });
      expect(viewer.getFigureColorbarSource('activation')!.label).toBe('Task activation (z)');
      expect(() => viewer.getFigureColorbarSource('paint')).toThrow(/No scalar layer/);
      expect(() => viewer.getFigureColorbarSource('missing')).toThrow(/No scalar layer/);
      surface.mesh!.visible = false;
      expect(viewer.getFigureColorbarSource()).toBeNull();
    } finally {
      surface.dispose();
    }
  });

  it('takes a shared layer id from the selected surface', () => {
    const { viewer, surface } = exportFixture();
    const right = new MultiLayerNeuroSurface(geometry());
    right.addLayer(new DataLayer('activation', new Float32Array([0, 1, 2, 3]), null, 'viridis', {
      range: [-8, 8],
      presentation: { label: 'Right activation' }
    }));
    (viewer.surfaces as Map<string, unknown>).set('rh', right);
    try {
      viewer.selectedLayerId = 'activation';
      viewer.selectedSurfaceId = 'rh';
      expect(viewer.getFigureColorbarSource()!.label).toBe('Right activation');
      expect(viewer.getFigureColorbarSource('activation')!.range).toEqual([-8, 8]);
      viewer.selectedSurfaceId = 'lh';
      expect(viewer.getFigureColorbarSource()!.label).toBe('Task activation (z)');
      viewer.selectedSurfaceId = null;
      expect(viewer.getFigureColorbarSource('activation')!.range).toEqual([-3, 5]);
    } finally {
      surface.dispose();
      right.dispose();
    }
  });

  it('exports opaque on the viewer background with the active layer key', () => {
    const { viewer, surface } = exportFixture();
    const { ctx, gradient, fills } = overlayContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ctx as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/png;base64,eA==');
    try {
      expect(viewer.exportPNG({ width: 1000, height: 800 })).toBe('data:image/png;base64,eA==');
      // Opaque ground in the viewer's own colour, painted before the render.
      expect(fills[0]).toEqual({ style: '#f3f5f5', rect: [0, 0, 1000, 800] });
      expect(viewer.renderer.setClearColor).toHaveBeenCalledWith(0xf3f5f5, 1);
      // No transparent-figure boundary.
      expect(ctx.strokeRect).not.toHaveBeenCalledWith(0.5, 0.5, 999, 799);
      const texts = ctx.fillText.mock.calls.map(call => call[0]);
      expect(texts).toContain('Task activation (z)');
      expect(texts).not.toContain('Value');
      expect(gradient.addColorStop).toHaveBeenCalledWith(0, 'rgb(255, 0, 0)');
      expect(fills.some(fill => fill.style === '#eef0f2')).toBe(true);
      expect(ctx.closePath).toHaveBeenCalledTimes(2);

      ctx.fillText.mockClear();
      fills.length = 0;
      viewer.exportPNG({ width: 1000, height: 800, background: 'transparent', colorbarLayer: 'variance' });
      expect(fills.some(fill => fill.style === '#f3f5f5')).toBe(false);
      expect(ctx.fillText.mock.calls.map(call => call[0])).toContain('Variance');
    } finally {
      surface.dispose();
    }
  });
});
