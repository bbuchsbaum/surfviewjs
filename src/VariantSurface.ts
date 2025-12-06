import * as THREE from 'three';
import { SurfaceGeometry } from './classes';
import { MultiLayerNeuroSurface, MultiLayerSurfaceConfig } from './MultiLayerNeuroSurface';
import { SurfaceSet } from './SurfaceSet';

export interface VariantTransitionOptions {
  animate?: boolean;
  duration?: number;
  ease?: (t: number) => number;
}

/**
 * A multi-layer surface that can switch between multiple geometric embeddings
 * (e.g., pial, white, inflated) that share the same topology and data indices.
 */
export class VariantSurface extends MultiLayerNeuroSurface {
  surfaceSet: SurfaceSet;
  private currentVariantName: string;
  private variantAnimationId: number | null;

  constructor(surfaceSet: SurfaceSet, config: MultiLayerSurfaceConfig = {}) {
    const basePositions = new Float32Array(surfaceSet.getPositions(surfaceSet.defaultVariant));
    const baseCurv = surfaceSet.getCurv(surfaceSet.defaultVariant) || null;
    const geometry = new SurfaceGeometry(basePositions, surfaceSet.faces, surfaceSet.hemi, baseCurv);
    super(geometry, config);

    this.surfaceSet = surfaceSet;
    this.currentVariantName = surfaceSet.defaultVariant;
    this.variantAnimationId = null;
  }

  currentVariant(): string {
    return this.currentVariantName;
  }

  variantNames(): string[] {
    return this.surfaceSet.getVariantNames();
  }

  setVariant(name: string, options: VariantTransitionOptions = {}): void {
    if (!this.surfaceSet.hasVariant(name)) {
      console.warn(`VariantSurface: variant "${name}" not found`);
      return;
    }
    if (name === this.currentVariantName) return;

    const { animate = true, duration = 300, ease = (t: number) => t } = options;
    const target = this.surfaceSet.getPositions(name);
    const geometry = this.mesh?.geometry as THREE.BufferGeometry;
    if (!geometry) return;
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!positionAttr) return;

    if (this.variantAnimationId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.variantAnimationId);
      this.variantAnimationId = null;
    }

    const startPositions = new Float32Array(positionAttr.array as ArrayLike<number>);
    const doAnimate = animate && duration > 0 && typeof requestAnimationFrame !== 'undefined';

    if (!doAnimate) {
      (positionAttr.array as Float32Array).set(target);
      positionAttr.needsUpdate = true;
      geometry.computeVertexNormals();
      this.geometry.vertices.set(target);
      this.geometry.invalidateBounds?.();
      this.currentVariantName = name;
      this.emit('geometry:updated', { surface: this });
      this.emit('variant:changed', { surface: this, variant: name });
      this.emit('render:needed', { surface: this });
      return;
    }

    const start = performance.now();
    const animateFrame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const k = ease ? ease(t) : t;
      const arr = positionAttr.array as Float32Array;
      for (let i = 0; i < arr.length; i++) {
        arr[i] = startPositions[i] + (target[i] - startPositions[i]) * k;
      }
      positionAttr.needsUpdate = true;
      this.emit('render:needed', { surface: this });

      if (t < 1) {
        this.variantAnimationId = requestAnimationFrame(animateFrame);
      } else {
        geometry.computeVertexNormals();
        this.geometry.vertices.set(target);
        this.geometry.invalidateBounds?.();
        this.currentVariantName = name;
        this.variantAnimationId = null;
        this.emit('geometry:updated', { surface: this });
        this.emit('variant:changed', { surface: this, variant: name });
        this.emit('render:needed', { surface: this });
      }
    };

    this.variantAnimationId = requestAnimationFrame(animateFrame);
  }

  dispose(): void {
    if (this.variantAnimationId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.variantAnimationId);
      this.variantAnimationId = null;
    }
    super.dispose();
  }
}

export default VariantSurface;
