import { afterEach, describe, it, expect, expectTypeOf, vi } from 'vitest';
import * as THREE from 'three';
import { EventEmitter } from '../../src/EventEmitter';
import { AnnotationManager } from '../../src/annotations';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import { SurfaceGeometry } from '../../src/classes';
import { DataLayer } from '../../src/layers';
import { PluginHost } from '../../src/PluginHost';
import { TemporalDataLayer } from '../../src/temporal/TemporalDataLayer';
import type { TimelineEventMap } from '../../src/temporal';
import type {
  AnnotationEvent,
  LayerEvent,
  LayerReorderedEvent,
  LayerUpdatedEvent,
  ParcelSelectionEvent,
  ViewerEventMap,
  ViewerStateChangedEvent
} from '../../src/events';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeSurfaceGeometry(): SurfaceGeometry {
  return new SurfaceGeometry(
    new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]),
    new Uint32Array([0, 1, 2]),
    'left'
  );
}

function makeObservableViewer(): NeuroSurfaceViewer {
  const viewer = new EventEmitter<ViewerEventMap>() as any;
  Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
  viewer.disposed = false;
  viewer.initializationFailed = false;
  viewer.stateRevision = 0;
  viewer.stateChangeBatchDepth = 0;
  viewer.pendingStateDomains = new Set();
  viewer.surfaceSubscriptions = new Map();
  viewer.container = {} as HTMLElement;
  viewer.surfaces = new Map();
  viewer.scene = new THREE.Scene();
  viewer.width = 400;
  viewer.height = 300;
  viewer.renderer = { getPixelRatio: () => 1 };
  viewer.config = {
    useShaders: false,
    rimStrength: 0,
    initialZoom: 12,
    hoverCrosshairSize: 1.2,
    hoverCrosshairColor: 0x66ccff
  };
  viewer.viewpoint = 'lateral';
  viewer.rimStrengthUniforms = [];
  viewer.gpuPicker = null;
  viewer.selectedLayerId = null;
  viewer.selectedSurfaceId = null;
  viewer.cameraInteractionEnabled = true;
  viewer.cameraControls = { enabled: true };
  viewer.ambientLight = new THREE.AmbientLight(0xffffff);
  viewer.crosshair = {
    visible: false,
    surfaceId: null,
    size: 1,
    color: 0xffffff,
    show: vi.fn(),
    hide: vi.fn(),
    toggle: vi.fn()
  };
  viewer.annotations = { removeBySurface: vi.fn() };
  viewer.centerCamera = vi.fn();
  viewer.setViewpoint = vi.fn();
  viewer.requestRender = vi.fn();
  viewer.plugins = new PluginHost(viewer);
  return viewer;
}

describe('typed event maps', () => {
  it('supports payload-free viewer events', () => {
    const emitter = new EventEmitter<ViewerEventMap>();
    const renderNeeded = vi.fn();

    emitter.on('render:needed', renderNeeded);
    emitter.emit('render:needed');

    expect(renderNeeded).toHaveBeenCalledOnce();
  });

  it('supports stable viewer layer payloads', () => {
    const emitter = new EventEmitter<ViewerEventMap>();
    const opacityChanged = vi.fn();

    emitter.on('layer:opacity', (event) => {
      expectTypeOf(event.surfaceId).toEqualTypeOf<string>();
      expectTypeOf(event.layerId).toEqualTypeOf<string>();
      expectTypeOf(event.opacity).toEqualTypeOf<number>();
      opacityChanged(event.opacity);
    });

    emitter.emit('layer:opacity', {
      surfaceId: 'lh',
      layerId: 'zstat',
      opacity: 0.65
    });

    expect(opacityChanged).toHaveBeenCalledWith(0.65);
  });

  it('types annotation payload aliases alongside the annotation record', () => {
    const emitter = new EventEmitter<ViewerEventMap>();

    emitter.on('annotation:added', (event) => {
      expectTypeOf(event.id).toEqualTypeOf<string>();
      expectTypeOf(event.surfaceId).toEqualTypeOf<string>();
      expectTypeOf(event.vertexIndex).toEqualTypeOf<number>();
      expectTypeOf(event.active).toEqualTypeOf<boolean>();
      expectTypeOf(event.annotation.id).toEqualTypeOf<string>();
    });
  });

  it('types timeline playback events', () => {
    const emitter = new EventEmitter<TimelineEventMap>();
    const seen = vi.fn();
    const play = vi.fn();

    emitter.on('timechange', (event) => {
      expectTypeOf(event.time).toEqualTypeOf<number>();
      expectTypeOf(event.frameA).toEqualTypeOf<number>();
      expectTypeOf(event.frameB).toEqualTypeOf<number>();
      expectTypeOf(event.alpha).toEqualTypeOf<number>();
      seen(event.frameA, event.frameB);
    });
    emitter.on('play', play);

    emitter.emit('timechange', {
      time: 0.5,
      frameA: 0,
      frameB: 1,
      alpha: 0.5
    });
    emitter.emit('play');

    expect(seen).toHaveBeenCalledWith(0, 1);
    expect(play).toHaveBeenCalledOnce();
  });
});

