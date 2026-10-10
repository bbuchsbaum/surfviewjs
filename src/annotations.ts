import * as THREE from 'three';
import { finiteNumber, rgbInteger } from './utils/validation';
import type { NeuroSurfaceViewer } from './NeuroSurfaceViewer';
import type { NeuroSurface } from './classes';

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
  private defaultOnMaterial: THREE.MeshBasicMaterial;
  private defaultOffMaterial: THREE.MeshBasicMaterial;
  private markerGroup: THREE.Group;
  private defaultRadius: number;
  private instancedThreshold = 500;
  private instancedMesh: THREE.InstancedMesh | null = null;
  /** Packed instance slots: slot i draws the annotation `slotIds[i]`. */
  private instanceSlots: Map<string, number> = new Map();
  private slotIds: string[] = [];

  constructor(viewer: NeuroSurfaceViewer, defaults: { radius?: number; colorOn?: number; colorOff?: number } = {}) {
    this.viewer = viewer;
    this.defaultRadius = defaults.radius ?? 0.75;
    this.markerGeometry = new THREE.SphereGeometry(this.defaultRadius, 12, 12);
    this.defaultOnMaterial = new THREE.MeshBasicMaterial({ color: defaults.colorOn ?? 0x00ff00 });
    this.defaultOffMaterial = new THREE.MeshBasicMaterial({ color: defaults.colorOff ?? 0xff0000 });
    this.markerGroup = new THREE.Group();
    this.markerGroup.name = 'annotation-markers';
    this.viewer.scene.add(this.markerGroup);
  }

  add(surfaceId: string, vertexIndex: number, data?: any, options: AnnotationOptions = {}): string | null {
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
    if (vertexIndex < 0 || vertexIndex >= positionAttr.count) {
      console.warn(`AnnotationManager: vertex index ${vertexIndex} out of range`);
      return null;
    }

    const colorOn = options.colorOn === undefined ? undefined : rgbInteger(options.colorOn, 'colorOn');
    const colorOff = options.colorOff === undefined ? undefined : rgbInteger(options.colorOff, 'colorOff');
    const id = `ann_${++this.counter}`;
    const radius = options.radius ?? this.defaultRadius;

    const position = new THREE.Vector3(
      positionAttr.getX(vertexIndex),
      positionAttr.getY(vertexIndex),
      positionAttr.getZ(vertexIndex)
    );

    // Use instancing when many markers are present to keep CPU and draw calls low
    const useInstanced = this.annotations.size + 1 >= this.instancedThreshold;
    let marker: THREE.Mesh;

    if (useInstanced) {
      this.ensureInstancedMesh(surface.mesh, radius);
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
      marker,
      data,
      active: !!options.active,
      ...(colorOn !== undefined ? { colorOn } : {}),
      ...(colorOff !== undefined ? { colorOff } : {})
    };

    this.annotations.set(id, record);

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
    if (!positionAttr || vertexIndex < 0 || vertexIndex >= positionAttr.count) return false;

    const position = new THREE.Vector3(
      positionAttr.getX(vertexIndex),
      positionAttr.getY(vertexIndex),
      positionAttr.getZ(vertexIndex)
    );

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
    if (this.instancedMesh) {
      this.instancedMesh.parent?.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
      this.instancedMesh.dispose();
      this.instancedMesh = null;
    }
    this.instanceSlots.clear();
    this.slotIds = [];
    this.viewer.emit('annotation:reset');
    this.viewer.requestRender();
  }

  dispose(): void {
    this.reset();
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
      this.markerGeometry.dispose();
      this.markerGeometry = nextGeometry;
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
    if (marker.geometry) marker.geometry.dispose();
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
    const slot = this.instanceSlots.get(record.id);
    if (slot !== undefined && this.instancedMesh) {
      this.instancedMesh.setColorAt(slot, new THREE.Color(this.markerColor(record)));
      this.instancedMesh.instanceColor!.needsUpdate = true;
    } else if (record.marker.material instanceof THREE.MeshBasicMaterial) {
      record.marker.material.color.setHex(this.markerColor(record));
    }
  }

  private ensureInstancedMesh(parent: THREE.Object3D, radius: number): void {
    if (this.instancedMesh) return;
    const geometry = new THREE.SphereGeometry(radius || this.defaultRadius, 10, 10);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: true });
    this.instancedMesh = this.createInstancedMesh(geometry, material, this.instancedThreshold * 2);
    parent.add(this.instancedMesh);
  }

  private createInstancedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'annotation-instanced';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    // Only allocated slots are drawn.
    mesh.count = this.slotIds.length;
    return mesh;
  }

  /** Double the instance capacity, keeping every slot's matrix and colour. */
  private growInstancedMesh(): void {
    const old = this.instancedMesh!;
    const capacity = old.instanceMatrix.count * 2;
    const next = this.createInstancedMesh(old.geometry, old.material as THREE.Material, capacity);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    (next.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array);
    const parent = old.parent;
    parent?.remove(old);
    parent?.add(next);
    old.dispose();
    this.instancedMesh = next;
  }

  private writeInstance(record: AnnotationRecord, active: boolean): void {
    if (!this.instancedMesh) return;
    let slot = this.instanceSlots.get(record.id);
    if (slot === undefined) {
      if (this.slotIds.length >= this.instancedMesh.instanceMatrix.count) {
        this.growInstancedMesh();
      }
      slot = this.slotIds.length;
      this.slotIds.push(record.id);
      this.instanceSlots.set(record.id, slot);
    }
    const mesh = this.instancedMesh!;
    mesh.count = this.slotIds.length;
    mesh.setMatrixAt(slot, new THREE.Matrix4().makeTranslation(record.position.x, record.position.y, record.position.z));
    mesh.setColorAt(slot, new THREE.Color(this.markerColor(record, active)));
    this.instancesChanged(mesh);
  }

  /** Free a record's instance slot by moving the last slot into it. */
  private releaseInstance(id: string): void {
    const slot = this.instanceSlots.get(id);
    const mesh = this.instancedMesh;
    if (slot === undefined || !mesh) return;
    const lastSlot = this.slotIds.length - 1;
    const lastId = this.slotIds[lastSlot]!;
    if (slot !== lastSlot) {
      const matrix = new THREE.Matrix4();
      const color = new THREE.Color();
      mesh.getMatrixAt(lastSlot, matrix);
      mesh.getColorAt(lastSlot, color);
      mesh.setMatrixAt(slot, matrix);
      mesh.setColorAt(slot, color);
      this.slotIds[slot] = lastId;
      this.instanceSlots.set(lastId, slot);
    }
    this.slotIds.pop();
    this.instanceSlots.delete(id);
    mesh.count = this.slotIds.length;
    this.instancesChanged(mesh);
  }

  /** Upload instance changes and drop cached bounds (used for culling and raycasts). */
  private instancesChanged(mesh: THREE.InstancedMesh): void {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.boundingSphere = null;
    mesh.boundingBox = null;
  }
}
