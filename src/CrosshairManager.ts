import * as THREE from 'three';

export type CrosshairMode = 'selection' | 'hover';

export interface CrosshairOptions {
  size?: number;
  color?: number;
  mode?: CrosshairMode;
}

/**
 * Manages a 3D crosshair (three orthogonal lines) that can be positioned
 * at a vertex on a surface mesh. Supports selection and hover modes.
 */
export class CrosshairManager {
  private group: THREE.Group | null = null;
  private material: THREE.LineBasicMaterial | null = null;
  private parent: THREE.Object3D | null = null;

  size = 1.5;
  color = 0xffcc00;
  surfaceId: string | null = null;
  vertexIndex: number | null = null;
  visible = false;
  mode: CrosshairMode | null = null;

  hoverThrottleMs = 80;
  lastHoverUpdate = 0;

  private requestRender: () => void;

  constructor(requestRender: () => void) {
    this.requestRender = requestRender;
  }

  /**
   * Show the crosshair at a specific vertex on a mesh.
   */
  show(
    mesh: THREE.Mesh,
    surfaceId: string,
    vertexIndex: number,
    options?: CrosshairOptions
  ): void {
    const positionAttr = (mesh.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!positionAttr || vertexIndex < 0 || vertexIndex >= positionAttr.count) {
      console.warn(`Crosshair: invalid vertex index ${vertexIndex}`);
      return;
    }

    const crosshair = this.ensureGroup(options?.size, options?.color);

    if (this.parent && this.parent !== mesh && this.group) {
      this.parent.remove(this.group);
    }

    if (this.group && this.group.parent !== mesh) {
      mesh.add(this.group);
    }

    if (this.group) {
      this.group.position.set(
        positionAttr.getX(vertexIndex),
        positionAttr.getY(vertexIndex),
        positionAttr.getZ(vertexIndex)
      );
      this.group.visible = true;
    }

    this.parent = mesh;
    this.surfaceId = surfaceId;
    this.vertexIndex = vertexIndex;
    this.visible = true;
    this.mode = options?.mode ?? 'selection';
    this.requestRender();
  }

  /**
   * Hide the crosshair and clear tracking state.
   */
  hide(): void {
    if (this.group && this.parent) {
      this.parent.remove(this.group);
    }
    if (this.group) {
      this.group.visible = false;
    }
    this.visible = false;
    this.surfaceId = null;
    this.vertexIndex = null;
    this.parent = null;
    this.mode = null;
    this.requestRender();
  }

  /**
   * Toggle crosshair visibility. If hidden and a target is provided (or
   * remembered from a previous show()), it will be re-shown.
   */
  toggle(
    mesh: THREE.Mesh | null,
    surfaceId?: string,
    vertexIndex?: number,
    options?: CrosshairOptions
  ): void {
    if (this.visible) {
      this.hide();
      return;
    }

    const targetSurface = surfaceId ?? this.surfaceId;
    const targetVertex = vertexIndex ?? this.vertexIndex;

    if (mesh && targetSurface && targetVertex !== null) {
      this.show(mesh, targetSurface, targetVertex, options);
    }
  }

  /**
   * Returns true if a hover update is allowed (throttle has elapsed).
   */
  canHoverUpdate(): boolean {
    const now = performance.now();
    if (now - this.lastHoverUpdate < this.hoverThrottleMs) return false;
    this.lastHoverUpdate = now;
    return true;
  }

  toStateJSON(): { visible: boolean; surfaceId: string | null; vertexIndex: number | null; size: number; color: number; mode: string | null } {
    return {
      visible: this.visible,
      surfaceId: this.surfaceId,
      vertexIndex: this.vertexIndex,
      size: this.size,
      color: this.color,
      mode: this.mode
    };
  }

  /**
   * Dispose all GPU resources (geometries, material).
   */
  dispose(): void {
    if (this.group) {
      if (this.group.parent) {
        this.group.parent.remove(this.group);
      }
      this.group.children.forEach(child => {
        const line = child as THREE.Line;
        line.geometry.dispose();
      });
      this.group = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private ensureGroup(size?: number, color?: number): THREE.Group {
    const desiredSize = size ?? this.size;
    const desiredColor = color ?? this.color;
    const sizeChanged = desiredSize !== this.size;
    const colorChanged = desiredColor !== this.color;

    if (!this.group || sizeChanged) {
      if (this.group && this.parent) {
        this.parent.remove(this.group);
      }
      this.dispose();
      this.group = this.buildGroup(desiredSize, desiredColor);
      const firstLine = this.group.children[0] as THREE.Line;
      this.material = firstLine.material as THREE.LineBasicMaterial;
    } else if (colorChanged && this.material) {
      this.material.color.setHex(desiredColor);
    }

    this.size = desiredSize;
    this.color = desiredColor;
    return this.group!;
  }

  private buildGroup(size: number, color: number): THREE.Group {
    const group = new THREE.Group();
    group.name = 'neurosurface-crosshair';
    const half = size / 2;
    const material = new THREE.LineBasicMaterial({
      color,
      depthWrite: false,
      depthTest: false,
      transparent: true
    });

    const makeLine = (from: THREE.Vector3, to: THREE.Vector3) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
      return new THREE.Line(geometry, material);
    };

    group.add(makeLine(new THREE.Vector3(-half, 0, 0), new THREE.Vector3(half, 0, 0)));
    group.add(makeLine(new THREE.Vector3(0, -half, 0), new THREE.Vector3(0, half, 0)));
    group.add(makeLine(new THREE.Vector3(0, 0, -half), new THREE.Vector3(0, 0, half)));
    group.renderOrder = 999;
    return group;
  }
}
