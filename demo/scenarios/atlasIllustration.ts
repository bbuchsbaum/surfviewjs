import './atlasIllustration.css';
import { AtlasPlateView, buildAtlasPlate, ColorMap, loadSurface, parseAtlasPlateLayout } from '@src/index';
import type { AtlasPlateInput, ParcelData } from '@src/index';
import type { Scenario } from '../types';
import { mutedNetworkColors, networkNames } from './atlasPalettes';
import { mountAtlasComposer } from './atlasComposer';

const meshURL = new URL('../../tests/data/fs_LR.32k.L.inflated.surf.gii', import.meta.url).href;
const atlasChoices = [
  { id: 'glasser', title: 'HCP–MMP1.0', description: 'Glasser et al., 2016 · 180 left parcels',
    url: new URL('../data/glasser/left-fslr32k.json', import.meta.url).href,
    license: new URL('../data/glasser/LICENSE.txt', import.meta.url).href, citation: 'https://doi.org/10.1038/nature18933' },
  { id: 'schaefer400-7', title: 'Schaefer–Yeo 400', description: '7 networks · 200 of 400 parcels (left)',
    url: new URL('../data/schaefer/left-fslr32k-7networks.json', import.meta.url).href,
    license: new URL('../data/schaefer/LICENSE.txt', import.meta.url).href, citation: 'https://doi.org/10.1093/cercor/bhx179' },
  { id: 'schaefer400-17', title: 'Schaefer–Yeo 400', description: '17 networks · 200 of 400 parcels (left)',
    url: new URL('../data/schaefer/left-fslr32k-17networks.json', import.meta.url).href,
    license: new URL('../data/schaefer/LICENSE.txt', import.meta.url).href, citation: 'https://doi.org/10.1093/cercor/bhx179' }
];
interface DemoAtlas extends ParcelData {
  parcels: { id: number; label: string; hemi: string; color: string }[];
  vertexLabels: number[];
  source: { url: string; sha256: string; citation: string; license: string };
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const atlasIllustration: Scenario = {
  id: 'atlas-illustration',
  title: 'Atlas illustration',
  description: 'Glasser and Schaefer–Yeo 400 plates with smooth boundaries, editable colors, labels, and vector export.',
  tags: ['atlas', 'labels', 'svg', 'publication'],
  run: async ctx => {
    ctx.status('Preparing the atlas plates…');
    let choice = atlasChoices.find(a => a.id === new URLSearchParams(location.search).get('atlas')) ?? atlasChoices[0]!;
    const [geometry, datasets] = await Promise.all([
      loadSurface(meshURL, 'gifti', 'left', 30000, false),
      Promise.all(atlasChoices.map(async atlas => {
        const response = await fetch(atlas.url);
        if (!response.ok) throw new Error(`Atlas fixture could not be loaded (${response.status})`);
        return await response.json() as DemoAtlas;
      }))
    ]);
    let data = datasets[atlasChoices.indexOf(choice)]!;
    const input = (): AtlasPlateInput => ({
      vertices: geometry.vertices, faces: geometry.faces, vertexLabels: data.vertexLabels,
      parcelData: data, hemisphere: 'left',
      provenance: { source: data.source.url, checksum: `sha256:${data.source.sha256}`,
        citation: data.source.citation, license: data.source.license }
    });
    let smoothing = 4;
    let allLabels = false;
    let labelMode = choice.id === 'glasser' ? 'names' : 'ids';
    const groups = (): Map<number, string> => new Map(choice.id === 'glasser' ? [] :
      data.parcels.map(p => [p.id, p.label.split('_')[2]!]));
    const canvas = document.createElement('canvas');
    const metrics = canvas.getContext('2d');
    const makePlates = () => (['lateral', 'medial'] as const).map(view => buildAtlasPlate(input(), {
      view, width: 1200, height: 850, fontSize: 14, padding: 85,
      maxLeaderLength: allLabels ? 2000 : 90, contourSmoothing: smoothing,
      minLabelArea: allLabels ? 0 : 12,
      calloutGap: allLabels ? 12 : 20,
      detailScales: [2, 4, 8],
      parcelGroups: groups(),
      labelText: p => labelMode === 'ids' ? String(p.id) : p.label,
      measureText: (text, size) => {
        if (!metrics) return text.length * size * 0.72;
        metrics.font = `${size}px Arial`;
        return metrics.measureText(text).width;
      }
    }));
    const plates = makePlates();
    const sheet = document.createElement('div');
    sheet.className = 'atlas-sheet';
    sheet.innerHTML = `<header class="atlas-sheet-heading">
      <span class="atlas-eyebrow">CORTICAL ATLAS / LEFT HEMISPHERE</span>
      <h1>${choice.title}</h1>
      <p>Regions, boundaries, and names.</p>
      <div class="atlas-key"><span class="atlas-key-dot"></span><span id="atlas-color-note">Illustrative highlights · not study results</span></div>
      <div class="atlas-network-legend" aria-label="Network color key"></div>
    </header><div class="atlas-views"></div>
    <footer class="atlas-sheet-footer"><span id="atlas-source-note">${choice.description} · fsLR 32k · inflated surface</span>
      <span>Click a region or its label to select it.</span></footer>`;
    ctx.mount.replaceChildren(sheet);
    document.body.classList.add('atlas-demo-active');
    const views: AtlasPlateView[] = [];
    let mode = choice.id === 'glasser' ? 'highlights' : 'muted';
    let palette = 'viridis';
    let selected: number | null = null;
    const overrides = new Map<number, string>();
    const primary = new Set(['V1', 'V2', '4', '3a', '3b', '1', '2', 'FEF', 'MT', 'MST', 'A1', '43', '44', '45']);
    const secondary = new Set(['6a', '6d', '6mp', '6ma', '6r', '6v', '55b', '7AL', '7PC', 'AIP', 'LIPd', 'LIPv', 'MIP', 'VIP', 'PF', 'PFm', 'PFt', 'PGi', 'PGs', 'PGp', 'SFL', 'SCEF', 'POS2', '7Am', '7Pm', '31a', '31pd', '31pv', 'PCV', 'RSC', 'OFC', 'a24', 'p24pr', 'p32pr']);
    function colors(): Map<number, string> {
      const colormap = ColorMap.fromPreset(palette, { range: [-1, 1] });
      return new Map(data.parcels.map(p => {
        let fill = '#fffdf9';
        if (mode === 'highlights') fill = primary.has(p.label) ? '#dfa363' : secondary.has(p.label) ? '#f1cfaa' : fill;
        else if (mode === 'muted') fill = mutedNetworkColors[p.label.split('_')[2]!] ?? fill;
        else if (mode === 'atlas') fill = p.color;
        else if (mode === 'values') {
          // Explicitly synthetic: exercises value-to-color mapping, not an atlas measurement.
          const rgb = colormap.getColor(Math.sin(p.id * 0.17));
          fill = '#' + rgb.slice(0, 3).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        }
        return [p.id, overrides.get(p.id) ?? fill];
      }));
    }
    function select(id: number | null): void {
      selected = id;
      for (const view of views) view.setSelection(id);
      const record = data.parcels.find(p => p.id === id);
      const selector = ctx.panel.querySelector<HTMLSelectElement>('#atlas-parcel');
      if (selector) selector.value = id === null ? '' : String(id);
      const selectedLabel = ctx.panel.querySelector('#atlas-selected-name');
      if (selectedLabel) selectedLabel.textContent = record ? record.label : 'Explore a region';
      const selectedMeta = ctx.panel.querySelector('#atlas-selected-meta');
      if (selectedMeta) selectedMeta.textContent = record ? `Left hemisphere · parcel ${record.id}` : 'Select directly on either plate.';
      const colorInput = ctx.panel.querySelector<HTMLInputElement>('#atlas-roi-color');
      if (colorInput && id !== null) colorInput.value = colors().get(id)!;
      const apply = ctx.panel.querySelector<HTMLButtonElement>('#atlas-apply-color');
      if (apply) apply.disabled = id === null;
      composer?.select(id);
    }
    for (const [index, plate] of plates.entries()) {
      const section = document.createElement('section');
      section.className = 'atlas-figure';
      section.dataset.view = plate.view;
      section.innerHTML = `<div class="atlas-figure-heading"><h2><span>${index ? 'B' : 'A'}</span> ${plate.view === 'lateral' ? 'Lateral' : 'Medial'}</h2>
        <div><button data-export="svg" aria-label="Export ${plate.view} SVG">SVG ↗</button><button data-export="png" aria-label="Export ${plate.view} PNG">PNG ↗</button></div></div>`;
      const view = new AtlasPlateView(section, plate, { colors: colors(), onParcelClick: select,
        onLayoutChange: () => composer?.refresh(), onInteractionError: error => composer?.error(error.message) });
      views.push(view);
      const summary = document.createElement('p');
      summary.className = 'atlas-figure-summary';
      summary.textContent = `Automatic overview: ${plate.labels.length} labeled / ${plate.regions.length} visible parcels`;
      if (plate.unlabeledParcelIds.length) summary.textContent += ' · Additional names in the region list';
      section.append(summary);
      sheet.querySelector('.atlas-views')!.append(section);
      section.querySelector('[data-export="svg"]')!.addEventListener('click', () => {
        download(new Blob([view.toSVG()], { type: 'image/svg+xml;charset=utf-8' }), `${choice.id}-left-${plate.view}.svg`);
      });
      section.querySelector('[data-export="png"]')!.addEventListener('click', async event => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        const filename = `${choice.id}-left-${plate.view}.png`;
        try { download(await view.exportPNG(3), filename); }
        catch (error) { ctx.status(String(error)); }
        finally { button.disabled = false; }
      });
    }
    ctx.panel.innerHTML = `<a class="atlas-back" href="?scenario=quickstart">← Demo gallery</a>
      <div class="atlas-control-section"><span class="atlas-eyebrow">ATLAS</span>
        <label for="atlas-dataset">Parcellation</label><select id="atlas-dataset">
          ${atlasChoices.map(a => `<option value="${a.id}">${a.title}${a.id === 'glasser' ? '' : a.id.endsWith('-17') ? ' · 17 networks' : ' · 7 networks'}</option>`).join('')}
        </select><p id="atlas-dataset-note">${choice.description}</p>
      </div>
      <div class="atlas-control-section"><span class="atlas-eyebrow">APPEARANCE</span>
        <label for="atlas-fill">Region fills</label><select id="atlas-fill">
          <option value="highlights">Peach & orange highlights</option><option value="neutral">Uncolored</option>
          <option value="muted">Muted network colors</option>
          <option value="atlas">Original atlas colors</option><option value="values">Example values (synthetic)</option></select>
        <label for="atlas-palette">Value colormap</label><select id="atlas-palette" disabled><option value="viridis">Viridis</option><option value="RdBu">Red–blue</option><option value="oranges">Oranges</option></select>
        <label class="atlas-check"><input id="atlas-labels" type="checkbox" checked/> Show region names</label>
        <label for="atlas-label-text">Label text</label><select id="atlas-label-text"><option value="names">Region names</option><option value="ids">Parcel IDs · full names on hover</option></select>
        <label for="atlas-label-layout">Label layout</label><select id="atlas-label-layout"><option value="balanced">Balanced · short callouts</option><option value="all">All visible · extended callouts</option></select>
        <label for="atlas-smoothing">Border smoothing <output id="atlas-smoothing-value">4</output></label>
        <input id="atlas-smoothing" type="range" min="0" max="8" step="0.5" value="4"/>
        <p>0 preserves sampled edges. Higher values soften small contour details.</p>
        <label for="atlas-boundary-style">Boundary style</label><select id="atlas-boundary-style"><option value="fine">Fine solid</option><option value="dashed">Fine dashed</option><option value="halo">Dashed with white bands</option></select>
        <label class="atlas-check"><input id="atlas-networks" type="checkbox" checked/> Emphasize network boundaries</label>
      </div><div class="atlas-control-section"><span class="atlas-eyebrow">REGION</span>
        <h3 id="atlas-selected-name">Explore a region</h3><p id="atlas-selected-meta">Select directly on either plate.</p>
        <label for="atlas-parcel">Find a region</label><select id="atlas-parcel"><option value="">No selection</option></select>
        <label for="atlas-roi-color">Custom fill</label><div class="atlas-color-control"><input id="atlas-roi-color" type="color" value="#ed861d"/><button id="atlas-apply-color" disabled>Color selected</button></div>
        <button id="atlas-reset-colors">Reset custom colors</button>
      </div><div class="atlas-control-section atlas-about"><span class="atlas-eyebrow">ABOUT THIS VIEW</span>
        <p>Real atlas parcels on the inflated fsLR surface. Colors, boundaries, and names remain independent.</p>
        <p>SVG exports retain editable text and region paths. PNG exports use the same layout at 3× resolution.</p>
        <a id="atlas-citation" href="${choice.citation}" target="_blank" rel="noreferrer">Atlas publication ↗</a>
        <a id="atlas-license" href="${choice.license}" target="_blank" rel="noreferrer">Demo data license ↗</a>
      </div>`;
    const selector = ctx.panel.querySelector<HTMLSelectElement>('#atlas-parcel')!;
    function populateParcels(): void {
      selector.replaceChildren(new Option('No selection', ''));
      for (const p of [...data.parcels].sort((a, b) => choice.id === 'glasser' ? a.label.localeCompare(b.label) : a.id - b.id)) {
        const option = new Option(choice.id === 'glasser' ? p.label : `${p.id} · ${p.label}`, String(p.id));
        selector.append(option);
      }
    }
    populateParcels();
    const datasetSelector = ctx.panel.querySelector<HTMLSelectElement>('#atlas-dataset')!;
    datasetSelector.value = choice.id;
    const labelSelector = ctx.panel.querySelector<HTMLSelectElement>('#atlas-label-text')!;
    labelSelector.value = labelMode;
    const fillSelector = ctx.panel.querySelector<HTMLSelectElement>('#atlas-fill')!;
    fillSelector.value = mode;
    function colorNote(): void {
      sheet.querySelector('#atlas-color-note')!.textContent = mode === 'values' ? 'Synthetic example values · −1 to +1' :
        mode === 'highlights' ? 'Illustrative highlights · not study results' : mode === 'atlas' ? 'Original atlas color table' :
          mode === 'muted' ? 'Muted network palette · original parcel assignments' : 'Uncolored atlas';
      const legend = sheet.querySelector('.atlas-network-legend')!;
      legend.replaceChildren();
      if (mode === 'muted') for (const group of new Set(groups().values())) {
        const item = document.createElement('span');
        const swatch = document.createElement('i'); swatch.style.background = mutedNetworkColors[group]!;
        item.append(swatch, networkNames[group] ?? group); legend.append(item);
      }
      if (mode === 'muted' && overrides.size) {
        const note = document.createElement('span'); note.textContent = 'Custom region fills applied'; legend.append(note);
      }
    }
    colorNote();
    const rebuild = (): void => {
      sheet.dataset.ready = 'false';
      let replacements;
      try {
        replacements = makePlates();
        for (const [index, plate] of replacements.entries()) {
          const layout = views[index]!.getLayout();
          if (layout.plateKey === plate.layoutKey) parseAtlasPlateLayout(plate, layout);
        }
      } catch (error) { sheet.dataset.ready = 'true'; throw error; }
      replacements.forEach((plate, index) => {
        views[index]!.setPlate(plate);
        plates[index] = plate;
        const summary = sheet.querySelector(`[data-view="${plate.view}"] .atlas-figure-summary`)!;
        summary.textContent = `Automatic overview: ${plate.labels.length} labeled / ${plate.regions.length} visible parcels` +
          (plate.unlabeledParcelIds.length ? ' · Additional names in the region list' : '');
      });
      sheet.dataset.ready = 'true';
      composer?.refresh();
    };
    const refresh = (): void => { const next = colors(); for (const view of views) view.setColors(next); colorNote(); composer?.refresh(); };
    function atlasControls(): void {
      fillSelector.querySelector<HTMLOptionElement>('[value="highlights"]')!.disabled = choice.id !== 'glasser';
      fillSelector.querySelector<HTMLOptionElement>('[value="muted"]')!.disabled = choice.id === 'glasser';
      ctx.panel.querySelector<HTMLInputElement>('#atlas-networks')!.disabled = choice.id === 'glasser';
    }
    datasetSelector.addEventListener('change', () => {
      choice = atlasChoices.find(a => a.id === datasetSelector.value)!;
      data = datasets[atlasChoices.indexOf(choice)]!;
      overrides.clear(); select(null);
      labelMode = choice.id === 'glasser' ? 'names' : 'ids'; labelSelector.value = labelMode;
      if (mode === 'highlights' || mode === 'muted') mode = choice.id === 'glasser' ? 'highlights' : 'muted';
      fillSelector.value = mode;
      atlasControls();
      sheet.querySelector('h1')!.textContent = choice.title;
      sheet.querySelector('#atlas-source-note')!.textContent = `${choice.description} · fsLR 32k · inflated surface`;
      ctx.panel.querySelector('#atlas-dataset-note')!.textContent = choice.description;
      ctx.panel.querySelector<HTMLAnchorElement>('#atlas-citation')!.href = choice.citation;
      ctx.panel.querySelector<HTMLAnchorElement>('#atlas-license')!.href = choice.license;
      populateParcels(); rebuild(); colorNote(); refresh();
    });
    atlasControls();
    fillSelector.addEventListener('change', event => {
      mode = (event.target as HTMLSelectElement).value;
      ctx.panel.querySelector<HTMLSelectElement>('#atlas-palette')!.disabled = mode !== 'values';
      colorNote(); refresh();
    });
    ctx.panel.querySelector('#atlas-palette')!.addEventListener('change', event => {
      palette = (event.target as HTMLSelectElement).value; refresh();
    });
    selector.addEventListener('change', () => select(selector.value ? Number(selector.value) : null));
    ctx.panel.querySelector('#atlas-labels')!.addEventListener('change', event => {
      for (const view of views) view.setLabelsVisible((event.target as HTMLInputElement).checked);
    });
    ctx.panel.querySelector('#atlas-label-layout')!.addEventListener('change', event => {
      allLabels = (event.target as HTMLSelectElement).value === 'all'; rebuild();
    });
    labelSelector.addEventListener('change', () => {
      const previous = labelMode; labelMode = labelSelector.value;
      try { rebuild(); }
      catch (error) {
        labelMode = previous; labelSelector.value = previous;
        composer.error(`${String(error)}. Reset label pins before changing label text.`);
      }
    });
    const smoothingInput = ctx.panel.querySelector<HTMLInputElement>('#atlas-smoothing')!;
    smoothingInput.addEventListener('input', () => {
      ctx.panel.querySelector('#atlas-smoothing-value')!.textContent = smoothingInput.value;
    });
    smoothingInput.addEventListener('change', () => {
      smoothing = Number(smoothingInput.value); rebuild();
    });
    ctx.panel.querySelector('#atlas-boundary-style')!.addEventListener('change', event => {
      const value = (event.target as HTMLSelectElement).value;
      for (const view of views) view.setStyle({ dashed: value !== 'fine', boundaryHaloWidth: value === 'halo' ? 4.2 : 0,
        boundaryWidth: value === 'halo' ? 1.05 : 0.65, boundaryOpacity: value === 'halo' ? 1 : 0.55 });
    });
    ctx.panel.querySelector('#atlas-networks')!.addEventListener('change', event => {
      for (const view of views) view.setStyle({ groupBoundaryWidth: (event.target as HTMLInputElement).checked ? 1.15 : 0 });
    });
    ctx.panel.querySelector('#atlas-apply-color')!.addEventListener('click', () => {
      if (selected === null) return;
      overrides.set(selected, ctx.panel.querySelector<HTMLInputElement>('#atlas-roi-color')!.value); refresh();
    });
    ctx.panel.querySelector('#atlas-reset-colors')!.addEventListener('click', () => { overrides.clear(); refresh(); });
    const composer = mountAtlasComposer({ sheet, panel: ctx.panel, views, plates,
      legend: () => mode === 'muted' ? [...new Set(groups().values())].map(group => ({
        label: networkNames[group] ?? group, color: mutedNetworkColors[group]!
      })) : [],
      subtitle: () => `${choice.description} · fsLR 32k · ${sheet.querySelector('#atlas-color-note')!.textContent}` +
        (overrides.size ? ' · Custom region fills applied' : '')
    });
    sheet.dataset.ready = 'true';
    ctx.perf(`${plates.reduce((n, plate) => n + plate.labels.length, 0)} labels in two views`);
    return () => { composer?.dispose(); for (const view of views) view.dispose(); sheet.remove(); document.body.classList.remove('atlas-demo-active'); };
  }
};
