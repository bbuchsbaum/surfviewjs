import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createSurfaceShadingUniforms,
  installSurfaceShading,
  SURFACE_EDGE_ATTRIBUTE,
  SURFACE_OVERLAY_ATTRIBUTE,
  updateSurfaceShadingUniforms
} from '../../src/surface/SurfaceShading';
import type { SurfaceShadingUniforms } from '../../src/surface/SurfaceShading';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import type { MultiLayerSurfaceConfig } from '../../src/MultiLayerNeuroSurface';
import { SurfaceGeometry } from '../../src/classes';
import { DataLayer, RGBALayer } from '../../src/layers';
import { getStylePreset } from '../../src/StylePresets';
import { ColorMap } from '../../src/ColorMap';

interface FakeShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function fakeShader(): FakeShader {
  return {
    uniforms: {},
    vertexShader: '#include <common>\n#include <color_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <emissivemap_fragment>\n#include <opaque_fragment>'
  };
}

function compile(material: THREE.Material): FakeShader {
  const shader = fakeShader();
  material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
  return shader;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('surface shading uniforms', () => {
  it('creates documented defaults and applies initial options', () => {
    expect(createSurfaceShadingUniforms()).toEqual({
      surfviewEdgeEnabled: { value: 0 },
      surfviewOutlineWidth: { value: 0 },
      surfviewOutlineShade: { value: 0.55 },
      surfviewSilhouette: { value: 0 },
      surfviewEmission: { value: 0 }
    });
    const uniforms = createSurfaceShadingUniforms({
      thresholdOutline: 2,
      thresholdOutlineShade: 0.3,
      silhouetteDarkening: 0.2,
      overlayEmission: 0.4,
      thresholdEdges: false
    });
    expect(uniforms.surfviewOutlineWidth.value).toBe(2);
    expect(uniforms.surfviewOutlineShade.value).toBe(0.3);
    expect(uniforms.surfviewSilhouette.value).toBe(0.2);
    expect(uniforms.surfviewEmission.value).toBe(0.4);
    // Edge enablement is owned by the surface, never by options.
    expect(uniforms.surfviewEdgeEnabled.value).toBe(0);
  });

  it('updates only the provided fields and accepts inclusive bounds', () => {
    const uniforms = createSurfaceShadingUniforms({ silhouetteDarkening: 0.5 });
    updateSurfaceShadingUniforms(uniforms, { thresholdOutline: 20, overlayEmission: 1 });
    expect(uniforms.surfviewSilhouette.value).toBe(0.5);
    expect(uniforms.surfviewOutlineWidth.value).toBe(20);
    expect(uniforms.surfviewEmission.value).toBe(1);
    updateSurfaceShadingUniforms(uniforms, { thresholdOutlineShade: 0, silhouetteDarkening: 0 });
    expect(uniforms.surfviewOutlineShade.value).toBe(0);
    expect(uniforms.surfviewSilhouette.value).toBe(0);
  });

  it.each([
    ['thresholdOutline', -1],
    ['thresholdOutline', 20.5],
    ['thresholdOutline', Number.NaN],
    ['thresholdOutlineShade', 1.01],
    ['thresholdOutlineShade', -0.1],
    ['overlayEmission', 2],
    ['overlayEmission', Number.POSITIVE_INFINITY],
    ['silhouetteDarkening', 1.5],
    ['silhouetteDarkening', Number.NaN]
  ] as const)('rejects %s = %s with a RangeError', (field, value) => {
    const uniforms = createSurfaceShadingUniforms();
    const before = structuredClone(uniforms);
    expect(() => updateSurfaceShadingUniforms(uniforms, { [field]: value })).toThrow(RangeError);
    expect(uniforms).toEqual(before);
    expect(() => createSurfaceShadingUniforms({ [field]: value })).toThrow(RangeError);
  });
});

describe('installSurfaceShading', () => {
  it('rewrites the vertex and fragment shaders and shares live uniforms', () => {
    const material = new THREE.MeshPhongMaterial();
    const uniforms = createSurfaceShadingUniforms();
    const versionBefore = material.version;
    installSurfaceShading(material, uniforms);
    expect(material.version).toBeGreaterThan(versionBefore);

    const shader = compile(material);
    expect(shader.vertexShader).toContain(`attribute vec4 ${SURFACE_OVERLAY_ATTRIBUTE};`);
    expect(shader.vertexShader).toContain(`attribute float ${SURFACE_EDGE_ATTRIBUTE};`);
    expect(shader.vertexShader).toContain(`vSurfviewOverlay = ${SURFACE_OVERLAY_ATTRIBUTE};`);
    expect(shader.vertexShader).toContain(`vSurfviewEdge = ${SURFACE_EDGE_ATTRIBUTE};`);
    for (const name of Object.keys(uniforms)) {
      expect(shader.fragmentShader).toContain(`uniform float ${name};`);
    }
    expect(shader.fragmentShader).not.toContain('#include <color_fragment>');
    expect(shader.fragmentShader).toContain('diffuseColor *= surfviewBase;');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += surfviewGlow;');
    expect(shader.fragmentShader).toContain('#include <emissivemap_fragment>');
    expect(shader.fragmentShader).toContain('#include <opaque_fragment>');
    // Silhouette darkening runs before the opaque output.
    expect(shader.fragmentShader.indexOf('surfviewSilhouette > 0.0'))
      .toBeLessThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'));

    // Uniform objects are shared, so later updates reach the compiled program.
    expect(shader.uniforms.surfviewEmission).toBe(uniforms.surfviewEmission);
    updateSurfaceShadingUniforms(uniforms, { overlayEmission: 0.7 });
    expect(shader.uniforms.surfviewEmission!.value).toBe(0.7);
    expect(material.customProgramCacheKey()).toContain('surfview-shading');
  });

  it('is idempotent', () => {
    const material = new THREE.MeshPhongMaterial();
    installSurfaceShading(material, createSurfaceShadingUniforms());
    const hook = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    installSurfaceShading(material, createSurfaceShadingUniforms());
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey()).toBe(key);
    const shader = compile(material);
    expect(shader.vertexShader.match(/attribute float surfviewEdge;/g)).toHaveLength(1);
  });

  it('chains a pre-existing onBeforeCompile hook and cache key', () => {
    const material = new THREE.MeshPhongMaterial();
    const calls: string[] = [];
    material.onBeforeCompile = shader => {
      calls.push('previous');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n// previous-patch');
    };
    material.customProgramCacheKey = () => 'previous-key';
    const uniforms: SurfaceShadingUniforms = createSurfaceShadingUniforms();
    installSurfaceShading(material, uniforms);
    const shader = compile(material);
    expect(calls).toEqual(['previous']);
    expect(shader.fragmentShader).toContain('// previous-patch');
    expect(shader.fragmentShader).toContain('uniform float surfviewEdgeEnabled;');
    expect(material.customProgramCacheKey()).toBe('previous-key|surfview-shading-v2');
  });
});

