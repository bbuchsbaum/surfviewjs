import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventEmitter } from '../../src/EventEmitter';
import { AnnotationManager } from '../../src/annotations';
import { CrosshairManager } from '../../src/CrosshairManager';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import { ViewerPickingController } from '../../src/viewer/ViewerPickingController';
import { encode } from '../../src/serialization';
import type { ViewerStateV2 } from '../../src/serialization';
import type { ViewerEventMap } from '../../src/events';
import type { GPUPicker } from '../../src/utils/GPUPicker';
import type { Hemisphere, NeuroSurfaceViewerConfig } from '../../src/index';
import type { loadSurface } from '../../src/loaders';

afterEach(() => {
  vi.useRealTimers();
});

function borrowViewer(): any {
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
  viewer.surfaces = new Map();
  viewer.scene = new THREE.Scene();
  viewer.requestRender = vi.fn();
  return viewer;
}

describe('GPU picking disable falls back to CPU raycasting', () => {
  function fixture() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, -1, 0,
      1, -1, 0,
      0, 1, 0
    ], 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    let enabled = true;
    const gpuPick = vi.fn(() => ({ surfaceId: null, vertexIndex: null, point: null, faceIndex: null }));
    let gpuPicker: GPUPicker | null = {
      pick: gpuPick,
      isEnabled: () => enabled,
      setEnabled: (value: boolean) => { enabled = value; },
      addSurface: vi.fn(),
      removeSurface: vi.fn(),
      dispose: vi.fn()
    } as unknown as GPUPicker;
    const controller = new ViewerPickingController({
      getCanvas: () => ({
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
      }),
      getCamera: () => camera,
      getSurfaces: () => new Map([['left', { mesh }]]),
      getGPUPicker: () => gpuPicker,
      setGPUPicker: picker => { gpuPicker = picker; }
    });
    return { controller, gpuPick };
  }

  it('raycasts once the existing GPU picker has been disabled', () => {
    const { controller, gpuPick } = fixture();
    controller.disableGPU();
    expect(controller.isGPUEnabled()).toBe(false);
    const hit = controller.pick({ x: 50, y: 50 });
    expect(gpuPick).not.toHaveBeenCalled();
    expect(hit.surfaceId).toBe('left');
    expect(hit.vertexIndex).toBe(2);
  });

  it('still uses the GPU picker while it is enabled', () => {
    const { controller, gpuPick } = fixture();
    controller.pick({ x: 50, y: 50 });
    expect(gpuPick).toHaveBeenCalledOnce();
  });
});

describe('viewer.fromURL accepts the forms toURL produces', () => {
  const state = {
    version: 2,
    camera: {
      position: [10, 20, 30],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1.5,
      fov: 50
    },
    config: {
      background: 0x112233,
      lighting: {
        ambientIntensity: 0.4,
        directionalIntensity: 0.8,
        directionalPosition: [1, 2, 3]
      }
    },
    surfaces: {},
    surfaceGroups: [],
    crosshair: {
      visible: false,
      surfaceId: null,
      vertexIndex: null,
      size: 1.5,
      color: 0xffcc00,
      mode: null
    },
    timeline: null,
    inspectionSelection: { kind: 'none' }
  } as unknown as ViewerStateV2;

  function viewerWithState() {
    const viewer = borrowViewer();
    viewer.toJSON = () => state;
    viewer.fromJSON = vi.fn(() => ({ ok: true }));
    return viewer;
  }

  it('round-trips a full URL string from toURL()', () => {
    const viewer = viewerWithState();
    const link = viewer.toURL('https://example.org/viewer.html?subject=01');
    viewer.fromURL(link);
    expect(viewer.fromJSON).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    expect(viewer.fromJSON.mock.calls[0][0].camera.position).toEqual([10, 20, 30]);
  });

  it('accepts a URL object, a hash, and a bare fragment', () => {
    const viewer = viewerWithState();
    const link = viewer.toURL('https://example.org/viewer.html');
    viewer.fromURL(new URL(link));
    viewer.fromURL(new URL(link).hash);
    viewer.fromURL(encode(state));
    expect(viewer.fromJSON).toHaveBeenCalledTimes(3);
  });

  it('still rejects input without a surfview state fragment', () => {
    const viewer = viewerWithState();
    expect(() => viewer.fromURL('https://example.org/viewer.html')).toThrow('missing "svjs="');
    expect(() => viewer.fromURL('https://example.org/viewer.html#other')).toThrow('missing "svjs="');
  });
});

