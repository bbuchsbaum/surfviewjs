import { describe, expect, it } from 'vitest';
import { DataLayer } from '../../src/layers';
import { magnitudeOpacityAt, normalizeMagnitudeOpacity } from '../../src/layers/magnitudeOpacity';

const none: [number, number] = [0, 0];

describe('magnitudeOpacityAt', () => {
  it('fades an unthresholded map linearly from zero to the range end', () => {
    const spec = normalizeMagnitudeOpacity({})!;
    expect(magnitudeOpacityAt(0, spec, [-4, 4], none)).toBe(0);
    expect(magnitudeOpacityAt(2, spec, [-4, 4], none)).toBeCloseTo(0.5);
    expect(magnitudeOpacityAt(-1, spec, [-4, 4], none)).toBeCloseTo(0.25);
    expect(magnitudeOpacityAt(9, spec, [-4, 4], none)).toBe(1);
  });

  it('matches neuroim2 ramp with a floor above a threshold, per sign', () => {
    const spec = normalizeMagnitudeOpacity({ floor: 0.6 })!;
    // Asymmetric mask: positives shown from 2, negatives from -1.
    expect(magnitudeOpacityAt(1.5, spec, [-4, 4], [-1, 2])).toBe(0);
    expect(magnitudeOpacityAt(2, spec, [-4, 4], [-1, 2])).toBeCloseTo(0.6);
    expect(magnitudeOpacityAt(3, spec, [-4, 4], [-1, 2])).toBeCloseTo(0.8);
    expect(magnitudeOpacityAt(-2.5, spec, [-4, 4], [-1, 2])).toBeCloseTo(0.6 + 0.4 * 0.5);
  });

  it('applies a knee, gamma and fixed saturation point', () => {
    const spec = normalizeMagnitudeOpacity({ low: 1, high: 3, gamma: 2 })!;
    expect(magnitudeOpacityAt(0.9, spec, [-5, 5], none)).toBe(0);
    expect(magnitudeOpacityAt(2, spec, [-5, 5], none)).toBeCloseTo(0.25);
    expect(magnitudeOpacityAt(4, spec, [-5, 5], none)).toBe(1);
  });

  it('rejects invalid specs', () => {
    expect(() => normalizeMagnitudeOpacity({ gamma: 0 })).toThrow(RangeError);
    expect(() => normalizeMagnitudeOpacity({ low: 2, high: 1 })).toThrow(RangeError);
    expect(() => normalizeMagnitudeOpacity({ floor: 2 })).toThrow(RangeError);
    expect(normalizeMagnitudeOpacity(null)).toBeNull();
  });
});

describe('DataLayer magnitude opacity', () => {
  it('multiplies per-vertex alpha and follows live range changes', () => {
    const layer = new DataLayer('m', [0, 1, -2, 4], null, ['#0000ff', '#ffffff', '#ff0000'], {
      range: [-4, 4],
      magnitudeOpacity: {}
    });
    const alpha = (rgba: Float32Array) => [3, 7, 11, 15].map(i => rgba[i]!);
    expect(alpha(layer.getRGBAData(4))).toEqual([0, 0.25, 0.5, 1]);
    layer.setRange([-2, 2]);
    expect(alpha(layer.getRGBAData(4))).toEqual([0, 0.5, 1, 1]);
    layer.update({ magnitudeOpacity: null });
    expect(alpha(layer.getRGBAData(4))).toEqual([1, 1, 1, 1]);
    expect(layer.getMagnitudeOpacity()).toBeNull();
  });
});
