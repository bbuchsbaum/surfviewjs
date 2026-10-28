import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { AnnotationManager } from '../../../src/annotations';
import { getDisplayGeometryBinding } from '../../../src/geometry/DisplayGeometryBinding';
import { triangleLocation } from '../../../src/geometry/SurfaceLocation';

function setup(instanced = false) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1, 1, 0, 1, 0, 1, 1], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2, 0, 0, 2], 3)];
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.morphTargetInfluences![0] = 0.5;
  const manager = new AnnotationManager({
    scene: new THREE.Scene(), getSurface: () => ({ mesh }), requestRender() {}, emit() {}
  } as any);
  if (instanced) (manager as any).instancedThreshold = 1;
  return { mesh, manager };
}

function add(manager: AnnotationManager, mesh: THREE.Mesh, anchor: boolean) {
  if (!anchor) return manager.add('s', 0)!;
  const binding = getDisplayGeometryBinding(mesh);
  return manager.addAnchor('s', { location: triangleLocation(binding.domain, 0, [1, 0, 0]) })!;
}

for (const anchor of [false, true]) describe(anchor ? 'precise anchors' : 'legacy vertex markers', () => {
  it('refreshes when a morph attribute is replaced without changing its version', () => {
    const { mesh, manager } = setup(), id = add(manager, mesh, anchor);
    manager.updatePositions();
    mesh.geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 4, 0, 0, 4, 0, 0, 4], 3)];
    manager.updatePositions();
    expect(manager.get(id)!.position.z).toBe(3);
    expect(manager.get(id)!.marker.position.z).toBe(3);
    manager.dispose();
  });

  it('refreshes when relative morph interpretation changes', () => {
    const { mesh, manager } = setup(), id = add(manager, mesh, anchor);
    manager.updatePositions();
    mesh.geometry.morphTargetsRelative = false;
    manager.updatePositions();
    expect(manager.get(id)!.position.z).toBe(1.5);
    manager.dispose();
  });

  it('uses interleaved position and morph buffer versions', () => {
    const { mesh, manager } = setup();
    const positions = new THREE.InterleavedBuffer(new Float32Array([0, 0, 1, 99, 1, 0, 1, 99, 0, 1, 1, 99]), 4);
    const morphs = new THREE.InterleavedBuffer(new Float32Array([0, 0, 2, 99, 0, 0, 2, 99, 0, 0, 2, 99]), 4);
    mesh.geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(positions, 3, 0));
    mesh.geometry.morphAttributes.position = [new THREE.InterleavedBufferAttribute(morphs, 3, 0)];
    const id = add(manager, mesh, anchor);
    manager.updatePositions();
    positions.array[2] = 3; positions.needsUpdate = true;
    manager.updatePositions();
    expect(manager.get(id)!.position.z).toBe(4);
    morphs.array[2] = 6; morphs.needsUpdate = true;
    manager.updatePositions();
    expect(manager.get(id)!.position.z).toBe(6);
    manager.dispose();
  });

  it('does no vertex evaluation for camera-only paints', () => {
    const { mesh, manager } = setup(); add(manager, mesh, anchor); manager.updatePositions();
    const read = vi.spyOn(mesh, 'getVertexPosition');
    manager.updatePositions(); manager.updatePositions();
    expect(read).not.toHaveBeenCalled();
    manager.dispose();
  });
});

it('refreshes legacy markers after replacing a non-indexed position attribute', () => {
  const { mesh, manager } = setup(); mesh.geometry.setIndex(null);
  const id = manager.add('s', 0)!; manager.updatePositions();
  mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 5, 1, 0, 5, 0, 1, 5], 3));
  manager.updatePositions();
  expect(manager.get(id)!.position.z).toBe(6);
  manager.dispose();
});

it('retains shared geometry while in use and disposes all generations exactly once', () => {
  const { manager } = setup();
  const first = manager.add('s', 0)!, second = manager.add('s', 1)!;
  const oldGeometry = manager.get(first)!.marker.geometry, oldDispose = vi.fn();
  oldGeometry.addEventListener('dispose', oldDispose);
  manager.remove(first);
  expect(oldDispose).not.toHaveBeenCalled();
  expect(manager.get(second)!.marker.geometry).toBe(oldGeometry);
  manager.setDefaults({ radius: 2 });
  const third = manager.add('s', 2)!, currentDispose = vi.fn();
  const current = manager.get(third)!.marker.geometry;
  current.addEventListener('dispose', currentDispose);
  manager.reset();
  expect(oldDispose).toHaveBeenCalledTimes(1);
  expect(currentDispose).not.toHaveBeenCalled();
  const afterReset = manager.add('s', 0)!;
  expect(manager.get(afterReset)!.marker.geometry).toBe(current);
  manager.dispose();
  expect(oldDispose).toHaveBeenCalledTimes(1);
  expect(currentDispose).toHaveBeenCalledTimes(1);
});

it('uploads compacted position and color slots alongside pending partial updates', () => {
  const { mesh, manager } = setup(true);
  const ids = [0, 1, 2].map((v, i) => manager.add('s', v, undefined, { colorOff: [0xff0000, 0x00ff00, 0x0000ff][i] })!);
  const instance = mesh.children.find(c => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
  // Exercise Three's real partial-upload selection with a small in-memory GL
  // buffer. A CPU-array-only assertion would miss the original defect.
  const buffers = new Map<object, Float32Array>();
  let bound: object;
  const gl = {
    FLOAT: 1, createBuffer: () => ({}), bindBuffer(_type: number, buffer: object) { bound = buffer; },
    bufferData(_type: number, values: Float32Array) { buffers.set(bound, values.slice()); },
    bufferSubData(_type: number, offset: number, values: Float32Array, start = 0, count = values.length) {
      buffers.get(bound)!.set(values.subarray(start, start + count), offset / 4);
    }
  };
  const attributes = WebGLAttributes(gl as any);
  for (const attribute of [instance.instanceMatrix, instance.instanceColor!]) {
    attributes.update(attribute, 1); attribute.clearUpdateRanges();
  }
  manager.move(ids[1]!, 0); // Slot 1 is dirty before slot 2 moves into slot 0.
  manager.remove(ids[0]!);
  for (const attribute of [instance.instanceMatrix, instance.instanceColor!]) {
    attributes.update(attribute, 1);
    expect([...buffers.get(attributes.get(attribute)!.buffer)!]).toEqual([...attribute.array]);
  }
  expect(instance.count).toBe(2);
  manager.dispose();
});