describe('paired anatomical views apply hemisphereGap', () => {
  function makeSurface(hemisphere: string, x: number) {
    const geometry = new THREE.BoxGeometry(2, 4, 6);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.position.set(x, 1, -2);
    mesh.updateMatrixWorld(true);
    return { hemisphere, mesh, dispose: vi.fn() };
  }

  function makeViewer(left: ReturnType<typeof makeSurface>, right: ReturnType<typeof makeSurface>) {
    const viewer = borrowViewer();
    viewer.surfaces = new Map([['lh', left], ['rh', right]]);
    viewer.scene.add(left.mesh, right.mesh);
    viewer.camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 1000);
    viewer.camera.position.set(0, 0, 25);
    viewer.cameraControls = { target: new THREE.Vector3(), update: vi.fn(), enabled: true };
    viewer.config = { initialZoom: 12 };
    viewer.sceneBoundsRadius = 0;
    viewer.viewpointState = null;
    viewer.currentViewpointKey = '';
    viewer.viewpoint = 'lateral';
    viewer.gpuPicker = null;
    viewer.crosshair = { visible: false };
    viewer.annotations = { removeBySurface: vi.fn() };
    viewer.registerBilateralSurfaceGroup({ id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' });
    return viewer;
  }

  it('places the medial edges hemisphereGap apart, centred on the midline', () => {
    // Overlapping hemispheres (e.g. inflated meshes that both sit at the origin).
    const left = makeSurface('left', 0.5);
    const right = makeSurface('right', -0.5);
    const viewer = makeViewer(left, right);

    const result = viewer.setAnatomicalView('dorsal', {
      layout: 'paired',
      groupId: 'cortex',
      hemisphereGap: 10
    });
    expect(result).toMatchObject({ ok: true });
    const leftBox = new THREE.Box3().setFromObject(left.mesh);
    const rightBox = new THREE.Box3().setFromObject(right.mesh);
    expect(leftBox.max.x).toBeCloseTo(-5, 10);
    expect(rightBox.min.x).toBeCloseTo(5, 10);
    // Only the left-right axis moves.
    expect(left.mesh.position.y).toBe(1);
    expect(right.mesh.position.z).toBe(-2);
    // The camera is fitted to the separated pair.
    expect(viewer.cameraControls.target.x).toBeCloseTo(0, 10);
  });

  it('measures the medial edge from the displayed cortex, not markers or inactive morphs', () => {
    const left = makeSurface('left', -4);
    const right = makeSurface('right', 4);
    // A marker child poking past the left hemisphere's medial wall.
    const marker = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial());
    marker.position.set(1.5, 0, 0);
    left.mesh.add(marker);
    // An inactive morph target that would extend the right hemisphere medially.
    const positions = right.mesh.geometry.getAttribute('position');
    const shifted = new Float32Array(positions.array.length);
    for (let i = 0; i < shifted.length; i += 3) shifted[i] = -3;
    right.mesh.geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(shifted, 3)];
    right.mesh.geometry.morphTargetsRelative = true;
    right.mesh.geometry.computeBoundingBox();
    right.mesh.updateMorphTargets();
    right.mesh.morphTargetInfluences![0] = 0;
    const viewer = makeViewer(left, right);

    viewer.setAnatomicalView('dorsal', { layout: 'paired', groupId: 'cortex', hemisphereGap: 4 });
    // Cortex boxes are 2 wide, so the medial edges at -2 / +2 put the centres
    // at -3 / +3. Measuring the marker would give -4.5, the morph union +6.
    expect(left.mesh.position.x).toBeCloseTo(-3, 10);
    expect(right.mesh.position.x).toBeCloseTo(3, 10);
  });

  it('is idempotent and leaves meshes in place when no gap is requested', () => {
    const left = makeSurface('left', -4);
    const right = makeSurface('right', 4);
    const viewer = makeViewer(left, right);
    viewer.setAnatomicalView('lateral', { layout: 'paired', groupId: 'cortex', hemisphereGap: 2 });
    const once = [left.mesh.position.x, right.mesh.position.x];
    viewer.setAnatomicalView('medial', { layout: 'paired', groupId: 'cortex', hemisphereGap: 2 });
    expect([left.mesh.position.x, right.mesh.position.x]).toEqual(once);
    expect(once).toEqual([-2, 2]);

    viewer.setAnatomicalView('lateral', { layout: 'paired', groupId: 'cortex' });
    expect([left.mesh.position.x, right.mesh.position.x]).toEqual(once);
  });
});

describe('exported annotation labels follow moved surfaces', () => {
  it('projects the annotated vertex in world space', () => {
    const viewer = borrowViewer();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    mesh.position.set(3, 0, 0); // e.g. moved by a paired hemisphereGap
    mesh.updateMatrixWorld(true);
    viewer.surfaces = new Map([['lh', { mesh }]]);
    viewer.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    viewer.camera.position.set(0, 0, 10);
    viewer.camera.updateMatrixWorld(true);
    viewer.width = 200;
    viewer.height = 200;
    viewer.annotations = {
      list: () => [{ id: 'a', surfaceId: 'lh', position: new THREE.Vector3(1, 0, 0), data: { label: 'A' } }]
    };
    const [label] = viewer.annotationLabelsForExport();
    // World x = 4 of a 20-unit-wide view across 200 px.
    expect(label).toMatchObject({ text: 'A', x: 140, y: 100 });
  });
});

