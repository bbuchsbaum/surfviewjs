import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildParcelMapMesh, flattenParcelMap, ParcelMapOptimizer, DEFAULT_PARCEL_MAP_PARAMETERS } from '../../src/puzzle/ParcelMap';
import { parseGIfTISurface } from '../../src/loaders';
import type { ParcelPuzzleInput } from '../../src/puzzle/buildParcelPuzzle';

function fixture(size = 9): ParcelPuzzleInput {
  const vertices: number[] = [], faces: number[] = [], vertexLabels: number[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    vertices.push(x / (size - 1), y / (size - 1), 0.15 * Math.sin(x / 2) * Math.cos(y / 3));
    vertexLabels.push(1 + Math.min(2, Math.floor(x * 3 / size)) + 3 * Math.min(2, Math.floor(y * 3 / size)));
    if (x < size - 1 && y < size - 1) {
      const a = y * size + x; faces.push(a, a + 1, a + size + 1, a, a + size + 1, a + size);
    }
  }
  return { vertices, faces, vertexLabels, parcelData: { schema_version: '1.0.0', atlas: { id: 'test', name: 'Test', n_parcels: 9 },
    parcels: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, label: `P${i + 1}`, hemi: null })) } };
}

// Independent determinant and polygon shoelace calculations (not solver metrics).
function checkMap(mesh: ReturnType<typeof buildParcelMapMesh>, uv: Float64Array): void {
  let sum = 0;
  for (let i = 0; i < mesh.faces.length; i += 3) {
    const [a, b, c] = Array.from(mesh.faces.slice(i, i + 3), v => [uv[2 * v]!, uv[2 * v + 1]!]);
    const area = ((b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!)) / 2;
    expect(area).toBeGreaterThan(0); sum += area;
  }
  let boundaryArea = 0;
  mesh.boundary.forEach((a, i) => { const b = mesh.boundary[(i + 1) % mesh.boundary.length]!;
    boundaryArea += (uv[a * 2]! * uv[b * 2 + 1]! - uv[b * 2]! * uv[a * 2 + 1]!) / 2;
  });
  expect(sum).toBeCloseTo(boundaryArea, 10);
}

