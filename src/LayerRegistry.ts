import type * as THREE from 'three';
import type ColorMap from './ColorMap';
import type { Color } from './ColorMap';
import type ColorMap2D from './ColorMap2D';
import type { ColorMap2DPreset } from './ColorMap2D';
import { ConnectivityLayer } from './ConnectivityLayer';
import type {
  ConnectivityEdge,
  ConnectivityLayerConfig,
  RenderMode
} from './ConnectivityLayer';
import { OutlineLayer } from './OutlineLayer';
import type { OutlineLayerOptions } from './OutlineLayer';
import {
  BaseLayer,
  DataLayer,
  LabelLayer,
  Layer,
  RGBALayer,
  TwoDataLayer,
  VolumeProjectionLayer
} from './layers';
import type {
  BlendMode,
  DataLayerConfig,
  LabelLayerOptions,
  LayerConfig,
  LayerPresentation,
  RibbonSamplingConfig,
  TwoDataLayerConfig,
  VolumeProjectionLayerConfig,
  VolumeProjectionMode,
  VolumeProjectionQuality,
  VolumeSamplingMode
} from './layers';
import { CurvatureLayer } from './layers/CurvatureLayer';
import type { CurvatureConfig } from './layers/CurvatureLayer';
import { StatisticalMapLayer } from './layers/StatisticalMapLayer';
import type {
  StatisticalMapLayerConfig,
  StatType
} from './layers/StatisticalMapLayer';
import { TemporalDataLayer } from './temporal/TemporalDataLayer';
import type { FactorDescriptor, TemporalDataConfig } from './temporal/types';

/** Minimum discriminated shape accepted by any layer registry. */
export interface RegisteredLayerConfig<Type extends string = string> {
  readonly type: Type;
  readonly id: string;
}

/** Common fields accepted by the built-in factory configurations. */
export interface BuiltInLayerConfigBase<Type extends string> extends RegisteredLayerConfig<Type> {
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  order?: number;
  presentation?: Partial<LayerPresentation>;
  /** @deprecated Use `opacity`. Kept only for legacy configuration input. */
  alpha?: number;
}

export interface BaseLayerFactoryConfig extends BuiltInLayerConfigBase<'base'> {
  readonly id: 'base';
  color?: number;
}

export interface RGBALayerFactoryConfig extends BuiltInLayerConfigBase<'rgba'> {
  data: Float32Array | number[];
}

export interface DataLayerFactoryConfig extends BuiltInLayerConfigBase<'data'> {
  data: Float32Array | number[];
  indices?: Uint32Array | number[] | null;
  colorMap?: ColorMap | string | Color[];
  /** @deprecated Use `colorMap`. */
  cmap?: ColorMap | string | Color[];
  range?: [number, number];
  threshold?: [number, number];
}

export interface OutlineLayerFactoryConfig extends BuiltInLayerConfigBase<'outline'> {
  roiLabels: Uint32Array | Int32Array | number[];
  color?: THREE.ColorRepresentation;
  width?: number;
  halo?: boolean;
  haloColor?: THREE.ColorRepresentation;
  haloWidth?: number;
  offset?: number;
  roiSubset?: number[] | null;
}

export interface LabelLayerFactoryConfig extends BuiltInLayerConfigBase<'label'> {
  labels: Uint32Array | Int32Array | number[];
  labelDefs: Array<{ id: number; color: THREE.ColorRepresentation; name?: string }>;
  defaultColor?: THREE.ColorRepresentation;
}

export interface TwoDataLayerFactoryConfig extends BuiltInLayerConfigBase<'twodata'> {
  dataX: Float32Array | number[];
  dataY: Float32Array | number[];
  indices?: Uint32Array | number[] | null;
  colorMap?: ColorMap2D | ColorMap2DPreset;
  /** @deprecated Use `colorMap`. */
  cmap?: ColorMap2D | ColorMap2DPreset;
  rangeX?: [number, number];
  rangeY?: [number, number];
  thresholdX?: [number, number];
  thresholdY?: [number, number];
}

export interface TemporalLayerFactoryConfig extends BuiltInLayerConfigBase<'temporal'> {
  frames: Float32Array[];
  times: number[];
  colorMap?: ColorMap | string | Color[];
  /** @deprecated Use `colorMap`. */
  cmap?: ColorMap | string | Color[];
  range?: [number, number];
  threshold?: [number, number];
  factor?: FactorDescriptor;
}