describe('per-annotation colours', () => {
  function setup() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const viewer = new EventEmitter<ViewerEventMap>() as any;
    viewer.scene = new THREE.Scene();
    viewer.getSurface = (surfaceId: string) => surfaceId === 'lh' ? { mesh } : undefined;
    viewer.requestRender = vi.fn();
    return new AnnotationManager(viewer, { colorOn: 0x00ff00, colorOff: 0xff0000 });
  }

  const hex = (manager: AnnotationManager, id: string) =>
    (manager.get(id)!.marker.material as THREE.MeshBasicMaterial).color.getHex();

  it('honours colorOn and colorOff in add() and across activation changes', () => {
    const manager = setup();
    const custom = manager.add('lh', 0, undefined, { colorOn: 0x0000ff, colorOff: 0x333333 })!;
    const plain = manager.add('lh', 1)!;
    expect(hex(manager, custom)).toBe(0x333333);
    expect(hex(manager, plain)).toBe(0xff0000);

    manager.activate(custom);
    expect(hex(manager, custom)).toBe(0x0000ff);
    manager.activate(plain);
    expect(hex(manager, custom)).toBe(0x333333);
    expect(hex(manager, plain)).toBe(0x00ff00);
  });

  it('starts an active annotation in its own colorOn', () => {
    const manager = setup();
    const id = manager.add('lh', 2, undefined, { colorOn: 0x123456, active: true })!;
    expect(hex(manager, id)).toBe(0x123456);
  });

  it('keeps non-exclusively activated annotations in their active colour', () => {
    const manager = setup();
    const first = manager.add('lh', 0, undefined, { colorOn: 0x0000ff })!;
    const second = manager.add('lh', 1)!;
    manager.activate(first);
    manager.activate(second, { exclusive: false });
    expect(manager.get(first)!.active).toBe(true);
    expect(hex(manager, first)).toBe(0x0000ff);
    expect(hex(manager, second)).toBe(0x00ff00);
  });

  it('rejects invalid per-annotation colours', () => {
    const manager = setup();
    expect(() => manager.add('lh', 0, undefined, { colorOn: -1 })).toThrow();
  });
});

describe('hover throttle delivers the final pointer position', () => {
  function hoverViewer() {
    const viewer = borrowViewer();
    viewer.crosshair = new CrosshairManager(() => {});
    viewer.config = { hoverCrosshair: false };
    viewer.renderer = {
      domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }
    };
    viewer.pickingController = {
      updateScreenPosition: vi.fn(),
      getIntersectionPoint: () => new THREE.Vector3()
    };
    viewer.mouse = new THREE.Vector2();
    viewer.getIntersectionPoint = () => new THREE.Vector3();
    viewer.pick = vi.fn(() => ({ surfaceId: null, vertexIndex: null, point: null }));
    return viewer;
  }

  const move = (x: number) => ({ clientX: x, clientY: 10 }) as MouseEvent;

  it('runs a trailing hover with the last position after the throttle window', () => {
    vi.useFakeTimers();
    const viewer = hoverViewer();
    const hovers: number[] = [];
    viewer.on('vertex:hover', (event: { screenX: number }) => hovers.push(event.screenX));

    viewer.onMouseMoveHandler(move(1));
    viewer.onMouseMoveHandler(move(2));
    viewer.onMouseMoveHandler(move(3));
    expect(hovers).toEqual([1]);

    vi.advanceTimersByTime(100);
    expect(hovers).toEqual([1, 3]);
    vi.advanceTimersByTime(500);
    expect(hovers).toEqual([1, 3]);
  });

  it('cancels a pending trailing hover on dispose', () => {
    vi.useFakeTimers();
    const crosshair = new CrosshairManager(() => {});
    const run = vi.fn();
    crosshair.scheduleHoverUpdate(run);
    crosshair.scheduleHoverUpdate(run);
    expect(run).toHaveBeenCalledOnce();
    crosshair.dispose();
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('public type exports', () => {
  it('exports the viewer config and loader hemisphere types', () => {
    expectTypeOf<NeuroSurfaceViewerConfig>().toEqualTypeOf<
      NonNullable<ConstructorParameters<typeof NeuroSurfaceViewer>[3]>
    >();
    expectTypeOf<Hemisphere>().toEqualTypeOf<NonNullable<Parameters<typeof loadSurface>[2]>>();
  });
});
