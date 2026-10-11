import './atlasPlates.css';
import { AtlasPlateView, ColorMap, buildAtlasPlate, parseAtlasPlateLayout } from '@src/index.js';
import type { AtlasPlate, AtlasPlateInput, ParcelData } from '@src/index.js';
import excerpt from '../excerpts/atlasPlates.ts?raw';
import { action, actions, fmt, note, section, select, slider, toggle } from '../kit/controls';
import { loadAtlas, loadMesh, type ATLAS_URLS, type AtlasFile } from '../kit/data';
import type { Scenario } from '../types';
import { mountAtlasComposer, type AtlasDemoComposer } from './atlasComposer';
import { mutedNetworkColors, networkNames, networkOf, shortParcelName } from './atlasPalettes';

const ATLASES: ReadonlyArray<{
  id: 'glasser' | 'schaefer400-7' | 'schaefer400-17';
  file: keyof typeof ATLAS_URLS;
  title: string;
  option: string;
  description: string;
  license: string;
  citation: string;
}> = [
  {
    id: 'glasser', file: 'glasser', title: 'HCP–MMP1.0', option: 'HCP–MMP1.0',
    description: 'Glasser et al., 2016 · 180 left parcels',
    license: new URL('../data/glasser/LICENSE.txt', import.meta.url).href,
    citation: 'https://doi.org/10.1038/nature18933'
  },
  {
    id: 'schaefer400-7', file: 'schaefer400x7', title: 'Schaefer–Yeo 400', option: 'Schaefer–Yeo 400 · 7 networks',
    description: '7 networks · 200 of 400 parcels (left)',
    license: new URL('../data/schaefer/LICENSE.txt', import.meta.url).href,
    citation: 'https://doi.org/10.1093/cercor/bhx179'
  },
  {
    id: 'schaefer400-17', file: 'schaefer400x17', title: 'Schaefer–Yeo 400', option: 'Schaefer–Yeo 400 · 17 networks',
    description: '17 networks · 200 of 400 parcels (left)',
    license: new URL('../data/schaefer/LICENSE.txt', import.meta.url).href,
    citation: 'https://doi.org/10.1093/cercor/bhx179'
  }
];

type DemoAtlas = AtlasFile & ParcelData & { parcels: Array<{ id: number; label: string; color: string }> };
type FillMode = 'highlights' | 'neutral' | 'muted' | 'atlas' | 'values';

const FILLS: ReadonlyArray<{ value: FillMode; label: string }> = [
  { value: 'highlights', label: 'Peach and orange highlights' },
  { value: 'neutral', label: 'Uncolored' },
  { value: 'muted', label: 'Muted network colors' },
  { value: 'atlas', label: 'Original atlas colors' },
  { value: 'values', label: 'Example values (synthetic)' }
];
const BOUNDARIES = [
  { value: 'fine', label: 'Fine solid' },
  { value: 'dashed', label: 'Fine dashed' },
  { value: 'halo', label: 'Dashed with white bands' }
] as const;

