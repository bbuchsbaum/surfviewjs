import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SurfaceGeometry } from '../../src/classes';
import { MorphableSurface } from '../../src/MorphableSurface';

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
}

/** A unit square in the z = 0 plane, two triangles. */
function square(): SurfaceGeometry {
  return new SurfaceGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    new Uint32Array([0, 1, 2, 0, 2, 3]),
    'left'
  );
}

/** The same square folded into the y = 0 plane (normals point along -y or +y). */
function folded(): Float32Array {
  return new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]);
}

/** Position of a vertex as three.js renders it, morph targets applied. */
function renderedPosition(surface: MorphableSurface, index: number): THREE.Vector3 {
  return surface.mesh!.getVertexPosition(index, new THREE.Vector3());
}

describe('MorphableSurface morph targets', () => {
  it('declares its delta morph targets relative so weight 1 reproduces the target', () => {
    const geometry = square();
    const surface = new MorphableSurface(geometry, {
      morphTargets: [{ name: 'same', positions: geometry.vertices.slice() }]
    });
    expect(surface.mesh!.geometry.morphTargetsRelative).toBe(true);

    surface.setMorphWeight('same', 1);
    for (let v = 0; v < 4; v++) {
      const expected = new THREE.Vector3().fromArray(geometry.vertices, v * 3);
      expect(renderedPosition(surface, v).distanceTo(expected)).toBeLessThan(1e-6);
    }
    surface.dispose();
  });

  it('interpolates linearly between the base and the target', () => {
    const geometry = square();
    const target = folded();
    const surface = new MorphableSurface(geometry, {
      morphTargets: [{ name: 'folded', positions: target }]
    });
    surface.setMorphWeight('folded', 0.5);
    const p = renderedPosition(surface, 2);
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
    expect(p.z).toBeCloseTo(0.5, 6);

    surface.setMorphWeight('folded', 1);
    expect(renderedPosition(surface, 3).toArray()).toEqual([0, 0, 1]);
    surface.dispose();
  });

  it('stores per-target normal deltas so lighting follows the morphed shape', () => {
    const geometry = square();
    const surface = new MorphableSurface(geometry, {
      morphTargets: [{ name: 'folded', positions: folded() }]
    });
    const bufferGeometry = surface.mesh!.geometry;
    const normals = bufferGeometry.morphAttributes.normal;
    expect(normals).toHaveLength(1);

    const base = bufferGeometry.getAttribute('normal');
    const delta = normals![0]!;
    for (let v = 0; v < 4; v++) {
      const n = new THREE.Vector3(
        base.getX(v) + delta.getX(v),
        base.getY(v) + delta.getY(v),
        base.getZ(v) + delta.getZ(v)
      );
      // The folded square lies in the y = 0 plane, so its normals are ±y.
      expect(Math.abs(n.y)).toBeCloseTo(1, 6);
      expect(n.x).toBeCloseTo(0, 6);
      expect(n.z).toBeCloseTo(0, 6);
    }

    surface.removeMorphTarget('folded');
    expect(bufferGeometry.morphAttributes.normal).toHaveLength(0);
    expect(bufferGeometry.morphAttributes.position).toHaveLength(0);
    surface.dispose();
  });

  it('keeps bounds covering every morph target for culling and raycasting', () => {
    const geometry = square();
    const surface = new MorphableSurface(geometry);
    const bufferGeometry = surface.mesh!.geometry;
    expect(bufferGeometry.boundingBox!.max.z).toBeCloseTo(0, 6);

    const lifted = geometry.vertices.slice();
    for (let i = 2; i < lifted.length; i += 3) lifted[i] = 10;
    surface.addMorphTarget('lifted', lifted);

    // three.js bounds relative targets conservatively; they must cover z = 10.
    expect(bufferGeometry.boundingBox!.max.z).toBeGreaterThanOrEqual(10);
    surface.setMorphWeight('lifted', 1);
    const morphed = renderedPosition(surface, 0);
    expect(bufferGeometry.boundingSphere!.containsPoint(morphed)).toBe(true);

    surface.removeMorphTarget('lifted');
    expect(bufferGeometry.boundingBox!.max.z).toBeCloseTo(0, 6);
    surface.dispose();
  });
});
