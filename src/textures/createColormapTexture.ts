import * as THREE from 'three';
import ColorMap, { ColorArray } from '../ColorMap';

export function createColormapTexture(name: string, size: number = 256): THREE.DataTexture {
  let colors: ColorArray[];
  try {
    colors = ColorMap.generatePreset(name, size);
  } catch (err) {
    const presets = ColorMap.getAvailableMaps();
    const fallback = presets.includes('jet') ? 'jet' : (presets[0] || 'jet');
    console.warn(`createColormapTexture: preset "${name}" unavailable, falling back to "${fallback}"`, err);
    colors = ColorMap.generatePreset(fallback, size);
  }
  const data = new Uint8Array(size * 4);

  for (let i = 0; i < size; i++) {
    const c = colors[i] ?? [0, 0, 0, 1];
    const r = Math.max(0, Math.min(1, c[0] ?? 0));
    const g = Math.max(0, Math.min(1, c[1] ?? 0));
    const b = Math.max(0, Math.min(1, c[2] ?? 0));
    const a = Math.max(0, Math.min(1, c[3] ?? 1));

    const o = i * 4;
    data[o] = Math.round(r * 255);
    data[o + 1] = Math.round(g * 255);
    data[o + 2] = Math.round(b * 255);
    data[o + 3] = Math.round(a * 255);
  }

  const texture = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  return texture;
}
