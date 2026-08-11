/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSurfViewControlSession,
  SurfViewControlSession
} from '../../src';
import type {
  ControlCommandResult,
  FigureExportRequest,
  FigureExportResult,
  InspectionSelection,
  LayerControlAddress,
  ScalarMappingUpdate,
  SetAnatomicalViewRequest,
  SurfViewControlSnapshot,
  SurfViewControlSnapshotListener,
  SurfViewControlSubscription,
  SurfViewControlTarget
} from '../../src';
import type { BlendMode } from '../../src/layers';
import {
  defineSurfViewControlsElement,
  SURFVIEW_CONTROLS_TAG,
  SurfViewControlsElement
} from '../../src/controls-ui';

const enabled = Object.freeze({ enabled: true });

function layer(
  id: string,
  index: number,
  options: {
    label?: string;
    role?: 'anatomy' | 'data' | 'outline' | 'connectivity';
    pinned?: 'bottom' | 'top' | null;
    reorderable?: boolean;
    visible?: boolean;
    opacity?: number;
    blendMode?: BlendMode;
    preview?: { label: string; css: string };
  } = {}
) {
  return {
    id,
    surfaceId: 'lh',
    label: options.label ?? id,
    index,
    role: options.role ?? 'data',
    pinned: options.pinned ?? null,
    reorderable: options.reorderable ?? true,
    moveUp: enabled,
    moveDown: enabled,
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    blendMode: options.blendMode ?? 'normal',
    ...(options.preview
      ? {
          colorPreview: {
            kind: 'colormap' as const,
            label: options.preview.label,
            css: options.preview.css
          }
        }
      : {})
  };
}

function withMoveAvailability(
  layers: readonly ReturnType<typeof layer>[]
): ReturnType<typeof layer>[] {
  return layers.map((candidate, index) => {
    const canMove = (offset: -1 | 1) => {
      const neighbor = layers[index + offset];
      return candidate.reorderable && neighbor?.reorderable &&
        candidate.role === neighbor.role && candidate.pinned === neighbor.pinned;
    };
    return {
      ...candidate,
      moveUp: canMove(-1)
        ? enabled
        : { enabled: false, reason: 'Move up is constrained by canonical order.' },
      moveDown: canMove(1)
        ? enabled
        : { enabled: false, reason: 'Move down is constrained by canonical order.' }
    };
  });
}

function makeSnapshot(
  overrides: Partial<SurfViewControlSnapshot> = {}
): SurfViewControlSnapshot {
  return {
    revision: 1,
    view: {
      current: {
        view: 'lateral',
        target: { kind: 'group', groupId: 'cortex' }
      },
      anatomicalViews: [
        'lateral',
        'medial',
        'dorsal',
        'ventral',
        'anterior',
        'posterior'
      ].map(id => ({
        id: id as 'lateral',
        label: id[0].toUpperCase() + id.slice(1),
        availability: enabled
      })),
      targets: [
        {
          target: { kind: 'surface', surfaceId: 'lh' },
          label: 'Left cortex',
          availability: enabled
        },
        {
          target: { kind: 'group', groupId: 'cortex' },
          label: 'Cortex pair',
          availability: enabled
        }
      ],
      fit: enabled,
      reset: enabled
    },
    surfaces: [{
      id: 'lh',
      label: 'Left cortex',
      hemisphere: 'left',
      visible: true,
      groupId: 'cortex',
      layers: withMoveAvailability([
        layer('base', 0, {
          label: 'Anatomy',
          role: 'anatomy',
          pinned: 'bottom',
          reorderable: false,
          preview: { label: 'Neutral gray', css: '#a0a0a0' }
        }),
        layer('map-a', 1, {
          label: 'Activation',
          opacity: 0.75,
          preview: {
            label: 'Viridis',
            css: 'linear-gradient(90deg, #440154, #fde725)'
          }
        }),
        layer('map-b', 2, {
          label: 'Variance',
          opacity: 0.5,
          blendMode: 'additive',
          preview: {
            label: 'Plasma',
            css: 'linear-gradient(90deg, #0d0887, #f0f921)'
          }
        }),
        layer('outline', 3, {
          label: 'Parcel boundaries',
          role: 'outline',
          pinned: 'top',
          reorderable: false,
          preview: { label: 'White outline', css: '#ffffff' }
        })
      ])
    }],
    selection: {
      current: { kind: 'none' },
      inspection: null,
      vertexSelection: enabled,
      parcelSelection: enabled
    },
    figure: {
      preset: { id: 'default', label: 'Default', availability: enabled },
      availablePresets: [{ id: 'default', label: 'Default', availability: enabled }],
      background: 0x000000,
      transparent: false,
      defaultWidth: 1200,
      defaultHeight: 900,
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
    },
    ...overrides
  };
}

