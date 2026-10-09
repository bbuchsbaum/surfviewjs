import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventEmitter } from '../../src/EventEmitter';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import type { ViewerEventMap } from '../../src/events';
import type { NeuroSurface } from '../../src/classes';

function makeViewer(): NeuroSurfaceViewer {
  const viewer = new EventEmitter<ViewerEventMap>() as NeuroSurfaceViewer;
  Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
  const mutable = viewer as any;
  let clearColor = 0x000000;
  let clearAlpha = 1;
  mutable.disposed = false;
  mutable.initializationFailed = false;
  mutable.surfaces = new Map<string, NeuroSurface>();
  mutable.scene = new THREE.Scene();
  mutable.camera = new THREE.PerspectiveCamera(35, 2, 0.1, 1000);
  mutable.camera.position.set(0, 0, 100);
  mutable.camera.lookAt(0, 0, 0);
  mutable.cameraControls = { target: new THREE.Vector3(), update: vi.fn() };
  mutable.config = {
    preset: 'default', backgroundColor: 0x000000, initialZoom: 100,
    ambientLightColor: 0xb5b5b5, directionalLightColor: 0xffffff,
    directionalLightIntensity: 1.6, metalness: 0.1, roughness: 0.6,
    rimStrength: 0, ssaoRadius: 4, ssaoKernelSize: 32
  };
  mutable.container = { style: {} };
  mutable.renderer = {
    getClearColor: (target: THREE.Color) => target.setHex(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: vi.fn((color: number, alpha = 1) => {
      clearColor = color;
      clearAlpha = alpha;
    })
  };
  mutable.annotations = { setDefaults: vi.fn() };
  mutable.ambientLight = new THREE.AmbientLight();
  mutable.directionalLight = new THREE.DirectionalLight();
  mutable.rimStrengthUniforms = [];
  mutable.invalidateState = vi.fn();
  mutable.requestRender = vi.fn();
  return viewer;
}

function addBox(viewer: NeuroSurfaceViewer, id: string, size: [number, number, number], x = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
  mesh.position.x = x;
  viewer.scene.add(mesh);
  viewer.surfaces.set(id, { mesh } as NeuroSurface);
  return mesh;
}

describe('fitToView', () => {
  it('frames visible transformed surfaces with requested padding and preserves direction', () => {
    const viewer = makeViewer();
    const target = addBox(viewer, 'target', [20, 10, 8], 40);
    addBox(viewer, 'hidden', [100, 100, 100], -200).visible = false;
    const originalDirection = viewer.camera.position.clone().sub(viewer.cameraControls.target).normalize();

    expect(viewer.fitToView()).toBe(true);
    expect(viewer.cameraControls.target.x).toBeCloseTo(40);
    expect(viewer.camera.position.clone().sub(viewer.cameraControls.target).normalize()
      .distanceTo(originalDirection)).toBeLessThan(1e-6);
    viewer.camera.updateMatrixWorld(true);
    for (const vertex of [-10, 10]) {
      const point = new THREE.Vector3(40 + vertex, 5, 4).project(viewer.camera);
      expect(Math.abs(point.x)).toBeLessThanOrEqual(0.84 + 1e-6);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(0.84 + 1e-6);
    }
    const firstDistance = viewer.camera.position.distanceTo(viewer.cameraControls.target);
    expect(viewer.fitToView({ padding: 0.2, surfaceId: 'target' })).toBe(true);
    expect(viewer.camera.position.distanceTo(viewer.cameraControls.target))
      .toBeGreaterThan(firstDistance);
    expect(target.visible).toBe(true);
  });

  it('refits for aspect changes and supports an orthographic camera', () => {
    const viewer = makeViewer();
    addBox(viewer, 'target', [20, 10, 2]);
    viewer.fitToView();
    const wideDistance = viewer.camera.position.distanceTo(viewer.cameraControls.target);
    viewer.camera.aspect = 0.5;
    viewer.camera.updateProjectionMatrix();
    viewer.fitToView();
    expect(viewer.camera.position.distanceTo(viewer.cameraControls.target))
      .toBeGreaterThan(wideDistance);

    const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
    ortho.position.set(0, 0, 100);
    viewer.camera = ortho as unknown as THREE.PerspectiveCamera;
    expect(viewer.fitToView()).toBe(true);
    expect(ortho.zoom).toBeCloseTo(0.84);
  });

  it('can frame one surface without including other visible surfaces', () => {
    const viewer = makeViewer();
    addBox(viewer, 'small', [10, 10, 10], 35);
    addBox(viewer, 'other', [10, 10, 10], -80);

    expect(viewer.fitToView({ surfaceId: 'small' })).toBe(true);
    expect(viewer.cameraControls.target.x).toBeCloseTo(35);
    const selectedDistance = viewer.camera.position.distanceTo(viewer.cameraControls.target);
    expect(viewer.fitToView()).toBe(true);
    expect(viewer.cameraControls.target.x).toBeCloseTo(-22.5);
    expect(viewer.camera.position.distanceTo(viewer.cameraControls.target))
      .toBeGreaterThan(selectedDistance);
  });

  it('does not mutate the camera for empty targets or invalid options', () => {
    const viewer = makeViewer();
    const before = viewer.camera.position.clone();
    expect(viewer.fitToView()).toBe(false);
    expect(() => viewer.fitToView({ padding: 0.5 })).toThrow();
    expect(() => viewer.fitToView({ surfaceId: 'missing' })).toThrow(/Unknown surface/);
    expect(viewer.camera.position).toEqual(before);
  });

  it.each(['perspective', 'orthographic'])('keeps an elongated surface inside clipping planes after dolly and orbit (%s)', kind => {
    const viewer = makeViewer();
    if (kind === 'orthographic') {
      const camera = new THREE.OrthographicCamera(-200, 200, 100, -100, 0.1, 1000);
      camera.position.set(0, 0, 150);
      viewer.camera = camera as unknown as THREE.PerspectiveCamera;
    }
    const mesh = addBox(viewer, 'flat', [200, 4, 0.2], 35);
    viewer.fitToView();
    const bounds = new THREE.Box3().setFromObject(mesh);
    const target = viewer.cameraControls.target;
    const fittedDistance = viewer.camera.position.distanceTo(target);
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    const assertDepths = () => {
      viewer.camera.updateMatrixWorld(true);
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            // Only depth clipping is checked; zooming in may intentionally crop x/y.
            const projected = new THREE.Vector3(x, y, z).project(viewer.camera);
            expect(projected.z).toBeGreaterThan(-1);
            expect(projected.z).toBeLessThan(1);
          }
        }
      }
    };
    assertDepths();
    viewer.setZoom((viewer.cameraControls as any).maxDistance);
    assertDepths();
    viewer.setZoom(radius * 1.05);
    assertDepths();
    viewer.camera.position.copy(target).add(new THREE.Vector3(fittedDistance, 0, 0));
    viewer.camera.lookAt(target);
    assertDepths();
    viewer.setZoom((viewer.cameraControls as any).maxDistance);
    assertDepths();
  });
});

