import * as THREE from 'three';
import { SurfaceGeometry } from './classes';
import { MultiLayerNeuroSurface, MultiLayerSurfaceConfig } from './MultiLayerNeuroSurface';
import { SurfaceSet } from './SurfaceSet';
import { finiteNumber } from './utils/validation';

export interface VariantTransitionOptions {
  animate?: boolean;
  duration?: number;
  ease?: (t: number) => number;
}

/**
 * A multi-layer surface that can switch between multiple geometric embeddings
 * (e.g., pial, white, inflated) that share the same topology and data indices.
 *
 * An animated switch interpolates positions and normals each frame, keeps the
 * mesh's bounds around both shapes while it runs (so culling and picking see
 * it), and emits `variant:animating` per frame and `variant:changed` at the
 * end. Switching again while a switch runs (including back to the variant it
 * started from) starts from the shape on screen.
 */
export class VariantSurface extends MultiLayerNeuroSurface {
  surfaceSet: SurfaceSet;
  private currentVariantName: string;
  /** The variant an animated switch is heading to; null when settled. */
  private pendingVariantName: string | null;
  private variantAnimationId: number | null;
  /** Vertex normals per variant, computed on first use. */
  private variantNormals: Map<string, Float32Array>;

  constructor(surfaceSet: SurfaceSet, config: MultiLayerSurfaceConfig = {}) {
    const basePositions = new Float32Array(surfaceSet.getPositions(surfaceSet.defaultVariant));
    const baseCurv = surfaceSet.getCurv(surfaceSet.defaultVariant) || null;
    const geometry = new SurfaceGeometry(basePositions, surfaceSet.faces, surfaceSet.hemi, baseCurv);
    super(geometry, config);

    this.surfaceSet = surfaceSet;
    this.currentVariantName = surfaceSet.defaultVariant;
    this.pendingVariantName = null;
    this.variantAnimationId = null;
    this.variantNormals = new Map();
  }

  /** The variant shown once any running switch ends (the settled one otherwise). */
  currentVariant(): string {
    return this.currentVariantName;
  }

  /** The variant a running switch is heading to, or the current one when settled. */
  targetVariant(): string {
    return this.pendingVariantName ?? this.currentVariantName;
  }

  /** Whether an animated switch is running. */
  isAnimating(): boolean {
    return this.variantAnimationId !== null;
  }

  variantNames(): string[] {
    return this.surfaceSet.getVariantNames();
  }

  /**
   * Add or replace an embedding (see `SurfaceSet.addVariant`). Replacing the
   * variant on screen updates the mesh at once.
   */
  addVariant(name: string, positions: Float32Array | number[], curv?: Float32Array | number[]): void {
    this.surfaceSet.addVariant(name, positions, curv);
    this.variantNormals.delete(name);
    const geometry = this.mesh?.geometry as THREE.BufferGeometry | undefined;
    const positionAttr = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (name === this.currentVariantName && !this.isAnimating() && geometry && positionAttr) {
      this.settle(name, this.surfaceSet.getPositions(name), geometry, positionAttr);
    }
  }

  /**
   * Remove an embedding. The default variant, the one shown and the one a
   * switch is heading to cannot be removed; returns false for those.
   */
  removeVariant(name: string): boolean {
    if (name === this.currentVariantName || name === this.pendingVariantName) return false;
    const removed = this.surfaceSet.removeVariant(name);
    if (removed) this.variantNormals.delete(name);
    return removed;
  }

  setVariant(name: string, options: VariantTransitionOptions = {}): void {
    const duration = finiteNumber(options.duration ?? 300, 'duration', { minimum: 0 });
    if (!this.surfaceSet.hasVariant(name)) {
      console.warn(`VariantSurface: variant "${name}" not found`);
      return;
    }
    if (name === this.targetVariant()) return;

    const { animate = true, ease = (t: number) => t } = options;
    const target = this.surfaceSet.getPositions(name);
    const geometry = this.mesh?.geometry as THREE.BufferGeometry;
    if (!geometry) return;
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!positionAttr) return;