class MutableControlTarget implements SurfViewControlTarget {
  private snapshot: SurfViewControlSnapshot;
  private listeners = new Set<SurfViewControlSnapshotListener>();
  private disposed = false;
  readonly setViewRequests: SetAnatomicalViewRequest[] = [];
  fitCalls = 0;
  resetCalls = 0;

  constructor(snapshot: SurfViewControlSnapshot = makeSnapshot()) {
    this.snapshot = snapshot;
  }

  getSnapshot(): SurfViewControlSnapshot {
    return this.snapshot;
  }

  getLayerDataSummary() {
    return {
      ok: false as const,
      code: 'unsupported' as const,
      message: 'No scalar summaries are used by this fixture.'
    };
  }

  subscribe(listener: SurfViewControlSnapshotListener): SurfViewControlSubscription {
    let closed = false;
    this.listeners.add(listener);
    listener(this.snapshot);
    return {
      get closed() {
        return closed;
      },
      unsubscribe: () => {
        if (closed) return;
        closed = true;
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

  setAnatomicalView(request: SetAnatomicalViewRequest): ControlCommandResult {
    this.setViewRequests.push(request);
    this.publish({
      ...this.snapshot,
      view: { ...this.snapshot.view, current: { view: request.view, target: request.target } }
    });
    return { ok: true };
  }

  fitView(): ControlCommandResult {
    this.fitCalls += 1;
    return { ok: true };
  }

  resetView(): ControlCommandResult {
    this.resetCalls += 1;
    this.publish({
      ...this.snapshot,
      view: { ...this.snapshot.view, current: null }
    });
    return { ok: true };
  }

  setSurfaceVisibility(surfaceId: string, visible: boolean): ControlCommandResult {
    return this.updateSurface(surfaceId, surface => ({ ...surface, visible }));
  }

  setLayerVisibility(address: LayerControlAddress, visible: boolean): ControlCommandResult {
    return this.updateLayer(address, candidate => ({ ...candidate, visible }));
  }

  setLayerOpacity(address: LayerControlAddress, opacity: number): ControlCommandResult {
    return this.updateLayer(address, candidate => ({ ...candidate, opacity }));
  }

  setLayerBlendMode(
    address: LayerControlAddress,
    blendMode: BlendMode
  ): ControlCommandResult {
    return this.updateLayer(address, candidate => ({ ...candidate, blendMode }));
  }

  setLayerOrder(surfaceId: string, layerIds: readonly string[]): ControlCommandResult {
    return this.updateSurface(surfaceId, surface => {
      const byId = new Map(surface.layers.map(candidate => [candidate.id, candidate]));
      return {
        ...surface,
        layers: withMoveAvailability(
          layerIds.map((id, index) => ({ ...byId.get(id)!, index }))
        )
      };
    });
  }

  updateScalarMapping(
    _address: LayerControlAddress,
    _update: ScalarMappingUpdate
  ): ControlCommandResult {
    return { ok: false, code: 'unsupported', message: 'Not used by this fixture.' };
  }

  setInspectionSelection(_selection: InspectionSelection): ControlCommandResult {
    return { ok: false, code: 'unsupported', message: 'Not used by this fixture.' };
  }

  applyFigurePreset(_presetId: string): ControlCommandResult {
    return { ok: false, code: 'unsupported', message: 'Not used by this fixture.' };
  }

  setFigureBackground(
    _background: number,
    _transparent?: boolean
  ): ControlCommandResult {
    return { ok: false, code: 'unsupported', message: 'Not used by this fixture.' };
  }

  exportFigure(
    _request?: FigureExportRequest
  ): Promise<ControlCommandResult<FigureExportResult>> {
    return Promise.resolve({
      ok: false,
      code: 'unsupported',
      message: 'Not used by this fixture.'
    });
  }

  setDisplayedLayer(_layerId: string): ControlCommandResult {
    return { ok: false, code: 'unsupported', message: 'Not used by this fixture.' };
  }

  replace(snapshot: SurfViewControlSnapshot): void {
    this.publish(snapshot);
  }

  private updateSurface(
    surfaceId: string,
    update: (surface: SurfViewControlSnapshot['surfaces'][number]) =>
      SurfViewControlSnapshot['surfaces'][number]
  ): ControlCommandResult {
    const surface = this.snapshot.surfaces.find(candidate => candidate.id === surfaceId);
    if (!surface) {
      return { ok: false, code: 'surface-not-found', message: 'Surface not found.' };
    }
    this.publish({
      ...this.snapshot,
      surfaces: this.snapshot.surfaces.map(candidate =>
        candidate.id === surfaceId ? update(candidate) : candidate
      )
    });
    return { ok: true };
  }

  private updateLayer(
    address: LayerControlAddress,
    update: (
      candidate: SurfViewControlSnapshot['surfaces'][number]['layers'][number]
    ) => SurfViewControlSnapshot['surfaces'][number]['layers'][number]
  ): ControlCommandResult {
    return this.updateSurface(address.surfaceId, surface => ({
      ...surface,
      layers: surface.layers.map(candidate =>
        candidate.id === address.layerId ? update(candidate) : candidate
      )
    }));
  }

  private publish(next: SurfViewControlSnapshot): void {
    this.snapshot = { ...next, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

interface MountedFixture {
  readonly element: SurfViewControlsElement;
  readonly target: MutableControlTarget;
  readonly session: SurfViewControlSession;
}

async function mountFixture(
  snapshot: SurfViewControlSnapshot = makeSnapshot()
): Promise<MountedFixture> {
  defineSurfViewControlsElement();
  const target = new MutableControlTarget(snapshot);
  const session = createSurfViewControlSession(target, {
    focusedSurfaceId: snapshot.surfaces[0]?.id ?? null,
    focusedLayerId: snapshot.surfaces[0]?.layers.find(candidate =>
      candidate.role === 'data'
    )?.id ?? null
  });
  const element = document.createElement(
    SURFVIEW_CONTROLS_TAG
  ) as SurfViewControlsElement;
  element.session = session;
  document.body.appendChild(element);
  await element.updateComplete;
  return { element, target, session };
}

async function flush(element: SurfViewControlsElement): Promise<void> {
  await Promise.resolve();
  await element.updateComplete;
}

function queryLayerIds(element: SurfViewControlsElement): string[] {
  return [...element.shadowRoot!.querySelectorAll<HTMLElement>('[data-layer-id]')]
    .map(row => row.dataset.layerId!);
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('SurfView controls View and Layers sections', () => {
  it('uses a native anatomical radio group and ordinary Fit and Reset buttons', async () => {
    const fixture = await mountFixture();
    const root = fixture.element.shadowRoot!;
    const radios = [...root.querySelectorAll<HTMLInputElement>(
      'fieldset.view-options input[type="radio"]'
    )];

    expect(radios).toHaveLength(6);
    expect(root.querySelector('[role="toolbar"]')).toBeNull();
    expect(radios.find(radio => radio.value === 'lateral')?.checked).toBe(true);
    expect(root.textContent).toContain('Applies to Cortex pair');

    radios.find(radio => radio.value === 'medial')!.click();
    await flush(fixture.element);
    expect(fixture.target.setViewRequests.at(-1)).toEqual({
      view: 'medial',
      target: { kind: 'group', groupId: 'cortex' },
      fit: false
    });
    expect(radios.find(radio => radio.value === 'medial')?.checked).toBe(true);

    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.view-actions button')];
    expect(buttons.map(button => button.textContent?.trim())).toEqual(['Fit', 'Reset']);
    buttons[0].click();
    buttons[1].click();
    await flush(fixture.element);
    expect(fixture.target.fitCalls).toBe(1);
    expect(fixture.target.resetCalls).toBe(1);

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('preserves a valid canonical view target ahead of panel-layer focus', async () => {
    const snapshot = makeSnapshot();
    const fixture = await mountFixture({
      ...snapshot,
      view: {
        ...snapshot.view,
        current: {
          view: 'lateral',
          target: { kind: 'surface', surfaceId: 'lh' }
        }
      }
    });
    const root = fixture.element.shadowRoot!;

    expect(root.textContent).toContain('Applies to Left cortex');
    expect(root.querySelector<HTMLInputElement>('input[value="lateral"]')?.checked)
      .toBe(true);
    root.querySelector<HTMLInputElement>('input[value="posterior"]')!.click();
    await flush(fixture.element);
    expect(fixture.target.setViewRequests.at(-1)?.target).toEqual({
      kind: 'surface',
      surfaceId: 'lh'
    });

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('renders and mutates the exact canonical bottom-to-top layer order', async () => {
    const fixture = await mountFixture();
    const root = fixture.element.shadowRoot!;

    expect(queryLayerIds(fixture.element)).toEqual([
      'base', 'map-a', 'map-b', 'outline'
    ]);

    root.querySelector<HTMLButtonElement>('[aria-label="Move Variance up"]')!.click();
    await flush(fixture.element);
    expect(fixture.target.getSnapshot().surfaces[0].layers.map(candidate => candidate.id))
      .toEqual(['base', 'map-b', 'map-a', 'outline']);
    expect(queryLayerIds(fixture.element)).toEqual([
      'base', 'map-b', 'map-a', 'outline'
    ]);

    const baseRow = root.querySelector<HTMLElement>('[data-layer-id="base"]')!;
    expect(baseRow.textContent).toContain('Pinned bottom');
    expect(baseRow.textContent).not.toContain('fixed in stack');
    expect(baseRow.querySelectorAll<HTMLButtonElement>('.layer-actions button:disabled'))
      .toHaveLength(2);

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('uses authoritative per-direction move availability and reasons', async () => {
    const snapshot = makeSnapshot();
    const surface = snapshot.surfaces[0];
    const fixture = await mountFixture({
      ...snapshot,
      surfaces: [{
        ...surface,
        layers: surface.layers.map(candidate => candidate.id === 'map-b'
          ? {
              ...candidate,
              moveUp: {
                enabled: false,
                reason: 'Priority-locked below Activation.'
              }
            }
          : candidate)
      }]
    });
    const move = fixture.element.shadowRoot!.querySelector<HTMLButtonElement>(
      '[aria-label="Move Variance up"]'
    )!;

    expect(move.disabled).toBe(true);
    expect(move.title).toBe('Priority-locked below Activation.');
    const descriptionId = move.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(fixture.element.shadowRoot!.getElementById(descriptionId!)?.textContent)
      .toContain('Move up unavailable: Priority-locked below Activation.');
    move.click();
    await flush(fixture.element);
    expect(fixture.target.getSnapshot().surfaces[0].layers.map(candidate => candidate.id))
      .toEqual(['base', 'map-a', 'map-b', 'outline']);

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('keeps panel focus separate from visibility and scientific selection', async () => {
    const fixture = await mountFixture();
    const root = fixture.element.shadowRoot!;
    const varianceRow = root.querySelector<HTMLElement>('[data-layer-id="map-b"]')!;
    const visibility = varianceRow.querySelector<HTMLInputElement>(
      'input[aria-label="Show Variance"]'
    )!;

    varianceRow.querySelector<HTMLButtonElement>('.layer-focus')!.click();
    await flush(fixture.element);
    expect(fixture.session.getSnapshot().state.focusedLayerId).toBe('map-b');
    expect(fixture.target.getSnapshot().selection.current).toEqual({ kind: 'none' });
    expect(fixture.target.getSnapshot().surfaces[0].layers[2].visible).toBe(true);
    expect(varianceRow.dataset.focused).toBe('true');
    expect(varianceRow.querySelector('.focus-indicator')?.textContent).toBe('Editing');
    expect(root.querySelectorAll('.focus-indicator')).toHaveLength(1);
    expect(visibility.parentElement?.textContent?.trim()).toBe('Visible');

    visibility.click();
    await flush(fixture.element);
    expect(fixture.target.getSnapshot().surfaces[0].layers.find(
      candidate => candidate.id === 'map-b'
    )?.visible).toBe(false);
    expect(fixture.session.getSnapshot().state.focusedLayerId).toBe('outline');
    expect(fixture.target.getSnapshot().selection.current).toEqual({ kind: 'none' });

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('supports exact opacity and blend changes with native keyboard controls', async () => {
    const fixture = await mountFixture();
    const root = fixture.element.shadowRoot!;
    const row = root.querySelector<HTMLElement>('[data-layer-id="map-a"]')!;
    const inspector = root.querySelector<HTMLElement>('.selected-layer-section')!;
    const opacity = inspector.querySelector<HTMLInputElement>('input[type="range"]')!;
    const blend = inspector.querySelector<HTMLSelectElement>('select')!;

    expect(row.querySelector('.layer-details')?.textContent).toContain('75%');
    expect(row.querySelector('.layer-details')?.textContent).toContain('Normal');
    expect(row.querySelector('input[type="range"]')).toBeNull();
    expect(row.querySelector('select')).toBeNull();
    expect(opacity.getAttribute('aria-label')).toBe('Activation opacity');
    opacity.value = '0.24';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    blend.value = 'multiply';
    blend.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(fixture.element);

    const updated = fixture.target.getSnapshot().surfaces[0].layers.find(
      candidate => candidate.id === 'map-a'
    );
    expect(updated).toMatchObject({ opacity: 0.24, blendMode: 'multiply' });
    expect(inspector.querySelector('output')?.textContent).toBe('24%');

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('tracks external target changes without rebuilding order locally', async () => {
    const fixture = await mountFixture();
    const current = fixture.target.getSnapshot();
    const surface = current.surfaces[0];
    fixture.target.replace({
      ...current,
      surfaces: [{
        ...surface,
        layers: [surface.layers[0], surface.layers[2], surface.layers[1], surface.layers[3]]
          .map((candidate, index) => ({ ...candidate, index }))
      }]
    });
    await flush(fixture.element);

    expect(queryLayerIds(fixture.element)).toEqual([
      'base', 'map-b', 'map-a', 'outline'
    ]);
    expect(fixture.element.snapshot?.canonical)
      .toBe(fixture.target.getSnapshot());

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('provides textual previews, constraints, and usable empty/one-layer states', async () => {
    const fixture = await mountFixture();
    const root = fixture.element.shadowRoot!;
    const previews = [...root.querySelectorAll<HTMLElement>('[role="img"]')];

    expect(previews.map(preview => preview.getAttribute('aria-label'))).toEqual([
      'Color preview: Neutral gray',
      'Color preview: Viridis',
      'Color preview: Plasma',
      'Color preview: White outline'
    ]);
    expect(root.textContent).toContain('Viridis');
    expect(root.textContent).toContain('Pinned bottom');
    expect(root.textContent).toContain('Pinned top');
    expect(root.textContent).not.toContain('not pinned');
    expect(root.textContent).not.toContain('reorderable');
    const activationFocus = root.querySelector<HTMLButtonElement>(
      '[aria-label="Focus Activation for editing"]'
    )!;
    const detailsId = activationFocus.getAttribute('aria-describedby');
    expect(detailsId).toBeTruthy();
    expect(root.getElementById(detailsId!)?.textContent).toContain('Data layer.');
    expect(SurfViewControlsElement.styles.toString()).toContain(
      '@container (max-width: 22rem)'
    );

    fixture.session.dispose();
    fixture.target.dispose();

    const unsafeSnapshot = makeSnapshot();
    const unsafeSurface = unsafeSnapshot.surfaces[0];
    const unsafe = await mountFixture({
      ...unsafeSnapshot,
      surfaces: [{
        ...unsafeSurface,
        layers: unsafeSurface.layers.map(candidate => candidate.id === 'map-a'
          ? {
              ...candidate,
              colorPreview: {
                kind: 'solid',
                label: 'Untrusted preview',
                css: 'red; background-image: url(https://invalid.example/pixel)'
              }
            }
          : candidate)
      }]
    });
    const unsafePreview = unsafe.element.shadowRoot!.querySelector<HTMLElement>(
      '[aria-label="Color preview: Untrusted preview"]'
    )!;
    expect(unsafePreview.style.getPropertyValue('--layer-preview').trim())
      .toBe('transparent');
    unsafe.session.dispose();
    unsafe.target.dispose();

    const empty = await mountFixture(makeSnapshot({ surfaces: [] }));
    expect(empty.element.shadowRoot?.textContent).toContain(
      'No surfaces or layers are loaded.'
    );
    empty.session.dispose();
    empty.target.dispose();

    const original = makeSnapshot();
    const oneLayer = await mountFixture(makeSnapshot({
      surfaces: [{
        ...original.surfaces[0],
        layers: [original.surfaces[0].layers[0]]
      }]
    }));
    expect(oneLayer.element.shadowRoot?.querySelectorAll('[data-layer-id]'))
      .toHaveLength(1);
    expect(oneLayer.element.shadowRoot?.querySelectorAll(
      '.layer-actions button:disabled'
    )).toHaveLength(2);
    oneLayer.session.dispose();
    oneLayer.target.dispose();
  });

  it('omits controls for unsupported capabilities', async () => {
    const original = makeSnapshot();
    const fixture = await mountFixture(makeSnapshot({
      capabilities: {
        ...original.capabilities,
        surfaceVisibility: { enabled: false, reason: 'Unavailable' },
        layerVisibility: { enabled: false, reason: 'Unavailable' },
        layerOpacity: { enabled: false, reason: 'Unavailable' },
        layerBlendMode: { enabled: false, reason: 'Unavailable' },
        layerOrder: { enabled: false, reason: 'Unavailable' }
      }
    }));
    const root = fixture.element.shadowRoot!;

    expect(root.querySelector('.layers-section input[type="checkbox"]')).toBeNull();
    expect(root.querySelector('.layers-section input[type="range"]')).toBeNull();
    expect(root.querySelector('.layers-section select')).toBeNull();
    expect(root.querySelector('.layer-actions button')).toBeNull();

    fixture.session.dispose();
    fixture.target.dispose();
  });
});