export interface VolumeLayerFactoryConfig extends BuiltInLayerConfigBase<'volume'> {
  volumeData: Float32Array | number[];
  dims: [number, number, number];
  colormap?: string;
  /** @deprecated Use `colormap`. */
  cmap?: string;
  range?: [number, number];
  threshold?: [number, number];
  worldToIJK?: THREE.Matrix4 | ArrayLike<number>;
  affineMatrix?: THREE.Matrix4 | ArrayLike<number>;
  /** @deprecated Use `affineMatrix`. */
  affine?: THREE.Matrix4 | ArrayLike<number>;
  voxelSize?: [number, number, number];
  volumeOrigin?: [number, number, number];
  useHalfFloat?: boolean;
  fillValue?: number;
  projectionMode?: VolumeProjectionMode;
  sampling?: VolumeSamplingMode;
  quality?: VolumeProjectionQuality;
  ribbon?: RibbonSamplingConfig;
}

export interface CurvatureLayerFactoryConfig extends BuiltInLayerConfigBase<'curvature'> {
  curvature: Float32Array | number[];
  brightness?: number;
  contrast?: number;
  smoothness?: number;
}

export interface StatisticalLayerFactoryConfig extends BuiltInLayerConfigBase<'statistical'> {
  data: Float32Array | number[];
  indices?: Uint32Array | number[] | null;
  colorMap?: ColorMap | string | Color[];
  /** @deprecated Use `colorMap`. */
  cmap?: ColorMap | string | Color[];
  range?: [number, number];
  threshold?: [number, number];
  pValues?: Float32Array;
  statType?: StatType;
  degreesOfFreedom?: number;
}

export interface ConnectivityLayerFactoryConfig extends BuiltInLayerConfigBase<'connectivity'> {
  edges: ConnectivityEdge[];
  colorMap?: string;
  /** @deprecated Use `colorMap`. */
  cmap?: string;
  weightRange?: [number, number];
  threshold?: number;
  renderMode?: RenderMode;
  tubeRadius?: number;
  tubeRadiusScale?: boolean;
  showNodes?: boolean;
  nodeRadius?: number;
  nodeColor?: THREE.ColorRepresentation;
  topN?: number;
  regionFilter?: number[] | null;
}

export interface BuiltInLayerConfigMap {
  base: BaseLayerFactoryConfig;
  rgba: RGBALayerFactoryConfig;
  data: DataLayerFactoryConfig;
  outline: OutlineLayerFactoryConfig;
  label: LabelLayerFactoryConfig;
  twodata: TwoDataLayerFactoryConfig;
  temporal: TemporalLayerFactoryConfig;
  volume: VolumeLayerFactoryConfig;
  curvature: CurvatureLayerFactoryConfig;
  statistical: StatisticalLayerFactoryConfig;
  connectivity: ConnectivityLayerFactoryConfig;
}

export interface BuiltInLayerMap {
  base: BaseLayer;
  rgba: RGBALayer;
  data: DataLayer;
  outline: OutlineLayer;
  label: LabelLayer;
  twodata: TwoDataLayer;
  temporal: TemporalDataLayer;
  volume: VolumeProjectionLayer;
  curvature: CurvatureLayer;
  statistical: StatisticalMapLayer;
  connectivity: ConnectivityLayer;
}

export type BuiltInLayerType = keyof BuiltInLayerConfigMap;
export type BuiltInLayerRegistryEntries = {
  [Type in BuiltInLayerType]: LayerRegistryEntry<
    BuiltInLayerConfigMap[Type],
    BuiltInLayerMap[Type]
  >;
};
export type BuiltInLayerConfig = BuiltInLayerConfigMap[BuiltInLayerType];
export type BuiltInLayer = BuiltInLayerMap[BuiltInLayerType];
export type BuiltInLayerFor<Config extends BuiltInLayerConfig> =
  BuiltInLayerMap[Config['type']];

export type LayerCreationFailureCode =
  | 'invalid-config'
  | 'unknown-type'
  | 'factory-error';

export class LayerConfigError extends Error {
  readonly code: LayerCreationFailureCode;
  readonly layerType: string | null;
  readonly cause: unknown;

  constructor(
    code: LayerCreationFailureCode,
    message: string,
    layerType: string | null = null,
    cause: unknown = null
  ) {
    super(message);
    this.name = 'LayerConfigError';
    this.code = code;
    this.layerType = layerType;
    this.cause = cause;
  }
}

export type LayerCreationResult<CreatedLayer extends Layer = Layer> =
  | { readonly ok: true; readonly layer: CreatedLayer }
  | { readonly ok: false; readonly error: LayerConfigError };

export interface LayerRegistryEntry<
  Config extends RegisteredLayerConfig = RegisteredLayerConfig,
  CreatedLayer extends Layer = Layer
> {
  readonly config: Config;
  readonly layer: CreatedLayer;
}

