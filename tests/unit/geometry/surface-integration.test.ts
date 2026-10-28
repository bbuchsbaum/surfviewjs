import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { bindSurfaceDomain, getDisplayGeometryBinding } from '../../../src/geometry/DisplayGeometryBinding';
import { evaluateSurfaceLocation, triangleLocation, exportSurfaceAnchors, importSurfaceAnchors, remapSurfaceLocation } from '../../../src/geometry/SurfaceLocation';
import { AnnotationManager } from '../../../src/annotations';
import { EventEmitter } from '../../../src/EventEmitter';
import { ViewerPickingController } from '../../../src/viewer/ViewerPickingController';
import { SurfaceGeometry } from '../../../src/classes';
import { MultiLayerNeuroSurface } from '../../../src/MultiLayerNeuroSurface';
import { OutlineLayer } from '../../../src/OutlineLayer';
import { SurfaceTriangleIndex } from '../../../src/geometry/SurfaceTriangleIndex';
import { GeodesicIndex } from '../../../src/geometry/GeodesicIndex';
import { GeometryWorkerClient, type GeometryWorker } from '../../../src/geometry/GeometryWorkerClient';

beforeEach(() => { vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {}); });
afterEach(() => vi.unstubAllGlobals());

function triangleMesh() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3)); geometry.setIndex([0, 1, 2]);
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2, 0, 0, 2], 3)];
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); mesh.morphTargetInfluences![0] = 0.5; return mesh;
}

describe('rendered surface attachments', () => {
  it('picks a transformed morph triangle, respects clipping, and rejects replaced attributes', () => {
    const mesh = triangleMesh(); mesh.position.set(0, 0, 1);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100); camera.position.z = 8; camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const controller = new ViewerPickingController({ getCanvas: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect }), getCamera: () => camera, getSurfaces: () => new Map([['lh', { mesh }]]), getGPUPicker: () => null, setGPUPicker: () => {} });
    const hit = controller.pickSurfaceLocation({ x: 50, y: 50 });
    expect(hit.location?.kind).toBe('triangle'); expect(hit.point?.z).toBeCloseTo(2, 12);
    const binding = getDisplayGeometryBinding(mesh);
    expect([...evaluateSurfaceLocation(hit.location!, binding)]).toEqual([0, 0, 1]);
    mesh.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 1)];
    expect(controller.pickSurfaceLocation({ x: 50, y: 50 }).location).toBeNull();
    mesh.geometry.setAttribute('position', mesh.geometry.getAttribute('position').clone());
    expect(() => binding.position(0)).toThrow(/replaced/);
  });
  it('keeps marker instances under their own surface and radius and follows morphs', () => {
    const left = triangleMesh(), right = triangleMesh(); right.position.x = 20;
    const viewer = new EventEmitter() as any; viewer.scene = new THREE.Scene(); viewer.requestRender = vi.fn(); viewer.getSurface = (id: string) => ({ mesh: id === 'lh' ? left : right });
    const manager = new AnnotationManager(viewer); (manager as any).instancedThreshold = 1;
    const binding = getDisplayGeometryBinding(left), anchor = { location: triangleLocation(binding.domain, 0, [0.25, 0.25, 0.5]) };
    const id = manager.addAnchor('lh', anchor, { label: 'center' })!;
    manager.add('rh', 1, undefined, { radius: 2 }); manager.add('lh', 2, undefined, { radius: 3 });
    expect(left.children.filter(x => (x as THREE.InstancedMesh).isInstancedMesh)).toHaveLength(2);
    expect(right.children.filter(x => (x as THREE.InstancedMesh).isInstancedMesh)).toHaveLength(1);
    left.morphTargetInfluences![0] = 0.75; manager.updatePositions(); expect(manager.get(id)!.position.toArray()).toEqual([0, 0, 1.5]);
    manager.remove(id); manager.dispose(); expect(left.children).toHaveLength(0); expect(right.children).toHaveLength(0);
  });
  it('keeps midpoint border buffers through style edits and follows morph positions', () => {
    const surface = new MultiLayerNeuroSurface(new SurfaceGeometry(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]), 'left'), { useWideLines: false });
    const outline = new OutlineLayer('border', { roiLabels: [-7, 8, 8], boundaryMode: 'midpoint' });
    surface.addLayer(outline);
    const object = outline.lineObject as THREE.LineSegments, geometry = object.geometry;
    expect([...geometry.getAttribute('position').array]).toEqual([0.5, 0, 0, 0, 0.5, 0]);
    outline.update({ color: 0x123456, width: 4 });
    surface.flushPendingColorUpdate();
    expect(outline.lineObject).toBe(object); expect((object.material as THREE.LineBasicMaterial).color.getHex()).toBe(0x123456);
    surface.mesh!.geometry.morphTargetsRelative = true;
    surface.mesh!.geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2, 0, 0, 2], 3)];
    surface.mesh!.updateMorphTargets(); surface.mesh!.morphTargetInfluences![0] = 0.5; surface.updateSurfaceAttachments();
    expect([...geometry.getAttribute('position').array]).toEqual([0.5, 0, 1, 0, 0.5, 1]);
    outline.updateLabelVertices([{ vertex: 2, label: -7 }]);
    expect(outline.lineObject).toBe(object);
    expect([...geometry.getAttribute('position').array]).toEqual([0.5, 0.5, 1, 0.5, 0, 1]);
    outline.update({ boundaryMode: 'transition-edges' });
    const legacy = outline.lineObject;
    outline.update({ boundaryMode: 'midpoint' });
    expect(outline.lineObject).not.toBe(legacy);
    expect([...(outline.lineObject as THREE.LineSegments).geometry.getAttribute('position').array]).toEqual([0.5, 0.5, 1, 0.5, 0, 1]);
    surface.dispose();
  });
  it('round-trips offset policy and only remaps with an explicit correspondence', async () => {
    const source = getDisplayGeometryBinding(triangleMesh()).domain, target = new SurfaceDomain({ id: 'permutation', structure: 'display', vertexCount: 3, faces: [2, 0, 1] });
    const location = triangleLocation(source, 0, [0.2, 0.3, 0.5]);
    const artifact = await exportSurfaceAnchors(source, [{ location, offset: 2, offsetFrame: 'metric' }], [{ label: 'A' }]);
    const restored = await importSurfaceAnchors(source, artifact); expect(restored[0]!.anchor.offsetFrame).toBe('metric');
    await expect(importSurfaceAnchors(target, artifact)).rejects.toThrow(/topology/);
    const mapped = remapSurfaceLocation(location, target, [0, 1, 2]); expect(mapped.kind === 'triangle' && mapped.weights).toEqual([0.5, 0.2, 0.3]);
  });
});

