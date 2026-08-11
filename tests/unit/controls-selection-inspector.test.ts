/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSurfViewControlSession } from '../../src';
import type {
  InspectionSelection,
  SurfViewControlSnapshot,
  SurfViewControlSnapshotListener,
  SurfViewControlSubscription,
  SurfViewControlTarget,
  VertexInspection
} from '../../src';
import {
  defineSurfViewControlsElement,
  SURFVIEW_CONTROLS_TAG,
  SurfViewControlsElement
} from '../../src/controls-ui';

const enabled = Object.freeze({ enabled: true });
const fixed = Object.freeze({ enabled: false, reason: 'Fixed test order.' });

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function vertexInspection(): VertexInspection {
  return deepFreeze({
    surfaceId: 'lh',
    vertexIndex: 1,
    world: [0.123456789, 123456789.125, -1.23456789e-7] as const,
    values: [
      {
        layerId: 'dense',
        label: 'Dense statistic',
        value: 0.123456789,
        units: 'z',
        missing: false
      },
      {
        layerId: 'sparse',
        label: 'Sparse statistic',
        value: null,
        units: 't',
        missing: true
      },
      {
        layerId: 'status',
        label: 'QC status',
        value: 'Detected',
        missing: false
      }
    ]
  });
}

function parcelInspection(): VertexInspection {
  return deepFreeze({
    surfaceId: 'lh',
    vertexIndex: 2,
    world: [10, 0, 5] as const,
    parcel: { id: 2, label: 'Motor' },
    atlas: { id: 'toy-atlas', name: 'Toy Atlas' },
    values: [{
      layerId: 'dense',
      label: 'Dense statistic',
      value: 3.5,
      units: 'z',
      missing: false
    }]
  });
}

function makeSnapshot(
  current: InspectionSelection = { kind: 'none' },
  inspection: VertexInspection | null = null,
  revision = 1
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
    surfaces: [{
      id: 'lh',
      label: 'Left cortex',
      hemisphere: 'left',
      visible: true,
      groupId: null,
      layers: [
        {
          id: 'dense',
          surfaceId: 'lh',
          label: 'Dense statistic',
          index: 0,
          role: 'data',
          pinned: null,
          reorderable: false,
          moveUp: fixed,
          moveDown: fixed,
          visible: true,
          opacity: 1,
          blendMode: 'normal'
        },
        {
          id: 'sparse',
          surfaceId: 'lh',
          label: 'Sparse statistic',
          index: 1,
          role: 'data',
          pinned: null,
          reorderable: false,
          moveUp: fixed,
          moveDown: fixed,
          visible: true,
          opacity: 1,
          blendMode: 'normal'
        },
        {
          id: 'status',
          surfaceId: 'lh',
          label: 'QC status',
          index: 2,
          role: 'data',
          pinned: null,
          reorderable: false,
          moveUp: fixed,
          moveDown: fixed,
          visible: true,
          opacity: 1,
          blendMode: 'normal'
        }
      ]
    }],
    selection: {
      current,
      inspection,
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
      scalarMapping: { enabled: false, reason: 'No scalar editor in this fixture.' },
      scientificSelection: enabled,
      figurePresets: enabled,
      figureBackground: enabled,
      exportPNG: enabled
    }
  });
}

class MutableSelectionTarget {
  private snapshot: SurfViewControlSnapshot;
  private readonly listeners = new Set<SurfViewControlSnapshotListener>();

  constructor(snapshot = makeSnapshot()) {
    this.snapshot = snapshot;
  }

  getSnapshot(): SurfViewControlSnapshot {
    return this.snapshot;
  }

