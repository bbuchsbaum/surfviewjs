import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildFacePickGeometry,
  getFaceVertexIndices,
  pickNearestVertexOnFace
} from '../../src/utils/GPUPicker';

describe('GPUPicker helpers', () => {
  it('builds stable face IDs for indexed geometry', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 0
    ], 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);

    const { geometry: pickGeometry, faceCount } = buildFacePickGeometry(geometry, 42);
    const faceId = pickGeometry.getAttribute('faceId') as THREE.BufferAttribute;

    expect(faceCount).toBe(2);
    expect(pickGeometry.index).toBeNull();
    expect(faceId.count).toBe(6);
    expect(faceId.getX(0)).toBe(42);
    expect(faceId.getX(1)).toBe(42);
    expect(faceId.getX(2)).toBe(42);
    expect(faceId.getX(3)).toBe(43);
    expect(faceId.getX(4)).toBe(43);
    expect(faceId.getX(5)).toBe(43);
  });

  it('returns the original vertex indices for indexed faces', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 0
    ], 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);

    expect(getFaceVertexIndices(geometry, 0)).toEqual([0, 1, 2]);
    expect(getFaceVertexIndices(geometry, 1)).toEqual([2, 1, 3]);
    expect(getFaceVertexIndices(geometry, 2)).toBeNull();
  });

  it('chooses the nearest original vertex on the picked face', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ], 3));
    geometry.setIndex([0, 1, 2]);

    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.position.set(10, 0, 0);
    mesh.updateMatrixWorld(true);

    const ray = new THREE.Ray(
      new THREE.Vector3(10.9, 0.05, 1),
      new THREE.Vector3(0, 0, -1).normalize()
    );

    const hit = pickNearestVertexOnFace(mesh, 0, ray);
    expect(hit.vertexIndex).toBe(1);
    expect(hit.point).not.toBeNull();
    expect(hit.point?.x).toBeCloseTo(10.9, 5);
    expect(hit.point?.y).toBeCloseTo(0.05, 5);
    expect(hit.point?.z).toBeCloseTo(0, 5);
  });
});