function geometry(vertexCount = 4): SurfaceGeometry {
  const vertices = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    vertices[i * 3] = i % 2;
    vertices[i * 3 + 1] = Math.floor(i / 2);
    vertices[i * 3 + 2] = 0;
  }
  return new SurfaceGeometry(vertices, new Uint32Array([0, 1, 2, 1, 3, 2]), 'lh');
}

function makeSurface(config: MultiLayerSurfaceConfig = {}): MultiLayerNeuroSurface {
  return new MultiLayerNeuroSurface(geometry(), { baseColor: 0x808080, ...config });
}

function material(surface: MultiLayerNeuroSurface): THREE.MeshPhongMaterial {
  return surface.mesh!.material as THREE.MeshPhongMaterial;
}

function colorAttribute(surface: MultiLayerNeuroSurface): Float32Array {
  return (surface.mesh!.geometry as THREE.BufferGeometry).getAttribute('color').array as Float32Array;
}

function attribute(surface: MultiLayerNeuroSurface, name: string): Float32Array {
  return (surface.mesh!.geometry as THREE.BufferGeometry).getAttribute(name).array as Float32Array;
}

function edgeEnabled(surface: MultiLayerNeuroSurface): number {
  return compile(material(surface)).uniforms.surfviewEdgeEnabled!.value as number;
}

const GRAY = 0x80 / 255;

function thresholded(id = 'map', config: Record<string, unknown> = {}): DataLayer {
  return new DataLayer(id, [4, 0.5, -3, 0], null, 'viridis', {
    range: [-5, 5],
    threshold: [-1, 1],
    ...config
  });
}

