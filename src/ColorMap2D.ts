import * as THREE from 'three';
import { debugLog } from './debug';

/**
 * 2D Colormap for visualizing relationships between two scalar fields.
 *
 * Maps two values (x, y) to a color by sampling a 2D texture.
 * Useful for visualizing:
 * - Effect size vs. confidence
 * - Activation magnitude vs. statistical significance
 * - Any two correlated or independent variables
 */

export interface ColorMap2DOptions {
  /** Range for X axis data [min, max] */
  rangeX?: [number, number];
  /** Range for Y axis data [min, max] */
  rangeY?: [number, number];
  /** Threshold for X axis - values in this range become transparent */
  thresholdX?: [number, number];
  /** Threshold for Y axis - values in this range become transparent */
  thresholdY?: [number, number];
  /** Overall alpha multiplier */
  alpha?: number;
}

export type RGBA = [number, number, number, number];

/**
 * Built-in 2D colormap preset names
 */
export type ColorMap2DPreset =
  | 'hot_cold'       // X: hot colors, Y: cold colors (for positive/negative comparisons)
  | 'rgba_wheel'     // Circular color wheel based on angle
  | 'confidence'     // Y controls saturation/confidence, X controls hue
  | 'diverging'      // X: diverging blue-white-red, Y: intensity/saturation
  | 'magnitude_phase'; // X: magnitude (brightness), Y: phase (hue)

/**
 * 2D Colormap class for mapping two scalar fields to colors
 */
export class ColorMap2D {
  private textureData: Float32Array;
  private textureSize: number;
  private texture: THREE.DataTexture | null = null;

  private rangeX: [number, number];
  private rangeY: [number, number];
  private thresholdX: [number, number];
  private thresholdY: [number, number];
  private alpha: number;

  constructor(
    textureData: Float32Array,
    textureSize: number,
    options: ColorMap2DOptions = {}
  ) {
    this.textureData = textureData;
    this.textureSize = textureSize;
    this.rangeX = options.rangeX || [0, 1];
    this.rangeY = options.rangeY || [0, 1];
    this.thresholdX = options.thresholdX || [0, 0];
    this.thresholdY = options.thresholdY || [0, 0];
    this.alpha = options.alpha ?? 1.0;
  }

  /**
   * Get color for a pair of values
   */
  getColor(valueX: number, valueY: number): RGBA {
    // Check thresholds - if value is in threshold range, return transparent
    const thresholdActiveX = this.thresholdX[0] !== this.thresholdX[1];
    const thresholdActiveY = this.thresholdY[0] !== this.thresholdY[1];

    if (thresholdActiveX && valueX >= this.thresholdX[0] && valueX <= this.thresholdX[1]) {
      return [0, 0, 0, 0];
    }
    if (thresholdActiveY && valueY >= this.thresholdY[0] && valueY <= this.thresholdY[1]) {
      return [0, 0, 0, 0];
    }

    // Normalize values to [0, 1]
    const normX = this.normalizeValue(valueX, this.rangeX);
    const normY = this.normalizeValue(valueY, this.rangeY);

    // Sample texture
    const x = Math.floor(normX * (this.textureSize - 1));
    const y = Math.floor(normY * (this.textureSize - 1));
    const idx = (y * this.textureSize + x) * 4;

    return [
      this.textureData[idx],
      this.textureData[idx + 1],
      this.textureData[idx + 2],
      this.textureData[idx + 3] * this.alpha
    ];
  }

  private normalizeValue(value: number, range: [number, number]): number {
    const [min, max] = range;
    if (max === min) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }

  /**
   * Get Three.js texture for GPU rendering
   */
  getTexture(): THREE.DataTexture {
    if (!this.texture) {
      this.texture = new THREE.DataTexture(
        this.textureData,
        this.textureSize,
        this.textureSize,
        THREE.RGBAFormat,
        THREE.FloatType
      );
      this.texture.needsUpdate = true;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.wrapS = THREE.ClampToEdgeWrapping;
      this.texture.wrapT = THREE.ClampToEdgeWrapping;
    }
    return this.texture;
  }

