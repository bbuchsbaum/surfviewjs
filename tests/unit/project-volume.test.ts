import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { projectVolume, type VolumeDescriptor, type ProjectVolumeOptions } from '../../src/projectVolume';
import { VolumeProjectionLayer } from '../../src/layers';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const point = { positions: [0, 0, 0], normals: [1, 0, 0] };
const atPoint = { depthMm: [0, 0] as const, steps: 1 };
const grid = (data: number[], rest: Partial<VolumeDescriptor> = {}): VolumeDescriptor => ({
  data, dims: [data.length, 1, 1], voxelToWorld: identity, ...rest
});

describe('projectVolume numerical contract', () => {
  it('uses x-fastest storage and reproduces a multilinear polynomial', () => {
    const data = [];
    const f = (x: number, y: number, z: number) => x + 10 * y + 100 * z + x * y * z;
    for (let z = 0; z < 3; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) data.push(f(x, y, z));
    const result = projectVolume(grid(data, { dims: [3, 3, 3] }), {
      positions: [0.25, 1.25, 0.5, 2, 2, 2], normals: [1, 0, 0, 1, 0, 0]
    }, atPoint);
    expect(Array.from(result.values)).toEqual([f(0.25, 1.25, 0.5), f(2, 2, 2)]);
    expect(Array.from(result.validSamples)).toEqual([1, 1]);
  });

  it.each([4, -4])('preserves mm depths under rotation, shear, translation and anisotropic scale (%s)', zScale => {
    const affine = new THREE.Matrix4().set(0, -2, 1, 10, 3, 0, 0, -4, 0, 0, zScale, 20, 0, 0, 0, 1);
    const f = (p: THREE.Vector3) => 2 * p.x - 3 * p.y + 0.5 * p.z + 7;
    const data = [];
    for (let z = 0; z < 5; z++) for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      data.push(f(new THREE.Vector3(x, y, z).applyMatrix4(affine)));
    }
    const p = new THREE.Vector3(2, 2, 2).applyMatrix4(affine);
    const result = projectVolume(grid(data, { dims: [5, 5, 5], voxelToWorld: affine }), {
      positions: p.toArray(), normals: [0, 3, 4]
    }, { depthMm: [-1, 2], steps: 7 });
    // Average depth = 0.5 mm; unit direction = [0, .6, .8].
    expect(result.values[0]).toBeCloseTo(f(p) + 0.5 * (-3 * 0.6 + 0.5 * 0.8), 5);
    expect(result.validSamples[0]).toBe(7);
  });

  it('includes genuine zeros and averages only valid depth samples', () => {
    const result = projectVolume(grid([0, 2, 4, NaN, Infinity]), point, { depthMm: [0, 4] });
    expect(result.values[0]).toBe(2);
    expect(result.validSamples[0]).toBe(3);
  });

  it('samples endpoints, uses the midpoint for one step and follows normal sign', () => {
    const volume = grid([2, 8, 4]);
    expect(projectVolume(volume, point, { depthMm: [0, 2], steps: 1 }).values[0]).toBe(8);
    expect(projectVolume(volume, point, { depthMm: [0, 2], steps: 2 }).values[0]).toBe(3);
    expect(projectVolume(volume, { positions: [2, 0, 0], normals: [-7, 0, 0] }, { depthMm: [0, 1], steps: 2 }).values[0]).toBe(6);
  });

  it('keeps the sign of max-abs, choosing the earliest depth on ties', () => {
    const options = { depthMm: [0, 2] as const, steps: 3, reducer: 'max-abs' as const };
    expect(projectVolume(grid([-4, 1, 4]), point, options).values[0]).toBe(-4);
    expect(projectVolume(grid([4, 1, -4]), point, options).values[0]).toBe(4);
  });

  it.each(['nearest', 'linear'] as const)('omits masked and non-finite samples (%s)', interpolation => {
    const volume = grid([3, 4, 5, 6, 7], { mask: [1, 0, NaN, Infinity, -1] });
    const result = projectVolume(volume, point, { depthMm: [0, 4], interpolation });
    expect(result.values[0]).toBe(5);
    expect(result.validSamples[0]).toBe(2);
    const missing = projectVolume(grid([NaN, Infinity]), point, { depthMm: [0, 1], steps: 2, interpolation });
    expect(missing.values[0]).toBeNaN();
    expect(missing.validSamples[0]).toBe(0);
  });

  it('never renormalizes trilinear weights around invalid contributors', () => {
    const volume = grid([2, 8], { mask: [1, 0] });
    const result = projectVolume(volume, { positions: [0.25, 0, 0], normals: [1, 0, 0] }, atPoint);
    expect(result.values[0]).toBeNaN();
    expect(result.validSamples[0]).toBe(0);
  });

  it('ignores NaN/masked neighbours of exactly zero weight on all axes', () => {
    const volume = grid([9, NaN, NaN, NaN, NaN, NaN, NaN, NaN], { dims: [2, 2, 2], mask: [1, 0, 0, 0, 0, 0, 0, 0] });
    expect(projectVolume(volume, point, atPoint).values[0]).toBe(9);
    expect(projectVolume(volume, { positions: [1e-12, 0, 0], normals: [1, 0, 0] }, atPoint).values[0]).toBeNaN();
  });

  it('uses half-open voxel extents for nearest and centre bounds for linear', () => {
    const surface = { positions: [-0.5, 0, 0, -0.0001, 0, 0, 0, 0, 0, 0.5, 0, 0, 1, 0, 0, 1.4999, 0, 0, 1.5, 0, 0], normals: Array(7).fill([1, 0, 0]).flat() };
    const nearest = projectVolume(grid([2, 8]), surface, { ...atPoint, interpolation: 'nearest' });
    expect(Array.from(nearest.values)).toEqual([2, 2, 2, 8, 8, 8, NaN]);
    const linear = projectVolume(grid([2, 8]), surface, atPoint);
    expect(Array.from(linear.values)).toEqual([NaN, NaN, 2, 5, 8, NaN, NaN]);
  });

  it('handles singleton dimensions, empty surfaces and borrowed arrays without mutations', () => {
    const volume = grid([7]);
    const snapshot = JSON.stringify({ volume, point });
    expect(projectVolume(volume, point, atPoint).values[0]).toBe(7);
    expect(JSON.stringify({ volume, point })).toBe(snapshot);
    const empty = projectVolume(volume, { positions: [], normals: [] }, atPoint);
    expect(empty.values.length).toBe(0);
    expect(empty.validSamples.length).toBe(0);
  });

  it('does not scan or copy the volume', () => {
    let reads = 0;
    const data = new Proxy({ length: 1_000_000 }, { get(target, key) {
      if (key === 'length') return target.length;
      reads++;
      return 6;
    } }) as unknown as ArrayLike<number>;
    const result = projectVolume({ data, dims: [100, 100, 100], voxelToWorld: identity }, point, { ...atPoint, interpolation: 'nearest' });
    expect(result.values[0]).toBe(6);
    expect(reads).toBe(1);
  });

  it('matches ribbon projection when white/pial define the same anatomical line', () => {
    const data = [0, 1, 4, 9, 16];
    const layer = new VolumeProjectionLayer('equivalent', data, [5, 1, 1], {
      fillValue: -999, sampling: 'linear', projectionMode: 'ribbon',
      ribbon: { white: [0, 0, 0], pial: [4, 0, 0], samples: 9 }
    });
    try {
      layer.attach({ geometry: { vertices: new Float32Array([0, 0, 0]) } });
      expect(projectVolume(grid(data), point, { depthMm: [0, 4], steps: 9 }).values[0]).toBeCloseTo(layer.sampleValueAtVertex(0)!, 6);
    } finally { layer.dispose(); }
  });

  it.each([
    { dims: [0, 1, 1] }, { dims: [1.5, 1, 1] }, { dims: [2, 1, 1] }, { mask: [] },
    { dims: [Number.MAX_SAFE_INTEGER, 2, 1] }, { voxelToWorld: identity.slice(1) },
    { voxelToWorld: identity.map((x, i) => i === 4 ? NaN : x) },
    { voxelToWorld: identity.map((x, i) => i === 0 ? 0 : x) },
    { voxelToWorld: identity.map((x, i) => i === 3 ? 1 : x) }
  ])('rejects malformed volume %j', invalid => {
    expect(() => projectVolume(grid([1], invalid as Partial<VolumeDescriptor>), point, atPoint)).toThrow();
  });

  it.each([
    { positions: [0, 0], normals: [1, 0] }, { positions: [0, 0, 0], normals: [] },
    // ArrayLike is structural, so lengths need not come from a real array.
    { positions: { length: -3 }, normals: { length: -3 } },
    { positions: [NaN, 0, 0], normals: [1, 0, 0] }, { positions: [0, 0, 0], normals: [0, 0, 0] },
    { positions: [0, 0, 0], normals: [Infinity, 0, 0] }
  ])('rejects malformed surface %j', surface => {
    expect(() => projectVolume(grid([1]), surface, atPoint)).toThrow();
  });

  it.each([
    { steps: 0 }, { steps: 1.5 }, { steps: 257 }, { steps: NaN },
    { depthMm: [1, -1] }, { depthMm: [0, Infinity] }, { depthMm: [] },
    { interpolation: 'cubic' }, { reducer: 'median' }
  ])('rejects malformed options %j', invalid => {
    expect(() => projectVolume(grid([1]), point, { ...atPoint, ...invalid } as ProjectVolumeOptions)).toThrow();
  });

  it('rejects Float32 result overflow and coordinate arithmetic overflow', () => {
    expect(() => projectVolume(grid([1e100]), point, atPoint)).toThrow(/Float32/);
    const tinyAffine = identity.map((x, i) => i === 0 ? 1e-100 : x);
    expect(() => projectVolume(grid([1], { voxelToWorld: tinyAffine }), point, { depthMm: [0, 1e300] })).toThrow(/overflow/);
  });

  it('normalizes very large and very small nonzero normals', () => {
    for (const scale of [Number.MAX_VALUE, Number.MIN_VALUE]) {
      expect(projectVolume(grid([2, 6]), { ...point, normals: [scale, 0, 0] }, { depthMm: [1, 1] }).values[0]).toBe(6);
    }
  });

  it.each(['nearest', 'linear'] as const)('matches an independent weighted-corner reference with missing data (%s)', interpolation => {
    let seed = 1947;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const dims = [9, 8, 7] as const;
    const data = Float64Array.from({ length: 9 * 8 * 7 }, () => random() < 0.05 ? NaN : 20 * random() - 10);
    const mask = Uint8Array.from(data, () => Number(random() > 0.1));
    const affine = new THREE.Matrix4().set(0.8, -1.2, 0.3, 3, 0.6, 1.6, 0, -5, 0, 0.2, 3, 7, 0, 0, 0, 1);
    const inverse = affine.clone().invert();
    const positions: number[] = [], normals: number[] = [];
    for (let v = 0; v < 80; v++) {
      positions.push(...new THREE.Vector3(random() * 11 - 1, random() * 10 - 1, random() * 9 - 1).applyMatrix4(affine).toArray());
      normals.push(random() - 0.5, random() - 0.5, random() - 0.5);
    }
    function referenceSample(p: THREE.Vector3) {
      const coords = p.toArray();
      if (interpolation === 'nearest') {
        const ijk = coords.map(x => Math.floor(x + 0.5));
        if (ijk.some((x, a) => x < 0 || x >= dims[a]!)) return NaN;
        const index = ijk[0] + dims[0] * (ijk[1] + dims[1] * ijk[2]);
        return mask[index] ? data[index] : NaN;
      }
      if (coords.some((x, a) => x < 0 || x > dims[a]! - 1)) return NaN;
      const base = coords.map(Math.floor);
      let sum = 0;
      for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
        const offsets = [dx, dy, dz];
        const weight = offsets.reduce((w, offset, a) => w * (offset ? coords[a] - base[a] : 1 - coords[a] + base[a]), 1);
        if (weight === 0) continue;
        const index = base[0] + dx + dims[0] * (base[1] + dy + dims[1] * (base[2] + dz));
        if (!mask[index] || !Number.isFinite(data[index])) return NaN;
        sum += weight * data[index];
      }
      return sum;
    }
    for (const reducer of ['mean', 'max-abs'] as const) {
      const result = projectVolume({ data, dims, voxelToWorld: affine, mask }, { positions, normals }, {
        depthMm: [-1.5, 2.5], steps: 9, interpolation, reducer
      });
      for (let v = 0; v < result.values.length; v++) {
        const p = new THREE.Vector3().fromArray(positions, v * 3);
        const n = new THREE.Vector3().fromArray(normals, v * 3).normalize();
        const samples = Array.from({ length: 9 }, (_, s) => referenceSample(p.clone().addScaledVector(n, -1.5 + s / 2).applyMatrix4(inverse))).filter(Number.isFinite);
        expect(result.validSamples[v]).toBe(samples.length);
        if (samples.length === 0) expect(result.values[v]).toBeNaN();
        else {
          const expected = reducer === 'mean'
            ? samples.reduce((a, b) => a + b, 0) / samples.length
            : samples.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a);
          // Float32 output: absolute tolerance < 1e-5 at fixture magnitudes <= 10.
          expect(result.values[v]).toBeCloseTo(expected, 5);
        }
      }
    }
  });
});
