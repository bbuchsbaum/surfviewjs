import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { evaluateSurfaceLocation } from '../../../src/geometry/SurfaceLocation';
import { getDisplayGeometryBinding } from '../../../src/geometry/DisplayGeometryBinding';
import { pickNearestVertexOnFace } from '../../../src/utils/GPUPicker';
import { FlatMapChart } from '../../../src/flatmap/FlatMapChart';
import { FlatMapField } from '../../../src/flatmap/FlatMapFieldMaterial';
import { FlatMapSurfaceBinding } from '../../../src/flatmap/FlatMapSurfaceBinding';
import { buildSurfaceRelief } from '../../../src/relief/SurfaceRelief';
import { ColorMap } from '../../../src/ColorMap';

function fixture() {
  const domain = new SurfaceDomain({ id: 'cut', structure: 'left', vertexCount: 4, faces: [0, 1, 2, 1, 3, 2] });
  const white = new SurfaceMetric(domain, { positions: [0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0], units: 'mm', frame: 'test' });
  const pial = new SurfaceMetric(domain, { positions: [0, 0, 2, 2, 0, 2, 0, 2, 2, 2, 2, 2], units: 'mm', frame: 'test' });
  const chart = new FlatMapChart({ domain, coordinates: [2, 0, 0, 2, 2, 2], faces: [0, 2, 1], anatomicalVertices: [1, 2, 3], anatomicalFaces: [1], units: 'mm' });
  const field = new FlatMapField({ colorMap: new ColorMap(['#000000', '#ffffff'], { range: [0, 1] }) });
  const relief = buildSurfaceRelief(chart, white, pial), surface = new FlatMapSurfaceBinding(chart, pial, field, { relief });
  return { domain, chart, field, surface, pial };
}

describe('cut relief display correspondence', () => {
  it('keeps CPU raycasts, GPU refinement and canonical anchors on the deformed triangle', () => {
    const { chart, field, surface, pial } = fixture(), mesh = surface.mesh!;
    const original = pial.copyPositions(), location = chart.location(0, [0.25, 0.5, 0.25]);
    for (const [fold, exaggeration] of [[0, 4], [0.5, 2], [1, 0], [1, 3]]) {
      surface.setDeformation(fold!, exaggeration!, true); mesh.updateMatrixWorld(true);
      const binding = getDisplayGeometryBinding(mesh), point = new THREE.Vector3().fromArray(evaluateSurfaceLocation(location, binding));
      // Analytic endpoints: anatomical z=2, plane z=0, uniform slab relief h=2.
      expect(point.z).toBeCloseTo(2 * (1 - fold!) + 2 * fold! * exaggeration!, 6);
      const ray = new THREE.Ray(point.clone().add(new THREE.Vector3(0, 0, 10)), new THREE.Vector3(0, 0, -1));
      const hits = new THREE.Raycaster(ray.origin, ray.direction).intersectObject(mesh);
      expect(hits).toHaveLength(1);
      expect(binding.locationAt(0, hits[0]!.point)).toEqual(location);
      expect(pickNearestVertexOnFace(mesh, 0, ray).point!.distanceTo(point)).toBeLessThan(1e-6);
      expect(surface.display.anatomicalVertex(2)).toBe(3);
    }
    expect(pial.copyPositions()).toEqual(original);
    surface.dispose(); surface.dispose(); expect(field.isDisposed).toBe(false); field.dispose();
  });

  it('rejects invalid deformations before modifying the current snapshot', () => {
    const { surface, field } = fixture(); const state = surface.display.state, revision = surface.display.revision;
    expect(() => surface.setDeformation(2)).toThrow(); expect(() => surface.setDeformation(1, Infinity)).toThrow();
    expect(surface.display.state).toEqual(state); expect(surface.display.revision).toBe(revision);
    surface.dispose(); field.dispose();
  });
});
