import * as THREE from 'three';
import { finiteNumber, rgbInteger } from './utils/validation';
import type { NeuroSurfaceViewer } from './NeuroSurfaceViewer';
import type { NeuroSurface } from './classes';
import { getDisplayGeometryBinding } from './geometry/DisplayGeometryBinding';
import { evaluateSurfaceAnchor, type SurfaceAnchor } from './geometry/SurfaceLocation';

export interface AnnotationOptions {
  radius?: number;
  /** Marker colour (0xRRGGBB) while active. Defaults to the manager's `colorOn`. */
  colorOn?: number;
  /** Marker colour (0xRRGGBB) while inactive. Defaults to the manager's `colorOff`. */
  colorOff?: number;
  active?: boolean;
  data?: any;
}

export interface AnnotationRecord {
  id: string;
  surfaceId: string;
  vertexIndex: number;
  anchor?: SurfaceAnchor;
  position: THREE.Vector3;
  marker: THREE.Mesh;
  data?: any;
  active: boolean;
  /** Per-annotation active colour; undefined follows the manager default. */
  colorOn?: number;
  /** Per-annotation inactive colour; undefined follows the manager default. */
  colorOff?: number;
}

/**
 * Lightweight per-vertex annotations rendered as small markers attached to surfaces.
 * Designed to be efficient (shared geometry) and easy to control (activate/deactivate).
 */
export class AnnotationManager {
  private viewer: NeuroSurfaceViewer;
  private annotations: Map<string, AnnotationRecord> = new Map();
  private counter = 0;
  private markerGeometry: THREE.SphereGeometry;
  private sharedGeometries = new Set<THREE.BufferGeometry>();
  private defaultOnMaterial: THREE.MeshBasicMaterial;
  private defaultOffMaterial: THREE.MeshBasicMaterial;
  private markerGroup: THREE.Group;
  private defaultRadius: number;
  private instancedThreshold = 500;
  private instanceGroups = new Set<{ parent: THREE.Object3D; radius: number; mesh: THREE.InstancedMesh; ids: string[] }>();
  private recordGroups = new Map<string, { parent: THREE.Object3D; radius: number; mesh: THREE.InstancedMesh; ids: string[] }>();
  private instanceSlots = new Map<string, number>();
  private surfaceRevisions = new Map<string, {
    mesh: THREE.Mesh;
    revision: string;
    geometry?: THREE.BufferGeometry;
    position?: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    morphs?: readonly (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[];
  }>();

  constructor(viewer: NeuroSurfaceViewer, defaults: { radius?: number; colorOn?: number; colorOff?: number } = {}) {
    this.viewer = viewer;
    this.defaultRadius = defaults.radius ?? 0.75;
    this.markerGeometry = new THREE.SphereGeometry(this.defaultRadius, 12, 12);
    this.sharedGeometries.add(this.markerGeometry);
    this.defaultOnMaterial = new THREE.MeshBasicMaterial({ color: defaults.colorOn ?? 0x00ff00 });
    this.defaultOffMaterial = new THREE.MeshBasicMaterial({ color: defaults.colorOff ?? 0xff0000 });
    this.markerGroup = new THREE.Group();
    this.markerGroup.name = 'annotation-markers';
    this.viewer.scene.add(this.markerGroup);
  }

  add(surfaceId: string, vertexIndex: number, data?: any, options: AnnotationOptions = {}): string | null {
    return this.addRecord(surfaceId, vertexIndex, data, options);
  }
  private addRecord(surfaceId: string, vertexIndex: number, data: unknown, options: AnnotationOptions, anchor?: SurfaceAnchor): string | null {
    const surface = this.viewer.getSurface(surfaceId) as NeuroSurface | undefined;
    if (!surface || !surface.mesh) {
      console.warn(`AnnotationManager: surface ${surfaceId} not found or missing mesh`);
      return null;
    }

    const geometry = surface.mesh.geometry as THREE.BufferGeometry;
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!positionAttr) {
      console.warn('AnnotationManager: surface has no position attribute');
      return null;
    }
    if (!Number.isSafeInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= positionAttr.count) {
      console.warn(`AnnotationManager: vertex index ${vertexIndex} out of range`);
      return null;
    }

    const colorOn = options.colorOn === undefined ? undefined : rgbInteger(options.colorOn, 'colorOn');
    const colorOff = options.colorOff === undefined ? undefined : rgbInteger(options.colorOff, 'colorOff');
    const id = `ann_${++this.counter}`;
    const radius = finiteNumber(options.radius ?? this.defaultRadius, 'radius', { minimum: 0, minimumExclusive: true });

    const position = anchor ? new THREE.Vector3().fromArray(evaluateSurfaceAnchor(anchor, getDisplayGeometryBinding(surface.mesh))) : surface.mesh.getVertexPosition(vertexIndex, new THREE.Vector3());

    // Use instancing when many markers are present to keep CPU and draw calls low
    const useInstanced = this.annotations.size + 1 >= this.instancedThreshold;
    let marker: THREE.Mesh;

    if (useInstanced) {
      this.recordGroups.set(id, this.ensureInstancedMesh(surface.mesh, radius));
      marker = new THREE.Mesh(); // placeholder for API; real draw via instanced mesh
    } else {
      marker = new THREE.Mesh(
        radius === this.defaultRadius ? this.markerGeometry : new THREE.SphereGeometry(radius, 12, 12),
        this.defaultOffMaterial.clone()
      );
      (marker.material as THREE.MeshBasicMaterial).color.setHex(
        options.active ? colorOn ?? this.defaultOnMaterial.color.getHex() : colorOff ?? this.defaultOffMaterial.color.getHex()
      );
      marker.position.copy(position);
      marker.userData.annotationId = id;
      surface.mesh.add(marker);
    }

    const record: AnnotationRecord = {
      id,
      surfaceId,
      vertexIndex,
      position: position.clone(),
      ...(anchor ? { anchor: Object.freeze({ ...anchor }) } : {}),
      marker,
      data,
      active: !!options.active,
      ...(colorOn !== undefined ? { colorOn } : {}),
      ...(colorOff !== undefined ? { colorOff } : {})
    };

    this.annotations.set(id, record);
    if (!this.surfaceRevisions.has(surfaceId)) this.surfaceRevisions.set(surfaceId, { mesh: surface.mesh, revision: '' });

    if (useInstanced) {
      this.writeInstance(record, options.active === true);
      this.viewer.requestRender();
    } else {
      if (options.active) {
        this.activate(id, { exclusive: true });
      } else {
        this.viewer.requestRender();
      }
    }

    this.viewer.emit('annotation:added', this.buildEventPayload(record));
    return id;
  }

