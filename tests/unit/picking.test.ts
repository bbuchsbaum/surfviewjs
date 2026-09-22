import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computePickInfo } from '../../src/utils/Picking';

function triangle(): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    0.5, 1
  ], 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe('computePickInfo invariants', () => {
  it('returns the closest world-space hit with face and UV metadata', () => {
    const mesh = triangle();
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 0, 2),
      new THREE.Vector3(0, 0, -1)
    );

    const hit = computePickInfo(raycaster, mesh);
    expect(hit.point?.toArray()).toEqual([0, 0, 0]);
    expect(hit.faceIndex).toBe(0);
    expect(hit.distance).toBe(2);
    expect(hit.uv?.toArray()).toEqual([0.5, 0.5]);
  });

  it('returns an explicit null result when the transformed ray misses', () => {
    const mesh = triangle();
    mesh.position.x = 10;
    mesh.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 0, 2),
      new THREE.Vector3(0, 0, -1)
    );

    expect(computePickInfo(raycaster, mesh)).toEqual({
      point: null,
      faceIndex: null,
      distance: null
    });
  });
});
