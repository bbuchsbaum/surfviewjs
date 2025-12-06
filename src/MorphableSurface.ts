import * as THREE from 'three';
import { SurfaceGeometry } from './classes';
import { MultiLayerNeuroSurface, MultiLayerSurfaceConfig } from './MultiLayerNeuroSurface';
import { SurfaceSet } from './SurfaceSet';
import { debugLog } from './debug';

/**
 * Easing functions for morph animations
 */
export type EasingFunction = (t: number) => number;

export const Easing = {
  /** Linear interpolation (no easing) */
  linear: (t: number) => t,

  /** Smooth start (slow to fast) */
  easeIn: (t: number) => t * t,

  /** Smooth end (fast to slow) */
  easeOut: (t: number) => t * (2 - t),

  /** Smooth start and end */
  easeInOut: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  /** Cubic ease in */
  easeInCubic: (t: number) => t * t * t,

  /** Cubic ease out */
  easeOutCubic: (t: number) => (--t) * t * t + 1,

  /** Cubic ease in-out */
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1
};

export interface MorphTargetConfig {
  /** Name of the morph target (e.g., 'inflated', 'flat', 'sphere') */
  name: string;
  /** Vertex positions for this morph target */
  positions: Float32Array;
  /** Optional curvature data for this target */
  curvature?: Float32Array;
}

export interface MorphAnimationOptions {
  /** Animation duration in milliseconds (default: 500) */
  duration?: number;
  /** Easing function (default: easeInOut) */
  easing?: EasingFunction;
  /** Callback when animation completes */
  onComplete?: () => void;
  /** Callback during animation with progress (0-1) */
  onProgress?: (progress: number) => void;
}

export interface MorphableSurfaceConfig extends MultiLayerSurfaceConfig {
  /** Initial morph targets to add */
  morphTargets?: MorphTargetConfig[];
}

/**
 * A multi-layer surface with GPU-accelerated morph target support.
 *
 * Enables smooth animated transitions between different surface representations
 * (e.g., pial, inflated, flat, sphere) using Three.js morphTargets for
 * GPU-accelerated interpolation with proper normal blending.
 *
 * @example
 * ```typescript
 * // Create from SurfaceSet with multiple variants
 * const surface = MorphableSurface.fromSurfaceSet(surfaceSet, {
 *   baseColor: 0xcccccc
 * });
 *
 * // Animate to inflated view
 * surface.morphTo('inflated', { duration: 500 });
 *
 * // Set morph weight directly (0 = base, 1 = target)
 * surface.setMorphWeight('inflated', 0.5);
 *
 * // Blend between multiple targets
 * surface.setMorphWeights({ inflated: 0.3, flat: 0.7 });
 * ```
 */
export class MorphableSurface extends MultiLayerNeuroSurface {
  /** Map of morph target names to their index in morphAttributes */
  private morphTargetDictionary: Record<string, number> = {};

  /** Ordered list of morph target names */
  private morphTargetNames: string[] = [];

  /** Optional curvature data per morph target */
  private morphTargetCurvatures: Record<string, Float32Array> = {};

  /** Current animation frame ID (for cancellation) */
  private animationId: number | null = null;

  /** Reference to SurfaceSet if created from one */
  private surfaceSet: SurfaceSet | null = null;

  /** Base positions (the original geometry positions) */
  private basePositions: Float32Array;

  constructor(geometry: SurfaceGeometry, config: MorphableSurfaceConfig = {}) {
    super(geometry, config);

    // Store base positions
    this.basePositions = new Float32Array(geometry.vertices);

    // Initialize morph attributes on the geometry
    if (this.mesh && this.mesh.geometry) {
      const bufferGeometry = this.mesh.geometry as THREE.BufferGeometry;
      bufferGeometry.morphAttributes.position = [];

      // Enable morphing on the material (if supported by material type)
      // In Three.js r152+, morphing is enabled automatically when morphAttributes exist
      // For older versions or explicit control, we set the flags if available
      const material = this.mesh.material as any;
      if ('morphTargets' in material) {
        material.morphTargets = true;
      }
      if ('morphNormals' in material) {
        material.morphNormals = true;
      }
      material.needsUpdate = true;
    }

    // Add initial morph targets if provided
    if (config.morphTargets) {
      for (const target of config.morphTargets) {
        this.addMorphTarget(target.name, target.positions, target.curvature);
      }
    }

    debugLog('MorphableSurface created with', this.morphTargetNames.length, 'morph targets');
  }

