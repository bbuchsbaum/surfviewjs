import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  Layer,
  DataLayer,
  RGBALayer,
  BaseLayer,
  LabelLayer,
  TwoDataLayer,
  VolumeProjectionLayer,
  LayerStack
} from '../../src/layers';

// ---------------------------------------------------------------------------
// TwoDataLayer
// ---------------------------------------------------------------------------
describe('TwoDataLayer', () => {
  function makeTwoDataLayer() {
    return new TwoDataLayer(
      'two',
      new Float32Array([0.2, 0.5, 0.8]),
      new Float32Array([0.1, 0.5, 0.9]),
      null,
      'confidence',
      { rangeX: [0, 1], rangeY: [0, 1] }
    );
  }

  it('creates with valid data', () => {
    const layer = makeTwoDataLayer();
    expect(layer.id).toBe('two');
    expect(layer.is2DLayer).toBe(true);
  });

  it('getRGBAData returns correct length', () => {
    const layer = makeTwoDataLayer();
    const rgba = layer.getRGBAData(3);
    expect(rgba.length).toBe(12);
  });

  it('produces non-transparent values for valid data', () => {
    const layer = makeTwoDataLayer();
    const rgba = layer.getRGBAData(3);
    // At least some vertices should be visible
    let hasVisible = false;
    for (let i = 0; i < 3; i++) {
      if (rgba[i * 4 + 3] > 0) hasVisible = true;
    }
    expect(hasVisible).toBe(true);
  });

  it('throws on mismatched X/Y lengths', () => {
    expect(() => new TwoDataLayer(
      'bad',
      new Float32Array([1, 2]),
      new Float32Array([1, 2, 3]),
      null,
      'confidence'
    )).toThrow('same length');
  });

  it('throws on missing data', () => {
    expect(() => new TwoDataLayer(
      'bad',
      null as any,
      new Float32Array([1]),
      null,
      'confidence'
    )).toThrow();
  });

  it('respects opacity', () => {
    const layer = makeTwoDataLayer();
    layer.setOpacity(0.5);
    const rgba = layer.getRGBAData(3);
    for (let i = 0; i < 3; i++) {
      expect(rgba[i * 4 + 3]).toBeLessThanOrEqual(0.5);
    }
  });

  it('range getters return copies', () => {
    const layer = makeTwoDataLayer();
    const rx = layer.getRangeX();
    rx[0] = 999;
    expect(layer.getRangeX()[0]).not.toBe(999);
  });
});

// ---------------------------------------------------------------------------
// LabelLayer
// ---------------------------------------------------------------------------
describe('LabelLayer', () => {
  function makeLabelLayer() {
    return new LabelLayer('labels', {
      labels: new Uint32Array([1, 2, 1, 3]),
      labelDefs: [
        { id: 1, color: 0xff0000 },
        { id: 2, color: 0x00ff00 },
        { id: 3, color: 0x0000ff }
      ]
    });
  }

  it('creates with valid options', () => {
    const layer = makeLabelLayer();
    expect(layer.id).toBe('labels');
  });

  it('throws without labels', () => {
    expect(() => new LabelLayer('bad', { labelDefs: [] } as any)).toThrow();
  });

  it('throws without labelDefs', () => {
    expect(() => new LabelLayer('bad', { labels: new Uint32Array([1]) } as any)).toThrow();
  });

  it('getRGBAData returns correct length', () => {
    const layer = makeLabelLayer();
    const rgba = layer.getRGBAData(4);
    expect(rgba.length).toBe(16);
  });

  it('maps label IDs to correct colors', () => {
    const layer = makeLabelLayer();
    const rgba = layer.getRGBAData(4);
    // Vertex 0 has label 1 (red)
    expect(rgba[0]).toBeCloseTo(1.0, 1); // R
    expect(rgba[1]).toBeCloseTo(0.0, 1); // G
    expect(rgba[2]).toBeCloseTo(0.0, 1); // B
    expect(rgba[3]).toBe(1.0);           // A

    // Vertex 1 has label 2 (green)
    expect(rgba[4]).toBeCloseTo(0.0, 1);
    expect(rgba[5]).toBeCloseTo(1.0, 1);
  });

  it('uses default color for unknown labels', () => {
    const layer = new LabelLayer('l', {
      labels: new Uint32Array([999]),
      labelDefs: [{ id: 1, color: 0xff0000 }],
      defaultColor: 0x808080
    });
    const rgba = layer.getRGBAData(1);
    // THREE.Color applies sRGB linearization; just verify R=G=B (gray)
    expect(rgba[0]).toBeGreaterThan(0);
    expect(rgba[0]).toBeLessThan(1);
    expect(rgba[0]).toBeCloseTo(rgba[1], 5);
    expect(rgba[1]).toBeCloseTo(rgba[2], 5);
  });

  it('caches RGBA buffer', () => {
    const layer = makeLabelLayer();
    const a = layer.getRGBAData(4);
    const b = layer.getRGBAData(4);
    expect(a).toBe(b); // Same reference
  });
});

