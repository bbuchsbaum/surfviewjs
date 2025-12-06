import * as THREE from 'three';
import type { NeuroSurfaceViewer } from './NeuroSurfaceViewer';
import type { NeuroSurface } from './classes';

export interface AnnotationOptions {
  radius?: number;
  colorOn?: number;
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
  private instanceColors: Float32Array | null = null;

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
        options.active ? this.defaultOnMaterial.clone() : this.defaultOffMaterial.clone()
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
      active: !!options.active
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

    this.viewer.emit('annotation:added', { annotation: record });
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

    if (this.instancedMesh && this.instanceColors) {
      this.writeInstance(record, record.active);
    } else if (record.marker) {
      record.marker.position.copy(position);
    }

    this.viewer.emit('annotation:moved', { annotation: record });
    this.viewer.requestRender();
    return true;
  }

  get(id: string): AnnotationRecord | undefined {
    return this.annotations.get(id);
  }

  remove(id: string): void {
    const record = this.annotations.get(id);
    if (!record) return;

    if (this.instancedMesh) {
      // Mark instance as transparent by setting alpha to zero color (no real alpha, but outside palette)
      const idx = this.instanceIndex(record.id);
      if (idx >= 0 && this.instanceColors) {
        this.instanceColors[idx * 3 + 0] = 0;
        this.instanceColors[idx * 3 + 1] = 0;
        this.instanceColors[idx * 3 + 2] = 0;
        this.instancedMesh.instanceColor!.needsUpdate = true;
      }
    }

    if (record.marker.parent) {
      record.marker.parent.remove(record.marker);
    }
    this.disposeMarker(record.marker);
    this.annotations.delete(id);
    this.viewer.emit('annotation:removed', { annotation: record });
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
      this.viewer.scene.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
      this.instancedMesh = null;
      this.instanceColors = null;
    }
    this.viewer.emit('annotation:reset', {});
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

      if (this.instancedMesh && this.instanceColors) {
        const idx = this.instanceIndex(rec.id);
        if (idx >= 0) {
          const hex = isActive ? this.defaultOnMaterial.color.getHex() : this.defaultOffMaterial.color.getHex();
          const color = new THREE.Color(hex);
          this.instanceColors[idx * 3 + 0] = color.r;
          this.instanceColors[idx * 3 + 1] = color.g;
          this.instanceColors[idx * 3 + 2] = color.b;
        }
      } else if (rec.marker.material instanceof THREE.Material) {
        const mat = rec.marker.material as THREE.MeshBasicMaterial;
        mat.color.setHex(isActive ? this.defaultOnMaterial.color.getHex() : this.defaultOffMaterial.color.getHex());
      }
    });

    if (this.instancedMesh && this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    this.viewer.emit('annotation:activated', { annotation: target });
    this.viewer.requestRender();
  }

  forEach(callback: (annotation: AnnotationRecord) => void): void {
    this.annotations.forEach(callback);
  }

  setDefaults(defaults: { radius?: number; colorOn?: number; colorOff?: number }): void {
    if (defaults.radius !== undefined) {
      this.defaultRadius = defaults.radius;
      this.markerGeometry.dispose();
      this.markerGeometry = new THREE.SphereGeometry(this.defaultRadius, 12, 12);
    }
    if (defaults.colorOn !== undefined) {
      this.defaultOnMaterial.color.setHex(defaults.colorOn);
    }
    if (defaults.colorOff !== undefined) {
      this.defaultOffMaterial.color.setHex(defaults.colorOff);
    }
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

  private ensureInstancedMesh(parent: THREE.Object3D, radius: number): void {
    if (this.instancedMesh) return;
    const geometry = new THREE.SphereGeometry(radius || this.defaultRadius, 10, 10);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: true });
    // Allocate generously; will grow if needed
    const capacity = Math.max(this.instancedThreshold * 2, this.annotations.size + 1);
    this.instancedMesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.instancedMesh.name = 'annotation-instanced';
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.instanceColors = this.instancedMesh.instanceColor.array as Float32Array;
    parent.add(this.instancedMesh);
  }

  private writeInstance(record: AnnotationRecord, active: boolean): void {
    if (!this.instancedMesh || !this.instanceColors || !record) return;
    const mesh = this.instancedMesh;
    const color = new THREE.Color(active ? this.defaultOnMaterial.color : this.defaultOffMaterial.color);
    const idx = this.instanceIndex(record.id, true);
    const matrix = new THREE.Matrix4().makeTranslation(record.position.x, record.position.y, record.position.z);
    mesh.setMatrixAt(idx, matrix);
    this.instanceColors[idx * 3 + 0] = color.r;
    this.instanceColors[idx * 3 + 1] = color.g;
    this.instanceColors[idx * 3 + 2] = color.b;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  }

  private instanceIndex(id: string, allowGrow = false): number {
    // Simple deterministic slot: store numeric suffix
    const numeric = parseInt(id.replace('ann_', ''), 10);
    if (!this.instancedMesh || Number.isNaN(numeric)) return -1;
    if (numeric >= this.instancedMesh.count) {
      if (allowGrow) {
        const newCount = numeric + 1;
        this.instancedMesh.count = newCount;
      } else {
        return -1;
      }
    }
    return numeric;
  }
}