export type LayerFactory<
  Config extends RegisteredLayerConfig,
  CreatedLayer extends Layer
> = (config: Config) => CreatedLayer;

export type RegistryType<Entries extends object> = Extract<keyof Entries, string>;
export type RegistryConfigUnion<Entries extends object> =
  Entries[keyof Entries] extends LayerRegistryEntry<infer Config, Layer> ? Config : never;
export type RegistryLayer<Entries extends object, Type extends RegistryType<Entries>> =
  Entries[Type] extends LayerRegistryEntry<RegisteredLayerConfig, infer CreatedLayer>
    ? CreatedLayer
    : never;
export type RegistryLayerUnion<Entries extends object> =
  Entries[keyof Entries] extends LayerRegistryEntry<RegisteredLayerConfig, infer CreatedLayer>
    ? CreatedLayer
    : never;
export type RegistryLayerForConfig<
  Entries extends object,
  Config extends RegisteredLayerConfig
> = Config extends RegisteredLayerConfig<infer Type>
  ? Type extends RegistryType<Entries>
    ? RegistryLayer<Entries, Type>
    : never
  : never;

/**
 * Explicit, duplicate-safe registry for built-in or application-defined layer
 * discriminants. `register` returns the same runtime registry with a widened
 * compile-time type, preserving config-to-layer inference for extensions.
 */
export class LayerRegistry<Entries extends object = Record<never, never>> {
  private readonly factories = new Map<
    string,
    (config: RegisteredLayerConfig) => Layer
  >();
  private sealed = false;

  register<
    Type extends string,
    Config extends RegisteredLayerConfig<Type>,
    CreatedLayer extends Layer
  >(
    type: Type,
    factory: LayerFactory<Config, CreatedLayer>
  ): LayerRegistry<Entries & Record<Type, LayerRegistryEntry<Config, CreatedLayer>>> {
    if (this.sealed) {
      throw new Error('LayerRegistry is sealed; call extend() to create an isolated registry.');
    }
    if (!type) throw new TypeError('LayerRegistry type must be a non-empty string.');
    if (this.factories.has(type)) {
      throw new Error(`LayerRegistry already has a factory for type "${type}".`);
    }
    this.factories.set(
      type,
      factory as unknown as (config: RegisteredLayerConfig) => Layer
    );
    return this as unknown as LayerRegistry<
      Entries & Record<Type, LayerRegistryEntry<Config, CreatedLayer>>
    >;
  }

  /** Create an isolated widened registry without mutating this registry. */
  extend<
    Type extends string,
    Config extends RegisteredLayerConfig<Type>,
    CreatedLayer extends Layer
  >(
    type: Type,
    factory: LayerFactory<Config, CreatedLayer>
  ): LayerRegistry<Entries & Record<Type, LayerRegistryEntry<Config, CreatedLayer>>> {
    const registry = new LayerRegistry<Entries>();
    for (const [registeredType, registeredFactory] of this.factories) {
      registry.factories.set(registeredType, registeredFactory);
    }
    return registry.register(type, factory);
  }

  /** Prevent subsequent in-place registration while retaining read/create operations. */
  seal(): ReadonlyLayerRegistry<Entries> {
    this.sealed = true;
    return this;
  }

  has(type: string): type is RegistryType<Entries> {
    return this.factories.has(type);
  }

  registeredTypes(): readonly RegistryType<Entries>[] {
    return Object.freeze([...this.factories.keys()]) as readonly RegistryType<Entries>[];
  }

  create<Config extends RegistryConfigUnion<Entries>>(
    config: Config
  ): RegistryLayerForConfig<Entries, Config> {
    const result = this.tryCreate(config);
    if (!result.ok) throw result.error;
    return result.layer as RegistryLayerForConfig<Entries, Config>;
  }

  tryCreate(input: unknown): LayerCreationResult<RegistryLayerUnion<Entries>> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {
        ok: false,
        error: new LayerConfigError('invalid-config', 'Layer config must be an object.')
      };
    }
    const candidate = input as { type?: unknown; id?: unknown };
    if (typeof candidate.type !== 'string' || candidate.type.length === 0) {
      return {
        ok: false,
        error: new LayerConfigError(
          'invalid-config',
          'Layer config requires a non-empty string type.'
        )
      };
    }
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
      return {
        ok: false,
        error: new LayerConfigError(
          'invalid-config',
          'Layer config requires a non-empty string id.',
          candidate.type
        )
      };
    }
    const factory = this.factories.get(candidate.type);
    if (!factory) {
      return {
        ok: false,
        error: new LayerConfigError(
          'unknown-type',
          `Unsupported layer type: ${candidate.type}`,
          candidate.type
        )
      };
    }
    try {
      return {
        ok: true,
        layer: factory(input as RegisteredLayerConfig) as RegistryLayerUnion<Entries>
      };
    } catch (error) {
      return {
        ok: false,
        error: new LayerConfigError(
          'factory-error',
          error instanceof Error ? error.message : `Failed to create layer type ${candidate.type}.`,
          candidate.type,
          error
        )
      };
    }
  }
}

