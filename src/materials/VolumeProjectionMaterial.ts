import * as THREE from 'three';
import { VOLUME_PROJECTION_FRAGMENT_SHADER, VOLUME_PROJECTION_VERTEX_SHADER } from '../shaders/volumeProjection';
import { VolumeTexture3D } from '../textures/VolumeTexture3D';
import type { RibbonReducer, VolumeProjectionMode } from '../layers';
import { finiteNumber, finitePair, opacity as validateOpacity } from '../utils/validation';

function requireUniform<T>(
  uniforms: THREE.ShaderMaterial['uniforms'],
  name: string
): THREE.IUniform<T> {
  const uniform = uniforms[name];
  if (!uniform) {
    throw new Error(`VolumeProjectionMaterial: shader uniform ${name} is not registered`);
  }
  return uniform as THREE.IUniform<T>;
}

export interface VolumeProjectionMaterialConfig {
  intensityRange?: [number, number];
  threshold?: [number, number];
  overlayOpacity?: number;
  baseColor?: THREE.ColorRepresentation;
  fillValue?: number;
  ambientIntensity?: number;
  diffuseIntensity?: number;
  specularIntensity?: number;
  shininess?: number;
  projectionMode?: VolumeProjectionMode;
  ribbonSamples?: number;
  ribbonReducer?: RibbonReducer;
}

export interface VolumeProjectionMaterialOptions {
  volumeTexture: VolumeTexture3D;
  worldToIJK: THREE.Matrix4;
  colormapTexture: THREE.Texture;
  config?: VolumeProjectionMaterialConfig;
}

/**
 * Shader material that samples a 3D volume texture at each vertex and maps it
 * through a 1D colormap texture.
 *
 * Requires WebGL2 (GLSL3 + sampler3D).
 */
export class VolumeProjectionMaterial extends THREE.ShaderMaterial {
  constructor(options: VolumeProjectionMaterialOptions) {
    const {
      volumeTexture,
      worldToIJK,
      colormapTexture,
      config = {}
    } = options;

    const {
      intensityRange = [0, 1],
      threshold = [0, 0],
      overlayOpacity = 1.0,
      baseColor = 0x888888,
      fillValue = 0.0,
      ambientIntensity = 0.3,
      diffuseIntensity = 0.6,
      specularIntensity = 0.1,
      shininess = 30.0,
      projectionMode = 'vertex',
      ribbonSamples = 7,
      ribbonReducer = 'mean'
    } = config;
    const normalizedIntensityRange = finitePair(intensityRange, 'intensityRange');
    const normalizedThreshold = finitePair(threshold, 'threshold');
    const normalizedOpacity = validateOpacity(overlayOpacity, 'overlayOpacity');
    const normalizedFillValue = finiteNumber(fillValue, 'fillValue');
    const normalizedAmbient = finiteNumber(ambientIntensity, 'ambientIntensity', { minimum: 0 });
    const normalizedDiffuse = finiteNumber(diffuseIntensity, 'diffuseIntensity', { minimum: 0 });
    const normalizedSpecular = finiteNumber(specularIntensity, 'specularIntensity', { minimum: 0 });
    const normalizedShininess = finiteNumber(shininess, 'shininess', { minimum: 0 });
    const normalizedRibbonSamples = finiteNumber(ribbonSamples, 'ribbonSamples', {
      minimum: 1,
      maximum: 16,
      integer: true
    });

    const base = new THREE.Color(baseColor);

    super({
      glslVersion: THREE.GLSL3,
      vertexShader: VOLUME_PROJECTION_VERTEX_SHADER,
      fragmentShader: VOLUME_PROJECTION_FRAGMENT_SHADER,
      uniforms: {
        uVolumeSampler: { value: volumeTexture.texture },
        uWorldToIJK: { value: worldToIJK.clone() },
        uVolumeDims: { value: volumeTexture.dims.clone() },
        uFillValue: { value: normalizedFillValue },
        uColormapSampler: { value: colormapTexture },
        uIntensityRange: { value: new THREE.Vector2(...normalizedIntensityRange) },
        uThreshold: { value: new THREE.Vector2(...normalizedThreshold) },
        uOverlayOpacity: { value: normalizedOpacity },
        uBaseColor: { value: new THREE.Vector3(base.r, base.g, base.b) },
        uAmbientIntensity: { value: normalizedAmbient },
        uDiffuseIntensity: { value: normalizedDiffuse },
        uSpecularIntensity: { value: normalizedSpecular },
        uShininess: { value: normalizedShininess },
        uProjectionMode: { value: projectionModeToUniform(projectionMode) },
        uRibbonSamples: { value: normalizedRibbonSamples },
        uRibbonReducer: { value: ribbonReducerToUniform(ribbonReducer) }
      },
      side: THREE.DoubleSide
    });
  }

  set intensityRange(range: [number, number]) {
    const normalized = finitePair(range, 'intensityRange');
    requireUniform<THREE.Vector2>(this.uniforms, 'uIntensityRange').value.set(...normalized);
  }

  set threshold(range: [number, number]) {
    const normalized = finitePair(range, 'threshold');
    requireUniform<THREE.Vector2>(this.uniforms, 'uThreshold').value.set(...normalized);
  }

  set overlayOpacity(opacity: number) {
    requireUniform<number>(this.uniforms, 'uOverlayOpacity').value =
      validateOpacity(opacity, 'overlayOpacity');
  }

  set baseColor(color: THREE.ColorRepresentation) {
    const c = new THREE.Color(color);
    requireUniform<THREE.Vector3>(this.uniforms, 'uBaseColor').value.set(c.r, c.g, c.b);
  }

  set colormap(texture: THREE.Texture) {
    requireUniform<THREE.Texture>(this.uniforms, 'uColormapSampler').value = texture;
  }

  setVolumeTexture(volumeTexture: VolumeTexture3D): void {
    requireUniform<THREE.Data3DTexture>(this.uniforms, 'uVolumeSampler').value = volumeTexture.texture;
    requireUniform<THREE.Vector3>(this.uniforms, 'uVolumeDims').value.copy(volumeTexture.dims);
  }

  setWorldToIJK(matrix: THREE.Matrix4): void {
    requireUniform<THREE.Matrix4>(this.uniforms, 'uWorldToIJK').value.copy(matrix);
  }

  setProjectionMode(mode: VolumeProjectionMode): void {
    requireUniform<number>(this.uniforms, 'uProjectionMode').value = projectionModeToUniform(mode);
  }

  setRibbonSampling(samples: number, reducer: RibbonReducer = 'mean'): void {
    requireUniform<number>(this.uniforms, 'uRibbonSamples').value = finiteNumber(samples, 'ribbonSamples', {
      minimum: 1,
      maximum: 16,
      integer: true
    });
    requireUniform<number>(this.uniforms, 'uRibbonReducer').value = ribbonReducerToUniform(reducer);
  }
}

function projectionModeToUniform(mode: VolumeProjectionMode): number {
  switch (mode) {
    case 'fragment':
      return 1;
    case 'ribbon':
      return 2;
    case 'hybrid':
      return 0;
    case 'vertex':
    default:
      return 0;
  }
}

function ribbonReducerToUniform(reducer: RibbonReducer): number {
  switch (reducer) {
    case 'max':
      return 1;
    case 'min':
      return 2;
    case 'median':
      return 3;
    case 'mean':
    default:
      return 0;
  }
}
