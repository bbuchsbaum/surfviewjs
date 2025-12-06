import * as THREE from 'three';
import ColorMap, { ColorMapOptions, Color, ColorArray } from './ColorMap';
import ColorMap2D, { ColorMap2DPreset, ColorMap2DOptions } from './ColorMap2D';
import { debugLog } from './debug';

export type BlendMode = 'normal' | 'additive' | 'multiply';

export interface LayerConfig {
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  order?: number;
}

export interface DataLayerConfig extends LayerConfig {
  range?: [number, number];
  threshold?: [number, number];
}

export interface TwoDataLayerConfig extends LayerConfig {
  rangeX?: [number, number];
  rangeY?: [number, number];
  thresholdX?: [number, number];
  thresholdY?: [number, number];
}

export interface LayerUpdateData {
  opacity?: number;
  visible?: boolean;
  blendMode?: BlendMode;
  [key: string]: any;
}

export interface RGBALayerUpdateData extends LayerUpdateData {
  rgbaData?: Float32Array | number[];
}

export interface DataLayerUpdateData extends LayerUpdateData {
  data?: Float32Array | number[];
  indices?: Uint32Array | number[];
  colorMap?: ColorMap | string | Color[];
  range?: [number, number];
  threshold?: [number, number];
}

export interface TwoDataLayerUpdateData extends LayerUpdateData {
  dataX?: Float32Array | number[];
  dataY?: Float32Array | number[];
  indices?: Uint32Array | number[];
  colorMap?: ColorMap2D | ColorMap2DPreset;
  rangeX?: [number, number];
  rangeY?: [number, number];
  thresholdX?: [number, number];
  thresholdY?: [number, number];
}

export interface BaseLayerUpdateData extends LayerUpdateData {
  color?: number;
}

export interface LabelLayerOptions extends LayerConfig {
  labels: Uint32Array | Int32Array | number[];
  labelDefs: Array<{ id: number; color: THREE.ColorRepresentation; name?: string }>;
  defaultColor?: THREE.ColorRepresentation;
}

/**
 * Base class for all layer types
 */
export abstract class Layer {
  id: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  order: number;
  needsUpdate: boolean;
  private static _outlineCtor: any;

  constructor(id: string, config: LayerConfig = {}) {
    this.id = id;
    this.visible = config.visible !== undefined ? config.visible : true;
    this.opacity = config.opacity !== undefined ? config.opacity : 1.0;
    this.blendMode = config.blendMode || 'normal';
    this.order = config.order || 0;
    this.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    if (this.visible !== visible) {
      this.visible = visible;
      this.needsUpdate = true;
    }
  }

  setOpacity(opacity: number): void {
    opacity = Math.max(0, Math.min(1, opacity));
    if (this.opacity !== opacity) {
      this.opacity = opacity;
      this.needsUpdate = true;
    }
  }

  setBlendMode(mode: BlendMode): void {
    const validModes: BlendMode[] = ['normal', 'additive', 'multiply'];
    if (validModes.includes(mode) && this.blendMode !== mode) {
      this.blendMode = mode;
      this.needsUpdate = true;
    }
  }

  /**
   * Get RGBA values for this layer
   * Must be implemented by subclasses
   */
  abstract getRGBAData(vertexCount: number): Float32Array;

  /**
   * Update layer data
   * Must be implemented by subclasses
   */
  abstract update(data: LayerUpdateData): void;

  dispose(): void {
    // Override in subclasses if needed
  }

  static registerOutlineLayer(ctor: any): void {
    Layer._outlineCtor = ctor;
  }

  private static get outlineCtor(): any {
    return Layer._outlineCtor;
  }

