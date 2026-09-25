import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DataLayer,
  MultiLayerNeuroSurface,
  ReportSceneController,
  SurfaceGeometry
} from '../../src';
import type { NeuroSurfaceViewer } from '../../src';
import {
  chooseInformativeOblique,
  DEFAULT_REPORT_OBLIQUE,
  reportBrainViewAxes
} from '../../src/report/ReportSceneController';
import type {
  ReportBrainView,
  ReportObliqueAngle,
  ReportSceneControllerOptions
} from '../../src/report/ReportSceneController';
import { makeReportViewer, reportManifestFixture } from './report-scene-fixture';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const GROUP = { id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' } as const;

function hemisphereGeometry(hemisphere: 'left' | 'right'): SurfaceGeometry {
  // A small closed tetrahedron-like patch per hemisphere, offset from the midline.
  const sign = hemisphere === 'left' ? -1 : 1;
  return new SurfaceGeometry(
    new Float32Array([
      sign * 20, 0, 0,
      sign * 30, 0, 0,
      sign * 25, 20, 0,
      sign * 25, 5, 15,
      sign * 25, -15, -5
    ]),
    new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2, 0, 4, 1]),
    hemisphere
  );
}

interface Scene {
  readonly viewer: NeuroSurfaceViewer;
  readonly controller: ReportSceneController;
  readonly left: MultiLayerNeuroSurface;
  readonly right: MultiLayerNeuroSurface;
  dispose(): void;
}

function makeScene(
  options: Partial<ReportSceneControllerOptions> = {},
  threshold: [number, number] = [0, 0]
): Scene {
  const viewer = makeReportViewer();
  const manifest = reportManifestFixture();
  manifest.geometries.lh!.vertexCount = 5;
  manifest.geometries.lh!.faceCount = 5;
  manifest.geometries.rh!.vertexCount = 5;
  manifest.geometries.rh!.faceCount = 5;
  const left = new MultiLayerNeuroSurface(hemisphereGeometry('left'));
  const right = new MultiLayerNeuroSurface(hemisphereGeometry('right'));
  left.addLayer(new DataLayer('response', [4, 0, 0, 0, 0], null, 'viridis',
    { range: [-5, 5], threshold, visible: true }));
  right.addLayer(new DataLayer('response', [0, 0, 0, 0, 4], null, 'viridis',
    { range: [-5, 5], threshold, visible: true }));
  viewer.addSurface(left, 'lh');
  viewer.addSurface(right, 'rh');
  const registration = viewer.registerBilateralSurfaceGroup(GROUP);
  if (!registration.ok) throw new Error(registration.message);
  const controller = new ReportSceneController(viewer, manifest, {
    bilateralGroup: GROUP,
    hemisphereGap: 6,
    ...options
  });
  return {
    viewer,
    controller,
    left,
    right,
    dispose() {
      controller.dispose();
      left.dispose();
      right.dispose();
    }
  };
}

function withScene(
  options: Partial<ReportSceneControllerOptions>,
  body: (scene: Scene) => void,
  threshold?: [number, number]
): void {
  const scene = makeScene(options, threshold);
  try {
    body(scene);
  } finally {
    scene.dispose();
  }
}

function facesCamera(surface: MultiLayerNeuroSurface, view: ReportBrainView, oblique?: ReportObliqueAngle) {
  return new THREE.Vector3(...reportBrainViewAxes(view, oblique).direction)
    .applyQuaternion(surface.mesh!.quaternion)
    .distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-9;
}

/** NDC of every visible vertex under the fitted camera. */
function projectedVertices(scene: Scene): THREE.Vector3[] {
  const camera = scene.viewer.camera;
  camera.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  for (const surface of [scene.left, scene.right]) {
    const mesh = surface.mesh!;
    if (!mesh.visible) continue;
    const positions = (mesh.geometry as THREE.BufferGeometry).getAttribute('position');
    mesh.updateMatrixWorld(true);
    for (let i = 0; i < positions.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(positions, i)
        .applyMatrix4(mesh.matrixWorld)
        .project(camera));
    }
  }
  return points;
}