  getLayerDataSummary() {
    return {
      ok: false as const,
      code: 'unsupported' as const,
      message: 'No scalar summary in this fixture.'
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

  publishSelection(current: InspectionSelection, inspection: VertexInspection | null): void {
    this.snapshot = makeSnapshot(current, inspection, this.snapshot.revision + 1);
    for (const listener of this.listeners) listener(this.snapshot);
  }

  publishUnrelatedRevision(): void {
    this.snapshot = makeSnapshot(
      this.snapshot.selection.current,
      this.snapshot.selection.inspection,
      this.snapshot.revision + 1
    );
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

async function mountFixture(snapshot = makeSnapshot()) {
  defineSurfViewControlsElement();
  const target = new MutableSelectionTarget(snapshot);
  const session = createSurfViewControlSession(
    target as unknown as SurfViewControlTarget,
    { focusedSurfaceId: 'lh', focusedLayerId: 'dense' }
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

describe('SurfView controls Selection inspector', () => {
  it('renders a compact, non-interactive none state', async () => {
    const fixture = await mountFixture();
    const section = fixture.element.shadowRoot!.querySelector<HTMLElement>(
      '.selection-section'
    )!;

    expect(section.dataset.empty).toBe('true');
    expect(section.querySelector('h3')?.textContent).toBe('Selection');
    expect(section.textContent).toContain('No vertex or parcel selected.');
    expect(section.querySelector('.selection-values')).toBeNull();
    expect(section.querySelectorAll('button, input, select, [tabindex]')).toHaveLength(0);

    fixture.session.dispose();
  });

  it('renders dense, sparse, missing, string, and world values exactly', async () => {
    const current = deepFreeze({
      kind: 'vertex' as const,
      surfaceId: 'lh',
      vertexIndex: 1
    });
    const inspection = vertexInspection();
    const fixture = await mountFixture(makeSnapshot(current, inspection));
    const section = fixture.element.shadowRoot!.querySelector<HTMLElement>(
      '.selection-section'
    )!;
    const normalized = section.textContent?.replace(/\s+/g, ' ');

    expect(section.dataset.empty).toBe('false');
    expect(section.querySelectorAll('dl')).toHaveLength(2);
    expect(normalized).toContain('Surface ID lh');
    expect(normalized).toContain('Vertex index 1');
    expect(normalized).toContain(
      'World coordinates X 0.123456789 Y 123456789.125 Z -1.23456789e-7'
    );
    expect(section.querySelector('[data-layer-value="dense"]')?.textContent
      ?.replace(/\s+/g, ' ')).toContain(
        'Dense statistic Focused layer 0.123456789 z'
      );
    expect(section.querySelector('[data-layer-value="dense"]')?.getAttribute('aria-current'))
      .toBe('true');
    expect(section.querySelector('[data-layer-value="sparse"]')?.textContent
      ?.replace(/\s+/g, ' ')).toContain('Sparse statistic Missing t');
    expect(section.querySelector('[data-layer-value="status"]')?.textContent
      ?.replace(/\s+/g, ' ')).toContain('QC status Detected');
    expect(section.querySelector('[data-layer-value="status"] .value-units')).toBeNull();
    expect(section.querySelectorAll('button, input, select, [tabindex]')).toHaveLength(0);

    fixture.session.dispose();
  });

  it('renders parcel and atlas metadata while degrading without a representative vertex', async () => {
    const current = deepFreeze({
      kind: 'parcel' as const,
      surfaceId: 'lh',
      parcelId: 2,
      representativeVertexIndex: 2,
      atlasId: 'toy-atlas'
    });
    const fixture = await mountFixture(makeSnapshot(current, parcelInspection()));
    const section = fixture.element.shadowRoot!.querySelector<HTMLElement>(
      '.selection-section'
    )!;
    const normalized = section.textContent?.replace(/\s+/g, ' ');

    expect(normalized).toContain('Parcel ID 2 · Motor');
    expect(normalized).toContain('Representative vertex 2');
    expect(normalized).toContain('Representative vertex world coordinates');
    expect(normalized).toContain('Layer values at representative vertex 2');
    expect(normalized?.match(/Motor/g)).toHaveLength(1);
    expect(normalized).toContain('Atlas Toy Atlas · toy-atlas');

    fixture.target.publishSelection({
      kind: 'parcel',
      surfaceId: 'lh',
      parcelId: 7
    }, null);
    await flush(fixture.element);
    expect(section.textContent).toContain('Parcel ID');
    expect(section.textContent).toContain('7');
    expect(section.textContent).toContain(
      'No representative vertex values are available for this parcel.'
    );
    expect(section.querySelector('.selection-values')).toBeNull();

    fixture.session.dispose();
  });

  it('changes emphasized value with focus without mutating scientific selection data', async () => {
    const current = deepFreeze({
      kind: 'vertex' as const,
      surfaceId: 'lh',
      vertexIndex: 1
    });
    const inspection = vertexInspection();
    const worldBefore = [...inspection.world];
    const valuesBefore = inspection.values.map(value => ({ ...value }));
    const fixture = await mountFixture(makeSnapshot(current, inspection));
    const root = fixture.element.shadowRoot!;
    const live = root.querySelector<HTMLElement>('[aria-live="polite"]')!;

    root.querySelector<HTMLButtonElement>(
      '[aria-label="Focus Sparse statistic for editing"]'
    )!.click();
    await flush(fixture.element);

    expect(root.querySelector('[data-layer-value="dense"]')?.getAttribute('aria-current'))
      .toBe('false');
    expect(root.querySelector('[data-layer-value="sparse"]')?.getAttribute('aria-current'))
      .toBe('true');
    expect(fixture.target.getSnapshot().selection.current).toBe(current);
    expect(fixture.target.getSnapshot().selection.inspection).toBe(inspection);
    expect(inspection.world).toEqual(worldBefore);
    expect(inspection.values).toEqual(valuesBefore);
    expect(Object.isFrozen(inspection.world)).toBe(true);
    expect(Object.isFrozen(inspection.values)).toBe(true);
    expect(live.textContent?.trim()).toBe('');

    fixture.session.dispose();
  });

  it('announces only discrete scientific selection changes', async () => {
    const fixture = await mountFixture();
    const live = fixture.element.shadowRoot!.querySelector<HTMLElement>(
      '[aria-live="polite"]'
    )!;
    const inspection = vertexInspection();

    fixture.target.publishSelection({
      kind: 'vertex',
      surfaceId: 'lh',
      vertexIndex: 1
    }, inspection);
    await flush(fixture.element);
    expect(live.textContent?.trim()).toBe('Selected vertex 1 on surface lh.');

    let mutations = 0;
    const observer = new MutationObserver(records => {
      mutations += records.length;
    });
    observer.observe(live, { childList: true, characterData: true, subtree: true });
    fixture.target.publishUnrelatedRevision();
    await flush(fixture.element);
    await Promise.resolve();
    observer.disconnect();
    expect(mutations).toBe(0);

    fixture.target.publishSelection({ kind: 'none' }, null);
    await flush(fixture.element);
    expect(live.textContent?.trim()).toBe('Selection cleared.');

    fixture.session.dispose();
  });

  it('announces representative and atlas identity changes within one parcel', async () => {
    const fixture = await mountFixture();
    const live = fixture.element.shadowRoot!.querySelector<HTMLElement>(
      '[aria-live="polite"]'
    )!;
    fixture.target.publishSelection({
      kind: 'parcel',
      surfaceId: 'lh',
      parcelId: 2,
      representativeVertexIndex: 2,
      atlasId: 'toy-atlas'
    }, parcelInspection());
    await flush(fixture.element);
    expect(live.textContent?.trim()).toBe(
      'Selected parcel 2 on surface lh, representative vertex 2, atlas toy-atlas.'
    );

    fixture.target.publishSelection({
      kind: 'parcel',
      surfaceId: 'lh',
      parcelId: 2,
      representativeVertexIndex: 3,
      atlasId: 'toy-atlas'
    }, { ...parcelInspection(), vertexIndex: 3 });
    await flush(fixture.element);
    expect(live.textContent?.trim()).toBe(
      'Selected parcel 2 on surface lh, representative vertex 3, atlas toy-atlas.'
    );

    fixture.target.publishSelection({
      kind: 'parcel',
      surfaceId: 'lh',
      parcelId: 2,
      representativeVertexIndex: 3,
      atlasId: 'other-atlas'
    }, { ...parcelInspection(), vertexIndex: 3 });
    await flush(fixture.element);
    expect(live.textContent?.trim()).toBe(
      'Selected parcel 2 on surface lh, representative vertex 3, atlas other-atlas.'
    );

    fixture.session.dispose();
  });

  it('falls back to focused-layer emphasis when an exclusive map is unavailable', async () => {
    const current = deepFreeze({
      kind: 'vertex' as const,
      surfaceId: 'lh',
      vertexIndex: 1
    });
    const base = makeSnapshot(current, vertexInspection());
    const fixture = await mountFixture(deepFreeze({
      ...base,
      capabilities: {
        ...base.capabilities,
        exclusiveMap: {
          availability: { enabled: false, reason: 'Report map unavailable.' },
          displayedLayerId: 'sparse',
          availableLayerIds: ['dense', 'sparse']
        }
      }
    }));
    const root = fixture.element.shadowRoot!;

    expect(root.querySelector('[data-layer-value="dense"]')?.getAttribute('aria-current'))
      .toBe('true');
    expect(root.querySelector('[data-layer-value="sparse"]')?.getAttribute('aria-current'))
      .toBe('false');

    fixture.session.dispose();
  });
});