describe('MultiLayerNeuroSurface constructor-created layers', () => {
  it('recomposites the scheduled update after curvature brightness changes', () => {
    const surface = makeSurface({ curvature: new Float32Array([0, 0, 0, 0]) });
    try {
      const curvature = surface.getCurvatureLayer()!;
      expect(curvature).toBeDefined();
      surface.updateColors();
      const before = Array.from(colorAttribute(surface));
      const updates: unknown[] = [];
      surface.on('layer:updated', event => updates.push(event.layer.id));

      curvature.setBrightness(0.2);
      expect(updates).toEqual(['curvature']);
      // The scheduled update (flushed as the viewer would before paint) runs.
      expect(surface.flushPendingColorUpdate()).toBe(true);
      const after = Array.from(colorAttribute(surface));
      expect(after).not.toEqual(before);
      expect(after[0]).toBeLessThan(before[0]!);
    } finally {
      surface.dispose();
    }
  });

  it('recomposites the scheduled update after the base colour changes', () => {
    const surface = makeSurface();
    try {
      const base = surface.getLayer('base') as unknown as { setColor(color: number): void };
      base.setColor(0xff0000);
      expect(surface.flushPendingColorUpdate()).toBe(true);
      expect(Array.from(colorAttribute(surface).subarray(0, 4))).toEqual([1, 0, 0, 1]);
    } finally {
      surface.dispose();
    }
  });
});

describe('MultiLayerNeuroSurface material transparency', () => {
  it('renders an opaque composite opaque with depth writes', () => {
    const surface = makeSurface();
    try {
      surface.updateColors();
      expect(material(surface).transparent).toBe(false);
      expect(material(surface).depthWrite).toBe(true);
      expect(material(surface).vertexColors).toBe(true);
      // Stable opacity does not force a program rebuild on every update.
      const version = material(surface).version;
      surface.updateColors();
      expect(material(surface).version).toBe(version);
    } finally {
      surface.dispose();
    }
  });

  it('keeps a translucent surface configuration on the transparent path', () => {
    const surface = makeSurface({ alpha: 0.5 });
    try {
      surface.updateColors();
      expect(material(surface).transparent).toBe(true);
      expect(material(surface).depthWrite).toBe(false);
    } finally {
      surface.dispose();
    }
  });

  it('switches to the transparent path when the composite becomes partially transparent', () => {
    const surface = makeSurface();
    try {
      surface.updateColors();
      const version = material(surface).version;
      surface.getLayer('base')!.setVisible(false);
      surface.addLayer(new RGBALayer('partial', new Float32Array([
        1, 0, 0, 1,
        1, 0, 0, 1,
        1, 0, 0, 0.5,
        1, 0, 0, 1
      ])));
      surface.updateColors();
      expect(material(surface).transparent).toBe(true);
      expect(material(surface).depthWrite).toBe(false);
      expect(material(surface).version).toBeGreaterThan(version);
    } finally {
      surface.dispose();
    }
  });
});