// ---------------------------------------------------------------------------
// VolumeProjectionLayer - singularity regression test (Phase 4 fix)
// ---------------------------------------------------------------------------
describe('VolumeProjectionLayer', () => {
  it('throws on singular affine matrix', () => {
    // A singular matrix: all zeros except bottom-right
    const singular = new THREE.Matrix4().set(
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 1
    );
    expect(() => new VolumeProjectionLayer(
      'vol',
      new Float32Array(8), // 2x2x2 volume
      [2, 2, 2],
      { affineMatrix: singular }
    )).toThrow(/singular/i);
  });

  it('creates with valid voxel size', () => {
    const layer = new VolumeProjectionLayer(
      'vol',
      new Float32Array(27), // 3x3x3
      [3, 3, 3],
      { voxelSize: [1, 1, 1], volumeOrigin: [0, 0, 0] }
    );
    expect(layer.id).toBe('vol');
  });

  it('creates with explicit worldToIJK', () => {
    const m = new THREE.Matrix4();
    const layer = new VolumeProjectionLayer(
      'vol',
      new Float32Array(8),
      [2, 2, 2],
      { worldToIJK: m }
    );
    expect(layer.getWorldToIJK()).toBeInstanceOf(THREE.Matrix4);
  });
});

// ---------------------------------------------------------------------------
// Layer.fromConfig factory - comprehensive coverage
// ---------------------------------------------------------------------------
describe('Layer.fromConfig', () => {
  it('throws without type', () => {
    expect(() => Layer.fromConfig({ id: 'x' })).toThrow('type and id');
  });

  it('throws without id', () => {
    expect(() => Layer.fromConfig({ type: 'base' })).toThrow('type and id');
  });

  it('creates base layer', () => {
    const layer = Layer.fromConfig({ type: 'base', id: 'b', color: 0xaabbcc });
    expect(layer).toBeInstanceOf(BaseLayer);
  });

  it('creates rgba layer', () => {
    const data = new Float32Array([1, 0, 0, 1]);
    const layer = Layer.fromConfig({ type: 'rgba', id: 'r', data });
    expect(layer).toBeInstanceOf(RGBALayer);
  });

  it('creates data layer', () => {
    const layer = Layer.fromConfig({
      type: 'data',
      id: 'd',
      data: new Float32Array([0, 1]),
      cmap: 'jet',
      range: [0, 1]
    });
    expect(layer).toBeInstanceOf(DataLayer);
  });

  it('creates label layer', () => {
    const layer = Layer.fromConfig({
      type: 'label',
      id: 'lbl',
      labels: [1, 2],
      labelDefs: [{ id: 1, color: 0xff0000 }, { id: 2, color: 0x00ff00 }]
    });
    expect(layer).toBeInstanceOf(LabelLayer);
  });

  it('creates twodata layer', () => {
    const layer = Layer.fromConfig({
      type: 'twodata',
      id: 'td',
      dataX: new Float32Array([0, 1]),
      dataY: new Float32Array([0, 1]),
      cmap: 'confidence'
    });
    expect(layer).toBeInstanceOf(TwoDataLayer);
  });

  it('creates volume layer', () => {
    const layer = Layer.fromConfig({
      type: 'volume',
      id: 'v',
      volumeData: new Float32Array(8),
      dims: [2, 2, 2]
    });
    expect(layer).toBeInstanceOf(VolumeProjectionLayer);
  });

  it('throws for unsupported type', () => {
    expect(() => Layer.fromConfig({ type: 'nope', id: 'x' })).toThrow('Unsupported');
  });

  it('respects opacity alias (alpha)', () => {
    const layer = Layer.fromConfig({ type: 'base', id: 'b', alpha: 0.3 });
    expect(layer.opacity).toBeCloseTo(0.3, 2);
  });
});

// ---------------------------------------------------------------------------
// LayerStack - extended coverage
// ---------------------------------------------------------------------------
describe('LayerStack extended', () => {
  it('getVisibleLayers filters invisible layers', () => {
    const stack = new LayerStack();
    const a = new DataLayer('a', new Float32Array([1]), null, 'jet');
    const b = new DataLayer('b', new Float32Array([2]), null, 'jet');
    b.setVisible(false);
    stack.addLayer(a);
    stack.addLayer(b);
    const visible = stack.getVisibleLayers();
    expect(visible.length).toBe(1);
    expect(visible[0].id).toBe('a');
  });

  it('updateLayer propagates changes', () => {
    const stack = new LayerStack();
    const layer = new DataLayer('d', new Float32Array([0]), null, 'jet', { range: [0, 1] });
    stack.addLayer(layer);
    stack.updateLayer('d', { range: [0, 10] });
    expect(stack.needsComposite).toBe(true);
  });

  it('clear disposes all layers', () => {
    const stack = new LayerStack();
    const layer = new DataLayer('d', new Float32Array([0]), null, 'jet');
    stack.addLayer(layer);
    stack.clear();
    expect(stack.getAllLayers().length).toBe(0);
  });

  it('setLayerOrder reorders layers', () => {
    const stack = new LayerStack();
    const a = new DataLayer('a', new Float32Array([1]), null, 'jet', { order: 2 });
    const b = new DataLayer('b', new Float32Array([2]), null, 'jet', { order: 1 });
    stack.addLayer(a);
    stack.addLayer(b);
    // Default order should be b before a (by order property)
    const visible = stack.getVisibleLayers();
    expect(visible[0].id).toBe('b');
    expect(visible[1].id).toBe('a');

    // Override
    stack.setLayerOrder(['a', 'b']);
    const reordered = stack.getVisibleLayers();
    expect(reordered[0].id).toBe('a');
  });
});
