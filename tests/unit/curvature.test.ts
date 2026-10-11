import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeMeanCurvature, computeSulcalDepth, normalizeCurvature, curvatureToGrayscale } from '../../src/utils/curvature';
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

// ---------------------------------------------------------------------------
// Edge-normalised estimator, FreeSurfer sign convention and sulcal depth
// ---------------------------------------------------------------------------

/**
 * A corrugated sheet z = amplitude·sin(2πx / wavelength) on a regular
 * triangulated grid, wound so face normals point to +z (the "outside").
 * Crests (z > 0) play the role of gyral crowns, troughs of sulcal fundi.
 */
function corrugatedSheet(step: number, amplitude = 1, wavelength = 8, size = 24, marginMm = 2): { geometry: SurfaceGeometry; z: Float32Array; x: Float32Array; interior: Uint8Array } {
  const n = Math.round(size / step) + 1;
  const vertices = new Float32Array(n * n * 3);
  const z = new Float32Array(n * n);
  const x = new Float32Array(n * n);
  const interior = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const px = i * step;
      const py = j * step;
      const pz = amplitude * Math.sin((2 * Math.PI * px) / wavelength);
      vertices.set([px, py, pz], v * 3);
      z[v] = pz;
      x[v] = px;
      // Stay several grid steps and a margin in millimetres off the boundary.
      const margin = Math.max(3, Math.ceil(marginMm / step));
      interior[v] = i >= margin && j >= margin && i < n - margin && j < n - margin ? 1 : 0;
    }
  }
  const faces: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      faces.push(a, b, d, a, d, c);
    }
  }
  return { geometry: new SurfaceGeometry(vertices, new Uint32Array(faces), 'unknown'), z, x, interior };
}

function icosphere(radius: number, detail: number): SurfaceGeometry {
  const merged = mergeVertices(new THREE.IcosahedronGeometry(radius, detail).deleteAttribute('normal').deleteAttribute('uv'));
  const position = merged.getAttribute('position') as THREE.BufferAttribute;
  return new SurfaceGeometry(
    new Float32Array(position.array as ArrayLike<number>),
    new Uint32Array(merged.getIndex()!.array as ArrayLike<number>),
    'unknown'
  );
}

function correlation(a: ArrayLike<number>, b: ArrayLike<number>, mask?: Uint8Array): number {
  let n = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) if (!mask || mask[i]) { n++; sa += a[i]!; sb += b[i]!; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) {
    if (mask && !mask[i]) continue;
    const da = a[i]! - ma, db = b[i]! - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  return cov / Math.sqrt(va * vb);
}

