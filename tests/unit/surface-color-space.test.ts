import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { ColorMappedNeuroSurface, SurfaceGeometry } from '../../src/classes';
import { LabeledNeuroSurface } from '../../src/LabeledNeuroSurface';
import { GPULayerCompositor } from '../../src/GPULayerCompositor';
import { LabelLayer } from '../../src/layers';
import { ColorMap } from '../../src/ColorMap';
import { CurvatureLayer } from '../../src/layers/CurvatureLayer';
import {
  createSurfaceShadingUniforms,
  installSurfaceShading,
  SURFACE_LINEAR_VERTEX_COLOR_DEFINE
} from '../../src/surface/SurfaceShading';

/**
 * Colour management contract: layer and composite buffers hold display
 * (sRGB-encoded) colours; shaders decode them to linear before lighting, and
 * the renderer encodes the lit result back to sRGB exactly once. The material
 * colour of a vertex-coloured surface is white, so it never tints the layers.
 */

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function triangle(): SurfaceGeometry {
  return new SurfaceGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    new Uint32Array([0, 1, 2]),
    'left'
  );
}

const capableViewer = () => ({
  renderer: {
    capabilities: { isWebGL2: true, maxVertexTextures: 16, maxTextureSize: 4096 },
    localClippingEnabled: false
  },
  requestRender: () => {}
});

function compileFake(material: THREE.Material): { vertexShader: string; fragmentShader: string } {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <color_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <emissivemap_fragment>\n#include <opaque_fragment>'
  };
  material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
  return shader;
}

function compiled(material: THREE.ShaderMaterial): { vertexShader: string; fragmentShader: string } {
  const shader = { uniforms: { ...material.uniforms }, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader };
  material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
  return shader;
}

