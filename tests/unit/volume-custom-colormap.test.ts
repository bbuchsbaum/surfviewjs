import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import ColorMap from '../../src/ColorMap';
import { VolumeProjectionLayer } from '../../src/layers';
import { createLayerFromConfig } from '../../src/LayerRegistry';
import { GPULayerCompositor } from '../../src/GPULayerCompositor';
import { createColormapTexture } from '../../src/textures/createColormapTexture';

const colors = [[0,0,1,1], [1,1,1,0.5], [1,0,0,1]];
const vertices = new Float32Array([0,0,0, 1,0,0, 2,0,0]);
function layer(input: ColorMap | string | string[] | number[][]) {
  const result = new VolumeProjectionLayer('custom', [-2,0,2], [3,1,1], { colormap:input, range:[-2,2], fillValue:-999 });
  result.attach({ geometry:{ vertices } });
  return result;
}

describe('custom volume palettes', () => {
  it('uses exact RGB/RGBA colors on CPU and in the discrete GPU texture', () => {
    const volume = layer(colors);
    try {
      expect(Array.from(volume.getRGBAData(3))).toEqual(colors.flat());
      expect(Array.from(volume.getColormapTexture().image.data)).toEqual([0,0,255,255, 255,255,255,128, 255,0,0,255]);
      expect(volume.getColormapTexture().userData.surfviewDiscreteColors).toBe(3);
      expect(volume.sampleColorMap(3)).toEqual(colors);
      volume.setThreshold([-0.5,0.5]);
      expect(Array.from(volume.getRGBAData(3).slice(4,8))).toEqual([0,0,0,0]);
      expect(volume.sampleColorMap(3)).toEqual(colors); // legend is unmasked
    } finally { volume.dispose(); }
  });

  it('copies ColorMap options and colors without mutating a shared slice palette', () => {
    const shared = ColorMap.fromArray(colors, { range:[-8,8], threshold:[-2,2], alpha:0.4 });
    const volume = layer(shared);
    try {
      expect(shared.getRange()).toEqual([-8,8]);
      expect(shared.getThreshold()).toEqual([-2,2]);
      expect(volume.getRGBAData(3)[7]).toBeCloseTo(0.2);
      shared.setAlpha(1);
      shared.setRange([0,1]);
      expect(volume.getRGBAData(3)[7]).toBeCloseTo(0.2);
      const exported = shared.getColors();
      exported[0]![0] = 1;
      expect(shared.getUnmaskedColor(0)[0]).toBe(0);
    } finally { volume.dispose(); }
  });

  it('accepts hex arrays through constructor, registry and updates and disposes replaced textures', () => {
    const volume = createLayerFromConfig({ type:'volume', id:'registry', volumeData:[1], dims:[1,1,1], colormap:['#ff0000','#0000ff'] });
    const dispose = vi.spyOn(volume.getColormapTexture(),'dispose');
    volume.update({ colorMap:['#00ff00'] });
    expect(dispose).toHaveBeenCalledOnce();
    expect(Array.from(volume.getColormapTexture().image.data)).toEqual([0,255,0,255]);
    const saved = JSON.parse(JSON.stringify(volume.toStateJSON()));
    volume.setColormap('magma');
    volume.fromStateJSON(saved);
    expect(Array.from(volume.getColormapTexture().image.data)).toEqual([0,255,0,255]);
    const before = volume.toStateJSON();
    const texture = volume.getColormapTexture();
    expect(()=>volume.update({ colorMap:[], range:[0,10] })).toThrow();
    expect(volume.toStateJSON()).toEqual(before);
    expect(volume.getColormapTexture()).toBe(texture);
    volume.update({ colormap:'viridis' });
    expect(volume.getColormapTexture().image.width).toBe(256);
    expect(volume.getColormapTexture().minFilter).toBe(THREE.LinearFilter);
    volume.dispose();
  });

  it('preserves named texture behavior and includes instance alpha', () => {
    const named = createColormapTexture('viridis');
    const custom = createColormapTexture(ColorMap.fromArray([[1,0,0,0.5]], { alpha:0.4 }));
    expect(named.image.width).toBe(256);
    expect(named.minFilter).toBe(THREE.LinearFilter);
    expect(custom.image.width).toBe(1);
    expect(Array.from(custom.image.data)).toEqual([255,0,0,51]);
    named.dispose(); custom.dispose();
  });

  it('grows the compositor palette array without truncating long custom palettes or losing old slots', () => {
    const short = layer(colors);
    const long = layer(Array.from({ length:513 },(_,i)=>[i/512,0,1-i/512,1]));
    const compositor = new GPULayerCompositor(3,2);
    try {
      compositor.updateLayers([short]);
      short.needsUpdate = false;
      compositor.updateLayers([short,long]);
      const uniforms = compositor.getMaterial()!.uniforms;
      const texture = uniforms.volumeColormaps!.value as THREE.DataArrayTexture;
      expect(texture.image.width).toBe(513);
      expect(Array.from(uniforms.volumeDiscreteColors!.value).slice(0,2)).toEqual([3,513]);
      expect(Array.from((texture.image.data as Uint8Array).slice(0,12))).toEqual([0,0,255,255,255,255,255,128,255,0,0,255]);
      expect(Array.from((texture.image.data as Uint8Array).slice(-4))).toEqual([255,0,0,255]);
      expect(compositor.getMaterial()!.vertexShader).toContain('floor(t * (count - 1.0))');
    } finally { compositor.dispose(); short.dispose(); long.dispose(); }
  });
  it('clears removed volume bindings when a larger palette reallocates the array', () => {
    const a = layer(colors), b = layer(colors);
    const large = layer(Array.from({ length:513 },()=>[1,0,0]));
    const compositor = new GPULayerCompositor(3,2);
    try {
      compositor.updateLayers([a,b]);
      expect(compositor.getMaterial()!.uniforms.volume1!.value).not.toBeNull();
      compositor.updateLayers([large]);
      expect(compositor.getMaterial()!.uniforms.volume1!.value).toBeNull();
      expect(compositor.getLastUpdateStats().clearedLayerSlices).toBe(1);
    } finally { compositor.dispose(); a.dispose(); b.dispose(); large.dispose(); }
  });

});