  /** Add an exact triangle attachment after explicit domain binding on the surface mesh. */
  addAnchor(surfaceId: string, anchor: SurfaceAnchor, data?: unknown, options: AnnotationOptions = {}): string | null {
    const surface = this.viewer.getSurface(surfaceId);
    if (!surface?.mesh) return null;
    const position = evaluateSurfaceAnchor(anchor, getDisplayGeometryBinding(surface.mesh));
    const location = anchor.location;
    const nearest = location.kind === 'vertex' ? location.vertex : location.domain.triangle(location.face)[location.weights.indexOf(Math.max(...location.weights))]!;
    return this.addRecord(surfaceId, nearest, data, options, anchor);
  }
  moveAnchor(id: string, anchor: SurfaceAnchor): boolean {
    const record = this.annotations.get(id); if (!record) return false;
    const surface = this.viewer.getSurface(record.surfaceId); if (!surface?.mesh) return false;
    const position = evaluateSurfaceAnchor(anchor, getDisplayGeometryBinding(surface.mesh));
    record.anchor = Object.freeze({ ...anchor }); record.position.fromArray(position);
    const loc = anchor.location; record.vertexIndex = loc.kind === 'vertex' ? loc.vertex : loc.domain.triangle(loc.face)[loc.weights.indexOf(Math.max(...loc.weights))]!;
    this.updateMarkerPosition(record); this.viewer.emit('annotation:moved', this.buildEventPayload(record)); this.viewer.requestRender(); return true;
  }
  private updateMarkerPosition(record: AnnotationRecord): void {
    if (this.instanceSlots.has(record.id)) this.writeInstance(record, record.active); else record.marker.position.copy(record.position);
  }
  /** Called once before a viewer paint. Camera-only changes do no local-coordinate work. */
  updatePositions(): void {
    const grouped = new Map<string, AnnotationRecord[]>();
    for (const record of this.annotations.values()) { const group = grouped.get(record.surfaceId) ?? []; group.push(record); grouped.set(record.surfaceId, group); }
    for (const [surfaceId, records] of grouped) {
      const mesh = this.viewer.getSurface(surfaceId)?.mesh; if (!mesh) continue;
      const prior = this.surfaceRevisions.get(surfaceId);
      if (prior && prior.mesh !== mesh) { this.removeBySurface(surfaceId); continue; }
      const binding = records.some(r => r.anchor) ? getDisplayGeometryBinding(mesh) : undefined;
      // Anchors use the binding's full revision (including topology validation).
      // Legacy vertex annotations also support non-indexed meshes, so track
      // their attribute identities and interleaved buffer versions directly.
      const position = mesh.geometry.getAttribute('position');
      const morphs = mesh.geometry.morphAttributes.position ?? [];
      const version = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) =>
        'isInterleavedBufferAttribute' in attribute ? attribute.data.version : attribute.version;
      const revision = binding?.revision ?? `${version(position)}:${mesh.morphTargetInfluences?.join(',') ?? ''}:${Number(mesh.geometry.morphTargetsRelative)}:${morphs.map(version).join(',')}`;
      if (prior?.revision === revision && prior.geometry === mesh.geometry && prior.position === position &&
          prior.morphs?.length === morphs.length && morphs.every((attribute, i) => attribute === prior.morphs![i])) continue;
      for (const record of records) {
        if (record.anchor) record.position.fromArray(evaluateSurfaceAnchor(record.anchor, binding!));
        else mesh.getVertexPosition(record.vertexIndex, record.position);
        this.updateMarkerPosition(record);
      }
      this.surfaceRevisions.set(surfaceId, { mesh, revision, geometry: mesh.geometry, position, morphs: [...morphs] });
    }
  }

  list(surfaceId?: string): AnnotationRecord[] {
    const records = Array.from(this.annotations.values());
    return surfaceId ? records.filter(r => r.surfaceId === surfaceId) : records;
  }

  removeBySurface(surfaceId: string): void {
    this.annotations.forEach(rec => {
      if (rec.surfaceId === surfaceId) {
        this.remove(rec.id);
      }
    });
  }

  move(id: string, vertexIndex: number): boolean {
    const record = this.annotations.get(id);
    if (!record) return false;
    const surface = this.viewer.getSurface(record.surfaceId) as NeuroSurface | undefined;
    if (!surface || !surface.mesh) return false;

    const geometry = surface.mesh.geometry as THREE.BufferGeometry;
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!positionAttr || !Number.isSafeInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= positionAttr.count) return false;

    const position = surface.mesh.getVertexPosition(vertexIndex, new THREE.Vector3());

    delete record.anchor;
    record.vertexIndex = vertexIndex;
    record.position.copy(position);

    if (this.instanceSlots.has(record.id)) {
      this.writeInstance(record, record.active);
    } else if (record.marker) {
      record.marker.position.copy(position);
    }

    this.viewer.emit('annotation:moved', this.buildEventPayload(record));
    this.viewer.requestRender();
    return true;
  }

  get(id: string): AnnotationRecord | undefined {
    return this.annotations.get(id);
  }

  remove(id: string): void {
    const record = this.annotations.get(id);
    if (!record) return;

    this.releaseInstance(record.id);

    if (record.marker.parent) {
      record.marker.parent.remove(record.marker);
    }
    this.disposeMarker(record.marker);
    this.annotations.delete(id);
    if (!this.list(record.surfaceId).length) this.surfaceRevisions.delete(record.surfaceId);
    this.viewer.emit('annotation:removed', this.buildEventPayload(record));
    this.viewer.requestRender();
  }

  reset(): void {
    this.annotations.forEach(rec => {
      if (rec.marker.parent) {
        rec.marker.parent.remove(rec.marker);
      }
      this.disposeMarker(rec.marker);
    });
    this.annotations.clear();
    for (const group of this.instanceGroups) {
      group.mesh.removeFromParent(); group.mesh.geometry.dispose(); (group.mesh.material as THREE.Material).dispose(); group.mesh.dispose();
    }
    this.instanceGroups.clear(); this.recordGroups.clear(); this.instanceSlots.clear(); this.surfaceRevisions.clear();
    // Reset keeps the current default available for subsequent annotations.
    // Older defaults no longer have any users after the records are cleared.
    for (const geometry of this.sharedGeometries) if (geometry !== this.markerGeometry) {
      geometry.dispose(); this.sharedGeometries.delete(geometry);
    }
    this.viewer.emit('annotation:reset');
    this.viewer.requestRender();
  }

  dispose(): void {
    this.reset();
    for (const geometry of this.sharedGeometries) geometry.dispose();
    this.sharedGeometries.clear();
    this.defaultOnMaterial.dispose();
    this.defaultOffMaterial.dispose();
    if (this.markerGroup.parent) {
      this.markerGroup.parent.remove(this.markerGroup);
    }
  }

  activate(id: string, options: { exclusive?: boolean } = {}): void {
    const target = this.annotations.get(id);
    if (!target) return;
    const exclusive = options.exclusive !== false;

    this.annotations.forEach(rec => {
      const isActive = rec.id === id;
      rec.active = isActive || (!exclusive && rec.active);
      this.paint(rec);
    });

    this.viewer.emit('annotation:activated', this.buildEventPayload(target));
    this.viewer.requestRender();
  }

  forEach(callback: (annotation: AnnotationRecord) => void): void {
    this.annotations.forEach(callback);
  }

  setDefaults(defaults: { radius?: number; colorOn?: number; colorOff?: number }): void {
    const radius = defaults.radius === undefined
      ? undefined
      : finiteNumber(defaults.radius, 'radius', { minimum: 0, minimumExclusive: true });
    const colorOn = defaults.colorOn === undefined
      ? undefined
      : rgbInteger(defaults.colorOn, 'colorOn');
    const colorOff = defaults.colorOff === undefined
      ? undefined
      : rgbInteger(defaults.colorOff, 'colorOff');
    if (radius !== undefined) {
      const nextGeometry = new THREE.SphereGeometry(radius, 12, 12);
      this.defaultRadius = radius;
      this.markerGeometry = nextGeometry;
      this.sharedGeometries.add(nextGeometry);
    }
    if (colorOn !== undefined) {
      this.defaultOnMaterial.color.setHex(colorOn);
    }
    if (colorOff !== undefined) {
      this.defaultOffMaterial.color.setHex(colorOff);
    }
    if (colorOn !== undefined || colorOff !== undefined) {
      // Markers without their own colours follow the defaults.
      this.annotations.forEach(rec => this.paint(rec));
      this.viewer.requestRender();
    }
  }

  private buildEventPayload(record: AnnotationRecord): {
    annotation: AnnotationRecord;
    id: string;
    surfaceId: string;
    vertexIndex: number;
    active: boolean;
  } {
    return {
      annotation: record,
      id: record.id,
      surfaceId: record.surfaceId,
      vertexIndex: record.vertexIndex,
      active: record.active
    };
  }

  /** Colour for a record's state: its own colour if set, else the manager default. */
  private markerColor(record: AnnotationRecord, active = record.active): number {
    return active
      ? record.colorOn ?? this.defaultOnMaterial.color.getHex()
      : record.colorOff ?? this.defaultOffMaterial.color.getHex();
  }

  private disposeMarker(marker: THREE.Mesh): void {
    if (marker.geometry && !this.sharedGeometries.has(marker.geometry)) marker.geometry.dispose();
    if (marker.material) {
      if (Array.isArray(marker.material)) {
        marker.material.forEach(m => m.dispose());
      } else {
        (marker.material as THREE.Material).dispose();
      }
    }
  }

  /** Apply a record's current colour to its marker or instance. */
  private paint(record: AnnotationRecord): void {
    const slot = this.instanceSlots.get(record.id), group = this.recordGroups.get(record.id);
    if (slot !== undefined && group) {
      group.mesh.setColorAt(slot, new THREE.Color(this.markerColor(record)));
      group.mesh.instanceColor!.addUpdateRange(slot * 3, 3); group.mesh.instanceColor!.needsUpdate = true;
    } else if (record.marker.material instanceof THREE.MeshBasicMaterial) record.marker.material.color.setHex(this.markerColor(record));
  }

  private ensureInstancedMesh(parent: THREE.Object3D, radius: number) {
    for (const group of this.instanceGroups) if (group.parent === parent && group.radius === radius) return group;
    // instanceColor is enabled by InstancedMesh itself. The sphere has no
    // per-vertex color attribute; enabling vertexColors would multiply by zero.
    const geometry = new THREE.SphereGeometry(radius, 10, 10), material = new THREE.MeshBasicMaterial({ depthWrite: true });
    const group = { parent, radius, mesh: this.createInstancedMesh(geometry, material, this.instancedThreshold * 2), ids: [] as string[] };
    parent.add(group.mesh); this.instanceGroups.add(group); return group;
  }
  private createInstancedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'annotation-instanced'; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3); mesh.count = 0; return mesh;
  }
  private writeInstance(record: AnnotationRecord, active: boolean): void {
    const group = this.recordGroups.get(record.id); if (!group) return;
    let slot = this.instanceSlots.get(record.id);
    if (slot === undefined) {
      if (group.ids.length >= group.mesh.instanceMatrix.count) {
        const old = group.mesh, next = this.createInstancedMesh(old.geometry, old.material as THREE.Material, old.instanceMatrix.count * 2);
        (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
        (next.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array);
        old.removeFromParent(); group.parent.add(next); old.dispose(); group.mesh = next;
      }
      slot = group.ids.length; group.ids.push(record.id); this.instanceSlots.set(record.id, slot);
    }
    const mesh = group.mesh; mesh.count = group.ids.length;
    mesh.setMatrixAt(slot, new THREE.Matrix4().makeTranslation(record.position.x, record.position.y, record.position.z));
    mesh.setColorAt(slot, new THREE.Color(this.markerColor(record, active)));
    mesh.instanceMatrix.addUpdateRange(slot * 16, 16); mesh.instanceColor!.addUpdateRange(slot * 3, 3); this.instancesChanged(mesh);
  }
  private releaseInstance(id: string): void {
    const slot = this.instanceSlots.get(id), group = this.recordGroups.get(id); if (slot === undefined || !group) return;
    const mesh = group.mesh, lastSlot = group.ids.length - 1, lastId = group.ids[lastSlot]!;
    if (slot !== lastSlot) {
      const matrix = new THREE.Matrix4(), color = new THREE.Color(); mesh.getMatrixAt(lastSlot, matrix); mesh.getColorAt(lastSlot, color);
      mesh.setMatrixAt(slot, matrix); mesh.setColorAt(slot, color); group.ids[slot] = lastId; this.instanceSlots.set(lastId, slot);
      // Existing partial uploads suppress the full-buffer fallback. Include
      // the compacted destination even when another slot is already dirty.
      mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
      mesh.instanceColor!.addUpdateRange(slot * 3, 3);
    }
    group.ids.pop(); this.instanceSlots.delete(id); this.recordGroups.delete(id); mesh.count = group.ids.length; this.instancesChanged(mesh);
    if (!group.ids.length) { mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); this.instanceGroups.delete(group); }
  }

  /** Upload instance changes and drop cached bounds (used for culling and raycasts). */
  private instancesChanged(mesh: THREE.InstancedMesh): void {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.boundingSphere = null;
    mesh.boundingBox = null;
  }
}
