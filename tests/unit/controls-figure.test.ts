/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSurfViewControlSession } from '../../src';
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
const disabled = Object.freeze({ enabled: false, reason: 'Unavailable in fixture.' });

function snapshot(
  figure: Partial<SurfViewControlSnapshot['figure']> = {}
): SurfViewControlSnapshot {
  const presets = [
    { id: 'default', label: 'Default', availability: enabled },
    { id: 'paper-light', label: 'Paper Light', availability: enabled }
  ];
  return {
    revision: 1,
    view: {
      current: null,
      anatomicalViews: [],
      targets: [],
      fit: disabled,
      reset: disabled
    },
    surfaces: [],
    selection: {
      current: { kind: 'none' },
      inspection: null,
      vertexSelection: disabled,
      parcelSelection: disabled
    },
    figure: {
      preset: presets[0],
      availablePresets: presets,
      background: 0x102030,
      transparent: false,
      defaultWidth: 1200,
      defaultHeight: 900,
      defaultDpi: 150,
      defaultTransparent: false,
      defaultColorbar: false,
      exportPNG: enabled,
      ...figure
    },
    capabilities: {
      anatomicalViews: disabled,
      surfaceVisibility: disabled,
      layerVisibility: disabled,
      layerOpacity: disabled,
      layerBlendMode: disabled,
      layerOrder: disabled,
      scalarMapping: disabled,
      scientificSelection: disabled,
      figurePresets: enabled,
      figureBackground: enabled,
      exportPNG: enabled
    }
  };
}

class FigureTarget implements SurfViewControlTarget {
  private current = snapshot();
  private readonly listeners = new Set<SurfViewControlSnapshotListener>();
  private disposed = false;
  readonly presetRequests: string[] = [];
  readonly backgroundRequests: Array<readonly [number, boolean]> = [];
  readonly exportRequests: FigureExportRequest[] = [];
  nextExport: ControlCommandResult<FigureExportResult> | Promise<ControlCommandResult<FigureExportResult>> = {
    ok: true,
    value: {
      dataUrl: 'data:image/png;base64,ZmFrZQ==',
      mimeType: 'image/png',
      width: 1200,
      height: 900,
      filename: 'surfview.png'
    }
  };

  getSnapshot(): SurfViewControlSnapshot { return this.current; }
  getLayerDataSummary() {
    return { ok: false as const, code: 'unsupported' as const, message: 'Unavailable.' };
  }
  subscribe(listener: SurfViewControlSnapshotListener): SurfViewControlSubscription {
    let closed = false;
    this.listeners.add(listener);
    listener(this.current);
    return {
      get closed() { return closed; },
      unsubscribe: () => {
        if (closed) return;
        closed = true;
        this.listeners.delete(listener);
      }
    };
  }
  isDisposed(): boolean { return this.disposed; }
  dispose(): void { this.disposed = true; this.listeners.clear(); }

  applyFigurePreset(presetId: string): ControlCommandResult {
    this.presetRequests.push(presetId);
    const preset = this.current.figure.availablePresets.find(option => option.id === presetId);
    if (!preset) return { ok: false, code: 'invalid-value', message: 'Unknown preset.' };
    this.publish({
      ...this.current,
      figure: {
        ...this.current.figure,
        preset,
        background: presetId === 'paper-light' ? 0xffffff : 0x102030,
        transparent: presetId === 'paper-light',
        defaultWidth: presetId === 'paper-light' ? 2400 : 1200,
        defaultHeight: presetId === 'paper-light' ? 1800 : 900,
        defaultDpi: presetId === 'paper-light' ? 300 : 150,
        defaultTransparent: presetId === 'paper-light',
        defaultColorbar: presetId === 'paper-light'
      }
    });
    return { ok: true };
  }

  setFigureBackground(background: number, transparent = false): ControlCommandResult {
    this.backgroundRequests.push([background, transparent]);
    this.publish({
      ...this.current,
      figure: { ...this.current.figure, background, transparent }
    });
    return { ok: true };
  }

