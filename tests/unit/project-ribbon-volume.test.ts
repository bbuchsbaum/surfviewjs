import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { projectRibbonVolume, type VolumeDescriptor } from '../../src/projectVolume';

const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const grid = (data: number[], rest: Partial<VolumeDescriptor> = {}): VolumeDescriptor => ({ data, dims: [data.length,1,1], voxelToWorld: identity, ...rest });
const ribbon = { white: [0,0,0], pial: [2,0,0] };

describe('standalone anatomical ribbon projection', () => {
  it('uses each segment length and direction without normalization', () => {
    const result = projectRibbonVolume(grid([0,10,20,30,40]), {
      white: [0,0,0, 0,0,0, 4,0,0], pial: [2,0,0, 4,0,0, 0,0,0]
    }, { steps: 3 });
    expect(Array.from(result.values)).toEqual([10,20,20]);
    expect(Array.from(result.validSamples)).toEqual([3,3,3]);
  });

  it('matches an analytic linear field with oblique, anisotropic, reflected/sheared affine', () => {
    const matrix = new THREE.Matrix4().set(0,-2,0.5,10, 3,0,0,-4, 0,0,-4,20, 0,0,0,1);
    const f = (p: THREE.Vector3) => 2*p.x - 3*p.y + 0.5*p.z + 7;
    const data = [];
    for (let z=0;z<5;z++) for (let y=0;y<5;y++) for (let x=0;x<5;x++) data.push(f(new THREE.Vector3(x,y,z).applyMatrix4(matrix)));
    const a = new THREE.Vector3(0.5,1,1).applyMatrix4(matrix);
    const b = new THREE.Vector3(3.5,3,3).applyMatrix4(matrix);
    const result = projectRibbonVolume(grid(data, { dims:[5,5,5], voxelToWorld:matrix }), { white:a.toArray(), pial:b.toArray() }, { steps:7 });
    expect(result.values[0]).toBeCloseTo((f(a)+f(b))/2, 5);
    expect(result.validSamples[0]).toBe(7);
  });

  it.each(['nearest','linear'] as const)('omits BH failures rather than averaging them as zeros (%s)', interpolation => {
    const result = projectRibbonVolume(grid([10,0,30], { mask:[1,0,1] }), ribbon, { steps:3, interpolation });
    expect(result.values[0]).toBe(20);
    expect(result.validSamples[0]).toBe(2);
    const zero = projectRibbonVolume(grid([0,0,30], { mask:[1,0,1] }), ribbon, { steps:3, interpolation });
    expect(zero.values[0]).toBe(15);
    const missing = projectRibbonVolume(grid([10,0,30], { mask:[0,0,0] }), ribbon, { interpolation });
    expect(missing.values[0]).toBeNaN();
    expect(missing.validSamples[0]).toBe(0);
  });

  it('rejects a linear sample with a masked contributor, ignoring zero-weight neighbours', () => {
    const result = projectRibbonVolume(grid([2,8], { mask:[1,0] }), { white:[0,0,0], pial:[0.5,0,0] }, { steps:3 });
    expect(result.values[0]).toBe(2);
    expect(result.validSamples[0]).toBe(1);
  });

  it('includes endpoints, samples midpoint with one step and permits zero thickness', () => {
    const volume = grid([2,8,4]);
    expect(projectRibbonVolume(volume, ribbon, { steps:2 }).values[0]).toBe(3);
    expect(projectRibbonVolume(volume, ribbon, { steps:1 }).values[0]).toBe(8);
    const zero = projectRibbonVolume(volume, { white:[1,0,0], pial:[1,0,0] }, { steps:7 });
    expect(zero.values[0]).toBe(8);
    expect(zero.validSamples[0]).toBe(7);
  });

  it('omits nonfinite and outside samples, retaining signed max-abs and earliest ties', () => {
    const result = projectRibbonVolume(grid([-4,NaN,4]), { white:[-1,0,0], pial:[3,0,0] }, { steps:5, interpolation:'nearest', reducer:'max-abs' });
    expect(result.values[0]).toBe(-4);
    expect(result.validSamples[0]).toBe(2);
  });

  it('borrows inputs without mutations and handles an empty surface', () => {
    const volume = grid([1,2,3]);
    const snapshot = JSON.stringify({ volume, ribbon });
    projectRibbonVolume(volume, ribbon);
    expect(JSON.stringify({ volume, ribbon })).toBe(snapshot);
    expect(projectRibbonVolume(volume, { white:[], pial:[] }).values).toHaveLength(0);
  });

  it.each([
    { white:[0,0], pial:[0,0] }, { white:[0,0,0], pial:[] },
    { white:[NaN,0,0], pial:[0,0,0] }, { white:[0,0,0], pial:[Infinity,0,0] },
    { white:{ length:-3 }, pial:{ length:-3 } }
  ])('rejects malformed endpoints %j', endpoints => {
    expect(() => projectRibbonVolume(grid([1]), endpoints as typeof ribbon)).toThrow();
  });

  it.each([{ steps:0 }, { steps:257 }, { steps:1.2 }, { interpolation:'cubic' }, { reducer:'median' }])('rejects malformed options %j', options => {
    expect(() => projectRibbonVolume(grid([1,2,3]), ribbon, options as any)).toThrow();
  });

  it('rejects invalid volume, affine, result overflow and transformed overflow', () => {
    expect(() => projectRibbonVolume(grid([1], { mask:[] }), ribbon)).toThrow(/mask/);
    expect(() => projectRibbonVolume(grid([1], { voxelToWorld:Array(16).fill(0) }), ribbon)).toThrow();
    expect(() => projectRibbonVolume(grid([1e100]), { white:[0,0,0], pial:[0,0,0] })).toThrow(/Float32/);
    expect(() => projectRibbonVolume(grid([1], { voxelToWorld:identity.map((n,i) => i===0?1e-100:n) }), { white:[1e300,0,0], pial:[1e300,0,0] })).toThrow(/overflow/);
  });
});