  /**
   * Create a concrete Layer instance from a plain object configuration.
   * Supports: base, rgba, data, outline.
   */
  static fromConfig(config: Record<string, any>): Layer {
    const { type, id } = config;
    if (!type || !id) {
      throw new Error('Layer.fromConfig requires type and id');
    }

    const commonConfig: LayerConfig = {
      visible: config.visible,
      opacity: config.opacity ?? (config.alpha !== undefined ? config.alpha : undefined),
      blendMode: config.blendMode,
      order: config.order
    };

    switch (type) {
      case 'base':
        return new BaseLayer(config.color ?? 0xcccccc, commonConfig);
      case 'rgba':
        if (!config.data) throw new Error('RGBALayer requires data');
        return new RGBALayer(id, config.data, commonConfig);
      case 'data':
        if (!config.data) throw new Error('DataLayer requires data');
        return new DataLayer(
          id,
          config.data,
          config.indices ?? null,
          config.cmap ?? config.colorMap ?? 'jet',
          {
            ...commonConfig,
            range: config.range,
            threshold: config.threshold
          }
        );
      case 'outline':
        if (!config.roiLabels) throw new Error('OutlineLayer requires roiLabels');
        if (!Layer.outlineCtor) throw new Error('OutlineLayer constructor not registered');
        return new Layer.outlineCtor(id, {
          roiLabels: config.roiLabels,
          color: config.color,
          opacity: commonConfig.opacity,
          width: config.width,
          halo: config.halo,
          haloColor: config.haloColor,
          haloWidth: config.haloWidth,
          offset: config.offset,
          roiSubset: config.roiSubset,
          visible: commonConfig.visible,
          blendMode: commonConfig.blendMode,
          order: commonConfig.order
        });
      case 'label':
        if (!config.labels || !config.labelDefs) {
          throw new Error('LabelLayer requires labels and labelDefs');
        }
        return new LabelLayer(id, {
          labels: config.labels,
          labelDefs: config.labelDefs,
          defaultColor: config.defaultColor,
          visible: commonConfig.visible,
          opacity: commonConfig.opacity,
          blendMode: commonConfig.blendMode,
          order: commonConfig.order
        });
      case 'twodata':
        if (!config.dataX || !config.dataY) {
          throw new Error('TwoDataLayer requires dataX and dataY');
        }
        return new TwoDataLayer(
          id,
          config.dataX,
          config.dataY,
          config.indices ?? null,
          config.cmap ?? config.colorMap ?? 'confidence',
          {
            ...commonConfig,
            rangeX: config.rangeX,
            rangeY: config.rangeY,
            thresholdX: config.thresholdX,
            thresholdY: config.thresholdY
          }
        );
      default:
        throw new Error(`Unsupported layer type: ${type}`);
    }
  }
}

/**
 * Layer with pre-computed RGBA values (dumb mode)
 */
export class RGBALayer extends Layer {
  private rgbaData: Float32Array | null = null;

  constructor(id: string, rgbaData: Float32Array | number[], config: LayerConfig = {}) {
    super(id, config);
    this.setRGBAData(rgbaData);
  }

  setRGBAData(rgbaData: Float32Array | number[]): void {
    if (!rgbaData) {
      throw new Error('RGBA data is required');
    }
    
    // Ensure it's a Float32Array
    this.rgbaData = rgbaData instanceof Float32Array 
      ? rgbaData 
      : new Float32Array(rgbaData);
    
    // Validate data length (should be divisible by 4)
    if (this.rgbaData.length % 4 !== 0) {
      throw new Error('RGBA data length must be divisible by 4');
    }
    
    this.needsUpdate = true;
    debugLog(`RGBALayer ${this.id}: Set RGBA data with ${this.rgbaData.length / 4} vertices`);
  }

  getRGBAData(vertexCount: number): Float32Array {
    if (!this.rgbaData) {
      throw new Error('No RGBA data set');
    }
    
    const expectedLength = vertexCount * 4;
    if (this.rgbaData.length !== expectedLength) {
      console.warn(`RGBALayer ${this.id}: Data length mismatch. Expected ${expectedLength}, got ${this.rgbaData.length}`);
    }
    
    return this.rgbaData;
  }