/** sRGB electro-optical transfer function, as the shaders implement it. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

describe('vertex-coloured materials are not tinted by the base colour', () => {
  it('uses a white material colour with a tinted baseColor and keeps the tint in the base layer', () => {
    const surface = new MultiLayerNeuroSurface(triangle(), { baseColor: 0xb7c0c8 });
    const material = surface.mesh!.material as THREE.MeshPhongMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.color.getHex()).toBe(0xffffff);
    // The base colour reaches the composite exactly once, as display values.
    const colors = (surface.mesh!.geometry as THREE.BufferGeometry).getAttribute('color').array as Float32Array;
    expect(colors[0]).toBeCloseTo(0xb7 / 255, 6);
    expect(colors[1]).toBeCloseTo(0xc0 / 255, 6);
    expect(colors[2]).toBeCloseTo(0xc8 / 255, 6);
    surface.dispose();
  });

  it('keeps the material white when a curvature underlay hides the base layer', () => {
    const surface = new MultiLayerNeuroSurface(triangle(), {
      baseColor: 0x808080,
      curvature: new Float32Array([0, 0, 0]),
      curvatureOptions: { brightness: 0.6, contrast: 0.4 }
    });
    const material = surface.mesh!.material as THREE.MeshPhongMaterial;
    expect(material.color.getHex()).toBe(0xffffff);
    const colors = (surface.mesh!.geometry as THREE.BufferGeometry).getAttribute('color').array as Float32Array;
    expect(colors[0]).toBeCloseTo(0.6, 6);
    surface.dispose();
  });

  it('routes updateConfig({ color }) to the base layer, not to the material', () => {
    const surface = new MultiLayerNeuroSurface(triangle(), { baseColor: 0x808080 });
    surface.updateConfig({ color: 0x336699 });
    const material = surface.mesh!.material as THREE.MeshPhongMaterial;
    expect(material.color.getHex()).toBe(0xffffff);
    surface.flushPendingColorUpdate();
    const colors = (surface.mesh!.geometry as THREE.BufferGeometry).getAttribute('color').array as Float32Array;
    expect(colors[0]).toBeCloseTo(0x33 / 255, 6);
    expect(colors[1]).toBeCloseTo(0x66 / 255, 6);
    expect(colors[2]).toBeCloseTo(0x99 / 255, 6);
    surface.dispose();
  });

  it('gives the GPU compositing material a white diffuse colour', () => {
    const surface = new MultiLayerNeuroSurface(triangle(), { baseColor: 0xb0b0b0 });
    surface.viewer = capableViewer();
    surface.setCompositingMode(true);
    const gpu = surface.mesh!.material as THREE.ShaderMaterial;
    expect(gpu.isShaderMaterial).toBe(true);
    expect(gpu.uniforms.diffuse.value.getHex()).toBe(0xffffff);
    surface.updateConfig({ color: 0x999999 });
    expect(gpu.uniforms.diffuse.value.getHex()).toBe(0xffffff);
    surface.dispose();
  });

  it('keeps vertex-coloured legacy surfaces white through updateConfig', () => {
    const mapped = new ColorMappedNeuroSurface(triangle(), null, new Float32Array([0, 0.5, 1]), 'viridis', { color: 0xa9a9a9 });
    mapped.updateConfig({ color: 0x777777, shininess: 12 });
    expect((mapped.mesh!.material as THREE.MeshPhongMaterial).color.getHex()).toBe(0xffffff);

    const labeled = new LabeledNeuroSurface(triangle(), null, new Uint32Array([1, 1, 2]), [
      { id: 1, color: 0xff0000 },
      { id: 2, color: 0x00ff00 }
    ]);
    labeled.updateConfig({ color: 0x777777 });
    expect((labeled.mesh!.material as THREE.MeshPhongMaterial).color.getHex()).toBe(0xffffff);
  });
});

describe('display-encoded buffers are decoded to linear in the shader', () => {
  it('decodes the vertex colour and the threshold-edge overlay colour in the surface shading patch', () => {
    const material = new THREE.MeshPhongMaterial({ vertexColors: true });
    installSurfaceShading(material, createSurfaceShadingUniforms());
    const { vertexShader } = compileFake(material);
    expect(vertexShader).toContain('vec3 surfviewSRGBToLinear( vec3 value )');
    expect(vertexShader).toContain(`#ifndef ${SURFACE_LINEAR_VERTEX_COLOR_DEFINE}`);
    expect(vertexShader).toMatch(/vColor\.rgb = surfviewSRGBToLinear\( vColor\.rgb \);/);
    expect(vertexShader).toMatch(/vSurfviewOverlay = vec4\( surfviewSRGBToLinear\( surfviewOverlay\.rgb \), surfviewOverlay\.a \);/);
    // Decoding happens after three.js has assigned vColor.
    expect(vertexShader.indexOf('#include <color_vertex>'))
      .toBeLessThan(vertexShader.indexOf('vColor.rgb = surfviewSRGBToLinear'));
  });

  it('decodes the GPU composite once, after compositeLayers(), and marks it linear', () => {
    const compositor = new GPULayerCompositor(3, 2);
    const material = compositor.getMaterial()!;
    expect(material.defines[SURFACE_LINEAR_VERTEX_COLOR_DEFINE]).toBe('');
    const vertex = material.vertexShader;
    const composite = vertex.indexOf('vColor = compositeLayers();');
    const decode = vertex.indexOf('vColor.rgb = surfviewSRGBToLinear( vColor.rgb );');
    expect(composite).toBeGreaterThan(-1);
    expect(decode).toBeGreaterThan(composite);
    compositor.dispose();
  });

  it('does not decode the GPU composite twice when surface shading is installed on it', () => {
    const surface = new MultiLayerNeuroSurface(triangle(), {});
    surface.viewer = capableViewer();
    surface.setCompositingMode(true);
    const gpu = surface.mesh!.material as THREE.ShaderMaterial;
    const { vertexShader } = compiled(gpu);
    // The shading patch's decode is compiled out by the define; only the
    // compositor's own decode remains active.
    expect(gpu.defines[SURFACE_LINEAR_VERTEX_COLOR_DEFINE]).toBe('');
    const guarded = vertexShader.indexOf(`#ifndef ${SURFACE_LINEAR_VERTEX_COLOR_DEFINE}`);
    expect(guarded).toBeGreaterThan(-1);
    surface.dispose();
  });

  it('matches the CPU reference transfer function', () => {
    // A guard against drifting constants: 0.5 sRGB is 0.214 linear.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 4);
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 8);
  });
});

describe('colour sources produce display (sRGB) components', () => {
  it('linearises colormap colours on legacy ColorMappedNeuroSurface, which has no shader decode', () => {
    // Legacy surfaces write their colour attribute directly; three.js treats it
    // as linear, so display colours are converted on the way in.
    const surface = new ColorMappedNeuroSurface(triangle(), null, new Float32Array([0, 0.5, 1]),
      [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]], { color: 0x808080 });
    const colors = (surface.mesh!.geometry as THREE.BufferGeometry).getAttribute('color').array as Float32Array;
    expect(colors[0]).toBeCloseTo(srgbToLinear(0.5), 5);
    expect(colors[2]).toBeCloseTo(srgbToLinear(0.5), 5);
  });

  it('builds hex-anchored gradients in sRGB, not in linear light', () => {
    const bwr = ColorMap.generatePreset('bwr', 3);
    expect(bwr[0]).toEqual([0, 0, 1]);
    expect(bwr[1]).toEqual([1, 1, 1]);
    expect(bwr[2]).toEqual([1, 0, 0]);
    const blues = ColorMap.generatePreset('blues', 4);
    expect(blues[0]![0]).toBeCloseTo(0xf7 / 255, 6);
    expect(blues[3]![2]).toBeCloseTo(0x9c / 255, 6);
    // Midpoint of a two-anchor segment is the sRGB average.
    const coolwarm = ColorMap.generatePreset('coolwarm', 15);
    expect(coolwarm[0]![0]).toBeCloseTo(0x3b / 255, 6);
    expect(coolwarm[1]![0]).toBeCloseTo((0x3b / 255 + 0x77 / 255) / 2, 6);
  });

  it('writes label colours as sRGB components', () => {
    const layer = new LabelLayer('labels', {
      labels: new Uint32Array([1, 2]),
      labelDefs: [{ id: 1, color: 0x808080 }, { id: 2, color: '#336699' }],
      defaultColor: 0x404040
    });
    const rgba = layer.getRGBAData(3);
    expect(rgba[0]).toBeCloseTo(0x80 / 255, 6);
    expect(rgba[4]).toBeCloseTo(0x33 / 255, 6);
    expect(rgba[6]).toBeCloseTo(0x99 / 255, 6);
    expect(rgba[8]).toBeCloseTo(0x40 / 255, 6);
  });

  it('stores the GPU base colour as sRGB components', () => {
    const compositor = new GPULayerCompositor(3, 2);
    compositor.setBaseColor(0x336699);
    const base = compositor.getMaterial()!.uniforms.baseColor.value as THREE.Color;
    expect(base.r).toBeCloseTo(0x33 / 255, 6);
    expect(base.g).toBeCloseTo(0x66 / 255, 6);
    expect(base.b).toBeCloseTo(0x99 / 255, 6);
    compositor.dispose();
  });
});

describe('CurvatureLayer gyri-light default', () => {
  it('renders negative (gyral) curvature lighter by default', () => {
    const layer = new CurvatureLayer('curv', new Float32Array([-0.4, 0, 0.4]), { brightness: 0.5, contrast: 0.5 });
    const rgba = layer.getRGBAData(3);
    expect(rgba[0]).toBeCloseTo(0.7, 6);
    expect(rgba[4]).toBeCloseTo(0.5, 6);
    expect(rgba[8]).toBeCloseTo(0.3, 6);
    expect(layer.getDisplayParams().invert).toBe(false);
  });

  it('restores the old mapping with invert and round-trips it', () => {
    const layer = new CurvatureLayer('curv', new Float32Array([-0.4, 0.4]), { brightness: 0.5, contrast: 0.5, invert: true });
    let rgba = layer.getRGBAData(2);
    expect(rgba[0]).toBeCloseTo(0.3, 6);
    expect(rgba[4]).toBeCloseTo(0.7, 6);
    expect(layer.toStateJSON()).toMatchObject({ type: 'curvature', invert: true });
    layer.update({ invert: false });
    rgba = layer.getRGBAData(2);
    expect(rgba[0]).toBeCloseTo(0.7, 6);
    expect(layer.toStateJSON()).not.toHaveProperty('invert');
    layer.setInvert(true);
    expect(layer.getDisplayParams().invert).toBe(true);
    expect(() => layer.update({ invert: 'yes' as unknown as boolean })).toThrow();
  });

  it('passes invert through MultiLayerNeuroSurface curvature options', () => {
    const surface = new MultiLayerNeuroSurface(triangle(), {
      curvature: new Float32Array([-0.4, 0, 0.4]),
      curvatureOptions: { brightness: 0.5, contrast: 0.5, invert: true }
    });
    expect(surface.getCurvatureLayer()!.getDisplayParams().invert).toBe(true);
    surface.setCurvature(new Float32Array([0, 0, 0]), { invert: false });
    expect(surface.getCurvatureLayer()!.getDisplayParams().invert).toBe(false);
    surface.dispose();
  });
});
