import * as THREE from 'three';
import { debugLog } from '../debug';

/** How a {@link VolumeTexture3D} is sampled between voxel centres. */
export type VolumeTextureFilter = 'nearest' | 'linear';

const linearFilteringSupport = new WeakMap<object, { float: boolean }>();

export interface VolumeTexture3DOptions {
  /**
   * Store volume as half-float on the GPU (saves memory, costs CPU conversion).
   * When enabled, Float32Array inputs are converted to Uint16 half-float values.
   */
  useHalfFloat?: boolean;
  /**
   * Sampling between voxel centres (default 'linear'). Float textures need
   * OES_texture_float_linear for linear filtering; where a renderer lacks it,
   * {@link VolumeTexture3D.prepareForRenderer} falls back to nearest.
   */
  filter?: VolumeTextureFilter;
  /**
   * Explicit three.js filters. They override `filter` until `setFilter`
   * replaces both; a linear-filtering fallback restores them afterwards.
   */
  minFilter?: THREE.MinificationTextureFilter;
  magFilter?: THREE.MagnificationTextureFilter;
  wrapS?: THREE.Wrapping;
  wrapT?: THREE.Wrapping;
  wrapR?: THREE.Wrapping;
}

/**
 * Wrapper for uploading volumetric data to GPU as a 3D texture.
 *
 * WebGL2 only.
 */
export class VolumeTexture3D {
  readonly dims: THREE.Vector3;
  readonly texture: THREE.Data3DTexture;
  private readonly useHalfFloat: boolean;
  private requestedFilter: VolumeTextureFilter;
  private degradedToNearest = false;
  /** Explicit three.js filters from the options, until `setFilter` replaces them. */
  private explicitFilters: {
    min?: THREE.MinificationTextureFilter;
    mag?: THREE.MagnificationTextureFilter;
  };