  /**
   * Get the raw texture data
   */
  getTextureData(): Float32Array {
    return this.textureData;
  }

  /**
   * Get texture size (width = height)
   */
  getTextureSize(): number {
    return this.textureSize;
  }

  // Setters for ranges and thresholds
  setRangeX(range: [number, number]): void {
    this.rangeX = range;
  }

  setRangeY(range: [number, number]): void {
    this.rangeY = range;
  }

  setThresholdX(threshold: [number, number]): void {
    this.thresholdX = threshold;
  }

  setThresholdY(threshold: [number, number]): void {
    this.thresholdY = threshold;
  }

  setAlpha(alpha: number): void {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }

  // Getters
  getRangeX(): [number, number] { return [...this.rangeX] as [number, number]; }
  getRangeY(): [number, number] { return [...this.rangeY] as [number, number]; }
  getThresholdX(): [number, number] { return [...this.thresholdX] as [number, number]; }
  getThresholdY(): [number, number] { return [...this.thresholdY] as [number, number]; }
  getAlpha(): number { return this.alpha; }

  dispose(): void {
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
  }

  /**
   * Create a 2D colormap from a preset name
   */
  static fromPreset(
    preset: ColorMap2DPreset,
    size: number = 256,
    options: ColorMap2DOptions = {}
  ): ColorMap2D {
    const textureData = ColorMap2D.generatePresetTexture(preset, size);
    return new ColorMap2D(textureData, size, options);
  }

  /**
   * Create a 2D colormap from a custom generator function
   */
  static fromGenerator(
    generator: (x: number, y: number) => RGBA,
    size: number = 256,
    options: ColorMap2DOptions = {}
  ): ColorMap2D {
    const textureData = new Float32Array(size * size * 4);

    for (let yi = 0; yi < size; yi++) {
      for (let xi = 0; xi < size; xi++) {
        const x = xi / (size - 1);
        const y = yi / (size - 1);
        const color = generator(x, y);
        const idx = (yi * size + xi) * 4;
        textureData[idx] = color[0];
        textureData[idx + 1] = color[1];
        textureData[idx + 2] = color[2];
        textureData[idx + 3] = color[3];
      }
    }

    return new ColorMap2D(textureData, size, options);
  }

