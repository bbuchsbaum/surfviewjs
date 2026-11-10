import { describe, expect, it } from 'vitest';
import { FlatMapChart } from '../../../src/flatmap/FlatMapChart';
import { buildFlatMapRaster } from '../../../src/flatmap/FlatMapRasterPlan';
import { SurfaceDomain } from '../../../src/geometry/SurfaceDomain';
import { triangleLocation, vertexLocation } from '../../../src/geometry/SurfaceLocation';

export function squareChart(): FlatMapChart {
  const domain = new SurfaceDomain({ id: 'square', structure: 'left', vertexCount: 4, faces: [0, 1, 2, 0, 2, 3] });
  return new FlatMapChart({ domain, coordinates: [0, 0, 1, 0, 1, 1, 0, 1], faces: domain.copyFaces(),
    anatomicalVertices: [0, 1, 2, 3], anatomicalFaces: [0, 1], units: 'mm' });
}

describe('cut-chart correspondence and rasterization', () => {
  it('maps an analytic barycentric point and round-trips its original face', () => {
    const chart = squareChart(), hit = chart.locate(0.75, 0.25)!;
    expect(hit.chartFace).toBe(0);
    expect(hit.weights).toEqual([0.25, 0.5, 0.25]);
    expect(chart.chartPoints(hit.location)).toEqual([[0.75, 0.25]]);
    expect(chart.locate(2, 0)).toBeNull();
    expect(chart.locate(0.5, 0.5)!.chartFace).toBe(0);
  });

  it('supports seam copies, omitted faces and permuted corners without changing identity', () => {
    const { domain } = squareChart();
    const chart = new FlatMapChart({ domain, coordinates: [0, 0, 1, 0, 1, 1, 2, 0, 3, 1, 2, 1],
      faces: [1, 2, 0, 3, 4, 5], anatomicalVertices: [0, 1, 2, 0, 2, 3], anatomicalFaces: [0, 1], units: 'arbitrary' });
    expect(chart.locate(0.75, 0.25)!.location).toEqual(triangleLocation(domain, 0, [0.25, 0.5, 0.25]));
    expect(chart.chartPoints(vertexLocation(domain, 0))).toEqual([[0, 0], [2, 0]]);
    expect(chart.locate(1.5, 0.5)).toBeNull();
    const cut = new FlatMapChart({ domain, coordinates: [0, 0, 1, 0, 1, 1, 0, 1], faces: [0, 1, 2],
      anatomicalVertices: [0, 1, 2, 3], anatomicalFaces: [0], units: 'mm' });
    expect(cut.chartPoints(triangleLocation(domain, 1, [0.2, 0.3, 0.5]))).toEqual([]);
    expect(cut.chartPoints(vertexLocation(domain, 3))).toEqual([]);
  });

  it('rejects same-sized but incorrect correspondence and noninteger indices', () => {
    const { domain } = squareChart();
    const input = { domain, coordinates: [0, 0, 1, 0, 1, 1, 0, 1], faces: [0, 1, 2], anatomicalVertices: [0, 1, 2, 3], anatomicalFaces: [1], units: 'mm' as const };
    expect(() => new FlatMapChart(input)).toThrow(/does not match/);
    expect(() => new FlatMapChart({ ...input, anatomicalFaces: [0], faces: [0, 1.2, 2] })).toThrow();
  });

  it('rejects folds and independent positive-area overlaps; accepts reflected charts', () => {
    const { domain } = squareChart();
    expect(() => new FlatMapChart({ domain, coordinates: [0, 0, 1, 0, 1, 1, 1, 0], faces: domain.copyFaces(),
      anatomicalVertices: [0, 1, 2, 3], anatomicalFaces: [0, 1], units: 'mm' })).toThrow(/Folded/);
    const reflected = new FlatMapChart({ domain, coordinates: [0, 0, -1, 0, -1, 1, 0, 1], faces: domain.copyFaces(),
      anatomicalVertices: [0, 1, 2, 3], anatomicalFaces: [0, 1], units: 'mm' });
    expect(reflected.locate(-0.75, 0.25)!.weights).toEqual([0.25, 0.5, 0.25]);
    expect(() => new FlatMapChart({ domain, coordinates: [0, 0, 1, 0, 1, 1, 0.1, 0, 1.1, 0, 1.1, 1],
      faces: [0, 1, 2, 3, 4, 5], anatomicalVertices: [0, 1, 2, 0, 2, 3], anatomicalFaces: [0, 1], units: 'mm' })).toThrow(/Overlapping/);
  });

  it('owns snapshots and rejects unreasonable budgets', () => {
    const chart = squareChart(), copy = chart.copyCoordinates(); copy.fill(999);
    expect(chart.locate(0.5, 0.25)).not.toBeNull();
    expect(() => new FlatMapChart({ domain: chart.domain, coordinates: copy, faces: chart.copyFaces(),
      anatomicalVertices: [0, 1, 2, 3], anatomicalFaces: [0, 1], units: 'mm', budgetBytes: 1 })).toThrow(/budget/);
  });

  it('stitched tiles equal the full raster and affine fields reproduce pixel centers', () => {
    const chart = squareChart(), grid = { bounds: chart.bounds, width: 8, height: 8 };
    const full = buildFlatMapRaster(chart, grid, { x: 0, y: 0, width: 8, height: 8 });
    const corners = [0, 1, 3, 2]; // f(x,y)=x+2y
    for (let tx = 0; tx < 8; tx += 4) {
      const tile = buildFlatMapRaster(chart, grid, { x: tx, y: 0, width: 4, height: 8 });
      for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
        const i = y * 4 + x, j = y * 8 + tx + x;
        expect(tile.faces[i]).toBe(full.faces[j]);
        expect([...tile.weights.subarray(i * 3, i * 3 + 3)]).toEqual([...full.weights.subarray(j * 3, j * 3 + 3)]);
        const face = chart.domain.triangle(tile.faces[i]!);
        const value = face.reduce((sum, v, k) => sum + corners[v]! * tile.weights[i * 3 + k]!, 0);
        expect(value).toBeCloseTo((tx + x + 0.5) / 8 + 2 * (1 - (y + 0.5) / 8), 13);
      }
    }
  });
});
