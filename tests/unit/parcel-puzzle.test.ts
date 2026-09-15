import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildParcelPuzzle, type ParcelPieceGeometry, type ParcelPuzzleInput } from '../../src/puzzle/buildParcelPuzzle';
import { ParcelPuzzle } from '../../src/puzzle/ParcelPuzzle';

const ids = [11, 47, 101];
function input(labels = [11, 11, 47, 47]): ParcelPuzzleInput {
  return { vertices: [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0], faces: [0, 1, 2, 0, 2, 3], vertexLabels: labels,
    parcelData: { schema_version: '1.0.0', atlas: { id: 'test', name: 'Test', n_parcels: 3 },
      parcels: ids.map(id => ({ id, label: `Parcel ${id}`, hemi: 'left' })) } };
}

/** Independent shell evidence: every geometric edge has two opposite incidences. */
function checkClosedShell(piece: ParcelPieceGeometry): void {
  const positions = piece.geometry.getAttribute('position');
  const index = piece.geometry.getIndex()!;
  const edges = new Map<string, number[]>();
  const key = (i: number) => [positions.getX(i), positions.getY(i), positions.getZ(i)].map(x => x.toFixed(6)).join(',');
  for (let i = 0; i < index.count; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = key(index.getX(i + j)), b = key(index.getX(i + (j + 1) % 3));
      const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
      const directions = edges.get(pair) ?? [];
      directions.push(a < b ? 1 : -1); edges.set(pair, directions);
    }
  }
  for (const directions of edges.values()) {
    expect(directions).toHaveLength(2);
    expect(directions[0]! + directions[1]!).toBe(0);
  }
}

function volume(piece: ParcelPieceGeometry): number {
  const position = piece.geometry.getAttribute('position'), index = piece.geometry.getIndex()!;
  let sum = 0;
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, index.getX(i + j))) as THREE.Vector3[];
    sum += a!.dot(b!.cross(c!)) / 6;
  }
  return sum;
}

describe('parcel puzzle extraction', () => {
  it('partitions all 81 labelings of a square without losing area or leaving shell edges open', () => {
    for (let code = 0; code < 81; code++) {
      let k = code;
      const labels = Array.from({ length: 4 }, () => { const id = ids[k % 3]!; k = Math.floor(k / 3); return id; });
      const puzzle = buildParcelPuzzle(input(labels), { thickness: 0.2 });
      expect([...puzzle.pieces.values()].reduce((sum, piece) => sum + piece.surfaceArea, 0)).toBeCloseTo(4, 10);
      for (const piece of puzzle.pieces.values()) {
        checkClosedShell(piece);
        // A flat prism has volume = area * thickness, independently of its triangulation.
        expect(volume(piece)).toBeCloseTo(piece.surfaceArea * 0.2, 6);
      }
      puzzle.dispose();
    }
  });

  it('uses one-hot label interpolation for two-label and three-label triangles', () => {
    const triangle = { ...input([11, 11, 47]), vertices: [0, 0, 0, 2, 0, 0, 0, 2, 0], faces: [0, 1, 2] };
    const two = buildParcelPuzzle(triangle);
    expect(two.pieces.get(11)!.surfaceArea).toBeCloseTo(1.5, 12);
    expect(two.pieces.get(47)!.surfaceArea).toBeCloseTo(0.5, 12);
    const three = buildParcelPuzzle({ ...triangle, vertexLabels: ids });
    for (const piece of three.pieces.values()) expect(piece.surfaceArea).toBeCloseTo(2 / 3, 12);
    const meshes = [...three.pieces].map(([id, piece]) => {
      const geometry = piece.geometry.clone(); geometry.setDrawRange(0, piece.topTriangleCount * 3);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      mesh.position.copy(piece.centroid); mesh.userData.id = id; mesh.updateMatrixWorld(true); return mesh;
    });
    // Test independent barycentric interior samples against actual triangle ray intersections.
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12 - i; j++) {
      const x = (i + 0.21) / 13, y = (j + 0.37) / 13;
      const weights = [1 - x - y, x, y];
      const expected = ids[weights.indexOf(Math.max(...weights))];
      const hits = new THREE.Raycaster(new THREE.Vector3(2 * x, 2 * y, 1), new THREE.Vector3(0, 0, -1)).intersectObjects(meshes);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.object.userData.id).toBe(expected);
    }
    meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
    two.dispose(); three.dispose();
  });

  it('keeps background omitted, IDs stable, source arrays unchanged and absent parcels explicit', () => {
    const source = input([11, 11, 0, 0]);
    const before = JSON.stringify(source);
    const puzzle = buildParcelPuzzle(source);
    expect([...puzzle.pieces.keys()]).toEqual([11]);
    expect(puzzle.pieces.get(11)!.surfaceArea).toBeCloseTo(2);
    expect(puzzle.unrepresentedParcelIds).toEqual([47, 101]);
    expect(JSON.stringify(source)).toBe(before);
    const reordered = buildParcelPuzzle({ ...source, parcelData: { ...source.parcelData, parcels: [...source.parcelData.parcels].reverse() } });
    expect(reordered.pieces.get(11)!.geometry.getAttribute('position').array).toEqual(puzzle.pieces.get(11)!.geometry.getAttribute('position').array);
    puzzle.dispose(); reordered.dispose();
  });

  it('retains disconnected components under one parcel identity', () => {
    const source = { ...input([11, 11, 11, 11, 11, 11]), vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0], faces: [0, 1, 2, 3, 4, 5] };
    const puzzle = buildParcelPuzzle(source);
    expect(puzzle.pieces.size).toBe(1);
    expect(puzzle.pieces.get(11)!.surfaceArea).toBe(1);
    expect(puzzle.pieces.get(11)!.boundaryEdgeCount).toBe(6);
    checkClosedShell(puzzle.pieces.get(11)!); puzzle.dispose();
  });

  it('rejects unknown/fractional labels, mismatched domains, bad thickness and inconsistent winding', () => {
    expect(() => buildParcelPuzzle(input([11, 11, 999, 47]))).toThrow('Unknown parcel ID');
    expect(() => buildParcelPuzzle(input([11, 11, 1.5, 47]))).toThrow('safe integer');
    expect(() => buildParcelPuzzle(input([11]))).toThrow('vertex count');
    expect(() => buildParcelPuzzle(input(), { thickness: NaN })).toThrow();
    expect(() => buildParcelPuzzle(input(), { thickness: 0 })).toThrow();
    expect(() => buildParcelPuzzle({ ...input([11, 11, 11, 11]), faces: [0, 1, 2, 0, 3, 2] })).toThrow(/winding|wound edge/);
  });
});

