import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import ColorMap from '../../src/ColorMap';
import ColorMap2D from '../../src/ColorMap2D';
import { DataLayer } from '../../src/layers';
import { CurvatureLayer } from '../../src/layers/CurvatureLayer';
import { OutlineLayer } from '../../src/OutlineLayer';
import {
  ColorMappedNeuroSurface,
  SurfaceGeometry,
  VertexColoredNeuroSurface
} from '../../src/classes';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import type { ResolvedNeuroSurfaceViewerConfig } from '../../src/NeuroSurfaceViewer';
import { MorphableSurface } from '../../src/MorphableSurface';
import {
  MAX_DEVICE_PIXEL_RATIO,
  NumericValidationError
} from '../../src/utils/validation';
import { encode } from '../../src/serialization/ViewerState';
import type { ViewerStateV2 } from '../../src/serialization/ViewerState';
import { ClipPlane } from '../../src/utils/ClipPlane';

function minimalState(): ViewerStateV2 {
  return {
    version: 2,
    camera: {
      position: [0, 0, 10],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1,
      fov: 45
    },
    config: {},
    surfaces: {},
    surfaceGroups: [],
    crosshair: {
      visible: false,
      surfaceId: null,
      vertexIndex: null,
      size: 1,
      color: 0xffffff,
      mode: null
    },
    timeline: null,
    inspectionSelection: { kind: 'none' }
  };
}