describe('parcel map experiment', () => {
  it('builds a single shared disk and solves the positive harmonic system', async () => {
    const mesh = buildParcelMapMesh(fixture());
    expect(mesh.positions.length / 3 - mesh.edges.length + mesh.faces.length / 3).toBe(1);
    const uv = await flattenParcelMap(mesh);
    checkMap(mesh, uv);
    const boundary = new Set(mesh.boundary);
    mesh.neighbors.forEach((neighbors, i) => {
      if (boundary.has(i)) return;
      for (const axis of [0, 1]) {
        let weighted = 0, mass = 0;
        neighbors.forEach((w, j) => { weighted += w * uv[j * 2 + axis]!; mass += w; });
        expect(Math.abs(uv[i * 2 + axis]! - weighted / mass)).toBeLessThan(1e-8);
      }
    });
  });

  it('matches independent central differences for every objective component', async () => {
    const mesh = buildParcelMapMesh(fixture(6)), uv = await flattenParcelMap(mesh), boundary = new Set(mesh.boundary);
    for (const [angleWeight, areaWeight, compactnessWeight] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, 2, 0.7]]) {
      const optimizer = new ParcelMapOptimizer(mesh, uv, { ...DEFAULT_PARCEL_MAP_PARAMETERS, angleWeight: angleWeight!, areaWeight: areaWeight!, compactnessWeight: compactnessWeight! });
      const analytic = optimizer.objectiveGradient(), h = 1e-6;
      for (let i = 0; i < uv.length; i += 3) {
        if (boundary.has(Math.floor(i / 2))) continue;
        optimizer.coordinates[i]! += h; const plus = optimizer.measure().objective;
        optimizer.coordinates[i]! -= 2 * h; const minus = optimizer.measure().objective;
        optimizer.coordinates[i]! += h;
        const numerical = (plus - minus) / (2 * h);
        expect(Math.abs(analytic[i]! - numerical)).toBeLessThan(2e-5 * Math.max(1, Math.abs(numerical)));
      }
    }
  });

  it('descends monotonically without moving the boundary or changing the mesh, including extreme weights', async () => {
    const mesh = buildParcelMapMesh(fixture()), uv = await flattenParcelMap(mesh), originalFaces = mesh.faces.slice();
    const optimizer = new ParcelMapOptimizer(mesh, uv);
    for (const [equalArea, angleWeight, compactnessWeight] of [[0, 0.3, 0], [1, 0, 20], [0.5, 20, 20]]) {
      optimizer.setParameters({ ...DEFAULT_PARCEL_MAP_PARAMETERS, equalArea: equalArea!, angleWeight: angleWeight!, compactnessWeight: compactnessWeight! });
      let previous = optimizer.measure().objective;
      for (let i = 0; i < 12; i++) {
        const step = optimizer.step();
        expect(step.metrics.objective).toBeLessThanOrEqual(previous + 1e-12); previous = step.metrics.objective;
        checkMap(mesh, optimizer.coordinates);
      }
    }
    mesh.boundary.forEach(i => { expect(optimizer.coordinates[2 * i]).toBe(uv[2 * i]); expect(optimizer.coordinates[2 * i + 1]).toBe(uv[2 * i + 1]); });
    expect(mesh.faces).toEqual(originalFaces);
    expect(optimizer.coordinates).not.toEqual(uv);
    optimizer.reset(); expect(optimizer.coordinates).toEqual(uv);
    const bad = uv.slice(); bad[mesh.boundary[0]! * 2]! += 0.1;
    expect(() => optimizer.restore(bad)).toThrow(/boundary/);
    expect(() => optimizer.setParameters({ ...DEFAULT_PARCEL_MAP_PARAMETERS, equalArea: NaN })).toThrow();
  });

  it('supports cancellation and rejects a closed surface', async () => {
    const mesh = buildParcelMapMesh(fixture()), controller = new AbortController(); controller.abort();
    await expect(flattenParcelMap(mesh, { signal: controller.signal })).rejects.toThrow();
    const input = fixture(); input.faces = [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2];
    expect(() => buildParcelMapMesh(input)).toThrow();
  });

  it('rejects a double-covered disk despite positive local triangle areas', () => {
    const vertices = [0, 0, 0], faces: number[] = [];
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; vertices.push(Math.cos(a), Math.sin(a), 0); faces.push(0, i + 1, (i + 1) % 8 + 1); }
    const input: ParcelPuzzleInput = { vertices, faces, vertexLabels: new Array(9).fill(1),
      parcelData: { schema_version: '1.0.0', atlas: { id: 'fan', name: 'Fan', n_parcels: 1 }, parcels: [{ id: 1, label: 'Fan', hemi: null }] } };
    const mesh = buildParcelMapMesh(input), uv = new Float64Array(mesh.positions.length / 3 * 2);
    for (let i = 0; i < uv.length / 2; i++) {
      const x = mesh.positions[i * 3]!, y = mesh.positions[i * 3 + 1]!;
      if (Math.hypot(x, y) > 0) { const angle = 2 * Math.atan2(y, x); uv[i * 2] = Math.cos(angle); uv[i * 2 + 1] = Math.sin(angle); }
    }
    expect(() => new ParcelMapOptimizer(mesh, uv)).toThrow(/simple convex boundary/);
  });

  it('qualifies the real Schaefer and Glasser partitions and records actual solver behavior', async () => {
    const surface = parseGIfTISurface(readFileSync('tests/data/fs_LR.32k.L.inflated.surf.gii', 'utf8'), new JSDOM().window.DOMParser);
    for (const path of ['schaefer/left-fslr32k-7networks', 'glasser/left-fslr32k']) {
      const data = JSON.parse(readFileSync(`demo/data/${path}.json`, 'utf8'));
      const mesh = buildParcelMapMesh({ vertices: surface.vertices, faces: surface.faces, vertexLabels: data.vertexLabels, parcelData: data });
      const start = performance.now(), uv = await flattenParcelMap(mesh);
      const optimizer = new ParcelMapOptimizer(mesh, uv), before = optimizer.measure();
      for (let i = 0; i < 10; i++) optimizer.step();
      const after = optimizer.measure();
      expect(after.objective).toBeLessThan(before.objective);
      expect(after.flippedTriangles).toBe(0);
      checkMap(mesh, optimizer.coordinates);
      console.info(JSON.stringify({ atlas: path, vertices: mesh.positions.length / 3, boundary: mesh.boundary.length,
        seconds: (performance.now() - start) / 1000, before: { angle: before.angleDistortion, area: before.areaError, compactness: before.meanCompactness },
        after: { angle: after.angleDistortion, area: after.areaError, compactness: after.meanCompactness } }));
    }
  }, 60000);
});
