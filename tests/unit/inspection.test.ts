import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventEmitter } from '../../src/EventEmitter';
import {
  NO_INSPECTION_SELECTION
} from '../../src/Inspection';
import type {
  InspectionSelection,
  InspectionSelectionChangedEvent,
  VertexInspection
} from '../../src/Inspection';
import { DataLayer, Layer } from '../../src/layers';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import type { ParcelData } from '../../src/parcellation';
import { SurfaceGeometry } from '../../src/classes';
import type { ViewerEventMap, ViewerStateChangedEvent } from '../../src/events';
import { ParcelSurface } from '../../src/surfaces/ParcelSurface';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

function makeGeometry(hemisphere = 'left'): SurfaceGeometry {
  return new SurfaceGeometry(
    new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 2, 0,
      0, 0, 3
    ]),
    new Uint32Array([
      0, 1, 2,
      0, 2, 3
    ]),
    hemisphere,
    null,
    false
  );
}

function makeViewer(
  surfaces: readonly [string, MultiLayerNeuroSurface][]
): NeuroSurfaceViewer {
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
  viewer.inspectionSelection = NO_INSPECTION_SELECTION;
  viewer.surfaces = new Map(surfaces);
  viewer.scene = new THREE.Scene();
  for (const [, surface] of surfaces) {
    if (surface.mesh) viewer.scene.add(surface.mesh);
  }
  viewer.gpuPicker = null;
  viewer.selectedSurfaceId = null;
  viewer.selectedLayerId = null;
  viewer.crosshair = {
    visible: false,
    mode: null,
    show: vi.fn(),
    hide: vi.fn()
  };
  viewer.showCrosshair = vi.fn();
  viewer.hideCrosshair = vi.fn();
  viewer.annotations = { removeBySurface: vi.fn() };
  viewer.requestRender = vi.fn();
  return viewer;
}

function parcelData(): ParcelData {
  return {
    schema_version: '1.0',
    atlas: {
      id: 'toy-atlas',
      name: 'Toy Atlas',
      representation: 'surface',
      confidence: 'exact',
      n_parcels: 2
    },
    parcels: [
      { id: 1, label: 'Visual', hemi: 'left', value: 2.5 },
      { id: 2, label: 'Motor', hemi: 'left', value: Number.NaN }
    ]
  };
}

describe('DataLayer vertex sampling', () => {
  it('samples dense values and returns null for missing and out-of-domain vertices', () => {
    const layer = new DataLayer(
      'dense',
      new Float32Array([1.5, Number.NaN, -2, Number.POSITIVE_INFINITY]),
      null,
      'viridis'
    );
    layer._setDataSummaryDomainSize(4);

    expect(layer.sampleValueAtVertex(0)).toBeCloseTo(1.5);
    expect(layer.sampleValueAtVertex(1)).toBeNull();
    expect(layer.sampleValueAtVertex(2)).toBe(-2);
    expect(layer.sampleValueAtVertex(3)).toBeNull();
    expect(layer.sampleValueAtVertex(4)).toBeNull();
    expect(layer.sampleValueAtVertex(-1)).toBeNull();
    expect(layer.sampleValueAtVertex(1.5)).toBeNull();
  });

  it('samples indexed sparse values without exposing or misreading private indices', () => {
    const layer = new DataLayer(
      'sparse',
      new Float32Array([10, 20, 30]),
      new Uint32Array([3, 1, 3]),
      'viridis'
    );
    layer._setDataSummaryDomainSize(5);

    expect(layer.sampleValueAtVertex(0)).toBeNull();
    expect(layer.sampleValueAtVertex(1)).toBe(20);
    expect(layer.sampleValueAtVertex(2)).toBeNull();
    expect(layer.sampleValueAtVertex(3)).toBe(30);
    expect(layer.sampleValueAtVertex(4)).toBeNull();

    layer.setData([7], [4]);
    expect(layer.sampleValueAtVertex(3)).toBeNull();
    expect(layer.sampleValueAtVertex(4)).toBe(7);

    layer.dispose();
    expect(layer.sampleValueAtVertex(4)).toBeNull();
  });
});

