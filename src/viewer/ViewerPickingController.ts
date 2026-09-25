import * as THREE from 'three';
import { GPUPicker } from '../utils/GPUPicker';

export interface ViewerPickResult {
  surfaceId: string | null;
  vertexIndex: number | null;
  point: THREE.Vector3 | null;
}

export interface ViewerPickOptions {
  x?: number;
  y?: number;
  opacityThreshold?: number;
  useGPU?: boolean;
}

export interface ViewerPickingSurface {
  mesh: THREE.Mesh | null;
}

export interface ViewerPickingHost {
  getCanvas(): Pick<HTMLCanvasElement, 'getBoundingClientRect'>;
  getCamera(): THREE.Camera;
  getSurfaces(): ReadonlyMap<string, ViewerPickingSurface>;
  getGPUPicker(): GPUPicker | null;
  setGPUPicker(picker: GPUPicker | null): void;
}

/** Owns screen-coordinate conversion, CPU raycasting, and GPU-picker lifecycle. */
export class ViewerPickingController {
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  intersectionPoint = new THREE.Vector3();

  constructor(private readonly host: ViewerPickingHost) {}

  updateScreenPosition(x: number, y: number): THREE.Vector2 {
    const rect = this.host.getCanvas().getBoundingClientRect();
    this.mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((y - rect.top) / rect.height) * 2 + 1;
    return this.mouse;
  }

  pick(options: ViewerPickOptions = {}): ViewerPickResult {
    if (options.x !== undefined && options.y !== undefined) {
      this.updateScreenPosition(options.x, options.y);
    }

    const gpuPicker = this.host.getGPUPicker();
    if ((options.useGPU ?? true) && gpuPicker && options.x !== undefined && options.y !== undefined) {
      const result = gpuPicker.pick(options.x, options.y, this.host.getCamera());
      return {
        surfaceId: result.surfaceId,
        vertexIndex: result.vertexIndex,
        point: result.point
      };
    }

    const opacityThreshold = options.opacityThreshold ?? 0.1;
    this.raycaster.setFromCamera(this.mouse, this.host.getCamera());
    const intersections: Array<THREE.Intersection & { surfaceId?: string }> = [];

    this.host.getSurfaces().forEach((surface, id) => {
      if (!surface.mesh) return;
      const material = surface.mesh.material as THREE.Material | THREE.Material[];
      const isTransparent = Array.isArray(material)
        ? material.every(item => item.opacity < opacityThreshold)
        : material.opacity < opacityThreshold;
      if (isTransparent) return;

      for (const intersection of this.raycaster.intersectObject(surface.mesh, false)) {
        intersections.push(Object.assign(intersection, { surfaceId: id }));
      }
    });

    // Hits are gathered surface by surface; the visible hit is the nearest one
    // across all surfaces, not the first surface's (which may lie behind).
    intersections.sort((left, right) => left.distance - right.distance);
    const hit = intersections[0];
    if (!hit) return { surfaceId: null, vertexIndex: null, point: null };

    const face = hit.face;
    const mesh = hit.object as THREE.Mesh;
    const position = (mesh.geometry as THREE.BufferGeometry)
      .getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!face || !position) {
      return {
        surfaceId: hit.surfaceId ?? null,
        vertexIndex: null,
        point: hit.point.clone()
      };
    }

    let closestIndex = face.a;
    let closestDistance = Infinity;
    const worldPosition = new THREE.Vector3();
    for (const index of [face.a, face.b, face.c]) {
      worldPosition.set(
        position.getX(index),
        position.getY(index),
        position.getZ(index)
      ).applyMatrix4(mesh.matrixWorld);
      const distance = worldPosition.distanceToSquared(hit.point);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }

    return {
      surfaceId: hit.surfaceId ?? null,
      vertexIndex: closestIndex,
      point: hit.point.clone()
    };
  }

  initializeGPU(renderer: THREE.WebGLRenderer, enabled: boolean): boolean {
    if (!enabled) return false;
    return this.enableGPU(renderer);
  }

  enableGPU(renderer: THREE.WebGLRenderer): boolean {
    const existing = this.host.getGPUPicker();
    if (existing) {
      existing.setEnabled(true);
      return true;
    }
    if (!GPUPicker.isSupported(renderer)) return false;

    const picker = new GPUPicker(renderer);
    this.host.getSurfaces().forEach((surface, id) => {
      if (surface.mesh) picker.addSurface(id, surface.mesh);
    });
    this.host.setGPUPicker(picker);
    return true;
  }

  disableGPU(): void {
    this.host.getGPUPicker()?.setEnabled(false);
  }

  isGPUEnabled(): boolean {
    return this.host.getGPUPicker()?.isEnabled() ?? false;
  }

  addSurface(id: string, mesh: THREE.Mesh | null): void {
    if (mesh) this.host.getGPUPicker()?.addSurface(id, mesh);
  }

  removeSurface(id: string): void {
    this.host.getGPUPicker()?.removeSurface(id);
  }

  getIntersectionPoint(): THREE.Vector3 {
    const camera = this.host.getCamera();
    this.raycaster.setFromCamera(this.mouse, camera);
    const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    this.raycaster.ray.intersectPlane(new THREE.Plane(planeNormal, 0), this.intersectionPoint);
    return this.intersectionPoint;
  }

  getRayDirection(): THREE.Vector3 {
    this.raycaster.setFromCamera(this.mouse, this.host.getCamera());
    return this.raycaster.ray.direction.clone();
  }

  dispose(): void {
    this.host.getGPUPicker()?.dispose();
    this.host.setGPUPicker(null);
  }
}