  /**
   * Generate texture data for a preset colormap
   */
  private static generatePresetTexture(preset: ColorMap2DPreset, size: number): Float32Array {
    const data = new Float32Array(size * size * 4);

    for (let yi = 0; yi < size; yi++) {
      for (let xi = 0; xi < size; xi++) {
        const x = xi / (size - 1); // 0 to 1
        const y = yi / (size - 1); // 0 to 1
        const idx = (yi * size + xi) * 4;

        let r: number, g: number, b: number, a: number;

        switch (preset) {
          case 'hot_cold':
            // X axis: temperature (cold blue to hot red)
            // Y axis: intensity/brightness
            [r, g, b, a] = ColorMap2D.hotColdColor(x, y);
            break;

          case 'rgba_wheel':
            // Angle determines hue, radius determines saturation
            [r, g, b, a] = ColorMap2D.rgbaWheelColor(x, y);
            break;

          case 'confidence':
            // X: value/hue, Y: confidence/saturation
            [r, g, b, a] = ColorMap2D.confidenceColor(x, y);
            break;

          case 'diverging':
            // X: diverging (blue-white-red), Y: intensity
            [r, g, b, a] = ColorMap2D.divergingColor(x, y);
            break;

          case 'magnitude_phase':
            // X: magnitude (brightness), Y: phase (hue)
            [r, g, b, a] = ColorMap2D.magnitudePhaseColor(x, y);
            break;

          default:
            // Fallback: simple gradient
            r = x;
            g = y;
            b = 0.5;
            a = 1;
        }

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }

    debugLog(`ColorMap2D: Generated ${preset} texture (${size}x${size})`);
    return data;
  }

  /**
   * Hot-Cold colormap: X controls temperature, Y controls brightness
   */
  private static hotColdColor(x: number, y: number): RGBA {
    // X: 0 = cold (blue), 0.5 = neutral, 1 = hot (red)
    // Y: 0 = dark, 1 = bright

    let r: number, g: number, b: number;

    if (x < 0.5) {
      // Cold side: blue to white
      const t = x * 2; // 0 to 1
      r = t;
      g = t;
      b = 1;
    } else {
      // Hot side: white to red
      const t = (x - 0.5) * 2; // 0 to 1
      r = 1;
      g = 1 - t;
      b = 1 - t;
    }

    // Apply brightness from Y
    r *= y;
    g *= y;
    b *= y;

    return [r, g, b, 1];
  }

  /**
   * RGBA wheel: treats X,Y as cartesian coords, converts to polar for hue/saturation
   */
  private static rgbaWheelColor(x: number, y: number): RGBA {
    // Convert to centered coordinates
    const cx = x - 0.5;
    const cy = y - 0.5;

    // Polar coordinates
    const radius = Math.sqrt(cx * cx + cy * cy) * 2; // 0 to ~1.4
    const angle = Math.atan2(cy, cx); // -PI to PI

    // Convert angle to hue (0 to 1)
    const hue = (angle + Math.PI) / (2 * Math.PI);

    // Saturation from radius (clamped)
    const saturation = Math.min(1, radius);

    // Convert HSV to RGB (V=1)
    const [r, g, b] = ColorMap2D.hsvToRgb(hue, saturation, 1);

    // Alpha based on being inside the circle
    const alpha = radius <= 1 ? 1 : 0;

    return [r, g, b, alpha];
  }

  /**
   * Confidence colormap: X is value (hue), Y is confidence (saturation)
   */
  private static confidenceColor(x: number, y: number): RGBA {
    // X: hue (0 = blue, 0.5 = green, 1 = red)
    // Y: confidence/saturation (0 = gray, 1 = saturated)

    // Map X to a meaningful hue range (blue -> cyan -> green -> yellow -> red)
    const hue = x * 0.8; // 0 to 0.8 (avoiding purple wrap)

    const [r, g, b] = ColorMap2D.hsvToRgb(hue, y, 1);

    return [r, g, b, 1];
  }

  /**
   * Diverging colormap: X is diverging value, Y is intensity
   */
  private static divergingColor(x: number, y: number): RGBA {
    // X: 0 = strong blue, 0.5 = white, 1 = strong red
    // Y: intensity multiplier

    let r: number, g: number, b: number;

    if (x < 0.5) {
      // Blue side
      const t = x * 2; // 0 to 1 (0=full blue, 1=white)
      r = t;
      g = t;
      b = 1;
    } else {
      // Red side
      const t = (x - 0.5) * 2; // 0 to 1 (0=white, 1=full red)
      r = 1;
      g = 1 - t;
      b = 1 - t;
    }

    // Y controls how much we blend toward white (low Y = more white)
    const intensity = y;
    r = 1 - (1 - r) * intensity;
    g = 1 - (1 - g) * intensity;
    b = 1 - (1 - b) * intensity;

    return [r, g, b, 1];
  }

  /**
   * Magnitude-Phase colormap: X is magnitude (brightness), Y is phase (hue)
   */
  private static magnitudePhaseColor(x: number, y: number): RGBA {
    // X: magnitude/brightness (0 = black, 1 = full color)
    // Y: phase/hue (full color wheel)

    const [r, g, b] = ColorMap2D.hsvToRgb(y, 1, x);

    return [r, g, b, 1];
  }

  /**
   * Convert HSV to RGB
   * H, S, V all in range [0, 1]
   */
  private static hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    let r: number, g: number, b: number;

    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
      default: r = 0; g = 0; b = 0;
    }

    return [r, g, b];
  }

  /**
   * Get list of available preset names
   */
  static getPresetNames(): ColorMap2DPreset[] {
    return ['hot_cold', 'rgba_wheel', 'confidence', 'diverging', 'magnitude_phase'];
  }
}

export default ColorMap2D;
