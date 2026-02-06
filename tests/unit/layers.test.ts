import { describe, it, expect } from 'vitest';
import { Layer, DataLayer, RGBALayer, BaseLayer, LayerStack } from '../../src/layers';

describe('DataLayer', () => {
  function makeDataLayer() {
    const data = new Float32Array([0, 0.5, 1.0, NaN, Infinity]);
    const indices = new Uint32Array([0, 1, 2, 3, 4]);
    return new DataLayer('test', data, indices, 'jet', { range: [0, 1] });
  }

  it('creates with valid data', () => {
    const layer = makeDataLayer();
    expect(layer.id).toBe('test');
    expect(layer.getData()).toBeInstanceOf(Float32Array);
  });

  it('getRGBAData returns correct length', () => {
    const layer = makeDataLayer();
    const rgba = layer.getRGBAData(5);
    expect(rgba.length).toBe(5 * 4);
  });

  it('skips NaN and Infinity values (alpha = 0)', () => {
    const layer = makeDataLayer();
    const rgba = layer.getRGBAData(5);
    // Vertex 3 (NaN) and vertex 4 (Infinity) should remain transparent
    expect(rgba[3 * 4 + 3]).toBe(0); // NaN vertex alpha
    expect(rgba[4 * 4 + 3]).toBe(0); // Infinity vertex alpha
  });

  it('valid values have non-zero alpha', () => {
    const layer = makeDataLayer();
    const rgba = layer.getRGBAData(5);
    // Vertex 0 (value=0) should have visible alpha
    expect(rgba[0 * 4 + 3]).toBeGreaterThan(0);
  });

  it('reuses cached buffer on repeated calls', () => {
    const layer = makeDataLayer();
    const rgba1 = layer.getRGBAData(5);
    const rgba2 = layer.getRGBAData(5);
    // Should be the same buffer instance (cached)
    expect(rgba1).toBe(rgba2);
  });

  it('respects opacity setting', () => {
    const layer = makeDataLayer();
    layer.setOpacity(0.5);
    const rgba = layer.getRGBAData(5);
    // Vertex 0 alpha should be scaled by 0.5
    expect(rgba[0 * 4 + 3]).toBeLessThanOrEqual(0.5);
  });

  it('throws on missing data', () => {
    expect(() => new DataLayer('test', null as any, null, 'jet')).toThrow();
  });
});

describe('RGBALayer', () => {
  it('creates from RGBA data', () => {
    const data = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]); // 2 vertices
    const layer = new RGBALayer('rgba-test', data);
    expect(layer.id).toBe('rgba-test');
  });

  it('validates data length is divisible by 4', () => {
    const bad = new Float32Array([1, 0, 0]); // Not divisible by 4
    expect(() => new RGBALayer('bad', bad)).toThrow();
  });

  it('getRGBAData returns correct data', () => {
    const data = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]);
    const layer = new RGBALayer('test', data);
    const rgba = layer.getRGBAData(2);
    expect(rgba[0]).toBeCloseTo(1);
    expect(rgba[4]).toBeCloseTo(0);
    expect(rgba[5]).toBeCloseTo(1);
  });
});

describe('BaseLayer', () => {
  it('returns constant color for all vertices', () => {
    const layer = new BaseLayer('base', { color: 0xff0000 });
    const rgba = layer.getRGBAData(3);
    expect(rgba.length).toBe(12);
    // All vertices should have the same color
    for (let i = 0; i < 3; i++) {
      expect(rgba[i * 4 + 3]).toBeGreaterThan(0); // Non-zero alpha
    }
  });
});

describe('LayerStack', () => {
  it('adds and retrieves layers', () => {
    const stack = new LayerStack();
    const data = new Float32Array([0, 0.5, 1]);
    const layer = new DataLayer('test', data, null, 'jet', { range: [0, 1] });
    stack.addLayer(layer);
    expect(stack.getLayer('test')).toBe(layer);
  });

  it('removes layers', () => {
    const stack = new LayerStack();
    const data = new Float32Array([0, 0.5, 1]);
    const layer = new DataLayer('test', data, null, 'jet', { range: [0, 1] });
    stack.addLayer(layer);
    expect(stack.removeLayer('test')).toBe(true);
    expect(stack.getLayer('test')).toBeUndefined();
  });

  it('returns false for removing non-existent layer', () => {
    const stack = new LayerStack();
    expect(stack.removeLayer('nope')).toBe(false);
  });

  it('reports correct layer count', () => {
    const stack = new LayerStack();
    const d1 = new DataLayer('a', new Float32Array([1]), null, 'jet');
    const d2 = new DataLayer('b', new Float32Array([2]), null, 'jet');
    stack.addLayer(d1);
    stack.addLayer(d2);
    expect(stack.getAllLayers().length).toBe(2);
  });
});