  /**
   * Create a MorphableSurface from a SurfaceSet with multiple variants.
   * Each variant becomes a morph target.
   */
  static fromSurfaceSet(
    surfaceSet: SurfaceSet,
    config: MorphableSurfaceConfig = {}
  ): MorphableSurface {
    // Use default variant as base geometry
    const basePositions = surfaceSet.getPositions(surfaceSet.defaultVariant);
    const baseCurvature = surfaceSet.getCurv(surfaceSet.defaultVariant);

    const geometry = new SurfaceGeometry(
      basePositions,
      surfaceSet.faces,
      surfaceSet.hemi,
      baseCurvature
    );

    const surface = new MorphableSurface(geometry, config);
    surface.surfaceSet = surfaceSet;

    // Add all variants (except default) as morph targets
    for (const variantName of surfaceSet.getVariantNames()) {
      if (variantName !== surfaceSet.defaultVariant) {
        const positions = surfaceSet.getPositions(variantName);
        const curvature = surfaceSet.getCurv(variantName);
        surface.addMorphTarget(variantName, positions, curvature || undefined);
      }
    }

    debugLog(`MorphableSurface created from SurfaceSet with ${surface.morphTargetNames.length} morph targets`);
    return surface;
  }

  /**
   * Add a morph target with the given name and positions.
   *
   * @param name - Unique name for this morph target
   * @param positions - Vertex positions (must match base geometry vertex count)
   * @param curvature - Optional curvature data for this morph target
   */
  addMorphTarget(name: string, positions: Float32Array | number[], curvature?: Float32Array | number[]): void {
    if (this.morphTargetDictionary[name] !== undefined) {
      console.warn(`MorphableSurface: morph target "${name}" already exists, replacing`);
      this.removeMorphTarget(name);
    }

    const posArray = positions instanceof Float32Array ? positions : new Float32Array(positions);

    if (posArray.length !== this.basePositions.length) {
      throw new Error(
        `MorphableSurface: morph target "${name}" has ${posArray.length / 3} vertices, ` +
        `expected ${this.basePositions.length / 3}`
      );
    }

    if (!this.mesh || !this.mesh.geometry) {
      throw new Error('MorphableSurface: mesh not initialized');
    }

    const bufferGeometry = this.mesh.geometry as THREE.BufferGeometry;

    // Create the morph attribute
    // Note: morphTargets need the DELTA from base position, not absolute positions
    const morphPositions = new Float32Array(posArray.length);
    for (let i = 0; i < posArray.length; i++) {
      morphPositions[i] = posArray[i] - this.basePositions[i];
    }

    const attribute = new THREE.Float32BufferAttribute(morphPositions, 3);
    attribute.name = name;

    // Add to morph attributes
    const morphAttrs = bufferGeometry.morphAttributes.position as THREE.BufferAttribute[];
    const index = morphAttrs.length;
    morphAttrs.push(attribute);

    // Update dictionary
    this.morphTargetDictionary[name] = index;
    this.morphTargetNames.push(name);

    // Store curvature if provided
    if (curvature) {
      this.morphTargetCurvatures[name] = curvature instanceof Float32Array
        ? curvature
        : new Float32Array(curvature);
    }

    // Initialize influence to 0
    if (!this.mesh.morphTargetInfluences) {
      this.mesh.morphTargetInfluences = [];
    }
    this.mesh.morphTargetInfluences[index] = 0;

    // Update mesh's morphTargetDictionary
    this.mesh.morphTargetDictionary = { ...this.morphTargetDictionary };

    // Recompute morph normals
    bufferGeometry.computeVertexNormals();

    debugLog(`Added morph target "${name}" at index ${index}`);
  }