export type ReadonlyLayerRegistry<Entries extends object> = Pick<
  LayerRegistry<Entries>,
  'has' | 'registeredTypes' | 'create' | 'tryCreate' | 'extend'
>;

function commonConfig(config: BuiltInLayerConfigBase<string>): LayerConfig {
  const result: LayerConfig = {};
  if (config.visible !== undefined) result.visible = config.visible;
  const configuredOpacity = config.opacity ?? config.alpha;
  if (configuredOpacity !== undefined) result.opacity = configuredOpacity;
  if (config.blendMode !== undefined) result.blendMode = config.blendMode;
  if (config.order !== undefined) result.order = config.order;
  if (config.presentation !== undefined) result.presentation = config.presentation;
  return result;
}

const BUILT_IN_LAYER_FACTORIES: {
  [Type in BuiltInLayerType]: LayerFactory<
    BuiltInLayerConfigMap[Type],
    BuiltInLayerMap[Type]
  >;
} = {
  base: config => new BaseLayer(config.color ?? 0xcccccc, commonConfig(config)),
  rgba: config => new RGBALayer(config.id, config.data, commonConfig(config)),
  data: config => {
    const options: DataLayerConfig = commonConfig(config);
    if (config.range !== undefined) options.range = config.range;
    if (config.threshold !== undefined) options.threshold = config.threshold;
    return new DataLayer(
      config.id,
      config.data,
      config.indices ?? null,
      config.colorMap ?? config.cmap ?? 'jet',
      options
    );
  },
  outline: config => {
    const options: OutlineLayerOptions = {
      ...commonConfig(config),
      roiLabels: config.roiLabels
    };
    if (config.color !== undefined) options.color = config.color;
    if (config.width !== undefined) options.width = config.width;
    if (config.halo !== undefined) options.halo = config.halo;
    if (config.haloColor !== undefined) options.haloColor = config.haloColor;
    if (config.haloWidth !== undefined) options.haloWidth = config.haloWidth;
    if (config.offset !== undefined) options.offset = config.offset;
    if (config.roiSubset !== undefined) options.roiSubset = config.roiSubset;
    return new OutlineLayer(config.id, options);
  },
  label: config => {
    const options: LabelLayerOptions = {
      ...commonConfig(config),
      labels: config.labels,
      labelDefs: config.labelDefs
    };
    if (config.defaultColor !== undefined) options.defaultColor = config.defaultColor;
    return new LabelLayer(config.id, options);
  },
  twodata: config => {
    const options: TwoDataLayerConfig = commonConfig(config);
    if (config.rangeX !== undefined) options.rangeX = config.rangeX;
    if (config.rangeY !== undefined) options.rangeY = config.rangeY;
    if (config.thresholdX !== undefined) options.thresholdX = config.thresholdX;
    if (config.thresholdY !== undefined) options.thresholdY = config.thresholdY;
    return new TwoDataLayer(
      config.id,
      config.dataX,
      config.dataY,
      config.indices ?? null,
      config.colorMap ?? config.cmap ?? 'confidence',
      options
    );
  },
  temporal: config => {
    const options: TemporalDataConfig = commonConfig(config);
    if (config.range !== undefined) options.range = config.range;
    if (config.threshold !== undefined) options.threshold = config.threshold;
    if (config.factor !== undefined) options.factor = config.factor;
    return new TemporalDataLayer(
      config.id,
      config.frames,
      config.times,
      config.colorMap ?? config.cmap ?? 'jet',
      options
    );
  },
  volume: config => {
    const options: VolumeProjectionLayerConfig = commonConfig(config);
    options.colormap = config.colormap ?? config.cmap ?? 'viridis';
    if (config.range !== undefined) options.range = config.range;
    if (config.threshold !== undefined) options.threshold = config.threshold;
    if (config.worldToIJK !== undefined) options.worldToIJK = config.worldToIJK;
    const affine = config.affineMatrix ?? config.affine;
    if (affine !== undefined) options.affineMatrix = affine;
    if (config.voxelSize !== undefined) options.voxelSize = config.voxelSize;
    if (config.volumeOrigin !== undefined) options.volumeOrigin = config.volumeOrigin;
    if (config.useHalfFloat !== undefined) options.useHalfFloat = config.useHalfFloat;
    if (config.fillValue !== undefined) options.fillValue = config.fillValue;
    if (config.projectionMode !== undefined) options.projectionMode = config.projectionMode;
    if (config.sampling !== undefined) options.sampling = config.sampling;
    if (config.quality !== undefined) options.quality = config.quality;
    if (config.ribbon !== undefined) options.ribbon = config.ribbon;
    return new VolumeProjectionLayer(config.id, config.volumeData, config.dims, options);
  },
  curvature: config => {
    const options: CurvatureConfig = commonConfig(config);
    if (config.brightness !== undefined) options.brightness = config.brightness;
    if (config.contrast !== undefined) options.contrast = config.contrast;
    if (config.smoothness !== undefined) options.smoothness = config.smoothness;
    return new CurvatureLayer(config.id, config.curvature, options);
  },
  statistical: config => {
    const options: StatisticalMapLayerConfig = commonConfig(config);
    if (config.range !== undefined) options.range = config.range;
    if (config.threshold !== undefined) options.threshold = config.threshold;
    if (config.pValues !== undefined) options.pValues = config.pValues;
    if (config.statType !== undefined) options.statType = config.statType;
    if (config.degreesOfFreedom !== undefined) {
      options.degreesOfFreedom = config.degreesOfFreedom;
    }
    return new StatisticalMapLayer(
      config.id,
      config.data,
      config.indices ?? null,
      config.colorMap ?? config.cmap ?? 'hot',
      options
    );
  },
  connectivity: config => {
    const options: ConnectivityLayerConfig = commonConfig(config);
    options.colorMap = config.colorMap ?? config.cmap ?? 'hot';
    if (config.weightRange !== undefined) options.weightRange = config.weightRange;
    if (config.threshold !== undefined) options.threshold = config.threshold;
    if (config.renderMode !== undefined) options.renderMode = config.renderMode;
    if (config.tubeRadius !== undefined) options.tubeRadius = config.tubeRadius;
    if (config.tubeRadiusScale !== undefined) options.tubeRadiusScale = config.tubeRadiusScale;
    if (config.showNodes !== undefined) options.showNodes = config.showNodes;
    if (config.nodeRadius !== undefined) options.nodeRadius = config.nodeRadius;
    if (config.nodeColor !== undefined) options.nodeColor = config.nodeColor;
    if (config.topN !== undefined) options.topN = config.topN;
    if (config.regionFilter !== undefined) options.regionFilter = config.regionFilter;
    return new ConnectivityLayer(config.id, config.edges, options);
  }
};

