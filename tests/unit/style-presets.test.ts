import { describe, expect, it } from 'vitest';
import {
  getStylePreset,
  listStylePresets,
  resolveFigureExportOptions,
  resolveStylePreset,
  STYLE_PRESETS
} from '../../src/StylePresets';

describe('style presets', () => {
  it('exposes publication and talk presets with scientific display controls', () => {
    expect(listStylePresets()).toEqual(expect.arrayContaining([
      'paper-light',
      'talk-dark',
      'clinical-qc',
      'retinotopy',
      'glass-brain-surface'
    ]));

    const paper = getStylePreset('paper-light');
    expect(paper.background.clearAlpha).toBe(1);
    expect(paper.curvature.contrast).toBeGreaterThan(0);
    expect(paper.roi.strokeWidth).toBeGreaterThan(0);
    expect(paper.roi.labelDensity).toBe('sparse');
    expect(paper.colormaps.diverging).toBe('RdBu');
    expect(paper.figure.transparent).toBe(true);
    expect(paper.figure.colorbar).toBe(true);
    expect(paper.figure.scaleBar).toBe(true);
  });

  it('returns defensive copies of preset definitions', () => {
    const first = getStylePreset('talk-dark');
    first.figure.width = 1;
    first.lighting.directionalPosition[0] = 99;

    const second = getStylePreset('talk-dark');
    expect(second.figure.width).toBe(STYLE_PRESETS['talk-dark'].figure.width);
    expect(second.lighting.directionalPosition[0]).toBe(STYLE_PRESETS['talk-dark'].lighting.directionalPosition[0]);
  });

  it('resolves custom presets without mutating the input object', () => {
    const custom = getStylePreset('clinical-qc');
    custom.name = 'clinical-qc';
    custom.figure.width = 1024;

    const resolved = resolveStylePreset(custom);
    resolved.figure.width = 512;

    expect(custom.figure.width).toBe(1024);
  });

  it('merges figure export options with preset defaults', () => {
    const resolved = resolveFigureExportOptions('paper-light', {
      width: 3200,
      transparent: false,
      roiLabels: [{ text: 'V1', x: 0.25, y: 0.4, normalized: true }],
      colorbarRange: [-2.3, 2.3]
    });

    expect(resolved.width).toBe(3200);
    expect(resolved.height).toBe(1800);
    expect(resolved.dpi).toBe(300);
    expect(resolved.transparent).toBe(false);
    expect(resolved.colorbar).toBe(true);
    expect(resolved.scaleBar).toBe(true);
    expect(resolved.roiLabels).toEqual([{ text: 'V1', x: 0.25, y: 0.4, normalized: true }]);
    expect(resolved.colorbarRange).toEqual([-2.3, 2.3]);
  });

  it('rejects invalid figure dimensions', () => {
    expect(() => resolveFigureExportOptions('default', { width: 0 })).toThrow(/width/);
    expect(() => resolveFigureExportOptions('default', { fontScale: -1 })).toThrow(/fontScale/);
  });
});