describe('ReportSceneController construction options', () => {
  it('defaults to the split layout and keeps split semantics', () => {
    withScene({}, ({ controller }) => {
      expect(controller.getLayout()).toBe('split');
      expect(controller.getBrainView()).toBeNull();
      expect(controller.setBrainView('dorsal')).toMatchObject({ ok: false, code: 'unsupported' });
      expect(controller.getBrainView()).toBeNull();
    });
  });

  it('applies a custom field of view to the camera', () => {
    withScene({ layout: 'anatomical', fov: 20 }, ({ viewer, controller }) => {
      expect(controller.getLayout()).toBe('anatomical');
      expect(viewer.camera.fov).toBe(20);
    });
  });

  it.each([
    ['layout', { layout: 'stacked' as never }],
    ['initialBrainView', { layout: 'anatomical' as const, initialBrainView: 'top' as never }],
    ['negative fitMargin', { fitMargin: -0.1 }],
    ['NaN fitMargin', { fitMargin: Number.NaN }],
    ['zero fov', { fov: 0 }],
    ['straight fov', { fov: 180 }],
    ['NaN fov', { fov: Number.NaN }],
    ['oblique elevation', { oblique: { azimuth: 0, elevation: 91 } }],
    ['oblique azimuth', { oblique: { azimuth: Number.NaN, elevation: 10 } }],
    ['negative inset', { fitInsets: { left: -1 } }],
    ['infinite inset', { fitInsets: { top: Number.POSITIVE_INFINITY } }],
    ['NaN inset', { fitInsets: { bottom: Number.NaN } }]
  ])('rejects an invalid %s with a RangeError', (_label, options) => {
    expect(() => makeScene(options)).toThrow(RangeError);
  });
});

describe('ReportSceneController anatomical brain views', () => {
  it('rejects unknown views and invalid gaps without changing the pose', () => {
    withScene({ layout: 'anatomical' }, ({ controller, left }) => {
      expect(controller.setBrainView('dorsal')).toEqual({ ok: true });
      const pose = left.mesh!.quaternion.clone();
      expect(controller.setBrainView('top' as ReportBrainView))
        .toMatchObject({ ok: false, code: 'invalid-value' });
      expect(controller.setBrainView('left', { hemisphereGap: -2 }))
        .toMatchObject({ ok: false, code: 'invalid-value' });
      expect(controller.setBrainView('left', { hemisphereGap: Number.NaN }))
        .toMatchObject({ ok: false, code: 'invalid-value' });
      expect(left.mesh!.quaternion.equals(pose)).toBe(true);
      expect(controller.getBrainView()).toBe('dorsal');
    });
  });

  it.each(['left', 'right', 'dorsal', 'ventral', 'anterior', 'posterior', 'oblique'] as const)(
    'poses both hemispheres as one brain for %s',
    view => {
      withScene({ layout: 'anatomical' }, ({ controller, left, right, viewer }) => {
        expect(controller.setBrainView(view)).toEqual({ ok: true });
        expect(controller.getBrainView()).toBe(view);
        expect(left.mesh!.visible && right.mesh!.visible).toBe(true);
        expect(left.mesh!.quaternion.toArray()).toEqual(right.mesh!.quaternion.toArray());
        expect(facesCamera(left, view)).toBe(true);
        expect(viewer.requestRender).toHaveBeenCalled();
      });
    }
  );

  it('hides the contralateral hemisphere for medial views and restores it', () => {
    withScene({ layout: 'anatomical' }, ({ controller, left, right }) => {
      controller.setBrainView('left-medial');
      expect([left.mesh!.visible, right.mesh!.visible]).toEqual([true, false]);
      controller.setBrainView('right-medial');
      expect([left.mesh!.visible, right.mesh!.visible]).toEqual([false, true]);
      controller.setBrainView('oblique');
      expect([left.mesh!.visible, right.mesh!.visible]).toEqual([true, true]);
    });
  });

  it('reports canonical left views as anatomical views and emits the change', () => {
    withScene({ layout: 'anatomical' }, ({ controller, viewer }) => {
      const events: unknown[] = [];
      viewer.on('anatomical-view:changed', event => events.push(event));

      controller.setBrainView('left');
      expect(controller.getState().currentView)
        .toEqual({ view: 'lateral', target: { kind: 'group', groupId: 'cortex' } });
      controller.setBrainView('left-medial');
      expect(controller.getState().currentView?.view).toBe('medial');
      controller.setBrainView('dorsal');
      expect(controller.getState().currentView?.view).toBe('dorsal');
      expect(events).toHaveLength(3);

      // Right-side and oblique poses have no anatomical-view equivalent.
      controller.setBrainView('right');
      expect(controller.getState().currentView).toBeNull();
      controller.setBrainView('oblique');
      expect(controller.getState().currentView).toBeNull();
      expect(events).toHaveLength(3);
    });
  });

  it('routes group anatomical views through the whole-brain pose', () => {
    withScene({ layout: 'anatomical' }, ({ controller, left, right }) => {
      expect(controller.setAnatomicalView('medial', { kind: 'group', groupId: 'cortex' }))
        .toEqual({ ok: true });
      expect(controller.getBrainView()).toBe('left-medial');
      expect(right.mesh!.visible).toBe(false);
      expect(controller.setAnatomicalView('lateral', { kind: 'group', groupId: 'cortex' }))
        .toEqual({ ok: true });
      expect(controller.getBrainView()).toBe('left');
      expect(facesCamera(left, 'left')).toBe(true);
    });
  });

  it('resets to the configured initial brain view', () => {
    withScene({ layout: 'anatomical', initialBrainView: 'ventral' }, ({ controller, left }) => {
      controller.setBrainView('left-medial');
      expect(controller.resetView()).toEqual({ ok: true });
      expect(controller.getBrainView()).toBe('ventral');
      expect(facesCamera(left, 'ventral')).toBe(true);
    });
    withScene({ layout: 'anatomical' }, ({ controller }) => {
      expect(controller.resetView()).toEqual({ ok: true });
      expect(controller.getBrainView()).toBe('oblique');
    });
  });

  it('forgets the brain view after a free camera change', () => {
    withScene({ layout: 'anatomical' }, ({ controller, viewer }) => {
      controller.setBrainView('posterior');
      viewer.emit('state:changed', { revision: 99, domains: ['camera'] });
      expect(controller.getBrainView()).toBeNull();
    });
  });

  it('clears the brain view when a split-layout view is applied', () => {
    withScene({}, ({ controller, left, right }) => {
      expect(controller.setAnatomicalView('medial', { kind: 'group', groupId: 'cortex' }))
        .toEqual({ ok: true });
      expect(controller.getBrainView()).toBeNull();
      expect([left.mesh!.visible, right.mesh!.visible]).toEqual([true, true]);
    });
  });

  it('fails every brain-view command after disposal', () => {
    const scene = makeScene({ layout: 'anatomical' });
    scene.dispose();
    expect(scene.controller.setBrainView('left')).toMatchObject({ ok: false, code: 'disposed' });
    expect(scene.controller.resetView()).toMatchObject({ ok: false, code: 'disposed' });
  });
});