  /**
   * Remove a morph target by name.
   */
  removeMorphTarget(name: string): boolean {
    const index = this.morphTargetDictionary[name];
    if (index === undefined) {
      return false;
    }

    if (!this.mesh || !this.mesh.geometry) {
      return false;
    }

    const bufferGeometry = this.mesh.geometry as THREE.BufferGeometry;
    const morphAttrs = bufferGeometry.morphAttributes.position as THREE.BufferAttribute[];

    // Remove from arrays
    morphAttrs.splice(index, 1);
    this.morphTargetNames.splice(this.morphTargetNames.indexOf(name), 1);
    this.mesh.morphTargetInfluences?.splice(index, 1);

    // Update dictionary (shift indices)
    delete this.morphTargetDictionary[name];
    for (const [key, idx] of Object.entries(this.morphTargetDictionary)) {
      if (idx > index) {
        this.morphTargetDictionary[key] = idx - 1;
      }
    }

    // Update mesh's dictionary
    this.mesh.morphTargetDictionary = { ...this.morphTargetDictionary };

    // Remove curvature
    delete this.morphTargetCurvatures[name];

    debugLog(`Removed morph target "${name}"`);
    return true;
  }

  /**
   * Get the list of available morph target names.
   */
  getMorphTargetNames(): string[] {
    return [...this.morphTargetNames];
  }

  /**
   * Check if a morph target exists.
   */
  hasMorphTarget(name: string): boolean {
    return this.morphTargetDictionary[name] !== undefined;
  }

  /**
   * Get the current weight of a morph target.
   */
  getMorphWeight(name: string): number {
    const index = this.morphTargetDictionary[name];
    if (index === undefined) {
      console.warn(`MorphableSurface: morph target "${name}" not found`);
      return 0;
    }
    return this.mesh?.morphTargetInfluences?.[index] ?? 0;
  }

  /**
   * Get all current morph weights as a dictionary.
   */
  getMorphWeights(): Record<string, number> {
    const weights: Record<string, number> = {};
    for (const name of this.morphTargetNames) {
      weights[name] = this.getMorphWeight(name);
    }
    return weights;
  }

  /**
   * Set the weight of a single morph target (0 = base, 1 = full morph).
   *
   * @param name - Morph target name
   * @param weight - Weight value (typically 0-1, but can exceed for exaggeration)
   */
  setMorphWeight(name: string, weight: number): void {
    const index = this.morphTargetDictionary[name];
    if (index === undefined) {
      console.warn(`MorphableSurface: morph target "${name}" not found`);
      return;
    }

    if (this.mesh?.morphTargetInfluences) {
      this.mesh.morphTargetInfluences[index] = weight;
      this.emit('morph:changed', { surface: this, target: name, weight });
      this.emit('render:needed', { surface: this });
    }
  }

  /**
   * Set multiple morph weights at once.
   *
   * @param weights - Dictionary of target name to weight
   */
  setMorphWeights(weights: Record<string, number>): void {
    for (const [name, weight] of Object.entries(weights)) {
      const index = this.morphTargetDictionary[name];
      if (index !== undefined && this.mesh?.morphTargetInfluences) {
        this.mesh.morphTargetInfluences[index] = weight;
      }
    }
    this.emit('morph:changed', { surface: this, weights });
    this.emit('render:needed', { surface: this });
  }

  /**
   * Reset all morph weights to 0 (return to base geometry).
   */
  resetMorphWeights(): void {
    if (this.mesh?.morphTargetInfluences) {
      for (let i = 0; i < this.mesh.morphTargetInfluences.length; i++) {
        this.mesh.morphTargetInfluences[i] = 0;
      }
      this.emit('morph:changed', { surface: this, weights: this.getMorphWeights() });
      this.emit('render:needed', { surface: this });
    }
  }

