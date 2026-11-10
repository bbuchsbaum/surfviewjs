import { describe, it, expect } from 'vitest';
import { FlatMapChart } from '../../../src/flatmap/FlatMapChart';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { buildSurfaceRelief } from '../../../src/relief/SurfaceRelief';
import { computeFlatMapDistortion, flatMapAreaCalibration } from '../../../src/relief/FlatMapDistortion';

function plane(xy = [0, 0, 1, 0, 0, 1], heights = [2, 2, 2]) {
  const domain = new SurfaceDomain({ id: 'plane', structure: 'left', vertexCount: 3, faces: [0, 1, 2] });
  const white = new SurfaceMetric(domain, { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], units: 'mm', frame: 'test' });
  const pial = new SurfaceMetric(domain, { positions: [0, 0, heights[0]!, 1, 0, heights[1]!, 0, 1, heights[2]!], units: 'mm', frame: 'test' });
  const chart = new FlatMapChart({ domain, coordinates: xy, faces: [0, 1, 2], anatomicalVertices: [0, 1, 2], anatomicalFaces: [0], units: 'mm' });
  return { domain, white, pial, chart };
}

describe('anatomical relief and chart distortion', () => {
  it('parallel sheets give exact slab height, flat slopes and constant-preserving regularization', () => {
    const f = plane();
    for (const options of [{}, { regularizationFwhmMm: 1 }, { regularizationFwhmMm: 1, detrendFwhmMm: 2 }]) {
      const relief = buildSurfaceRelief(f.chart, f.white, f.pial, options);
      expect([...relief.copyRawHeightMm()]).toEqual([2, 2, 2]);
      relief.copyHeightMm().forEach(h => expect(h).toBeCloseTo(2, 13));
      const packed = relief.copyDisplayAttributes();
      for (let v = 0; v < 3; v++) {
        expect(packed[v * 3]).toBeCloseTo(2, 6);
        expect(packed[v * 3 + 1]).toBeCloseTo(0, 6); expect(packed[v * 3 + 2]).toBeCloseTo(0, 6);
      }
    }
  });

  it('height-field slopes reproduce independently measured finite differences', () => {
    const f = plane(undefined, [2, 2.3, 2.7]), relief = buildSurfaceRelief(f.chart, f.white, f.pial);
    const h = relief.copyHeightMm(), packed = relief.copyDisplayAttributes();
    for (let v = 0; v < 3; v++) {
      expect(packed[v * 3 + 1]).toBeCloseTo(h[1]! - h[0]!, 6);
      expect(packed[v * 3 + 2]).toBeCloseTo(h[2]! - h[0]!, 6);
    }
    const original = f.pial.copyPositions(); packed.fill(99);
    expect(f.pial.copyPositions()).toEqual(original);
    expect(relief.copyDisplayAttributes()[0]).not.toBe(99);
  });

  it('requires calibration and masks coincident white/pial support', () => {
    const f = plane();
    const chart = new FlatMapChart({ domain: f.domain, coordinates: [0, 0, 1, 0, 0, 1], faces: [0, 1, 2],
      anatomicalVertices: [0, 1, 2], anatomicalFaces: [0], units: 'arbitrary' });
    expect(() => buildSurfaceRelief(chart, f.white, f.pial)).toThrow(/calibration/);
    const relief = buildSurfaceRelief(chart, f.white, f.pial, { mmPerUnit: 2 });
    expect(relief.copyDisplayAttributes()[0]).toBe(1);
    expect([...buildSurfaceRelief(f.chart, f.white, f.white).copyValidity()]).toEqual([0, 0, 0]);
  });

  it('identity, scaling and shear have analytic area and singular-value ratios', () => {
    const identity = plane(), a = computeFlatMapDistortion(identity.chart, identity.white);
    expect(a.areaRatio[0]).toBe(1); expect(a.anisotropy[0]).toBe(1);
    const scale = plane([0, 0, 4, 0, 0, 2]), b = computeFlatMapDistortion(scale.chart, scale.white);
    expect(b.areaRatio[0]).toBe(8); expect(b.anisotropy[0]).toBe(2); expect(b.relativeAreaRatio[0]).toBe(1);
    expect(flatMapAreaCalibration(scale.chart, scale.white)).toBeCloseTo(1 / Math.sqrt(8), 14);
    const shear = plane([0, 0, 1, 0, 1, 1]), c = computeFlatMapDistortion(shear.chart, shear.white);
    expect(c.areaRatio[0]).toBe(1); expect(c.anisotropy[0]).toBeCloseTo((3 + Math.sqrt(5)) / 2, 13);
  });
});

it('uses the white/pial area-ratio folding formula without a hidden normalization', () => {
  const f = plane();
  const pial = new SurfaceMetric(f.domain, { positions: [0,0,1,2,0,1,0,2,1], units: 'mm', frame: 'test' });
  const relief = buildSurfaceRelief(f.chart, f.white, pial);
  expect(relief.copyRawHeightMm()[0]).toBeCloseTo(7 / 3, 13);
});

it('regularization cannot cross disconnected cut components', () => {
  const domain = new SurfaceDomain({ id: 'cut-components', structure: 'left', vertexCount: 6, faces: [0,1,2,3,4,5] });
  const xy = [0,0,1,0,0,1,1,0,2,0,2,1];
  const positions = (heights: number[]) => xy.flatMap((_, i) => i % 2 ? [] : [xy[i]!, xy[i + 1]!, heights[i / 2]!]);
  const white = new SurfaceMetric(domain, { positions: positions([0,0,0,0,0,0]), units: 'mm', frame: 'test' });
  const pial = new SurfaceMetric(domain, { positions: positions([1,1,1,5,5,5]), units: 'mm', frame: 'test' });
  const chart = new FlatMapChart({ domain, coordinates: xy, faces: domain.copyFaces(), anatomicalVertices: [0,1,2,3,4,5], anatomicalFaces: [0,1], units: 'mm' });
  const heights = buildSurfaceRelief(chart, white, pial, { regularizationFwhmMm: 100 }).copyHeightMm();
  [1,1,1,5,5,5].forEach((h, i) => expect(heights[i]).toBeCloseTo(h, 13));
});