describe('style preset background precedence', () => {
  it('keeps an explicit updateConfig background over the presentation preset', () => {
    const viewer = makeViewer();
    viewer.updateConfig({ preset: 'presentation', backgroundColor: 0x101c25 });
    expect(viewer.config.backgroundColor).toBe(0x101c25);
    expect(viewer.getFigureBackground()).toEqual({ color: 0x101c25, transparent: false });
    expect(viewer.container.style.background).toBe('#101c25');
  });

  it('retains the preset background when none is explicitly supplied', () => {
    const viewer = makeViewer();
    viewer.updateConfig({ preset: 'presentation' });
    expect(viewer.getFigureBackground().transparent).toBe(true);
    expect(viewer.container.style.background).toContain('linear-gradient');
  });

  it.each([0, 0.25, 1])('preserves alpha %s when changing only the background color', alpha => {
    const viewer = makeViewer();
    viewer.renderer.setClearColor(0x000000, alpha);
    viewer.updateConfig({ backgroundColor: 0x101c25 });
    expect(viewer.renderer.getClearAlpha()).toBe(alpha);
    expect(viewer.getFigureBackground()).toEqual({ color: 0x101c25, transparent: alpha < 1 });
    expect(viewer.container.style.background).toBe(alpha < 1 ? 'transparent' : '#101c25');
  });

  it('applies explicit lighting, material and SSAO options after preset defaults', () => {
    const viewer = makeViewer();
    const ssao = { kernelRadius: 4, kernelSize: 32, generateSampleKernel: vi.fn() };
    (viewer as any).ssaoPass = ssao;
    viewer.updateConfig({ preset: 'presentation', directionalLightIntensity: 0.7,
      metalness: 0.2, roughness: 0.8, ssaoRadius: 6, ssaoKernelSize: 8 });
    expect(viewer.directionalLight.intensity).toBe(0.7);
    expect(viewer.config.metalness).toBe(0.2);
    expect(viewer.config.roughness).toBe(0.8);
    expect(ssao.kernelRadius).toBe(6);
    expect(ssao.kernelSize).toBe(8);
    expect(ssao.generateSampleKernel).toHaveBeenLastCalledWith(8);
  });
});

