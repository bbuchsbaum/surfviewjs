import * as THREE from 'three';
import type { ParcelData, ParcelRecord } from '../parcellation';
import { buildParcelPatches, type ParcelPatch } from './parcelPatches';
import { finiteNumber } from '../utils/validation';

export interface ParcelPuzzleInput {
  /** Matching mesh and vertex labels; matching lengths alone do not prove registration. */
  vertices: ArrayLike<number>;
  faces: ArrayLike<number>;
  vertexLabels: ArrayLike<number>;
  parcelData: ParcelData;
}

export interface ParcelPuzzleGeometryOptions {
  /** Display thickness in mesh coordinate units, not an anatomical thickness estimate. */
  thickness?: number;
  /** Vertices with this label are omitted. Defaults to 0. */
  backgroundLabel?: number;
}

export interface ParcelPieceGeometry {
  readonly parcel: Readonly<ParcelRecord>;
  /** Closed shell, centered on centroid. Material groups: 0 = surface, 1 = back and sides. */
  readonly geometry: THREE.BufferGeometry;
  readonly centroid: THREE.Vector3;
  readonly normal: THREE.Vector3;
  /** Area of the extracted top surface in squared mesh units, before display deformation. */
  readonly surfaceArea: number;
  readonly sourceVertexCount: number;
  readonly boundaryEdgeCount: number;
  readonly topTriangleCount: number;
}

export interface ParcelPuzzleGeometry {
  readonly pieces: ReadonlyMap<number, ParcelPieceGeometry>;
  readonly bounds: THREE.Box3;
  readonly thickness: number;
  readonly unrepresentedParcelIds: readonly number[];
  /** Releases generated geometry only. Safe to call more than once. */
  dispose(): void;
}

function shell(patch: ParcelPatch, thickness: number): ParcelPieceGeometry {
  const centroid = new THREE.Vector3(), normal = new THREE.Vector3();
  const cross = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const edges = new Map<string, { a: number; b: number; count: number }>();
  let area = 0;
  for (let i = 0; i < patch.indices.length; i += 3) {
    const ids = patch.indices.slice(i, i + 3);
    const [a, b, c] = ids.map(id => patch.points[id]!.position) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    cross.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    const triangleArea = cross.length() / 2;
    area += triangleArea;
    centroid.addScaledVector(a, triangleArea / 3).addScaledVector(b, triangleArea / 3).addScaledVector(c, triangleArea / 3);
    normal.add(cross);
    for (let j = 0; j < 3; j++) {
      const aId = ids[j]!, bId = ids[(j + 1) % 3]!;
      const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
      const edge = edges.get(key);
      if (!edge) edges.set(key, { a: aId, b: bId, count: 1 });
      else {
        if (edge.count !== 1 || edge.a !== bId || edge.b !== aId) {
          throw new RangeError(`Parcel ${patch.parcel.id} has a non-manifold or inconsistently wound edge`);
        }
        edge.count++;
      }
    }
  }
  if (!(area > 0)) throw new RangeError(`Parcel ${patch.parcel.id} has no surface area`);
  centroid.divideScalar(area);
  if (normal.lengthSq() < 1e-20) normal.copy(patch.points[0]!.normal);
  normal.normalize();
  const boundary = [...edges.values()].filter(edge => edge.count === 1);
  const count = patch.points.length;
  const positions = new Float32Array((2 * count + boundary.length * 4) * 3);
  const normals = new Float32Array(positions.length);
  const local = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const point = patch.points[i]!;
    local.subVectors(point.position, centroid).toArray(positions, i * 3);
    point.normal.toArray(normals, i * 3);
    local.addScaledVector(point.normal, -thickness).toArray(positions, (count + i) * 3);
    point.normal.clone().negate().toArray(normals, (count + i) * 3);
  }
  const indices = [...patch.indices];
  for (let i = 0; i < patch.indices.length; i += 3) {
    indices.push(patch.indices[i + 2]! + count, patch.indices[i + 1]! + count, patch.indices[i]! + count);
  }
  boundary.forEach((edge, i) => {
    const offset = 2 * count + i * 4;
    const corners = [edge.a, edge.a + count, edge.b + count, edge.b];
    corners.forEach((source, corner) => {
      positions.set(positions.subarray(source * 3, source * 3 + 3), (offset + corner) * 3);
    });
    const a = new THREE.Vector3().fromArray(positions, offset * 3);
    const b = new THREE.Vector3().fromArray(positions, (offset + 1) * 3);
    const c = new THREE.Vector3().fromArray(positions, (offset + 3) * 3);
    const wallNormal = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize();
    for (let j = 0; j < 4; j++) wallNormal.toArray(normals, (offset + j) * 3);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.addGroup(0, patch.indices.length, 0);
  geometry.addGroup(patch.indices.length, indices.length - patch.indices.length, 1);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { parcel: patch.parcel, geometry, centroid, normal, surfaceArea: area,
    sourceVertexCount: patch.sourceVertexCount, boundaryEdgeCount: boundary.length,
    topTriangleCount: patch.indices.length / 3 };
}

/**
 * Partition labeled triangles and close each parcel with a backing and side walls.
 * Within a triangle, interpolate each label's indicator and take its maximum.
 * Two-label boundaries meet edge midpoints; three-label junctions meet the centroid.
 * Shared boundary coordinates are identical on both pieces; source arrays are not changed.
 */
export function buildParcelPuzzle(
  input: ParcelPuzzleInput,
  options: ParcelPuzzleGeometryOptions = {}
): ParcelPuzzleGeometry {
  const thickness = finiteNumber(options.thickness ?? 2, 'thickness', { minimum: 0, minimumExclusive: true });
  const patches = buildParcelPatches(input, options.backgroundLabel ?? 0);
  const pieces = new Map<number, ParcelPieceGeometry>();
  const bounds = new THREE.Box3();
  const unrepresented: number[] = [];
  try {
    for (const [id, patch] of patches) {
      if (patch.indices.length === 0) { unrepresented.push(id); continue; }
      const piece = shell(patch, thickness);
      pieces.set(id, piece);
      patch.points.forEach(point => bounds.expandByPoint(point.position));
    }
    if (pieces.size === 0) throw new RangeError('The mesh contains no represented parcels');
  } catch (error) {
    pieces.forEach(piece => piece.geometry.dispose());
    throw error;
  }
  let disposed = false;
  return { pieces, bounds, thickness, unrepresentedParcelIds: Object.freeze(unrepresented), dispose() {
    if (disposed) return;
    disposed = true;
    pieces.forEach(piece => piece.geometry.dispose());
  } };
}
