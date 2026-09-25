import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ViewerPickingController } from '../../src/viewer/ViewerPickingController';

function fixture(opacity = 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0
  ], 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ opacity }));
  mesh.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const surfaces = new Map([['left', { mesh }]]);
  let gpuPicker = null;
  const controller = new ViewerPickingController({
    getCanvas: () => ({
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
    }),
    getCamera: () => camera,
    getSurfaces: () => surfaces,
    getGPUPicker: () => gpuPicker,
    setGPUPicker: picker => { gpuPicker = picker; }
  });
  return { controller, mesh };
}

describe('ViewerPickingController', () => {
  it('converts screen coordinates and identifies the nearest face vertex', () => {
    const { controller } = fixture();
    const hit = controller.pick({ x: 50, y: 50, useGPU: false });
    expect(controller.mouse.toArray()).toEqual([0, 0]);
    expect(hit.surfaceId).toBe('left');
    expect(hit.vertexIndex).toBe(2);
    expect(hit.point?.toArray()).toEqual([0, 0, 0]);
  });

  it('reports the nearest surface when an earlier surface lies behind it', () => {
    const { controller, mesh } = fixture();
    // "left" is registered first but sits behind "right" along the ray.
    mesh.position.set(0, 0, -2);
    mesh.updateMatrixWorld(true);
    const near = new THREE.Mesh(mesh.geometry.clone(), new THREE.MeshBasicMaterial());
    near.updateMatrixWorld(true);
    const surfaces = (controller as unknown as {
      host: { getSurfaces(): Map<string, { mesh: THREE.Mesh }> };
    }).host.getSurfaces();
    surfaces.set('right', { mesh: near });
    const hit = controller.pick({ x: 50, y: 50, useGPU: false });
    expect(hit.surfaceId).toBe('right');
    expect(hit.point?.z).toBeCloseTo(0, 10);
  });

  it('honors the opacity threshold and exposes stable ray helpers', () => {
    const { controller } = fixture(0.05);
    controller.updateScreenPosition(50, 50);
    expect(controller.pick({ useGPU: false }).surfaceId).toBeNull();
    expect(controller.getIntersectionPoint().toArray()).toEqual([0, 0, 0]);
    expect(controller.getRayDirection().toArray()).toEqual([0, 0, -1]);
  });
});