describe('ReportSceneController oblique angle', () => {
  it('uses an explicit oblique angle', () => {
    const angle = { azimuth: 50, elevation: 10 };
    withScene({ layout: 'anatomical', oblique: angle }, ({ controller, left }) => {
      controller.setBrainView('oblique');
      expect(facesCamera(left, 'oblique', angle)).toBe(true);
    });
  });

  it('falls back to the default oblique in auto mode when the map is unthresholded', () => {
    withScene({ layout: 'anatomical', oblique: 'auto' }, ({ controller, left }) => {
      controller.setBrainView('oblique');
      expect(facesCamera(left, 'oblique', DEFAULT_REPORT_OBLIQUE)).toBe(true);
    });
  });

  it('chooses a data-driven oblique for a thresholded map in auto mode', () => {
    withScene({ layout: 'anatomical', oblique: 'auto' }, ({ controller, viewer, left, right }) => {
      const expected = chooseInformativeOblique(
        [
          { hemisphere: 'left', surface: left, layer: viewer.getOrderedLayers('lh').find(l => l.id === 'response') },
          { hemisphere: 'right', surface: right, layer: viewer.getOrderedLayers('rh').find(l => l.id === 'response') }
        ],
        DEFAULT_REPORT_OBLIQUE
      );
      expect(expected).not.toEqual(DEFAULT_REPORT_OBLIQUE);
      controller.setBrainView('oblique');
      expect(facesCamera(left, 'oblique', expected)).toBe(true);
      expect(facesCamera(left, 'oblique', DEFAULT_REPORT_OBLIQUE)).toBe(false);
    }, [-1, 1]);
  });
});

