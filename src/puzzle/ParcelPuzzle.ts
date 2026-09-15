import * as THREE from 'three';
import { EventEmitter } from '../EventEmitter';
import type { ParcelRecord } from '../parcellation';
import { finiteNumber } from '../utils/validation';
import { buildParcelPuzzle, type ParcelPieceGeometry, type ParcelPuzzleGeometry,
  type ParcelPuzzleGeometryOptions, type ParcelPuzzleInput } from './buildParcelPuzzle';

export interface ParcelPuzzleOptions extends ParcelPuzzleGeometryOptions {
  /** Fractional expansion of parcel centers about the whole mesh center. Default 0.04. */
  separation?: number;
  /** Local curvature/thickness scale along each parcel's mean normal: 0.15–1. Default 1. */
  relief?: number;
  /** Hover displacement in mesh units. Default 4% of the mesh radius. */
  hoverLift?: number;
  /** Extra clearance in front of the assembled brain on selection. Default 12% of radius. */
  selectionLift?: number;
  color?: (parcel: Readonly<ParcelRecord>) => THREE.ColorRepresentation;
}

export interface ParcelPuzzleSelection {
  readonly parcelId: number | null;
  readonly piece: ParcelPieceGeometry | null;
}

export interface ParcelPuzzleEvents {
  change: void;
  hover: ParcelPuzzleSelection;
  select: ParcelPuzzleSelection;
}

interface PieceState {
  data: ParcelPieceGeometry;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial[]>;
  proxy: THREE.Mesh;
  anchor: THREE.Vector3;
  rotation: THREE.Quaternion;
  sourcePositions: Float32Array;
  sourceNormals: Float32Array;
}