describe('parcel puzzle interaction model', () => {
  const camera = new THREE.Vector3(0, 0, 1);
  it('keeps hover pickable at its socket, preserves other pieces, and restores a rotated selection', () => {
    const puzzle = new ParcelPuzzle(input(), { thickness: 0.2, separation: 0, hoverLift: 2 });
    puzzle.update(0, camera, true);
    const anchors = ids.slice(0, 2).map(id => puzzle.getParcelPosition(id));
    const ray = new THREE.Raycaster(new THREE.Vector3(-0.5, -0.8, 20), new THREE.Vector3(0, 0, -1));
    expect(puzzle.pick(ray)).toBe(11);
    puzzle.setHoveredParcel(11); puzzle.update(0, camera, true);
    expect(puzzle.getParcelPosition(11).z).toBeCloseTo(2);
    expect(puzzle.pick(ray)).toBe(11);
    expect(puzzle.getParcelPosition(47)).toEqual(anchors[1]);
    puzzle.selectParcel(11); puzzle.rotateSelected(new THREE.Vector3(1, 0, 0), 0.8);
    puzzle.update(0, camera, true);
    expect(puzzle.getParcelRotation(11).angleTo(new THREE.Quaternion())).toBeCloseTo(0.8);
    expect(puzzle.getParcelRotation(47)).toEqual(new THREE.Quaternion());
    puzzle.setHoveredParcel(null); puzzle.selectParcel(null); puzzle.update(0, camera, true);
    expect(puzzle.getParcelPosition(11)).toEqual(anchors[0]);
    expect(puzzle.getParcelRotation(11)).toEqual(new THREE.Quaternion());
    expect(puzzle.update(1 / 60, camera)).toBe(false);
    puzzle.dispose();
  });

  it('moves parcel centers to open gaps while leaving their geometry unchanged', () => {
    const puzzle = new ParcelPuzzle(input(), { thickness: 0.2, separation: 0 });
    const before = new Float32Array(puzzle.getPiece(11).geometry.getAttribute('position').array);
    const anchor = puzzle.getParcelAnchor(11);
    puzzle.setSeparation(0.5); puzzle.update(0, camera, true);
    expect(puzzle.getParcelPosition(11)).toEqual(anchor.multiplyScalar(1.5));
    expect(puzzle.getPiece(11).geometry.getAttribute('position').array).toEqual(before);
    expect(() => puzzle.setSeparation(NaN)).toThrow();
    expect(puzzle.getSeparation()).toBe(0.5);
    expect(() => puzzle.selectParcel(101)).toThrow('no piece');
    expect(puzzle.selectedParcelId).toBeNull();
    puzzle.dispose();
  });

  it('changes relief reversibly and disposes shared geometry exactly once', () => {
    const puzzle = new ParcelPuzzle(input(), { thickness: 0.2 });
    const geometry = puzzle.getPiece(11).geometry;
    const before = new Float32Array(geometry.getAttribute('position').array);
    puzzle.setRelief(0.3);
    const flattened = geometry.getAttribute('position');
    for (let i = 0; i < flattened.count; i++) {
      expect(flattened.getX(i)).toBe(before[i * 3]);
      expect(flattened.getY(i)).toBe(before[i * 3 + 1]);
      expect(flattened.getZ(i)).toBeCloseTo(before[i * 3 + 2]! * 0.3, 7);
    }
    puzzle.setRelief(1);
    expect(geometry.getAttribute('position').array).toEqual(before);
    puzzle.selectParcel(11);
    const dispose = vi.spyOn(geometry, 'dispose');
    puzzle.dispose(); puzzle.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => puzzle.selectParcel(11)).toThrow('disposed');
  });
});