describe('transactional numeric validation', () => {
  it('rejects misaligned surface data, index, and vertex-color mappings', () => {
    const geometry = new SurfaceGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      'left',
      null,
      false
    );
    expect(() => new ColorMappedNeuroSurface(
      geometry,
      null,
      new Float32Array([1, 2]),
      'viridis'
    )).toThrow(/Data length must equal vertex count 3/);
    expect(() => new ColorMappedNeuroSurface(
      geometry,
      new Uint32Array([0, 1]),
      new Float32Array([1]),
      'viridis'
    )).toThrow(/indices length 2 must match data length 1/);

    const colored = new VertexColoredNeuroSurface(
      geometry,
      null,
      [0xff0000, 0x00ff00, 0x0000ff]
    );
    expect(() => colored.setColors([0xffffff])).toThrow(/colors length 1/);
    colored.dispose();
    geometry.dispose();
  });

  it('preserves transparent zero but rejects invalid opacity before data, events, or revision change', () => {
    const layer = new DataLayer(
      'values',
      new Float32Array([1, 2]),
      null,
      'viridis',
      { opacity: 0 }
    );
    const initialData = layer.getData();
    const initialRevision = layer.getDataRevision();
    const onChange = vi.fn();
    layer._onChangeCallback = onChange;
    layer.needsUpdate = false;

    expect(layer.opacity).toBe(0);
    expect(() => layer.update({
      data: new Float32Array([9, 9]),
      opacity: Number.NaN
    })).toThrowError(NumericValidationError);
    expect(layer.getData()).toBe(initialData);
    expect(layer.getDataRevision()).toBe(initialRevision);
    expect(layer.opacity).toBe(0);
    expect(layer.needsUpdate).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('treats JavaScript explicit undefined constructor options as omitted', () => {
    const layerOptions = {};
    Reflect.set(layerOptions, 'opacity', undefined);
    Reflect.set(layerOptions, 'range', undefined);
    const layer = new DataLayer(
      'js-options',
      new Float32Array([1]),
      null,
      'viridis',
      layerOptions
    );
    expect(layer.opacity).toBe(1);
    expect(layer.getRange()).toEqual([0, 1]);

    const geometry = new SurfaceGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      'left'
    );
    const surfaceOptions = {};
    Reflect.set(surfaceOptions, 'alpha', undefined);
    Reflect.set(surfaceOptions, 'smoothingAngle', undefined);
    const surface = new VertexColoredNeuroSurface(
      geometry,
      null,
      [0xff0000, 0x00ff00, 0x0000ff],
      surfaceOptions
    );
    expect(surface.config.alpha).toBe(1);
    expect(surface.config).not.toHaveProperty('smoothingAngle');
    surface.dispose();
    geometry.dispose();
  });

  it('defensively copies finite ascending ranges and leaves state unchanged on rejection', () => {
    const layer = new DataLayer('values', new Float32Array([1]), null, 'viridis');
    const range: [number, number] = [-2, 2];
    layer.setRange(range);
    range[0] = -99;
    expect(layer.getRange()).toEqual([-2, 2]);

    const onChange = vi.fn();
    layer._onChangeCallback = onChange;
    layer.needsUpdate = false;
    expect(() => layer.setRange([2, 1])).toThrowError(NumericValidationError);
    expect(() => layer.setThreshold([0, Number.POSITIVE_INFINITY]))
      .toThrowError(NumericValidationError);
    expect(layer.getRange()).toEqual([-2, 2]);
    expect(layer.getThreshold()).toEqual([0, 0]);
    expect(layer.needsUpdate).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps colormap state and events unchanged after an invalid mutation', () => {
    const map = new ColorMap([[0, 0, 0], [1, 1, 1]], { range: [0, 1] });
    const event = vi.fn();
    map.on('rangeChanged', event);

    expect(() => map.setRange([0, Number.NaN])).toThrowError(NumericValidationError);
    expect(map.getRange()).toEqual([0, 1]);
    expect(event).not.toHaveBeenCalled();
    expect(() => map.setAlpha(Number.NaN)).toThrowError(NumericValidationError);
    expect(map.getAlpha()).toBe(1);
  });

  it('validates 2D colormap dimensions, alpha, and pairs in constructors and setters', () => {
    expect(() => new ColorMap2D(new Float32Array(4), 2)).toThrow(RangeError);
    const map = new ColorMap2D(new Float32Array(16), 2, { alpha: 0 });
    expect(map.getAlpha()).toBe(0);
    expect(() => map.setThresholdX([1, -1])).toThrowError(NumericValidationError);
    expect(map.getThresholdX()).toEqual([0, 0]);
  });

  it('rejects invalid resize inputs before renderer mutation and caps valid DPR', () => {
    const viewer = {
      width: 640,
      height: 480,
      renderer: { setPixelRatio: vi.fn(), setSize: vi.fn() },
      camera: { aspect: 4 / 3, updateProjectionMatrix: vi.fn() },
      composer: { setSize: vi.fn() },
      ssaoPass: null,
      surfaces: new Map(),
      emit: vi.fn(),
      requestRender: vi.fn()
    };

    expect(() => NeuroSurfaceViewer.prototype.resize.call(viewer, Number.NaN, 100))
      .toThrowError(NumericValidationError);
    expect(() => NeuroSurfaceViewer.prototype.resize.call(viewer, 100, 100, { dpr: 0 }))
      .toThrowError(NumericValidationError);
    expect(viewer.renderer.setPixelRatio).not.toHaveBeenCalled();
    expect(viewer.width).toBe(640);
    expect(viewer.height).toBe(480);

    const result = NeuroSurfaceViewer.prototype.resize.call(viewer, 320.5, 200.25, { dpr: 12 });
    expect(result).toEqual({ width: 320.5, height: 200.25, dpr: MAX_DEVICE_PIXEL_RATIO });
    expect(viewer.renderer.setPixelRatio).toHaveBeenLastCalledWith(MAX_DEVICE_PIXEL_RATIO);
  });

  it('rejects invalid zoom before camera or initial state changes', () => {
    const viewer = {
      cameraControls: { target: new THREE.Vector3(), update: vi.fn() },
      camera: {
        position: new THREE.Vector3(0, 0, 10),
        updateProjectionMatrix: vi.fn()
      },
      sceneBoundsRadius: 1,
      config: { initialZoom: 10 },
      invalidateState: vi.fn(),
      requestRender: vi.fn()
    };
    expect(() => NeuroSurfaceViewer.prototype.setZoom.call(viewer, Number.NaN))
      .toThrowError(NumericValidationError);
    expect(viewer.camera.position.z).toBe(10);
    expect(viewer.config.initialZoom).toBe(10);
    expect(viewer.cameraControls.update).not.toHaveBeenCalled();
  });

  it('validates a fully resolved viewer config before update mutation', () => {
    const config: ResolvedNeuroSurfaceViewerConfig = {
      ambientLightColor: 0xb5b5b5,
      directionalLightColor: 0xffffff,
      directionalLightIntensity: 1.6,
      rotationSpeed: 2,
      initialZoom: 12,
      ssaoRadius: 4,
      ssaoKernelSize: 32,
      rimStrength: 0,
      metalness: 0.1,
      roughness: 0.6,
      useShaders: false,
      showControls: false,
      useControls: false,
      controlType: 'trackball',
      backgroundColor: 0,
      preset: 'default',
      linkHemispheres: false,
      hoverCrosshair: false,
      hoverCrosshairColor: 0x66ccff,
      hoverCrosshairSize: 1.2,
      clickToAddAnnotation: false,
      allowCDNFallback: false,
      useGPUPicking: false
    };
    const viewer = { config };

    expect(() => NeuroSurfaceViewer.prototype.updateConfig.call(
      viewer as NeuroSurfaceViewer,
      { roughness: Number.NaN, backgroundColor: 0x123456 }
    )).toThrowError(NumericValidationError);
    expect(viewer.config).toBe(config);
    expect(viewer.config.backgroundColor).toBe(0);
  });

  it('normalizes surface defaults and rejects invalid material updates transactionally', () => {
    const geometry = new SurfaceGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      'left',
      null,
      false
    );
    const surface = new VertexColoredNeuroSurface(
      geometry,
      null,
      [0xff0000, 0x00ff00, 0x0000ff]
    );
    const config = surface.config;
    const opacityBefore = (surface.mesh!.material as THREE.Material & { opacity: number }).opacity;
    const event = vi.fn();
    surface.on('material:updated', event);

    expect(config).toMatchObject({
      materialType: 'phong',
      metalness: 0,
      roughness: 0.5,
      alpha: 1,
      thresh: [0, 0],
      irange: [0, 0]
    });
    expect(() => surface.updateConfig({ alpha: Number.NaN, roughness: 0.2 }))
      .toThrowError(NumericValidationError);
    expect(surface.config).toBe(config);
    expect((surface.mesh!.material as THREE.Material & { opacity: number }).opacity)
      .toBe(opacityBefore);
    expect(event).not.toHaveBeenCalled();
    surface.dispose();
    geometry.dispose();
  });

  it('prevalidates compound curvature and outline updates before any mutation', () => {
    const curvature = new CurvatureLayer('curvature', new Float32Array([0, 1]));
    const curvatureData = curvature.getCurvature();
    const curvatureChange = vi.fn();
    curvature._onChangeCallback = curvatureChange;
    curvature.needsUpdate = false;

    expect(() => curvature.update({
      curvature: new Float32Array([9, 9]),
      brightness: 0.25,
      smoothness: 0
    })).toThrowError(NumericValidationError);
    expect(curvature.getCurvature()).toBe(curvatureData);
    expect(curvature.getDisplayParams()).toEqual({
      brightness: 0.5,
      contrast: 0.5,
      smoothness: 1
    });
    expect(curvature.needsUpdate).toBe(false);
    expect(curvatureChange).not.toHaveBeenCalled();

    const outline = new OutlineLayer('outline', {
      roiLabels: new Uint32Array([1, 2]),
      width: 2
    });
    const labels = outline.roiLabels;
    const outlineChange = vi.fn();
    outline._onChangeCallback = outlineChange;
    outline.needsUpdate = false;

    expect(() => outline.update({
      roiLabels: new Uint32Array([9, 9]),
      halo: true,
      width: 0
    })).toThrowError(NumericValidationError);
    expect(outline.roiLabels).toBe(labels);
    expect(outline.width).toBe(2);
    expect(outline.halo).toBe(false);
    expect(outline.needsUpdate).toBe(false);
    expect(outlineChange).not.toHaveBeenCalled();
  });

  it('rejects invalid clip planes without changing normal, point, or flip state', () => {
    const plane = new ClipPlane();
    const normal = plane.normal.clone();
    const point = plane.point.clone();

    expect(() => plane.setFromAxisDistance('invalid' as 'x', 2, true))
      .toThrow(TypeError);
    expect(plane.normal).toEqual(normal);
    expect(plane.point).toEqual(point);

    expect(() => plane.setFromPoints(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(2, 2, 2)
    )).toThrow(RangeError);
    expect(plane.normal).toEqual(normal);
    expect(plane.point).toEqual(point);
  });

  it('does not emit colormap events for unrelated valid surface updates', () => {
    const geometry = new SurfaceGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      'left',
      null,
      false
    );
    const surface = new ColorMappedNeuroSurface(
      geometry,
      null,
      new Float32Array([0, 0.5, 1]),
      'viridis',
      { irange: [0, 1] }
    );
    const rangeChanged = vi.fn();
    const thresholdChanged = vi.fn();
    const alphaChanged = vi.fn();
    surface.colorMap!.on('rangeChanged', rangeChanged);
    surface.colorMap!.on('thresholdChanged', thresholdChanged);
    surface.colorMap!.on('alphaChanged', alphaChanged);

    surface.updateConfig({ roughness: 0.25 });

    expect(rangeChanged).not.toHaveBeenCalled();
    expect(thresholdChanged).not.toHaveBeenCalled();
    expect(alphaChanged).not.toHaveBeenCalled();
    surface.dispose();
    geometry.dispose();
  });

  it('prevalidates morph weights and replacement geometry before live mutation', () => {
    const geometry = new SurfaceGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      'left'
    );
    const surface = new MorphableSurface(geometry);
    surface.addMorphTarget(
      'inflated',
      new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1])
    );
    surface.setMorphWeight('inflated', 0.25);
    const changed = vi.fn();
    surface.on('morph:changed', changed);

    expect(() => surface.setMorphWeights({ inflated: 0.75, invalid: Number.NaN }))
      .toThrowError(NumericValidationError);
    expect(surface.getMorphWeight('inflated')).toBe(0.25);
    expect(changed).not.toHaveBeenCalled();

    expect(() => surface.addMorphTarget(
      'inflated',
      new Float32Array([0, 0, Number.NaN, 1, 0, 1, 0, 1, 1])
    )).toThrowError(NumericValidationError);
    expect(surface.hasMorphTarget('inflated')).toBe(true);
    expect(surface.getMorphWeight('inflated')).toBe(0.25);
    expect(changed).not.toHaveBeenCalled();
    surface.dispose();
    geometry.dispose();
  });

  it('prevalidates legacy camera and hemisphere offsets before mutation', () => {
    const camera = {
      position: new THREE.Vector3(1, 2, 3),
      rotation: new THREE.Euler(0.1, 0.2, 0.3)
    };
    const cameraControls = {
      target: new THREE.Vector3(4, 5, 6),
      update: vi.fn()
    };
    const cameraViewer = {
      currentAnatomicalView: { view: 'lateral' },
      camera,
      cameraControls,
      invalidateState: vi.fn(),
      requestRender: vi.fn()
    };
    const beforePosition = camera.position.clone();
    const beforeRotation = camera.rotation.clone();
    const beforeTarget = cameraControls.target.clone();

    expect(() => NeuroSurfaceViewer.prototype.setCameraState.call(cameraViewer, {
      position: [9, Number.NaN, 9],
      target: [8, 8, 8]
    })).toThrowError(NumericValidationError);
    expect(camera.position).toEqual(beforePosition);
    expect(camera.rotation).toEqual(beforeRotation);
    expect(cameraControls.target).toEqual(beforeTarget);
    expect(cameraControls.update).not.toHaveBeenCalled();
    expect(cameraViewer.invalidateState).not.toHaveBeenCalled();

    const leftPosition = new THREE.Vector3();
    const hemisphereViewer = {
      surfaces: new Map([['left', {
        hemisphere: 'left',
        mesh: { position: leftPosition }
      }]]),
      invalidateState: vi.fn(),
      requestRender: vi.fn()
    };
    expect(() => NeuroSurfaceViewer.prototype.separateHemispheres.call(
      hemisphereViewer,
      Number.POSITIVE_INFINITY
    )).toThrowError(NumericValidationError);
    expect(leftPosition.x).toBe(0);
    expect(hemisphereViewer.invalidateState).not.toHaveBeenCalled();
  });

  it('refuses non-finite and out-of-domain state before encoding', () => {
    const nonFinite = minimalState();
    nonFinite.camera.position[0] = Number.NaN;
    expect(() => encode(nonFinite)).toThrowError(NumericValidationError);

    const invalidOpacity = minimalState();
    invalidOpacity.surfaces.lh = {
      id: 'lh',
      type: 'surface',
      visible: true,
      layers: [{
        id: 'data',
        type: 'data',
        visible: true,
        opacity: 2,
        blendMode: 'normal'
      }],
      layerOrder: ['data'],
      clipPlanes: []
    };
    expect(() => encode(invalidOpacity)).toThrowError(NumericValidationError);
  });
});
