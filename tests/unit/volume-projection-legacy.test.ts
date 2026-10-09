import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VolumeProjectionLayer, type VolumeProjectionLayerConfig } from '../../src/layers';
import { LegacyVolumeSampler } from './fixtures/legacyVolumeSampler';

const layers: VolumeProjectionLayer[] = [];
afterEach(() => layers.splice(0).forEach(layer => layer.dispose()));

function layer(data: number[], config: VolumeProjectionLayerConfig = {}) {
  const result = new VolumeProjectionLayer('legacy', data, [data.length, 1, 1], config);
  layers.push(result);
  return result;
}

function ribbon(data: number[], config: VolumeProjectionLayerConfig = {}) {
  const result = layer(data, {
    projectionMode: 'ribbon',
    ribbon: { white: [0, 0, 0], pial: [data.length - 1, 0, 0], samples: data.length },
    ...config
  });
  result.attach({ geometry: { vertices: new Float32Array([0, 0, 0]) } });
  return result;
}

describe('legacy CPU volume projection contract', () => {
  it.each(['nearest', 'linear'] as const)('matches the frozen pre-refactor sampler and ribbon reducers exactly (%s)', sampling => {
    const dims: [number, number, number] = [4, 3, 2];
    const data = Float32Array.from({ length: 24 }, (_, i) => (i % 7 - 3) * 0.125);
    data[5] = NaN;
    data[17] = Infinity;
    const worldToIJK = new THREE.Matrix4().set(0.8, -0.3, 0.1, 0.3, 0.2, 1.1, -0.2, 0, 0, 0.1, 1.3, 0.2, 0, 0, 0, 1);
    const mesh = new THREE.Mesh();
    mesh.rotation.set(0.1, -0.2, 0.3);
    mesh.position.set(0.25, -0.1, 0.05);
    mesh.updateMatrixWorld(true);
    const white = new Float32Array([-0.5, 0, 0, 0.5, 0.5, 0.5, 2, 1, 0]);
    const pial = new Float32Array([2, 1, 1, 1.5, 2, 0.5, 3.5, 2, 1.5]);
    for (const reducer of ['mean', 'min', 'max', 'median'] as const) {
      for (const samples of [1, 2, 7, 32]) {
        for (const fillValue of [0, -999]) {
          const old = new LegacyVolumeSampler(data, dims, worldToIJK, sampling, white, pial, samples, reducer, fillValue);
          const current = new VolumeProjectionLayer('differential', data, dims, {
            worldToIJK, sampling, fillValue, projectionMode: 'ribbon', ribbon: { white, pial, samples, reducer }
          });
          layers.push(current);
          current.attach({ geometry: { vertices: white }, mesh });
          for (let v = 0; v < 3; v++) expect(current.sampleValueAtVertex(v)).toBe(old.sampleRibbonValue(v, mesh.matrixWorld.elements));
          for (const x of [-0.50001, -0.5, 0, 0.5, 1.5, 3, 3.5, 3.50001]) {
            for (const y of [0, 0.5, 1.1]) {
              const point = new THREE.Vector3(x, y, 0.5);
              expect(current.sampleValueAtWorld(point)).toBe(old.sampleValueAtWorldCoordinates(point.x, point.y, point.z));
            }
          }
        }
      }
    }
  });

  it('refreshes cached sampling when borrowed dimensions change', () => {
    const dims: [number, number, number] = [3, 2, 1];
    const subject = new VolumeProjectionLayer('dimensions', [1, 2, 3, 4, 5, 6], dims);
    layers.push(subject);
    const point = new THREE.Vector3(0, 1, 0);
    expect(subject.sampleValueAtWorld(point)).toBe(4);
    dims[0] = 2;
    dims[1] = 3;
    expect(subject.sampleValueAtWorld(point)).toBe(3);
  });

  it.each(['nearest', 'linear'] as const)('clamps half-voxel edges, including the upper face (%s)', sampling => {
    const subject = layer([2, 8], { sampling });
    const at = (x: number) => subject.sampleValueAtWorld(new THREE.Vector3(x, 0, 0));
    expect(at(-0.5)).toBe(2);
    expect(at(1.5)).toBe(8);
    expect(at(-0.50001)).toBeNull();
    expect(at(1.50001)).toBeNull();
  });

  it('keeps raw zero samples but hides fill values in display and ribbon reduction', () => {
    const subject = ribbon([0, 2, 4]);
    expect(subject.sampleValueAtWorld(new THREE.Vector3())).toBe(0);
    expect(subject.sampleValueAtVertex(0)).toBe(3);
    subject.setProjectionMode('vertex');
    expect(subject.sampleValueAtVertex(0)).toBe(0);
    expect(Array.from(subject.getRGBAData(1))).toEqual([0, 0, 0, 0]);
    subject.setFillValue(-1);
    subject.setProjectionMode('ribbon');
    expect(subject.sampleValueAtVertex(0)).toBe(2);
  });

  it('samples the white endpoint for a one-sample ribbon', () => {
    const subject = ribbon([2, 4, 8]);
    subject.update({ ribbon: { samples: 1 } });
    expect(subject.sampleValueAtVertex(0)).toBe(2);
    subject.update({ ribbon: { samples: 999 } });
    expect(subject.getRibbonConfig().samples).toBe(32);
  });

  it.each([
    ['mean', 5], ['min', 2], ['max', 8], ['median', 5]
  ] as const)('preserves %s reduction after filtering missing and fill samples', (reducer, expected) => {
    const subject = ribbon([0, 2, NaN, 8, Infinity]);
    subject.update({ ribbon: { reducer } });
    expect(subject.sampleValueAtVertex(0)).toBe(expected);
    subject.updateVolumeData([0, 0, NaN, Infinity, 0]);
    expect(subject.sampleValueAtVertex(0)).toBeNull();
  });

  it('retains legacy NaN contamination from a zero-weight linear neighbour', () => {
    const subject = layer([3, NaN], { sampling: 'linear' });
    expect(subject.sampleValueAtWorld(new THREE.Vector3())).toBeNaN();
  });

  it('applies mesh transforms for vertex and ribbon sampling and respects updates', () => {
    const subject = ribbon([2, 4, 8, 16]);
    const mesh = new THREE.Mesh();
    mesh.position.x = 1;
    subject.attach({ geometry: { vertices: new Float32Array([0, 0, 0]) }, mesh });
    subject.setRibbonSurfaces([1, 0, 0], [0, 0, 0], { samples: 2 });
    expect(subject.sampleValueAtVertex(0)).toBe(6);
    subject.setProjectionMode('vertex');
    expect(subject.sampleValueAtVertex(0)).toBe(4);
    expect(subject.sampleValueAtWorld(new THREE.Vector3())).toBe(2);
    subject.setWorldToIJK(new THREE.Matrix4().makeTranslation(1, 0, 0));
    expect(subject.sampleValueAtVertex(0)).toBe(8);
    subject.updateVolumeData([3, 6, 12, 24]);
    expect(subject.sampleValueAtVertex(0)).toBe(12);
    mesh.position.x = 0.5;
    subject.setSamplingMode('linear');
    expect(subject.sampleValueAtVertex(0)).toBe(9);
  });
});

describe('VolumeProjectionLayer sampling and reducer validation', () => {
  it('rejects unknown sampling modes instead of falling through to another sampler', () => {
    expect(() => layer([0, 1], { sampling: 'cubic' as never })).toThrow(/unknown sampling mode "cubic"/);
    const subject = layer([0, 10], { sampling: 'nearest' });
    expect(() => subject.setSamplingMode('cubic' as never)).toThrow(/unknown sampling mode/);
    expect(subject.sampleValueAtWorld(new THREE.Vector3(0.3, 0, 0))).toBe(0);
  });

  it('rejects unknown ribbon reducers before changing ribbon state', () => {
    expect(() => ribbon([1, 2, 3], { ribbon: { white: [0, 0, 0], pial: [2, 0, 0], reducer: 'sum' as never } }))
      .toThrow(/unknown ribbon reducer "sum"/);
    const subject = ribbon([1, 2, 3]);
    expect(() => subject.setRibbonSurfaces([2, 0, 0], [0, 0, 0], { reducer: 'max-abs' as never }))
      .toThrow(/unknown ribbon reducer "max-abs"/);
    expect(subject.sampleValueAtVertex(0)).toBe(2);
  });
});