describe('vertex inspection snapshots', () => {
  it('returns world coordinates and ordered dense/sparse values as immutable plain data', () => {
    const surface = new MultiLayerNeuroSurface(makeGeometry());
    surface.addLayer(new DataLayer('dense', [1, 2, 3, 4], null, 'viridis', {
      presentation: { label: 'Dense statistic', units: 'z' }
    }));
    surface.addLayer(new DataLayer('sparse', [9], [2], 'magma', {
      presentation: { label: 'Sparse statistic', units: 't' }
    }));
    surface.mesh!.position.set(10, -2, 5);
    surface.mesh!.updateMatrixWorld(true);
    const viewer = makeViewer([['lh', surface]]);

    const inspection = viewer.inspectVertex('lh', 1);

    expect(inspection).toEqual({
      surfaceId: 'lh',
      vertexIndex: 1,
      world: [11, -2, 5],
      values: [
        {
          layerId: 'dense',
          label: 'Dense statistic',
          value: 2,
          units: 'z',
          missing: false
        },
        {
          layerId: 'sparse',
          label: 'Sparse statistic',
          value: null,
          units: 't',
          missing: true
        }
      ]
    });
    expect(Object.isFrozen(inspection)).toBe(true);
    expect(Object.isFrozen(inspection!.world)).toBe(true);
    expect(Object.isFrozen(inspection!.values)).toBe(true);
    expect(inspection!.values.every(Object.isFrozen)).toBe(true);
    expect(inspection!.world).not.toBeInstanceOf(THREE.Vector3);
    expect(ArrayBuffer.isView(inspection!.world)).toBe(false);
    expect(inspection!.values.some(value => value instanceof Layer)).toBe(false);
    expect(JSON.parse(JSON.stringify(inspection))).toEqual(inspection);
  });

  it('returns null for absent, invalid, and disposed viewer targets', () => {
    const surface = new MultiLayerNeuroSurface(makeGeometry());
    const viewer = makeViewer([['lh', surface]]);

    expect(viewer.inspectVertex('missing', 0)).toBeNull();
    expect(viewer.inspectVertex('lh', -1)).toBeNull();
    expect(viewer.inspectVertex('lh', 4)).toBeNull();
    (viewer as any).disposed = true;
    expect(viewer.inspectVertex('lh', 0)).toBeNull();
  });

  it('adds parcel and atlas descriptors only for a parcel-capable surface', () => {
    const parcelSurface = new ParcelSurface(makeGeometry(), {
      parcelData: parcelData(),
      vertexLabels: [1, 1, 2, 0]
    });
    parcelSurface.addLayer(new DataLayer('stat', [4, 5, Number.NaN, 8], null, 'viridis', {
      presentation: { label: 'Statistic', units: 'a.u.' }
    }));
    const plainSurface = new MultiLayerNeuroSurface(makeGeometry());
    const viewer = makeViewer([
      ['parcel', parcelSurface],
      ['plain', plainSurface]
    ]);

    expect(viewer.inspectVertex('parcel', 0)).toMatchObject({
      parcel: { id: 1, label: 'Visual' },
      atlas: { id: 'toy-atlas', name: 'Toy Atlas' }
    });
    expect(viewer.inspectVertex('parcel', 2)).toMatchObject({
      parcel: { id: 2, label: 'Motor' },
      values: [{
        layerId: 'stat',
        label: 'Statistic',
        units: 'a.u.',
        value: null,
        missing: true
      }]
    });
    expect(viewer.inspectVertex('parcel', 3)).not.toHaveProperty('parcel');
    expect(viewer.inspectVertex('parcel', 3)).toHaveProperty('atlas.id', 'toy-atlas');
    expect(viewer.inspectVertex('plain', 0)).not.toHaveProperty('parcel');
    expect(viewer.inspectVertex('plain', 0)).not.toHaveProperty('atlas');
  });
});

