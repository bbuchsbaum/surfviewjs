import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventEmitter } from '../../src/EventEmitter';
import { AnnotationManager } from '../../src/annotations';
import type { ViewerEventMap } from '../../src/events';

const VERTEX_COUNT = 40;

function setup(instancedThreshold = 3) {
  const positions: number[] = [];
  for (let i = 0; i < VERTEX_COUNT; i++) positions.push(i, 2 * i, 3 * i);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const viewer = new EventEmitter<ViewerEventMap>() as any;
  viewer.scene = new THREE.Scene();
  viewer.getSurface = (surfaceId: string) => surfaceId === 'lh' ? { mesh } : undefined;
  viewer.requestRender = vi.fn();
  const manager = new AnnotationManager(viewer, { colorOn: 0x00ff00, colorOff: 0xff0000 });
  (manager as any).instancedThreshold = instancedThreshold;
  return { manager, mesh };
}

const instanced = (mesh: THREE.Mesh) =>
  mesh.children.find(child => (child as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;

/** Positions and colours actually drawn by the instanced mesh. */
function drawn(mesh: THREE.Mesh): Array<{ position: number[]; color: number }> {
  const inst = instanced(mesh);
  const out = [];
  for (let i = 0; i < inst.count; i++) {
    const matrix = new THREE.Matrix4();
    inst.getMatrixAt(i, matrix);
    const color = new THREE.Color();
    inst.getColorAt(i, color);
    out.push({ position: new THREE.Vector3().setFromMatrixPosition(matrix).toArray(), color: color.getHex() });
  }
  return out;
}

const markerHex = (manager: AnnotationManager, id: string) =>
  (manager.get(id)!.marker.material as THREE.MeshBasicMaterial).color.getHex();

describe('annotation markers across the instancing threshold', () => {
  it('recolours markers created before instancing started', () => {
    const { manager } = setup();
    const early = manager.add('lh', 0)!;
    manager.add('lh', 1);
    manager.add('lh', 2); // instanced from here
    manager.activate(early);
    expect(markerHex(manager, early)).toBe(0x00ff00);
  });

  it('draws exactly the instanced annotations, at their vertices', () => {
    const { manager, mesh } = setup();
    manager.add('lh', 0);
    manager.add('lh', 1);
    manager.add('lh', 5);
    manager.add('lh', 7, undefined, { active: true });
    expect(drawn(mesh)).toEqual([
      { position: [5, 10, 15], color: 0xff0000 },
      { position: [7, 14, 21], color: 0x00ff00 }
    ]);
  });

  it('keeps every marker once instances outgrow the initial capacity', () => {
    const { manager, mesh } = setup();
    for (let v = 0; v < 30; v++) manager.add('lh', v);
    const positions = drawn(mesh).map(entry => entry.position);
    expect(positions).toHaveLength(28);
    expect(positions).toContainEqual([29, 58, 87]);
  });

  it('stops drawing a removed instance and keeps the others', () => {
    const { manager, mesh } = setup();
    manager.add('lh', 0);
    manager.add('lh', 1);
    const a = manager.add('lh', 4)!;
    manager.add('lh', 6);
    manager.remove(a);
    expect(drawn(mesh).map(entry => entry.position)).toEqual([[6, 12, 18]]);
    manager.move(manager.list().at(-1)!.id, 8);
    expect(drawn(mesh).map(entry => entry.position)).toEqual([[8, 16, 24]]);
  });
});

describe('instanced marker culling bounds', () => {
  it('cover markers added and moved after the bounds were first computed', () => {
    const { manager, mesh } = setup();
    manager.add('lh', 0);
    manager.add('lh', 1);
    manager.add('lh', 2);
    const inst = instanced(mesh);
    inst.computeBoundingSphere(); // as the renderer does when culling
    manager.add('lh', 30);
    const far = new THREE.Vector3(30, 60, 90);
    const bounds = () => {
      if (!inst.boundingSphere) inst.computeBoundingSphere();
      return inst.boundingSphere!;
    };
    expect(bounds().containsPoint(far)).toBe(true);

    manager.move(manager.list().at(-1)!.id, 39);
    expect(bounds().containsPoint(new THREE.Vector3(39, 78, 117))).toBe(true);
  });
});

describe('AnnotationManager.setDefaults repaints existing markers', () => {
  it('applies new default colours to markers without their own colours', () => {
    const { manager, mesh } = setup();
    const plain = manager.add('lh', 0)!;
    const own = manager.add('lh', 1, undefined, { colorOff: 0x333333 })!;
    manager.add('lh', 2); // instanced
    manager.setDefaults({ colorOff: 0x0000ff });
    expect(markerHex(manager, plain)).toBe(0x0000ff);
    expect(markerHex(manager, own)).toBe(0x333333);
    expect(drawn(mesh)[0]!.color).toBe(0x0000ff);
  });
});
