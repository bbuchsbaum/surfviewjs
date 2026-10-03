import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ViewerPickingController } from '../../src/viewer/ViewerPickingController';
import { isObjectDrawn } from '../../src/utils/Picking';

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
  return { controller, mesh, camera, surfaces: surfaces as Map<string, { mesh: THREE.Mesh }> };
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

  describe('hidden surfaces', () => {
    // "left" sits at the origin; "right" lies between it and the camera, as
    // the opposite hemisphere does in a medial view.
    function occluded() {
      const setup = fixture();
      const near = new THREE.Mesh(setup.mesh.geometry.clone(), new THREE.MeshBasicMaterial());
      near.position.set(0, 0, 2);
      near.updateMatrixWorld(true);
      setup.surfaces.set('right', { mesh: near });
      return { ...setup, near };
    }

    it('picks the occluding surface while it is drawn', () => {
      const { controller } = occluded();
      expect(controller.pick({ x: 50, y: 50, useGPU: false }).surfaceId).toBe('right');
    });

    it('skips a surface hidden by its own visibility (medial view)', () => {
      const { controller, near } = occluded();
      near.visible = false;
      const hit = controller.pick({ x: 50, y: 50, useGPU: false });
      expect(hit.surfaceId).toBe('left');
      expect(hit.point?.z).toBeCloseTo(0, 10);
    });

    it('skips a surface hidden through an ancestor', () => {
      const { controller, near } = occluded();
      const group = new THREE.Group();
      group.add(near);
      group.visible = false;
      expect(controller.pick({ x: 50, y: 50, useGPU: false }).surfaceId).toBe('left');
    });

    it('skips a surface whose materials are all invisible', () => {
      const { controller, near } = occluded();
      (near.material as THREE.Material).visible = false;
      expect(controller.pick({ x: 50, y: 50, useGPU: false }).surfaceId).toBe('left');
      (near.material as THREE.Material).visible = true;
      expect(controller.pick({ x: 50, y: 50, useGPU: false }).surfaceId).toBe('right');
    });

    it('skips a surface outside the camera layers', () => {
      const { controller, near } = occluded();
      near.layers.set(3);
      expect(controller.pick({ x: 50, y: 50, useGPU: false }).surfaceId).toBe('left');
    });

    it('reports no hit when every surface under the ray is hidden', () => {
      const { controller, mesh, near } = occluded();
      mesh.visible = false;
      near.visible = false;
      expect(controller.pick({ x: 50, y: 50, useGPU: false })).toEqual({
        surfaceId: null,
        vertexIndex: null,
        point: null
      });
    });
  });

  it('isObjectDrawn mirrors renderer visibility rules', () => {
    const camera = new THREE.PerspectiveCamera();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    expect(isObjectDrawn(mesh, camera)).toBe(true);
    expect(isObjectDrawn(new THREE.Group())).toBe(true);
    const mixed = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshBasicMaterial({ visible: false }),
      new THREE.MeshBasicMaterial()
    ]);
    expect(isObjectDrawn(mixed)).toBe(true);
    (mixed.material as THREE.Material[])[1]!.visible = false;
    expect(isObjectDrawn(mixed)).toBe(false);
    mesh.layers.set(2);
    expect(isObjectDrawn(mesh)).toBe(true);
    expect(isObjectDrawn(mesh, camera)).toBe(false);
    camera.layers.enable(2);
    expect(isObjectDrawn(mesh, camera)).toBe(true);
  });

  it('honors the opacity threshold and exposes stable ray helpers', () => {
    const { controller } = fixture(0.05);
    controller.updateScreenPosition(50, 50);
    expect(controller.pick({ useGPU: false }).surfaceId).toBeNull();
    expect(controller.getIntersectionPoint().toArray()).toEqual([0, 0, 0]);
    expect(controller.getRayDirection().toArray()).toEqual([0, 0, -1]);
  });
});
