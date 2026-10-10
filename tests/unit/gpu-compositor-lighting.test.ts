import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GPULayerCompositor } from '../../src/GPULayerCompositor';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { SurfaceGeometry } from '../../src/classes';
import { DataLayer, RGBALayer, VolumeProjectionLayer } from '../../src/layers';

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
}

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

/** Run a material's onBeforeCompile against its own shader sources. */
function compiled(material: THREE.ShaderMaterial) {
  const shader = {
    uniforms: { ...material.uniforms },
    vertexShader: material.vertexShader,
    fragmentShader: material.fragmentShader
  };
  material.onBeforeCompile(shader as any, {} as any);
  return shader;
}

describe('GPULayerCompositor lighting', () => {
  it('lights with the scene lights through three.js Phong lighting', () => {
    const compositor = new GPULayerCompositor(3, 2);
    const material = compositor.getMaterial()!;
    expect(material.lights).toBe(true);
    for (const uniform of ['ambientLightColor', 'directionalLights', 'pointLights', 'hemisphereLights']) {
      expect(material.uniforms[uniform], uniform).toBeDefined();
    }
    // No private light rig.
    expect(material.uniforms.ambientLight).toBeUndefined();
    expect(material.uniforms.directionalLight).toBeUndefined();
    expect(material.uniforms.lightDirection).toBeUndefined();
    expect(material.fragmentShader).toContain('#include <lights_fragment_begin>');
    expect(material.fragmentShader).toContain('#include <lights_phong_fragment>');
    expect(material.fragmentShader).not.toMatch(/0\.3\s*;/);
    compositor.dispose();
  });

  it('takes its material response from the surface material settings', () => {
    const compositor = new GPULayerCompositor(3, 2);
    const material = compositor.getMaterial()!;
    compositor.setMaterialResponse({
      color: 0x808080,
      specular: 0x222222,
      shininess: 7,
      emissive: 0x404040,
      emissiveIntensity: 0.5,
      opacity: 0.75,
      flatShading: true
    });
    expect(material.uniforms.diffuse.value.getHex()).toBe(0x808080);
    expect(material.uniforms.specular.value.getHex()).toBe(0x222222);
    expect(material.uniforms.shininess.value).toBe(7);
    // Phong semantics: emissive radiance = emissive × intensity (linear).
    expect(material.uniforms.emissive.value.getHex())
      .toBe(new THREE.Color(0x404040).multiplyScalar(0.5).getHex());
    expect(material.uniforms.opacity.value).toBe(0.75);
    expect((material as any).flatShading).toBe(true);
    compositor.dispose();
  });

  it('matches the CPU material when a surface switches to GPU compositing', () => {
    const surface = new MultiLayerNeuroSurface(triangle(), {
      baseColor: 0xb0b0b0,
      shininess: 4,
      specularColor: 0x0d0d0d
    });
    surface.viewer = capableViewer();
    surface.setClipPlane('x', 0.25, true);
    const cpu = surface.mesh!.material as THREE.MeshPhongMaterial;
    const cpu_ = { color: cpu.color.getHex(), specular: cpu.specular.getHex(), shininess: cpu.shininess };

    surface.setCompositingMode(true);
    expect(surface.getCompositingMode()).toBe('GPU');
    const gpu = surface.mesh!.material as THREE.ShaderMaterial;
    expect(gpu.isShaderMaterial).toBe(true);
    expect(gpu.uniforms.diffuse.value.getHex()).toBe(cpu_.color);
    expect(gpu.uniforms.specular.value.getHex()).toBe(cpu_.specular);
    expect(gpu.uniforms.shininess.value).toBe(cpu_.shininess);
    // Clip planes set before the switch reach the new material through
    // three.js clipping alone (the CPU path's convention), with no second,
    // hand-written clip test in the shader.
    expect(gpu.clippingPlanes).toHaveLength(1);
    expect(gpu.clippingPlanes![0]!.normal.toArray()).toEqual([1, 0, 0]);
    expect(gpu.clippingPlanes![0]!.constant).toBeCloseTo(-0.25);
    expect(gpu.uniforms.clipPlaneEnabledX).toBeUndefined();
    expect(gpu.fragmentShader).not.toContain('clipPlaneNormal');

    // Later material edits (e.g. style presets) follow on the GPU path.
    surface.updateConfig({ shininess: 2, specularColor: 0x010101, color: 0x999999 });
    expect(gpu.uniforms.shininess.value).toBe(2);
    expect(gpu.uniforms.specular.value.getHex()).toBe(0x010101);
    expect(gpu.uniforms.diffuse.value.getHex()).toBe(0x999999);
    surface.dispose();
  });

  it('keeps volume textures complete on the renderer that draws them', () => {
    const compositor = new GPULayerCompositor(3, 2);
    const layer = new VolumeProjectionLayer('vol', new Float32Array(8), [2, 2, 2], { sampling: 'linear' });
    const surface = { geometry: { vertices: new Float32Array(9) } };
    layer.attach(surface);
    compositor.updateLayers([layer]);
    const prepare = vi.spyOn(layer.getVolumeTexture(), 'prepareForRenderer');
    const renderer = { getContext: () => ({ getExtension: () => null }) } as any;
    compositor.getMaterial()!.onBeforeRender(renderer, null as any, null as any, null as any, null as any, null as any);
    expect(prepare).toHaveBeenCalledWith(renderer);
    expect(layer.getVolumeTexture().texture.magFilter).toBe(THREE.NearestFilter);
    compositor.dispose();
    // A disposed compositor no longer references the layers or their volumes.
    expect((compositor as any).volumeSlots.every((slot: unknown) => slot === null)).toBe(true);
    expect((compositor as any).layerSlots.every((slot: unknown) => slot === null)).toBe(true);
    layer.dispose();
  });
});

describe('GPU compositing fragment shading', () => {
  it('draws the top thresholded data layer with fragment threshold edges', () => {
    const surface = new MultiLayerNeuroSurface(triangle(), {});
    surface.viewer = capableViewer();
    surface.addLayer(new RGBALayer('under', new Float32Array([0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1])));
    const top = new DataLayer('top', new Float32Array([-3, 0, 3]), null, 'hot', {
      range: [-3, 3],
      threshold: [-1, 1]
    });
    surface.addLayer(top);
    surface.setCompositingMode(true);
    surface.updateColors();

    const gpu = surface.mesh!.material as THREE.ShaderMaterial;
    expect(gpu.userData.surfviewShading).toBe(true);
    const compositor = (surface as any).gpuCompositor as GPULayerCompositor;
    // The edge layer is drawn per fragment, not composited per vertex:
    // base + under go to the GPU stack, top does not.
    expect(surface.getOrderedLayers().map(layer => layer.id)).toEqual(['base', 'under', 'top']);
    expect(gpu.uniforms.layerCount.value).toBe(2);
    expect(compositor.getLastUpdateStats().renderedLayers).toBe(2);
    const shader = compiled(gpu);
    expect(shader.fragmentShader).toContain('surfviewEdgeEnabled');
    expect(shader.vertexShader).toContain('vSurfviewOverlay = surfviewOverlay');
    expect((shader.uniforms as any).surfviewEdgeEnabled.value).toBe(1);

    surface.setShading({ silhouetteDarkening: 0.4, thresholdEdges: false });
    surface.updateColors();
    expect((shader.uniforms as any).surfviewSilhouette.value).toBe(0.4);
    expect((shader.uniforms as any).surfviewEdgeEnabled.value).toBe(0);
    expect(gpu.uniforms.layerCount.value).toBe(3);
    surface.dispose();
  });
});
