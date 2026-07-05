/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from '../../src/EventEmitter';
import { FlatMapView } from '../../src/FlatMapView';
import { LinkedBrainWorkspace } from '../../src/LinkedBrainWorkspace';
import type { ViewerEventMap } from '../../src/events';
import type { TimelineEventMap } from '../../src/temporal';

function mockCanvas(): void {
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 1,
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: '',
    textBaseline: ''
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as any);
}

function makeGeometry() {
  return {
    surfaceId: 'lh',
    vertices: new Float32Array([
      -1, -1, 0,
      1, -1, 0,
      1, 1, 0,
      -1, 1, 0
    ]),
    faces: new Uint32Array([0, 1, 2, 0, 2, 3])
  };
}

class FakeViewer extends EventEmitter<ViewerEventMap> {
  showCrosshair = vi.fn();
  hideCrosshair = vi.fn();
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockCanvas();
});

describe('FlatMapView', () => {
  it('projects vertices and picks by shared vertex index', () => {
    const container = document.createElement('div');
    const flatmap = new FlatMapView(container, makeGeometry(), {
      width: 100,
      height: 100,
      padding: 0,
      autoRender: false
    });

    expect(flatmap.projectVertex(0)).toEqual({ x: 0, y: 100 });
    expect(flatmap.projectVertex(2)).toEqual({ x: 100, y: 0 });
    expect(flatmap.pickVertexAt(98, 2)).toBe(2);

    flatmap.dispose();
  });

  it('emits hover and selection events with map coordinates', () => {
    const container = document.createElement('div');
    const flatmap = new FlatMapView(container, makeGeometry(), {
      width: 100,
      height: 100,
      padding: 0,
      autoRender: false
    });
    const hovers: any[] = [];
    const selections: any[] = [];

    flatmap.on('vertex:hover', event => hovers.push(event));
    flatmap.on('selection:changed', event => selections.push(event));

    flatmap.setHover(1);
    flatmap.setSelection(1);

    expect(hovers[0]).toMatchObject({ surfaceId: 'lh', vertexIndex: 1, mapX: 100, mapY: 100 });
    expect(selections[0]).toEqual({ surfaceId: 'lh', vertexIndex: 1 });

    flatmap.dispose();
  });

  it('creates ROI vertex sets from flatmap polygons and keeps indices stable across geometry updates', () => {
    const container = document.createElement('div');
    const flatmap = new FlatMapView(container, makeGeometry(), {
      width: 100,
      height: 100,
      padding: 0,
      autoRender: false
    });
    const created: any[] = [];
    flatmap.on('roi:created', event => created.push(event));

    const roi = flatmap.createROIFromPolygon([
      { x: 80, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 20 },
      { x: 80, y: 20 }
    ], {
      name: 'corner_roi',
      color: '#ffcc00',
      provenance: { sourceLayer: 'activation' }
    });

    expect(roi?.vertexIndices).toEqual([2]);
    expect(created[0].roi.name).toBe('corner_roi');

    flatmap.setGeometry({
      surfaceId: 'lh',
      vertices: new Float32Array([
        -2, -2, 0,
        2, -2, 0,
        2, 2, 0,
        -2, 2, 0
      ]),
      faces: new Uint32Array([0, 1, 2, 0, 2, 3])
    });

    expect(flatmap.rois.get(roi!.id)?.vertexIndices).toEqual([2]);

    flatmap.dispose();
  });

  it('supports programmatic polygon drawing finalization', () => {
    const flatmap = new FlatMapView(document.createElement('div'), makeGeometry(), {
      width: 100,
      height: 100,
      padding: 0,
      autoRender: false
    });

    flatmap.startROIDrawing({ mode: 'polygon', name: 'drawn_roi' });
    (flatmap as any).drawingPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];
    const roi = flatmap.finishROIDrawing();

    expect(roi?.name).toBe('drawn_roi');
    expect(roi?.vertexIndices).toEqual([0, 1, 2, 3]);

    flatmap.dispose();
  });
});

describe('LinkedBrainWorkspace', () => {
  it('syncs viewer hover events into the flatmap', () => {
    const flatmap = new FlatMapView(document.createElement('div'), makeGeometry(), {
      width: 100,
      height: 100,
      padding: 0,
      autoRender: false
    });
    const viewer = new FakeViewer();
    const workspace = new LinkedBrainWorkspace({ viewer, flatmap, surfaceId: 'lh' });

    viewer.emit('vertex:hover', {
      surfaceId: 'lh',
      vertexIndex: 2,
      screenX: 10,
      screenY: 20
    });

    expect(flatmap.hoverVertexIndex).toBe(2);

    workspace.dispose();
    flatmap.dispose();
  });

  it('syncs flatmap selection back to the viewer crosshair', () => {
    const flatmap = new FlatMapView(document.createElement('div'), makeGeometry(), {
      width: 100,
      height: 100,
      padding: 0,
      autoRender: false
    });
    const viewer = new FakeViewer();
    const workspace = new LinkedBrainWorkspace({ viewer, flatmap, surfaceId: 'lh' });

    flatmap.setSelection(3);

    expect(viewer.showCrosshair).toHaveBeenCalledWith('lh', 3, { mode: 'selection' });

    workspace.dispose();
    flatmap.dispose();
  });

  it('syncs layer and time state into the flatmap', () => {
    const flatmap = new FlatMapView(document.createElement('div'), makeGeometry(), {
      width: 100,
      height: 100,
      padding: 0,
      autoRender: false
    });
    const viewer = new FakeViewer();
    const timeline = new EventEmitter<TimelineEventMap>();
    const workspace = new LinkedBrainWorkspace({ viewer, flatmap, timeline, surfaceId: 'lh' });

    viewer.emit('layer:opacity', {
      surfaceId: 'lh',
      layerId: 'activation',
      opacity: 0.4
    });
    timeline.emit('timechange', {
      time: 1.25,
      frameA: 1,
      frameB: 2,
      alpha: 0.25
    });

    expect(flatmap.layerState.get('activation')).toEqual({ opacity: 0.4 });
    expect(flatmap.currentTime).toBe(1.25);

    workspace.dispose();
    flatmap.dispose();
  });
});