describe('MultiLayerNeuroSurface fragment threshold edges', () => {
  it('moves the top thresholded data layer into edge attributes', () => {
    const surface = makeSurface();
    try {
      const layer = thresholded('map', { opacity: 0.5 });
      surface.addLayer(layer);
      surface.updateColors();

      expect(edgeEnabled(surface)).toBe(1);
      // Base vertex colours exclude the edge layer.
      const colors = colorAttribute(surface);
      for (let vertex = 0; vertex < 4; vertex++) {
        expect(colors[vertex * 4]).toBeCloseTo(GRAY, 6);
        expect(colors[vertex * 4 + 3]).toBe(1);
      }
      // Edge attributes match the layer's own output, with opacity in alpha.
      const expectedColors = new Float32Array(16);
      const expectedEdges = new Float32Array(4);
      layer.writeThresholdEdgeAttributes(4, expectedColors, expectedEdges);
      expect(Array.from(attribute(surface, SURFACE_EDGE_ATTRIBUTE))).toEqual(Array.from(expectedEdges));
      const overlay = attribute(surface, SURFACE_OVERLAY_ATTRIBUTE);
      for (let offset = 0; offset < 16; offset++) {
        const expected = offset % 4 === 3 ? expectedColors[offset]! * 0.5 : expectedColors[offset]!;
        expect(overlay[offset]).toBeCloseTo(expected, 6);
      }
      expect(layer.needsUpdate).toBe(false);
    } finally {
      surface.dispose();
    }
  });

  it('keeps the per-vertex path without an active threshold', () => {
    const surface = makeSurface();
    try {
      surface.addLayer(thresholded('map', { threshold: [0, 0] }));
      surface.updateColors();
      expect(edgeEnabled(surface)).toBe(0);
      expect(colorAttribute(surface)[0]).not.toBeCloseTo(GRAY, 3);
    } finally {
      surface.dispose();
    }
  });

  it('keeps the per-vertex path for DataLayer subclasses', () => {
    class ParcelLikeLayer extends DataLayer {}
    const surface = makeSurface();
    try {
      surface.addLayer(new ParcelLikeLayer('parcel', [4, 0.5, -3, 0], null, 'viridis', {
        range: [-5, 5],
        threshold: [-1, 1]
      }));
      surface.updateColors();
      expect(edgeEnabled(surface)).toBe(0);
      const colors = colorAttribute(surface);
      // Vertex 0 (suprathreshold) carries the layer colour; vertex 1 (masked) the base.
      expect(colors[0]).not.toBeCloseTo(GRAY, 3);
      expect(colors[4]).toBeCloseTo(GRAY, 6);
    } finally {
      surface.dispose();
    }
  });

  it('keeps the per-vertex path for non-normal blend modes', () => {
    const surface = makeSurface();
    try {
      surface.addLayer(thresholded('map', { blendMode: 'multiply' }));
      surface.updateColors();
      expect(edgeEnabled(surface)).toBe(0);
      expect(colorAttribute(surface)[0]).not.toBeCloseTo(GRAY, 3);
    } finally {
      surface.dispose();
    }
  });

  it('uses edges only when the thresholded layer is the top visible layer', () => {
    const surface = makeSurface();
    try {
      surface.addLayer(thresholded('map'));
      surface.addLayer(new RGBALayer('top', new Float32Array(16)));
      surface.updateColors();
      expect(edgeEnabled(surface)).toBe(0);
    } finally {
      surface.dispose();
    }
  });

  it('falls back to per-vertex colours when thresholdEdges is disabled, and back again', () => {
    const surface = makeSurface();
    try {
      surface.addLayer(thresholded('map'));
      surface.updateColors();
      expect(edgeEnabled(surface)).toBe(1);

      surface.setShading({ thresholdEdges: false });
      expect(surface.flushPendingColorUpdate()).toBe(true);
      expect(edgeEnabled(surface)).toBe(0);
      const colors = colorAttribute(surface);
      expect(colors[0]).not.toBeCloseTo(GRAY, 3); // suprathreshold vertex baked in
      expect(colors[4]).toBeCloseTo(GRAY, 6);     // masked vertex shows the base

      surface.setShading({ thresholdEdges: true });
      expect(surface.flushPendingColorUpdate()).toBe(true);
      expect(edgeEnabled(surface)).toBe(1);
      expect(colorAttribute(surface)[0]).toBeCloseTo(GRAY, 6);
    } finally {
      surface.dispose();
    }
  });

  it('honours thresholdEdges:false from the constructor config', () => {
    const surface = makeSurface({ shading: { thresholdEdges: false } });
    try {
      surface.addLayer(thresholded('map'));
      surface.updateColors();
      expect(edgeEnabled(surface)).toBe(0);
    } finally {
      surface.dispose();
    }
  });

  it('validates shading updates through the surface', () => {
    const surface = makeSurface();
    try {
      expect(() => surface.setShading({ overlayEmission: 3 })).toThrow(RangeError);
      surface.setShading({ overlayEmission: 0.25 });
      expect(compile(material(surface)).uniforms.surfviewEmission!.value).toBe(0.25);
    } finally {
      surface.dispose();
    }
  });
});

describe('report style preset', () => {
  it('defines fragment-shading lighting, surface-heat colormaps and an opaque background', () => {
    const report = getStylePreset('report');
    expect(report.name).toBe('report');
    expect(report.background.clearAlpha).toBe(1);
    expect(report.lighting).toMatchObject({
      fillIntensity: expect.any(Number),
      silhouetteDarkening: expect.any(Number),
      thresholdOutline: expect.any(Number),
      thresholdOutlineShade: expect.any(Number),
      overlayEmission: expect.any(Number)
    });
    // The shading fields are valid uniform values.
    expect(() => createSurfaceShadingUniforms({
      silhouetteDarkening: report.lighting.silhouetteDarkening!,
      thresholdOutline: report.lighting.thresholdOutline!,
      thresholdOutlineShade: report.lighting.thresholdOutlineShade!,
      overlayEmission: report.lighting.overlayEmission!
    })).not.toThrow();
    expect(report.colormaps.sequential).toBe('surface-heat-positive');
    expect(report.colormaps.diverging).toBe('surface-heat');
    const maps = ColorMap.getPresetMaps();
    expect(maps[report.colormaps.sequential]).toBeDefined();
    expect(maps[report.colormaps.diverging]).toBeDefined();
  });
});
