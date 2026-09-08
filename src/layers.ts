import * as THREE from 'three';
import ColorMap, { ColorMapOptions, Color, ColorArray } from './ColorMap';
import ColorMap2D, { ColorMap2DPreset, ColorMap2DOptions } from './ColorMap2D';
import { debugLog } from './debug';
import { VolumeTexture3D } from './textures/VolumeTexture3D';
import { createColormapTexture } from './textures/createColormapTexture';

export type BlendMode = 'normal' | 'additive' | 'multiply';
export type LayerRole = 'anatomy' | 'data' | 'outline' | 'connectivity';
export type LayerPinnedPosition = 'bottom' | 'top' | null;

export interface LayerOrderConstraints {
  readonly reorderable: boolean;
  readonly pinned: LayerPinnedPosition;
  readonly role: LayerRole;
}

export interface LayerOrderDescriptor extends LayerOrderConstraints {
  readonly id: string;
  readonly index: number;
}

export type LayerOrderFailureCode =
  | 'surface-not-found'
  | 'layer-not-found'
  | 'duplicate-layer-id'
  | 'incomplete-order'
  | 'invalid-destination'
  | 'layer-not-reorderable'
  | 'constraint-violation';

export type LayerOrderResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly order: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: LayerOrderFailureCode;
      readonly message: string;
    };

export interface LayerPresentation {
  readonly label: string;
  readonly description?: string;
  readonly units?: string;
  readonly provenance?: Readonly<Record<string, unknown>>;
  readonly missingValueLabel?: string;
}

export interface LayerHistogram {
  readonly edges: readonly number[];
  readonly counts: readonly number[];
}

export interface LayerDataSummary {
  readonly finiteCount: number;
  readonly missingCount: number;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly histogram?: LayerHistogram;
}

export interface LayerHistogramOptions {
  readonly bins?: number;
  readonly range?: readonly [number, number];
}

export interface LayerDataSummaryOptions {
  readonly histogram?: boolean | LayerHistogramOptions;
}

export type VolumeProjectionMode = 'vertex' | 'fragment' | 'ribbon' | 'hybrid';
export type VolumeSamplingMode = 'nearest' | 'linear';
export type VolumeProjectionQuality = 'interactive' | 'publication';
export type RibbonReducer = 'mean' | 'max' | 'min' | 'median';

export interface RibbonSamplingConfig {
  /** Pial/world-outer surface positions in the same vertex order as the rendered surface. */
  pial?: Float32Array | number[];
  /** White/world-inner surface positions in the same vertex order as the rendered surface. */
  white?: Float32Array | number[];
  /** Number of samples between white and pial, inclusive. */
  samples?: number;
  /** How samples along the ribbon are collapsed to one displayed value. */
  reducer?: RibbonReducer;
}

export interface LayerConfig {
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  /** @deprecated Initialization hint only; use LayerStack ordering commands at runtime. */
  order?: number;
  presentation?: Partial<LayerPresentation>;
}

export interface DataLayerConfig extends LayerConfig {
  range?: [number, number];
  threshold?: [number, number];
}

export interface VolumeProjectionLayerConfig extends DataLayerConfig {
  /** Voxel-to-world affine matrix (column-major) or Matrix4; used to derive world->voxel. */
  affineMatrix?: THREE.Matrix4 | ArrayLike<number>;
  /** Direct world->voxel transform (column-major) or Matrix4; overrides affineMatrix if provided. */
  worldToIJK?: THREE.Matrix4 | ArrayLike<number>;
  /** Simple voxel-to-world fallback when no affine is provided. */
  voxelSize?: [number, number, number];
  /** Simple voxel-to-world fallback when no affine is provided. */
  volumeOrigin?: [number, number, number];
  /** Colormap preset name (GPU path uses a 256x1 colormap texture). */
  colormap?: string;
  /** Use HalfFloatType on the GPU (saves memory, costs CPU conversion). */
  useHalfFloat?: boolean;
  /** Treat values equal to fillValue as transparent (alpha=0). */
  fillValue?: number;
  /** Projection path. Defaults to 'vertex' for current fast behavior. */
  projectionMode?: VolumeProjectionMode;
  /** Scalar sampling method for CPU/publication paths. Defaults to 'nearest' for compatibility. */
  sampling?: VolumeSamplingMode;
  /** Quality hint used by hybrid mode. Defaults to 'interactive'. */
  quality?: VolumeProjectionQuality;
  /** Ribbon sampling options for pial/white cortical thickness sampling. */
  ribbon?: RibbonSamplingConfig;
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

/** Property/value summary delivered when a public layer mutation succeeds. */
export type LayerChangeSet = Readonly<Record<string, unknown>>;

function cloneReadonlyValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => cloneReadonlyValue(item)));
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      const clone: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        clone[key] = cloneReadonlyValue(item);
      }
      return Object.freeze(clone);
    }
  }
  return value;
}

