import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  ANATOMICAL_VIEWS,
  getAnatomicalViewAxes
} from '../../src/AnatomicalView';
import type {
  AnatomicalView,
  AnatomicalViewOptions,
  BilateralSurfaceGroup
} from '../../src/AnatomicalView';
import { EventEmitter } from '../../src/EventEmitter';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import type { ViewerEventMap } from '../../src/events';
import { layoutReportAnatomicalMeshes } from '../../src/report/SceneMount';

interface TestSurface {
  hemisphere: string;
  mesh: THREE.Mesh;
  geometry: { vertices: Float32Array };
  dispose: ReturnType<typeof vi.fn>;
}

function makeSurface(
  hemisphere: string,
  position: readonly [number, number, number] = [0, 0, 0],
  size: readonly [number, number, number] = [2, 4, 6]
): TestSurface {
  const geometry = new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(...position);
  mesh.updateMatrixWorld(true);
  return {
    hemisphere,
    mesh,
    geometry: {
      vertices: new Float32Array(geometry.getAttribute('position').array)
    },
    dispose: vi.fn()
  };
}

function makeViewer(entries: readonly [string, TestSurface][]): NeuroSurfaceViewer {
  const viewer = new EventEmitter<ViewerEventMap>() as any;
  Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
  viewer.disposed = false;
  viewer.initializationFailed = false;
  viewer.stateRevision = 0;
  viewer.stateChangeBatchDepth = 0;
  viewer.pendingStateDomains = new Set();
  viewer.surfaceSubscriptions = new Map();
  viewer.bilateralSurfaceGroups = new Map();
  viewer.surfaceGroupMembership = new Map();
  viewer.surfaces = new Map(entries);
  viewer.scene = new THREE.Scene();
  entries.forEach(([, surface]) => viewer.scene.add(surface.mesh));
  viewer.camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 1000);
  viewer.camera.position.set(0, 0, 25);
  viewer.cameraControls = {
    target: new THREE.Vector3(),
    update: vi.fn(),
    enabled: true
  };
  viewer.config = { initialZoom: 12 };
  viewer.sceneBoundsRadius = 0;
  viewer.viewpointState = null;
  viewer.currentViewpointKey = '';
  viewer.viewpoint = 'lateral';
  viewer.selectedLayerId = null;
  viewer.selectedSurfaceId = null;
  viewer.gpuPicker = null;
  viewer.crosshair = { visible: false };
  viewer.annotations = { removeBySurface: vi.fn() };
  viewer.requestRender = vi.fn();
  return viewer;
}

function cameraDirection(viewer: NeuroSurfaceViewer): THREE.Vector3 {
  return viewer.camera.position.clone()
    .sub(viewer.cameraControls.target)
    .normalize();
}

describe('anatomical orientation vocabulary', () => {
  it('provides immutable RAS fixtures for all six left and right views', () => {
    expect(ANATOMICAL_VIEWS).toEqual([
      'lateral',
      'medial',
      'dorsal',
      'ventral',
      'anterior',
      'posterior'
    ]);
    expect(getAnatomicalViewAxes('left', 'lateral').direction).toEqual([-1, 0, 0]);
    expect(getAnatomicalViewAxes('right', 'lateral').direction).toEqual([1, 0, 0]);
    expect(getAnatomicalViewAxes('left', 'medial').direction).toEqual([1, 0, 0]);
    expect(getAnatomicalViewAxes('right', 'medial').direction).toEqual([-1, 0, 0]);
    expect(getAnatomicalViewAxes('left', 'dorsal')).toEqual({
      direction: [0, 0, 1],
      up: [0, 1, 0]
    });
    expect(getAnatomicalViewAxes('right', 'ventral')).toEqual({
      direction: [0, 0, -1],
      up: [0, 1, 0]
    });
    expect(getAnatomicalViewAxes('left', 'anterior').direction).toEqual([0, 1, 0]);
    expect(getAnatomicalViewAxes('left', 'posterior').direction).toEqual([0, -1, 0]);
    expect(Object.isFrozen(getAnatomicalViewAxes('left', 'lateral'))).toBe(true);
    expect(Object.isFrozen(getAnatomicalViewAxes('left', 'lateral').direction)).toBe(true);

    expectTypeOf<AnatomicalView>().toEqualTypeOf<
      'lateral' | 'medial' | 'dorsal' | 'ventral' | 'anterior' | 'posterior'
    >();
    expectTypeOf<AnatomicalViewOptions>().toMatchTypeOf<
      | { layout: 'single'; surfaceId: string; fit?: boolean }
      | { layout: 'paired'; groupId: string; fit?: boolean; hemisphereGap?: number }
    >();
  });
});

