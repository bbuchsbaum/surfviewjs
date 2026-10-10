import { AtlasPlateView, parseAtlasFigureSpec, renderAtlasFigureSVG } from '@src/index.js';
import type { AtlasFigureSource, AtlasFigureSpec, AtlasPlate } from '@src/index.js';
import { action, actions, note, section, select, toggle } from '../kit/controls';

interface ComposerOptions {
  /** The figure area inside the film: plate sections and the region-detail slot. */
  sheet: HTMLElement;
  /** Margin controls host; the composer appends its Figure and Inspect sections. */
  panel: HTMLElement;
  /** The printed figure title on the sheet. */
  title: HTMLElement;
  views: AtlasPlateView[];
  plates: AtlasPlate[];
  legend: () => AtlasFigureSpec['legend'];
  subtitle: () => string;
}

export interface AtlasDemoComposer {
  refresh(): void;
  select(id: number | null): void;
  error(message: string): void;
  dispose(): void;
}

function download(contents: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Application-owned controls around the reusable figure and view APIs. */
export function mountAtlasComposer(options: ComposerOptions): AtlasDemoComposer {
  const { panel, sheet, views, plates, title } = options;
  const listeners: Array<() => void> = [];
  const on = (target: EventTarget, type: string, listener: EventListener) => {
    target.addEventListener(type, listener);
    listeners.push(() => target.removeEventListener(type, listener));
  };

  const figureSection = section(panel, 'Figure');
  const titleRow = document.createElement('div');
  titleRow.className = 'control control-text';
  const titleLabel = document.createElement('label');
  titleLabel.htmlFor = 'atlas-figure-title';
  titleLabel.textContent = 'Figure title';
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'atlas-figure-title';
  input.maxLength = 120;
  input.value = title.textContent ?? '';
  titleRow.append(titleLabel, input);
  figureSection.append(titleRow);

  const viewGrid = sheet.querySelector<HTMLElement>('.atlas-views')!;
  const arrange = () => { viewGrid.dataset.columns = columns.element.value; };
  const columns = select(figureSection, {
    id: 'atlas-figure-columns',
    label: 'Panel arrangement',
    options: [{ value: '1', label: 'Stacked' }, { value: '2', label: 'Side by side' }],
    value: '2',
    onChange: arrange
  });
  arrange();

  toggle(figureSection, {
    id: 'atlas-edit-labels',
    label: 'Move & pin labels',
    checked: false,
    onChange: checked => { for (const view of views) view.setLabelEditing(checked); }
  });
  note(figureSection, 'Drag a name to pin it. Arrow keys move a focused name; Escape unpins it.');
  const pins = actions(figureSection);
  action(pins, {
    id: 'atlas-reset-labels',
    label: 'Reset label pins',
    onClick: () => { for (const view of views) view.resetLabels(); refresh(); }
  });
  const exportRow = actions(figureSection);
  action(exportRow, {
    id: 'atlas-export-figure',
    label: 'Export complete figure · SVG',
    kind: 'primary',
    onClick: () => download(renderAtlasFigureSVG(figure(), sources()), 'atlas-figure.svg', 'image/svg+xml;charset=utf-8')
  });
  const layoutRow = actions(figureSection);
  action(layoutRow, {
    id: 'atlas-save-layout',
    label: 'Save layout',
    onClick: () => {
      download(JSON.stringify(figure(), null, 2), 'atlas-figure-layout.json', 'application/json');
      status.textContent = 'Layout saved. Fills remain controlled by the current data.';
    }
  });
  const file = document.createElement('input');
  file.type = 'file';
  file.id = 'atlas-layout-file';
  file.accept = 'application/json,.json';
  file.hidden = true;
  action(layoutRow, { id: 'atlas-load-layout', label: 'Load layout', onClick: () => file.click() });
  figureSection.append(file);
  const status = note(figureSection, 'No pinned labels', 'margin-note atlas-composer-status');
  status.id = 'atlas-composer-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const inspectSection = section(panel, 'Inspect');
  const adaptive = toggle(inspectSection, {
    id: 'atlas-adaptive-labels',
    label: 'Reveal labels with zoom',
    checked: true,
    onChange: checked => {
      for (const view of views) view.setAdaptiveLabels(checked);
      focusView?.setAdaptiveLabels(checked);
    }
  });
  const inspect = action(actions(inspectSection), {
    id: 'atlas-inspect-region',
    label: 'Inspect selected region',
    onClick: () => showFocus()
  });
  inspect.disabled = true;
  note(inspectSection, 'Zoom a plate, then drag to pan. Inspection leaves the saved figure framing unchanged.');

  on(input, 'input', () => { title.textContent = input.value; });

  const sources = (): Map<string, AtlasFigureSource> => new Map(plates.map((plate, i) =>
    [`${plate.hemisphere}-${plate.view}`, { plate, style: views[i]!.getStyle() }]));
  const figure = (): AtlasFigureSpec => ({
    version: 1,
    title: input.value,
    subtitle: options.subtitle(),
    columns: Number(columns.element.value) as 1 | 2,
    panels: plates.map((plate, i) => ({
      key: `${plate.hemisphere}-${plate.view}`,
      title: `${plate.hemisphere === 'left' ? 'Left' : 'Right'} ${plate.view}`,
      layout: views[i]!.getLayout()
    })),
    legend: options.legend()
  });

  let disposed = false;
  on(file, 'change', async () => {
    try {
      const selected = file.files?.[0];
      if (!selected) return;
      if (selected.size > 1_000_000) throw new RangeError('Layout file exceeds 1 MB');
      const value: unknown = JSON.parse(await selected.text());
      if (disposed) return;
      const spec = parseAtlasFigureSpec(value, sources());
      if (spec.panels.length !== plates.length) throw new RangeError('This chapter requires both lateral and medial panels');
      // Validate every panel first; an incompatible atlas must change nothing.
      for (const [i, plate] of plates.entries()) {
        views[i]!.setLayout(spec.panels.find(p => p.key === `${plate.hemisphere}-${plate.view}`)!.layout);
      }
      columns.set(String(spec.columns) as '1' | '2');
      arrange();
      input.value = spec.title;
      title.textContent = spec.title;
      status.textContent = 'Layout restored; current colors retained.';
    } catch (error) {
      if (!disposed) status.textContent = `Could not load layout: ${String(error)}`;
    } finally {
      file.value = '';
    }
  });

  const zoomTools: HTMLElement[] = [];
  for (const [i, figureElement] of Array.from(sheet.querySelectorAll<HTMLElement>('.atlas-figure')).entries()) {
    const bar = document.createElement('div');
    bar.className = 'atlas-zoom-tools';
    const view = plates[i]!.view;
    bar.innerHTML = `<button type="button" class="action" data-zoom="out" aria-label="Zoom out ${view}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7"/></svg></button>` +
      `<output aria-live="polite">1×</output>` +
      `<button type="button" class="action" data-zoom="in" aria-label="Zoom in ${view}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7M6 2.5v7"/></svg></button>` +
      `<button type="button" class="action" data-zoom="reset" aria-label="Fit ${view}">Fit</button>`;
    figureElement.querySelector('.atlas-figure-heading')!.append(bar);
    on(bar, 'click', event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (!button) return;
      const zoom = views[i]!.getViewport().zoom;
      const next = button.dataset.zoom === 'reset' ? 1 : Math.max(1, Math.min(8, zoom * (button.dataset.zoom === 'in' ? 2 : 0.5)));
      // A zoomed plate leaves the fit-to-film size first, so its labels are laid out at the larger size.
      figureElement.dataset.zoomed = String(next > 1);
      views[i]!.setZoom(next);
      bar.querySelector('output')!.textContent = `${views[i]!.getViewport().zoom}×`;
    });
    zoomTools.push(bar);
  }

  const focus = document.createElement('section');
  focus.className = 'atlas-focus';
  focus.hidden = true;
  focus.innerHTML = `<div class="atlas-focus-heading"><div><h2></h2><p></p></div>` +
    `<button type="button" class="action" aria-label="Close region detail">Close</button></div><div class="atlas-focus-canvas"></div>`;
  sheet.querySelector('.atlas-sheet-heading')!.after(focus);
  let selectedId: number | null = null;
  let focusView: AtlasPlateView | null = null;
  function closeFocus(): void {
    focusView?.dispose();
    focusView = null;
    focus.hidden = true;
  }
  on(focus.querySelector('button')!, 'click', closeFocus);
  function showFocus(): void {
    closeFocus();
    const candidates = plates.map((plate, i) => ({ plate, i, region: plate.regions.find(p => p.id === selectedId) }))
      .filter(p => p.region).sort((a, b) => b.region!.visibleArea - a.region!.visibleArea);
    const best = candidates[0];
    if (!best || selectedId === null) {
      status.textContent = 'This region is hidden in both supplied projections.';
      return;
    }
    focus.hidden = false;
    focus.querySelector('h2')!.textContent = `${selectedId} · ${best.region!.label}`;
    focus.querySelector('p')!.textContent = `Region detail · ${best.plate.hemisphere} ${best.plate.view} · the plates below keep their framing`;
    focusView = new AtlasPlateView(focus.querySelector<HTMLElement>('.atlas-focus-canvas')!, best.plate, {
      ...views[best.i]!.getStyle(),
      adaptiveLabels: adaptive.input.checked
    });
    focusView.focusParcel(selectedId);
    focus.scrollIntoView({ block: 'nearest' });
  }
  function refresh(): void {
    input.value = title.textContent ?? '';
    status.textContent = `${views.reduce((n, view) => n + view.getLayout().labels.length, 0)} pinned labels`;
    for (const [i, bar] of zoomTools.entries()) bar.querySelector('output')!.textContent = `${views[i]!.getViewport().zoom}×`;
    if (focusView) showFocus();
  }
  return {
    refresh,
    error: message => { status.textContent = message; },
    select: id => {
      selectedId = id;
      inspect.disabled = id === null;
      if (focusView) {
        if (id === null) closeFocus();
        else showFocus();
      }
    },
    dispose: () => {
      disposed = true;
      closeFocus();
      for (const dispose of listeners) dispose();
      focus.remove();
      figureSection.remove();
      inspectSection.remove();
      for (const bar of zoomTools) bar.remove();
    }
  };
}