function normalizeLayerPresentation(
  id: string,
  presentation: Partial<LayerPresentation> = {}
): LayerPresentation {
  const normalized: {
    label: string;
    description?: string;
    units?: string;
    provenance?: Readonly<Record<string, unknown>>;
    missingValueLabel?: string;
  } = {
    label: presentation.label?.trim() || id
  };
  if (presentation.description !== undefined) normalized.description = presentation.description;
  if (presentation.units !== undefined) normalized.units = presentation.units;
  if (presentation.missingValueLabel !== undefined) {
    normalized.missingValueLabel = presentation.missingValueLabel;
  }
  if (presentation.provenance !== undefined) {
    normalized.provenance = cloneReadonlyValue(presentation.provenance) as Readonly<Record<string, unknown>>;
  }
  return Object.freeze(normalized);
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

export interface VolumeProjectionLayerUpdateData extends LayerUpdateData {
  volumeData?: Float32Array | number[];
  colormap?: string;
  range?: [number, number];
  threshold?: [number, number];
  worldToIJK?: THREE.Matrix4 | ArrayLike<number>;
  affineMatrix?: THREE.Matrix4 | ArrayLike<number>;
  voxelSize?: [number, number, number];
  volumeOrigin?: [number, number, number];
  useHalfFloat?: boolean;
  fillValue?: number;
  projectionMode?: VolumeProjectionMode;
  sampling?: VolumeSamplingMode;
  quality?: VolumeProjectionQuality;
  ribbon?: RibbonSamplingConfig;
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
  needsUpdate: boolean;
  /** Callback set by the parent surface to propagate observable layer changes. */
  _onChangeCallback: ((changes: LayerChangeSet) => void) | null;
  private _changeBatchDepth: number;
  private _pendingChanges: Record<string, unknown>;
  private _orderHint: number;
  private _orderConstraints: LayerOrderConstraints;
  private _orderConstraintPriority: number;
  private _attachedToLayerStack: boolean;
  private _orderMutationWarned: boolean;
  private _presentation: LayerPresentation;
  private static _outlineCtor: any;
  private static _temporalCtor: any;

  constructor(
    id: string,
    config: LayerConfig = {},
    orderConstraints: Partial<LayerOrderConstraints> & { priority?: number } = {}
  ) {
    this.id = id;
    this.visible = config.visible !== undefined ? config.visible : true;
    this.opacity = config.opacity !== undefined ? config.opacity : 1.0;
    this.blendMode = config.blendMode || 'normal';
    this._orderHint = config.order ?? 0;
    this._orderConstraints = Object.freeze({
      reorderable: orderConstraints.reorderable ?? true,
      pinned: orderConstraints.pinned ?? null,
      role: orderConstraints.role ?? 'data'
    });
    this._orderConstraintPriority = orderConstraints.priority ?? 0;
    this._attachedToLayerStack = false;
    this._orderMutationWarned = false;
    this._presentation = normalizeLayerPresentation(id, config.presentation);
    this.needsUpdate = true;
    this._onChangeCallback = null;
    this._changeBatchDepth = 0;
    this._pendingChanges = {};
  }

  /**
   * Numeric initialization hint used when this layer first enters a stack.
   * Runtime ordering is owned exclusively by LayerStack.
   *
   * @deprecated Use LayerStack.setLayerOrder() or LayerStack.moveLayer() after
   * the layer has been added. Runtime writes are ignored.
   */
  get order(): number {
    return this._orderHint;
  }

  set order(order: number) {
    if (!Number.isFinite(order)) return;
    if (this._attachedToLayerStack) {
      if (!this._orderMutationWarned && order !== this._orderHint) {
        console.warn(
          `Layer.order is an initialization hint; use setLayerOrder() or moveLayer() to reorder attached layer "${this.id}".`
        );
        this._orderMutationWarned = true;
      }
      return;
    }
    this._orderHint = order;
  }

  getOrderConstraints(): LayerOrderConstraints {
    return this._orderConstraints;
  }

  getPresentation(): LayerPresentation {
    return this._presentation;
  }

  setPresentation(presentation: Partial<LayerPresentation>): void {
    this._presentation = normalizeLayerPresentation(this.id, presentation);
    if (this._onChangeCallback) {
      this._onChangeCallback({ presentation: this._presentation });
    }
  }

  /** Scalar layers override this without exposing their underlying arrays. */
  getDataSummary(_options: LayerDataSummaryOptions = {}): LayerDataSummary | null {
    return null;
  }

  /** @internal Surfaces provide their vertex-domain size for sparse summaries. */
  _setDataSummaryDomainSize(_domainSize: number | null): void {
    // Only scalar layers need a domain size.
  }

  /** @internal LayerStack owns attachment and canonical order. */
  _attachToLayerStack(): void {
    this._attachedToLayerStack = true;
  }

  /** @internal LayerStack owns attachment and canonical order. */
  _detachFromLayerStack(): void {
    this._attachedToLayerStack = false;
    this._orderMutationWarned = false;
  }

  /** @internal Stable priority within a pinned role group. */
  _getOrderConstraintPriority(): number {
    return this._orderConstraintPriority;
  }

  /** Notify the parent surface that this layer's data has changed. */
  protected _notifyChange(changes: LayerChangeSet = { content: true }): void {
    this.needsUpdate = true;
    if (this._changeBatchDepth > 0) {
      Object.assign(this._pendingChanges, changes);
      return;
    }
    if (this._onChangeCallback) {
      this._onChangeCallback(changes);
    }
  }

  /** @internal Coalesce a compound update into one parent notification. */
  _beginChangeBatch(): void {
    this._changeBatchDepth += 1;
  }

  /** @internal Complete a compound update and publish its merged changes. */
  _endChangeBatch(): void {
    if (this._changeBatchDepth === 0) return;
    this._changeBatchDepth -= 1;
    if (this._changeBatchDepth > 0) return;

    const changes = this._pendingChanges;
    this._pendingChanges = {};
    if (Object.keys(changes).length > 0 && this._onChangeCallback) {
      this._onChangeCallback(changes);
    }
  }

  setVisible(visible: boolean): void {
    if (this.visible !== visible) {
      this.visible = visible;
      this._notifyChange({ visible });
    }
  }

  setOpacity(opacity: number): void {
    opacity = Math.max(0, Math.min(1, opacity));
    if (this.opacity !== opacity) {
      this.opacity = opacity;
      this._notifyChange({ opacity });
    }
  }

  setBlendMode(mode: BlendMode): void {
    const validModes: BlendMode[] = ['normal', 'additive', 'multiply'];
    if (validModes.includes(mode) && this.blendMode !== mode) {
      this.blendMode = mode;
      this._notifyChange({ blendMode: mode });
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

  /** Serialize common layer state for state persistence. Override in subclasses. */
  toStateJSON(): Record<string, unknown> {
    return {
      id: this.id,
      type: this.constructor.name,
      visible: this.visible,
      opacity: this.opacity,
      blendMode: this.blendMode,
      order: this.order
    };
  }

  static registerOutlineLayer(ctor: any): void {
    Layer._outlineCtor = ctor;
  }

  static registerTemporalLayer(ctor: any): void {
    Layer._temporalCtor = ctor;
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
      order: config.order,
      presentation: config.presentation
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
          order: commonConfig.order,
          presentation: commonConfig.presentation
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
          order: commonConfig.order,
          presentation: commonConfig.presentation
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
      case 'temporal':
        if (!config.frames || !config.times) {
          throw new Error('TemporalDataLayer requires frames and times');
        }
        if (!Layer._temporalCtor) {
          throw new Error('TemporalDataLayer constructor not registered');
        }
        return new Layer._temporalCtor(
          id,
          config.frames,
          config.times,
          config.cmap ?? config.colorMap ?? 'jet',
          {
            ...commonConfig,
            range: config.range,
            threshold: config.threshold,
            factor: config.factor
          }
        );
      case 'volume':
        if (!config.volumeData || !config.dims) {
          throw new Error('VolumeProjectionLayer requires volumeData and dims');
        }
        return new VolumeProjectionLayer(
          id,
          config.volumeData,
          config.dims,
          {
            ...commonConfig,
            colormap: config.colormap ?? config.cmap ?? 'viridis',
            range: config.range,
            threshold: config.threshold,
            worldToIJK: config.worldToIJK,
            affineMatrix: config.affineMatrix ?? config.affine,
            voxelSize: config.voxelSize,
            volumeOrigin: config.volumeOrigin,
            useHalfFloat: config.useHalfFloat,
            fillValue: config.fillValue,
            projectionMode: config.projectionMode,
            sampling: config.sampling,
            quality: config.quality,
            ribbon: config.ribbon
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
    
    this._notifyChange({ rgbaData: true });
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

  toStateJSON(): Record<string, unknown> {
    return { ...super.toStateJSON(), type: 'rgba' };
  }
}

/**
 * Layer with data values and colormap (smart mode)
 */
export class DataLayer extends Layer {
  private data: Float32Array | null = null;
  private indices: Uint32Array | null = null;
  private denseMapping = true;
  private colorMap: ColorMap | null = null;
  private colorMapName: string | null = null;
  private range: [number, number];
  private threshold: [number, number];
  private _cachedRGBABuffer: Float32Array | null = null;
  private dataRevision = 0;
  private summaryDomainSize: number | null = null;
  private baseSummaryCache: LayerDataSummary | null = null;
  private histogramSummaryCache = new Map<string, LayerDataSummary>();
  private sparseDataIndex: Map<number, number> | null = null;

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
    
    this.denseMapping = indices == null;
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

    this.sparseDataIndex = null;
    this._markDataChanged();
    this._notifyChange({ data: true, indices: true });
    debugLog(`DataLayer ${this.id}: Set data with ${this.data.length} values`);
  }

  getData(): Float32Array | null {
    return this.data;
  }

  getDataRevision(): number {
    return this.dataRevision;
  }

  /**
   * Sample the scalar mapped to one surface vertex without exposing private
   * dense or sparse storage. Unmapped, out-of-domain, non-finite, and disposed
   * values return null.
   */
  sampleValueAtVertex(vertexIndex: number): number | null {
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0) return null;
    if (this.summaryDomainSize !== null && vertexIndex >= this.summaryDomainSize) return null;
    if (!this.data || !this.indices) return null;

    let dataIndex: number | undefined;
    if (this.denseMapping) {
      dataIndex = vertexIndex < this.data.length ? vertexIndex : undefined;
    } else {
      if (!this.sparseDataIndex) {
        this.sparseDataIndex = new Map();
        const count = Math.min(this.indices.length, this.data.length);
        for (let index = 0; index < count; index++) {
          // Match rendering and summary semantics: a later duplicate mapping wins.
          this.sparseDataIndex.set(this.indices[index], index);
        }
      }
      dataIndex = this.sparseDataIndex.get(vertexIndex);
    }

    if (dataIndex === undefined) return null;
    const value = this.data[dataIndex];
    return Number.isFinite(value) ? value : null;
  }

  override getDataSummary(options: LayerDataSummaryOptions = {}): LayerDataSummary {
    const base = this.getBaseDataSummary();
    if (!options.histogram) return base;

    const histogramOptions = options.histogram === true ? {} : options.histogram;
    const bins = histogramOptions.bins ?? 32;
    if (!Number.isInteger(bins) || bins < 1 || bins > 4096) {
      throw new RangeError('Histogram bins must be an integer between 1 and 4096.');
    }

    let lower = histogramOptions.range?.[0] ?? base.minimum;
    let upper = histogramOptions.range?.[1] ?? base.maximum;
    if (lower !== null && upper !== null && (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper)) {
      throw new RangeError('Histogram range must contain finite ascending bounds.');
    }

    const cacheKey = `${this.dataRevision}:${this.summaryDomainSize ?? 'stored'}:${bins}:${lower ?? 'empty'}:${upper ?? 'empty'}`;
    const cached = this.histogramSummaryCache.get(cacheKey);
    if (cached) return cached;

    if (lower === null || upper === null) {
      const empty = Object.freeze({
        ...base,
        histogram: Object.freeze({
          edges: Object.freeze([] as number[]),
          counts: Object.freeze([] as number[])
        })
      });
      this.histogramSummaryCache.set(cacheKey, empty);
      return empty;
    }

    if (lower === upper) {
      const halfWidth = Math.max(Math.abs(lower) * 0.5, 0.5);
      lower -= halfWidth;
      upper += halfWidth;
    }

    const edges = new Array<number>(bins + 1);
    const counts = new Array<number>(bins).fill(0);
    const width = upper - lower;
    for (let index = 0; index <= bins; index++) {
      edges[index] = lower + (width * index) / bins;
    }
    const { values } = this.getSummaryValues();
    for (const value of values) {
      if (!Number.isFinite(value) || value < lower || value > upper) continue;
      const bin = value === upper
        ? bins - 1
        : Math.min(bins - 1, Math.floor(((value - lower) / width) * bins));
      counts[bin] += 1;
    }

    const summary = Object.freeze({
      ...base,
      histogram: Object.freeze({
        edges: Object.freeze(edges),
        counts: Object.freeze(counts)
      })
    });
    this.histogramSummaryCache.set(cacheKey, summary);
    return summary;
  }

  override _setDataSummaryDomainSize(domainSize: number | null): void {
    const normalized = domainSize === null ? null : Math.max(0, Math.floor(domainSize));
    if (normalized === this.summaryDomainSize) return;
    this.summaryDomainSize = normalized;
    this.clearSummaryCaches();
  }

  /** Mark in-place scalar changes without allocating a replacement data array. */
  protected _markDataChanged(): void {
    this.dataRevision += 1;
    this.clearSummaryCaches();
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
    this._notifyChange({ colorMap: this.getColorMapName() });
    debugLog(`DataLayer ${this.id}: ColorMap updated, needsUpdate = true`);
  }

  setRange(range: [number, number]): void {
    this.range = range;
    if (this.colorMap) {
      this.colorMap.setRange(range);
      this._notifyChange({ range: [...range] });
    }
  }

  setThreshold(threshold: [number, number]): void {
    this.threshold = threshold;
    if (this.colorMap) {
      this.colorMap.setThreshold(threshold);
      this._notifyChange({ threshold: [...threshold] });
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

  toStateJSON(): Record<string, unknown> {
    return {
      ...super.toStateJSON(),
      type: 'data',
      colorMapName: this.getColorMapName(),
      range: this.getRange(),
      threshold: this.getThreshold()
    };
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

    // Reuse cached buffer if size matches to avoid GC pressure
    if (!this._cachedRGBABuffer || this._cachedRGBABuffer.length !== vertexCount * 4) {
      this._cachedRGBABuffer = new Float32Array(vertexCount * 4);
    }
    const rgbaData = this._cachedRGBABuffer;

    // Initialize with transparent black
    rgbaData.fill(0);

    // Track statistics for debugging
    let nonTransparentCount = 0;
    let transparentCount = 0;

    // Fill in colors for vertices with data
    for (let i = 0; i < this.indices.length && i < this.data.length; i++) {
      const vertexIndex: number = this.indices[i];
      const value = this.data[i];

      // Add bounds and NaN check for safety
      if (vertexIndex >= 0 && vertexIndex < vertexCount && isFinite(value)) {
        const color = this.colorMap.getColor(value);
        const offset = vertexIndex * 4;

        rgbaData[offset] = color[0];     // R
        rgbaData[offset + 1] = color[1]; // G
        rgbaData[offset + 2] = color[2]; // B
        rgbaData[offset + 3] = color[3] ?? 1; // Compositor applies layer opacity once

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
    this.sparseDataIndex = null;
    this._markDataChanged();
  }

  private getBaseDataSummary(): LayerDataSummary {
    if (this.baseSummaryCache) return this.baseSummaryCache;
    const { values, unmappedCount } = this.getSummaryValues();
    let finiteCount = 0;
    let missingCount = unmappedCount;
    let minimum = Infinity;
    let maximum = -Infinity;

    for (const value of values) {
      if (!Number.isFinite(value)) {
        missingCount += 1;
        continue;
      }
      finiteCount += 1;
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }

    this.baseSummaryCache = Object.freeze({
      finiteCount,
      missingCount,
      minimum: finiteCount > 0 ? minimum : null,
      maximum: finiteCount > 0 ? maximum : null
    });
    return this.baseSummaryCache;
  }

  private getSummaryValues(): { values: Iterable<number>; unmappedCount: number } {
    if (!this.data) return { values: [], unmappedCount: this.summaryDomainSize ?? 0 };
    if (this.summaryDomainSize === null) {
      return { values: this.data, unmappedCount: 0 };
    }

    const valuesByVertex = new Map<number, number>();
    const domainSize = this.summaryDomainSize;
    for (let index = 0; index < this.data.length; index++) {
      const vertexIndex = this.denseMapping ? index : this.indices?.[index];
      if (vertexIndex === undefined || vertexIndex < 0 || vertexIndex >= domainSize) continue;
      valuesByVertex.set(vertexIndex, this.data[index]);
    }
    return {
      values: valuesByVertex.values(),
      unmappedCount: Math.max(0, domainSize - valuesByVertex.size)
    };
  }

  private clearSummaryCaches(): void {
    this.baseSummaryCache = null;
    this.histogramSummaryCache.clear();
  }
}

/**
 * GPU volume-to-surface projection layer.
 *
 * In GPU compositing mode, this layer is evaluated in the vertex shader by sampling a
 * 3D texture (WebGL2 required). In CPU mode, this layer falls back to a per-vertex
 * lookup and colormap on the CPU.
 */
export class VolumeProjectionLayer extends Layer {
  private volumeData: Float32Array;
  private readonly dims: [number, number, number];
  private volumeTexture: VolumeTexture3D;
  private worldToIJK: THREE.Matrix4;
  private colorMapName: string;
  private colorMap: ColorMap;
  private colormapTexture: THREE.DataTexture;
  private range: [number, number];
  private threshold: [number, number];
  private fillValue: number;
  private projectionMode: VolumeProjectionMode;
  private sampling: VolumeSamplingMode;
  private quality: VolumeProjectionQuality;
  private ribbonPial: Float32Array | null = null;
  private ribbonWhite: Float32Array | null = null;
  private ribbonSamples: number;
  private ribbonReducer: RibbonReducer;
  private attachedSurface: { geometry: { vertices: Float32Array }; mesh?: THREE.Mesh } | null = null;
  private rgbaBuffer: Float32Array | null = null;

  constructor(
    id: string,
    volumeData: Float32Array | number[],
    dims: [number, number, number],
    config: VolumeProjectionLayerConfig = {}
  ) {
    super(id, config);

    this.dims = dims;
    this.range = config.range || [0, 1];
    this.threshold = config.threshold || [0, 0];
    this.fillValue = config.fillValue ?? 0.0;
    this.projectionMode = config.projectionMode ?? 'vertex';
    this.sampling = config.sampling ?? 'nearest';
    this.quality = config.quality ?? 'interactive';
    this.ribbonSamples = this.normalizeRibbonSamples(config.ribbon?.samples ?? 7);
    this.ribbonReducer = config.ribbon?.reducer ?? 'mean';
    if (config.ribbon?.pial || config.ribbon?.white) {
      this.setRibbonSurfaces(config.ribbon.pial ?? null, config.ribbon.white ?? null, {
        samples: this.ribbonSamples,
        reducer: this.ribbonReducer
      });
    }

    this.volumeData = volumeData instanceof Float32Array ? volumeData : new Float32Array(volumeData);
    this.volumeTexture = new VolumeTexture3D(this.volumeData, dims[0], dims[1], dims[2], {
      useHalfFloat: config.useHalfFloat
    });

    this.worldToIJK = this.computeWorldToIJK(config);

    this.colorMapName = config.colormap ?? 'viridis';
    try {
      this.colorMap = ColorMap.fromPreset(this.colorMapName);
    } catch (err) {
      const presets = ColorMap.getAvailableMaps();
      const fallback = presets.includes('jet') ? 'jet' : (presets[0] || 'jet');
      console.warn(`VolumeProjectionLayer ${this.id}: preset "${this.colorMapName}" unavailable, falling back to "${fallback}"`, err);
      this.colorMapName = fallback;
      this.colorMap = ColorMap.fromPreset(fallback);
    }

    this.colorMap.setRange(this.range);
    this.colorMap.setThreshold(this.threshold);

    this.colormapTexture = createColormapTexture(this.colorMapName);
  }

  /**
   * Attach to a surface to enable CPU fallback sampling.
   * Called by MultiLayerNeuroSurface when the layer is added.
   */
  attach(surface: { geometry: { vertices: Float32Array }; mesh?: THREE.Mesh }): void {
    this.attachedSurface = surface;
    this._notifyChange({ attachment: true });
  }

  detach(): void {
    this.attachedSurface = null;
  }

  getVolumeTexture(): VolumeTexture3D {
    return this.volumeTexture;
  }

  getColormapTexture(): THREE.DataTexture {
    return this.colormapTexture;
  }

  getWorldToIJK(): THREE.Matrix4 {
    return this.worldToIJK;
  }

  getVolumeDims(): THREE.Vector3 {
    return this.volumeTexture.dims;
  }

  getRange(): [number, number] {
    return [...this.range] as [number, number];
  }

  getThreshold(): [number, number] {
    return [...this.threshold] as [number, number];
  }

  getFillValue(): number {
    return this.fillValue;
  }

  getProjectionMode(): VolumeProjectionMode {
    return this.projectionMode;
  }

  getSamplingMode(): VolumeSamplingMode {
    return this.sampling;
  }

  getQuality(): VolumeProjectionQuality {
    return this.quality;
  }

  getRibbonConfig(): { samples: number; reducer: RibbonReducer; hasSurfaces: boolean } {
    return {
      samples: this.ribbonSamples,
      reducer: this.ribbonReducer,
      hasSurfaces: !!(this.ribbonPial && this.ribbonWhite)
    };
  }

  usesGPUVertexProjection(): boolean {
    return this.resolveProjectionMode() === 'vertex';
  }

  setRange(range: [number, number]): void {
    this.range = range;
    this.colorMap.setRange(range);
    this._notifyChange({ range: [...range] });
  }

  setThreshold(threshold: [number, number]): void {
    this.threshold = threshold;
    this.colorMap.setThreshold(threshold);
    this._notifyChange({ threshold: [...threshold] });
  }

  setFillValue(fillValue: number): void {
    this.fillValue = fillValue;
    this._notifyChange({ fillValue });
  }

  setProjectionMode(mode: VolumeProjectionMode): void {
    this.projectionMode = mode;
    this._notifyChange({ projectionMode: mode });
  }

  setSamplingMode(mode: VolumeSamplingMode): void {
    this.sampling = mode;
    this._notifyChange({ sampling: mode });
  }

  setQuality(quality: VolumeProjectionQuality): void {
    this.quality = quality;
    this._notifyChange({ quality });
  }

  setRibbonSurfaces(
    pial: Float32Array | number[] | null,
    white: Float32Array | number[] | null,
    options: { samples?: number; reducer?: RibbonReducer } = {}
  ): void {
    this.ribbonPial = pial ? new Float32Array(pial) : null;
    this.ribbonWhite = white ? new Float32Array(white) : null;
    if ((this.ribbonPial && !this.ribbonWhite) || (!this.ribbonPial && this.ribbonWhite)) {
      throw new Error('VolumeProjectionLayer: ribbon sampling requires both pial and white surfaces');
    }
    if (this.ribbonPial && this.ribbonWhite && this.ribbonPial.length !== this.ribbonWhite.length) {
      throw new Error('VolumeProjectionLayer: pial and white ribbon surfaces must have matching vertex counts');
    }
    if (options.samples !== undefined) {
      this.ribbonSamples = this.normalizeRibbonSamples(options.samples);
    }
    if (options.reducer !== undefined) {
      this.ribbonReducer = options.reducer;
    }
    this._notifyChange({ ribbon: this.getRibbonConfig() });
  }

  setColormap(name: string): void {
    this.colorMapName = name;
    try {
      this.colorMap = ColorMap.fromPreset(name);
    } catch (err) {
      const presets = ColorMap.getAvailableMaps();
      const fallback = presets.includes('jet') ? 'jet' : (presets[0] || 'jet');
      console.warn(`VolumeProjectionLayer ${this.id}: preset "${name}" unavailable, falling back to "${fallback}"`, err);
      this.colorMapName = fallback;
      this.colorMap = ColorMap.fromPreset(fallback);
    }

    this.colorMap.setRange(this.range);
    this.colorMap.setThreshold(this.threshold);

    if (this.colormapTexture) {
      this.colormapTexture.dispose();
    }
    this.colormapTexture = createColormapTexture(this.colorMapName);
    this._notifyChange({ colormap: this.colorMapName });
  }

  setWorldToIJK(matrix: THREE.Matrix4 | ArrayLike<number>): void {
    this.worldToIJK = matrix instanceof THREE.Matrix4
      ? matrix.clone()
      : new THREE.Matrix4().fromArray(Array.from(matrix));
    this._notifyChange({ worldToIJK: true });
  }

  updateVolumeData(data: Float32Array | number[]): void {
    this.volumeData = data instanceof Float32Array ? data : new Float32Array(data);
    this.volumeTexture.updateData(this.volumeData);
    this._notifyChange({ volumeData: true });
  }

  getRGBAData(vertexCount: number): Float32Array {
    if (!this.attachedSurface) {
      throw new Error('VolumeProjectionLayer.getRGBAData requires attachment to a surface');
    }

    const vertices = this.attachedSurface.geometry.vertices;
    if (vertices.length / 3 !== vertexCount) {
      console.warn(`VolumeProjectionLayer ${this.id}: vertexCount mismatch; expected ${vertices.length / 3}, got ${vertexCount}`);
    }

    if (!this.rgbaBuffer || this.rgbaBuffer.length !== vertexCount * 4) {
      this.rgbaBuffer = new Float32Array(vertexCount * 4);
    }

    const rgba = this.rgbaBuffer;
    rgba.fill(0);

    const mesh = this.attachedSurface.mesh;
    if (mesh && typeof mesh.updateMatrixWorld === 'function') {
      mesh.updateMatrixWorld(true);
    }

    const worldMatrix = mesh ? mesh.matrixWorld : new THREE.Matrix4();
    const we = worldMatrix.elements;
    const mode = this.resolveProjectionMode();
    if (mode === 'ribbon') {
      this.validateRibbonForVertexCount(vertexCount);
    }

    for (let vi = 0; vi < vertexCount; vi++) {
      const base = vi * 3;
      const x = vertices[base];
      const y = vertices[base + 1];
      const z = vertices[base + 2];

      const value = mode === 'ribbon'
        ? this.sampleRibbonValue(vi, we)
        : this.sampleValueAtWorldCoordinates(
          we[0] * x + we[4] * y + we[8] * z + we[12],
          we[1] * x + we[5] * y + we[9] * z + we[13],
          we[2] * x + we[6] * y + we[10] * z + we[14]
        );

      if (value === null || !isFinite(value)) continue;
      if (Math.abs(value - this.fillValue) < 1e-6) continue;

      const color = this.colorMap.getColor(value);
      const offset = vi * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = (color.length === 4 ? (color[3] as number) : 1);
    }

    this.needsUpdate = false;
    return rgba;
  }

  sampleValueAtWorld(point: THREE.Vector3): number | null {
    return this.sampleValueAtWorldCoordinates(point.x, point.y, point.z);
  }

  sampleValueAtVertex(vertexIndex: number): number | null {
    if (!this.attachedSurface) {
      throw new Error('VolumeProjectionLayer.sampleValueAtVertex requires attachment to a surface');
    }
    const vertices = this.attachedSurface.geometry.vertices;
    if (vertexIndex < 0 || vertexIndex >= vertices.length / 3) {
      throw new Error(`VolumeProjectionLayer.sampleValueAtVertex vertex ${vertexIndex} out of range`);
    }
    const mesh = this.attachedSurface.mesh;
    if (mesh && typeof mesh.updateMatrixWorld === 'function') {
      mesh.updateMatrixWorld(true);
    }
    const worldMatrix = mesh ? mesh.matrixWorld : new THREE.Matrix4();
    const we = worldMatrix.elements;
    if (this.resolveProjectionMode() === 'ribbon') {
      this.validateRibbonForVertexCount(vertices.length / 3);
      return this.sampleRibbonValue(vertexIndex, we);
    }
    const base = vertexIndex * 3;
    const x = vertices[base];
    const y = vertices[base + 1];
    const z = vertices[base + 2];
    return this.sampleValueAtWorldCoordinates(
      we[0] * x + we[4] * y + we[8] * z + we[12],
      we[1] * x + we[5] * y + we[9] * z + we[13],
      we[2] * x + we[6] * y + we[10] * z + we[14]
    );
  }

  update(updates: VolumeProjectionLayerUpdateData): void {
    if (updates.volumeData !== undefined) {
      this.updateVolumeData(updates.volumeData);
    }
    if (updates.colormap !== undefined) {
      this.setColormap(updates.colormap);
    }
    if (updates.range !== undefined) {
      this.setRange(updates.range);
    }
    if (updates.threshold !== undefined) {
      this.setThreshold(updates.threshold);
    }
    if (updates.worldToIJK !== undefined) {
      this.setWorldToIJK(updates.worldToIJK);
    } else if (updates.affineMatrix !== undefined || updates.voxelSize !== undefined || updates.volumeOrigin !== undefined) {
      this.worldToIJK = this.computeWorldToIJK({
        ...updates,
        range: this.range,
        threshold: this.threshold,
        colormap: this.colorMapName
      });
      this._notifyChange({ worldToIJK: true });
    }
    if (updates.fillValue !== undefined) {
      this.setFillValue(updates.fillValue);
    }
    if (updates.projectionMode !== undefined) {
      this.setProjectionMode(updates.projectionMode);
    }
    if (updates.sampling !== undefined) {
      this.setSamplingMode(updates.sampling);
    }
    if (updates.quality !== undefined) {
      this.setQuality(updates.quality);
    }
    if (updates.ribbon !== undefined) {
      this.setRibbonSurfaces(
        updates.ribbon.pial ?? this.ribbonPial,
        updates.ribbon.white ?? this.ribbonWhite,
        {
          samples: updates.ribbon.samples ?? this.ribbonSamples,
          reducer: updates.ribbon.reducer ?? this.ribbonReducer
        }
      );
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

  toStateJSON(): Record<string, unknown> {
    return {
      ...super.toStateJSON(),
      type: 'volume',
      colorMapName: this.colorMapName,
      range: [...this.range],
      threshold: [...this.threshold],
      fillValue: this.fillValue,
      projectionMode: this.projectionMode,
      sampling: this.sampling,
      quality: this.quality,
      ribbon: {
        samples: this.ribbonSamples,
        reducer: this.ribbonReducer,
        hasSurfaces: !!(this.ribbonPial && this.ribbonWhite)
      }
    };
  }

  dispose(): void {
    this.detach();
    if (this.colormapTexture) {
      this.colormapTexture.dispose();
    }
    if (this.volumeTexture) {
      this.volumeTexture.dispose();
    }
    this.rgbaBuffer = null;
  }

  private resolveProjectionMode(): Exclude<VolumeProjectionMode, 'hybrid'> {
    if (this.projectionMode === 'hybrid') {
      if (this.quality === 'publication' && this.ribbonPial && this.ribbonWhite) return 'ribbon';
      return 'vertex';
    }
    if (this.projectionMode === 'ribbon' && !(this.ribbonPial && this.ribbonWhite)) {
      return 'vertex';
    }
    return this.projectionMode === 'fragment' ? 'fragment' : this.projectionMode;
  }

  private sampleValueAtWorldCoordinates(wx: number, wy: number, wz: number): number | null {
    const me = this.worldToIJK.elements;
    const ijkX = me[0] * wx + me[4] * wy + me[8] * wz + me[12];
    const ijkY = me[1] * wx + me[5] * wy + me[9] * wz + me[13];
    const ijkZ = me[2] * wx + me[6] * wy + me[10] * wz + me[14];
    return this.sampleValueAtIJK(ijkX, ijkY, ijkZ);
  }

  private sampleValueAtIJK(ijkX: number, ijkY: number, ijkZ: number): number | null {
    const nx = this.dims[0];
    const ny = this.dims[1];
    const nz = this.dims[2];

    const uvwX = (ijkX + 0.5) / nx;
    const uvwY = (ijkY + 0.5) / ny;
    const uvwZ = (ijkZ + 0.5) / nz;
    if (
      uvwX < 0 || uvwX > 1 ||
      uvwY < 0 || uvwY > 1 ||
      uvwZ < 0 || uvwZ > 1
    ) {
      return null;
    }

    return this.sampling === 'linear'
      ? this.sampleLinear(ijkX, ijkY, ijkZ)
      : this.sampleNearest(ijkX, ijkY, ijkZ);
  }

  private sampleNearest(ijkX: number, ijkY: number, ijkZ: number): number {
    const nx = this.dims[0];
    const ny = this.dims[1];
    const nz = this.dims[2];
    const i = Math.min(nx - 1, Math.max(0, Math.floor(ijkX + 0.5)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor(ijkY + 0.5)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor(ijkZ + 0.5)));
    return this.volumeData[i + nx * j + nx * ny * k];
  }

  private sampleLinear(ijkX: number, ijkY: number, ijkZ: number): number {
    const nx = this.dims[0];
    const ny = this.dims[1];
    const nz = this.dims[2];
    const x0 = Math.min(nx - 1, Math.max(0, Math.floor(ijkX)));
    const y0 = Math.min(ny - 1, Math.max(0, Math.floor(ijkY)));
    const z0 = Math.min(nz - 1, Math.max(0, Math.floor(ijkZ)));
    const x1 = Math.min(nx - 1, x0 + 1);
    const y1 = Math.min(ny - 1, y0 + 1);
    const z1 = Math.min(nz - 1, z0 + 1);
    const tx = Math.min(1, Math.max(0, ijkX - x0));
    const ty = Math.min(1, Math.max(0, ijkY - y0));
    const tz = Math.min(1, Math.max(0, ijkZ - z0));

    const at = (i: number, j: number, k: number) => this.volumeData[i + nx * j + nx * ny * k];
    const c00 = at(x0, y0, z0) * (1 - tx) + at(x1, y0, z0) * tx;
    const c10 = at(x0, y1, z0) * (1 - tx) + at(x1, y1, z0) * tx;
    const c01 = at(x0, y0, z1) * (1 - tx) + at(x1, y0, z1) * tx;
    const c11 = at(x0, y1, z1) * (1 - tx) + at(x1, y1, z1) * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    return c0 * (1 - tz) + c1 * tz;
  }

  private sampleRibbonValue(vertexIndex: number, worldMatrixElements: ArrayLike<number>): number | null {
    if (!this.ribbonPial || !this.ribbonWhite) return null;
    const base = vertexIndex * 3;
    const values: number[] = [];
    const denom = Math.max(1, this.ribbonSamples - 1);
    for (let s = 0; s < this.ribbonSamples; s++) {
      const t = denom === 0 ? 0 : s / denom;
      const x = this.ribbonWhite[base] + (this.ribbonPial[base] - this.ribbonWhite[base]) * t;
      const y = this.ribbonWhite[base + 1] + (this.ribbonPial[base + 1] - this.ribbonWhite[base + 1]) * t;
      const z = this.ribbonWhite[base + 2] + (this.ribbonPial[base + 2] - this.ribbonWhite[base + 2]) * t;
      const wx = worldMatrixElements[0] * x + worldMatrixElements[4] * y + worldMatrixElements[8] * z + worldMatrixElements[12];
      const wy = worldMatrixElements[1] * x + worldMatrixElements[5] * y + worldMatrixElements[9] * z + worldMatrixElements[13];
      const wz = worldMatrixElements[2] * x + worldMatrixElements[6] * y + worldMatrixElements[10] * z + worldMatrixElements[14];
      const value = this.sampleValueAtWorldCoordinates(wx, wy, wz);
      if (value !== null && isFinite(value) && Math.abs(value - this.fillValue) >= 1e-6) {
        values.push(value);
      }
    }
    if (!values.length) return null;
    switch (this.ribbonReducer) {
      case 'max':
        return Math.max(...values);
      case 'min':
        return Math.min(...values);
      case 'median': {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      }
      case 'mean':
      default:
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  }

  private validateRibbonForVertexCount(vertexCount: number): void {
    if (!this.ribbonPial || !this.ribbonWhite) {
      throw new Error('VolumeProjectionLayer: ribbon projection requires pial and white surfaces');
    }
    const expected = vertexCount * 3;
    if (this.ribbonPial.length !== expected || this.ribbonWhite.length !== expected) {
      throw new Error(`VolumeProjectionLayer: ribbon surface vertex count mismatch; expected ${vertexCount} vertices`);
    }
  }

  private normalizeRibbonSamples(samples: number): number {
    return Math.max(1, Math.min(32, Math.round(samples)));
  }

  private computeWorldToIJK(config: VolumeProjectionLayerConfig | VolumeProjectionLayerUpdateData): THREE.Matrix4 {
    if (config.worldToIJK) {
      return config.worldToIJK instanceof THREE.Matrix4
        ? config.worldToIJK.clone()
        : new THREE.Matrix4().fromArray(Array.from(config.worldToIJK));
    }

    let voxelToWorld: THREE.Matrix4;
    if (config.affineMatrix) {
      voxelToWorld = config.affineMatrix instanceof THREE.Matrix4
        ? config.affineMatrix.clone()
        : new THREE.Matrix4().fromArray(Array.from(config.affineMatrix));
    } else {
      const voxelSize = config.voxelSize ?? [1, 1, 1];
      const origin = config.volumeOrigin ?? [0, 0, 0];
      voxelToWorld = new THREE.Matrix4().set(
        voxelSize[0], 0, 0, origin[0],
        0, voxelSize[1], 0, origin[1],
        0, 0, voxelSize[2], origin[2],
        0, 0, 0, 1
      );
    }

    const worldToVoxel = voxelToWorld.clone();
    const det = worldToVoxel.determinant();
    if (Math.abs(det) < 1e-10) {
      throw new Error('VolumeProjectionLayer: voxel-to-world matrix is singular (determinant ≈ 0). Check voxelSize and affineMatrix.');
    }
    return worldToVoxel.invert();
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

    this._notifyChange({ dataX: true, dataY: true, indices: true });
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

    this._notifyChange({ colorMap: this.colorMapName });
    debugLog(`TwoDataLayer ${this.id}: ColorMap set to ${this.colorMapName}`);
  }

  getColorMap(): ColorMap2D | null {
    return this.colorMap;
  }

  setRangeX(range: [number, number]): void {
    this.rangeX = range;
    if (this.colorMap) {
      this.colorMap.setRangeX(range);
      this._notifyChange({ rangeX: [...range] });
    }
  }

  setRangeY(range: [number, number]): void {
    this.rangeY = range;
    if (this.colorMap) {
      this.colorMap.setRangeY(range);
      this._notifyChange({ rangeY: [...range] });
    }
  }

  setThresholdX(threshold: [number, number]): void {
    this.thresholdX = threshold;
    if (this.colorMap) {
      this.colorMap.setThresholdX(threshold);
      this._notifyChange({ thresholdX: [...threshold] });
    }
  }

  setThresholdY(threshold: [number, number]): void {
    this.thresholdY = threshold;
    if (this.colorMap) {
      this.colorMap.setThresholdY(threshold);
      this._notifyChange({ thresholdY: [...threshold] });
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

  toStateJSON(): Record<string, unknown> {
    return {
      ...super.toStateJSON(),
      type: 'twodata',
      colorMapName: this.getColorMapName(),
      rangeX: this.getRangeX(),
      rangeY: this.getRangeY(),
      thresholdX: this.getThresholdX(),
      thresholdY: this.getThresholdY()
    };
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
    super(
      'base',
      { ...config, order: -1 },
      { role: 'anatomy', pinned: 'bottom', reorderable: false, priority: 1 }
    );
    this.color = color;
  }

  setColor(color: number): void {
    this.color = color;
    this._notifyChange({ color });
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

  toStateJSON(): Record<string, unknown> {
    return { ...super.toStateJSON(), type: 'base', color: this.color };
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
    this._notifyChange({ labels: true });
  }

  setLabelDefs(labelDefs: Array<{ id: number; color: THREE.ColorRepresentation }>): void {
    this.labelMap.clear();
    labelDefs.forEach(def => {
      this.labelMap.set(def.id, new THREE.Color(def.color as any));
    });
    this._notifyChange({ labelDefs: true });
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
      this._notifyChange({ defaultColor: data.defaultColor });
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

  toStateJSON(): Record<string, unknown> {
    return { ...super.toStateJSON(), type: 'label' };
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
    const replaced = this.layers.get(layer.id);
    if (replaced) {
      replaced._detachFromLayerStack();
      this.layerOrder = this.layerOrder.filter(id => id !== layer.id);
    }
    this.layers.set(layer.id, layer);
    this.insertLayerByInitializationHint(layer);
    layer._attachToLayerStack();
    this.needsComposite = true;
    debugLog(`Added layer ${layer.id} to stack`);
  }

  removeLayer(id: string): boolean {
    const layer = this.layers.get(id);
    if (layer) {
      if (layer.dispose) {
        layer.dispose();
      }
      layer._detachFromLayerStack();
      this.layers.delete(id);
      this.layerOrder = this.layerOrder.filter(layerId => layerId !== id);
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
      layer._beginChangeBatch();
      try {
        layer.update(updates);
      } finally {
        layer._endChangeBatch();
      }
      if (layer.needsUpdate) {
        this.needsComposite = true;
      }
    }
  }

  getAllLayers(): Layer[] {
    return [...this.getOrderedLayers()];
  }

  /** Return the exact bottom-to-top order used by CPU and GPU compositing. */
  getOrderedLayers(): readonly Layer[] {
    return Object.freeze(
      this.layerOrder.map(id => this.layers.get(id)).filter((layer): layer is Layer => Boolean(layer))
    );
  }

  getLayerOrderDescriptors(): readonly LayerOrderDescriptor[] {
    return Object.freeze(
      this.layerOrder.map((id, index) => {
        const constraints = this.layers.get(id)!.getOrderConstraints();
        return Object.freeze({ id, index, ...constraints });
      })
    );
  }

  /** Validate a complete bottom-to-top order without mutating the stack. */
  validateLayerOrder(ids: readonly string[]): LayerOrderResult {
    const candidate = [...ids];
    const duplicate = candidate.find((id, index) => candidate.indexOf(id) !== index);
    if (duplicate !== undefined) {
      return this.failure(
        'duplicate-layer-id',
        `Layer order contains duplicate id "${duplicate}".`
      );
    }

    const unknown = candidate.find(id => !this.layers.has(id));
    if (unknown !== undefined) {
      return this.failure('layer-not-found', `Layer "${unknown}" does not exist.`);
    }

    if (candidate.length !== this.layers.size) {
      const missing = this.layerOrder.filter(id => !candidate.includes(id));
      return this.failure(
        'incomplete-order',
        `Layer order must contain every layer exactly once; missing: ${missing.join(', ') || 'unknown'}.`
      );
    }

    const constraintFailure = this.validateConstraints(candidate);
    if (constraintFailure) return constraintFailure;

    const changed = candidate.some((id, index) => id !== this.layerOrder[index]);
    return Object.freeze({
      ok: true,
      changed,
      order: Object.freeze(candidate)
    });
  }

  setLayerOrder(ids: readonly string[]): LayerOrderResult {
    const validation = this.validateLayerOrder(ids);
    if (!validation.ok || !validation.changed) return validation;

    this.layerOrder = [...validation.order];
    this.needsComposite = true;
    return validation;
  }

  moveLayer(layerId: string, destinationIndex: number): LayerOrderResult {
    const layer = this.layers.get(layerId);
    if (!layer) {
      return this.failure('layer-not-found', `Layer "${layerId}" does not exist.`);
    }
    if (!Number.isInteger(destinationIndex) || destinationIndex < 0 || destinationIndex >= this.layerOrder.length) {
      return this.failure(
        'invalid-destination',
        `Destination index ${destinationIndex} is outside the layer stack.`
      );
    }
    if (!layer.getOrderConstraints().reorderable) {
      return this.failure(
        'layer-not-reorderable',
        `Layer "${layerId}" is fixed in the ${layer.getOrderConstraints().pinned ?? 'current'} group.`
      );
    }

    const sourceIndex = this.layerOrder.indexOf(layerId);
    if (sourceIndex === destinationIndex) return this.success(false);

    const candidate = [...this.layerOrder];
    candidate.splice(sourceIndex, 1);
    candidate.splice(destinationIndex, 0, layerId);
    return this.setLayerOrder(candidate);
  }

  /**
   * @deprecated LayerStack maintains canonical order automatically. This
   * compatibility method repairs membership without consulting Layer.order.
   */
  updateLayerOrder(): void {
    this.layerOrder = this.layerOrder.filter(id => this.layers.has(id));
    for (const layer of this.layers.values()) {
      if (!this.layerOrder.includes(layer.id)) {
        this.insertLayerByInitializationHint(layer);
      }
    }
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
      layer._detachFromLayerStack();
    });
    this.layers.clear();
    this.layerOrder = [];
    this.needsComposite = true;
  }

  dispose(): void {
    this.clear();
  }

  private insertLayerByInitializationHint(layer: Layer): void {
    const candidateRank = this.constraintRank(layer);
    const insertionIndex = this.layerOrder.findIndex(id => {
      const existing = this.layers.get(id)!;
      const existingRank = this.constraintRank(existing);
      if (existingRank.pin !== candidateRank.pin) return existingRank.pin > candidateRank.pin;
      if (existingRank.role !== candidateRank.role) return existingRank.role > candidateRank.role;
      if (existingRank.priority !== candidateRank.priority) {
        return existingRank.priority > candidateRank.priority;
      }
      return existing.order > layer.order;
    });
    if (insertionIndex === -1) {
      this.layerOrder.push(layer.id);
    } else {
      this.layerOrder.splice(insertionIndex, 0, layer.id);
    }
  }

  private validateConstraints(candidate: readonly string[]): LayerOrderResult | null {
    let previousPinRank = -1;
    let previousRoleRank = -1;
    let previousPriorityRank = -Infinity;

    for (let index = 0; index < candidate.length; index++) {
      const id = candidate[index];
      const layer = this.layers.get(id)!;
      const rank = this.constraintRank(layer);
      if (
        rank.pin < previousPinRank ||
        (rank.pin === previousPinRank && rank.role < previousRoleRank) ||
        (
          rank.pin === previousPinRank &&
          rank.role === previousRoleRank &&
          rank.priority < previousPriorityRank
        )
      ) {
        return this.failure(
          'constraint-violation',
          `Layer "${id}" cannot cross its ${layer.getOrderConstraints().role} ordering boundary.`
        );
      }
      previousPinRank = rank.pin;
      previousRoleRank = rank.role;
      previousPriorityRank = rank.priority;

      const constraints = layer.getOrderConstraints();
      const currentIndex = this.layerOrder.indexOf(id);
      if (!constraints.reorderable && currentIndex !== index) {
        return this.failure(
          'constraint-violation',
          `Layer "${id}" is fixed at index ${currentIndex}.`
        );
      }
    }
    return null;
  }

  private constraintRank(layer: Layer): { pin: number; role: number; priority: number } {
    const constraints = layer.getOrderConstraints();
    const pin = constraints.pinned === 'bottom' ? 0 : constraints.pinned === 'top' ? 2 : 1;
    const role = {
      anatomy: 0,
      data: 1,
      outline: 2,
      connectivity: 3
    }[constraints.role];
    return { pin, role, priority: layer._getOrderConstraintPriority() };
  }

  private success(changed: boolean): LayerOrderResult {
    return Object.freeze({
      ok: true,
      changed,
      order: Object.freeze([...this.layerOrder])
    });
  }

  private failure(code: LayerOrderFailureCode, message: string): LayerOrderResult {
    return Object.freeze({ ok: false, code, message });
  }
}
