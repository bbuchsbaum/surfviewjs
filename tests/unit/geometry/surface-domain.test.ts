import { describe, expect, it } from 'vitest';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';

export function square() {
  const domain = new SurfaceDomain({ id: 'square', structure: 'left', vertexCount: 4, faces: [0, 1, 2, 0, 2, 3] });
  const metric = new SurfaceMetric(domain, { positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], frame: 'test', units: 'mm' });
  return { domain, metric };
}

describe('surface computation snapshots', () => {
  it('owns arrays and exposes copies; computes compact topology', () => {
    const faces = [0, 1, 2, 0, 2, 3];
    const domain = new SurfaceDomain({ id: 'x', structure: 'left', vertexCount: 5, faces });
    faces[0] = 4; domain.copyFaces()[0] = 4;
    expect(domain.triangle(0)).toEqual([0, 1, 2]);
    expect([...domain.topology.neighbors(0)]).toEqual([1, 2, 3]);
    expect([...domain.topology.incidentFaces(2)]).toEqual([0, 1]);
    expect(domain.topology.edgeCount).toBe(5);
    expect(domain.topology.componentCount).toBe(2);
    expect(domain.topology.isBoundary(0)).toBe(true);
    expect(domain.topology.inconsistentEdges).toBe(0);
    expect(domain.topology.component(4)).not.toBe(domain.topology.component(0));
  });
  it('binds fingerprints to topology, domain metadata, frame and positions', async () => {
    const { domain, metric } = square();
    const a = await domain.fingerprint();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await square().domain.fingerprint()).toBe(a);
    const p = metric.copyPositions(); p[0] = -1;
    const other = new SurfaceMetric(domain, { positions: p, frame: 'test', units: 'mm' });
    expect(await other.fingerprint()).not.toBe(await metric.fingerprint());
    expect(metric.position(0)).toEqual(new Float64Array([0, 0, 0]));
  });
  it('rejects repeated/duplicate faces, invalid indices and excessive storage before construction', () => {
    const build = (faces: number[], budgetBytes?: number) => new SurfaceDomain({ id: 'x', structure: 'left', vertexCount: 4, faces, ...(budgetBytes ? { budgetBytes } : {}) });
    expect(() => build([0, 0, 1])).toThrow(/Repeated/);
    expect(() => build([0, 1, 2, 2, 1, 0])).toThrow(/Duplicate/);
    expect(() => build([0, -1, 2])).toThrow(/outside/);
    expect(() => build([0, 1, 2], 10)).toThrow(/budget/);
    expect(() => new SurfaceMetric(square().domain, { positions: new Float64Array(12), frame: 'test', units: 'mm' })).toThrow(/Invalid face/);
  });
  it('detects winding and nonmanifold edges without conflating disconnected components', () => {
    const wound = new SurfaceDomain({ id: 'w', structure: 'left', vertexCount: 4, faces: [0, 1, 2, 0, 3, 2] });
    expect(wound.topology.inconsistentEdges).toBe(1);
    expect(() => wound.topology.requireManifold(true)).toThrow(/wound/);
    const nonmanifold = new SurfaceDomain({ id: 'n', structure: 'left', vertexCount: 5, faces: [0, 1, 2, 1, 0, 3, 0, 1, 4] });
    expect(nonmanifold.topology.nonManifoldEdges).toBe(1);
    expect(() => nonmanifold.topology.requireManifold()).toThrow(/non-manifold/);
    const bowtie = new SurfaceDomain({ id: 'bowtie', structure: 'synthetic', vertexCount: 5, faces: [0, 1, 2, 0, 3, 4] });
    expect(bowtie.topology.nonManifoldEdges).toBe(0);
    expect(bowtie.topology.nonManifoldVertices).toBe(1);
    expect(() => bowtie.topology.requireManifold()).toThrow(/non-manifold vertices/);
  });
});