describe('ReportSceneController camera fit', () => {
  it('frames every visible vertex inside the canvas without a view offset', () => {
    withScene({ layout: 'anatomical' }, scene => {
      scene.controller.setBrainView('oblique');
      expect(scene.viewer.camera.view?.enabled ?? false).toBe(false);
      const points = projectedVertices(scene);
      const extent = Math.max(...points.flatMap(p => [Math.abs(p.x), Math.abs(p.y)]));
      expect(extent).toBeLessThanOrEqual(1);
      // Tight: the default 10 % margin leaves the silhouette near the frame.
      expect(extent).toBeGreaterThan(0.8);
    });
  });

  it('scales the camera distance with fitMargin', () => {
    const distance = (fitMargin: number) => {
      const scene = makeScene({ layout: 'anatomical', fitMargin });
      try {
        scene.controller.setBrainView('dorsal');
        return scene.viewer.camera.position.distanceTo(scene.viewer.cameraControls.target);
      } finally {
        scene.dispose();
      }
    };
    expect(distance(0.5) / distance(0)).toBeCloseTo(1.5, 10);
  });

  it('centres the brain in the free rectangle with an asymmetric principal point', () => {
    withScene({ layout: 'anatomical', fitInsets: { left: 200 } }, scene => {
      const { viewer, controller } = scene;
      controller.setBrainView('dorsal');
      const view = viewer.camera.view!;
      expect(view.enabled).toBe(true);
      expect(view.offsetX).toBe(-100);
      expect(view.offsetY).toBe(0);
      // The orbit target stays on the brain centre and lands mid free rectangle:
      // x = 200 + 600 / 2 = 500 px of 800, i.e. NDC 0.25.
      viewer.camera.updateMatrixWorld(true);
      const center = viewer.cameraControls.target.clone().project(viewer.camera);
      expect(center.x).toBeCloseTo(0.25, 6);
      expect(center.y).toBeCloseTo(0, 6);
      for (const point of projectedVertices(scene)) {
        expect(point.x).toBeGreaterThanOrEqual(-0.5 - 1e-9);
        expect(point.x).toBeLessThanOrEqual(1 + 1e-9);
      }

      // Clearing the insets clears the view offset.
      controller.setFitInsets({});
      expect(viewer.camera.view?.enabled ?? false).toBe(false);
      viewer.camera.updateMatrixWorld(true);
      expect(viewer.cameraControls.target.clone().project(viewer.camera).x).toBeCloseTo(0, 6);
    });
  });

  it('refits on setFitInsets and rejects invalid insets without applying them', () => {
    withScene({ layout: 'anatomical' }, ({ viewer, controller }) => {
      controller.setBrainView('dorsal');
      controller.setFitInsets({ top: 120, bottom: 20 });
      expect(viewer.camera.view).toMatchObject({ enabled: true, offsetX: 0, offsetY: -50 });
      expect(() => controller.setFitInsets({ right: -5 })).toThrow(RangeError);
      expect(() => controller.setFitInsets({ left: Number.NaN })).toThrow(RangeError);
      controller.fitView();
      expect(viewer.camera.view).toMatchObject({ enabled: true, offsetX: 0, offsetY: -50 });
    });
  });

  it('ignores hidden hemispheres when framing a medial view', () => {
    const width = (view: ReportBrainView) => {
      const scene = makeScene({ layout: 'anatomical' });
      try {
        scene.controller.setBrainView(view);
        return scene.viewer.camera.position.distanceTo(scene.viewer.cameraControls.target);
      } finally {
        scene.dispose();
      }
    };
    // The single medial hemisphere is framed closer than the bilateral lateral pose.
    expect(width('left-medial')).toBeLessThan(width('dorsal'));
  });
});

describe('ReportSceneController headlight', () => {
  it('keeps key and fill lights camera-relative in the anatomical layout', () => {
    withScene({ layout: 'anatomical' }, ({ viewer, controller }) => {
      const fill = new THREE.DirectionalLight(0xffffff);
      (viewer as unknown as { fillLight: THREE.DirectionalLight }).fillLight = fill;
      controller.setBrainView('dorsal');
      viewer.emit('render:before');
      const target = viewer.cameraControls.target;
      const distance = viewer.camera.position.distanceTo(target);
      for (const light of [viewer.directionalLight, fill]) {
        expect(light.position.distanceTo(viewer.camera.position)).toBeCloseTo(distance, 6);
        expect(light.target.position.equals(target)).toBe(true);
      }
      // Key light sits above-right of the camera in view space.
      const inView = viewer.directionalLight.position.clone()
        .sub(viewer.camera.position)
        .applyQuaternion(viewer.camera.quaternion.clone().invert());
      expect(inView.x).toBeGreaterThan(0);
      expect(inView.y).toBeGreaterThan(0);
    });
  });

  it('leaves lights alone when the headlight is off (split default)', () => {
    withScene({}, ({ viewer }) => {
      viewer.directionalLight.position.set(1, 2, 3);
      viewer.emit('render:before');
      expect(viewer.directionalLight.position.toArray()).toEqual([1, 2, 3]);
    });
  });

  it('stops tracking the camera after disposal', () => {
    const scene = makeScene({ layout: 'anatomical' });
    scene.dispose();
    scene.viewer.directionalLight.position.set(1, 2, 3);
    scene.viewer.emit('render:before');
    expect(scene.viewer.directionalLight.position.toArray()).toEqual([1, 2, 3]);
  });
});
