import './parcelPuzzle.css';
import { ParcelPuzzleView } from '@src/index.js';
import type { ParcelData, ParcelDetailRenderer, ParcelPuzzleSelection } from '@src/index.js';
import excerpt from '../excerpts/parcelPuzzle.ts?raw';
import { action, actions, note, section, select, slider } from '../kit/controls';
import { loadAtlas, loadMesh, type ATLAS_URLS, type AtlasFile } from '../kit/data';
import { FILM_BASE } from '../kit/film';
import type { Scenario } from '../types';
import { mutedNetworkColors, networkNames, networkOf, shortParcelName } from './atlasPalettes';

const ATLASES: ReadonlyArray<{ id: string; file: keyof typeof ATLAS_URLS; name: string; citation: string }> = [
  { id: 'schaefer400-7', file: 'schaefer400x7', name: 'Schaefer–Yeo 400 · 7 networks', citation: 'https://doi.org/10.1093/cercor/bhx179' },
  { id: 'schaefer400-17', file: 'schaefer400x17', name: 'Schaefer–Yeo 400 · 17 networks', citation: 'https://doi.org/10.1093/cercor/bhx179' },
  { id: 'glasser', file: 'glasser', name: 'Glasser HCP–MMP1.0', citation: 'https://doi.org/10.1038/nature18933' }
];
const VIEWS = ['lateral', 'medial', 'oblique'] as const;
type PuzzleView = (typeof VIEWS)[number];

type DemoAtlas = AtlasFile & ParcelData;

