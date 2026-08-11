/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSurfViewControlSession } from '../../src';
import type {
  ControlCommandResult,
  LayerControlAddress,
  ScalarMappingUpdate,
  SurfViewControlSnapshot,
  SurfViewControlSnapshotListener,
  SurfViewControlSubscription,
  SurfViewControlTarget
} from '../../src';
import {
  defineSurfViewControlsElement,
  SURFVIEW_CONTROLS_TAG,
  SurfViewControlsElement
} from '../../src/controls-ui';

const enabled = Object.freeze({ enabled: true });
const unavailableMove = Object.freeze({
  enabled: false,
  reason: 'No valid destination in the canonical layer order.'
});

function scalarSnapshot(): SurfViewControlSnapshot {
  return {
    revision: 1,
    view: {
      current: null,
      anatomicalViews: [],
      targets: [],
      fit: enabled,
      reset: enabled
    },
    surfaces: [{
      id: 'lh',
      label: 'Left cortex',
      hemisphere: 'left',
      visible: true,
      groupId: null,
      layers: [
        {
          id: 'activation',
          surfaceId: 'lh',
          label: 'Task activation',
          description: 'Language contrast',
          units: 'z',
          index: 0,
          role: 'data',
          pinned: null,
          reorderable: true,
          moveUp: unavailableMove,
          moveDown: unavailableMove,
          visible: true,
          opacity: 0.8,
          blendMode: 'normal',
          colorPreview: {
            kind: 'colormap',
            label: 'Viridis',
            css: 'linear-gradient(90deg, #440154, #21918c, #fde725)'
          },
          scalarMapping: {
            availability: enabled,
            dataRevision: 1,
            colorMap: { id: 'viridis', label: 'Viridis', availability: enabled },
            availableColorMaps: [
              { id: 'plasma', label: 'Plasma', availability: enabled },
              { id: 'viridis', label: 'Viridis', availability: enabled }
            ],
            displayRange: { value: [-4, 4], minimum: -5, maximum: 5 },
            maskInterval: { value: [-2, 2], minimum: -5, maximum: 5 },
            summary: {
              finiteCount: 10,
              missingCount: 2,
              minimum: -5,
              maximum: 5
            }
          }
        },
        {
          id: 'outline',
          surfaceId: 'lh',
          label: 'Parcel boundaries',
          index: 1,
          role: 'outline',
          pinned: 'top',
          reorderable: false,
          moveUp: unavailableMove,
          moveDown: unavailableMove,
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          colorPreview: { kind: 'solid', label: 'White', css: '#ffffff' }
        }
      ]
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
      background: 0,
      transparent: false,
      defaultWidth: 1200,
      defaultHeight: 900,
      exportPNG: enabled
    },
    capabilities: {
      anatomicalViews: { enabled: false, reason: 'No anatomical target.' },
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
  };
}

class MutableScalarTarget {
  private snapshot = scalarSnapshot();
  private readonly listeners = new Set<SurfViewControlSnapshotListener>();
  readonly scalarUpdates: ScalarMappingUpdate[] = [];
  summaryQueries = 0;
  private readonly histogramSummary = Object.freeze({
    finiteCount: 10,
    missingCount: 2,
    minimum: -5,
    maximum: 5,
    histogram: Object.freeze({
      edges: Object.freeze([-5, -2.5, 0, 2.5, 5]),
      counts: Object.freeze([1, 3, 4, 2])
    })
  });

  getSnapshot(): SurfViewControlSnapshot {
    return this.snapshot;
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

  getLayerDataSummary(address: LayerControlAddress) {
    this.summaryQueries += 1;
    return address.surfaceId === 'lh' && address.layerId === 'activation'
      ? { ok: true as const, value: this.histogramSummary }
      : { ok: false as const, code: 'layer-not-found' as const, message: 'Layer not found.' };
  }

  updateScalarMapping(
    address: LayerControlAddress,
    update: ScalarMappingUpdate
  ): ControlCommandResult {
    if (address.surfaceId !== 'lh' || address.layerId !== 'activation') {
      return { ok: false, code: 'layer-not-found', message: 'Layer not found.' };
    }
    this.scalarUpdates.push(update);
    this.applyScalarUpdate(update);
    return { ok: true };
  }

  externalScalarUpdate(update: ScalarMappingUpdate): void {
    this.applyScalarUpdate(update);
  }

  externalOpacityUpdate(opacity: number): void {
    this.replaceLayer(layer => ({ ...layer, opacity }));
  }

  private applyScalarUpdate(update: ScalarMappingUpdate): void {
    this.replaceLayer(layer => {
      const scalar = layer.scalarMapping!;
      const selectedMap = update.colorMapId === undefined
        ? scalar.colorMap
        : scalar.availableColorMaps.find(option => option.id === update.colorMapId) ??
          scalar.colorMap;
      return {
        ...layer,
        ...(update.colorMapId === undefined
          ? {}
          : {
              colorPreview: {
                kind: 'colormap' as const,
                label: selectedMap.label,
                css: update.colorMapId === 'plasma'
                  ? 'linear-gradient(90deg, #0d0887, #cc4778, #f0f921)'
                  : 'linear-gradient(90deg, #440154, #21918c, #fde725)'
              }
            }),
        scalarMapping: {
          ...scalar,
          colorMap: selectedMap,
          displayRange: update.displayRange
            ? { ...scalar.displayRange, value: update.displayRange }
            : scalar.displayRange,
          maskInterval: update.maskInterval
            ? { ...scalar.maskInterval, value: update.maskInterval }
            : scalar.maskInterval
        }
      };
    });
  }

  dispose(): void {
    this.listeners.clear();
  }

  private replaceLayer(
    update: (
      layer: SurfViewControlSnapshot['surfaces'][number]['layers'][number]
    ) => SurfViewControlSnapshot['surfaces'][number]['layers'][number]
  ): void {
    const surface = this.snapshot.surfaces[0];
    this.publish({
      ...this.snapshot,
      surfaces: [{
        ...surface,
        layers: surface.layers.map(layer =>
          layer.id === 'activation' ? update(layer) : layer
        )
      }]
    });
  }

  private publish(next: SurfViewControlSnapshot): void {
    this.snapshot = { ...next, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

async function mountFixture() {
  defineSurfViewControlsElement();
  const target = new MutableScalarTarget();
  const session = createSurfViewControlSession(
    target as unknown as SurfViewControlTarget,
    { focusedSurfaceId: 'lh', focusedLayerId: 'activation' }
  );
  const element = document.createElement(
    SURFVIEW_CONTROLS_TAG
  ) as SurfViewControlsElement;
  element.session = session;
  document.body.appendChild(element);
  await element.updateComplete;
  return { target, session, element };
}

async function flush(element: SurfViewControlsElement): Promise<void> {
  await Promise.resolve();
  await element.updateComplete;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('SurfView controls scalar selected-layer inspector', () => {
  it('renders the focused scalar workflow and states masking semantics honestly', async () => {
    const fixture = await mountFixture();
    const root = fixture.element.shadowRoot!;
    const inspector = root.querySelector<HTMLElement>('.selected-layer-section')!;

    expect(inspector.querySelector('.selected-layer-title')?.textContent)
      .toBe('Task activation');
    expect(inspector.textContent).toContain('Left cortex · z');
    expect(inspector.textContent).toContain('Language contrast');
    expect(inspector.querySelector('[aria-label="Colormap preview: Viridis"]')).not.toBeNull();
    expect(inspector.querySelectorAll('.histogram-bar')).toHaveLength(4);
    expect(inspector.querySelector('.mask-band')).not.toBeNull();
    expect(inspector.textContent).toContain('Mask values between');
    expect(inspector.textContent).toContain(
      'Values inside the interval are hidden; values outside remain visible.'
    );
    expect(inspector.textContent?.replace(/\s+/g, ' '))
      .toContain('10 finite values · 2 missing');
    expect(inspector.textContent).not.toMatch(/threshold min|threshold max/i);

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('applies colormap and exact numeric range commands while rejecting invalid pairs', async () => {
    const fixture = await mountFixture();
    const root = fixture.element.shadowRoot!;
    const colormap = root.querySelector<HTMLSelectElement>(
      '[aria-label="Task activation colormap"]'
    )!;
    colormap.value = 'plasma';
    colormap.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(fixture.element);
    expect(fixture.target.scalarUpdates.at(-1)).toEqual({ colorMapId: 'plasma' });
    expect(root.querySelector('[aria-label="Colormap preview: Plasma"]')).not.toBeNull();

    const low = root.querySelector<HTMLInputElement>(
      'input[type="number"][data-range-kind="display"][data-bound="lower"]'
    )!;
    low.value = '-3.25';
    low.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(fixture.element);
    expect(fixture.target.scalarUpdates.at(-1)).toEqual({
      displayRange: [-3.25, 4]
    });

    const commandCount = fixture.target.scalarUpdates.length;
    low.value = '8';
    low.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fixture.target.scalarUpdates).toHaveLength(commandCount);
    expect(low.validationMessage).toBe('Low must be less than or equal to High.');

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('updates sliders synchronously without requerying or rebuilding the histogram', async () => {
    const fixture = await mountFixture();
    const root = fixture.element.shadowRoot!;
    fixture.target.externalScalarUpdate({ displayRange: [-2, 5] });
    await flush(fixture.element);
    const lock = root.querySelector<HTMLInputElement>('.symmetric-lock input')!;
    lock.click();
    await flush(fixture.element);
    expect(fixture.target.scalarUpdates.at(-1)).toEqual({ displayRange: [-5, 5] });
    expect(fixture.session.getSnapshot().state.symmetricRangeLock).toBe(true);

    const exactLow = root.querySelector<HTMLInputElement>(
      'input[type="number"][data-range-kind="display"][data-bound="lower"]'
    )!;
    exactLow.value = '-3.125';
    exactLow.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(fixture.element);
    expect(fixture.target.scalarUpdates.at(-1)).toEqual({
      displayRange: [-3.125, 3.125]
    });

    const section = root.querySelector('.selected-layer-section');
    const firstBar = root.querySelector('.histogram-bar');
    const slider = root.querySelector<HTMLInputElement>(
      'input[type="range"][data-range-kind="display"][data-bound="lower"]'
    )!;
    expect(fixture.target.summaryQueries).toBe(1);
    slider.value = '-2.5';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(fixture.target.scalarUpdates.at(-1)).toEqual({
      displayRange: [-2.5, 2.5]
    });
    await flush(fixture.element);
    expect(fixture.target.summaryQueries).toBe(1);
    expect(root.querySelector('.selected-layer-section')).toBe(section);
    expect(root.querySelector('.histogram-bar')).toBe(firstBar);
    expect(fixture.target.summaryQueries).toBe(1);

    const maskLow = root.querySelector<HTMLInputElement>(
      'input[type="number"][data-range-kind="mask"][data-bound="lower"]'
    )!;
    maskLow.value = '2';
    maskLow.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(fixture.element);
    expect(fixture.target.scalarUpdates.at(-1)).toEqual({ maskInterval: [2, 2] });
    expect(root.querySelector('.mask-band')).toBeNull();
    expect(root.textContent).toContain('Masking off (equal endpoints).');
    expect(root.querySelector('.histogram-bar')).toBe(firstBar);

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('tracks external scalar changes and removes scalar controls for non-scalar focus', async () => {
    const fixture = await mountFixture();
    const root = fixture.element.shadowRoot!;
    fixture.target.externalScalarUpdate({
      colorMapId: 'plasma',
      displayRange: [-1.75, 3.125],
      maskInterval: [0, 0]
    });
    fixture.target.externalOpacityUpdate(0.375);
    await flush(fixture.element);

    expect(root.querySelector<HTMLSelectElement>(
      '[aria-label="Task activation colormap"]'
    )?.value).toBe('plasma');
    expect(root.querySelector<HTMLInputElement>(
      'input[type="number"][data-range-kind="display"][data-bound="lower"]'
    )?.value).toBe('-1.75');
    expect(root.querySelector<HTMLInputElement>(
      'input[type="number"][data-range-kind="display"][data-bound="upper"]'
    )?.value).toBe('3.125');
    expect(root.textContent).toContain('Masking off (equal endpoints).');
    expect(root.querySelector<HTMLInputElement>(
      '[aria-label="Task activation opacity"]'
    )?.value).toBe('0.375');

    root.querySelector<HTMLButtonElement>(
      '[aria-label="Focus Parcel boundaries for editing"]'
    )!.click();
    await flush(fixture.element);
    expect(root.querySelector('.selected-layer-title')?.textContent)
      .toBe('Parcel boundaries');
    expect(root.querySelector('.scalar-controls')).toBeNull();
    expect(root.querySelector('[aria-label="Parcel boundaries opacity"]')).not.toBeNull();

    fixture.session.dispose();
    fixture.target.dispose();
  });

  it('clears a local symmetric lock when another session publishes an asymmetric range', async () => {
    const fixture = await mountFixture();
    const root = fixture.element.shadowRoot!;
    const lock = root.querySelector<HTMLInputElement>('.symmetric-lock input')!;
    lock.click();
    await flush(fixture.element);
    expect(lock.checked).toBe(true);

    const second = createSurfViewControlSession(
      fixture.target as unknown as SurfViewControlTarget,
      { focusedSurfaceId: 'lh', focusedLayerId: 'activation' }
    );
    expect(second.updateScalarMapping(
      { surfaceId: 'lh', layerId: 'activation' },
      { displayRange: [-2, 5] }
    )).toEqual({ ok: true });
    await flush(fixture.element);

    expect(fixture.session.getSnapshot().state.symmetricRangeLock).toBe(false);
    expect(lock.checked).toBe(false);
    expect(root.querySelector<HTMLInputElement>(
      'input[type="number"][data-range-kind="display"][data-bound="lower"]'
    )?.value).toBe('-2');
    expect(root.querySelector<HTMLInputElement>(
      'input[type="number"][data-range-kind="display"][data-bound="upper"]'
    )?.value).toBe('5');

    second.dispose();
    fixture.session.dispose();
    fixture.target.dispose();
  });
});
