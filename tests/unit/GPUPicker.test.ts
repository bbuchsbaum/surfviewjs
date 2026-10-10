import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  GPUPicker,
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
    expect(getFaceVertexIndices(geometry, 0.5)).toBeNull();
    expect(getFaceVertexIndices(geometry, Number.NaN)).toBeNull();
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

  it('hides pick meshes of surfaces that are not drawn', () => {
    const picker = new GPUPicker({} as THREE.WebGLRenderer);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setIndex([0, 1, 2]);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    group.add(mesh);
    picker.addSurface('left', mesh);
    const pickMesh = () => (picker as unknown as {
      surfaces: Map<string, { pickMesh: THREE.Mesh }>;
    }).surfaces.get('left')!.pickMesh;

    picker.syncTransforms();
    expect(pickMesh().visible).toBe(true);
    group.visible = false;
    picker.syncTransforms();
    expect(pickMesh().visible).toBe(false);
    group.visible = true;
    (mesh.material as THREE.Material).visible = false;
    picker.syncTransforms();
    expect(pickMesh().visible).toBe(false);

    // Layers follow the source mesh, so the cloned pick camera filters alike.
    (mesh.material as THREE.Material).visible = true;
    mesh.layers.set(4);
    picker.syncTransforms();
    expect(pickMesh().visible).toBe(true);
    expect(pickMesh().layers.mask).toBe(mesh.layers.mask);
    expect(pickMesh().layers.test(new THREE.PerspectiveCamera().layers)).toBe(false);
    picker.dispose();
  });

  it('rejects an invalid throttle before changing picker state', () => {
    const picker = new GPUPicker({} as THREE.WebGLRenderer);
    picker.setThrottleMs(8);
    expect(() => picker.setThrottleMs(Number.NaN)).toThrow(/finite/);
    expect((picker as unknown as { pickThrottleMs: number }).pickThrottleMs).toBe(8);
    picker.dispose();
  });
});

describe('GPUPicker throttling', () => {
  function pickerFixture() {
    let renders = 0;
    const renderer = {
      domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
      getPixelRatio: () => 1,
      getContext: () => ({ drawingBufferWidth: 100, drawingBufferHeight: 100 }),
      getRenderTarget: () => null,
      getClearColor: (target: THREE.Color) => target,
      getClearAlpha: () => 1,
      setRenderTarget: () => {},
      setClearColor: () => {},
      clear: () => {},
      render: () => { renders++; },
      // Encoded face id 0: the first face of the first registered surface.
      readRenderTargetPixels: (_t: unknown, _x: number, _y: number, _w: number, _h: number, buffer: Uint8Array) => {
        buffer.set([0, 0, 0, 255]);
      }
    } as unknown as THREE.WebGLRenderer;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, -1, 0,
      1, -1, 0,
      0, 1, 0
    ], 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const picker = new GPUPicker(renderer);
    picker.addSurface('lh', mesh);
    return { picker, camera, renders: () => renders };
  }

  it('never turns a hit into a miss for back-to-back explicit picks', () => {
    const { picker, camera, renders } = pickerFixture();
    picker.setThrottleMs(1000);
    const first = picker.pick(50, 50, camera);
    const second = picker.pick(50, 50, camera);
    expect(first.surfaceId).toBe('lh');
    expect(second.surfaceId).toBe('lh');
    expect(second.vertexIndex).toBe(first.vertexIndex);
    expect(renders()).toBe(2);
    picker.dispose();
  });

  it('rate-limits throttled picks by reusing the latest result instead of a miss', () => {
    const { picker, camera, renders } = pickerFixture();
    picker.setThrottleMs(1000);
    const first = picker.pick(50, 50, camera, undefined, { throttle: true });
    const second = picker.pick(52, 50, camera, undefined, { throttle: true });
    expect(first.surfaceId).toBe('lh');
    expect(second).toEqual(first);
    expect(second.point).not.toBe(first.point);
    expect(renders()).toBe(1);
    picker.dispose();
  });
});
