import colormap from 'colormap';
import * as THREE from 'three';
import { EventEmitter } from './EventEmitter';
import { debugLog } from './debug';

export interface ColorMapOptions {
  range?: [number, number];
  threshold?: [number, number];
  alpha?: number;
}

export type Color = string | number[];
export type RGBA = [number, number, number, number];
export type RGB = [number, number, number];
export type ColorArray = RGB | RGBA;

const CUSTOM_PRESET_ANCHORS: Record<string, number[]> = {
  blues: [0xf7fbff, 0xc6dbef, 0x6baed6, 0x08519c],
  reds: [0xfff5f0, 0xfcae91, 0xfb6a4a, 0xcb181d],
  oranges: [0xfff5eb, 0xfdae6b, 0xf16913, 0xa63603],
  purples: [0xfcfbfd, 0xbcbddc, 0x756bb1, 0x3f007d],
  rdylbu: [0xa50026, 0xd73027, 0xf46d43, 0xfdae61, 0xfee090, 0xe0f3f8, 0xabd9e9, 0x74add1, 0x4575b4, 0x313695],
  rdylgn: [0xa50026, 0xd73027, 0xf46d43, 0xfdae61, 0xfee08b, 0xd9ef8b, 0xa6d96a, 0x66bd63, 0x1a9850, 0x006837],
  spectral: [0x9e0142, 0xd53e4f, 0xf46d43, 0xfdae61, 0xfee08b, 0xe6f598, 0xabdda4, 0x66c2a5, 0x3288bd, 0x5e4fa2],
  coolwarm: [0x3b4cc0, 0x7788d8, 0xb3c2ef, 0xdee4ef, 0xf7b89c, 0xee8468, 0xd73027, 0x7f0000],
  bwr: [0x0000ff, 0xffffff, 0xff0000],
  seismic: [0x0000ff, 0x00bfbf, 0xffffff, 0xff7f7f, 0xff0000]
};

export class ColorMap extends EventEmitter {
  private colors: ColorArray[];
  private _hasAlpha: boolean;
  private range: [number, number];
  private threshold: [number, number];
  private alpha: number;
  static presetMaps: Record<string, ColorArray[]> | null = null;

  constructor(colors: Color[], options: ColorMapOptions = {}) {
    super();
    if (!Array.isArray(colors) || colors.length === 0) {
      throw new TypeError('Colors must be a non-empty array');
    }

    this.colors = colors.map(color => this.parseColor(color));
    this._hasAlpha = this.colors[0].length === 4;
    this.range = [0, 1];
    this.threshold = [0, 0];
    this.alpha = 1;
    this.setRange(options.range);
    this.setThreshold(options.threshold);
    this.setAlpha(options.alpha);
  }

  setRange(range?: [number, number]): void {
    if (Array.isArray(range) && range.length === 2 && range.every(v => typeof v === 'number')) {
      this.range = range;
      debugLog('ColorMap: Emitting rangeChanged event', this.range);
      this.emit('rangeChanged', this.range);
    } else {
      this.range = [0, 1];
    }
  }

  setThreshold(threshold?: [number, number]): void {
    if (Array.isArray(threshold) && threshold.length === 2 && threshold.every(v => typeof v === 'number')) {
      this.threshold = threshold;
      debugLog('ColorMap: Emitting thresholdChanged event', this.threshold);
      this.emit('thresholdChanged', this.threshold);
    } else {
      this.threshold = [0, 0];
    }
  }

  /**
   * Normalize and validate a color specification.
   * Colors may be provided as a hex string (with or without leading '#') or as
   * an array of numeric components in the range [0, 1].
   *
   * @param color The color to parse.
   * @returns Array of normalized RGB or RGBA components.
   */
  parseColor(color: Color): ColorArray {
    if (typeof color === 'string' && color.startsWith('#')) {
      return this.hexToRgb(color);
    }

    // Assume color is an array of numeric components.
    if (!Array.isArray(color) || (color.length !== 3 && color.length !== 4)) {
      throw new TypeError(`Invalid color specification: ${color}`);
    }

    return color.map(component => {
      if (typeof component !== 'number' || component < 0 || component > 1) {
        throw new TypeError(`Color components must be numbers in the range [0, 1], got ${component}`);
      }
      return component;
    }) as ColorArray;
  }