describe('runtime event flows', () => {
  it('emits layer lifecycle events from multilayer surfaces', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const surface = new MultiLayerNeuroSurface(makeSurfaceGeometry());
    const layer = new DataLayer('activation', new Float32Array([0, 0.5, 1]), null, 'viridis');
    const added: LayerEvent[] = [];
    const updated: LayerUpdatedEvent[] = [];
    const removed: LayerEvent[] = [];

    surface.on('layer:added', (event) => added.push({
      surfaceId: 'lh',
      layerId: event.layer.id,
      layer: event.layer
    }));
    surface.on('layer:updated', (event) => updated.push({
      surfaceId: 'lh',
      layerId: event.layer?.id ?? '',
      layer: event.layer
    }));
    surface.on('layer:removed', (event) => removed.push({
      surfaceId: 'lh',
      layerId: event.layerId,
      layer: null
    }));

    surface.addLayer(layer);
    surface.updateLayer('activation', { opacity: 0.5 });
    surface.removeLayer('activation');

    expect(added.map(event => event.layerId)).toEqual(['activation']);
    expect(updated.map(event => event.layerId)).toEqual(['activation']);
    expect(removed.map(event => event.layerId)).toEqual(['activation']);
  });

  it('emits annotation events with scalar aliases and annotation records', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(makeSurfaceGeometry().vertices, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const viewer = new EventEmitter<ViewerEventMap>() as any;
    viewer.scene = new THREE.Scene();
    viewer.getSurface = (surfaceId: string) => surfaceId === 'lh' ? { mesh } : undefined;
    viewer.requestRender = vi.fn();

    const manager = new AnnotationManager(viewer);
    const added: AnnotationEvent[] = [];
    const moved: AnnotationEvent[] = [];
    const activated: AnnotationEvent[] = [];
    const removed: AnnotationEvent[] = [];
    const reset = vi.fn();

    viewer.on('annotation:added', (event: AnnotationEvent) => added.push(event));
    viewer.on('annotation:moved', (event: AnnotationEvent) => moved.push(event));
    viewer.on('annotation:activated', (event: AnnotationEvent) => activated.push(event));
    viewer.on('annotation:removed', (event: AnnotationEvent) => removed.push(event));
    viewer.on('annotation:reset', reset);

    const id = manager.add('lh', 0);
    expect(id).toBeTruthy();
    manager.move(id!, 1);
    manager.activate(id!);
    manager.remove(id!);
    manager.reset();

    expect(added[0]).toMatchObject({ id, surfaceId: 'lh', vertexIndex: 0, active: false });
    expect(added[0].annotation.id).toBe(id);
    expect(moved[0]).toMatchObject({ id, surfaceId: 'lh', vertexIndex: 1 });
    expect(activated[0]).toMatchObject({ id, surfaceId: 'lh', vertexIndex: 1, active: true });
    expect(removed[0]).toMatchObject({ id, surfaceId: 'lh', vertexIndex: 1 });
    expect(reset).toHaveBeenCalledOnce();
  });

  it('emits parcel selection events through the viewer parcel API', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(makeSurfaceGeometry().vertices, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld();

    const viewer = new EventEmitter<ViewerEventMap>() as any;
    Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
    viewer.surfaces = new Map([
      ['parcel-surface', {
        mesh,
        getRepresentativeVertexIndex: () => 1,
        getParcelRecord: (parcelId: number) => ({ id: parcelId, label: 'V1' }),
        getParcelData: () => ({ atlas: { id: 'wang2015' } })
      }]
    ]);
    viewer.crosshair = { mode: 'selection' };
    viewer.config = {};
    viewer.requestRender = vi.fn();
    viewer.showCrosshair = vi.fn();
    viewer.hideCrosshair = vi.fn();

    const selections: ParcelSelectionEvent[] = [];
    viewer.on('parcel:selected', (event: ParcelSelectionEvent) => selections.push(event));

    expect(viewer.setParcelSelection('parcel-surface', 42, { showCrosshair: false })).toBe(true);
    viewer.clearParcelSelection();

    expect(selections[0]).toMatchObject({
      surfaceId: 'parcel-surface',
      vertexIndex: 1,
      parcelId: 42,
      parcelLabel: 'V1',
      atlasId: 'wang2015',
      selected: true
    });
    expect(selections[1]).toMatchObject({
      surfaceId: null,
      vertexIndex: null,
      parcelId: null,
      selected: false
    });
  });
});