const renderDetail: ParcelDetailRenderer = (container, { parcel, piece }) => {
  const list = document.createElement('dl');
  const network = networkOf(parcel.label);
  const rows = [
    ['Parcel ID', String(parcel.id)], ['Hemisphere', 'Left'],
    ...(network ? [['Network', networkNames[network] ?? network]] : []),
    ['Source vertices', piece.sourceVertexCount.toLocaleString('en-US')],
    ['Inflated area', `${piece.surfaceArea.toFixed(1)} mm²`]
  ];
  for (const [name, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = name!;
    const detail = document.createElement('dd');
    detail.textContent = value!;
    list.append(term, detail);
  }
  const help = document.createElement('p');
  help.className = 'sv-parcel-puzzle-help';
  help.textContent = 'Area is measured on this inflated display mesh. The backing is illustrative. Applications can place their own measurements and plots here.';
  container.append(list, help);
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

export const parcelPuzzle: Scenario = {
  id: 'parcel-puzzle',
  aliases: [],
  title: 'Parcel puzzle',
  short: 'Puzzle',
  group: 'atlases',
  tags: ['atlas', 'Glasser', 'Schaefer', 'parcels', '3d', 'interaction'],
  summary:
    'Every parcel of the Schaefer–Yeo 400 or Glasser atlas becomes a 3D piece cut from the fs_LR 32k inflated left hemisphere. Hover lifts a piece; click pins it in front of the brain and opens its detail, where the piece can be rotated on its own. Pull the pieces apart with separation, flatten them with relief, and reassemble.',
  synthetic:
    'Parcels are the published atlases. Piece thickness and the backing shell are illustrative display geometry, not anatomy.',
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fs_LR geometry and atlas labels');
    const film = ctx.film;
    const initial = ATLASES.find(item => item.id === ctx.params.get('atlas')) ?? ATLASES[0]!;
    const [geometry, first] = await Promise.all([loadMesh('fsLR32kLeftInflated'), loadAtlas(initial.file) as Promise<DemoAtlas>]);

    // The puzzle is the library's own lit print; it hangs inside the film so the corners stay readable.
    const stage = document.createElement('div');
    stage.className = 'puzzle-stage';
    ctx.mount.replaceChildren(stage);

    let view: ParcelPuzzleView | null = null;
    let disposed = false;
    let generation = 0;
    let currentView: PuzzleView = 'lateral';
    const viewButtons = new Map<PuzzleView, HTMLButtonElement>();

    const printSelection = (selection: ParcelPuzzleSelection, key: 'hover' | 'pinned', label: string) => {
      film.set('br', key, label, selection.parcelId === null || !selection.piece ? '—'
        : `${selection.parcelId} · ${shortParcelName(selection.piece.parcel.label)}`);
    };
    const onHover = (selection: ParcelPuzzleSelection) => printSelection(selection, 'hover', 'Hover');
    const onSelect = (selection: ParcelPuzzleSelection) => printSelection(selection, 'pinned', 'Pinned');

    const mount = (data: DemoAtlas, choice: (typeof ATLASES)[number]): void => {
      if (view) {
        view.off('parcel:hover', onHover);
        view.off('selection:changed', onSelect);
        view.dispose();
      }
      stage.replaceChildren();
      view = new ParcelPuzzleView(stage, {
        vertices: geometry.vertices, faces: geometry.faces, vertexLabels: data.vertexLabels, parcelData: data
      }, {
        thickness: 2,
        separation: Number(separation.input.value),
        relief: Number(relief.input.value),
        view: currentView,
        renderDetail,
        labelText: parcel => shortParcelName(parcel.label),
        color: parcel => mutedNetworkColors[networkOf(parcel.label) ?? ''] ??
          (typeof parcel.color === 'string' ? parcel.color : '#aac1c9')
      });
      // The library defaults to a light stage; its public viewer takes the film base instead.
      view.viewer.setFigureBackground(FILM_BASE);
      view.on('parcel:hover', onHover);
      view.on('selection:changed', onSelect);
      atlasNote.textContent = `${data.parcels.length} real parcels · left hemisphere · fs_LR 32k inflated surface.`;
      citation.href = choice.citation;
      onHover({ parcelId: null, piece: null });
      onSelect({ parcelId: null, piece: null });
      ctx.status(`Ready: ${data.parcels.length} cortical puzzle pieces`);
    };

    const setup = section(ctx.panel, 'Atlas');
    select(setup, {
      id: 'puzzle-atlas',
      label: 'Puzzle atlas',
      options: ATLASES.map(item => ({ value: item.id, label: item.name })),
      value: initial.id,
      print: { film, corner: 'tl', key: 'atlas', label: 'Atlas' },
      onChange: id => {
        const choice = ATLASES.find(item => item.id === id)!;
        const url = new URL(location.href);
        url.searchParams.set('atlas', choice.id);
        history.replaceState(history.state, '', url);
        const request = ++generation;
        ctx.status('Loading atlas');
        void (loadAtlas(choice.file) as Promise<DemoAtlas>)
          .then(data => { if (!disposed && request === generation) mount(data, choice); })
          .catch(error => { if (!disposed && request === generation) ctx.status(String(error)); });
      }
    });
    const atlasNote = note(setup, '');
    film.set('tl', 'surface', 'Surface', 'fs_LR 32k inflated, L');

    const pieces = section(ctx.panel, 'Pieces');
    const separation = slider(pieces, {
      id: 'puzzle-separation',
      label: 'Parcel separation',
      min: 0, max: 0.5, step: 0.01, value: 0.04,
      format: percent,
      print: { film, corner: 'bl', key: 'separation', label: 'Separation' },
      onInput: value => view?.setSeparation(value)
    });
    separation.input.parentElement!.querySelector('output')!.dataset.gapValue = '';
    const relief = slider(pieces, {
      id: 'puzzle-relief',
      label: 'Parcel curvature relief',
      min: 0.3, max: 1, step: 0.01, value: 1,
      format: percent,
      print: { film, corner: 'bl', key: 'relief', label: 'Relief' },
      onInput: value => view?.setRelief(value)
    });
    relief.input.parentElement!.querySelector('output')!.dataset.reliefValue = '';

    const viewRow = actions(pieces);
    const showView = (next: PuzzleView) => {
      currentView = next;
      for (const [name, button] of viewButtons) button.setAttribute('aria-pressed', String(name === next));
      film.set('tr', 'view', 'View', next[0]!.toUpperCase() + next.slice(1));
      view?.setView(next);
    };
    for (const name of VIEWS) {
      const button = action(viewRow, { label: name[0]!.toUpperCase() + name.slice(1), onClick: () => showView(name) });
      button.dataset.view = name;
      viewButtons.set(name, button);
    }
    action(actions(pieces), {
      id: 'puzzle-reassemble',
      label: 'Reassemble',
      kind: 'primary',
      onClick: () => {
        separation.set(0);
        relief.set(1);
        view?.selectParcel(null);
        view?.puzzle.setHoveredParcel(null);
        view?.setRelief(1);
        view?.setSeparation(0);
      }
    });

    const about = section(ctx.panel, 'Handling');
    note(about, 'Hover lifts a piece. Click pins it in front of the brain. Drag the pinned piece or its preview to rotate it; Return piece puts it back.');
    note(about, 'Separation and relief change display geometry only. Shell thickness is illustrative.');
    const links = document.createElement('p');
    links.className = 'margin-note';
    const citation = document.createElement('a');
    citation.target = '_blank';
    citation.rel = 'noopener noreferrer';
    citation.textContent = 'Atlas source and citation';
    links.append(citation);
    about.append(links);

    showView(currentView);
    mount(first, initial);
    ctx.perf(`${(geometry.vertices.length / 3).toLocaleString('en-US')} source vertices`);
    ctx.setBusy(false);
    return () => {
      disposed = true;
      generation++;
      if (view) {
        view.off('parcel:hover', onHover);
        view.off('selection:changed', onSelect);
        view.dispose();
      }
      stage.remove();
    };
  }
};
