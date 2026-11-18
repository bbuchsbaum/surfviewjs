import { describe, expect, it, vi } from 'vitest';
import { DataLayer, VolumeProjectionLayer } from '../../src/layers';
import { thresholdFadeAlpha } from '../../src/layers/thresholdFade';

describe('threshold fade', () => {
  it('ramps each signed tail and reaches full opacity at the cutoffs', () => {
    const band = [-3.1, 3.1] as const;
    for (const sign of [-1, 1]) {
      expect(thresholdFadeAlpha(sign, band, { from: 1 })).toBe(0);
      expect(0.7 * thresholdFadeAlpha(sign * 2, band, { from: 1 })).toBeCloseTo(0.3333, 4);
      expect(0.7 * thresholdFadeAlpha(sign * 2, band, { from: 1, curve: 'quadratic' })).toBeCloseTo(0.1587, 4);
      expect(thresholdFadeAlpha(sign * 3.1, band, { from: 1 })).toBe(1);
      expect(thresholdFadeAlpha(sign * 4, band, { from: 1 })).toBe(1);
    }
  });

  it('supports asymmetric and one-sided bands, degenerate ramps, and inactive bands', () => {
    expect(thresholdFadeAlpha(-1.5, [-2, 3], { from: 1, curve: 'quadratic' })).toBe(0.25);
    expect(thresholdFadeAlpha(2, [-2, 3], { from: 1, curve: 'quadratic' })).toBe(0.25);
    expect(thresholdFadeAlpha(15, [10, 20], { from: 0 })).toBe(0.5);
    expect(thresholdFadeAlpha(-15, [-20, -10], { from: 0 })).toBe(0.5);
    expect(thresholdFadeAlpha(9, [10, 20], { from: 0 })).toBe(1);
    expect(thresholdFadeAlpha(10, [10, 20], { from: 0 })).toBe(0);
    expect(thresholdFadeAlpha(1.9, [-1, 2], { from: 2 })).toBe(0);
    expect(thresholdFadeAlpha(2, [-1, 2], { from: 2 })).toBe(1);
    expect(thresholdFadeAlpha(0, [0, 0], { from: 0 })).toBe(1);
    expect(thresholdFadeAlpha(NaN, [-1, 2], { from: 0 })).toBe(0);
  });

  it('uses intrinsic alpha on sparse DataLayer samples and leaves values available for inspection', () => {
    const layer = new DataLayer('map', [-1.5, 2, NaN, 3.5], [0, 2, 3, 4], [
      [1, 0, 0, 0.5], [0, 1, 0, 0.5]
    ], {
      range: [-4, 4], threshold: [-2, 3], opacity: 0.7,
      thresholdFade: { from: 1, curve: 'quadratic' }, magnitudeOpacity: { low: 4 }
    });
    const rgba = () => layer.getRGBAData(5);
    const alpha = () => {
      const colors = rgba();
      return [3, 7, 11, 15, 19].map(i => colors[i]!);
    };
    expect(alpha()).toEqual([0.125, 0, 0.125, 0, 0.5]);
    expect(layer.sampleValueAtVertex(2)).toBe(2);
    expect(layer.opacity).toBe(0.7);
    expect(layer.getThreshold()).toEqual([-2, 3]);
    expect(rgba()[0]).toBe(1);
    layer.setRange([-10, -2]);
    expect(rgba()[0]).toBe(0);
    expect(alpha()).toEqual([0.125, 0, 0.125, 0, 0.5]);
    expect(layer.writeThresholdEdgeAttributes(5, new Float32Array(20), new Float32Array(5))).toBe(false);
    expect(layer.writeThresholdEdgeOffsets(5, new Float32Array(5))).toBeNull();

    expect(() => layer.update({ threshold: [0, 0], thresholdFade: { from: Infinity } })).toThrow(/thresholdFade.from/);
    expect(() => layer.update({ thresholdFade: { from: 0, curve: 'invalid' as 'linear' } })).toThrow(/thresholdFade.curve/);
    expect(layer.getThreshold()).toEqual([-2, 3]);
    layer.update({ threshold: [0, 0] });
    expect(alpha()).toEqual([0, 0, 0, 0, 0]); // Inactive fade leaves magnitude opacity in control.
    layer.update({ threshold: [-2, 3], thresholdFade: null, magnitudeOpacity: null });
    expect(alpha()).toEqual([0, 0, 0, 0, 0.5]);
  });

  it('recolours the existing CPU projection and keeps fill values and missing samples transparent', () => {
    const layer = new VolumeProjectionLayer('volume', [10, 15, NaN, 20, 999], [5, 1, 1], {
      colormap: [[1, 1, 1, 0.5], [1, 1, 1, 0.5]],
      threshold: [10, 20], fillValue: 999
    });
    const vertices = Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]);
    layer.attach({ geometry: { vertices } });
    const sample = vi.spyOn(layer as unknown as { sampleValueAtWorldCoordinates: () => unknown }, 'sampleValueAtWorldCoordinates');
    const alpha = () => Array.from(layer.getRGBAData(5)).filter((_, i) => i % 4 === 3);
    const texture = layer.getVolumeTexture().texture;
    const version = texture.version;
    expect(alpha()).toEqual([0, 0, 0, 0, 0]);
    expect(sample).toHaveBeenCalledTimes(5);
    layer.update({ thresholdFade: { from: 0 } });
    expect(alpha()).toEqual([0, 0.25, 0, 0.5, 0]);
    expect(sample).toHaveBeenCalledTimes(5);
    expect(layer.getVolumeTexture().texture).toBe(texture);
    expect(texture.version).toBe(version);
    expect(layer.sampleValueAtVertex(1)).toBe(15);

    vertices[3] = 3;
    layer.setThresholdFade({ from: 0, curve: 'quadratic' });
    expect(alpha()).toEqual([0, 0.5, 0, 0.5, 0]);
    layer.updateVolumeData([10, 15, NaN, 15, 999]);
    layer.update({ thresholdFade: { from: 0 } });
    expect(alpha()).toEqual([0, 0.25, 0, 0.25, 0]);

    const fadeState = layer.toStateJSON();
    layer.setThresholdFade(null);
    expect(alpha()).toEqual([0, 0, 0, 0, 0]);
    layer.fromStateJSON(fadeState);
    expect(alpha()).toEqual([0, 0.25, 0, 0.25, 0]);
  });
});
