import { AtlasPlateView, parseAtlasFigureSpec, renderAtlasFigureSVG } from '@src/index';
import type { AtlasFigureSource, AtlasFigureSpec, AtlasPlate } from '@src/index';

interface ComposerOptions {
  sheet: HTMLElement;
  panel: HTMLElement;
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
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Application-owned controls around the reusable figure and view APIs. */
export function mountAtlasComposer(options: ComposerOptions): AtlasDemoComposer {
  const { panel, sheet, views, plates } = options;
  const controls = document.createElement('div');
  controls.className = 'atlas-control-section atlas-composer';
  controls.innerHTML = `<span class="atlas-eyebrow">FIGURE</span>
    <label for="atlas-figure-title">Figure title</label><input id="atlas-figure-title" type="text" maxlength="120"/>
    <label for="atlas-figure-columns">Panel arrangement</label><select id="atlas-figure-columns"><option value="1">Stacked</option><option value="2">Side by side</option></select>
    <label class="atlas-check"><input id="atlas-edit-labels" type="checkbox"/> Move & pin labels</label>
    <p>Drag a name to pin it. Arrow keys move a focused name; Escape unpins it.</p>
    <button id="atlas-reset-labels">Reset label pins</button>
    <button id="atlas-export-figure">Export complete figure · SVG</button>
    <div class="atlas-composer-actions"><button id="atlas-save-layout">Save layout</button><button id="atlas-load-layout">Load layout</button></div>
    <input id="atlas-layout-file" type="file" accept="application/json,.json" hidden/>
    <p id="atlas-composer-status" role="status" aria-live="polite">No pinned labels</p>
    <span class="atlas-eyebrow">INSPECT</span>
    <label class="atlas-check"><input id="atlas-adaptive-labels" type="checkbox" checked/> Reveal labels with zoom</label>
    <button id="atlas-inspect-region" disabled>Inspect selected region</button>
    <p>Zoom a plate, then drag to pan. Inspection leaves the saved figure framing unchanged.</p>`;
  panel.querySelector('.atlas-control-section')!.after(controls);
  const input = controls.querySelector<HTMLInputElement>('#atlas-figure-title')!;
  const columns = controls.querySelector<HTMLSelectElement>('#atlas-figure-columns')!;
  const status = controls.querySelector<HTMLElement>('#atlas-composer-status')!;
  const inspect = controls.querySelector<HTMLButtonElement>('#atlas-inspect-region')!;
  input.value = sheet.querySelector('h1')!.textContent!;
  input.addEventListener('input', () => { sheet.querySelector('h1')!.textContent = input.value; });
  const arrange = (): void => { sheet.querySelector<HTMLElement>('.atlas-views')!.dataset.columns = columns.value; };
  columns.addEventListener('change', arrange); arrange();
  const sources = (): Map<string, AtlasFigureSource> => new Map(plates.map((plate, i) =>
    [`${plate.hemisphere}-${plate.view}`, { plate, style: views[i]!.getStyle() }]));
  const figure = (): AtlasFigureSpec => ({
    version: 1, title: input.value, subtitle: options.subtitle(), columns: Number(columns.value) as 1 | 2,
    panels: plates.map((plate, i) => ({ key: `${plate.hemisphere}-${plate.view}`,
      title: `${plate.hemisphere === 'left' ? 'Left' : 'Right'} ${plate.view}`, layout: views[i]!.getLayout() })),
    legend: options.legend()
  });
  controls.querySelector('#atlas-export-figure')!.addEventListener('click', () => {
    download(renderAtlasFigureSVG(figure(), sources()), 'atlas-figure.svg', 'image/svg+xml;charset=utf-8');
  });
  controls.querySelector('#atlas-save-layout')!.addEventListener('click', () => {
    download(JSON.stringify(figure(), null, 2), 'atlas-figure-layout.json', 'application/json');
    status.textContent = 'Layout saved. Fills remain controlled by the current data.';
  });
  const file = controls.querySelector<HTMLInputElement>('#atlas-layout-file')!;
  controls.querySelector('#atlas-load-layout')!.addEventListener('click', () => file.click());
  let disposed = false;
  file.addEventListener('change', async () => {
    try {
      const selected = file.files?.[0];
      if (!selected) return;
      if (selected.size > 1_000_000) throw new RangeError('Layout file exceeds 1 MB');
      const value: unknown = JSON.parse(await selected.text());
      if (disposed) return;
      const spec = parseAtlasFigureSpec(value, sources());
      if (spec.panels.length !== plates.length) throw new RangeError('This demo requires both lateral and medial panels');
      // Validate every panel first; an incompatible atlas must change nothing.
      for (const [i, plate] of plates.entries()) views[i]!.setLayout(spec.panels.find(p => p.key === `${plate.hemisphere}-${plate.view}`)!.layout);
      columns.value = String(spec.columns); arrange();
      input.value = spec.title; sheet.querySelector('h1')!.textContent = spec.title;
      status.textContent = 'Layout restored; current colors retained.';
    } catch (error) { if (!disposed) status.textContent = `Could not load layout: ${String(error)}`; }
    finally { file.value = ''; }
  });
  controls.querySelector('#atlas-edit-labels')!.addEventListener('change', event => {
    for (const view of views) view.setLabelEditing((event.target as HTMLInputElement).checked);
  });
  controls.querySelector('#atlas-reset-labels')!.addEventListener('click', () => {
    for (const view of views) view.resetLabels(); refresh();
  });
  controls.querySelector('#atlas-adaptive-labels')!.addEventListener('change', event => {
    for (const view of views) view.setAdaptiveLabels((event.target as HTMLInputElement).checked);
    focusView?.setAdaptiveLabels((event.target as HTMLInputElement).checked);
  });
  const zoomTools: HTMLElement[] = [];
  for (const [i, section] of Array.from(sheet.querySelectorAll<HTMLElement>('.atlas-figure')).entries()) {
    const bar = document.createElement('div'); bar.className = 'atlas-zoom-tools';
    bar.innerHTML = `<button data-zoom="out" aria-label="Zoom out ${plates[i]!.view}">−</button><output>1×</output>
      <button data-zoom="in" aria-label="Zoom in ${plates[i]!.view}">+</button><button data-zoom="reset">Fit</button>`;
    section.querySelector('.atlas-figure-heading')!.append(bar);
    bar.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (!button) return;
      const zoom = views[i]!.getViewport().zoom;
      views[i]!.setZoom(button.dataset.zoom === 'reset' ? 1 : Math.max(1, Math.min(8, zoom * (button.dataset.zoom === 'in' ? 2 : 0.5))));
      bar.querySelector('output')!.textContent = `${views[i]!.getViewport().zoom}×`;
    });
    zoomTools.push(bar);
  }
  const focus = document.createElement('section'); focus.className = 'atlas-focus'; focus.hidden = true;
  focus.innerHTML = `<div class="atlas-focus-heading"><div><span class="atlas-eyebrow">REGION DETAIL</span><h2></h2><p></p></div>
    <button aria-label="Close region detail">×</button></div><div class="atlas-focus-canvas"></div>`;
  sheet.querySelector('.atlas-sheet-heading')!.after(focus);
  let selectedId: number | null = null, focusView: AtlasPlateView | null = null;
  function closeFocus(): void { focusView?.dispose(); focusView = null; focus.hidden = true; }
  focus.querySelector('button')!.addEventListener('click', closeFocus);
  function showFocus(): void {
    closeFocus();
    const candidates = plates.map((plate, i) => ({ plate, i, region: plate.regions.find(p => p.id === selectedId) }))
      .filter(p => p.region).sort((a, b) => b.region!.visibleArea - a.region!.visibleArea);
    const best = candidates[0];
    if (!best || selectedId === null) { status.textContent = 'This region is hidden in both supplied projections.'; return; }
    focus.hidden = false;
    focus.querySelector('h2')!.textContent = `${selectedId} · ${best.region!.label}`;
    focus.querySelector('p')!.textContent = `${best.plate.hemisphere} ${best.plate.view} · context remains on the plates below`;
    focusView = new AtlasPlateView(focus.querySelector<HTMLElement>('.atlas-focus-canvas')!, best.plate, {
      ...views[best.i]!.getStyle(), adaptiveLabels: controls.querySelector<HTMLInputElement>('#atlas-adaptive-labels')!.checked
    });
    focusView.focusParcel(selectedId);
    focus.scrollIntoView({ block: 'nearest' });
  }
  inspect.addEventListener('click', showFocus);
  function refresh(): void {
    input.value = sheet.querySelector('h1')!.textContent!;
    status.textContent = `${views.reduce((n, view) => n + view.getLayout().labels.length, 0)} pinned labels`;
    for (const [i, bar] of zoomTools.entries()) bar.querySelector('output')!.textContent = `${views[i]!.getViewport().zoom}×`;
    if (focusView) showFocus();
  }
  return { refresh, error: message => { status.textContent = message; },
    select: id => { selectedId = id; inspect.disabled = id === null; if (focusView) { if (id === null) closeFocus(); else showFocus(); } },
    dispose: () => { disposed = true; closeFocus(); focus.remove(); controls.remove(); for (const bar of zoomTools) bar.remove(); }
  };
}