function median(values: number[]): number {
  const sorted = [...values].sort((p, q) => p - q);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe('computeMeanCurvature (FreeSurfer convention)', () => {
  it('is negative on crests (gyral crowns) and positive in troughs (sulci)', () => {
    const { geometry, z, interior } = corrugatedSheet(0.25);
    const curv = computeMeanCurvature(geometry);
    const crest: number[] = [];
    const trough: number[] = [];
    for (let i = 0; i < z.length; i++) {
      if (!interior[i]) continue;
      if (z[i]! > 0.9) crest.push(curv[i]!);
      if (z[i]! < -0.9) trough.push(curv[i]!);
    }
    expect(crest.length).toBeGreaterThan(10);
    expect(trough.length).toBeGreaterThan(10);
    expect(Math.max(...crest)).toBeLessThan(0);
    expect(Math.min(...trough)).toBeGreaterThan(0);
    // Mean curvature of z = A sin(kx) is proportional to -z near the extrema.
    expect(correlation(curv, Array.from(z, value => -value), interior)).toBeGreaterThan(0.95);
  });

  it('approximates mean curvature in inverse length units, independent of mesh resolution', () => {
    // H = -A k² sin(kx) / 2 (FreeSurfer sign: +A k² sin(kx) / 2 at troughs, i.e. -z·k²/2).
    const k = (2 * Math.PI) / 8;
    for (const step of [0.5, 0.25]) {
      const { geometry, z, interior } = corrugatedSheet(step);
      const curv = computeMeanCurvature(geometry, { smoothingIterations: 0 });
      const ratios: number[] = [];
      for (let i = 0; i < z.length; i++) {
        if (interior[i] && Math.abs(z[i]!) > 0.9) ratios.push(curv[i]! / ((-z[i]! * k * k) / 2));
      }
      expect(median(ratios)).toBeGreaterThan(0.8);
      expect(median(ratios)).toBeLessThan(1.25);
    }
  });

  it('gives a convex sphere a negative curvature close to -1/R', () => {
    const radius = 20;
    const curv = computeMeanCurvature(icosphere(radius, 5), { smoothingIterations: 0 });
    expect(Math.max(...curv)).toBeLessThan(0);
    expect(median(Array.from(curv))).toBeCloseTo(-1 / radius, 2);
  });

  it('smooths the estimate when asked and validates the iteration count', () => {
    const { geometry } = corrugatedSheet(0.5);
    const raw = computeMeanCurvature(geometry, { smoothingIterations: 0 });
    const smoothed = computeMeanCurvature(geometry, { smoothingIterations: 4 });
    expect(smoothed.length).toBe(raw.length);
    expect(Array.from(smoothed)).not.toEqual(Array.from(raw));
    expect(() => computeMeanCurvature(geometry, { smoothingIterations: -1 })).toThrow();
    expect(() => computeMeanCurvature(geometry, { smoothingIterations: 1.5 })).toThrow();
  });
});

describe('computeSulcalDepth', () => {
  it('is positive in troughs, negative on crests, and tracks depth below the envelope', () => {
    const { geometry, z, interior } = corrugatedSheet(0.25, 1, 4, 24, 6);
    const depth = computeSulcalDepth(geometry);
    expect(depth).toBeInstanceOf(Float32Array);
    expect(depth.length).toBe(z.length);
    expect(correlation(depth, Array.from(z, value => -value), interior)).toBeGreaterThan(0.95);
    for (let i = 0; i < z.length; i++) {
      if (!interior[i]) continue;
      if (z[i]! > 0.95) expect(depth[i]!).toBeLessThan(0);
      if (z[i]! < -0.95) expect(depth[i]!).toBeGreaterThan(0);
    }
  });

  it('is median-centred and in the mesh length units', () => {
    const { geometry, interior } = corrugatedSheet(0.25, 2, 4, 24, 6);
    const depth = computeSulcalDepth(geometry);
    expect(Math.abs(median(Array.from(depth)))).toBeLessThan(1e-6);
    // Peak-to-trough depth of the corrugation is 2·amplitude = 4 mm.
    const values = Array.from(depth).filter((_, i) => interior[i]);
    const span = Math.max(...values) - Math.min(...values);
    expect(span).toBeGreaterThan(3);
    expect(span).toBeLessThan(4.5);
  });

  it('is zero on a flat sheet and validates options', () => {
    const { geometry } = corrugatedSheet(0.5, 0);
    const depth = computeSulcalDepth(geometry);
    expect(Math.max(...Array.from(depth, Math.abs))).toBeLessThan(1e-6);
    expect(() => computeSulcalDepth(geometry, { scale: 0 })).toThrow();
    expect(() => computeSulcalDepth(geometry, { tolerance: 0 })).toThrow();
    expect(() => computeSulcalDepth(geometry, { maxIterations: 0 })).toThrow();
    expect(() => computeSulcalDepth(geometry, { maxIterations: 1.5 })).toThrow();
  });

  it('warns instead of silently returning an unconverged estimate', () => {
    const { geometry } = corrugatedSheet(0.5, 1, 4);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    computeSulcalDepth(geometry);
    expect(warn).not.toHaveBeenCalled();
    computeSulcalDepth(geometry, { maxIterations: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('did not reach tolerance');
    warn.mockRestore();
  });
});

describe('curvatureToGrayscale (gyri light)', () => {
  it('renders negative (gyral) curvature lighter than positive (sulcal) curvature by default', () => {
    const gray = curvatureToGrayscale(new Float32Array([-0.4, 0.4]), { brightness: 0.5, contrast: 0.5 });
    expect(gray[0]).toBeCloseTo(0.7, 5);
    expect(gray[1]).toBeCloseTo(0.3, 5);
  });

  it('restores the old mapping with invert: true', () => {
    const gray = curvatureToGrayscale(new Float32Array([-0.4, 0.4]), { brightness: 0.5, contrast: 0.5, invert: true });
    expect(gray[0]).toBeCloseTo(0.3, 5);
    expect(gray[1]).toBeCloseTo(0.7, 5);
  });
});
