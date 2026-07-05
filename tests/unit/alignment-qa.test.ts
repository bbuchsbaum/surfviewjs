import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeAlignmentQAMetrics, createAlignmentQAReport } from '../../src/AlignmentQA';

function makeVolume(dims: [number, number, number]): Float32Array {
  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz);
  let offset = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        data[offset++] = i + j + k;
      }
    }
  }
  return data;
}

describe('alignment QA metrics', () => {
  it('distinguishes aligned and translated surface transforms', () => {
    const dims: [number, number, number] = [10, 10, 10];
    const volume = { id: 'boldref', data: makeVolume(dims), dims, dropoutThreshold: 1 };
    const surfaces = [{
      id: 'pial',
      kind: 'pial',
      vertices: new Float32Array([
        2, 2, 2,
        5, 5, 5,
        8, 8, 8
      ])
    }];

    const aligned = computeAlignmentQAMetrics({
      volume,
      surfaces,
      transform: { id: 'anat-to-bold', matrix: new THREE.Matrix4() }
    });
    expect(aligned.surfaceVoxelDistance.outOfBoundsFraction).toBe(0);
    expect(aligned.surfaceVoxelDistance.meanDistance).toBe(0);
    expect(aligned.edgeAgreement.meanGradient).toBeGreaterThan(0);

    const shifted = computeAlignmentQAMetrics({
      volume,
      surfaces,
      transform: {
        id: 'anat-to-bold-bad',
        matrix: new THREE.Matrix4().makeTranslation(20, 0, 0)
      }
    });
    expect(shifted.surfaceVoxelDistance.outOfBoundsFraction).toBe(1);
    expect(shifted.surfaceVoxelDistance.meanDistance).toBeGreaterThan(10);
  });

  it('reports transform and provenance metadata', () => {
    const dims: [number, number, number] = [4, 4, 4];
    const report = createAlignmentQAReport({
      volume: { id: 'boldref', data: makeVolume(dims), dims, space: 'func' },
      surfaces: [{ id: 'white', kind: 'white', vertices: new Float32Array([1, 1, 1]) }],
      transform: {
        id: 'anat-to-func',
        from: 'anat',
        to: 'func',
        matrix: new THREE.Matrix4(),
        provenance: { source: 'fmriprep' }
      }
    });

    expect(report.transform).toMatchObject({
      id: 'anat-to-func',
      from: 'anat',
      to: 'func',
      provenance: { source: 'fmriprep' }
    });
    expect(report.volume).toMatchObject({ id: 'boldref', dims, space: 'func' });
  });
});