describe('fitToView interaction with setZoom', () => {
  it('keeps the surface inside the far plane when setZoom exceeds the dolly range', () => {
    const viewer = makeViewer();
    const mesh = addBox(viewer, 'box', [100, 80, 60]);
    viewer.fitToView();
    const radius = viewer.sceneBoundsRadius;
    viewer.setZoom(radius * 40);
    expect((viewer.cameraControls as any).maxDistance).toBeGreaterThanOrEqual(radius * 40);
    viewer.camera.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mesh);
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const depth = new THREE.Vector3(x, bounds.max.y, z).project(viewer.camera).z;
        expect(depth).toBeGreaterThan(-1);
        expect(depth).toBeLessThan(1);
      }
    }
  });

  it('uses the same minimum distance as setZoom', () => {
    const viewer = makeViewer();
    addBox(viewer, 'box', [100, 80, 60]);
    viewer.fitToView();
    const minDistance = (viewer.cameraControls as any).minDistance;
    viewer.setZoom(viewer.sceneBoundsRadius * 0.1);
    expect(viewer.camera.position.distanceTo(viewer.cameraControls.target)).toBeCloseTo(minDistance);
  });
});

describe('runtime preset switch with explicit options', () => {
  it('stores explicit options in stylePreset as the constructor does', () => {
    const viewer = makeViewer();
    viewer.updateConfig({ preset: 'presentation', metalness: 0.42, ambientLightColor: 0x123456 });
    expect(viewer.config.metalness).toBe(0.42);
    expect(viewer.stylePreset?.material.metalness).toBe(0.42);
    expect(viewer.stylePreset?.lighting.ambientColor).toBe(0x123456);
    expect(viewer.ambientLight.color.getHex()).toBe(0x123456);
    expect(viewer.stylePreset?.name).toBe('presentation');
  });
});

describe('updateMaterials', () => {
  it('delegates to surfaces and never replaces their material type or custom shaders', () => {
    const viewer = makeViewer();
    (viewer as any).environmentMap = null;
    const phong = new THREE.MeshPhongMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
    const managed = { mesh: new THREE.Mesh(new THREE.BufferGeometry(), phong), updateConfig: vi.fn() };
    const shader = new THREE.ShaderMaterial();
    const custom = { mesh: new THREE.Mesh(new THREE.BufferGeometry(), shader) };
    const standard = new THREE.MeshStandardMaterial();
    const bare = { mesh: new THREE.Mesh(new THREE.BufferGeometry(), standard) };
    viewer.surfaces.set('managed', managed as unknown as NeuroSurface);
    viewer.surfaces.set('custom', custom as unknown as NeuroSurface);
    viewer.surfaces.set('bare', bare as unknown as NeuroSurface);

    viewer.updateConfig({ metalness: 0.3, roughness: 0.7 });

    expect(managed.updateConfig).toHaveBeenCalledWith({ metalness: 0.3, roughness: 0.7 });
    expect(managed.mesh.material).toBe(phong);
    expect(phong.side).toBe(THREE.DoubleSide);
    expect(custom.mesh.material).toBe(shader);
    expect(bare.mesh.material).toBe(standard);
    expect(standard.metalness).toBe(0.3);
    expect(standard.roughness).toBe(0.7);
  });
});
