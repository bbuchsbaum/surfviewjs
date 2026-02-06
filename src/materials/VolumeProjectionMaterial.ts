import * as THREE from 'three';
import { VOLUME_PROJECTION_FRAGMENT_SHADER, VOLUME_PROJECTION_VERTEX_SHADER } from '../shaders/volumeProjection';
import { VolumeTexture3D } from '../textures/VolumeTexture3D';

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
      shininess = 30.0
    } = config;

    const base = new THREE.Color(baseColor);

    super({
      glslVersion: THREE.GLSL3,
      vertexShader: VOLUME_PROJECTION_VERTEX_SHADER,
      fragmentShader: VOLUME_PROJECTION_FRAGMENT_SHADER,
      uniforms: {
        uVolumeSampler: { value: volumeTexture.texture },
        uWorldToIJK: { value: worldToIJK.clone() },
        uVolumeDims: { value: volumeTexture.dims.clone() },
        uFillValue: { value: fillValue },
        uColormapSampler: { value: colormapTexture },
        uIntensityRange: { value: new THREE.Vector2(intensityRange[0], intensityRange[1]) },
        uThreshold: { value: new THREE.Vector2(threshold[0], threshold[1]) },
        uOverlayOpacity: { value: overlayOpacity },
        uBaseColor: { value: new THREE.Vector3(base.r, base.g, base.b) },
        uAmbientIntensity: { value: ambientIntensity },
        uDiffuseIntensity: { value: diffuseIntensity },
        uSpecularIntensity: { value: specularIntensity },
        uShininess: { value: shininess }
      },
      side: THREE.DoubleSide
    });
  }

  set intensityRange(range: [number, number]) {
    (this.uniforms.uIntensityRange.value as THREE.Vector2).set(range[0], range[1]);
  }

  set threshold(range: [number, number]) {
    (this.uniforms.uThreshold.value as THREE.Vector2).set(range[0], range[1]);
  }

  set overlayOpacity(opacity: number) {
    this.uniforms.uOverlayOpacity.value = opacity;
  }

  set baseColor(color: THREE.ColorRepresentation) {
    const c = new THREE.Color(color);
    (this.uniforms.uBaseColor.value as THREE.Vector3).set(c.r, c.g, c.b);
  }

  set colormap(texture: THREE.Texture) {
    this.uniforms.uColormapSampler.value = texture;
  }

  setVolumeTexture(volumeTexture: VolumeTexture3D): void {
    this.uniforms.uVolumeSampler.value = volumeTexture.texture;
    (this.uniforms.uVolumeDims.value as THREE.Vector3).copy(volumeTexture.dims);
  }

  setWorldToIJK(matrix: THREE.Matrix4): void {
    (this.uniforms.uWorldToIJK.value as THREE.Matrix4).copy(matrix);
  }
}