describe('scientific inspection selection', () => {
  it('emits immutable selection changes independently of panel-layer focus', () => {
    const surface = new MultiLayerNeuroSurface(makeGeometry());
    const viewer = makeViewer([['lh', surface]]);
    viewer.selectedLayerId = 'panel-focus-only';
    const changes: InspectionSelectionChangedEvent[] = [];
    const revisions: ViewerStateChangedEvent[] = [];
    viewer.on('selection:changed', event => changes.push(event));
    viewer.on('state:changed', event => revisions.push(event));

    const first = viewer.setInspectionSelection({
      kind: 'vertex',
      surfaceId: 'lh',
      vertexIndex: 2
    });
    expect(first).toEqual({
      ok: true,
      changed: true,
      selection: { kind: 'vertex', surfaceId: 'lh', vertexIndex: 2 }
    });
    expect(Object.isFrozen(first.ok && first.selection)).toBe(true);
    expect(viewer.selectedLayerId).toBe('panel-focus-only');
    expect(changes).toEqual([{
      previous: { kind: 'none' },
      selection: { kind: 'vertex', surfaceId: 'lh', vertexIndex: 2 }
    }]);
    expect(revisions).toEqual([{ revision: 1, domains: ['selection'] }]);

    expect(viewer.setInspectionSelection({
      kind: 'vertex', surfaceId: 'lh', vertexIndex: 2
    })).toMatchObject({ ok: true, changed: false });
    expect(changes).toHaveLength(1);

    expect(viewer.setInspectionSelection({
      kind: 'vertex', surfaceId: 'lh', vertexIndex: 10
    })).toMatchObject({ ok: false, code: 'invalid-vertex' });
    expect(viewer.getInspectionSelection()).toEqual({
      kind: 'vertex', surfaceId: 'lh', vertexIndex: 2
    });
    expect(revisions).toHaveLength(1);

    expect(viewer.clearInspectionSelection()).toEqual({
      ok: true,
      changed: true,
      selection: { kind: 'none' }
    });
    expect(changes[1]).toEqual({
      previous: { kind: 'vertex', surfaceId: 'lh', vertexIndex: 2 },
      selection: { kind: 'none' }
    });
  });

  it('validates parcel selections and derives representative vertex and atlas IDs', () => {
    const surface = new ParcelSurface(makeGeometry(), {
      parcelData: parcelData(),
      vertexLabels: [1, 1, 2, 0]
    });
    const viewer = makeViewer([['parcel', surface]]);

    const selected = viewer.setInspectionSelection({
      kind: 'parcel',
      surfaceId: 'parcel',
      parcelId: 1
    });
    expect(selected).toMatchObject({
      ok: true,
      changed: true,
      selection: {
        kind: 'parcel',
        surfaceId: 'parcel',
        parcelId: 1,
        atlasId: 'toy-atlas'
      }
    });
    if (!selected.ok || selected.selection.kind !== 'parcel') {
      throw new Error('parcel selection failed');
    }
    expect(selected.selection.representativeVertexIndex).toBeTypeOf('number');

    const beforeInvalid = viewer.getInspectionSelection();
    expect(viewer.setInspectionSelection({
      kind: 'parcel', surfaceId: 'parcel', parcelId: 99
    })).toMatchObject({ ok: false, code: 'parcel-not-found' });
    expect(viewer.setInspectionSelection({
      kind: 'parcel', surfaceId: 'parcel', parcelId: 1, atlasId: 'wrong-atlas'
    })).toMatchObject({ ok: false, code: 'atlas-mismatch' });
    expect(viewer.setInspectionSelection({
      kind: 'parcel', surfaceId: 'parcel', parcelId: 1, representativeVertexIndex: 2
    })).toMatchObject({ ok: false, code: 'invalid-vertex' });
    expect(viewer.getInspectionSelection()).toBe(beforeInvalid);
  });

  it('keeps crosshair rendering opt-in and clears selection when its surface is removed', () => {
    const surface = new MultiLayerNeuroSurface(makeGeometry());
    const viewer = makeViewer([['lh', surface]]);

    viewer.setInspectionSelection({ kind: 'vertex', surfaceId: 'lh', vertexIndex: 1 });
    viewer.clearParcelSelection({ emitEvent: false });
    expect(viewer.getInspectionSelection()).toEqual({
      kind: 'vertex', surfaceId: 'lh', vertexIndex: 1
    });
    expect(viewer.showCrosshair).not.toHaveBeenCalled();
    viewer.setInspectionSelection(
      { kind: 'vertex', surfaceId: 'lh', vertexIndex: 1 },
      { showCrosshair: true }
    );
    expect(viewer.showCrosshair).toHaveBeenCalledWith('lh', 1, { mode: 'selection' });

    const changes: InspectionSelectionChangedEvent[] = [];
    const revisions: ViewerStateChangedEvent[] = [];
    viewer.on('selection:changed', event => changes.push(event));
    viewer.on('state:changed', event => revisions.push(event));
    const revision = viewer.getStateRevision();

    viewer.removeSurface('lh');

    expect(viewer.getInspectionSelection()).toBe(NO_INSPECTION_SELECTION);
    expect(changes).toEqual([{
      previous: { kind: 'vertex', surfaceId: 'lh', vertexIndex: 1 },
      selection: { kind: 'none' }
    }]);
    expect(revisions).toEqual([{
      revision: revision + 1,
      domains: ['surfaces', 'selection']
    }]);
  });

  it('returns a typed failure after disposal without changing selection', () => {
    const surface = new MultiLayerNeuroSurface(makeGeometry());
    const viewer = makeViewer([['lh', surface]]);
    (viewer as any).disposed = true;

    expect(viewer.setInspectionSelection({
      kind: 'vertex', surfaceId: 'lh', vertexIndex: 0
    })).toMatchObject({ ok: false, code: 'disposed' });
    expect(viewer.getInspectionSelection()).toBe(NO_INSPECTION_SELECTION);
  });

  it('exposes the event and result contracts through stable public types', () => {
    expectTypeOf<InspectionSelection>().toEqualTypeOf<
      | { readonly kind: 'none' }
      | { readonly kind: 'vertex'; readonly surfaceId: string; readonly vertexIndex: number }
      | {
          readonly kind: 'parcel';
          readonly surfaceId: string;
          readonly parcelId: number;
          readonly representativeVertexIndex?: number;
          readonly atlasId?: string;
        }
    >();
    expectTypeOf<VertexInspection['world']>().toEqualTypeOf<readonly [number, number, number]>();
  });
});
