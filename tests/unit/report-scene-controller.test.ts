import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  getAnatomicalViewAxes,
  ReportSceneController
} from '../../src';
import {
  makeReportFixture,
  makeReportViewer,
  reportManifestFixture
} from './report-scene-fixture';
import { DataLayer, MultiLayerNeuroSurface, SurfaceGeometry } from '../../src';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReportSceneController', () => {
  it('applies one displayed map across surfaces without legacy selected IDs', () => {
    const fixture = makeReportFixture();
    try {
      fixture.viewer.selectedSurfaceId = 'legacy-surface';
      fixture.viewer.selectedLayerId = 'legacy-layer';

      expect(fixture.controller.setDisplayedLayer('uncertainty')).toEqual({ ok: true });
      for (const surfaceId of ['lh', 'rh']) {
        const layers = fixture.viewer.getOrderedLayers(surfaceId);
        expect(layers.find(layer => layer.id === 'response')?.visible).toBe(false);
        expect(layers.find(layer => layer.id === 'uncertainty')?.visible).toBe(true);
      }
      expect(fixture.controller.getState().displayedLayerId).toBe('uncertainty');
      expect(fixture.viewer.selectedSurfaceId).toBe('legacy-surface');
      expect(fixture.viewer.selectedLayerId).toBe('legacy-layer');
    } finally {
      fixture.dispose();
    }
  });

  it('prevalidates unknown or unavailable maps without partial mutation', () => {
    const fixture = makeReportFixture();
    try {
      const before = ['lh', 'rh'].map(surfaceId =>
        fixture.viewer.getOrderedLayers(surfaceId).map(layer => [layer.id, layer.visible])
      );
      expect(fixture.controller.setDisplayedLayer('missing')).toMatchObject({
        ok: false,
        code: 'layer-not-found'
      });
      expect(['lh', 'rh'].map(surfaceId =>
        fixture.viewer.getOrderedLayers(surfaceId).map(layer => [layer.id, layer.visible])
      )).toEqual(before);
      expect(fixture.controller.getState().displayedLayerId).toBe('response');
    } finally {
      fixture.dispose();
    }
  });

  it.each(['lateral', 'medial', 'dorsal', 'ventral'] as const)(
    'retains paired %s layout and camera-fit semantics',
    view => {
      const fixture = makeReportFixture();
      try {
        const beforeUpdates = vi.mocked(fixture.viewer.cameraControls.update).mock.calls.length;
        expect(fixture.controller.setAnatomicalView(view, {
          kind: 'group',
          groupId: 'cortex'
        })).toEqual({ ok: true });

        const leftCenter = new THREE.Box3().setFromObject(fixture.left.mesh!)
          .getCenter(new THREE.Vector3());
        const rightCenter = new THREE.Box3().setFromObject(fixture.right.mesh!)
          .getCenter(new THREE.Vector3());
        expect(leftCenter.x).toBeLessThan(0);
        expect(rightCenter.x).toBeGreaterThan(0);
        expect(rightCenter.x - leftCenter.x).toBeGreaterThanOrEqual(12);
        for (const [hemisphere, surface] of [
          ['left', fixture.left],
          ['right', fixture.right]
        ] as const) {
          const axes = getAnatomicalViewAxes(hemisphere, view);
          const forward = new THREE.Vector3(...axes.direction)
            .applyQuaternion(surface.mesh!.quaternion);
          const up = new THREE.Vector3(...axes.up)
            .applyQuaternion(surface.mesh!.quaternion);
          expect(forward.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-10);
          expect(up.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-10);
        }
        expect(fixture.viewer.camera.position.toArray().every(Number.isFinite)).toBe(true);
        expect(vi.mocked(fixture.viewer.cameraControls.update).mock.calls.length)
          .toBeGreaterThan(beforeUpdates);
        expect(fixture.controller.getState().currentView).toEqual({
          view,
          target: { kind: 'group', groupId: 'cortex' }
        });
      } finally {
        fixture.dispose();
      }
    }
  );

  it('rejects targets outside the explicit report group with typed failures', () => {
    const fixture = makeReportFixture();
    try {
      expect(fixture.controller.setAnatomicalView('lateral', {
        kind: 'surface',
        surfaceId: 'lh'
      })).toMatchObject({ ok: false, code: 'surface-not-found' });
      expect(fixture.controller.setAnatomicalView('lateral', {
        kind: 'group',
        groupId: 'other'
      })).toMatchObject({ ok: false, code: 'group-not-found' });
      expect(fixture.controller.setAnatomicalView('lateral', {
        kind: 'group',
        groupId: 'cortex'
      }, { hemisphereGap: -1 })).toMatchObject({
        ok: false,
        code: 'invalid-value'
      });
      expect(fixture.controller.setAnatomicalView(
        'lateral',
        { kind: 'invalid' } as never
      )).toMatchObject({ ok: false, code: 'invalid-value' });
    } finally {
      fixture.dispose();
    }
  });

  it('reconciles external visibility changes and clears ambiguous map state', () => {
    const fixture = makeReportFixture();
    try {
      fixture.leftUncertainty.setVisible(true);
      expect(fixture.controller.getState().displayedLayerId).toBeNull();

      fixture.leftResponse.setVisible(false);
      fixture.viewer.getOrderedLayers('rh')
        .find(layer => layer.id === 'response')?.setVisible(false);
      expect(fixture.controller.getState().displayedLayerId).toBeNull();
      fixture.viewer.getOrderedLayers('rh')
        .find(layer => layer.id === 'uncertainty')?.setVisible(true);
      expect(fixture.controller.getState().displayedLayerId).toBe('uncertainty');
    } finally {
      fixture.dispose();
    }
  });

  it('supports a single-surface report target and idempotent disposal', () => {
    const viewer = makeReportViewer();
    const manifest = reportManifestFixture();
    delete manifest.geometries.rh;
    delete manifest.layers.response.values.rh;
    delete manifest.layers.uncertainty.values.rh;
    const surface = new MultiLayerNeuroSurface(new SurfaceGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      'left'
    ));
    surface.addLayer(new DataLayer('response', [1, 2, 3], null, 'viridis'));
    viewer.addSurface(surface, 'lh');
    const controller = new ReportSceneController(viewer, manifest);
    try {
      expect(controller.getViewTarget()).toEqual({ kind: 'surface', surfaceId: 'lh' });
      expect(controller.resetView()).toEqual({ ok: true });
      controller.dispose();
      controller.dispose();
      expect(controller.setDisplayedLayer('response')).toMatchObject({
        ok: false,
        code: 'disposed'
      });
    } finally {
      controller.dispose();
      surface.dispose();
    }
  });
});
