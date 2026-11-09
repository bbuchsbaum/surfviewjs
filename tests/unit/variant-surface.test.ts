import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SurfaceSet } from '../../src/SurfaceSet';
import { VariantSurface } from '../../src/VariantSurface';

/** A manual frame clock: frames run only when the test steps it. */
function installClock() {
  let now = 0;
  let nextId = 1;
  const frames = new Map<number, (t: number) => void>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  return {
    step(ms: number) {
      now += ms;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((cb) => cb(now));
    },
  };
}

/** A unit square in z = 0 ("flat") and the same square folded into y = 0 ("folded"), plus a larger copy. */
function squareSet(): SurfaceSet {
  return new SurfaceSet({
    faces: new Uint32Array([0, 1, 2, 0, 2, 3]),
    hemi: 'left',
    defaultVariant: 'flat',
    variants: {
      flat: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      folded: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
      big: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]),
    },
  });
}

function positionsOf(surface: VariantSurface): number[] {
  return Array.from(surface.mesh!.geometry.getAttribute('position').array as Float32Array);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VariantSurface switching', () => {
  it('honours a switch back to the starting variant during a morph', () => {
    const clock = installClock();
    const surface = new VariantSurface(squareSet());
    surface.setVariant('big', { duration: 100 });
    clock.step(50);
    expect(surface.isAnimating()).toBe(true);
    expect(surface.currentVariant()).toBe('flat');
    expect(surface.targetVariant()).toBe('big');

    // Back to the variant the morph started from: no longer dropped.
    surface.setVariant('flat', { duration: 100 });
    expect(surface.targetVariant()).toBe('flat');
    clock.step(100);
    expect(surface.isAnimating()).toBe(false);
    expect(surface.currentVariant()).toBe('flat');
    expect(positionsOf(surface)).toEqual(Array.from(squareSet().getPositions('flat')));
    surface.dispose();
  });

  it('interpolates normals during a morph and lands on the exact ones', () => {
    const clock = installClock();
    const surface = new VariantSurface(squareSet());
    const normal = () => Array.from((surface.mesh!.geometry.getAttribute('normal').array as Float32Array).slice(0, 3));
    expect(normal()[2]).toBeCloseTo(1, 5); // flat: +z
    surface.setVariant('folded', { duration: 100 });
    clock.step(50);
    const mid = normal();
    expect(Math.hypot(...mid)).toBeCloseTo(1, 5);
    expect(Math.abs(mid[1])).toBeGreaterThan(0.1); // turning toward the folded plane's normal
    expect(Math.abs(mid[2])).toBeGreaterThan(0.1);
    clock.step(60);
    expect(Math.abs(normal()[1])).toBeCloseTo(1, 5); // folded: along y
    surface.dispose();
  });

  it('keeps bounds around both shapes while morphing and exact afterwards', () => {
    const clock = installClock();
    const surface = new VariantSurface(squareSet());
    surface.setVariant('big', { duration: 100 });
    clock.step(10);
    const geometry = surface.mesh!.geometry;
    expect(geometry.boundingBox!.max.x).toBeCloseTo(10);
    // Mid-morph the bounds already reach the big shape.
    clock.step(100);
    expect(geometry.boundingBox!.max.toArray()).toEqual([10, 10, 0]);
    const raycaster = new THREE.Raycaster(new THREE.Vector3(9, 2, 5), new THREE.Vector3(0, 0, -1));
    expect(raycaster.intersectObject(surface.mesh!).length).toBe(1);
    surface.dispose();
  });

  it('reports each frame with time and shape fractions', () => {
    const clock = installClock();
    const surface = new VariantSurface(squareSet());
    const frames: Array<{ progress: number; weight: number }> = [];
    surface.on('variant:animating', ({ progress, weight }) => frames.push({ progress, weight }));
    const changed = vi.fn();
    surface.on('variant:changed', changed);
    surface.setVariant('big', { duration: 100, ease: (t) => t * t });
    clock.step(50);
    clock.step(50);
    expect(frames).toEqual([
      { progress: 0.5, weight: 0.25 },
      { progress: 1, weight: 1 },
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
    surface.dispose();
  });
});

describe('VariantSurface embeddings after construction', () => {
  it('adds a variant later and switches to it', () => {
    const surface = new VariantSurface(squareSet());
    surface.addVariant('lifted', new Float32Array([0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]));
    expect(surface.variantNames()).toContain('lifted');
    surface.setVariant('lifted', { animate: false });
    expect(positionsOf(surface)[2]).toBe(1);
    surface.dispose();
  });

  it('replacing the shown variant redraws it', () => {
    const surface = new VariantSurface(squareSet());
    surface.addVariant('flat', new Float32Array([0, 0, 2, 1, 0, 2, 1, 1, 2, 0, 1, 2]));
    expect(positionsOf(surface)[2]).toBe(2);
    expect(surface.geometry.vertices[2]).toBe(2);
    surface.dispose();
  });

  it('refuses mismatched vertex counts and removing the shown, pending or default variant', () => {
    const clock = installClock();
    const surface = new VariantSurface(squareSet());
    expect(() => surface.addVariant('bad', new Float32Array(3))).toThrow(/vertex count/);
    expect(surface.removeVariant('flat')).toBe(false); // shown and default
    surface.setVariant('folded', { duration: 100 });
    clock.step(10);
    expect(surface.removeVariant('folded')).toBe(false); // pending
    expect(surface.removeVariant('big')).toBe(true);
    expect(surface.variantNames()).not.toContain('big');
    expect(surface.removeVariant('missing')).toBe(false);
    surface.dispose();
  });
});

describe('SurfaceSet embeddings after construction', () => {
  it('copies added positions and keeps the default variant', () => {
    const set = squareSet();
    const positions = new Float32Array(12).fill(3);
    set.addVariant('three', positions, new Float32Array(4).fill(0.5));
    positions[0] = 99;
    expect(set.getPositions('three')[0]).toBe(3);
    expect(set.getCurv('three')?.[0]).toBe(0.5);
    set.addVariant('nocurv', new Float32Array(12), new Float32Array(2));
    expect(set.getCurv('nocurv')).toBeNull();
    expect(set.removeVariant('flat')).toBe(false);
    expect(set.removeVariant('three')).toBe(true);
    expect(set.hasVariant('three')).toBe(false);
  });
});