  update(data: RGBALayerUpdateData): void {
    if (data.rgbaData) {
      this.setRGBAData(data.rgbaData);
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
}

/**
 * Layer with data values and colormap (smart mode)
 */
export class DataLayer extends Layer {
  private data: Float32Array | null = null;
  private indices: Uint32Array | null = null;
  private colorMap: ColorMap | null = null;
  private colorMapName: string | null = null;
  private range: [number, number];
  private threshold: [number, number];
  private _cachedRGBABuffer: Float32Array | null = null;

  constructor(
    id: string, 
    data: Float32Array | number[], 
    indices: Uint32Array | number[] | null, 
    colorMap: ColorMap | string | Color[], 
    config: DataLayerConfig = {}
  ) {
    super(id, config);
    this.range = config.range || [0, 1];
    this.threshold = config.threshold || [0, 0];
    
    // Initialize data
    this.setData(data, indices);
    this.setColorMap(colorMap);
    
    // Apply initial settings
    if (this.colorMap) {
      this.colorMap.setRange(this.range);
      this.colorMap.setThreshold(this.threshold);
    }
  }

  setData(data: Float32Array | number[], indices?: Uint32Array | number[] | null): void {
    if (!data) {
      throw new Error('Data is required');
    }
    
    this.data = data instanceof Float32Array 
      ? data 
      : new Float32Array(data);
    
    if (indices) {
      this.indices = indices instanceof Uint32Array
        ? indices
        : new Uint32Array(indices);
    } else {
      // If no indices provided, assume 1:1 mapping
      this.indices = new Uint32Array(this.data.length);
      for (let i = 0; i < this.data.length; i++) {
        this.indices[i] = i;
      }
    }
    
    this.needsUpdate = true;
    debugLog(`DataLayer ${this.id}: Set data with ${this.data.length} values`);
  }

  getData(): Float32Array | null {
    return this.data;
  }

  setColorMap(colorMap: ColorMap | string | Color[]): void {
    if (!colorMap) {
      throw new Error('ColorMap is required');
    }
    
    debugLog(`DataLayer ${this.id}: setColorMap called with`, colorMap);
    
    if (colorMap instanceof ColorMap) {
      this.colorMap = colorMap;
      this.colorMapName = 'custom';
      debugLog(`DataLayer ${this.id}: Set ColorMap instance directly`);
    } else if (typeof colorMap === 'string') {
      try {
        this.colorMap = ColorMap.fromPreset(colorMap);
        this.colorMapName = colorMap;
        debugLog(`DataLayer ${this.id}: Created ColorMap from preset: ${colorMap}`);
      } catch (err) {
        const presets = ColorMap.getAvailableMaps();
        const fallback = presets.includes('jet') ? 'jet' : (presets[0] || 'jet');
        console.warn(`DataLayer ${this.id}: preset "${colorMap}" unavailable, falling back to "${fallback}"`, err);
        this.colorMap = ColorMap.fromPreset(fallback);
        this.colorMapName = fallback;
      }
    } else if (Array.isArray(colorMap)) {
      this.colorMap = new ColorMap(colorMap);
      this.colorMapName = 'custom';
      debugLog(`DataLayer ${this.id}: Created ColorMap from color array`);
    } else {
      throw new Error('Invalid colorMap type');
    }
    
    // Apply current range and threshold
    this.colorMap.setRange(this.range);
    this.colorMap.setThreshold(this.threshold);
    
    // Invalidate cached RGBA buffer to force regeneration
    this._cachedRGBABuffer = null;
    this.needsUpdate = true;
    debugLog(`DataLayer ${this.id}: ColorMap updated, needsUpdate = true`);
  }

  setRange(range: [number, number]): void {
    this.range = range;
    if (this.colorMap) {
      this.colorMap.setRange(range);
      this.needsUpdate = true;
    }
  }

  setThreshold(threshold: [number, number]): void {
    this.threshold = threshold;
    if (this.colorMap) {
      this.colorMap.setThreshold(threshold);
      this.needsUpdate = true;
    }
  }

  getRange(): [number, number] {
    return [...this.range] as [number, number];
  }

  getThreshold(): [number, number] {
    return [...this.threshold] as [number, number];
  }

  getColorMapName(): string {
    return this.colorMapName || 'custom';
  }

  getRGBAData(vertexCount: number): Float32Array {
    if (!this.data || !this.colorMap || !this.indices) {
      throw new Error('Data, indices and colorMap must be set');
    }

    debugLog(`DataLayer ${this.id}: getRGBAData called for ${vertexCount} vertices`);
    debugLog(`DataLayer ${this.id}: data.length=${this.data.length}, indices.length=${this.indices.length}`);
    debugLog(`DataLayer ${this.id}: range=[${this.range[0].toFixed(4)}, ${this.range[1].toFixed(4)}]`);
    debugLog(`DataLayer ${this.id}: threshold=[${this.threshold[0].toFixed(4)}, ${this.threshold[1].toFixed(4)}]`);
    debugLog(`DataLayer ${this.id}: colormap=${this.colorMapName}, opacity=${this.opacity}`);

    // Always regenerate colors when colormap changes
    // Don't use cache for now to ensure updates work
    const rgbaData = new Float32Array(vertexCount * 4);

    // Initialize with transparent black
    rgbaData.fill(0);

    // Track statistics for debugging
    let nonTransparentCount = 0;
    let transparentCount = 0;

    // Fill in colors for vertices with data
    for (let i = 0; i < this.indices.length && i < this.data.length; i++) {
      const vertexIndex: number = this.indices[i];
      const value = this.data[i];

      // Add bounds check for safety
      if (vertexIndex >= 0 && vertexIndex < vertexCount) {
        const color = this.colorMap.getColor(value);
        const offset = vertexIndex * 4;

        rgbaData[offset] = color[0];     // R
        rgbaData[offset + 1] = color[1]; // G
        rgbaData[offset + 2] = color[2]; // B
        rgbaData[offset + 3] = (color[3] || 1) * this.opacity; // A with layer opacity

        // Track transparency for debugging
        if (rgbaData[offset + 3] > 0) {
          nonTransparentCount++;
        } else {
          transparentCount++;
        }
      }
    }

    debugLog(`DataLayer ${this.id}: Generated colors - ${nonTransparentCount} visible, ${transparentCount} transparent`);

    // Sample a few values for debugging
    if (this.data.length > 0) {
      const sampleIdx = Math.floor(this.data.length / 2);
      const sampleValue = this.data[sampleIdx];
      const sampleColor = this.colorMap.getColor(sampleValue);
      debugLog(`DataLayer ${this.id}: Sample value[${sampleIdx}]=${sampleValue.toFixed(4)} -> RGBA=[${sampleColor.map(v => v.toFixed(3)).join(', ')}]`);
    }

    return rgbaData;
  }

  update(updates: DataLayerUpdateData): void {
    if (updates.data !== undefined) {
      this.setData(updates.data, updates.indices);
    }
    if (updates.colorMap !== undefined) {
      this.setColorMap(updates.colorMap);
    }
    if (updates.range !== undefined) {
      this.setRange(updates.range);
    }
    if (updates.threshold !== undefined) {
      this.setThreshold(updates.threshold);
    }
    if (updates.opacity !== undefined) {
      this.setOpacity(updates.opacity);
    }
    if (updates.visible !== undefined) {
      this.setVisible(updates.visible);
    }
    if (updates.blendMode !== undefined) {
      this.setBlendMode(updates.blendMode);
    }
  }

  dispose(): void {
    this.data = null;
    this.indices = null;
    this.colorMap = null;
    this._cachedRGBABuffer = null;
  }
}

/**
 * Layer with two data values mapped to a 2D colormap.
 *
 * Maps two scalar fields (X and Y) to colors using a 2D colormap texture.
 * Useful for visualizing relationships between variables, such as:
 * - Effect size (X) vs. statistical confidence (Y)
 * - Activation magnitude (X) vs. significance (Y)
 * - Any two correlated or independent scalar fields
 *
 * @example
 * ```typescript
 * const layer = new TwoDataLayer(
 *   'effect-confidence',
 *   effectSizeData,    // X values
 *   confidenceData,    // Y values
 *   indices,
 *   'confidence',      // 2D colormap preset
 *   {
 *     rangeX: [-2, 2],
 *     rangeY: [0, 1],
 *     thresholdY: [0, 0.05]  // Hide low-confidence values
 *   }
 * );
 * ```
 */
export class TwoDataLayer extends Layer {
  private dataX: Float32Array | null = null;
  private dataY: Float32Array | null = null;
  private indices: Uint32Array | null = null;
  private colorMap: ColorMap2D | null = null;
  private colorMapName: ColorMap2DPreset | 'custom' = 'confidence';
  private rangeX: [number, number];
  private rangeY: [number, number];
  private thresholdX: [number, number];
  private thresholdY: [number, number];

  /** Flag to identify this as a 2D data layer for GPU compositor */
  readonly is2DLayer: boolean = true;

  constructor(
    id: string,
    dataX: Float32Array | number[],
    dataY: Float32Array | number[],
    indices: Uint32Array | number[] | null,
    colorMap: ColorMap2D | ColorMap2DPreset,
    config: TwoDataLayerConfig = {}
  ) {
    super(id, config);
    this.rangeX = config.rangeX || [0, 1];
    this.rangeY = config.rangeY || [0, 1];
    this.thresholdX = config.thresholdX || [0, 0];
    this.thresholdY = config.thresholdY || [0, 0];

    // Initialize data
    this.setData(dataX, dataY, indices);
    this.setColorMap(colorMap);
  }

  setData(
    dataX: Float32Array | number[],
    dataY: Float32Array | number[],
    indices?: Uint32Array | number[] | null
  ): void {
    if (!dataX || !dataY) {
      throw new Error('Both dataX and dataY are required');
    }

    this.dataX = dataX instanceof Float32Array ? dataX : new Float32Array(dataX);
    this.dataY = dataY instanceof Float32Array ? dataY : new Float32Array(dataY);

    if (this.dataX.length !== this.dataY.length) {
      throw new Error('dataX and dataY must have the same length');
    }

    if (indices) {
      this.indices = indices instanceof Uint32Array
        ? indices
        : new Uint32Array(indices);
    } else {
      // If no indices provided, assume 1:1 mapping
      this.indices = new Uint32Array(this.dataX.length);
      for (let i = 0; i < this.dataX.length; i++) {
        this.indices[i] = i;
      }
    }

    this.needsUpdate = true;
    debugLog(`TwoDataLayer ${this.id}: Set data with ${this.dataX.length} values`);
  }

  getDataX(): Float32Array | null {
    return this.dataX;
  }

  getDataY(): Float32Array | null {
    return this.dataY;
  }

  setColorMap(colorMap: ColorMap2D | ColorMap2DPreset): void {
    if (!colorMap) {
      throw new Error('ColorMap is required');
    }

    if (colorMap instanceof ColorMap2D) {
      this.colorMap = colorMap;
      this.colorMapName = 'custom';
    } else {
      // It's a preset name
      this.colorMap = ColorMap2D.fromPreset(colorMap, 256, {
        rangeX: this.rangeX,
        rangeY: this.rangeY,
        thresholdX: this.thresholdX,
        thresholdY: this.thresholdY
      });
      this.colorMapName = colorMap;
    }

    // Apply current ranges and thresholds
    this.colorMap.setRangeX(this.rangeX);
    this.colorMap.setRangeY(this.rangeY);
    this.colorMap.setThresholdX(this.thresholdX);
    this.colorMap.setThresholdY(this.thresholdY);

    this.needsUpdate = true;
    debugLog(`TwoDataLayer ${this.id}: ColorMap set to ${this.colorMapName}`);
  }

  getColorMap(): ColorMap2D | null {
    return this.colorMap;
  }

  setRangeX(range: [number, number]): void {
    this.rangeX = range;
    if (this.colorMap) {
      this.colorMap.setRangeX(range);
      this.needsUpdate = true;
    }
  }

  setRangeY(range: [number, number]): void {
    this.rangeY = range;
    if (this.colorMap) {
      this.colorMap.setRangeY(range);
      this.needsUpdate = true;
    }
  }

  setThresholdX(threshold: [number, number]): void {
    this.thresholdX = threshold;
    if (this.colorMap) {
      this.colorMap.setThresholdX(threshold);
      this.needsUpdate = true;
    }
  }

  setThresholdY(threshold: [number, number]): void {
    this.thresholdY = threshold;
    if (this.colorMap) {
      this.colorMap.setThresholdY(threshold);
      this.needsUpdate = true;
    }
  }

  getRangeX(): [number, number] { return [...this.rangeX] as [number, number]; }
  getRangeY(): [number, number] { return [...this.rangeY] as [number, number]; }
  getThresholdX(): [number, number] { return [...this.thresholdX] as [number, number]; }
  getThresholdY(): [number, number] { return [...this.thresholdY] as [number, number]; }
  getColorMapName(): string { return this.colorMapName; }

  getRGBAData(vertexCount: number): Float32Array {
    if (!this.dataX || !this.dataY || !this.colorMap || !this.indices) {
      throw new Error('Data, indices and colorMap must be set');
    }

    debugLog(`TwoDataLayer ${this.id}: getRGBAData called for ${vertexCount} vertices`);

    const rgbaData = new Float32Array(vertexCount * 4);
    rgbaData.fill(0); // Initialize with transparent black

    let nonTransparentCount = 0;

    // Fill in colors for vertices with data
    // Local references for type narrowing
    const indices = this.indices;
    const dataX = this.dataX;
    const dataY = this.dataY;
    const colorMap = this.colorMap;

    for (let i = 0; i < indices.length && i < dataX.length; i++) {
      const vertexIndex = indices[i];
      const valueX = dataX[i];
      const valueY = dataY[i];

      if (vertexIndex >= 0 && vertexIndex < vertexCount) {
        const color = colorMap.getColor(valueX, valueY);
        const offset = vertexIndex * 4;

        rgbaData[offset] = color[0];
        rgbaData[offset + 1] = color[1];
        rgbaData[offset + 2] = color[2];
        rgbaData[offset + 3] = color[3] * this.opacity;

        if (rgbaData[offset + 3] > 0) {
          nonTransparentCount++;
        }
      }
    }

    debugLog(`TwoDataLayer ${this.id}: Generated colors - ${nonTransparentCount} visible`);
    return rgbaData;
  }

  update(updates: TwoDataLayerUpdateData): void {
    if (updates.dataX !== undefined || updates.dataY !== undefined) {
      const newDataX = updates.dataX !== undefined
        ? (updates.dataX instanceof Float32Array ? updates.dataX : new Float32Array(updates.dataX))
        : this.dataX;
      const newDataY = updates.dataY !== undefined
        ? (updates.dataY instanceof Float32Array ? updates.dataY : new Float32Array(updates.dataY))
        : this.dataY;

      if (newDataX && newDataY) {
        this.setData(newDataX, newDataY, updates.indices);
      }
    }
    if (updates.colorMap !== undefined) {
      this.setColorMap(updates.colorMap);
    }
    if (updates.rangeX !== undefined) {
      this.setRangeX(updates.rangeX);
    }
    if (updates.rangeY !== undefined) {
      this.setRangeY(updates.rangeY);
    }
    if (updates.thresholdX !== undefined) {
      this.setThresholdX(updates.thresholdX);
    }
    if (updates.thresholdY !== undefined) {
      this.setThresholdY(updates.thresholdY);
    }
    if (updates.opacity !== undefined) {
      this.setOpacity(updates.opacity);
    }
    if (updates.visible !== undefined) {
      this.setVisible(updates.visible);
    }
    if (updates.blendMode !== undefined) {
      this.setBlendMode(updates.blendMode);
    }
  }

  dispose(): void {
    this.dataX = null;
    this.dataY = null;
    this.indices = null;
    if (this.colorMap) {
      this.colorMap.dispose();
      this.colorMap = null;
    }
  }
}

/**
 * Base layer representing the brain surface itself
 */
export class BaseLayer extends Layer {
  private color: number;

  constructor(color: number = 0xcccccc, config: LayerConfig = {}) {
    super('base', { ...config, order: -1 }); // Base layer always at bottom
    this.color = color;
  }

  setColor(color: number): void {
    this.color = color;
    this.needsUpdate = true;
  }

  getRGBAData(vertexCount: number): Float32Array {
    const rgbaData = new Float32Array(vertexCount * 4);
    
    // Convert color to RGB
    const r = ((this.color >> 16) & 255) / 255;
    const g = ((this.color >> 8) & 255) / 255;
    const b = (this.color & 255) / 255;
    
    // Fill all vertices with the base color
    for (let i = 0; i < rgbaData.length; i += 4) {
      rgbaData[i] = r;
      rgbaData[i + 1] = g;
      rgbaData[i + 2] = b;
      rgbaData[i + 3] = this.opacity;
    }
    
    return rgbaData;
  }

  update(updates: BaseLayerUpdateData): void {
    if (updates.color !== undefined) {
      this.setColor(updates.color);
    }
    if (updates.opacity !== undefined) {
      this.setOpacity(updates.opacity);
    }
    if (updates.visible !== undefined) {
      this.setVisible(updates.visible);
    }
  }
}

/**
 * Categorical label layer: maps per-vertex integer labels to solid colors.
 * Useful for parcellations when used inside a MultiLayerNeuroSurface.
 */
export class LabelLayer extends Layer {
  private labels: Uint32Array;
  private labelMap: Map<number, THREE.Color>;
  private defaultColor: THREE.Color;
  private rgbaBuffer: Float32Array | null = null;

  constructor(id: string, options: LabelLayerOptions) {
    super(id, options);

    if (!options.labels || !options.labelDefs) {
      throw new Error('LabelLayer requires labels and labelDefs');
    }

    this.labels = options.labels instanceof Uint32Array
      ? options.labels
      : options.labels instanceof Int32Array
        ? new Uint32Array(options.labels)
        : new Uint32Array(options.labels);

    this.labelMap = new Map();
    options.labelDefs.forEach(def => {
      this.labelMap.set(def.id, new THREE.Color(def.color as any));
    });

    this.defaultColor = new THREE.Color(options.defaultColor ?? 0x999999);
    this.needsUpdate = true;
  }

  setLabels(labels: Uint32Array | Int32Array | number[]): void {
    this.labels = labels instanceof Uint32Array
      ? labels
      : labels instanceof Int32Array
        ? new Uint32Array(labels)
        : new Uint32Array(labels);
    this.needsUpdate = true;
  }

  setLabelDefs(labelDefs: Array<{ id: number; color: THREE.ColorRepresentation }>): void {
    this.labelMap.clear();
    labelDefs.forEach(def => {
      this.labelMap.set(def.id, new THREE.Color(def.color as any));
    });
    this.needsUpdate = true;
  }

  update(data: LabelLayerOptions & LayerUpdateData): void {
    if (data.labels !== undefined) {
      this.setLabels(data.labels);
    }
    if (data.labelDefs !== undefined) {
      this.setLabelDefs(data.labelDefs);
    }
    if (data.defaultColor !== undefined) {
      this.defaultColor = new THREE.Color(data.defaultColor as any);
      this.needsUpdate = true;
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

  getRGBAData(vertexCount: number): Float32Array {
    if (!this.rgbaBuffer || this.rgbaBuffer.length !== vertexCount * 4) {
      this.rgbaBuffer = new Float32Array(vertexCount * 4);
    }

    const buffer = this.rgbaBuffer;
    const labels = this.labels;
    const map = this.labelMap;
    const defaultColor = this.defaultColor;

    for (let i = 0; i < vertexCount; i++) {
      const labelId = labels[i] ?? -1;
      const color = map.get(labelId) || defaultColor;
      const offset = i * 4;
      buffer[offset] = color.r;
      buffer[offset + 1] = color.g;
      buffer[offset + 2] = color.b;
      buffer[offset + 3] = 1; // alpha; compositing will apply layer opacity
    }

    this.needsUpdate = false;
    return buffer;
  }
}

/**
 * Layer stack manager
 */
export class LayerStack {
  private layers: Map<string, Layer>;
  private layerOrder: string[];
  needsComposite: boolean;

  constructor() {
    this.layers = new Map();
    this.layerOrder = [];
    this.needsComposite = true;
  }

  addLayer(layer: Layer): void {
    this.layers.set(layer.id, layer);
    this.updateLayerOrder();
    this.needsComposite = true;
    debugLog(`Added layer ${layer.id} to stack`);
  }

  removeLayer(id: string): boolean {
    const layer = this.layers.get(id);
    if (layer) {
      if (layer.dispose) {
        layer.dispose();
      }
      this.layers.delete(id);
      this.updateLayerOrder();
      this.needsComposite = true;
      debugLog(`Removed layer ${id} from stack`);
      return true;
    }
    return false;
  }

  getLayer(id: string): Layer | undefined {
    return this.layers.get(id);
  }

  updateLayer(id: string, updates: LayerUpdateData): void {
    const layer = this.layers.get(id);
    if (layer) {
      layer.update(updates);
      if (layer.needsUpdate) {
        this.needsComposite = true;
      }
    }
  }

  getAllLayers(): Layer[] {
    return Array.from(this.layers.values());
  }

  setLayerOrder(ids: string[]): void {
    // Validate that all ids exist
    const validIds = ids.filter(id => this.layers.has(id));
    
    // Add any missing layers to the end
    this.layers.forEach((layer, id) => {
      if (!validIds.includes(id)) {
        validIds.push(id);
      }
    });
    
    this.layerOrder = validIds;
    this.needsComposite = true;
  }

  updateLayerOrder(): void {
    // Sort layers by order property
    this.layerOrder = Array.from(this.layers.keys()).sort((a, b) => {
      const layerA = this.layers.get(a)!;
      const layerB = this.layers.get(b)!;
      return layerA.order - layerB.order;
    });
  }

  getVisibleLayers(): Layer[] {
    return this.layerOrder
      .map(id => this.layers.get(id)!)
      .filter(layer => layer && layer.visible);
  }

  clear(): void {
    this.layers.forEach(layer => {
      if (layer.dispose) {
        layer.dispose();
      }
    });
    this.layers.clear();
    this.layerOrder = [];
    this.needsComposite = true;
  }

  dispose(): void {
    this.clear();
  }
}
