import { describe, expect, it } from 'vitest';
import { ColorMap } from '../../src/ColorMap';
import { DataLayer } from '../../src/layers';
import { CurvatureLayer } from '../../src/layers/CurvatureLayer';
import { getStylePreset } from '../../src/StylePresets';

describe('cortical contrast rendering', () => {
  it('exposes dense heat palettes as reversible named choices', () => {
    const colors = ColorMap.getPresetMaps()['surface-heat'];
    expect(colors).toHaveLength(256);
    expect(colors?.[0]).toEqual([0, 1, 1]);
    expect(colors?.[127]).toEqual([0, 0, 1]);
    expect(colors?.[128]).toEqual([1, 0, 0]);
    expect(colors?.[255]).toEqual([1, 1, 0]);
    expect(ColorMap.getPresetMaps()['surface-heat-positive']).toHaveLength(256);
  });
  it('maps centered anatomical values to both gray levels', () => {
    const style = getStylePreset('freesurfer');
    const layer = new CurvatureLayer('anatomy', [-0.5, 0, 0.5], style.curvature);
    const rgba = layer.getRGBAData(3);
    expect([rgba[0], rgba[4], rgba[8]]).toEqual([0.25, 0.5, 0.75]);
    expect([rgba[3], rgba[7], rgba[11]]).toEqual([1, 1, 1]);
    expect(style.lighting.rimStrength).toBe(0);
  });

  it('leaves layer opacity for the compositor to apply exactly once', () => {
    const layer = new DataLayer('map', new Float32Array([1]), null,
      ['#ff0000', '#ff0000'], { range: [0, 1], opacity: 0.5 });
    const rgba = layer.getRGBAData(1);
    expect(rgba[3]).toBe(1);
    // Half-opaque red over an opaque 0.5-gray underlay has this independent
    // source-over result, not the 0.25-alpha result of double attenuation.
    expect(rgba[0] * layer.opacity + 0.5 * (1 - layer.opacity)).toBe(0.75);
    expect(rgba[1] * layer.opacity + 0.5 * (1 - layer.opacity)).toBe(0.25);
  });
});