    if (this.variantAnimationId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.variantAnimationId);
    }
    this.variantAnimationId = null;

    const doAnimate = animate && duration > 0 && typeof requestAnimationFrame !== 'undefined';

    if (!doAnimate) {
      this.pendingVariantName = null;
      this.settle(name, target, geometry, positionAttr);
      return;
    }

    // Start from the shape on screen (mid-switch included).
    const startPositions = new Float32Array(positionAttr.array as ArrayLike<number>);
    const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const startNormals = normalAttr ? new Float32Array(normalAttr.array as ArrayLike<number>) : null;
    const targetNormals = normalAttr ? this.normalsOf(name) : null;
    this.coverBoth(geometry, startPositions, target);
    this.pendingVariantName = name;

    const start = performance.now();
    const animateFrame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const k = finiteNumber(ease ? ease(t) : t, 'ease result');
      const arr = positionAttr.array as Float32Array;
      for (let i = 0; i < arr.length; i++) {
        // SurfaceSet and the position attribute have already established equal shapes.
        arr[i] = startPositions[i]! + (target[i]! - startPositions[i]!) * k;
      }
      positionAttr.needsUpdate = true;
      if (normalAttr && startNormals && targetNormals) {
        const n = normalAttr.array as Float32Array;
        for (let i = 0; i < n.length; i += 3) {
          const x = startNormals[i]! + (targetNormals[i]! - startNormals[i]!) * k;
          const y = startNormals[i + 1]! + (targetNormals[i + 1]! - startNormals[i + 1]!) * k;
          const z = startNormals[i + 2]! + (targetNormals[i + 2]! - startNormals[i + 2]!) * k;
          const len = Math.hypot(x, y, z) || 1;
          n[i] = x / len;
          n[i + 1] = y / len;
          n[i + 2] = z / len;
        }
        normalAttr.needsUpdate = true;
      }
      this.emit('variant:animating', { surface: this, variant: name, progress: t, weight: k });
      this.emit('render:needed', { surface: this });

      if (t < 1) {
        this.variantAnimationId = requestAnimationFrame(animateFrame);
      } else {
        this.variantAnimationId = null;
        this.pendingVariantName = null;
        this.settle(name, target, geometry, positionAttr);
      }
    };

    this.variantAnimationId = requestAnimationFrame(animateFrame);
  }

  /** Put `name` on the mesh exactly: positions, normals, bounds, events. */
  private settle(
    name: string,
    target: Float32Array,
    geometry: THREE.BufferGeometry,
    positionAttr: THREE.BufferAttribute
  ): void {
    (positionAttr.array as Float32Array).set(target);
    positionAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.geometry.vertices.set(target);
    this.geometry.invalidateBounds?.();
    this.currentVariantName = name;
    this.emit('geometry:updated', { surface: this });
    this.emit('variant:changed', { surface: this, variant: name });
    this.emit('render:needed', { surface: this });
  }

  /** Vertex normals of a variant's shape (cached). */
  private normalsOf(name: string): Float32Array {
    const cached = this.variantNormals.get(name);
    if (cached) return cached;
    const scratch = new THREE.BufferGeometry();
    scratch.setAttribute('position', new THREE.BufferAttribute(this.surfaceSet.getPositions(name), 3));
    scratch.setIndex(new THREE.BufferAttribute(this.surfaceSet.faces, 1));
    scratch.computeVertexNormals();
    const normals = new Float32Array((scratch.getAttribute('normal') as THREE.BufferAttribute).array as ArrayLike<number>);
    scratch.dispose();
    this.variantNormals.set(name, normals);
    return normals;
  }

  /**
   * Bounds holding both shapes: every interpolated vertex lies in the box of
   * its two endpoints, so frustum culling and raycasting stay correct.
   */
  private coverBoth(geometry: THREE.BufferGeometry, from: Float32Array, to: Float32Array): void {
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const positions of [from, to]) {
      for (let i = 0; i < positions.length; i += 3) {
        box.expandByPoint(point.set(positions[i]!, positions[i + 1]!, positions[i + 2]!));
      }
    }
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  }

  dispose(): void {
    if (this.variantAnimationId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.variantAnimationId);
      this.variantAnimationId = null;
    }
    this.pendingVariantName = null;
    this.variantNormals.clear();
    super.dispose();
  }
}

export default VariantSurface;
