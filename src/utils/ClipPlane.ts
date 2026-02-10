import * as THREE from 'three';

/**
 * Axis type for clip plane orientation
 */
export type ClipAxis = 'x' | 'y' | 'z';

/**
 * Configuration for a clip plane
 */
export interface ClipPlaneConfig {
  /** Plane normal direction */
  normal?: THREE.Vector3;
  /** Point on the plane */
  point?: THREE.Vector3;
  /** Whether the clip plane is active */
  enabled?: boolean;
  /** Flip the clipping direction */
  flip?: boolean;
}

/**
 * ClipPlane manages a single clipping plane for surface visualization.
 *
 * Clipping removes parts of the surface on one side of the plane,
 * useful for revealing internal structures (e.g., medial wall)
 * or focusing on specific regions.
 *
 * @example
 * ```typescript
 * // Clip at x=0 (midline sagittal cut)
 * const clipX = new ClipPlane();
 * clipX.setFromAxisDistance('x', 0);
 *
 * // Clip using three points
 * const clipCustom = new ClipPlane();
 * clipCustom.setFromPoints(p1, p2, p3);
 * ```
 */
export class ClipPlane {
  /** Plane normal (unit vector pointing toward kept region) */
  normal: THREE.Vector3;

  /** A point on the plane */
  point: THREE.Vector3;

  /** Whether this clip plane is active */
  enabled: boolean;

  /** Internal Three.js Plane for material clipping */
  private _plane: THREE.Plane;

  /** Flip direction flag */
  private _flip: boolean;

  constructor(config: ClipPlaneConfig = {}) {
    this.normal = config.normal?.clone() ?? new THREE.Vector3(1, 0, 0);
    this.point = config.point?.clone() ?? new THREE.Vector3(0, 0, 0);
    this.enabled = config.enabled ?? false;
    this._flip = config.flip ?? false;
    this._plane = new THREE.Plane();
    this._updatePlane();
  }

  /**
   * Set clip plane from axis and distance from origin.
   *
   * @param axis - Which axis the plane is perpendicular to ('x', 'y', or 'z')
   * @param distance - Distance from origin along the axis
   * @param flip - If true, flip which side is clipped (default: false)
   */
  setFromAxisDistance(axis: ClipAxis, distance: number, flip = false): this {
    this._flip = flip;

    switch (axis) {
      case 'x':
        this.normal.set(1, 0, 0);
        this.point.set(distance, 0, 0);
        break;
      case 'y':
        this.normal.set(0, 1, 0);
        this.point.set(0, distance, 0);
        break;
      case 'z':
        this.normal.set(0, 0, 1);
        this.point.set(0, 0, distance);
        break;
    }

    if (flip) {
      this.normal.negate();
    }

    this._updatePlane();
    return this;
  }

  /**
   * Set clip plane from three points.
   * The plane normal is computed using the right-hand rule.
   *
   * @param a - First point
   * @param b - Second point
   * @param c - Third point
   */
  setFromPoints(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3
  ): this {
    const edge1 = new THREE.Vector3().subVectors(b, a);
    const edge2 = new THREE.Vector3().subVectors(c, a);

    this.normal.crossVectors(edge1, edge2).normalize();
    this.point.copy(a);

    if (this._flip) {
      this.normal.negate();
    }

    this._updatePlane();
    return this;
  }

  /**
   * Set clip plane from normal and point directly.
   *
   * @param normal - Plane normal (will be normalized)
   * @param point - Point on the plane
   */
  setFromNormalAndPoint(normal: THREE.Vector3, point: THREE.Vector3): this {
    this.normal.copy(normal).normalize();
    this.point.copy(point);

    if (this._flip) {
      this.normal.negate();
    }

    this._updatePlane();
    return this;
  }

  /**
   * Set the distance along the current normal direction.
   * Useful for slider-based interaction.
   *
   * @param distance - Distance from origin along normal
   */
  setDistance(distance: number): this {
    // Move point along the normal direction
    this.point.copy(this.normal).multiplyScalar(distance);
    this._updatePlane();
    return this;
  }

  /**
   * Get the current distance from origin.
   */
  getDistance(): number {
    return this.point.dot(this.normal);
  }

