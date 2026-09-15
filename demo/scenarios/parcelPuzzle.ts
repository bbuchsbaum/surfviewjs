import { ParcelPuzzleView, loadSurface, type ParcelData, type ParcelDetailRenderer } from '@src/index';
import type { Scenario } from '../types';
import { mutedNetworkColors, networkNames } from './atlasPalettes';
import meshURL from '../../tests/data/fs_LR.32k.L.inflated.surf.gii?url';
import schaefer7URL from '../data/schaefer/left-fslr32k-7networks.json?url';
import schaefer17URL from '../data/schaefer/left-fslr32k-17networks.json?url';
import glasserURL from '../data/glasser/left-fslr32k.json?url';

function networkOf(label: string): string | null { return /^(?:7|17)Networks_LH_([^_]+)/.exec(label)?.[1] ?? null; }

const choices = [
  { id: 'schaefer400-7', name: 'Schaefer–Yeo 400 · 7 networks', url: schaefer7URL },
  { id: 'schaefer400-17', name: 'Schaefer–Yeo 400 · 17 networks', url: schaefer17URL },
  { id: 'glasser', name: 'Glasser HCP–MMP1.0', url: glasserURL }
];

interface DemoAtlas extends ParcelData {
  vertexLabels: number[];
  source: { citation: string; url: string; license: string };
}

const renderDetail: ParcelDetailRenderer = (container, { parcel, piece }) => {
  const dl = document.createElement('dl');
  const network = networkOf(parcel.label);
  const rows = [
    ['Parcel ID', String(parcel.id)], ['Hemisphere', 'Left'],
    ...(network ? [['Network', networkNames[network] ?? network]] : []),
    ['Source vertices', piece.sourceVertexCount.toLocaleString()],
    ['Inflated area', `${piece.surfaceArea.toFixed(1)} mm²`]
  ];
  rows.forEach(([name, value]) => {
    const dt = document.createElement('dt'); dt.textContent = name;
    const dd = document.createElement('dd'); dd.textContent = value;
    dl.append(dt, dd);
  });
  const note = document.createElement('p'); note.className = 'sv-parcel-puzzle-help';
  note.textContent = 'Area is measured on this inflated display mesh. The backing is illustrative. Applications can place their own measurements and plots here.';
  container.append(dl, note);
};

