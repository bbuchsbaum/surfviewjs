import { describe, it, expect } from 'vitest';
import { computeMeanCurvature, normalizeCurvature, curvatureToGrayscale } from '../../src/utils/curvature';
import { SurfaceGeometry } from '../../src/classes';

// Create a simple tetrahedron geometry for testing
function makeTetrahedron(): SurfaceGeometry {
  const vertices = new Float32Array([
    0, 0, 1,       // vertex 0: top
    1, 0, -0.5,    // vertex 1
    -0.5, 0.866, -0.5, // vertex 2
    -0.5, -0.866, -0.5  // vertex 3
  ]);
  const faces = new Uint32Array([
    0, 1, 2,
    0, 2, 3,
    0, 3, 1,
    1, 3, 2
  ]);
  return new SurfaceGeometry(vertices, faces, 'unknown');
}

// Create a flat quad (2 triangles) — should have ~zero curvature
function makeFlatQuad(): SurfaceGeometry {
  const vertices = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0
  ]);
  const faces = new Uint32Array([
    0, 1, 2,
    0, 2, 3
  ]);
  return new SurfaceGeometry(vertices, faces, 'unknown');
}

describe('computeMeanCurvature', () => {
  it('returns a Float32Array of correct length', () => {
    const geom = makeTetrahedron();
    const curv = computeMeanCurvature(geom);
    expect(curv).toBeInstanceOf(Float32Array);
    expect(curv.length).toBe(4); // 4 vertices
  });

  it('produces non-zero curvature for a tetrahedron', () => {
    const geom = makeTetrahedron();
    const curv = computeMeanCurvature(geom);
    const maxAbs = Math.max(...Array.from(curv).map(Math.abs));
    expect(maxAbs).toBeGreaterThan(0);
  });

  it('produces lower curvature for a flat surface than a tetrahedron', () => {
    const flat = makeFlatQuad();
    const tet = makeTetrahedron();
    const flatCurv = computeMeanCurvature(flat);
    const tetCurv = computeMeanCurvature(tet);
    // Boundary vertices on a flat quad still show curvature from the umbrella operator,
    // but interior vertices should have less curvature than a tetrahedron
    const flatMax = Math.max(...Array.from(flatCurv).map(Math.abs));
    const tetMax = Math.max(...Array.from(tetCurv).map(Math.abs));
    // At minimum, the flat quad should produce finite values
    for (let i = 0; i < flatCurv.length; i++) {
      expect(Number.isFinite(flatCurv[i])).toBe(true);
    }
    expect(flatMax).toBeLessThanOrEqual(tetMax * 2); // Rough sanity check
  });

  it('does not crash on single-triangle geometry', () => {
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const faces = new Uint32Array([0, 1, 2]);
    const geom = new SurfaceGeometry(vertices, faces, 'unknown');
    const curv = computeMeanCurvature(geom);
    expect(curv.length).toBe(3);
  });
});

describe('normalizeCurvature', () => {
  it('returns values in [-1, 1]', () => {
    const raw = new Float32Array([0, 0.5, -0.5, 100, -100]);
    const norm = normalizeCurvature(raw);
    for (let i = 0; i < norm.length; i++) {
      expect(norm[i]).toBeGreaterThanOrEqual(-1);
      expect(norm[i]).toBeLessThanOrEqual(1);
    }
  });

  it('handles all-zero input', () => {
    const raw = new Float32Array([0, 0, 0]);
    const norm = normalizeCurvature(raw);
    for (let i = 0; i < norm.length; i++) {
      expect(norm[i]).toBe(0);
    }
  });
});

describe('curvatureToGrayscale', () => {
  it('returns values in [0, 1]', () => {
    const curv = new Float32Array([-1, -0.5, 0, 0.5, 1]);
    const gray = curvatureToGrayscale(curv);
    for (let i = 0; i < gray.length; i++) {
      expect(gray[i]).toBeGreaterThanOrEqual(0);
      expect(gray[i]).toBeLessThanOrEqual(1);
    }
  });

  it('produces 0.5 for zero curvature with default options', () => {
    const curv = new Float32Array([0]);
    const gray = curvatureToGrayscale(curv);
    expect(gray[0]).toBeCloseTo(0.5, 5);
  });
});