  /**
   * Enable or disable the clip plane.
   */
  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    return this;
  }

  /**
   * Toggle the enabled state.
   */
  toggle(): this {
    this.enabled = !this.enabled;
    return this;
  }

  /**
   * Flip the clipping direction (swap which side is kept/clipped).
   */
  flip(): this {
    this._flip = !this._flip;
    this.normal.negate();
    this._updatePlane();
    return this;
  }

  /**
   * Get the Three.js Plane object for use with material clipping.
   */
  getThreePlane(): THREE.Plane {
    return this._plane;
  }

  /**
   * Get shader uniform values for GPU clipping.
   */
  getShaderUniforms(): { normal: THREE.Vector3; point: THREE.Vector3; enabled: boolean } {
    return {
      normal: this.normal.clone(),
      point: this.point.clone(),
      enabled: this.enabled
    };
  }

  toStateJSON(): { axis: string; normal: [number, number, number]; distance: number; enabled: boolean; flip: boolean } {
    const n = this.normal;
    // Detect axis from normal
    let axis: string = 'custom';
    if (Math.abs(Math.abs(n.x) - 1) < 0.001 && Math.abs(n.y) < 0.001 && Math.abs(n.z) < 0.001) axis = 'x';
    else if (Math.abs(n.x) < 0.001 && Math.abs(Math.abs(n.y) - 1) < 0.001 && Math.abs(n.z) < 0.001) axis = 'y';
    else if (Math.abs(n.x) < 0.001 && Math.abs(n.y) < 0.001 && Math.abs(Math.abs(n.z) - 1) < 0.001) axis = 'z';
    return {
      axis,
      normal: [n.x, n.y, n.z],
      distance: this.getDistance(),
      enabled: this.enabled,
      flip: this._flip
    };
  }

  /**
   * Clone this clip plane.
   */
  clone(): ClipPlane {
    return new ClipPlane({
      normal: this.normal.clone(),
      point: this.point.clone(),
      enabled: this.enabled,
      flip: this._flip
    });
  }

  /**
   * Update the internal Three.js Plane from normal and point.
   */
  private _updatePlane(): void {
    // THREE.Plane uses form: n·x + d = 0
    // where d = -n·point
    this._plane.setFromNormalAndCoplanarPoint(this.normal, this.point);
  }
}

/**
 * Manages multiple clip planes for a surface.
 *
 * Provides convenience methods for common clipping operations
 * and synchronizes with both CPU and GPU rendering modes.
 */
export class ClipPlaneSet {
  /** Clip planes indexed by axis */
  readonly x: ClipPlane;
  readonly y: ClipPlane;
  readonly z: ClipPlane;

  /** Array of all clip planes for iteration */
  private _planes: ClipPlane[];

  constructor() {
    this.x = new ClipPlane().setFromAxisDistance('x', 0);
    this.y = new ClipPlane().setFromAxisDistance('y', 0);
    this.z = new ClipPlane().setFromAxisDistance('z', 0);
    this._planes = [this.x, this.y, this.z];
  }

  /**
   * Set a clip plane by axis.
   *
   * @param axis - Which axis to clip
   * @param distance - Distance from origin
   * @param enabled - Whether to enable (default: true)
   * @param flip - Flip clipping direction (default: false)
   */
  setClipPlane(
    axis: ClipAxis,
    distance: number,
    enabled = true,
    flip = false
  ): this {
    const plane = this[axis];
    plane.setFromAxisDistance(axis, distance, flip);
    plane.setEnabled(enabled);
    return this;
  }

  /**
   * Get clip plane by axis.
   */
  getClipPlane(axis: ClipAxis): ClipPlane {
    return this[axis];
  }

  /**
   * Enable a clip plane.
   */
  enableClipPlane(axis: ClipAxis): this {
    this[axis].setEnabled(true);
    return this;
  }

  /**
   * Disable a clip plane.
   */
  disableClipPlane(axis: ClipAxis): this {
    this[axis].setEnabled(false);
    return this;
  }

  /**
   * Disable all clip planes.
   */
  clearClipPlanes(): this {
    this._planes.forEach(p => p.setEnabled(false));
    return this;
  }

  /**
   * Get all enabled clip planes as Three.js Plane array.
   * For use with material.clippingPlanes.
   */
  getThreePlanes(): THREE.Plane[] {
    return this._planes
      .filter(p => p.enabled)
      .map(p => p.getThreePlane());
  }

  /**
   * Get all clip planes (enabled and disabled).
   */
  getAllPlanes(): ClipPlane[] {
    return [...this._planes];
  }

  /**
   * Get enabled planes only.
   */
  getEnabledPlanes(): ClipPlane[] {
    return this._planes.filter(p => p.enabled);
  }

  /**
   * Check if any clip plane is enabled.
   */
  hasEnabledPlanes(): boolean {
    return this._planes.some(p => p.enabled);
  }

  toStateJSON(): Array<{ axis: string; normal: [number, number, number]; distance: number; enabled: boolean; flip: boolean }> {
    return this._planes.map(p => p.toStateJSON());
  }

  /**
   * Get shader uniforms for all three planes.
   */
  getShaderUniforms(): {
    clipPlaneX: { normal: THREE.Vector3; point: THREE.Vector3; enabled: boolean };
    clipPlaneY: { normal: THREE.Vector3; point: THREE.Vector3; enabled: boolean };
    clipPlaneZ: { normal: THREE.Vector3; point: THREE.Vector3; enabled: boolean };
  } {
    return {
      clipPlaneX: this.x.getShaderUniforms(),
      clipPlaneY: this.y.getShaderUniforms(),
      clipPlaneZ: this.z.getShaderUniforms()
    };
  }
}
