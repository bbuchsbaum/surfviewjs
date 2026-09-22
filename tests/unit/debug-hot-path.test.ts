import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ColorMap from '../../src/ColorMap';
import { setDebug } from '../../src/debug';
import { DataLayer, RGBALayer } from '../../src/layers';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { SurfaceGeometry } from '../../src/classes';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  setDebug(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('disabled debug hot paths', () => {
  it('does not format an extra scalar sample', () => {
    const colorMap = new ColorMap([[0, 0, 0], [1, 1, 1]], { range: [0, 1] });
    const getColor = vi.spyOn(colorMap, 'getColor');
    const layer = new DataLayer(
      'data',
      new Float32Array([0.1, 0.5, 0.9]),
      new Uint32Array([0, 1, 2]),
      colorMap
    );

    setDebug(false);
    layer.getRGBAData(3);
    expect(getColor).toHaveBeenCalledTimes(3);

    getColor.mockClear();
    setDebug(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    layer.getRGBAData(3);
    expect(getColor).toHaveBeenCalledTimes(4);
  });

  it('does not slice or scan layer output solely for diagnostics', () => {
    const geometry = new SurfaceGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      'lh'
    );
    const rgba = new Float32Array([
      1, 0, 0, 1,
      0, 1, 0, 1,
      0, 0, 1, 1
    ]);
    const slice = vi.spyOn(rgba, 'slice');
    const surface = new MultiLayerNeuroSurface(geometry);
    surface.addLayer(new RGBALayer('rgba', rgba));
    surface.createMesh();
    slice.mockClear();

    setDebug(false);
    surface.updateColors();
    expect(slice).not.toHaveBeenCalled();

    setDebug(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    surface.updateColors();
    expect(slice).toHaveBeenCalledOnce();
    surface.dispose();
  });
});
