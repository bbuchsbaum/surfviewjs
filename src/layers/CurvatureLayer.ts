import { assertLayerUpdateFields, Layer, LayerConfig, LayerUpdateData } from '../layers';
import { debugLog } from '../debug';
import { finiteNumber, opacity as validateOpacity } from '../utils/validation';

/**
 * Configuration options for curvature display
 */
export interface CurvatureConfig extends LayerConfig {
  /** Base gray level (0-1), default 0.5 */
  brightness?: number;
  /** How much curvature affects brightness (0-1), default 0.5 */
  contrast?: number;
  /** Divisor for curvature values - higher = more subtle, default 1 */
  smoothness?: number;
}

/**
 * Update data for CurvatureLayer
 */
export interface CurvatureLayerUpdateData extends LayerUpdateData {
  curvature?: Float32Array | number[];
  brightness?: number;
  contrast?: number;
  smoothness?: number;
}

/**
 * Layer that displays mesh curvature as a grayscale underlay.
 *
 * Curvature values are mapped to grayscale using:
 *   gray = clamp(curvature / smoothness, -0.5, 0.5) * contrast + brightness
 *
 * Typical usage:
 * - Load curvature from FreeSurfer .curv file or compute from pial surface
 * - Display as underlay (order: -2, below base layer) to show sulci/gyri
 * - Works on any surface representation (folded, inflated, flat)
 *
 * @example
 * ```typescript
 * const curvLayer = new CurvatureLayer('curv', curvatureData, {
 *   brightness: 0.5,
 *   contrast: 0.5,
 *   smoothness: 0.3
 * });
 * surface.addLayer(curvLayer);
 * ```
 */
export class CurvatureLayer extends Layer {
  private curvature: Float32Array;
  private brightness: number;
  private contrast: number;
  private smoothness: number;
  private rgbaBuffer: Float32Array | null = null;

  constructor(
    id: string,
    curvature: Float32Array | number[],
    config: CurvatureConfig = {}
  ) {
    // Curvature layer renders below base layer
    super(
      id,
      { ...config, order: config.order ?? -2 },
      { role: 'anatomy', pinned: 'bottom', reorderable: false, priority: 0 }
    );

    this.curvature = curvature instanceof Float32Array
      ? curvature
      : new Float32Array(curvature);

    this.brightness = finiteNumber(config.brightness ?? 0.5, 'brightness', {
      minimum: 0,
      maximum: 1
    });
    this.contrast = finiteNumber(config.contrast ?? 0.5, 'contrast', {
      minimum: 0,
      maximum: 1
    });
    this.smoothness = finiteNumber(config.smoothness ?? 1, 'smoothness', {
      minimum: 0,
      minimumExclusive: true
    });

    debugLog('CurvatureLayer', id, ': Created with', this.curvature.length, 'vertices');
  }

  /**
   * Set new curvature data
   */
  setCurvature(curvature: Float32Array | number[]): void {
    this.curvature = curvature instanceof Float32Array
      ? curvature
      : new Float32Array(curvature);
    this.rgbaBuffer = null;
    this._notifyChange();
  }

  /**
   * Get current curvature data
   */
  getCurvature(): Float32Array {
    return this.curvature;
  }

  /**
   * Set brightness (base gray level)
   */
  setBrightness(brightness: number): void {
    this.brightness = finiteNumber(brightness, 'brightness', { minimum: 0, maximum: 1 });
    this.rgbaBuffer = null;
    this._notifyChange();
  }

  /**
   * Set contrast (curvature influence on brightness)
   */
  setContrast(contrast: number): void {
    this.contrast = finiteNumber(contrast, 'contrast', { minimum: 0, maximum: 1 });
    this.rgbaBuffer = null;
    this._notifyChange();
  }

  /**
   * Set smoothness (curvature scaling factor)
   */
  setSmoothness(smoothness: number): void {
    this.smoothness = finiteNumber(smoothness, 'smoothness', {
      minimum: 0,
      minimumExclusive: true
    });
    this.rgbaBuffer = null;
    this._notifyChange();
  }

  /**
   * Get current display parameters
   */
  getDisplayParams(): { brightness: number; contrast: number; smoothness: number } {
    return {
      brightness: this.brightness,
      contrast: this.contrast,
      smoothness: this.smoothness
    };
  }

  /**
   * Generate RGBA data for compositing
   */
  getRGBAData(vertexCount: number): Float32Array {
    // Allocate buffer if needed
    if (!this.rgbaBuffer || this.rgbaBuffer.length !== vertexCount * 4) {
      this.rgbaBuffer = new Float32Array(vertexCount * 4);
    }

    const buffer = this.rgbaBuffer;
    const curvature = this.curvature;
    const brightness = this.brightness;
    const contrast = this.contrast;
    const smoothness = this.smoothness;

    for (let i = 0; i < vertexCount; i++) {
      // Get curvature value (default to 0 if out of bounds)
      const curv = i < curvature.length ? curvature[i]! : 0;

      // Apply pycortex-style mapping:
      // gray = clamp(curvature / smoothness, -0.5, 0.5) * contrast + brightness
      const scaled = Math.max(-0.5, Math.min(0.5, curv / smoothness));
      const gray = Math.max(0, Math.min(1, scaled * contrast + brightness));

      const offset = i * 4;
      buffer[offset] = gray;     // R
      buffer[offset + 1] = gray; // G
      buffer[offset + 2] = gray; // B
      buffer[offset + 3] = 1;       // Intrinsic alpha; compositor applies opacity
    }

    this.needsUpdate = false;
    return buffer;
  }

  /**
   * Update layer properties
   */
  update(data: CurvatureLayerUpdateData): void {
    assertLayerUpdateFields(data, 'CurvatureLayer', [
      'curvature', 'brightness', 'contrast', 'smoothness'
    ]);
    if (data.brightness !== undefined) {
      finiteNumber(data.brightness, 'brightness', { minimum: 0, maximum: 1 });
    }
    if (data.contrast !== undefined) {
      finiteNumber(data.contrast, 'contrast', { minimum: 0, maximum: 1 });
    }
    if (data.smoothness !== undefined) {
      finiteNumber(data.smoothness, 'smoothness', { minimum: 0, minimumExclusive: true });
    }
    if (data.opacity !== undefined) validateOpacity(data.opacity);
    if (data.curvature !== undefined) {
      this.setCurvature(data.curvature);
    }
    if (data.brightness !== undefined) {
      this.setBrightness(data.brightness);
    }
    if (data.contrast !== undefined) {
      this.setContrast(data.contrast);
    }
    if (data.smoothness !== undefined) {
      this.setSmoothness(data.smoothness);
    }
    if (data.opacity !== undefined) {
      this.setOpacity(data.opacity);
    }
    if (data.visible !== undefined) {
      this.setVisible(data.visible);
    }
    if (data.blendMode !== undefined) {
      this.setBlendMode(data.blendMode);
    }
  }

  toStateJSON(): Record<string, unknown> {
    return {
      ...super.toStateJSON(),
      type: 'curvature',
      brightness: this.brightness,
      contrast: this.contrast,
      smoothness: this.smoothness
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.rgbaBuffer = null;
  }
}