describe('viewer state revisions', () => {
  it('forwards canonical layer reorder events and one layers-domain revision', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const viewer = makeObservableViewer();
    const surface = new MultiLayerNeuroSurface(makeSurfaceGeometry());
    surface.addLayer(new DataLayer('first', new Float32Array([1, 2, 3]), null, 'viridis'));
    surface.addLayer(new DataLayer('second', new Float32Array([3, 2, 1]), null, 'viridis'));
    viewer.addSurface(surface, 'lh');

    const reordered: LayerReorderedEvent[] = [];
    const revisions: ViewerStateChangedEvent[] = [];
    viewer.on('layer:reordered', event => reordered.push(event));
    viewer.on('state:changed', event => revisions.push(event));
    const previousRevision = viewer.getStateRevision();

    const result = viewer.moveLayer('lh', 'second', 1);

    expect(result).toEqual({
      ok: true,
      changed: true,
      order: ['base', 'second', 'first']
    });
    expect(reordered).toEqual([{
      surfaceId: 'lh',
      order: ['base', 'second', 'first'],
      previousOrder: ['base', 'first', 'second'],
      movedLayerId: 'second'
    }]);
    expect(revisions).toEqual([{
      revision: previousRevision + 1,
      domains: ['layers']
    }]);
  });

  it('covers control-relevant mutation domains without treating render requests as state', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const viewer = makeObservableViewer();
    const surface = new MultiLayerNeuroSurface(makeSurfaceGeometry());
    const layer = new DataLayer('activation', new Float32Array([0, 0.5, 1]), null, 'viridis');
    surface.addLayer(layer);
    viewer.addSurface(surface, 'lh');

    const changes: ViewerStateChangedEvent[] = [];
    viewer.on('state:changed', event => changes.push(event));
    const expectMutation = (operation: () => void, domains: ViewerStateChangedEvent['domains']) => {
      const previousRevision = viewer.getStateRevision();
      operation();
      expect(changes.at(-1)).toEqual({
        revision: previousRevision + 1,
        domains
      });
    };

    expectMutation(() => viewer.setInteractionEnabled(false), ['camera']);
    expectMutation(() => viewer.separateHemispheres(10), ['surfaces']);
    expectMutation(() => surface.setVisible(false), ['surfaces', 'appearance']);
    expectMutation(() => viewer.updateAmbientLight(0x123456), ['appearance']);
    expectMutation(() => viewer.showCrosshair('lh', 1), ['selection']);
    expectMutation(() => layer.setOpacity(0.4), ['layers']);

    const revision = viewer.getStateRevision();
    viewer.requestRender();
    viewer.emit('render:needed');
    expect(viewer.getStateRevision()).toBe(revision);
  });

  it('forwards direct layer setters with changed properties and monotonic revisions', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const viewer = makeObservableViewer();
    const surface = new MultiLayerNeuroSurface(makeSurfaceGeometry());
    const layer = new DataLayer('activation', new Float32Array([0, 0.5, 1]), null, 'viridis');
    surface.addLayer(layer);
    viewer.addSurface(surface, 'lh');

    const updates: LayerUpdatedEvent[] = [];
    const revisions: ViewerStateChangedEvent[] = [];
    viewer.on('layer:updated', event => updates.push(event));
    viewer.on('state:changed', event => revisions.push(event));

    layer.setOpacity(0.25);
    layer.setRange([-2, 2]);

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      surfaceId: 'lh',
      layerId: 'activation',
      changes: { opacity: 0.25 }
    });
    expect(updates[1]).toMatchObject({
      surfaceId: 'lh',
      layerId: 'activation',
      changes: { range: [-2, 2] }
    });
    expect(revisions.map(event => event.domains)).toEqual([['layers'], ['layers']]);
    expect(revisions[1].revision).toBe(revisions[0].revision + 1);
  });

  it('coalesces compound layer updates and reports all affected domains deterministically', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const viewer = makeObservableViewer();
    const surface = new MultiLayerNeuroSurface(makeSurfaceGeometry());
    const layer = new DataLayer('activation', new Float32Array([0, 0.5, 1]), null, 'viridis');
    surface.addLayer(layer);
    viewer.addSurface(surface, 'lh');

    const updates: LayerUpdatedEvent[] = [];
    const revisions: ViewerStateChangedEvent[] = [];
    viewer.on('layer:updated', event => updates.push(event));
    viewer.on('state:changed', event => revisions.push(event));
    const baseline = viewer.getStateRevision();

    viewer.updateLayer('lh', 'activation', {
      opacity: 0.5,
      range: [-1, 1],
      threshold: [-0.2, 0.2]
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].changes).toEqual({
      range: [-1, 1],
      threshold: [-0.2, 0.2],
      opacity: 0.5
    });
    expect(revisions).toEqual([{ revision: baseline + 1, domains: ['layers'] }]);
  });

  it('coalesces compound mutations across domains in canonical order', () => {
    const viewer = makeObservableViewer() as any;
    const changes: ViewerStateChangedEvent[] = [];
    viewer.on('state:changed', (event: ViewerStateChangedEvent) => changes.push(event));

    viewer.withStateChangeBatch(() => {
      viewer.invalidateState(['appearance', 'selection']);
      viewer.emit('controls:changed', { enabled: false });
      viewer.invalidateState(['surfaces']);
    });

    expect(changes).toEqual([{
      revision: 1,
      domains: ['camera', 'surfaces', 'selection', 'appearance']
    }]);
  });

  it('still invalidates coarse state when a specific-event subscriber throws', () => {
    const viewer = makeObservableViewer();
    const stateChanged = vi.fn();
    viewer.on('controls:changed', () => {
      throw new Error('subscriber failed');
    });
    viewer.on('state:changed', stateChanged);

    expect(() => viewer.emit('controls:changed', { enabled: false })).toThrow('subscriber failed');
    expect(stateChanged).toHaveBeenCalledWith({ revision: 1, domains: ['camera'] });
  });

  it('includes timeline when a temporal layer changes its displayed frame', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const viewer = makeObservableViewer();
    const surface = new MultiLayerNeuroSurface(makeSurfaceGeometry());
    const layer = new TemporalDataLayer(
      'bold',
      [new Float32Array([0, 1, 2]), new Float32Array([2, 3, 4])],
      [0, 1],
      'viridis',
      {}
    );
    surface.addLayer(layer);
    viewer.addSurface(surface, 'lh');

    const changes: ViewerStateChangedEvent[] = [];
    viewer.on('state:changed', event => changes.push(event));
    const baseline = viewer.getStateRevision();

    layer.setTime(0, 1, 0.5);

    expect(changes).toEqual([{
      revision: baseline + 1,
      domains: ['layers', 'timeline']
    }]);
  });

  it('observes direct surface disposal and removes the stale viewer registration', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const viewer = makeObservableViewer();
    const surface = new MultiLayerNeuroSurface(makeSurfaceGeometry());
    surface.addLayer(new DataLayer('activation', new Float32Array([0, 0.5, 1]), null, 'viridis'));
    viewer.addSurface(surface, 'lh');

    const changes: ViewerStateChangedEvent[] = [];
    viewer.on('state:changed', event => changes.push(event));
    const baseline = viewer.getStateRevision();

    surface.dispose();

    expect(viewer.getSurface('lh')).toBeUndefined();
    expect(changes).toEqual([{
      revision: baseline + 1,
      domains: ['surfaces', 'selection']
    }]);
  });

  it('stops viewer notifications after disposal', () => {
    const viewer = makeObservableViewer() as any;
    viewer.initializationFailed = true;
    const stateChanged = vi.fn();
    const controlsChanged = vi.fn();
    viewer.on('state:changed', stateChanged);
    viewer.on('controls:changed', controlsChanged);

    viewer.dispose();
    viewer.emit('controls:changed', { enabled: false });
    viewer.setInteractionEnabled(false);

    expect(stateChanged).not.toHaveBeenCalled();
    expect(controlsChanged).not.toHaveBeenCalled();
    expect(viewer.getStateRevision()).toBe(0);
  });
});
