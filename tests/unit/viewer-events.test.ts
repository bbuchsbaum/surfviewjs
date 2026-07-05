import { afterEach, describe, it, expect, expectTypeOf, vi } from 'vitest';
import * as THREE from 'three';
import { EventEmitter } from '../../src/EventEmitter';
import { AnnotationManager } from '../../src/annotations';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import { SurfaceGeometry } from '../../src/classes';
import { DataLayer } from '../../src/layers';
import type { TimelineEventMap } from '../../src/temporal';
import type { AnnotationEvent, LayerEvent, LayerUpdatedEvent, ParcelSelectionEvent, ViewerEventMap } from '../../src/events';

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