/** Renderer-independent puzzle geometry, identity, picking and animated transforms. */
export class ParcelPuzzle extends EventEmitter<ParcelPuzzleEvents> {
  readonly group = new THREE.Group();
  readonly geometry: ParcelPuzzleGeometry;
  readonly radius: number;
  private readonly pieces = new Map<number, PieceState>();
  private readonly proxies = new THREE.Group();
  private readonly ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0x8c9ca6, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide
  });
  private readonly proxyMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  private readonly socket: THREE.Mesh;
  private readonly socketGeometry = new THREE.BufferGeometry();
  private hovered: number | null = null;
  private selected: number | null = null;
  private separation: number;
  private relief = 1;
  private hoverLift: number;
  private selectionLift: number;
  private disposed = false;
  private readonly target = new THREE.Vector3();
  private readonly forward = new THREE.Vector3(-1, 0, 0);
  private readonly identity = new THREE.Quaternion();

  constructor(input: ParcelPuzzleInput, options: ParcelPuzzleOptions = {}) {
    super();
    this.separation = finiteNumber(options.separation ?? 0.04, 'separation', { minimum: 0, maximum: 1 });
    const relief = finiteNumber(options.relief ?? 1, 'relief', { minimum: 0.15, maximum: 1 });
    // Validate parameters before allocating any GPU-backed geometry.
    if (options.hoverLift !== undefined) finiteNumber(options.hoverLift, 'hoverLift', { minimum: 0 });
    if (options.selectionLift !== undefined) finiteNumber(options.selectionLift, 'selectionLift', { minimum: 0 });
    this.geometry = buildParcelPuzzle(input, options);
    const center = this.geometry.bounds.getCenter(new THREE.Vector3());
    this.radius = this.geometry.bounds.getSize(new THREE.Vector3()).length() / 2;
    this.hoverLift = options.hoverLift ?? this.radius * 0.04;
    this.selectionLift = options.selectionLift ?? this.radius * 0.12;
    this.socket = new THREE.Mesh(this.socketGeometry, this.ghostMaterial);
    this.socket.visible = false;
    this.socket.name = 'parcel-puzzle-socket';
    this.group.add(this.socket);
    try {
      for (const [id, data] of this.geometry.pieces) {
        const color = options.color?.(data.parcel) ??
          (typeof data.parcel.color === 'string' || typeof data.parcel.color === 'number' ? data.parcel.color : 0x9fbcc4);
        const top = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.03 });
        const side = new THREE.MeshStandardMaterial({ color: top.color.clone().multiplyScalar(0.66), roughness: 0.9 });
        const mesh = new THREE.Mesh(data.geometry, [top, side]);
        mesh.name = `parcel-${id}`;
        mesh.userData.parcelId = id;
        const anchor = data.centroid.clone().sub(center);
        mesh.position.copy(anchor).multiplyScalar(1 + this.separation);
        const proxy = new THREE.Mesh(data.geometry, this.proxyMaterial);
        proxy.position.copy(mesh.position);
        proxy.userData.parcelId = id;
        this.pieces.set(id, { data, mesh, proxy, anchor, rotation: new THREE.Quaternion(),
          sourcePositions: new Float32Array(data.geometry.getAttribute('position').array),
          sourceNormals: new Float32Array(data.geometry.getAttribute('normal').array) });
        this.group.add(mesh); this.proxies.add(proxy);
      }
      this.setRelief(relief);
    } catch (error) { this.dispose(); throw error; }
  }

  get selectedParcelId(): number | null { return this.selected; }
  get hoveredParcelId(): number | null { return this.hovered; }
  getSeparation(): number { return this.separation; }
  getRelief(): number { return this.relief; }

  getPiece(id: number): ParcelPieceGeometry { return this.requirePiece(id).data; }
  getParcelColor(id: number): THREE.Color { return this.requirePiece(id).mesh.material[0]!.color.clone(); }

  /** Copy of the current parcel rotation, in puzzle coordinates. */
  getParcelRotation(id: number): THREE.Quaternion { return this.requirePiece(id).mesh.quaternion.clone(); }

  /** Current parcel center in world coordinates; useful for screen anchors. */
  getParcelPosition(id: number): THREE.Vector3 {
    this.group.updateWorldMatrix(true, true);
    return this.requirePiece(id).mesh.getWorldPosition(new THREE.Vector3());
  }

  /** Stable resting center in puzzle coordinates. */
  getParcelAnchor(id: number): THREE.Vector3 {
    return this.requirePiece(id).anchor.clone().multiplyScalar(1 + this.separation);
  }

  setSeparation(value: number): void {
    this.assertLive();
    const next = finiteNumber(value, 'separation', { minimum: 0, maximum: 1 });
    if (next === this.separation) return;
    this.separation = next;
    this.emit('change');
  }

  /** Flatten locally without changing atlas identity, source area or the source mesh. */
  setRelief(value: number): void {
    this.assertLive();
    const next = finiteNumber(value, 'relief', { minimum: 0.15, maximum: 1 });
    if (next === this.relief) return;
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (const piece of this.pieces.values()) {
      const position = piece.data.geometry.getAttribute('position');
      const normals = piece.data.geometry.getAttribute('normal');
      const axis = piece.data.normal;
      for (let i = 0; i < position.count; i++) {
        p.fromArray(piece.sourcePositions, i * 3);
        p.addScaledVector(axis, (next - 1) * p.dot(axis));
        position.setXYZ(i, p.x, p.y, p.z);
        n.fromArray(piece.sourceNormals, i * 3);
        n.addScaledVector(axis, (1 / next - 1) * n.dot(axis)).normalize();
        normals.setXYZ(i, n.x, n.y, n.z);
      }
      position.needsUpdate = true; normals.needsUpdate = true;
      piece.data.geometry.computeBoundingBox(); piece.data.geometry.computeBoundingSphere();
    }
    this.relief = next;
    this.emit('change');
  }

  setHoveredParcel(id: number | null): void {
    this.assertLive();
    if (id !== null) this.requirePiece(id);
    if (id === this.hovered) return;
    this.hovered = id;
    this.emit('change');
    this.emit('hover', this.selection(id));
  }

  selectParcel(id: number | null): void {
    this.assertLive();
    if (id !== null) this.requirePiece(id);
    if (id === this.selected) return;
    if (this.selected !== null) this.requirePiece(this.selected).rotation.identity();
    this.selected = id;
    this.socket.visible = id !== null;
    this.socket.geometry = id === null ? this.socketGeometry : this.requirePiece(id).data.geometry;
    this.emit('change');
    this.emit('select', this.selection(id));
  }

  rotateSelected(axis: THREE.Vector3, radians: number): void {
    this.assertLive();
    finiteNumber(radians, 'radians');
    if (![axis.x, axis.y, axis.z].every(Number.isFinite) || axis.lengthSq() === 0) {
      throw new RangeError('rotation axis must be a finite nonzero vector');
    }
    if (this.selected === null) return;
    const piece = this.requirePiece(this.selected);
    piece.rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), radians)).normalize();
    // Direct manipulation tracks the pointer without animation lag.
    piece.mesh.quaternion.copy(piece.rotation);
    this.emit('change');
  }

  resetSelectedRotation(): void {
    this.assertLive();
    if (this.selected === null) return;
    this.requirePiece(this.selected).rotation.identity();
    this.emit('change');
  }

  /** Advance easing. Camera direction points from the brain toward the camera. Returns whether another frame is needed. */
  update(seconds: number, cameraDirection: THREE.Vector3, immediate = false): boolean {
    this.assertLive();
    finiteNumber(seconds, 'seconds', { minimum: 0 });
    if (![cameraDirection.x, cameraDirection.y, cameraDirection.z].every(Number.isFinite) || cameraDirection.lengthSq() === 0) {
      throw new RangeError('cameraDirection must be a finite nonzero vector');
    }
    this.forward.copy(cameraDirection).normalize();
    const amount = immediate ? 1 : 1 - Math.exp(-14 * seconds);
    const tolerance = Math.max(this.radius * 1e-5, 1e-7);
    let front = -Infinity;
    for (const piece of this.pieces.values()) {
      front = Math.max(front, piece.anchor.dot(this.forward) * (1 + this.separation) +
        (piece.data.geometry.boundingSphere?.radius ?? 0));
    }
    let moving = false;
    for (const [id, piece] of this.pieces) {
      this.target.copy(piece.anchor).multiplyScalar(1 + this.separation);
      // Proxies follow each resting anchor, never the hover displacement.
      piece.proxy.position.copy(this.target);
      if (id === this.selected) {
        this.socket.position.copy(this.target);
        this.target.addScaledVector(this.forward, Math.max(0, front - this.target.dot(this.forward)) + this.selectionLift);
      } else if (id === this.hovered) {
        this.target.addScaledVector(piece.data.normal, this.hoverLift);
      }
      piece.mesh.position.lerp(this.target, amount);
      if (piece.mesh.position.distanceToSquared(this.target) <= tolerance * tolerance) piece.mesh.position.copy(this.target);
      else moving = true;
      const rotation = id === this.selected ? piece.rotation : this.identity;
      piece.mesh.quaternion.slerp(rotation, amount);
      if (piece.mesh.quaternion.angleTo(rotation) < 1e-4) piece.mesh.quaternion.copy(rotation);
      else moving = true;
      const emphasis = id === this.selected ? 0.12 : id === this.hovered ? 0.055 : 0;
      piece.mesh.material[0]!.emissive.copy(piece.mesh.material[0]!.color).multiplyScalar(emphasis);
    }
    this.group.updateMatrixWorld(true);
    this.proxies.matrix.copy(this.group.matrixWorld);
    this.proxies.matrixAutoUpdate = false;
    this.proxies.updateMatrixWorld(true);
    return moving;
  }

  /** Picking remains stable as hover pieces move. The floating selected piece takes precedence. */
  pick(raycaster: THREE.Raycaster): number | null {
    this.assertLive();
    this.group.updateWorldMatrix(true, true);
    this.proxies.matrix.copy(this.group.matrixWorld);
    this.proxies.matrixAutoUpdate = false;
    this.proxies.updateMatrixWorld(true);
    if (this.selected !== null && raycaster.intersectObject(this.requirePiece(this.selected).mesh, false).length) return this.selected;
    const hit = raycaster.intersectObjects(this.proxies.children, false)[0];
    return hit ? hit.object.userData.parcelId as number : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.group.clear(); this.proxies.clear();
    this.pieces.forEach(piece => piece.mesh.material.forEach(material => material.dispose()));
    this.ghostMaterial.dispose(); this.proxyMaterial.dispose(); this.socketGeometry.dispose();
    this.geometry.dispose();
    this.pieces.clear();
    this.removeAllListeners();
  }

  private selection(id: number | null): ParcelPuzzleSelection {
    return { parcelId: id, piece: id === null ? null : this.requirePiece(id).data };
  }

  private requirePiece(id: number): PieceState {
    this.assertLive();
    const piece = this.pieces.get(id);
    if (!piece) throw new RangeError(`Parcel ${id} has no piece in this mesh`);
    return piece;
  }

  private assertLive(): void { if (this.disposed) throw new Error('ParcelPuzzle has been disposed'); }
}