/** Canonical built-in registry. Every built-in discriminant is registered once. */
const mutableBuiltInLayerRegistry = new LayerRegistry()
  .register('base', BUILT_IN_LAYER_FACTORIES.base)
  .register('rgba', BUILT_IN_LAYER_FACTORIES.rgba)
  .register('data', BUILT_IN_LAYER_FACTORIES.data)
  .register('outline', BUILT_IN_LAYER_FACTORIES.outline)
  .register('label', BUILT_IN_LAYER_FACTORIES.label)
  .register('twodata', BUILT_IN_LAYER_FACTORIES.twodata)
  .register('temporal', BUILT_IN_LAYER_FACTORIES.temporal)
  .register('volume', BUILT_IN_LAYER_FACTORIES.volume)
  .register('curvature', BUILT_IN_LAYER_FACTORIES.curvature)
  .register('statistical', BUILT_IN_LAYER_FACTORIES.statistical)
  .register('connectivity', BUILT_IN_LAYER_FACTORIES.connectivity) as unknown as LayerRegistry<
    BuiltInLayerRegistryEntries
  >;

export const builtInLayerRegistry: ReadonlyLayerRegistry<BuiltInLayerRegistryEntries> =
  mutableBuiltInLayerRegistry.seal();

export function tryCreateLayerFromConfig(
  input: unknown
): LayerCreationResult<BuiltInLayer> {
  return builtInLayerRegistry.tryCreate(input);
}

export function createLayerFromConfig<Config extends BuiltInLayerConfig>(
  config: Config
): BuiltInLayerFor<Config> {
  const result = tryCreateLayerFromConfig(config);
  if (!result.ok) throw result.error;
  return result.layer as BuiltInLayerFor<Config>;
}

// Preserve the established static entry point without a patch chain. Both APIs
// now use the exact same registry and typed failure model.
Layer._installConfigFactory(input => {
  const result = tryCreateLayerFromConfig(input);
  if (!result.ok) throw result.error;
  return result.layer;
});