  hexToRgb(hex: string): RGB {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
      throw new TypeError(`Invalid hex color: ${hex}`);
    }
    return [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255
    ];
  }

  getColor(value: number): ColorArray {
    const [min, max] = this.range;
    const [threshMin, threshMax] = this.threshold;

    // Neuroimaging threshold semantics:
    // - SHOW values where: value > threshMax OR value < threshMin (extreme/significant)
    // - HIDE values where: threshMin <= value <= threshMax (non-significant)
    // - When min === max: hide zone has zero width → show ALL
    const thresholdActive = threshMin !== threshMax;

    if (thresholdActive) {
      // Value is IN the hide zone (between min and max) → make transparent
      if (value >= threshMin && value <= threshMax) {
        debugLog(`ColorMap: value ${value} hidden by threshold [${threshMin}, ${threshMax}]`);
        return this.hasAlpha() ? [0, 0, 0, 0] : [0, 0, 0];
      }
    }

    // Normalize value to [0, 1] guarding against degenerate ranges
    const denominator = max - min;
    const normalizedValue = denominator === 0
      ? 0
      : Math.max(0, Math.min(1, (value - min) / denominator));

    // Get the color index with bounds checking
    const index = Math.min(
      Math.floor(normalizedValue * (this.colors.length - 1)),
      this.colors.length - 1
    );

    // Defensive: check if color entry exists
    const rawColor = this.colors[index];
    if (!rawColor || !Array.isArray(rawColor)) {
      console.warn(`ColorMap.getColor: Invalid color at index ${index}, returning fallback`);
      return this.hasAlpha() ? [0.5, 0.5, 0.5, 1] : [0.5, 0.5, 0.5];
    }

    const color = [...rawColor] as ColorArray;

    // Apply alpha if needed
    if (this._hasAlpha && color.length === 4) {
      color[3] = color[3] * this.alpha;
    }

    return color;
  }

  hasAlpha(): boolean {
    return this._hasAlpha;
  }

  setAlpha(alpha?: number): void {
    if (typeof alpha === 'number' && alpha >= 0 && alpha <= 1) {
      this.alpha = alpha;
      debugLog('ColorMap: Emitting alphaChanged event', this.alpha);
      this.emit('alphaChanged', this.alpha);
    } else {
      this.alpha = 1;
    }
  }

  getRange(): [number, number] {
    return this.range;
  }

  getThreshold(): [number, number] {
    return this.threshold;
  }

  getAlpha(): number {
    return this.alpha;
  }

  // Generate colormap using the colormap library
  static generatePreset(name: string, nshades: number = 256): ColorArray[] {
    debugLog(`ColorMap: Generating preset colormap: ${name} with ${nshades} shades`);

    const customKey = name.toLowerCase();
    if (CUSTOM_PRESET_ANCHORS[customKey]) {
      debugLog(`ColorMap: Using custom preset for ${name}`);
      return ColorMap.buildGradient(CUSTOM_PRESET_ANCHORS[customKey], nshades);
    }

    try {
      const cmapOptions = {
        colormap: name,
        nshades: nshades,
        format: 'float' as const
      };

      // The colormap library returns arrays of [r, g, b, a]
      const generatedColors = colormap(cmapOptions);

      // Validate the result
      if (!Array.isArray(generatedColors) || generatedColors.length === 0) {
        throw new Error(`Colormap "${name}" returned no colors`);
      }

      // Filter out any invalid entries and ensure all colors are proper arrays
      const validColors = generatedColors.filter((c: any) =>
        c != null && Array.isArray(c) && c.length >= 3
      ) as ColorArray[];

      if (validColors.length === 0) {
        throw new Error(`Colormap "${name}" has no valid color entries after filtering`);
      }

      debugLog(`ColorMap: Generated ${validColors.length} colors for ${name}`);
      return validColors;
    } catch (error) {
      debugLog(`ColorMap: Failed to generate colormap ${name}:`, error);
      throw new Error(`Colormap "${name}" is not supported`);
    }
  }

  /**
   * Build a ColorMap from an array of hex strings or rgb/rgba tuples.
   */
  static fromArray(colors: Color[], options: ColorMapOptions = {}): ColorMap {
    return new ColorMap(colors, options);
  }

  /**
   * Normalize various color inputs to a consistent 0xRRGGBB hex number.
   */
  static toHex(color: number | string): number {
    if (typeof color === 'number') return color;
    const c = color.startsWith('#') ? color : `#${color}`;
    const parsed = new THREE.Color(c);
    return parsed.getHex();
  }

  private static lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private static buildGradient(anchors: number[], nshades: number): ColorArray[] {
    const anchorColors = anchors.map(hex => new THREE.Color(hex));
    const segments = anchors.length - 1;
    if (segments <= 0) return [];

    const result: ColorArray[] = [];
    for (let i = 0; i < nshades; i++) {
      const t = i / Math.max(1, nshades - 1);
      const scaled = t * segments;
      const idx = Math.min(Math.floor(scaled), segments - 1);
      const localT = scaled - idx;
      const c0 = anchorColors[idx];
      const c1 = anchorColors[idx + 1];
      result.push([
        ColorMap.lerp(c0.r, c1.r, localT),
        ColorMap.lerp(c0.g, c1.g, localT),
        ColorMap.lerp(c0.b, c1.b, localT)
      ]);
    }
    return result;
  }

  // Get all available preset colormaps
  static getPresetMaps(): Record<string, ColorArray[]> {
    if (!ColorMap.presetMaps) {
      ColorMap.presetMaps = {};
      
      // List of all possible colormaps to try
      const candidateMaps = [
        'jet', 'hsv', 'hot', 'cool', 'spring', 'summer', 'autumn', 'winter',
        'bone', 'copper', 'greys', 'greens', 'bluered', 'RdBu', 'picnic',
        'rainbow', 'portland', 'blackbody', 'earth', 'electric',
        'viridis', 'inferno', 'magma', 'plasma', 'warm', 'rainbow-soft',
        'bathymetry', 'cdom', 'chlorophyll', 'density', 'freesurface-blue',
        'freesurface-red', 'oxygen', 'par', 'phase', 'salinity', 'temperature',
        'turbidity', 'velocity-blue', 'velocity-green', 'cubehelix',
        'blues', 'reds', 'oranges', 'purples', 'RdYlBu', 'RdYlGn',
        'Spectral', 'coolwarm', 'bwr', 'seismic'
      ];
      
      // Try each colormap
      for (const name of candidateMaps) {
        try {
          const colors = ColorMap.generatePreset(name);
          if (colors && colors.length > 0) {
            ColorMap.presetMaps[name] = colors;
          }
        } catch (e) {
          // Silently skip unsupported colormaps
        }
      }
      
      // Add custom "hot" colormap if not found
      if (!ColorMap.presetMaps.hot) {
        // Generate a custom hot colormap (black -> red -> yellow -> white)
        const nshades = 256;
        const hot: ColorArray[] = [];
        
        for (let i = 0; i < nshades; i++) {
          const t = i / (nshades - 1);
          let r: number, g: number, b: number;
          
          if (t < 1/3) {
            // Black to red
            r = t * 3;
            g = 0;
            b = 0;
          } else if (t < 2/3) {
            // Red to yellow
            r = 1;
            g = (t - 1/3) * 3;
            b = 0;
          } else {
            // Yellow to white
            r = 1;
            g = 1;
            b = (t - 2/3) * 3;
          }
          
          hot.push([r, g, b, 1]);
        }
        
        ColorMap.presetMaps.hot = hot;
      }
      
      // Add a fallback "jet" colormap if not found
      if (!ColorMap.presetMaps.jet) {
        // Generate a simple jet-like colormap (blue -> cyan -> green -> yellow -> red)
        const nshades = 256;
        const jet: ColorArray[] = [];
        
        for (let i = 0; i < nshades; i++) {
          const t = i / (nshades - 1);
          let r: number, g: number, b: number;
          
          if (t < 0.125) {
            r = 0;
            g = 0;
            b = 0.5 + t * 4;
          } else if (t < 0.375) {
            r = 0;
            g = (t - 0.125) * 4;
            b = 1;
          } else if (t < 0.625) {
            r = (t - 0.375) * 4;
            g = 1;
            b = 1 - (t - 0.375) * 4;
          } else if (t < 0.875) {
            r = 1;
            g = 1 - (t - 0.625) * 4;
            b = 0;
          } else {
            r = 1 - (t - 0.875) * 4;
            g = 0;
            b = 0;
          }
          
          jet.push([r, g, b, 1]);
        }
        
        ColorMap.presetMaps.jet = jet;
      }
      
      // Add grayscale colormaps if not found
      if (!ColorMap.presetMaps.gray && !ColorMap.presetMaps.greys) {
        // Generate a simple grayscale colormap (black -> white)
        const nshades = 256;
        const gray: ColorArray[] = [];
        
        for (let i = 0; i < nshades; i++) {
          const t = i / (nshades - 1);
          gray.push([t, t, t, 1]);
        }
        
        ColorMap.presetMaps.gray = gray;
        ColorMap.presetMaps.grays = gray;
        ColorMap.presetMaps.grey = gray;
        ColorMap.presetMaps.greys = gray;
      } else if (ColorMap.presetMaps.greys && !ColorMap.presetMaps.gray) {
        // If greys exists but not gray, create aliases
        ColorMap.presetMaps.gray = ColorMap.presetMaps.greys;
        ColorMap.presetMaps.grays = ColorMap.presetMaps.greys;
        ColorMap.presetMaps.grey = ColorMap.presetMaps.greys;
      } else if (ColorMap.presetMaps.gray && !ColorMap.presetMaps.greys) {
        // If gray exists but not greys, create aliases
        ColorMap.presetMaps.greys = ColorMap.presetMaps.gray;
        ColorMap.presetMaps.grays = ColorMap.presetMaps.gray;
        ColorMap.presetMaps.grey = ColorMap.presetMaps.gray;
      }
      
      debugLog('ColorMap: Available presets:', Object.keys(ColorMap.presetMaps));
    }
    
    return ColorMap.presetMaps;
  }

  static getAvailableMaps(): string[] {
    const presets = ColorMap.getPresetMaps();
    return Object.keys(presets);
  }

  static fromPreset(name: string, options: ColorMapOptions = {}): ColorMap {
    const presets = ColorMap.getPresetMaps();

    // Check for the preset with fallback to common aliases
    let presetColors = presets[name];

    // If not found, try common grayscale aliases
    if (!presetColors && (name === 'gray' || name === 'grey' || name === 'grays')) {
      presetColors = presets['greys'] || presets['gray'] || presets['grey'];
    }

    if (!presetColors) {
      debugLog(`ColorMap.fromPreset: Preset "${name}" not found, falling back to viridis`);
      presetColors = presets['viridis'] || presets['jet'];
      if (!presetColors) {
        throw new Error(`Preset "${name}" not found and no fallback available`);
      }
    }

    // Check if the preset colors array is valid
    if (!Array.isArray(presetColors) || presetColors.length === 0) {
      throw new Error(`Preset "${name}" has invalid or empty colors array`);
    }

    // Filter out any undefined/null entries from the colors array
    const validColors = presetColors.filter(c => c != null && Array.isArray(c));
    if (validColors.length === 0) {
      throw new Error(`Preset "${name}" has no valid color entries`);
    }

    debugLog(`ColorMap.fromPreset: Created ${name} colormap with ${validColors.length} colors`);
    return new ColorMap(validColors, options);
  }
}

// Eagerly initialize presets to avoid race conditions
// This ensures gray/greys aliases are available immediately
ColorMap.getPresetMaps();

export default ColorMap;
