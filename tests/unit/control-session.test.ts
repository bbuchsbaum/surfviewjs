import { describe, expect, it, vi } from 'vitest';
import {
  createSurfViewControlSession
} from '../../src';
import type {
  ControlCommandFailure,
  ControlCommandResult,
  FigureExportRequest,
  FigureExportResult,
  InspectionSelection,
  LayerControlAddress,
  ScalarMappingUpdate,
  SetAnatomicalViewRequest,
  SurfViewControlSessionSnapshot,
  SurfViewControlSnapshot,
  SurfViewControlSnapshotListener,
  SurfViewControlSubscription,
  SurfViewControlTarget
} from '../../src';
import type { BlendMode } from '../../src/layers';

const enabled = Object.freeze({ enabled: true });

interface LayerSpec {
  readonly id: string;
  readonly role?: 'anatomy' | 'data';
  readonly visible?: boolean;
  readonly opacity?: number;
}

interface SurfaceSpec {
  readonly id: string;
  readonly visible?: boolean;
  readonly layers: readonly LayerSpec[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function failure(
  code: ControlCommandFailure['code'],
  message: string
): ControlCommandFailure {
  return Object.freeze({ ok: false, code, message });
}

function makeSnapshot(
  revision: number,
  surfaces: readonly SurfaceSpec[]
): SurfViewControlSnapshot {
  return deepFreeze({
    revision,
    view: {
      current: null,
      anatomicalViews: [],
      targets: [],
      fit: enabled,
      reset: enabled
    },
    surfaces: surfaces.map(surface => ({
      id: surface.id,
      label: surface.id.toUpperCase(),
      hemisphere: surface.id === 'lh' ? 'left' : 'right',
      visible: surface.visible ?? true,
      groupId: 'cortex',
      layers: surface.layers.map((layer, index) => ({
        id: layer.id,
        surfaceId: surface.id,
        label: layer.id,
        index,
        role: layer.role ?? 'data',
        pinned: layer.role === 'anatomy' ? 'bottom' : null,
        reorderable: layer.role !== 'anatomy',
        moveUp: layer.role === 'anatomy'
          ? { enabled: false, reason: 'Fixed in stack.' }
          : enabled,
        moveDown: layer.role === 'anatomy'
          ? { enabled: false, reason: 'Fixed in stack.' }
          : enabled,
        visible: layer.visible ?? true,
        opacity: layer.opacity ?? 1,
        blendMode: 'normal'
      }))
    })),
    selection: {
      current: { kind: 'none' },
      inspection: null,
      vertexSelection: enabled,
      parcelSelection: enabled
    },
    figure: {
      preset: { id: 'default', label: 'Default', availability: enabled },
      availablePresets: [{ id: 'default', label: 'Default', availability: enabled }],
      background: 0,
      transparent: false,
      defaultWidth: 1800,
      defaultHeight: 1350,
      exportPNG: enabled
    },
    capabilities: {
      anatomicalViews: enabled,
      surfaceVisibility: enabled,
      layerVisibility: enabled,
      layerOpacity: enabled,
      layerBlendMode: enabled,
      layerOrder: enabled,
      scalarMapping: enabled,
      scientificSelection: enabled,
      figurePresets: enabled,
      figureBackground: enabled,
      exportPNG: enabled
    }
  });
}

const DEFAULT_SURFACES: readonly SurfaceSpec[] = Object.freeze([
  {
    id: 'lh',
    layers: [
      { id: 'base', role: 'anatomy' },
      { id: 'map-a' },
      { id: 'map-b' }
    ]
  },
  {
    id: 'rh',
    layers: [
      { id: 'base', role: 'anatomy' },
      { id: 'map-r' }
    ]
  }
]);

class FakeControlTarget implements SurfViewControlTarget {
  private snapshot: SurfViewControlSnapshot;
  private readonly listeners = new Set<SurfViewControlSnapshotListener>();
  private disposed = false;

  constructor(surfaces: readonly SurfaceSpec[] = DEFAULT_SURFACES) {
    this.snapshot = makeSnapshot(0, surfaces);
  }

  getSnapshot(): SurfViewControlSnapshot {
    return this.snapshot;
  }

  getLayerDataSummary() {
    return failure('unsupported', 'No scalar summaries are used by this fixture.');
  }

  subscribe(listener: SurfViewControlSnapshotListener): SurfViewControlSubscription {
    listener(this.snapshot);
    let active = !this.disposed;
    if (active) this.listeners.add(listener);
    return {
      get closed() {
        return !active;
      },
      unsubscribe: () => {
        if (!active) return;
        active = false;
        this.listeners.delete(listener);
      }
    };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  publish(surfaces: readonly SurfaceSpec[]): void {
    if (this.disposed) return;
    this.snapshot = makeSnapshot(this.snapshot.revision + 1, surfaces);
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }

  setAnatomicalView(_request: SetAnatomicalViewRequest): ControlCommandResult {
    return failure('unsupported', 'Not implemented by the fixture.');
  }

  fitView(): ControlCommandResult {
    return failure('unsupported', 'Not implemented by the fixture.');
  }

  resetView(): ControlCommandResult {
    return failure('unsupported', 'Not implemented by the fixture.');
  }

  setSurfaceVisibility(surfaceId: string, visible: boolean): ControlCommandResult {
    const surface = this.snapshot.surfaces.find(candidate => candidate.id === surfaceId);
    if (!surface) return failure('surface-not-found', 'Surface not found.');
    this.publish(this.snapshot.surfaces.map(candidate => ({
      id: candidate.id,
      visible: candidate.id === surfaceId ? visible : candidate.visible,
      layers: candidate.layers
    })));
    return Object.freeze({ ok: true });
  }

  setLayerVisibility(address: LayerControlAddress, visible: boolean): ControlCommandResult {
    return this.updateLayer(address, layer => ({ ...layer, visible }));
  }

  setLayerOpacity(address: LayerControlAddress, opacity: number): ControlCommandResult {
    return this.updateLayer(address, layer => ({ ...layer, opacity }));
  }

  setLayerBlendMode(
    _address: LayerControlAddress,
    _blendMode: BlendMode
  ): ControlCommandResult {
    return failure('unsupported', 'Not implemented by the fixture.');
  }

  setLayerOrder(
    _surfaceId: string,
    _layerIds: readonly string[]
  ): ControlCommandResult {
    return failure('unsupported', 'Not implemented by the fixture.');
  }

  updateScalarMapping(
    _address: LayerControlAddress,
    _update: ScalarMappingUpdate
  ): ControlCommandResult {
    return failure('unsupported', 'Not implemented by the fixture.');
  }

  setInspectionSelection(_selection: InspectionSelection): ControlCommandResult {
    return failure('unsupported', 'Not implemented by the fixture.');
  }

  applyFigurePreset(_presetId: string): ControlCommandResult {
    return failure('unsupported', 'Not implemented by the fixture.');
  }

  setFigureBackground(
    _background: number,
    _transparent?: boolean
  ): ControlCommandResult {
    return failure('unsupported', 'Not implemented by the fixture.');
  }

  exportFigure(
    _request?: FigureExportRequest
  ): Promise<ControlCommandResult<FigureExportResult>> {
    return Promise.resolve(failure('unsupported', 'Not implemented by the fixture.'));
  }

  setDisplayedLayer(_layerId: string): ControlCommandResult {
    return failure('unsupported', 'Not implemented by the fixture.');
  }

  private updateLayer(
    address: LayerControlAddress,
    update: (layer: LayerSpec) => LayerSpec
  ): ControlCommandResult {
    const surface = this.snapshot.surfaces.find(
      candidate => candidate.id === address.surfaceId
    );
    if (!surface) return failure('surface-not-found', 'Surface not found.');
    if (!surface.layers.some(layer => layer.id === address.layerId)) {
      return failure('layer-not-found', 'Layer not found.');
    }
    this.publish(this.snapshot.surfaces.map(candidate => ({
      id: candidate.id,
      visible: candidate.visible,
      layers: candidate.layers.map(layer =>
        candidate.id === address.surfaceId && layer.id === address.layerId
          ? update(layer)
          : layer
      )
    })));
    return Object.freeze({ ok: true });
  }
}

async function flushNotifications(): Promise<void> {
  await new Promise<void>(resolve => queueMicrotask(resolve));
}

function expectDeeplyFrozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    expectDeeplyFrozen(child);
  }
}

describe('SurfViewControlSession', () => {
  it('keeps focus independent while sharing one canonical snapshot', () => {
    const target = new FakeControlTarget();
    const first = createSurfViewControlSession(target, {
      focusedSurfaceId: 'lh',
      focusedLayerId: 'map-a'
    });
    const second = createSurfViewControlSession(target, {
      focusedSurfaceId: 'lh',
      focusedLayerId: 'map-b'
    });

    expect(first.getSnapshot().canonical).toBe(second.getSnapshot().canonical);
    expect(first.getSnapshot().state.focusedLayerId).toBe('map-a');
    expect(second.getSnapshot().state.focusedLayerId).toBe('map-b');

    first.setFocusedLayer({ surfaceId: 'rh', layerId: 'map-r' });

    expect(first.getSnapshot().state.focusedLayerId).toBe('map-r');
    expect(second.getSnapshot().state.focusedLayerId).toBe('map-b');
    expect(first.getSnapshot().canonical.revision).toBe(0);
    expect(second.getSnapshot().canonical.revision).toBe(0);
  });

  it('keeps disclosure and range-editor state local to one session', () => {
    const target = new FakeControlTarget();
    const first = createSurfViewControlSession(target);
    const second = createSurfViewControlSession(target);
    const revision = target.getSnapshot().revision;

    first.setSectionExpanded('figure', true);
    first.setAdvancedVisible(true);
    first.setSymmetricRangeLock(true);

    expect(first.getSnapshot().state).toMatchObject({
      advancedVisible: true,
      symmetricRangeLock: true
    });
    expect(first.getSnapshot().state.expandedSections).toContain('figure');
    expect(second.getSnapshot().state.advancedVisible).toBe(false);
    expect(second.getSnapshot().state.symmetricRangeLock).toBe(false);
    expect(second.getSnapshot().state.expandedSections).not.toContain('figure');
    expect(target.getSnapshot().revision).toBe(revision);
  });

  it('forwards a command and converges every session on target state', async () => {
    const target = new FakeControlTarget();
    const first = createSurfViewControlSession(target);
    const second = createSurfViewControlSession(target);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    first.subscribe(firstListener);
    second.subscribe(secondListener);
    firstListener.mockClear();
    secondListener.mockClear();

    expect(first.setLayerOpacity({ surfaceId: 'lh', layerId: 'map-a' }, 0.4))
      .toEqual({ ok: true });

    expect(first.getSnapshot().canonical).toBe(second.getSnapshot().canonical);
    expect(first.getSnapshot().canonical.surfaces[0].layers[1].opacity).toBe(0.4);
    await flushNotifications();
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).toHaveBeenCalledOnce();
    expect(firstListener.mock.calls[0]?.[0].canonical)
      .toBe(secondListener.mock.calls[0]?.[0].canonical);
  });

  it('falls back deterministically when focused layers or surfaces are hidden', () => {
    const target = new FakeControlTarget();
    const session = createSurfViewControlSession(target, {
      focusedSurfaceId: 'lh',
      focusedLayerId: 'map-b'
    });

    session.setLayerVisibility({ surfaceId: 'lh', layerId: 'map-b' }, false);
    expect(session.getSnapshot().state).toMatchObject({
      focusedSurfaceId: 'lh',
      focusedLayerId: 'map-a'
    });

    session.setSurfaceVisibility('lh', false);
    expect(session.getSnapshot().state).toMatchObject({
      focusedSurfaceId: 'rh',
      focusedLayerId: 'map-r'
    });
  });

  it('falls back when the focused layer is deleted and retains visible focus', () => {
    const target = new FakeControlTarget();
    const session = createSurfViewControlSession(target, {
      focusedSurfaceId: 'lh',
      focusedLayerId: 'map-b'
    });

    target.publish([
      {
        id: 'lh',
        layers: [
          { id: 'base', role: 'anatomy' },
          { id: 'map-a' }
        ]
      },
      DEFAULT_SURFACES[1]
    ]);

    expect(session.getSnapshot().state.focusedLayerId).toBe('map-a');
    expect(session.getSnapshot().focus.layer?.id).toBe('map-a');
  });

  it('coalesces delivery while exposing the latest target revision immediately', async () => {
    const target = new FakeControlTarget();
    const session = createSurfViewControlSession(target);
    const listener = vi.fn<(snapshot: SurfViewControlSessionSnapshot) => void>();
    session.subscribe(listener);
    listener.mockClear();

    session.setLayerOpacity({ surfaceId: 'lh', layerId: 'map-a' }, 0.8);
    session.setLayerOpacity({ surfaceId: 'lh', layerId: 'map-a' }, 0.6);

    expect(session.getSnapshot().canonical.revision).toBe(2);
    expect(session.getSnapshot().canonical.surfaces[0].layers[1].opacity).toBe(0.6);
    expect(listener).not.toHaveBeenCalled();

    await flushNotifications();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0].canonical.revision).toBe(2);
  });

  it('publishes deeply immutable presentation snapshots', () => {
    const target = new FakeControlTarget();
    const session = createSurfViewControlSession(target);
    const snapshot = session.getSnapshot();

    expectDeeplyFrozen(snapshot);
    expect(snapshot.focus.surface).toBe(snapshot.canonical.surfaces[0]);
    expect(snapshot.focus.layer).toBe(snapshot.canonical.surfaces[0].layers[2]);
  });

  it('rejects hidden direct focus without disturbing existing focus', () => {
    const target = new FakeControlTarget([
      {
        id: 'lh',
        layers: [
          { id: 'base', role: 'anatomy' },
          { id: 'visible' },
          { id: 'hidden', visible: false }
        ]
      }
    ]);
    const session = createSurfViewControlSession(target);

    const result = session.setFocusedLayer({ surfaceId: 'lh', layerId: 'hidden' });

    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(session.getSnapshot().state.focusedLayerId).toBe('visible');
    expect(session.setFocusedLayer(null as never)).toMatchObject({
      ok: false,
      code: 'invalid-value'
    });
  });

  it('disposes idempotently, cancels queued delivery, and leaves its target alive', async () => {
    const target = new FakeControlTarget();
    const session = createSurfViewControlSession(target);
    const listener = vi.fn();
    const subscription = session.subscribe(listener);
    listener.mockClear();
    const before = session.getSnapshot();

    session.setAdvancedVisible(true);
    session.dispose();
    session.dispose();
    target.setLayerOpacity({ surfaceId: 'lh', layerId: 'map-a' }, 0.2);
    await flushNotifications();

    expect(session.isDisposed()).toBe(true);
    expect(subscription.closed).toBe(true);
    expect(target.isDisposed()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(session.getSnapshot().canonical).toBe(before.canonical);
    expect(session.setAdvancedVisible(false)).toMatchObject({
      ok: false,
      code: 'disposed'
    });
    expect(session.setLayerOpacity({ surfaceId: 'lh', layerId: 'map-a' }, 0.9))
      .toMatchObject({ ok: false, code: 'disposed' });
  });
});
