import * as THREE from 'three';

export interface ViewerCapabilities {
  webgl2: boolean;
  uint32Indices: boolean;
  floatTextures: boolean;
  maxVertexTextures: number;
  workers: boolean;
  canvas: boolean;
}

/**
 * Detect renderer/browser capabilities once and reuse throughout the viewer.
 */
export function detectCapabilities(renderer: THREE.WebGLRenderer): ViewerCapabilities {
  const caps = renderer.capabilities;
  return {
    webgl2: !!caps.isWebGL2,
    uint32Indices: !!caps.isWebGL2 || !!(renderer.getContext().getExtension && renderer.getContext().getExtension('OES_element_index_uint')),
    floatTextures: !!caps.isWebGL2 || !!(renderer.getContext().getExtension && renderer.getContext().getExtension('OES_texture_float')),
    maxVertexTextures: caps.maxVertexTextures ?? 0,
    workers: typeof Worker !== 'undefined',
    canvas: typeof document !== 'undefined' && !!document.createElement('canvas')
  };
}