describe('explicit bilateral surface groups', () => {
  it('does not infer a group from loaded hemisphere metadata', () => {
    const viewer = makeViewer([
      ['lh', makeSurface('left')],
      ['rh', makeSurface('right')]
    ]);

    expect(viewer.getBilateralSurfaceGroups()).toEqual([]);
    expect(viewer.getAnatomicalViewCapabilities()).toEqual({
      views: ANATOMICAL_VIEWS,
      singleSurfaceIds: ['lh', 'rh'],
      bilateralGroups: []
    });
  });

  it('returns typed registration failures without partially mutating state', () => {
    const viewer = makeViewer([
      ['lh', makeSurface('left')],
      ['rh', makeSurface('right')],
      ['lh2', makeSurface('lh')],
      ['rh2', makeSurface('rh')],
      ['unknown', makeSurface('both')]
    ]);
    const revision = viewer.getStateRevision();

    expect(viewer.registerBilateralSurfaceGroup({
      id: '', leftSurfaceId: 'lh', rightSurfaceId: 'rh'
    })).toMatchObject({ ok: false, code: 'invalid-group-id' });
    expect(viewer.registerBilateralSurfaceGroup({
      id: 'missing', leftSurfaceId: 'lh', rightSurfaceId: 'absent'
    })).toMatchObject({ ok: false, code: 'surface-not-found' });
    expect(viewer.registerBilateralSurfaceGroup({
      id: 'same', leftSurfaceId: 'lh', rightSurfaceId: 'lh'
    })).toMatchObject({ ok: false, code: 'duplicate-surface' });
    expect(viewer.registerBilateralSurfaceGroup({
      id: 'swapped', leftSurfaceId: 'rh', rightSurfaceId: 'lh'
    })).toMatchObject({ ok: false, code: 'invalid-hemisphere' });
    expect(viewer.registerBilateralSurfaceGroup({
      id: 'unknown', leftSurfaceId: 'unknown', rightSurfaceId: 'rh'
    })).toMatchObject({ ok: false, code: 'invalid-hemisphere' });

    expect(viewer.getBilateralSurfaceGroups()).toEqual([]);
    expect(viewer.getStateRevision()).toBe(revision);

    expect(viewer.registerBilateralSurfaceGroup({
      id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh'
    })).toMatchObject({ ok: true });
    const afterSuccess = viewer.getStateRevision();
    expect(viewer.registerBilateralSurfaceGroup({
      id: 'cortex', leftSurfaceId: 'lh2', rightSurfaceId: 'rh2'
    })).toMatchObject({ ok: false, code: 'group-id-exists' });
    expect(viewer.registerBilateralSurfaceGroup({
      id: 'overlap', leftSurfaceId: 'lh2', rightSurfaceId: 'rh'
    })).toMatchObject({ ok: false, code: 'surface-already-grouped' });
    expect(viewer.getStateRevision()).toBe(afterSuccess);
    expect(viewer.getBilateralSurfaceGroups().map(group => group.id)).toEqual(['cortex']);
  });

  it('publishes immutable registration and deterministic removal events', () => {
    const left = makeSurface('left');
    const viewer = makeViewer([
      ['lh', left],
      ['rh', makeSurface('right')]
    ]);
    const registered = vi.fn();
    const removed = vi.fn();
    const stateChanged = vi.fn();
    viewer.on('surface-group:registered', registered);
    viewer.on('surface-group:removed', removed);
    viewer.on('state:changed', stateChanged);

    const result = viewer.registerBilateralSurfaceGroup({
      id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh'
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('registration failed');
    expect(Object.isFrozen(result.group)).toBe(true);
    expect(registered).toHaveBeenCalledWith({ group: result.group });
    expect(stateChanged).toHaveBeenLastCalledWith({ revision: 1, domains: ['surfaces'] });

    viewer.removeSurface('lh');

    expect(left.dispose).toHaveBeenCalledOnce();
    expect(viewer.getBilateralSurfaceGroup('cortex')).toBeNull();
    expect(removed).toHaveBeenCalledWith({
      group: result.group,
      reason: 'surface-removed',
      removedSurfaceId: 'lh'
    });
    expect(stateChanged).toHaveBeenLastCalledWith({ revision: 2, domains: ['surfaces'] });
  });

  it('allows multiple non-overlapping groups but at most one group per surface', () => {
    const viewer = makeViewer([
      ['lh-a', makeSurface('left')],
      ['rh-a', makeSurface('right')],
      ['lh-b', makeSurface('left')],
      ['rh-b', makeSurface('right')]
    ]);
    const groups: BilateralSurfaceGroup[] = [
      { id: 'a', leftSurfaceId: 'lh-a', rightSurfaceId: 'rh-a' },
      { id: 'b', leftSurfaceId: 'lh-b', rightSurfaceId: 'rh-b' }
    ];

    expect(viewer.registerBilateralSurfaceGroup(groups[0]).ok).toBe(true);
    expect(viewer.registerBilateralSurfaceGroup(groups[1]).ok).toBe(true);
    expect(viewer.getBilateralSurfaceGroups().map(group => group.id)).toEqual(['a', 'b']);
    expect(viewer.unregisterBilateralSurfaceGroup('a')).toMatchObject({ ok: true });
    expect(viewer.unregisterBilateralSurfaceGroup('absent')).toMatchObject({
      ok: false,
      code: 'group-not-found'
    });
  });
});

describe('viewer anatomical camera adapter', () => {
  it('applies every single-surface view deterministically, including dorsal', () => {
    const viewer = makeViewer([['lh', makeSurface('left', [10, 2, -3])]]);

    for (const view of ANATOMICAL_VIEWS) {
      const first = viewer.setAnatomicalView(view, {
        layout: 'single',
        surfaceId: 'lh',
        fit: true
      });
      const firstPosition = viewer.camera.position.clone();
      const expected = new THREE.Vector3(...getAnatomicalViewAxes('left', view).direction);
      expect(first).toMatchObject({ ok: true, view, layout: 'single' });
      expect(cameraDirection(viewer).distanceTo(expected)).toBeLessThan(1e-10);

      viewer.setAnatomicalView(view, {
        layout: 'single',
        surfaceId: 'lh',
        fit: true
      });
      expect(viewer.camera.position.distanceTo(firstPosition)).toBeLessThan(1e-10);
    }
  });

  it('uses an explicit group and stable left-reference camera semantics for all paired views', () => {
    const left = makeSurface('left', [-4, 0, 0]);
    const right = makeSurface('right', [4, 0, 0]);
    const viewer = makeViewer([['lh', left], ['rh', right]]);
    viewer.registerBilateralSurfaceGroup({
      id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh'
    });
    const leftPosition = left.mesh.position.clone();
    const rightPosition = right.mesh.position.clone();

    for (const view of ANATOMICAL_VIEWS) {
      const result = viewer.setAnatomicalView(view, {
        layout: 'paired',
        groupId: 'cortex',
        fit: true,
        hemisphereGap: 8
      });
      const expected = new THREE.Vector3(...getAnatomicalViewAxes('left', view).direction);
      expect(result).toMatchObject({ ok: true, view, layout: 'paired' });
      expect(cameraDirection(viewer).distanceTo(expected)).toBeLessThan(1e-10);
      expect(left.mesh.position).toEqual(leftPosition);
      expect(right.mesh.position).toEqual(rightPosition);
    }
  });

  it('keeps invalid commands atomic and makes fit and reset behavior explicit', () => {
    const viewer = makeViewer([['lh', makeSurface('left', [8, 0, 0])]]);
    const originalPosition = viewer.camera.position.clone();
    const originalRevision = viewer.getStateRevision();

    expect(viewer.setAnatomicalView('lateral', {
      layout: 'paired',
      groupId: 'missing',
      hemisphereGap: -1
    })).toMatchObject({ ok: false, code: 'invalid-gap' });
    expect(viewer.camera.position).toEqual(originalPosition);
    expect(viewer.getStateRevision()).toBe(originalRevision);

    const originalDistance = viewer.camera.position.distanceTo(viewer.cameraControls.target);
    expect(viewer.setAnatomicalView('medial', {
      layout: 'single',
      surfaceId: 'lh',
      fit: false
    })).toMatchObject({ ok: true });
    expect(viewer.camera.position.distanceTo(viewer.cameraControls.target)).toBeCloseTo(
      originalDistance,
      10
    );

    expect(viewer.resetAnatomicalView()).toEqual({ ok: true });
    expect(viewer.camera.position.toArray()).toEqual([0, 0, 12]);
    expect(viewer.cameraControls.target.toArray()).toEqual([0, 0, 0]);
  });
});

describe('report coordinated-mesh adapter', () => {
  it('lays out only an explicit pair with the requested gap for all six views', () => {
    for (const view of ANATOMICAL_VIEWS) {
      const left = makeSurface('left', [100, 0, 0], [2, 4, 6]).mesh;
      const right = makeSurface('right', [-100, 0, 0], [4, 6, 8]).mesh;
      const untouched = makeSurface('left', [42, 3, 1]).mesh;
      const untouchedPosition = untouched.position.clone();

      layoutReportAnatomicalMeshes([
        { id: 'lh', hemisphere: 'left', mesh: left },
        { id: 'rh', hemisphere: 'right', mesh: right }
      ], view, 8, true);

      const leftBounds = new THREE.Box3().setFromObject(left);
      const rightBounds = new THREE.Box3().setFromObject(right);
      expect(rightBounds.min.x - leftBounds.max.x).toBeCloseTo(8, 10);
      expect(untouched.position).toEqual(untouchedPosition);
    }
  });

  it('rejects invalid gaps before changing report meshes', () => {
    const mesh = makeSurface('left', [5, 0, 0]).mesh;
    const position = mesh.position.clone();
    expect(() => layoutReportAnatomicalMeshes([
      { id: 'lh', hemisphere: 'left', mesh }
    ], 'lateral', Number.NaN, false)).toThrow('hemisphereGap');
    expect(mesh.position).toEqual(position);
  });
});
