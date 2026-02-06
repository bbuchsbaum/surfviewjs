import * as THREE from 'three';
import { Layer, VolumeProjectionLayer } from './layers';
import { ClipPlaneSet, ClipPlane } from './utils/ClipPlane';
import { debugLog } from './debug';

/**
 * GPU-accelerated layer compositor using custom shaders
 * Performs layer blending on the GPU for massive performance improvements
 */
export class GPULayerCompositor {
  private vertexCount: number;
  private maxLayers: number;
  private layerTextureSize!: number;
  private layerTexture!: THREE.DataArrayTexture;
  private volumeColormapsTexture!: THREE.DataArrayTexture;
  private material: THREE.ShaderMaterial | null = null;
  constructor(vertexCount: number, maxLayers: number = 8) {
    if (vertexCount <= 0) {
      throw new Error(`GPULayerCompositor: vertexCount must be positive, got ${vertexCount}`);
    }
    this.vertexCount = vertexCount;
    this.maxLayers = maxLayers;
    this.initializeTextures();
    this.createShaderMaterial();
  }

  /**
   * Initialize data textures for layer data
   * We use 2D textures to store per-vertex data
   */
  private initializeTextures(): void {
    // Calculate texture dimensions (make it roughly square)
    this.layerTextureSize = Math.ceil(Math.sqrt(this.vertexCount));

    // Store all per-layer RGBA buffers in a single 2D array texture to keep vertex shader
    // sampler count under MAX_VERTEX_TEXTURE_IMAGE_UNITS.
    const layerSliceSize = this.layerTextureSize * this.layerTextureSize * 4;
    const layerData = new Float32Array(layerSliceSize * this.maxLayers);
    this.layerTexture = new THREE.DataArrayTexture(layerData, this.layerTextureSize, this.layerTextureSize, this.maxLayers);
    this.layerTexture.format = THREE.RGBAFormat;
    this.layerTexture.type = THREE.FloatType;
    this.layerTexture.minFilter = THREE.NearestFilter;
    this.layerTexture.magFilter = THREE.NearestFilter;
    this.layerTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.layerTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.layerTexture.generateMipmaps = false;
    this.layerTexture.flipY = false;
    this.layerTexture.needsUpdate = true;

    // Store per-volume-layer colormaps in a 2D array texture (256x1 RGBA).
    const cmapWidth = 256;
    const cmapHeight = 1;
    const cmapSliceSize = cmapWidth * cmapHeight * 4;
    const cmapData = new Uint8Array(cmapSliceSize * this.maxLayers);
    this.volumeColormapsTexture = new THREE.DataArrayTexture(cmapData, cmapWidth, cmapHeight, this.maxLayers);
    this.volumeColormapsTexture.format = THREE.RGBAFormat;
    this.volumeColormapsTexture.type = THREE.UnsignedByteType;
    this.volumeColormapsTexture.minFilter = THREE.LinearFilter;
    this.volumeColormapsTexture.magFilter = THREE.LinearFilter;
    this.volumeColormapsTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.volumeColormapsTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.volumeColormapsTexture.generateMipmaps = false;
    this.volumeColormapsTexture.flipY = false;
    this.volumeColormapsTexture.needsUpdate = true;
  }