  async exportFigure(
    request: FigureExportRequest = {}
  ): Promise<ControlCommandResult<FigureExportResult>> {
    this.exportRequests.push(request);
    return this.nextExport;
  }

  replace(next: SurfViewControlSnapshot): void { this.publish(next); }

  setAnatomicalView(_request: SetAnatomicalViewRequest) { return this.unsupported(); }
  fitView() { return this.unsupported(); }
  resetView() { return this.unsupported(); }
  setSurfaceVisibility(_surfaceId: string, _visible: boolean) { return this.unsupported(); }
  setLayerVisibility(_address: LayerControlAddress, _visible: boolean) { return this.unsupported(); }
  setLayerOpacity(_address: LayerControlAddress, _opacity: number) { return this.unsupported(); }
  setLayerBlendMode(_address: LayerControlAddress, _blendMode: BlendMode) {
    return this.unsupported();
  }
  setLayerOrder(_surfaceId: string, _layerIds: readonly string[]) { return this.unsupported(); }
  updateScalarMapping(_address: LayerControlAddress, _update: ScalarMappingUpdate) {
    return this.unsupported();
  }
  setInspectionSelection(_selection: InspectionSelection) { return this.unsupported(); }
  setDisplayedLayer(_layerId: string) { return this.unsupported(); }

  private unsupported(): ControlCommandResult {
    return { ok: false, code: 'unsupported', message: 'Unavailable in fixture.' };
  }

  private publish(next: SurfViewControlSnapshot): void {
    this.current = { ...next, revision: this.current.revision + 1 };
    for (const listener of this.listeners) listener(this.current);
  }
}