export const parcelPuzzle: Scenario = {
  id: 'parcel-puzzle',
  title: 'Cortical parcel puzzle',
  description: 'Explore Glasser or Schaefer cortical parcels as interactive 3D pieces with inspectable source geometry.',
  tags: ['Glasser', 'Schaefer', 'atlas', 'parcels', '3d', 'interaction'],
  run: async ctx => {
    ctx.status('Loading fsLR geometry and atlas labels…');
    const choice = choices.find(item => item.id === new URLSearchParams(location.search).get('atlas')) ?? choices[0]!;
    const geometry = await loadSurface(meshURL, 'gifti', 'left', 30000, false);
    const cache = new Map<string, DemoAtlas>();
    const getData = async (id: string): Promise<DemoAtlas> => {
      const cached = cache.get(id); if (cached) return cached;
      const response = await fetch(choices.find(item => item.id === id)!.url);
      if (!response.ok) throw new Error(`Atlas labels could not be loaded (${response.status})`);
      const data = await response.json() as DemoAtlas;
      cache.set(id, data); return data;
    };
    const initial = await getData(choice.id);
    const controls = document.createElement('div');
    controls.className = 'parcel-puzzle-controls';
    controls.innerHTML = `
      <style>
        .parcel-puzzle-controls{display:grid;gap:20px;font:14px/1.5 system-ui,sans-serif}
        .parcel-puzzle-controls h3{margin:0;font-size:17px}
        .parcel-puzzle-controls label{display:grid;gap:7px}
        .parcel-puzzle-controls select,.parcel-puzzle-controls button{font:inherit;padding:8px;border:1px solid #647784;border-radius:6px}
        .parcel-puzzle-controls input{width:100%;accent-color:#508597}
        .parcel-puzzle-controls .puzzle-views{display:flex;gap:5px;flex-wrap:wrap}
        .parcel-puzzle-controls p{margin:0;font-size:13px;opacity:.85}
        .parcel-puzzle-controls a{color:inherit}
      </style>
      <h3>Assemble & explore</h3>
      <label>Atlas<select aria-label="Puzzle atlas"></select></label>
      <label>Separation <output data-gap-value>4%</output><input aria-label="Parcel separation" type="range" min="0" max="0.5" step="0.01" value="0.04"></label>
      <label>Curvature relief <output data-relief-value>100%</output><input aria-label="Parcel curvature relief" type="range" min="0.3" max="1" step="0.01" value="1"></label>
      <div class="puzzle-views"><button type="button" data-view="lateral">Lateral</button><button type="button" data-view="medial">Medial</button><button type="button" data-view="oblique">Oblique</button></div>
      <button type="button" data-assemble>Reassemble</button>
      <p data-atlas-note></p>
      <p>Hover lifts a piece. Click pins it in front of the brain. Drag the selected piece or its preview to rotate it; Return piece restores its place.</p>
      <p>Gaps and reduced relief change display geometry. Shell thickness is illustrative.</p>
      <p><a data-citation target="_blank" rel="noopener noreferrer">Atlas source and citation</a></p>`;
    const select = controls.querySelector('select')!;
    choices.forEach(item => select.add(new Option(item.name, item.id)));
    select.value = choice.id;
    const separation = controls.querySelector<HTMLInputElement>('[aria-label="Parcel separation"]')!;
    const relief = controls.querySelector<HTMLInputElement>('[aria-label="Parcel curvature relief"]')!;
    let view: ParcelPuzzleView | null = null;
    let disposed = false, generation = 0;
    const mount = (data: DemoAtlas): void => {
      view?.dispose(); ctx.mount.replaceChildren();
      view = new ParcelPuzzleView(ctx.mount, { vertices: geometry.vertices, faces: geometry.faces,
        vertexLabels: data.vertexLabels, parcelData: data }, {
        thickness: 2, separation: Number(separation.value), relief: Number(relief.value), renderDetail,
        labelText: parcel => parcel.label.replace(/^(?:7|17)Networks_LH_/, '').replace(/_/g, ' '),
        color: parcel => mutedNetworkColors[networkOf(parcel.label) ?? ''] ??
          (typeof parcel.color === 'string' ? parcel.color : '#aac1c9')
      });
      controls.querySelector('[data-atlas-note]')!.textContent = `${data.parcels.length} real parcels · left hemisphere · fsLR 32k inflated surface`;
      (controls.querySelector('[data-citation]') as HTMLAnchorElement).href = data.atlas.id.toLowerCase().includes('schaefer')
        ? 'https://doi.org/10.1093/cercor/bhx179' : 'https://doi.org/10.1038/nature18933';
      ctx.status(`Ready: ${data.parcels.length} cortical puzzle pieces`);
      ctx.perf(`${geometry.vertices.length / 3} source vertices`);
    };
    mount(initial);
    const listeners: (() => void)[] = [];
    const on = (target: EventTarget, type: string, listener: EventListener): void => {
      target.addEventListener(type, listener); listeners.push(() => target.removeEventListener(type, listener));
    };
    on(separation, 'input', () => {
      view?.setSeparation(Number(separation.value));
      controls.querySelector('[data-gap-value]')!.textContent = `${Math.round(Number(separation.value) * 100)}%`;
    });
    on(relief, 'input', () => {
      view?.setRelief(Number(relief.value));
      controls.querySelector('[data-relief-value]')!.textContent = `${Math.round(Number(relief.value) * 100)}%`;
    });
    controls.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => on(button, 'click', () =>
      view?.setView(button.dataset.view as 'lateral' | 'medial' | 'oblique')));
    on(controls.querySelector('[data-assemble]')!, 'click', () => {
      separation.value = '0'; relief.value = '1';
      controls.querySelector('[data-gap-value]')!.textContent = '0%';
      controls.querySelector('[data-relief-value]')!.textContent = '100%';
      view?.selectParcel(null); view?.puzzle.setHoveredParcel(null); view?.setRelief(1); view?.setSeparation(0);
    });
    on(select, 'change', () => {
      const url = new URL(location.href);
      url.searchParams.set('atlas', select.value);
      history.replaceState(history.state, '', url);
      const request = ++generation;
      ctx.status('Loading atlas…');
      void getData(select.value).then(data => { if (!disposed && request === generation) mount(data); })
        .catch(error => { if (!disposed && request === generation) ctx.status(String(error)); });
    });
    ctx.panel.replaceChildren(controls);
    return () => {
      disposed = true; generation++;
      listeners.forEach(dispose => dispose()); view?.dispose(); controls.remove();
    };
  }
};
