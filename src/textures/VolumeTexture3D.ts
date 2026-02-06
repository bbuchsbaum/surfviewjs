import * as THREE from 'three';

export interface VolumeTexture3DOptions {
  /**
   * Store volume as half-float on the GPU (saves memory, costs CPU conversion).
   * When enabled, Float32Array inputs are converted to Uint16 half-float values.
   */
  useHalfFloat?: boolean;
  /**
   * 3D texture filtering. For FloatType with linear filtering, WebGL needs
   * OES_texture_float_linear. If unsupported, use NearestFilter.
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
    this.texture.minFilter = options.minFilter ?? THREE.LinearFilter;
    this.texture.magFilter = options.magFilter ?? THREE.LinearFilter;
    this.texture.wrapS = options.wrapS ?? THREE.ClampToEdgeWrapping;
    this.texture.wrapT = options.wrapT ?? THREE.ClampToEdgeWrapping;
    this.texture.wrapR = options.wrapR ?? THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1;
    this.texture.generateMipmaps = false;
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

    const gl = renderer.getContext();
    const extName = useHalfFloat ? 'OES_texture_half_float_linear' : 'OES_texture_float_linear';
    return gl.getExtension(extName) !== null;
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
          out[i] = data[i];
        }
        return out;
      })();

    if (!this.useHalfFloat) {
      return { gpuData: floatData, gpuType: THREE.FloatType };
    }

    // Convert Float32 -> HalfFloat (Uint16 bit pattern)
    const half = new Uint16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
      half[i] = THREE.DataUtils.toHalfFloat(floatData[i]);
    }
    return { gpuData: half, gpuType: THREE.HalfFloatType };
  }
}