/** Glasser areas the "highlights" fill marks as primary (orange) and secondary (peach). */
const PRIMARY = new Set(['V1', 'V2', '4', '3a', '3b', '1', '2', 'FEF', 'MT', 'MST', 'A1', '43', '44', '45']);
const SECONDARY = new Set(['6a', '6d', '6mp', '6ma', '6r', '6v', '55b', '7AL', '7PC', 'AIP', 'LIPd', 'LIPv', 'MIP', 'VIP', 'PF',
  'PFm', 'PFt', 'PGi', 'PGs', 'PGp', 'SFL', 'SCEF', 'POS2', '7Am', '7Pm', '31a', '31pd', '31pv', 'PCV', 'RSC', 'OFC', 'a24',
  'p24pr', 'p32pr']);

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const atlasPlates: Scenario = {
  id: 'atlas-illustration',
  aliases: [],
  title: 'Atlas plates',
  short: 'Plates',
  group: 'atlases',
  tags: ['atlas', 'Glasser', 'Schaefer', 'labels', 'svg', 'publication'],
  summary:
    'Glasser HCP–MMP1.0 or Schaefer–Yeo 400 parcels on the fs_LR 32k inflated left hemisphere, drawn as lateral and medial vector plates with smoothed boundaries and collision-free names. Choose region fills, label text and boundary style; click a region or its name to select it, give it a custom fill, drag names to pin them, zoom a plate to inspect, and export each plate or the composed figure as SVG.',
  synthetic:
    'Parcels and names are the published atlases. Only the "Example values" fill is synthetic (a sine of the parcel ID), included to show value-to-color mapping.',
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fs_LR 32k surface and atlases');
    let choice = ATLASES.find(atlas => atlas.id === ctx.params.get('atlas')) ?? ATLASES[0]!;
    const [geometry, datasets] = await Promise.all([
      loadMesh('fsLR32kLeftInflated'),
      Promise.all(ATLASES.map(atlas => loadAtlas(atlas.file) as Promise<DemoAtlas>))
    ]);
    let data = datasets[ATLASES.indexOf(choice)]!;
    const film = ctx.film;
    const isGlasser = () => choice.id === 'glasser';
    const input = (): AtlasPlateInput => ({
      vertices: geometry.vertices, faces: geometry.faces, vertexLabels: data.vertexLabels,
      parcelData: data, hemisphere: 'left',
      provenance: {
        source: String(data.source?.url ?? ''), checksum: `sha256:${String(data.source?.sha256 ?? '')}`,
        citation: String(data.source?.citation ?? ''), license: String(data.source?.license ?? '')
      }
    });
    let smoothing = 4;
    let allLabels = false;
    let labelMode: 'names' | 'ids' = isGlasser() ? 'names' : 'ids';
    let mode: FillMode = isGlasser() ? 'highlights' : 'muted';
    let palette = 'viridis';
    let selected: number | null = null;
    let composer: AtlasDemoComposer | null = null;
    const overrides = new Map<number, string>();
    const groups = (): Map<number, string> => new Map(isGlasser() ? [] :
      data.parcels.map(parcel => [parcel.id, networkOf(parcel.label) ?? '']));
    const metrics = document.createElement('canvas').getContext('2d');
    const makePlates = (): AtlasPlate[] => (['lateral', 'medial'] as const).map(view => buildAtlasPlate(input(), {
      view, width: 1200, height: 850, fontSize: 14, padding: 85,
      maxLeaderLength: allLabels ? 2000 : 90, contourSmoothing: smoothing,
      minLabelArea: allLabels ? 0 : 12,
      calloutGap: allLabels ? 12 : 20,
      detailScales: [2, 4, 8],
      parcelGroups: groups(),
      labelText: parcel => labelMode === 'ids' ? String(parcel.id) : isGlasser() ? parcel.label : shortParcelName(parcel.label),
      measureText: (text, size) => {
        if (!metrics) return text.length * size * 0.72;
        metrics.font = `${size}px Arial`;
        return metrics.measureText(text).width;
      }
    }));
    const plates = makePlates();

    // The film holds the printed plates; the scan corners sit in bands above and below them.
    const stage = document.createElement('div');
    stage.className = 'atlas-stage';
    const sheet = document.createElement('div');
    sheet.className = 'atlas-sheet';
    sheet.innerHTML = `<header class="atlas-sheet-heading">
        <h2 class="atlas-title"></h2>
        <p class="atlas-subtitle">Left hemisphere · regions, boundaries and names</p>
        <p class="atlas-key" id="atlas-color-note"></p>
        <div class="atlas-network-legend" aria-label="Network color key"></div>
      </header>
      <div class="atlas-views"></div>
      <footer class="atlas-sheet-footer"><span id="atlas-source-note"></span></footer>`;
    stage.append(sheet);
    ctx.mount.replaceChildren(stage);
    const title = sheet.querySelector<HTMLElement>('.atlas-title')!;
    title.textContent = choice.title;
    const sourceNote = sheet.querySelector<HTMLElement>('#atlas-source-note')!;
    sourceNote.textContent = `${choice.description} · fs_LR 32k · inflated surface`;

    const views: AtlasPlateView[] = [];
    const links = document.createElement('p');
    const citation = document.createElement('a');
    const license = document.createElement('a');
    for (const [link, id, text] of [[citation, 'atlas-citation', 'Atlas publication'], [license, 'atlas-license', 'Demo data license']] as const) {
      link.id = id;
      link.textContent = text;
      link.target = '_blank';
      link.rel = 'noreferrer';
    }
    citation.href = choice.citation;
    license.href = choice.license;
    function colors(): Map<number, string> {
      const colormap = ColorMap.fromPreset(palette, { range: [-1, 1] });
      return new Map(data.parcels.map(parcel => {
        let fill = '#fffdf9';
        if (mode === 'highlights') fill = PRIMARY.has(parcel.label) ? '#dfa363' : SECONDARY.has(parcel.label) ? '#f1cfaa' : fill;
        else if (mode === 'muted') fill = mutedNetworkColors[networkOf(parcel.label) ?? ''] ?? fill;
        else if (mode === 'atlas') fill = parcel.color ?? fill;
        else if (mode === 'values') {
          // Explicitly synthetic: exercises value-to-color mapping, not an atlas measurement.
          const rgb = colormap.getColor(Math.sin(parcel.id * 0.17));
          fill = '#' + rgb.slice(0, 3).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        }
        return [parcel.id, overrides.get(parcel.id) ?? fill];
      }));
    }
    const summaryText = (plate: AtlasPlate) =>
      `${plate.labels.length} labelled of ${plate.regions.length} visible parcels` +
      (plate.unlabeledParcelIds.length ? ' · further names in the region list' : '');

    for (const [index, plate] of plates.entries()) {
      const figure = document.createElement('section');
      figure.className = 'atlas-figure';
      figure.dataset.view = plate.view;
      figure.innerHTML = `<div class="atlas-figure-heading">
          <h3><span>${index ? 'B' : 'A'}</span>${plate.view === 'lateral' ? 'Lateral' : 'Medial'}</h3>
          <div class="atlas-export">
            <button type="button" class="action" data-export="svg" aria-label="Export ${plate.view} SVG">SVG</button>
            <button type="button" class="action" data-export="png" aria-label="Export ${plate.view} PNG">PNG</button>
          </div>
        </div>`;
      const view = new AtlasPlateView(figure, plate, {
        colors: colors(),
        onParcelClick: selectRegion,
        onLayoutChange: () => composer?.refresh(),
        onViewportChange: viewport => { figure.dataset.zoomed = String(viewport.zoom > 1); },
        onInteractionError: error => composer?.error(error.message)
      });
      views.push(view);
      const summary = document.createElement('p');
      summary.className = 'atlas-figure-summary';
      summary.textContent = summaryText(plate);
      figure.append(summary);
      sheet.querySelector('.atlas-views')!.append(figure);
      figure.querySelector('[data-export="svg"]')!.addEventListener('click', () => {
        download(new Blob([view.toSVG()], { type: 'image/svg+xml;charset=utf-8' }), `${choice.id}-left-${plate.view}.svg`);
      });
      figure.querySelector('[data-export="png"]')!.addEventListener('click', async event => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        try {
          download(await view.exportPNG(3), `${choice.id}-left-${plate.view}.png`);
        } catch (error) {
          ctx.status(String(error));
        } finally {
          button.disabled = false;
        }
      });
    }

    // ── margin: atlas ──
    const atlasSection = section(ctx.panel, 'Atlas');
    select(atlasSection, {
      id: 'atlas-dataset',
      label: 'Parcellation',
      options: ATLASES.map(atlas => ({ value: atlas.id, label: atlas.option })),
      value: choice.id,
      onChange: next => changeAtlas(next)
    });
    const datasetNote = note(atlasSection, choice.description);
    datasetNote.id = 'atlas-dataset-note';
    film.set('tl', 'surface', 'Surface', 'fs_LR 32k inflated, L');

    // ── margin: appearance ──
    const appearance = section(ctx.panel, 'Appearance');
    const fill = select(appearance, {
      id: 'atlas-fill',
      label: 'Region fills',
      options: FILLS,
      value: mode,
      print: { film, corner: 'tr', key: 'fills', label: 'Fills' },
      onChange: next => {
        mode = next;
        paletteSelect.element.disabled = mode !== 'values';
        refresh();
      }
    });
    const paletteSelect = select(appearance, {
      id: 'atlas-palette',
      label: 'Value colormap',
      options: [{ value: 'viridis', label: 'Viridis' }, { value: 'RdBu', label: 'Red–blue' }, { value: 'oranges', label: 'Oranges' }],
      value: 'viridis',
      onChange: next => { palette = next; refresh(); }
    });
    paletteSelect.element.disabled = true;
    toggle(appearance, {
      id: 'atlas-labels',
      label: 'Show region names',
      checked: true,
      onChange: checked => { for (const view of views) view.setLabelsVisible(checked); }
    });
    const labelSelect = select(appearance, {
      id: 'atlas-label-text',
      label: 'Label text',
      options: [{ value: 'names', label: 'Region names' }, { value: 'ids', label: 'Parcel IDs · full names on hover' }],
      value: labelMode,
      onChange: next => {
        const previous = labelMode;
        labelMode = next;
        try {
          rebuild();
        } catch (error) {
          labelMode = previous;
          labelSelect.set(previous);
          composer?.error(`${String(error)}. Reset label pins before changing label text.`);
        }
      }
    });
    select(appearance, {
      id: 'atlas-label-layout',
      label: 'Label layout',
      options: [{ value: 'balanced', label: 'Balanced · short callouts' }, { value: 'all', label: 'All visible · extended callouts' }],
      value: 'balanced',
      onChange: next => { allLabels = next === 'all'; rebuild(); }
    });
    const smoothingControl = slider(appearance, {
      id: 'atlas-smoothing',
      label: 'Border smoothing',
      min: 0, max: 8, step: 0.5, value: smoothing,
      format: value => (value === 0 ? 'off' : fmt(value, 1)),
      print: { film, corner: 'bl', key: 'smoothing', label: 'Smoothing' },
      onInput: () => {}
    });
    smoothingControl.input.addEventListener('change', () => {
      smoothing = Number(smoothingControl.input.value);
      rebuild();
    });
    note(appearance, 'Off keeps the sampled edges; higher values soften small contour details. Applied on release.');
    select(appearance, {
      id: 'atlas-boundary-style',
      label: 'Boundary style',
      options: BOUNDARIES,
      value: 'fine',
      print: { film, corner: 'bl', key: 'boundary', label: 'Boundary' },
      onChange: value => {
        for (const view of views) {
          view.setStyle({
            dashed: value !== 'fine', boundaryHaloWidth: value === 'halo' ? 4.2 : 0,
            boundaryWidth: value === 'halo' ? 1.05 : 0.65, boundaryOpacity: value === 'halo' ? 1 : 0.55
          });
        }
      }
    });
    const networks = toggle(appearance, {
      id: 'atlas-networks',
      label: 'Emphasize network boundaries',
      checked: true,
      onChange: checked => { for (const view of views) view.setStyle({ groupBoundaryWidth: checked ? 1.15 : 0 }); }
    });

    // ── margin: region ──
    const region = section(ctx.panel, 'Region');
    const selectedName = document.createElement('p');
    selectedName.id = 'atlas-selected-name';
    selectedName.className = 'atlas-selected';
    selectedName.textContent = 'Explore a region';
    const selectedMeta = note(region, 'Click a region or its name on either plate to select it.');
    selectedMeta.id = 'atlas-selected-meta';
    selectedMeta.before(selectedName);
    const finder = select(region, {
      id: 'atlas-parcel',
      label: 'Find a region',
      options: [{ value: '', label: 'No selection' }],
      value: '',
      onChange: value => selectRegion(value ? Number(value) : null)
    });
    const colorRow = document.createElement('div');
    colorRow.className = 'control atlas-fill-control';
    colorRow.innerHTML = '<label for="atlas-roi-color">Custom fill</label><input id="atlas-roi-color" type="color" value="#ed861d">';
    region.append(colorRow);
    const colorInput = colorRow.querySelector<HTMLInputElement>('input')!;
    const regionActions = actions(region);
    const apply = action(regionActions, {
      id: 'atlas-apply-color',
      label: 'Color selected',
      onClick: () => {
        if (selected === null) return;
        overrides.set(selected, colorInput.value);
        refresh();
      }
    });
    apply.disabled = true;
    action(regionActions, { id: 'atlas-reset-colors', label: 'Reset custom colors', onClick: () => { overrides.clear(); refresh(); } });

    function populateParcels(): void {
      finder.element.replaceChildren(new Option('No selection', ''));
      for (const parcel of [...data.parcels].sort((a, b) => isGlasser() ? a.label.localeCompare(b.label) : a.id - b.id)) {
        finder.element.append(new Option(isGlasser() ? parcel.label : `${parcel.id} · ${parcel.label}`, String(parcel.id)));
      }
    }
    populateParcels();

    function selectRegion(id: number | null): void {
      selected = id;
      for (const view of views) view.setSelection(id);
      const record = data.parcels.find(parcel => parcel.id === id);
      finder.element.value = id === null ? '' : String(id);
      selectedName.textContent = record ? record.label : 'Explore a region';
      selectedMeta.textContent = record ? `Left hemisphere · parcel ${record.id}` : 'Click a region or its name on either plate to select it.';
      film.set('br', 'region', 'Region', record ? `${record.id} · ${record.label}` : '—');
      if (id !== null) colorInput.value = colors().get(id)!;
      apply.disabled = id === null;
      composer?.select(id);
    }

    function colorNote(): void {
      sheet.querySelector('#atlas-color-note')!.textContent = mode === 'values' ? 'Synthetic example values · −1 to +1' :
        mode === 'highlights' ? 'Illustrative highlights · not study results' : mode === 'atlas' ? 'Original atlas color table' :
          mode === 'muted' ? 'Muted network palette · original parcel assignments' : 'Uncolored atlas';
      const legend = sheet.querySelector('.atlas-network-legend')!;
      legend.replaceChildren();
      if (mode === 'muted') {
        for (const group of new Set(groups().values())) {
          const item = document.createElement('span');
          const swatch = document.createElement('i');
          swatch.style.background = mutedNetworkColors[group]!;
          item.append(swatch, networkNames[group] ?? group);
          legend.append(item);
        }
      }
      if (mode === 'muted' && overrides.size) {
        const custom = document.createElement('span');
        custom.textContent = 'Custom region fills applied';
        legend.append(custom);
      }
    }

    const rebuild = (): void => {
      sheet.dataset.ready = 'false';
      let replacements: AtlasPlate[];
      try {
        replacements = makePlates();
        for (const [index, plate] of replacements.entries()) {
          const layout = views[index]!.getLayout();
          if (layout.plateKey === plate.layoutKey) parseAtlasPlateLayout(plate, layout);
        }
      } catch (error) {
        sheet.dataset.ready = 'true';
        throw error;
      }
      replacements.forEach((plate, index) => {
        views[index]!.setPlate(plate);
        plates[index] = plate;
        sheet.querySelector(`[data-view="${plate.view}"] .atlas-figure-summary`)!.textContent = summaryText(plate);
      });
      sheet.dataset.ready = 'true';
      composer?.refresh();
      printLabels();
    };
    const refresh = (): void => {
      const next = colors();
      for (const view of views) view.setColors(next);
      colorNote();
      composer?.refresh();
    };
    const printLabels = () => film.set('tr', 'count', 'Labels', `${plates.reduce((n, plate) => n + plate.labels.length, 0)} in 2 views`);
    function atlasControls(): void {
      fill.element.querySelector<HTMLOptionElement>('[value="highlights"]')!.disabled = !isGlasser();
      fill.element.querySelector<HTMLOptionElement>('[value="muted"]')!.disabled = isGlasser();
      networks.input.disabled = isGlasser();
    }
    function changeAtlas(id: string): void {
      choice = ATLASES.find(atlas => atlas.id === id)!;
      const url = new URL(location.href);
      url.searchParams.set('atlas', choice.id);
      history.replaceState(history.state, '', url);
      data = datasets[ATLASES.indexOf(choice)]!;
      overrides.clear();
      selectRegion(null);
      labelMode = isGlasser() ? 'names' : 'ids';
      labelSelect.set(labelMode);
      if (mode === 'highlights' || mode === 'muted') mode = isGlasser() ? 'highlights' : 'muted';
      fill.set(mode);
      atlasControls();
      title.textContent = choice.title;
      sourceNote.textContent = `${choice.description} · fs_LR 32k · inflated surface`;
      datasetNote.textContent = choice.description;
      citation.href = choice.citation;
      license.href = choice.license;
      populateParcels();
      rebuild();
      refresh();
    }
    atlasControls();
    colorNote();
    selectRegion(null);
    printLabels();

    composer = mountAtlasComposer({
      sheet, panel: ctx.panel, title, views, plates,
      legend: () => mode === 'muted' ? [...new Set(groups().values())].map(group => ({
        label: networkNames[group] ?? group, color: mutedNetworkColors[group]!
      })) : [],
      subtitle: () => `${choice.description} · fs_LR 32k · ${sheet.querySelector('#atlas-color-note')!.textContent}` +
        (overrides.size ? ' · Custom region fills applied' : '')
    });

    // ── margin: sources ──
    const sources = section(ctx.panel, 'Sources');
    note(sources, 'Real atlas parcels on the inflated fs_LR surface. Fills, boundaries and names are independent. SVG keeps editable text and region paths; PNG uses the same layout at 3× resolution.');
    links.className = 'margin-note atlas-links';
    links.append(citation, license);
    sources.append(links);

    // Fit each plate to the film's height so the first view shows complete plates; zooming a plate
    // magnifies inside its frame, and stacked panels or an open region detail scroll.
    const fitPlates = () => {
      const heading = sheet.querySelector<HTMLElement>('.atlas-sheet-heading')!;
      const figure = sheet.querySelector<HTMLElement>('.atlas-figure')!;
      const chrome = figure.querySelector<HTMLElement>('.atlas-figure-heading')!.offsetHeight +
        figure.querySelector<HTMLElement>('.atlas-figure-summary')!.offsetHeight + 12;
      const available = stage.clientHeight - heading.offsetHeight - 22 - chrome - 8;
      sheet.style.setProperty('--plate-fit', `${Math.max(260, Math.floor((available * plates[0]!.width) / plates[0]!.height))}px`);
    };
    const fitObserver = new ResizeObserver(fitPlates);
    fitObserver.observe(stage);
    fitObserver.observe(sheet.querySelector('.atlas-sheet-heading')!);
    fitPlates();

    sheet.dataset.ready = 'true';
    ctx.perf(`${plates.reduce((n, plate) => n + plate.labels.length, 0)} labels in two views`);
    ctx.setBusy(false);
    return () => {
      fitObserver.disconnect();
      composer?.dispose();
      for (const view of views) view.dispose();
      stage.remove();
    };
  }
};
