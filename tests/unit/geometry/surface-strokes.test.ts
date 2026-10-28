import { describe, expect, it } from 'vitest';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { evaluateSurfaceLocation, evaluateSurfaceStrokePoint, triangleLocation } from '../../../src/geometry/SurfaceLocation';
import { SurfacePolyline } from '../../../src/geometry/SurfacePolyline';

describe('folded surface strokes', () => {
  const domain = new SurfaceDomain({ id: 'fold', structure: 'test', vertexCount: 4, faces: [0, 1, 2, 1, 0, 3] });
  const metric = new SurfaceMetric(domain, { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1], frame: 'mm', units: 'mm' });
  it('lifts the shared edge outside both face planes regardless of face ownership', () => {
    const a = triangleLocation(domain, 0, [0.5, 0.5, 0]), b = triangleLocation(domain, 1, [0.5, 0.5, 0]);
    const p = evaluateSurfaceStrokePoint(a, metric, 0.2);
    expect(p[2]).toBeCloseTo(0.2, 12);
    expect((p[1]! - p[2]!) / Math.sqrt(2)).toBeCloseTo(0.2, 12);
    expect([...evaluateSurfaceStrokePoint(b, metric, 0.2)]).toEqual([...p]);
    expect([...evaluateSurfaceLocation(a, metric)]).toEqual([0.5, 0, 0]);
  });
  it('reuses line buffers as embedding changes, retaining depth occlusion', () => {
    const locations = [triangleLocation(domain, 0, [0.5, 0.5, 0]), triangleLocation(domain, 0, [0.5, 0, 0.5])];
    const line = new SurfacePolyline(locations); line.updateBinding(metric);
    const start = line.geometry.getAttribute('instanceStart');
    const shifted = new SurfaceMetric(domain, { positions: metric.copyPositions().map((x, i) => i % 3 === 2 ? x + 2 : x), frame: 'mm', units: 'mm' });
    line.updateBinding(shifted);
    expect(line.geometry.getAttribute('instanceStart')).toBe(start);
    expect(start.getZ(0)).toBeCloseTo(2.2, 6);
    expect(line.material.depthTest).toBe(true); expect(line.material.depthWrite).toBe(false);
    expect(line.material.linewidth).toBe(2); line.dispose();
  });
});