  /**
   * Animate morph to a specific target.
   *
   * @param targetName - Name of the morph target to animate to
   * @param options - Animation options
   * @returns Promise that resolves when animation completes
   */
  morphTo(targetName: string, options: MorphAnimationOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      const index = this.morphTargetDictionary[targetName];
      if (index === undefined) {
        console.warn(`MorphableSurface: morph target "${targetName}" not found`);
        resolve();
        return;
      }

      // Cancel any running animation
      this.cancelAnimation();

      const {
        duration = 500,
        easing = Easing.easeInOut,
        onComplete,
        onProgress
      } = options;

      // Get current weights
      const startWeights = this.mesh?.morphTargetInfluences
        ? [...this.mesh.morphTargetInfluences]
        : [];

      // Target weights: all 0 except the target which is 1
      const targetWeights = new Array(this.morphTargetNames.length).fill(0);
      targetWeights[index] = 1;

      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const rawProgress = Math.min(1, elapsed / duration);
        const progress = easing(rawProgress);

        // Interpolate all weights
        if (this.mesh?.morphTargetInfluences) {
          for (let i = 0; i < this.morphTargetNames.length; i++) {
            const start = startWeights[i] ?? 0;
            const target = targetWeights[i];
            this.mesh.morphTargetInfluences[i] = start + (target - start) * progress;
          }
        }

        onProgress?.(rawProgress);
        this.emit('morph:animating', { surface: this, progress: rawProgress });
        this.emit('render:needed', { surface: this });

        if (rawProgress < 1) {
          this.animationId = requestAnimationFrame(animate);
        } else {
          this.animationId = null;
          this.emit('morph:complete', { surface: this, target: targetName });
          onComplete?.();
          resolve();
        }
      };

