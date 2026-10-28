import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { GeometryExecutor } from '../../../src/geometry/GeometryExecutor';
import { createGeodesicIndex, dilateSurfaceROI, erodeSurfaceROI } from '../../../src/geometry/GeodesicIndex';
import { evaluateSurfaceLocation, exportSurfaceLocations, importSurfaceLocations, triangleLocation } from '../../../src/geometry/SurfaceLocation';
import { DisplayGeometryBinding } from '../../../src/geometry/DisplayGeometryBinding';
import { buildSurfaceBoundaryGraph, traceBoundaryCurves } from '../../../src/geometry/SurfaceBoundaries';

function square() {
  const domain = new SurfaceDomain({ id: 'square', structure: 'left', vertexCount: 4, faces: [0, 1, 2, 0, 2, 3] });
  return new SurfaceMetric(domain, { positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], frame: 'test', units: 'mm' });
}

describe('surface attachments', () => {
  it('evaluates a known point and rejects different correspondence', async () => {
    const metric = square(), location = triangleLocation(metric.domain, 0, [0.25, 0.25, 0.5]);
    expect([...evaluateSurfaceLocation(location, metric)]).toEqual([0.75, 0.5, 0]);
    expect(() => evaluateSurfaceLocation(location, square())).toThrow(/domain/);
    const exported = await exportSurfaceLocations(metric.domain, [location]);
    expect(await importSurfaceLocations(metric.domain, exported)).toEqual([location]);
    expect(() => triangleLocation(metric.domain, 0, [1, 1, -1])).toThrow(/weights/);
  });
  it('evaluates GPU morph positions and invalidates cached vertices on weight changes', () => {
    const metric = square(), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(metric.copyPositions(), 3)); geometry.setIndex([...metric.domain.copyFaces()]);
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2], 3)];
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const binding = new DisplayGeometryBinding(metric.domain, mesh), location = triangleLocation(metric.domain, 0, [0.25, 0.25, 0.5]);
    mesh.morphTargetInfluences![0] = 0.5;
    expect([...evaluateSurfaceLocation(location, binding)]).toEqual([0.75, 0.5, 1]);
    mesh.morphTargetInfluences![0] = 1;
    expect([...evaluateSurfaceLocation(location, binding)]).toEqual([0.75, 0.5, 2]);
    expect(binding.locationAt(0, new THREE.Vector3(0.75, 0.5, 2))).toEqual(location);
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 4, 0, 0, 4, 0, 0, 4, 0, 0, 4], 3)];
    expect([...evaluateSurfaceLocation(location, binding)]).toEqual([0.75, 0.5, 4]);
    geometry.morphTargetsRelative = false;
    expect([...evaluateSurfaceLocation(location, binding)]).toEqual([0, 0, 4]);
  });
});

describe('shared boundary graph', () => {
  it('traces the interface inside triangles, with shared edge positions', () => {
    const metric = square(), graph = buildSurfaceBoundaryGraph(metric.domain, [1, 2, 2, 1], { background: 0 });
    const curves = traceBoundaryCurves(graph);
    expect(curves).toHaveLength(1);
    expect(curves[0]!.locations.map(p => [...evaluateSurfaceLocation(p, metric)])).toEqual([[0.5, 0, 0], [0.5, 0.5, 0], [0.5, 1, 0]]);
    expect(curves[0]!.closed).toBe(false);
    expect(curves[0]!.terminals).toEqual(['mesh-boundary', 'mesh-boundary']);
  });
  it('supports negative labels and triple junctions; updates equal fresh extraction', () => {
    const metric = square(), graph = buildSurfaceBoundaryGraph(metric.domain, [-1, 2, 3, -1], { background: 0 });
    expect(graph.segments()).toHaveLength(4);
    expect(traceBoundaryCurves(graph).some(c => c.terminals.includes('junction'))).toBe(true);
    expect(graph.updateLabels([{ vertex: 2, label: 2 }]).affectedFaces).toBe(2);
    const fresh = buildSurfaceBoundaryGraph(metric.domain, [-1, 2, 2, -1], { background: 0 });
    const positions = (g: typeof graph) => traceBoundaryCurves(g).map(c => c.locations.map(p => [...evaluateSurfaceLocation(p, metric)]));
    expect(positions(graph)).toEqual(positions(fresh));
  });
});

describe('intrinsic distances', () => {
  it('unfolds across the diagonal and reconstructs a surface path of analytic length', () => {
    const metric = square(), edge = createGeodesicIndex(metric, { method: 'edge' }), smooth = createGeodesicIndex(metric);
    expect(edge.shortestPath(1, 3).lengthMm).toBe(2);
    const path = smooth.shortestPath(1, 3);
    expect(path.lengthMm).toBeCloseTo(Math.sqrt(2), 12);
    expect(path.locations).toHaveLength(3);
    const p = path.locations.map(l => evaluateSurfaceLocation(l, metric));
    let sum = 0;
    for (let i = 1; i < p.length; i++) sum += Math.hypot(...p[i]!.map((x, j) => x - p[i - 1]![j]!));
    expect(sum).toBeCloseTo(path.lengthMm, 12);
    expect([...smooth.withinRadius([0], 1).vertices].sort()).toEqual([0, 1, 3]);
  });
  it('multi-source queries and vertex morphology preserve expected sets', () => {
    const index = createGeodesicIndex(square());
    expect([...index.distanceToRegion([0, 2])]).toEqual([0, 1, 0, 1]);
    expect([...dilateSurfaceROI(index, new Uint8Array([1, 0, 0, 0]), 1)]).toEqual([1, 1, 0, 1]);
    expect([...erodeSurfaceROI(index, new Uint8Array([1, 1, 1, 1]), 1)]).toEqual([1, 1, 1, 1]);
    expect([...erodeSurfaceROI(index, new Uint8Array([1, 1, 1, 1]), 1, 'outside-is-background')]).toEqual([0, 0, 0, 0]);
  });
  it('respects barriers even for triangle shortcuts', () => {
    const index = createGeodesicIndex(square(), { barrier: new Uint8Array([0, 1, 1, 1]) });
    expect(index.shortestPath(1, 3).lengthMm).toBe(2);
  });
});

describe('cooperative executor', () => {
  it('checks result revisions and bounded resource ownership', async () => {
    const e = new GeometryExecutor({ budgetBytes: 100, planBudgetBytes: 80 });
    const id = e.retain({ x: 1 }, 60); expect(e.resource(id)).toEqual({ x: 1 });
    expect(() => e.retain({}, 60)).toThrow(/budget/); e.release(id); expect(e.retainedBytes).toBe(0);
    let current = true;
    function* work() { current = false; yield; return 42; }
    await expect(e.run(work(), { isCurrent: () => current })).rejects.toMatchObject({ code: 'stale-input' });
    e.dispose(); await expect(e.run((function* () { return 1; })())).rejects.toMatchObject({ code: 'disposed' });
  });
  it('cancels before a job starts without executing its body', async () => {
    const e = new GeometryExecutor(), abort = new AbortController(); abort.abort(); let executed = false;
    await expect(e.run((function* () { executed = true; return 1; })(), { signal: abort.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(executed).toBe(false); e.dispose();
  });
});