  constructor(
    data: Float32Array | ArrayLike<number>,
    nx: number,
    ny: number,
    nz: number,
    options: VolumeTexture3DOptions = {}
  ) {
    if (nx <= 0 || ny <= 0 || nz <= 0) {
      throw new Error(`VolumeTexture3D: invalid dims (${nx}, ${ny}, ${nz})`);
    }
    const expectedLength = nx * ny * nz;
    if (data.length !== expectedLength) {
      throw new Error(`VolumeTexture3D: data length ${data.length} does not match dims product ${expectedLength}`);
    }

    this.dims = new THREE.Vector3(nx, ny, nz);
    this.useHalfFloat = options.useHalfFloat ?? false;

    const { gpuData, gpuType } = this.prepareData(data);

    this.texture = new THREE.Data3DTexture(gpuData, nx, ny, nz);
    this.texture.format = THREE.RedFormat;
    this.texture.type = gpuType;
    this.requestedFilter = options.filter ??
      (options.magFilter === THREE.NearestFilter ? 'nearest' : 'linear');
    this.explicitFilters = {
      ...(options.minFilter !== undefined ? { min: options.minFilter } : {}),
      ...(options.magFilter !== undefined ? { mag: options.magFilter } : {})
    };
    const [minFilter, magFilter] = this.intendedFilters();
    this.texture.minFilter = minFilter;
    this.texture.magFilter = magFilter;
    this.texture.wrapS = options.wrapS ?? THREE.ClampToEdgeWrapping;
    this.texture.wrapT = options.wrapT ?? THREE.ClampToEdgeWrapping;
    this.texture.wrapR = options.wrapR ?? THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  /** The requested sampling between voxel centres. */
  getFilter(): VolumeTextureFilter {
    return this.requestedFilter;
  }

  /**
   * The sampling the texture actually uses: the requested filter, or
   * 'nearest' after {@link prepareForRenderer} found linear unsupported.
   */
  getEffectiveFilter(): VolumeTextureFilter {
    return this.degradedToNearest ? 'nearest' : this.requestedFilter;
  }

  /**
   * Set sampling between voxel centres. Changing it re-uploads the texture.
   */
  setFilter(filter: VolumeTextureFilter): void {
    if (filter !== 'nearest' && filter !== 'linear') {
      throw new Error(`VolumeTexture3D: unknown filter "${String(filter)}"`);
    }
    this.requestedFilter = filter;
    this.explicitFilters = {};
    this.applyFilters();
  }

  /**
   * Make the texture complete on `renderer`: a linearly filtered float 3D
   * texture without OES_texture_float_linear samples as black, so linear is
   * replaced by nearest there (and restored on a renderer that supports it).
   * Cheap enough to call before every draw; GPU materials do so.
   */
  prepareForRenderer(renderer: THREE.WebGLRenderer): void {
    const needsLinear = this.intendedFilters()
      .some(filter => filter !== THREE.NearestFilter && filter !== THREE.NearestMipmapNearestFilter);
    const degrade = needsLinear &&
      !VolumeTexture3D.supportsLinearFiltering(renderer, { useHalfFloat: this.useHalfFloat });
    if (degrade === this.degradedToNearest) return;
    this.degradedToNearest = degrade;
    if (degrade) {
      debugLog('VolumeTexture3D: OES_texture_float_linear unavailable; sampling with NearestFilter');
    }
    this.applyFilters();
  }

  /**
   * Whether `renderer` can linearly filter this kind of volume texture.
   * WebGL2 filters half-float textures natively; float textures need
   * OES_texture_float_linear.
   */
  static supportsLinearFiltering(
    renderer: THREE.WebGLRenderer,
    options: { useHalfFloat?: boolean } = {}
  ): boolean {
    if (options.useHalfFloat) return true;
    const gl = renderer.getContext();
    let support = linearFilteringSupport.get(gl);
    if (!support) {
      support = { float: gl.getExtension('OES_texture_float_linear') !== null };
      linearFilteringSupport.set(gl, support);
    }
    return support.float;
  }

  /** The filters the texture should use when linear filtering is available. */
  private intendedFilters(): [THREE.MinificationTextureFilter, THREE.MagnificationTextureFilter] {
    const threeFilter = this.requestedFilter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    return [this.explicitFilters.min ?? threeFilter, this.explicitFilters.mag ?? threeFilter];
  }

  private applyFilters(): void {
    const [minFilter, magFilter] = this.degradedToNearest
      ? [THREE.NearestFilter, THREE.NearestFilter]
      : this.intendedFilters();
    if (this.texture.minFilter === minFilter && this.texture.magFilter === magFilter) return;
    this.texture.minFilter = minFilter;
    this.texture.magFilter = magFilter;
    this.texture.needsUpdate = true;
  }

  /**
   * Update the underlying GPU texture data (e.g., for a 4D timepoint change).
   */
  updateData(data: Float32Array | ArrayLike<number>): void {
    const expectedLength = this.dims.x * this.dims.y * this.dims.z;
    if (data.length !== expectedLength) {
      throw new Error(`VolumeTexture3D.updateData: data length ${data.length} does not match dims product ${expectedLength}`);
    }
    const { gpuData } = this.prepareData(data);
    const image: any = this.texture.image;

    // Replace buffer if type/length differs; otherwise update in-place.
    if (
      !image?.data ||
      image.data.length !== gpuData.length ||
      image.data.constructor !== gpuData.constructor
    ) {
      image.data = gpuData;
    } else {
      (image.data as Uint16Array | Float32Array).set(gpuData as any);
    }

    this.texture.needsUpdate = true;
  }

  /**
   * WebGL2 support check. If you require smooth sampling (LinearFilter) for float/half-float,
   * also require the corresponding linear-filtering extension.
   */
  static isSupported(
    renderer: THREE.WebGLRenderer,
    options: { requireLinearFiltering?: boolean; useHalfFloat?: boolean } = {}
  ): boolean {
    const requireLinearFiltering = options.requireLinearFiltering ?? true;
    const useHalfFloat = options.useHalfFloat ?? false;

    if (!renderer.capabilities.isWebGL2) return false;
    if ((renderer.capabilities.maxVertexTextures ?? 0) <= 0) return false;
    if (!requireLinearFiltering) return true;

    return VolumeTexture3D.supportsLinearFiltering(renderer, { useHalfFloat });
  }

  dispose(): void {
    this.texture.dispose();
  }

  private prepareData(
    data: Float32Array | ArrayLike<number>
  ): { gpuData: Float32Array | Uint16Array; gpuType: THREE.TextureDataType } {
    const floatData = data instanceof Float32Array
      ? data
      : (() => {
        const out = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) {
          const value = data[i];
          if (value === undefined) {
            throw new RangeError(`VolumeTexture3D: data value ${i} is missing`);
          }
          out[i] = value;
        }
        return out;
      })();

    if (!this.useHalfFloat) {
      return { gpuData: floatData, gpuType: THREE.FloatType };
    }

    // Convert Float32 -> HalfFloat (Uint16 bit pattern)
    const half = new Uint16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
      half[i] = THREE.DataUtils.toHalfFloat(floatData[i]!);
    }
    return { gpuData: half, gpuType: THREE.HalfFloatType };
  }
}
