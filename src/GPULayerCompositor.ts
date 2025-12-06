import * as THREE from 'three';
import { Layer, DataLayer, RGBALayer } from './layers';
import { debugLog } from './debug';

/**
 * GPU-accelerated layer compositor using custom shaders
 * Performs layer blending on the GPU for massive performance improvements
 */
export class GPULayerCompositor {
  private vertexCount: number;
  private maxLayers: number;
  private layerTextures: THREE.DataTexture[] = [];
  private material: THREE.ShaderMaterial | null = null;
  private layerDataCache: Map<string, Float32Array> = new Map();

  constructor(vertexCount: number, maxLayers: number = 8) {
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
    const textureSize = Math.ceil(Math.sqrt(this.vertexCount));
    
    for (let i = 0; i < this.maxLayers; i++) {
      const data = new Float32Array(textureSize * textureSize * 4);
      const texture = new THREE.DataTexture(
        data,
        textureSize,
        textureSize,
        THREE.RGBAFormat,
        THREE.FloatType
      );
      texture.needsUpdate = true;
      this.layerTextures.push(texture);
    }
  }

  /**
   * Create custom shader material for layer compositing
   */
  private createShaderMaterial(): void {
    const textureSize = Math.ceil(Math.sqrt(this.vertexCount));

    // Vertex shader - passes through vertex colors and UVs
    const vertexShader = `
      attribute vec3 color;
      varying vec3 vColor;
      varying vec2 vUv;
      varying float vVertexIndex;
      
      void main() {
        vColor = color;
        vUv = uv;
        // Calculate vertex index for texture lookup
        vVertexIndex = float(gl_VertexID);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    // Fragment shader - performs layer compositing
    const fragmentShader = `
      uniform sampler2D layer0;
      uniform sampler2D layer1;
      uniform sampler2D layer2;
      uniform sampler2D layer3;
      uniform sampler2D layer4;
      uniform sampler2D layer5;
      uniform sampler2D layer6;
      uniform sampler2D layer7;
      
      uniform float layerOpacity[8];
      uniform int layerBlendMode[8];
      uniform int layerCount;
      uniform float textureSize;
      uniform vec3 baseColor;
      
      varying vec3 vColor;
      varying vec2 vUv;
      varying float vVertexIndex;
      
      vec4 getLayerColor(int layerIndex, vec2 texCoord) {
        if (layerIndex == 0) return texture2D(layer0, texCoord);
        if (layerIndex == 1) return texture2D(layer1, texCoord);
        if (layerIndex == 2) return texture2D(layer2, texCoord);
        if (layerIndex == 3) return texture2D(layer3, texCoord);
        if (layerIndex == 4) return texture2D(layer4, texCoord);
        if (layerIndex == 5) return texture2D(layer5, texCoord);
        if (layerIndex == 6) return texture2D(layer6, texCoord);
        if (layerIndex == 7) return texture2D(layer7, texCoord);
        return vec4(0.0);
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
        // Calculate texture coordinates from vertex index
        float x = mod(vVertexIndex, textureSize);
        float y = floor(vVertexIndex / textureSize);
        vec2 texCoord = vec2(x + 0.5, y + 0.5) / textureSize;
        
        // Start with base color
        vec4 finalColor = vec4(baseColor, 1.0);
        
        // Composite each layer
        for (int i = 0; i < 8; i++) {
          if (i >= layerCount) break;
          
          vec4 layerColor = getLayerColor(i, texCoord);
          if (layerColor.a > 0.0) {
            finalColor = blendColors(finalColor, layerColor, layerBlendMode[i], layerOpacity[i]);
          }
        }
        
        gl_FragColor = finalColor;
      }
    `;

    // Create uniforms
    const uniforms: any = {
      baseColor: { value: new THREE.Color(0xcccccc) },
      textureSize: { value: textureSize },
      layerCount: { value: 0 },
      layerOpacity: { value: new Float32Array(8).fill(1.0) },
      layerBlendMode: { value: new Int32Array(8).fill(0) }
    };

    // Add layer texture uniforms
    for (let i = 0; i < this.maxLayers; i++) {
      uniforms[`layer${i}`] = { value: this.layerTextures[i] };
    }

    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
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
      
      // Update layer data texture
      this.updateLayerTexture(i, layer);
    }

    // Clear unused layer textures
    for (let i = layerCount; i < this.maxLayers; i++) {
      this.clearLayerTexture(i);
    }
  }

  /**
   * Update a single layer's texture data
   */
  private updateLayerTexture(textureIndex: number, layer: Layer): void {
    const texture = this.layerTextures[textureIndex];
    if (!texture) return;

    // Get RGBA data from layer
    const layerData = layer.getRGBAData(this.vertexCount);
    
    // Copy to texture data (need to pad to texture size)
    const textureSize = Math.ceil(Math.sqrt(this.vertexCount));
    const textureData = texture.image.data as unknown as Float32Array;
    
    // Copy vertex data to texture
    for (let i = 0; i < this.vertexCount; i++) {
      const srcOffset = i * 4;
      const dstOffset = i * 4; // Direct mapping for now
      
      textureData[dstOffset] = layerData[srcOffset];
      textureData[dstOffset + 1] = layerData[srcOffset + 1];
      textureData[dstOffset + 2] = layerData[srcOffset + 2];
      textureData[dstOffset + 3] = layerData[srcOffset + 3];
    }
    
    // Clear any padding
    for (let i = this.vertexCount * 4; i < textureData.length; i++) {
      textureData[i] = 0;
    }
    
    texture.needsUpdate = true;
  }

  /**
   * Clear a layer texture
   */
  private clearLayerTexture(textureIndex: number): void {
    const texture = this.layerTextures[textureIndex];
    if (!texture) return;
    
    const textureData = texture.image.data as unknown as Float32Array;
    textureData.fill(0);
    texture.needsUpdate = true;
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
   * Dispose of GPU resources
   */
  public dispose(): void {
    // Dispose textures
    for (const texture of this.layerTextures) {
      texture.dispose();
    }
    this.layerTextures = [];

    // Dispose material
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }

    // Clear cache
    this.layerDataCache.clear();
  }
}