  /**
   * Create custom shader material for layer compositing
   */
  private createShaderMaterial(): void {
    const textureSize = this.layerTextureSize;

    // Vertex shader - passes through vertex colors and UVs with lighting support
    const vertexShader = `
      precision highp float;
      precision highp sampler3D;

      in float vertexIndex;

      out vec3 vNormal;
      out vec3 vViewPosition;
      out vec3 vWorldPosition;
      out vec4 vLayerColor;

      uniform sampler2DArray layerTextures;

      // Layer kind per slot: 0 = precomputed RGBA texture, 1 = volume projection.
      uniform int layerKind[8];

      // Volume projection resources per slot (only used when layerKind[i] == 1).
      uniform sampler3D volume0;
      uniform sampler3D volume1;
      uniform sampler3D volume2;
      uniform sampler3D volume3;
      uniform sampler3D volume4;
      uniform sampler3D volume5;
      uniform sampler3D volume6;
      uniform sampler3D volume7;

      uniform sampler2DArray volumeColormaps;

      uniform mat4 volumeWorldToIJK[8];
      uniform vec3 volumeDims[8];
      uniform vec2 volumeIntensityRange[8];
      uniform vec2 volumeThreshold[8];
      uniform float volumeFillValue[8];

      uniform float layerOpacity[8];
      uniform int layerBlendMode[8];
      uniform int layerCount;
      uniform float textureSize;
      uniform vec3 baseColor;

      vec4 sampleLayerTexture(int layerIndex, vec2 texCoord) {
        return texture(layerTextures, vec3(texCoord, float(layerIndex)));
      }

      float sampleVolumeValue(int layerIndex, vec3 uvw) {
        if (layerIndex == 0) return texture(volume0, uvw).r;
        if (layerIndex == 1) return texture(volume1, uvw).r;
        if (layerIndex == 2) return texture(volume2, uvw).r;
        if (layerIndex == 3) return texture(volume3, uvw).r;
        if (layerIndex == 4) return texture(volume4, uvw).r;
        if (layerIndex == 5) return texture(volume5, uvw).r;
        if (layerIndex == 6) return texture(volume6, uvw).r;
        if (layerIndex == 7) return texture(volume7, uvw).r;
        return 0.0;
      }

      vec4 sampleVolumeColormap(int layerIndex, float t) {
        return texture(volumeColormaps, vec3(t, 0.5, float(layerIndex)));
      }

      bool inBounds(vec3 uvw) {
        return all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0)));
      }

      vec4 sampleVolumeLayer(int layerIndex, vec3 worldPos) {
        vec3 dims = volumeDims[layerIndex];
        if (dims.x <= 0.0 || dims.y <= 0.0 || dims.z <= 0.0) return vec4(0.0);

        vec3 ijk = (volumeWorldToIJK[layerIndex] * vec4(worldPos, 1.0)).xyz;
        vec3 uvw = (ijk + vec3(0.5)) / dims;

        if (!inBounds(uvw)) return vec4(0.0);

        float v = sampleVolumeValue(layerIndex, uvw);

        if (abs(v - volumeFillValue[layerIndex]) < 1e-6) return vec4(0.0);

        vec2 thresh = volumeThreshold[layerIndex];
        bool thresholdActive = abs(thresh.x - thresh.y) > 1e-10;
        if (thresholdActive && v >= thresh.x && v <= thresh.y) return vec4(0.0);

        vec2 ir = volumeIntensityRange[layerIndex];
        float denom = max(ir.y - ir.x, 1e-10);
        float t = clamp((v - ir.x) / denom, 0.0, 1.0);

        return sampleVolumeColormap(layerIndex, t);
      }

      vec4 getLayerColor(int layerIndex, vec2 texCoord, vec3 worldPos) {
        if (layerKind[layerIndex] == 1) {
          return sampleVolumeLayer(layerIndex, worldPos);
        }
        return sampleLayerTexture(layerIndex, texCoord);
      }

      vec4 blendColors(vec4 base, vec4 overlay, int blendMode, float opacity) {
        vec4 result = base;
        if (blendMode == 0) { // Normal
          result = mix(base, overlay, overlay.a * opacity);
        } else if (blendMode == 1) { // Additive
          result = base + overlay * opacity;
          result = clamp(result, 0.0, 1.0);
        } else if (blendMode == 2) { // Multiply
          result = mix(base, base * overlay, overlay.a * opacity);
        } else if (blendMode == 3) { // Screen
          vec4 screen = vec4(1.0) - (vec4(1.0) - base) * (vec4(1.0) - overlay);
          result = mix(base, screen, overlay.a * opacity);
        }
        return result;
      }

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;

        // Calculate texture coordinates from vertex index in vertex shader
        // This ensures we get the exact vertex color, not interpolated
        float x = mod(vertexIndex, textureSize);
        float y = floor(vertexIndex / textureSize);
        vec2 texCoord = vec2(x + 0.5, y + 0.5) / textureSize;

        // Composite layers in vertex shader to avoid interpolation issues
        vec4 finalColor = vec4(baseColor, 1.0);
        for (int i = 0; i < 8; i++) {
          if (i >= layerCount) break;
          vec4 layerColor = getLayerColor(i, texCoord, vWorldPosition);
          if (layerColor.a > 0.0) {
            finalColor = blendColors(finalColor, layerColor, layerBlendMode[i], layerOpacity[i]);
          }
        }
        vLayerColor = finalColor;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = 1.0;
      }
    `;

    // Fragment shader - applies lighting to pre-computed vertex colors
    const fragmentShader = `
      precision highp float;

      uniform vec3 ambientLight;
      uniform vec3 directionalLight;
      uniform vec3 lightDirection;
      uniform float shininess;

      // Clip plane uniforms (up to 3 planes: X, Y, Z)
      uniform vec3 clipPlaneNormalX;
      uniform vec3 clipPlanePointX;
      uniform bool clipPlaneEnabledX;
      uniform vec3 clipPlaneNormalY;
      uniform vec3 clipPlanePointY;
      uniform bool clipPlaneEnabledY;
      uniform vec3 clipPlaneNormalZ;
      uniform vec3 clipPlanePointZ;
      uniform bool clipPlaneEnabledZ;

      in vec3 vNormal;
      in vec3 vViewPosition;
      in vec3 vWorldPosition;
      in vec4 vLayerColor;

      out vec4 outColor;

      void main() {
        // Apply clip planes - discard fragments on the clipped side
        if (clipPlaneEnabledX && dot(vWorldPosition - clipPlanePointX, clipPlaneNormalX) > 0.0) {
          discard;
        }
        if (clipPlaneEnabledY && dot(vWorldPosition - clipPlanePointY, clipPlaneNormalY) > 0.0) {
          discard;
        }
        if (clipPlaneEnabledZ && dot(vWorldPosition - clipPlanePointZ, clipPlaneNormalZ) > 0.0) {
          discard;
        }

        // Use pre-computed color from vertex shader (avoids interpolation issues)
        vec4 finalColor = vLayerColor;

        // Apply lighting
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);

        // Ambient
        vec3 ambient = ambientLight * finalColor.rgb;

        // Diffuse (Lambertian)
        float diff = max(dot(normal, lightDirection), 0.0);
        vec3 diffuse = directionalLight * diff * finalColor.rgb;

        // Specular (Blinn-Phong)
        vec3 halfDir = normalize(lightDirection + viewDir);
        float spec = pow(max(dot(normal, halfDir), 0.0), shininess);
        vec3 specular = directionalLight * spec * 0.3;

        vec3 litColor = ambient + diffuse + specular;
        outColor = vec4(litColor, finalColor.a);
      }
    `;

    // Create uniforms
    const uniforms: any = {
      baseColor: { value: new THREE.Color(0xcccccc) },
      textureSize: { value: textureSize },
      layerCount: { value: 0 },
      layerOpacity: { value: new Float32Array(8).fill(1.0) },
      layerBlendMode: { value: new Int32Array(8).fill(0) },
      layerKind: { value: new Int32Array(8).fill(0) },
      layerTextures: { value: this.layerTexture },
      volumeWorldToIJK: { value: Array.from({ length: 8 }, () => new THREE.Matrix4()) },
      volumeDims: { value: Array.from({ length: 8 }, () => new THREE.Vector3(1, 1, 1)) },
      volumeIntensityRange: { value: Array.from({ length: 8 }, () => new THREE.Vector2(0, 1)) },
      volumeThreshold: { value: Array.from({ length: 8 }, () => new THREE.Vector2(0, 0)) },
      volumeFillValue: { value: new Float32Array(8).fill(0.0) },
      volumeColormaps: { value: this.volumeColormapsTexture },
      // Lighting uniforms
      ambientLight: { value: new THREE.Color(0x404040) },
      directionalLight: { value: new THREE.Color(0xffffff) },
      lightDirection: { value: new THREE.Vector3(0.5, 0.5, 1).normalize() },
      shininess: { value: 30.0 },
      // Clip plane uniforms
      clipPlaneNormalX: { value: new THREE.Vector3(1, 0, 0) },
      clipPlanePointX: { value: new THREE.Vector3(0, 0, 0) },
      clipPlaneEnabledX: { value: false },
      clipPlaneNormalY: { value: new THREE.Vector3(0, 1, 0) },
      clipPlanePointY: { value: new THREE.Vector3(0, 0, 0) },
      clipPlaneEnabledY: { value: false },
      clipPlaneNormalZ: { value: new THREE.Vector3(0, 0, 1) },
      clipPlanePointZ: { value: new THREE.Vector3(0, 0, 0) },
      clipPlaneEnabledZ: { value: false }
    };

    // Add volume texture uniforms (sampler3D is not array-indexable in WebGL2 reliably across drivers).
    for (let i = 0; i < this.maxLayers; i++) {
      uniforms[`volume${i}`] = { value: null };
    }

    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide
    });
  }

  /**
   * Update layer data in GPU textures
   */
  public updateLayers(layers: Layer[]): void {
    if (!this.material) return;

    const visibleLayers = layers.filter(l => l.visible);
    const layerCount = Math.min(visibleLayers.length, this.maxLayers);
    
    debugLog(`GPULayerCompositor: Updating ${layerCount} layers`);

    // Update layer count
    this.material.uniforms.layerCount.value = layerCount;

    // Update each layer's texture and properties
    for (let i = 0; i < layerCount; i++) {
      const layer = visibleLayers[i];
      
      // Update layer properties
      this.material.uniforms.layerOpacity.value[i] = layer.opacity;
      this.material.uniforms.layerBlendMode.value[i] = this.getBlendModeIndex(layer.blendMode);

      if (layer instanceof VolumeProjectionLayer) {
        this.material.uniforms.layerKind.value[i] = 1;
        this.updateVolumeLayerUniforms(i, layer);
      } else {
        this.material.uniforms.layerKind.value[i] = 0;
        this.updateLayerTexture(i, layer);
      }
    }

    // Clear unused layer textures
    for (let i = layerCount; i < this.maxLayers; i++) {
      this.material.uniforms.layerKind.value[i] = 0;
      this.clearLayerTexture(i);
      this.material.uniforms[`volume${i}`].value = null;
    }
  }

  /**
   * Update a single layer's texture data
   */
  private updateLayerTexture(textureIndex: number, layer: Layer): void {
    // Get RGBA data from layer
    const layerData = layer.getRGBAData(this.vertexCount);
    
    // Copy to texture data (need to pad to texture size)
    const textureSize = this.layerTextureSize;
    const textureData = this.layerTexture.image.data as unknown as Float32Array;
    const sliceSize = textureSize * textureSize * 4;
    const sliceOffset = textureIndex * sliceSize;
    
    // Copy vertex data to texture using bulk TypedArray copy
    textureData.set(layerData.subarray(0, this.vertexCount * 4), sliceOffset);
    
    // Clear any padding
    const paddingStart = sliceOffset + this.vertexCount * 4;
    for (let i = paddingStart; i < sliceOffset + sliceSize; i++) {
      textureData[i] = 0;
    }
    
    this.layerTexture.needsUpdate = true;
  }

  private updateVolumeLayerUniforms(textureIndex: number, layer: VolumeProjectionLayer): void {
    if (!this.material) return;
    const uniforms = this.material.uniforms as any;

    uniforms[`volume${textureIndex}`].value = layer.getVolumeTexture().texture;
    this.updateVolumeColormapSlice(textureIndex, layer.getColormapTexture());

    uniforms.volumeWorldToIJK.value[textureIndex].copy(layer.getWorldToIJK());
    uniforms.volumeDims.value[textureIndex].copy(layer.getVolumeDims());

    const range = layer.getRange();
    uniforms.volumeIntensityRange.value[textureIndex].set(range[0], range[1]);

    const threshold = layer.getThreshold();
    uniforms.volumeThreshold.value[textureIndex].set(threshold[0], threshold[1]);

    uniforms.volumeFillValue.value[textureIndex] = layer.getFillValue();
  }

  private updateVolumeColormapSlice(textureIndex: number, texture: THREE.DataTexture): void {
    const image: any = texture.image;
    const src = image?.data as Uint8Array | undefined;
    if (!src) return;

    const cmapImage: any = this.volumeColormapsTexture.image;
    const dst = cmapImage.data as Uint8Array;
    const sliceSize = cmapImage.width * cmapImage.height * 4;
    const offset = textureIndex * sliceSize;

    if (src.length === sliceSize) {
      dst.set(src, offset);
    } else {
      // Best-effort copy for unexpected sizes.
      const n = Math.min(src.length, sliceSize);
      for (let i = 0; i < n; i++) dst[offset + i] = src[i];
      for (let i = n; i < sliceSize; i++) dst[offset + i] = 0;
    }

    this.volumeColormapsTexture.needsUpdate = true;
  }

  /**
   * Clear a layer texture
   */
  private clearLayerTexture(textureIndex: number): void {
    const textureSize = this.layerTextureSize;
    const sliceSize = textureSize * textureSize * 4;
    const sliceOffset = textureIndex * sliceSize;
    const textureData = this.layerTexture.image.data as unknown as Float32Array;
    textureData.fill(0, sliceOffset, sliceOffset + sliceSize);
    this.layerTexture.needsUpdate = true;
  }

  /**
   * Convert blend mode string to index
   */
  private getBlendModeIndex(blendMode: string): number {
    switch (blendMode) {
      case 'normal': return 0;
      case 'additive': return 1;
      case 'multiply': return 2;
      case 'screen': return 3;
      default: return 0;
    }
  }

  /**
   * Get the shader material for use with Three.js mesh
   */
  public getMaterial(): THREE.ShaderMaterial | null {
    return this.material;
  }

  /**
   * Update base color
   */
  public setBaseColor(color: THREE.ColorRepresentation): void {
    if (this.material) {
      this.material.uniforms.baseColor.value = new THREE.Color(color);
    }
  }

  /**
   * Update clip planes from a ClipPlaneSet
   */
  public setClipPlanes(clipPlanes: ClipPlaneSet): void {
    if (!this.material) return;

    const uniforms = this.material.uniforms;

    // X plane
    const xPlane = clipPlanes.x;
    uniforms.clipPlaneNormalX.value.copy(xPlane.normal);
    uniforms.clipPlanePointX.value.copy(xPlane.point);
    uniforms.clipPlaneEnabledX.value = xPlane.enabled;

    // Y plane
    const yPlane = clipPlanes.y;
    uniforms.clipPlaneNormalY.value.copy(yPlane.normal);
    uniforms.clipPlanePointY.value.copy(yPlane.point);
    uniforms.clipPlaneEnabledY.value = yPlane.enabled;

    // Z plane
    const zPlane = clipPlanes.z;
    uniforms.clipPlaneNormalZ.value.copy(zPlane.normal);
    uniforms.clipPlanePointZ.value.copy(zPlane.point);
    uniforms.clipPlaneEnabledZ.value = zPlane.enabled;
  }

  /**
   * Update a single clip plane
   */
  public setClipPlane(axis: 'x' | 'y' | 'z', plane: ClipPlane): void {
    if (!this.material) return;

    const uniforms = this.material.uniforms;
    const suffix = axis.toUpperCase();

    uniforms[`clipPlaneNormal${suffix}`].value.copy(plane.normal);
    uniforms[`clipPlanePoint${suffix}`].value.copy(plane.point);
    uniforms[`clipPlaneEnabled${suffix}`].value = plane.enabled;
  }

  /**
   * Clear all clip planes (disable them)
   */
  public clearClipPlanes(): void {
    if (!this.material) return;

    const uniforms = this.material.uniforms;
    uniforms.clipPlaneEnabledX.value = false;
    uniforms.clipPlaneEnabledY.value = false;
    uniforms.clipPlaneEnabledZ.value = false;
  }

  /**
   * Dispose of GPU resources
   */
  public dispose(): void {
    if (this.layerTexture) {
      this.layerTexture.dispose();
    }
    if (this.volumeColormapsTexture) {
      this.volumeColormapsTexture.dispose();
    }

    // Dispose material
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }

  }
}