describe('independent projection and subvertex path witnesses', () => {
  it('matches Three Triangle exhaustive projection on randomized triangle soups', () => {
    let state = 1234; const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
    const points = Array.from({ length: 24 * 9 }, () => random() * 8 - 4), faces = Array.from({ length: 24 * 3 }, (_, i) => i);
    const domain = new SurfaceDomain({ id: 'soup', structure: 'synthetic', vertexCount: 72, faces }), metric = new SurfaceMetric(domain, { positions: points, frame: 'world', units: 'mm' }), index = new SurfaceTriangleIndex(metric, { leafSize: 2 });
    for (let q = 0; q < 100; q++) {
      const point = new THREE.Vector3(random() * 12 - 6, random() * 12 - 6, random() * 12 - 6), output = new THREE.Vector3(); let best = Infinity, bestFace = -1;
      for (let f = 0; f < 24; f++) {
        const tri = new THREE.Triangle(...[0, 1, 2].map(v => new THREE.Vector3().fromArray(points, f * 9 + v * 3)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
        const distance = tri.closestPointToPoint(point, output).distanceToSquared(point);
        if (distance < best) { best = distance; bestFace = f; }
      }
      const result = index.closest(point.toArray()); expect(result.distanceSquared).toBeCloseTo(best, 11); expect(result.face).toBe(bestFace);
    }
  });
  it('connects interior endpoints without snapping and reports measured polyline length', () => {
    const domain = new SurfaceDomain({ id: 'square', structure: 'synthetic', vertexCount: 4, faces: [0, 1, 2, 0, 2, 3] });
    const metric = new SurfaceMetric(domain, { positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], frame: 'mm', units: 'mm' }), index = new GeodesicIndex(metric);
    const a = triangleLocation(domain, 0, [0.2, 0.3, 0.5]), b = triangleLocation(domain, 1, [0.2, 0.3, 0.5]);
    const path = index.shortestPathLocations(a, b); expect(path.locations[0]).toBe(a); expect(path.locations.at(-1)).toBe(b);
    let length = 0; for (let i = 1; i < path.locations.length; i++) { const p = evaluateSurfaceLocation(path.locations[i - 1]!, metric), q = evaluateSurfaceLocation(path.locations[i]!, metric); length += Math.hypot(...p.map((x, j) => x - q[j]!)); }
    expect(path.lengthMm).toBeCloseTo(length, 13); expect(path.cost).toBeCloseTo(length, 13);
  });
});

it('cancels stale worker previews, releases orphan handles, and respects injected ownership', async () => {
  const handlers = new Map<string, EventListener>(), messages: any[] = [], terminate = vi.fn();
  const worker = { postMessage: (message: unknown) => messages.push(message), addEventListener: (type: string, handler: EventListener) => handlers.set(type, handler), removeEventListener: (type: string) => handlers.delete(type), terminate } as unknown as GeometryWorker;
  const client = new GeometryWorkerClient({ workerFactory: () => worker, ownsWorker: false }), domain = getDisplayGeometryBinding(triangleMesh()).domain;
  const controller = new AbortController(), pending = client.registerDomain(domain, { signal: controller.signal }); controller.abort();
  await expect(pending).rejects.toThrow(/cancelled/);
  const request = messages[0] as { clientId: string };
  handlers.get('message')!(new MessageEvent('message', { data: { protocol: 1, clientId: request.clientId, id: 1, value: 'geometry-resource-1' } }));
  expect(messages.some(m => m.command?.type === 'release')).toBe(true);
  client.dispose(); expect(terminate).not.toHaveBeenCalled(); expect(handlers.size).toBe(0);
});