      this.animationId = requestAnimationFrame(animate);
    });
  }

  /**
   * Animate morph from current state back to base geometry (all weights = 0).
   */
  morphToBase(options: MorphAnimationOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      // Cancel any running animation
      this.cancelAnimation();

      const {
        duration = 500,
        easing = Easing.easeInOut,
        onComplete,
        onProgress
      } = options;

      // Get current weights
      const startWeights = this.mesh?.morphTargetInfluences
        ? [...this.mesh.morphTargetInfluences]
        : [];

      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const rawProgress = Math.min(1, elapsed / duration);
        const progress = easing(rawProgress);

        // Interpolate all weights toward 0
        if (this.mesh?.morphTargetInfluences) {
          for (let i = 0; i < this.morphTargetNames.length; i++) {
            const start = startWeights[i] ?? 0;
            this.mesh.morphTargetInfluences[i] = start * (1 - progress);
          }
        }

        onProgress?.(rawProgress);
        this.emit('morph:animating', { surface: this, progress: rawProgress });
        this.emit('render:needed', { surface: this });

        if (rawProgress < 1) {
          this.animationId = requestAnimationFrame(animate);
        } else {
          this.animationId = null;
          this.emit('morph:complete', { surface: this, target: 'base' });
          onComplete?.();
          resolve();
        }
      };

      this.animationId = requestAnimationFrame(animate);
    });
  }

  /**
   * Animate a smooth blend between multiple targets.
   *
   * @param targetWeights - Dictionary of target names to their final weights
   * @param options - Animation options
   */
  morphToWeights(
    targetWeights: Record<string, number>,
    options: MorphAnimationOptions = {}
  ): Promise<void> {
    return new Promise((resolve) => {
      // Cancel any running animation
      this.cancelAnimation();

      const {
        duration = 500,
        easing = Easing.easeInOut,
        onComplete,
        onProgress
      } = options;

      // Get current weights
      const startWeights = this.mesh?.morphTargetInfluences
        ? [...this.mesh.morphTargetInfluences]
        : [];

      // Build target array
      const targetArray = this.morphTargetNames.map(name => targetWeights[name] ?? 0);

      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const rawProgress = Math.min(1, elapsed / duration);
        const progress = easing(rawProgress);

        // Interpolate all weights
        if (this.mesh?.morphTargetInfluences) {
          for (let i = 0; i < this.morphTargetNames.length; i++) {
            const start = startWeights[i] ?? 0;
            const target = targetArray[i];
            this.mesh.morphTargetInfluences[i] = start + (target - start) * progress;
          }
        }

        onProgress?.(rawProgress);
        this.emit('morph:animating', { surface: this, progress: rawProgress });
        this.emit('render:needed', { surface: this });

        if (rawProgress < 1) {
          this.animationId = requestAnimationFrame(animate);
        } else {
          this.animationId = null;
          this.emit('morph:complete', { surface: this, weights: targetWeights });
          onComplete?.();
          resolve();
        }
      };

      this.animationId = requestAnimationFrame(animate);
    });
  }

  /**
   * Cancel any running morph animation.
   */
  cancelAnimation(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
      this.emit('morph:cancelled', { surface: this });
    }
  }

  /**
   * Check if an animation is currently running.
   */
  isAnimating(): boolean {
    return this.animationId !== null;
  }

  /**
   * Get a normalized morph value (0 = base, 1 = first target, 2 = second target, etc.)
   * that can be used with a slider for sequential morphing through targets.
   */
  getMorphValue(): number {
    if (!this.mesh?.morphTargetInfluences || this.morphTargetNames.length === 0) {
      return 0;
    }

    // Calculate weighted position
    let value = 0;
    for (let i = 0; i < this.morphTargetNames.length; i++) {
      value += (i + 1) * (this.mesh.morphTargetInfluences[i] ?? 0);
    }
    return value;
  }

  /**
   * Set morph using a normalized value (0 = base, 1 = first target, 2 = second target, etc.)
   * Useful for slider-based sequential morphing.
   *
   * @param value - Normalized morph value
   */
  setMorphValue(value: number): void {
    if (!this.mesh?.morphTargetInfluences || this.morphTargetNames.length === 0) {
      return;
    }

    value = Math.max(0, Math.min(this.morphTargetNames.length, value));

    // Reset all influences
    for (let i = 0; i < this.mesh.morphTargetInfluences.length; i++) {
      this.mesh.morphTargetInfluences[i] = 0;
    }

    if (value === 0) {
      // At base
      this.emit('morph:changed', { surface: this, weights: this.getMorphWeights() });
      this.emit('render:needed', { surface: this });
      return;
    }

    // Find the two targets to blend between
    const lowerIndex = Math.floor(value) - 1;
    const upperIndex = Math.ceil(value) - 1;
    const blend = value - Math.floor(value);

    if (lowerIndex >= 0 && lowerIndex < this.morphTargetNames.length) {
      this.mesh.morphTargetInfluences[lowerIndex] = 1 - blend;
    }
    if (upperIndex >= 0 && upperIndex < this.morphTargetNames.length && upperIndex !== lowerIndex) {
      this.mesh.morphTargetInfluences[upperIndex] = blend;
    } else if (upperIndex === lowerIndex && upperIndex >= 0) {
      this.mesh.morphTargetInfluences[upperIndex] = 1;
    }

    this.emit('morph:changed', { surface: this, weights: this.getMorphWeights() });
    this.emit('render:needed', { surface: this });
  }

  /**
   * Get curvature data for the current morph state (interpolated if blending).
   * Returns null if no curvature data is available.
   */
  getInterpolatedCurvature(): Float32Array | null {
    if (!this.mesh?.morphTargetInfluences) {
      return this.geometry.vertexCurv;
    }

    // Check if we have any curvature data
    const baseCurv = this.geometry.vertexCurv;
    if (!baseCurv && Object.keys(this.morphTargetCurvatures).length === 0) {
      return null;
    }

    const vertexCount = this.vertexCount;
    const result = new Float32Array(vertexCount);

    // Start with base curvature weighted by (1 - sum of influences)
    let totalInfluence = 0;
    for (const influence of this.mesh.morphTargetInfluences) {
      totalInfluence += influence;
    }
    const baseWeight = Math.max(0, 1 - totalInfluence);

    if (baseCurv && baseWeight > 0) {
      for (let i = 0; i < vertexCount; i++) {
        result[i] = baseCurv[i] * baseWeight;
      }
    }

    // Add weighted morph target curvatures
    for (let i = 0; i < this.morphTargetNames.length; i++) {
      const name = this.morphTargetNames[i];
      const influence = this.mesh.morphTargetInfluences[i] ?? 0;
      const curv = this.morphTargetCurvatures[name];

      if (curv && influence > 0) {
        for (let j = 0; j < vertexCount; j++) {
          result[j] += curv[j] * influence;
        }
      }
    }

    return result;
  }

  dispose(): void {
    this.cancelAnimation();
    this.morphTargetDictionary = {};
    this.morphTargetNames = [];
    this.morphTargetCurvatures = {};
    this.surfaceSet = null;
    super.dispose();
  }
}

export default MorphableSurface;