function mountFigureControls(target = new FigureTarget()) {
  defineSurfViewControlsElement();
  const session = createSurfViewControlSession(target);
  const element = document.createElement(SURFVIEW_CONTROLS_TAG) as SurfViewControlsElement;
  element.session = session;
  document.body.appendChild(element);
  return { target, session, element };
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    }
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('Figure controls', () => {
  it('keeps export-only fields in a closed dialog and synchronizes preset/background state', async () => {
    const fixture = mountFigureControls();
    await fixture.element.updateComplete;
    const root = fixture.element.shadowRoot!;
    const dialog = root.querySelector<HTMLDialogElement>('dialog')!;

    expect(root.querySelector('#surfview-figure-heading')?.textContent).toBe('Figure');
    expect(dialog.open).toBe(false);
    expect(root.querySelector('input[name="width"]')?.closest('dialog')).toBe(dialog);
    expect(root.querySelector('.figure-defaults')?.textContent).toContain('1200 × 900 px');

    const preset = root.querySelector<HTMLSelectElement>(
      'select[aria-label="Figure style preset"]'
    )!;
    preset.value = 'paper-light';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.element.updateComplete;
    expect(fixture.target.presetRequests).toEqual(['paper-light']);
    expect(preset.value).toBe('paper-light');
    expect(root.querySelector('.figure-defaults')?.textContent).toContain('2400 × 1800 px');

    const color = root.querySelector<HTMLInputElement>(
      'input[aria-label="Figure background color"]'
    )!;
    color.value = '#123456';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.element.updateComplete;
    expect(fixture.target.backgroundRequests.at(-1)).toEqual([0x123456, true]);
    expect(root.querySelector('.background-value')?.textContent).toBe('#123456');

    const transparent = root.querySelector<HTMLInputElement>(
      '.figure-transparency input'
    )!;
    transparent.checked = false;
    transparent.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.element.updateComplete;
    expect(fixture.target.backgroundRequests.at(-1)).toEqual([0x123456, false]);
  });

  it('opens a labelled dialog, exports exact options, closes, and restores focus', async () => {
    const fixture = mountFigureControls();
    await fixture.element.updateComplete;
    const root = fixture.element.shadowRoot!;
    const open = root.querySelector<HTMLButtonElement>('.export-action')!;
    open.focus();
    open.click();
    await fixture.element.updateComplete;

    const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe('surfview-export-title');
    expect(root.activeElement).toBe(root.querySelector('input[name="width"]'));

    const setValue = (name: string, value: string) => {
      const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue('width', '4096');
    setValue('height', '2160');
    setValue('dpi', '300');
    setValue('filename', 'cortical-figure.png');
    setValue('title', 'Language contrast');
    setValue('subtitle', 'Group estimate');
    const transparent = root.querySelector<HTMLInputElement>('input[name="transparent"]')!;
    transparent.checked = true;
    transparent.dispatchEvent(new Event('change', { bubbles: true }));
    const colorbar = root.querySelector<HTMLInputElement>('input[name="colorbar"]')!;
    colorbar.checked = false;
    colorbar.dispatchEvent(new Event('change', { bubbles: true }));

    root.querySelector<HTMLFormElement>('.export-form')!
      .dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fixture.target.exportRequests).toHaveLength(1));
    await fixture.element.updateComplete;
    expect(fixture.target.exportRequests[0]).toEqual({
      width: 4096,
      height: 2160,
      dpi: 300,
      transparent: true,
      colorbar: false,
      filename: 'cortical-figure.png',
      title: 'Language contrast',
      subtitle: 'Group estimate'
    });
    expect(dialog.open).toBe(false);
    expect(root.activeElement).toBe(open);
    const status = root.querySelector<HTMLElement>('.message[role="status"]');
    expect(status?.textContent).toContain('Exported 1200 × 900 PNG.');
    expect(status?.dataset.tone).toBe('status');
  });

  it('keeps typed failures in the dialog and supports native cancel dismissal', async () => {
    const fixture = mountFigureControls();
    fixture.target.nextExport = {
      ok: false,
      code: 'unsupported',
      message: 'PNG export is unavailable.'
    };
    await fixture.element.updateComplete;
    const root = fixture.element.shadowRoot!;
    const open = root.querySelector<HTMLButtonElement>('.export-action')!;
    open.click();
    await fixture.element.updateComplete;
    const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
    root.querySelector<HTMLFormElement>('.export-form')!
      .dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(root.querySelector('[role="alert"]')?.textContent)
        .toBe('PNG export is unavailable.');
    });
    expect(dialog.open).toBe(true);

    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await fixture.element.updateComplete;
    expect(dialog.open).toBe(false);
    expect(root.activeElement).toBe(open);
  });

  it('reports target-level export unavailability without opening the dialog', async () => {
    const target = new FigureTarget();
    const fixture = mountFigureControls(target);
    target.replace(snapshot({
      exportPNG: {
        enabled: false,
        reason: 'PNG export requires an initialized browser viewer.'
      }
    }));
    await vi.waitFor(() => {
      expect(fixture.session.getSnapshot().canonical.figure.exportPNG.enabled)
        .toBe(false);
    });
    await fixture.element.updateComplete;
    const root = fixture.element.shadowRoot!;
    const open = root.querySelector<HTMLButtonElement>('.export-action')!;

    expect(open.disabled).toBe(true);
    expect(root.querySelector('.figure-availability')?.textContent)
      .toBe('PNG export requires an initialized browser viewer.');
    open.click();
    await fixture.element.updateComplete;
    expect(root.querySelector<HTMLDialogElement>('dialog')?.open).toBe(false);
    expect(target.exportRequests).toEqual([]);
  });

  it('reflects theme and density vocabularies without overriding host typography', async () => {
    const fixture = mountFigureControls();
    fixture.element.style.fontFamily = 'Georgia, serif';
    fixture.element.theme = 'dark';
    fixture.element.density = 'compact';
    await fixture.element.updateComplete;

    expect(fixture.element.getAttribute('theme')).toBe('dark');
    expect(fixture.element.getAttribute('density')).toBe('compact');
    expect(fixture.element.style.fontFamily).toBe('Georgia, serif');
    expect(SurfViewControlsElement.styles.toString()).toContain(
      ":host([theme='dark'])"
    );
    expect(SurfViewControlsElement.styles.toString()).toContain(
      ":host([density='compact'])"
    );
  });
});
