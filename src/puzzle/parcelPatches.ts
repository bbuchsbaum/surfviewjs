import * as THREE from 'three';
import { validateSurfaceGeometryData } from '../classes';
import { validateParcelData, type ParcelRecord } from '../parcellation';
import { finiteNumber } from '../utils/validation';
import type { ParcelPuzzleInput } from './buildParcelPuzzle';

export interface ParcelPatchPoint {
  key: string;
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface ParcelPatch {
  parcel: Readonly<ParcelRecord>;
  points: ParcelPatchPoint[];
  indices: number[];
  lookup: Map<string, number>;
  sourceVertexCount: number;
}

/** Shared labeled surface partition used by shells and the planar laboratory. */
export function buildParcelPatches(input: ParcelPuzzleInput, background = 0): Map<number, ParcelPatch> {
  validateSurfaceGeometryData(input.vertices, input.faces);
  validateParcelData(input.parcelData);
  finiteNumber(background, 'backgroundLabel', { integer: true });
  const vertexCount = input.vertices.length / 3;
  if (input.vertexLabels.length !== vertexCount) throw new RangeError('vertexLabels must match the mesh vertex count');
  const patches = new Map<number, ParcelPatch>();
  for (const row of input.parcelData.parcels) {
    finiteNumber(row.id, 'parcel.id', { integer: true });
    if (row.id === background) throw new RangeError('The background label must not also be a parcel ID');
    patches.set(row.id, { parcel: Object.freeze({ ...row }), points: [], indices: [], lookup: new Map(), sourceVertexCount: 0 });
  }
  const labels = Array.from(input.vertexLabels, (id, i) => {
    if (!Number.isSafeInteger(id)) throw new RangeError(`vertexLabels[${i}] must be a safe integer`);
    if (id !== background && !patches.has(id)) throw new RangeError(`Unknown parcel ID ${id} at vertex ${i}`);
    const patch = patches.get(id);
    if (patch) patch.sourceVertexCount++;
    return id;
  });
  const points: ParcelPatchPoint[] = Array.from({ length: vertexCount }, (_, i) => ({
    key: `v${i}`, position: new THREE.Vector3(input.vertices[i * 3]!, input.vertices[i * 3 + 1]!, input.vertices[i * 3 + 2]!),
    normal: new THREE.Vector3()
  }));
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let f = 0; f < input.faces.length; f += 3) {
    const a = points[input.faces[f]!]!, b = points[input.faces[f + 1]!]!, c = points[input.faces[f + 2]!]!;
    const normal = ab.subVectors(b.position, a.position).cross(ac.subVectors(c.position, a.position));
    if (normal.lengthSq() === 0) throw new RangeError(`Degenerate triangle at face ${f / 3}`);
    a.normal.add(normal); b.normal.add(normal); c.normal.add(normal);
  }
  for (const point of points) point.normal.normalize();
  const midpoint = (a: number, b: number): ParcelPatchPoint => ({
    key: a < b ? `e${a}:${b}` : `e${b}:${a}`,
    position: points[a]!.position.clone().add(points[b]!.position).multiplyScalar(0.5),
    normal: points[a]!.normal.clone().add(points[b]!.normal).normalize()
  });
  const add = (label: number, polygon: ParcelPatchPoint[]): void => {
    if (label === background) return;
    const patch = patches.get(label)!;
    const ids = polygon.map(point => {
      const existing = patch.lookup.get(point.key);
      if (existing !== undefined) return existing;
      if (point.normal.lengthSq() === 0) throw new RangeError('Mesh normals cancel; check triangle winding');
      const index = patch.points.length;
      patch.points.push(point); patch.lookup.set(point.key, index);
      return index;
    });
    for (let i = 1; i < ids.length - 1; i++) patch.indices.push(ids[0]!, ids[i]!, ids[i + 1]!);
  };
  for (let f = 0; f < input.faces.length; f += 3) {
    const ids = [input.faces[f]!, input.faces[f + 1]!, input.faces[f + 2]!];
    const faceLabels = ids.map(id => labels[id]!);
    const unique = new Set(faceLabels);
    if (unique.size === 1) {
      add(faceLabels[0]!, ids.map(id => points[id]!));
    } else if (unique.size === 2) {
      const single = faceLabels.findIndex(label => faceLabels.filter(other => label === other).length === 1);
      const a = ids[single]!, b = ids[(single + 1) % 3]!, c = ids[(single + 2) % 3]!;
      const mAB = midpoint(a, b), mCA = midpoint(c, a);
      add(labels[a]!, [points[a]!, mAB, mCA]);
      add(labels[b]!, [points[b]!, points[c]!, mCA, mAB]);
    } else {
      const center: ParcelPatchPoint = { key: `f${f / 3}`, position: new THREE.Vector3(), normal: new THREE.Vector3() };
      ids.forEach(id => { center.position.add(points[id]!.position); center.normal.add(points[id]!.normal); });
      center.position.divideScalar(3); center.normal.normalize();
      for (let i = 0; i < 3; i++) {
        const a = ids[i]!, b = ids[(i + 1) % 3]!, c = ids[(i + 2) % 3]!;
        add(labels[a]!, [points[a]!, midpoint(a, b), center, midpoint(c, a)]);
      }
    }
  }
  return patches;
}
