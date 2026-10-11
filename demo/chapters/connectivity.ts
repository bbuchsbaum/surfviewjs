import './connectivity.css';
import {
  ColorMap, ConnectivityLayer, DataLayer, OutlineLayer, ParcelSurface, ParcelValueLayer,
  buildAdjacency, computeNeighborhoodShells, createPatternQualityChannel, mapQualityChannelValue
} from '@src/index.js';
import type { AnatomicalView, GraphEdge, ParcelData, ParcelInteractionEvent, ParcelSelectionEvent } from '@src/index.js';
import excerpt from '../excerpts/connectivity.ts?raw';
import { action, actions, choice, fmt, note, readout, section, select, slider, toggle } from '../kit/controls';
import { DEPTH_UNDERLAY, loadAtlas, loadMesh, sulcalDepthOf, seededRandom, smoothNoise, type AtlasFile } from '../kit/data';
import { createFilmViewer } from '../kit/film';
import type { Scenario } from '../types';
import { mutedNetworkColors, networkNames, networkOf, shortParcelName } from './atlasPalettes';

type Mode = 'seed' | 'edges' | 'topology';
type Atlas = AtlasFile & ParcelData;

const SURFACE_ID = 'lh';
const MODES: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: 'seed', label: 'Seed map' },
  { value: 'edges', label: 'Edges' },
  { value: 'topology', label: 'Topology lens' }
];
const VIEWS: ReadonlyArray<{ value: AnatomicalView; label: string }> = [
  { value: 'lateral', label: 'Lateral' },
  { value: 'medial', label: 'Medial' },
  { value: 'dorsal', label: 'Dorsal' }
];
const DIVERGING = [
  { value: 'coolwarm', label: 'Cool–warm' },
  { value: 'bwr', label: 'Blue–white–red' },
  { value: 'seismic', label: 'Seismic' }
] as const;

/**
 * Between-network coupling added to the synthetic matrix: default-mode anticorrelated with the
 * attention networks, default coupled with control. Symmetric; unlisted pairs get −0.06.
 */
const COUPLING: Record<string, number> = {
  'Default|DorsAttn': -0.34, 'Default|SalVentAttn': -0.24, 'Cont|Default': 0.14, 'DorsAttn|Vis': 0.12,
  'DorsAttn|SomMot': 0.06, 'Cont|SalVentAttn': 0.12, 'SalVentAttn|SomMot': 0.1, 'Cont|DorsAttn': 0.08
};
/** Network offsets of the synthetic per-parcel statistic used by the topology lens. */
const NETWORK_VALUE: Record<string, number> = {
  Vis: 1.2, SomMot: 0.6, DorsAttn: 0.9, SalVentAttn: 0.2, Limbic: -0.4, Cont: -0.2, Default: -1
};

interface Parcels {
  ids: number[];
  networks: string[];
  centroids: Float32Array;
  /** Vertex nearest each parcel centroid: edge endpoints and node positions. */
  anchors: number[];
  sizes: number[];
  adjacency: Map<number | string, Array<number | string>>;
}

function describeParcels(vertices: Float32Array, faces: Uint32Array, labels: number[], atlas: Atlas): Parcels {
  const ids = atlas.parcels.map(parcel => parcel.id);
  const row = new Map(ids.map((id, index) => [id, index]));
  const sums = new Float64Array(ids.length * 3);
  const sizes = new Array<number>(ids.length).fill(0);
  for (let v = 0; v < labels.length; v++) {
    const index = row.get(labels[v]!);
    if (index === undefined) continue;
    sums[index * 3] += vertices[v * 3]!;
    sums[index * 3 + 1] += vertices[v * 3 + 1]!;
    sums[index * 3 + 2] += vertices[v * 3 + 2]!;
    sizes[index]!++;
  }
  const centroids = new Float32Array(ids.length * 3);
  for (let i = 0; i < ids.length; i++) for (let k = 0; k < 3; k++) centroids[i * 3 + k] = sums[i * 3 + k]! / Math.max(1, sizes[i]!);
  const anchors = new Array<number>(ids.length).fill(-1);
  const best = new Array<number>(ids.length).fill(Infinity);
  for (let v = 0; v < labels.length; v++) {
    const index = row.get(labels[v]!);
    if (index === undefined) continue;
    const dx = vertices[v * 3]! - centroids[index * 3]!, dy = vertices[v * 3 + 1]! - centroids[index * 3 + 1]!, dz = vertices[v * 3 + 2]! - centroids[index * 3 + 2]!;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < best[index]!) { best[index] = distance; anchors[index] = v; }
  }
  const pairs = new Set<string>();
  const edges: GraphEdge[] = [];
  for (let f = 0; f < faces.length; f += 3) {
    for (const [a, b] of [[faces[f]!, faces[f + 1]!], [faces[f + 1]!, faces[f + 2]!], [faces[f + 2]!, faces[f]!]] as const) {
      const pa = labels[a]!, pb = labels[b]!;
      if (!pa || !pb || pa === pb) continue;
      const key = pa < pb ? `${pa}-${pb}` : `${pb}-${pa}`;
      if (pairs.has(key)) continue;
      pairs.add(key);
      edges.push({ source: Math.min(pa, pb), target: Math.max(pa, pb) });
    }
  }
  return {
    ids, centroids, anchors, sizes,
    networks: atlas.parcels.map(parcel => networkOf(parcel.label) ?? ''),
    adjacency: buildAdjacency(edges)
  };
}

/** Synthetic parcel × parcel matrix: distance decay + network membership + seeded symmetric noise. */
function syntheticMatrix(parcels: Parcels): Float32Array {
  const n = parcels.ids.length;
  const random = seededRandom(400);
  const matrix = new Float32Array(n * n);
  const { centroids, networks } = parcels;
  for (let i = 0; i < n; i++) {
    matrix[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      const dx = centroids[i * 3]! - centroids[j * 3]!, dy = centroids[i * 3 + 1]! - centroids[j * 3 + 1]!, dz = centroids[i * 3 + 2]! - centroids[j * 3 + 2]!;
      const local = 0.45 * Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * 22 * 22));
      const a = networks[i]!, b = networks[j]!;
      const network = a === b ? 0.32 : COUPLING[[a, b].sort().join('|')] ?? -0.06;
      const value = Math.max(-1, Math.min(1, local + network + 0.16 * (random() - 0.5)));
      matrix[i * n + j] = value;
      matrix[j * n + i] = value;
    }
  }
  return matrix;
}

function nameOf(atlas: Atlas, id: number | null): string {
  if (id === null) return '—';
  const parcel = atlas.parcels.find(entry => entry.id === id);
  return parcel ? `${id} · ${shortParcelName(parcel.label)}` : String(id);
}

export const connectivity: Scenario = {
  id: 'connectivity',
  aliases: ['parcel-connectivity', 'topologyLens'],
  title: 'Parcels & connectivity',
  short: 'Connectivity',
  group: 'atlases',
  tags: ['connectivity', 'parcellation', 'Schaefer', 'edges', 'graph', 'hover'],
  summary:
    'The Schaefer–Yeo 400 (7 networks) parcels of the fs_LR 32k inflated left hemisphere, with a parcel × parcel connectivity matrix shown three ways. Seed map paints the surface by the hovered parcel’s row; click a parcel (or a matrix row) to lock it. Edges draws the strongest connections between parcel centres as lines or tubes. Topology lens rings the locked parcel by neighbourhood hops, marks boundaries by how much the parcel statistic changes across them, and outlines parcels by a quality score.',
  synthetic:
    'The atlas is real. The connectivity matrix is synthetic: distance decay between parcel centroids, within-network coupling, default-mode anticorrelation with attention networks, and seeded noise. The topology statistic (network offset plus smooth noise) and the quality score (grows with parcel size) are synthetic too.',
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fs_LR 32k surface and Schaefer 400 parcels');
    const [geometry, atlas, depth] = await Promise.all([
      loadMesh('fsLR32kLeftInflated'),
      loadAtlas('schaefer400x7') as Promise<Atlas>,
      sulcalDepthOf('fsLR32kLeftInflated')
    ]);
    const film = ctx.film;
    const labels = atlas.vertexLabels;
    const parcels = describeParcels(geometry.vertices, geometry.faces, labels, atlas);
    const n = parcels.ids.length;
    const row = new Map(parcels.ids.map((id, index) => [id, index]));
    const matrix = syntheticMatrix(parcels);

    // Per-parcel synthetic statistic and quality score for the topology lens.
    const noise = smoothNoise(parcels.centroids, 7, 0.8, 60);
    const random = seededRandom(17);
    const maxSize = Math.max(...parcels.sizes);
    const statistic = parcels.ids.map((_, i) => (NETWORK_VALUE[parcels.networks[i]!] ?? 0) + noise[i]!);
    const quality = parcels.ids.map((_, i) => Math.max(0.05, Math.min(0.98, 0.2 + 0.75 * Math.sqrt(parcels.sizes[i]! / maxSize) + 0.1 * (random() - 0.5))));
    const records: ParcelData['parcels'] = atlas.parcels;
    const topologyData = (lens: Map<number, number> | null): ParcelData => ({
      ...atlas,
      parcels: records.map((parcel, i) => ({
        ...parcel, value: statistic[i]!, quality: quality[i]!, lens: lens?.get(parcel.id) ?? Number.NaN
      }))
    });

    const { viewer, cleanup } = createFilmViewer(ctx.mount, { hoverCrosshair: true, hoverCrosshairColor: 0xf2c230 });
    const surface = new ParcelSurface(geometry, {
      parcelData: atlas,
      vertexLabels: labels,
      // Sulcal depth from the folded midthickness: the inflated mesh has no folds.
      curvature: depth,
      showCurvature: true,
      curvatureOptions: DEPTH_UNDERLAY
    });
    surface.hemisphere = 'left';
    viewer.addSurface(surface, SURFACE_ID);

    // Layers are added bottom to top.
    surface.addParcelColorLayer('networks', parcel => mutedNetworkColors[networkOf(parcel.label) ?? ''] ?? null, { opacity: 0.32 });
    const seedLayer = surface.addParcelConnectivityLayer('seed-map', matrix, 'coolwarm', {
      range: [-1, 1], threshold: 0.18, alphaMode: 'constant', alphaRange: [0.92, 0.92], showSeedParcel: true
    });
    const valueLayer = new ParcelValueLayer('topology-values', topologyData(null), labels, 'viridis', {
      valueColumn: 'value', range: [-2, 2], opacity: 0.9, visible: false
    });
    surface.addLayer(valueLayer);
    const lensLayer = new ParcelValueLayer('topology-lens', topologyData(null), labels, 'magma', {
      valueColumn: 'lens', range: [0, 1], opacity: 0.85, visible: false
    });
    surface.addLayer(lensLayer);

    // Boundary tension: every vertex on a parcel boundary carries |Δ statistic| across that boundary.
    const tension = new Float32Array(labels.length).fill(Number.NaN);
    for (let f = 0; f < geometry.faces.length; f += 3) {
      for (const [a, b] of [[geometry.faces[f]!, geometry.faces[f + 1]!], [geometry.faces[f + 1]!, geometry.faces[f + 2]!], [geometry.faces[f + 2]!, geometry.faces[f]!]] as const) {
        const ra = row.get(labels[a]!), rb = row.get(labels[b]!);
        if (ra === undefined || rb === undefined || ra === rb) continue;
        const delta = Math.abs(statistic[ra]! - statistic[rb]!);
        tension[a] = Math.max(Number.isNaN(tension[a]!) ? 0 : tension[a]!, delta);
        tension[b] = Math.max(Number.isNaN(tension[b]!) ? 0 : tension[b]!, delta);
      }
    }
    const tensionLayer = new DataLayer('topology-tension', tension, null, 'hot', { range: [0, 2.4], threshold: [0, 0.5], visible: false });
    surface.addLayer(tensionLayer);

    surface.addParcelOutlineLayer('outline', { color: 0x0b1118, width: 0.8, opacity: 0.4 });
    const qualityChannel = createPatternQualityChannel('quality', 'higher-is-better', [0, 1]);
    const buckets = { solid: [] as number[], dashed: [] as number[], dotted: [] as number[] };
    parcels.ids.forEach((id, i) => buckets[mapQualityChannelValue(quality[i]!, qualityChannel).mappedValue as keyof typeof buckets].push(id));
    const qualityLayers = [
      new OutlineLayer('quality-high', { roiLabels: labels, roiSubset: buckets.solid, color: 0x93a6b4, width: 0.5, opacity: 0.3, visible: false }),
      new OutlineLayer('quality-mid', { roiLabels: labels, roiSubset: buckets.dashed, color: 0x93a6b4, width: 1, opacity: 0.6, visible: false }),
      new OutlineLayer('quality-low', {
        roiLabels: labels, roiSubset: buckets.dotted, color: 0xc3ced6, width: 1.6, opacity: 0.85, visible: false
      })
    ];
    for (const layer of qualityLayers) surface.addLayer(layer);

    // The same matrix as edges between the vertices nearest each parcel centroid.
    const edges = ConnectivityLayer.fromMatrix('edges', matrix, {
      vertexIndices: parcels.anchors, colorMap: 'coolwarm', weightRange: [-1, 1], threshold: 0.5, topN: 150, renderMode: 'tube',
      tubeRadius: 0.35, tubeRadiusScale: true, showNodes: true, nodeRadius: 1.1, nodeColor: 0xedf2f5, opacity: 0.9, visible: false
    });
    surface.addLayer(edges);

    const state = {
      mode: 'seed' as Mode, view: 'lateral' as AnatomicalView, locked: null as number | null, hovered: null as number | null,
      threshold: 0.18, colormap: 'coolwarm', hops: 2, tension: true, quality: true, lockedEdgesOnly: false
    };
    const showView = (next: AnatomicalView) => {
      state.view = next;
      viewer.setAnatomicalView(next, { layout: 'single', surfaceId: SURFACE_ID, fit: true });
      viewer.fitToView({ padding: 0.06 });
    };
    showView('lateral');
    film.trackOrientation(viewer);
    film.set('tl', 'surface', 'Surface', 'fs_LR 32k inflated, L');
    film.set('tl', 'atlas', 'Atlas', 'Schaefer 400 · 7 networks');

    // ── margin ──
    const sceneSection = section(ctx.panel, 'Scene');
    choice(sceneSection, {
      id: 'conn-mode', label: 'Show the matrix as', options: MODES, value: state.mode,
      print: { film, corner: 'tr', key: 'mode', label: 'Mode' },
      onChange: next => setMode(next)
    });
    choice(sceneSection, {
      id: 'conn-view', label: 'Anatomical view', options: VIEWS, value: state.view,
      print: { film, corner: 'tr', key: 'view', label: 'View' },
      onChange: showView
    });
    const parcelSelect = select(sceneSection, {
      id: 'conn-parcel', label: 'Locked parcel',
      options: [{ value: '', label: 'None (hover to preview)' },
        ...atlas.parcels.map(parcel => ({ value: String(parcel.id), label: `${parcel.id} · ${shortParcelName(parcel.label)}` }))],
      value: '',
      onChange: value => {
        if (value) viewer.setParcelSelection(SURFACE_ID, Number(value));
        else viewer.clearParcelSelection();
      }
    });
    const lockedReadout = readout(sceneSection, 'Locked', 'conn-locked');
    action(actions(sceneSection), { id: 'conn-clear', label: 'Clear lock', onClick: () => viewer.clearParcelSelection() });

    const seedSection = section(ctx.panel, 'Seed map');
    const seedThreshold = slider(seedSection, {
      id: 'conn-threshold', label: 'Hide connections weaker than |r|', min: 0, max: 0.9, step: 0.02, value: state.threshold,
      format: value => (value === 0 ? 'off' : fmt(value)),
      onInput: value => {
        state.threshold = value;
        seedLayer.setThreshold(value === 0 ? null : value);
        viewer.requestRender();
        printBottom('threshold', value === 0 ? 'off' : fmt(value));
      }
    });
    choice(seedSection, {
      id: 'conn-alpha', label: 'Opacity', value: 'constant',
      options: [{ value: 'constant', label: 'Constant' }, { value: 'magnitude', label: 'By |r|' }],
      onChange: next => {
        printBottom('alpha', next === 'constant' ? 'Constant' : 'By |r|');
        seedLayer.update({ alphaMode: next, alphaRange: next === 'constant' ? [0.92, 0.92] : [0.1, 1] });
        viewer.requestRender();
      }
    });
    select(seedSection, {
      id: 'conn-colormap', label: 'Colormap', options: DIVERGING, value: 'coolwarm',
      print: { film, corner: 'tr', key: 'colormap', label: 'Colormap' },
      onChange: next => {
        state.colormap = next;
        seedLayer.setColorMap(next);
        edges.update({ colorMap: next });
        viewer.requestRender();
        paintMatrix();
      }
    });
    toggle(seedSection, {
      id: 'conn-show-seed', label: 'Paint the seed parcel itself', checked: true,
      onChange: checked => { seedLayer.update({ showSeedParcel: checked }); viewer.requestRender(); }
    });
    const valueReadout = readout(seedSection, 'r with seed', 'conn-r');
    const partnerReadout = readout(seedSection, 'Strongest partner', 'conn-partner');
    const hoverNetwork = readout(seedSection, 'Hovered network', 'conn-network');

    const edgeSection = section(ctx.panel, 'Edges');
    choice(edgeSection, {
      id: 'conn-render', label: 'Draw edges as', value: 'tube',
      options: [{ value: 'tube', label: 'Tubes' }, { value: 'line', label: 'Lines' }],
      onChange: next => { edges.update({ renderMode: next }); viewer.requestRender(); }
    });
    toggle(edgeSection, {
      id: 'conn-nodes', label: 'Parcel nodes', checked: true,
      onChange: checked => { edges.update({ showNodes: checked }); viewer.requestRender(); }
    });
    slider(edgeSection, {
      id: 'conn-edge-threshold', label: 'Hide edges weaker than |r|', min: 0.3, max: 0.95, step: 0.01, value: 0.5,
      format: value => fmt(value),
      onInput: value => { edges.update({ threshold: value }); viewer.requestRender(); printBottom('edge-threshold', fmt(value)); countEdges(); }
    });
    slider(edgeSection, {
      id: 'conn-topn', label: 'Strongest edges kept', min: 0, max: 600, step: 10, value: 150,
      format: value => (value === 0 ? 'all' : String(value)),
      onInput: value => { edges.update({ topN: value }); viewer.requestRender(); printBottom('topn', value === 0 ? 'all' : String(value)); countEdges(); }
    });
    toggle(edgeSection, {
      id: 'conn-locked-edges', label: 'Only edges of the locked parcel', checked: false,
      onChange: checked => { state.lockedEdgesOnly = checked; filterEdges(); }
    });
    const edgeReadout = readout(edgeSection, 'Edges drawn', 'conn-edge-count');

    const matrixSection = section(ctx.panel, 'Matrix');
    const matrixCanvas = document.createElement('canvas');
    matrixCanvas.className = 'conn-matrix';
    matrixCanvas.width = n + 4;
    matrixCanvas.height = n + 4;
    matrixCanvas.setAttribute('role', 'img');
    matrixCanvas.setAttribute('aria-label', 'Parcel by parcel connectivity matrix, parcels ordered by network. Hover a row to preview its seed map; click to lock it.');
    matrixSection.append(matrixCanvas);
    note(matrixSection, 'Rows and columns follow the atlas order (Visual → Default); the band marks each network. Hover a row to preview it, click to lock.');

    const topologySection = section(ctx.panel, 'Topology lens');
    slider(topologySection, {
      id: 'conn-hops', label: 'Neighbourhood hops', min: 1, max: 4, step: 1, value: state.hops,
      onInput: value => { state.hops = value; printBottom('hops', String(value)); applyLens(); }
    });
    toggle(topologySection, {
      id: 'conn-tension', label: 'Boundary tension (|Δ| across each border)', checked: true,
      onChange: checked => { state.tension = checked; printBottom('tension', checked ? 'ON' : 'OFF'); applyMode(); }
    });
    toggle(topologySection, {
      id: 'conn-quality', label: 'Outline parcels by quality', checked: true,
      onChange: checked => { state.quality = checked; applyMode(); }
    });
    note(topologySection, 'Heavy outlines mark low quality, light outlines high quality. Without a locked parcel the lens centres on the parcel with the highest statistic.');
    const focusReadout = readout(topologySection, 'Lens centre', 'conn-focus');

    const sections: Record<Mode, HTMLElement[]> = {
      seed: [seedSection, matrixSection], edges: [edgeSection, matrixSection], topology: [topologySection]
    };
    const modeKeys: Record<Mode, string[]> = { seed: ['threshold', 'alpha'], edges: ['edge-threshold', 'topn', 'edges'], topology: ['hops', 'tension'] };
    const bottomLabels: Record<string, string> = {
      threshold: 'Threshold', alpha: 'Opacity', 'edge-threshold': 'Threshold', topn: 'Top N', edges: 'Edges', hops: 'Hops', tension: 'Tension'
    };
    const bottomValues = new Map<string, string>();

    // ── matrix drawing ──
    const matrixBase = document.createElement('canvas');
    matrixBase.width = matrixBase.height = n + 4;
    const paintMatrix = () => {
      const context = matrixBase.getContext('2d')!;
      const image = context.createImageData(n + 4, n + 4);
      const colormap = ColorMap.fromPreset(state.colormap, { range: [-1, 1] });
      const put = (x: number, y: number, rgb: readonly number[]) => {
        const offset = (y * (n + 4) + x) * 4;
        image.data[offset] = rgb[0]!; image.data[offset + 1] = rgb[1]!; image.data[offset + 2] = rgb[2]!; image.data[offset + 3] = 255;
      };
      for (let i = 0; i < n; i++) {
        const band = mutedNetworkColors[parcels.networks[i]!] ?? '#93a6b4';
        const rgb = [1, 3, 5].map(k => parseInt(band.slice(k, k + 2), 16));
        for (let k = 0; k < 3; k++) { put(4 + i, k, rgb); put(k, 4 + i, rgb); }
        for (let j = 0; j < n; j++) put(4 + j, 4 + i, colormap.getColor(matrix[i * n + j]!).slice(0, 3).map(c => Math.round(c * 255)));
      }
      context.putImageData(image, 0, 0);
      drawMatrix();
    };
    const drawMatrix = () => {
      const context = matrixCanvas.getContext('2d')!;
      context.clearRect(0, 0, n + 4, n + 4);
      context.drawImage(matrixBase, 0, 0);
      const seed = state.locked ?? state.hovered;
      const index = seed === null ? undefined : row.get(seed);
      if (index === undefined) return;
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mark').trim();
      context.globalAlpha = state.locked === null ? 0.55 : 0.9;
      context.fillRect(4, 4 + index, n, 1);
      context.fillRect(4 + index, 4, 1, n);
      context.globalAlpha = 1;
    };
    const parcelAtMatrix = (event: MouseEvent): number | null => {
      const rect = matrixCanvas.getBoundingClientRect();
      const y = Math.floor(((event.clientY - rect.top) / rect.height) * (n + 4)) - 4;
      return y >= 0 && y < n ? parcels.ids[y]! : null;
    };
    const onMatrixMove = (event: MouseEvent) => {
      if (state.locked !== null) return;
      const id = parcelAtMatrix(event);
      if (id === null) viewer.clearParcelHover();
      else viewer.setParcelHover(SURFACE_ID, id);
    };
    const onMatrixLeave = () => { if (state.locked === null) viewer.clearParcelHover(); };
    const onMatrixClick = (event: MouseEvent) => {
      const id = parcelAtMatrix(event);
      if (id === null) return;
      if (state.locked === id) viewer.clearParcelSelection();
      else viewer.setParcelSelection(SURFACE_ID, id);
    };
    matrixCanvas.addEventListener('mousemove', onMatrixMove);
    matrixCanvas.addEventListener('mouseleave', onMatrixLeave);
    matrixCanvas.addEventListener('click', onMatrixClick);

    // ── behaviour ──
    function printBottom(key: string, value: string | null) {
      if (value === null) bottomValues.delete(key);
      else bottomValues.set(key, value);
      if (modeKeys[state.mode].includes(key)) film.set('bl', key, bottomLabels[key]!, value);
    }
    function countEdges() {
      const count = edges.getEdgeCount();
      edgeReadout.set(count.toLocaleString('en-US'));
      printBottom('edges', count.toLocaleString('en-US'));
    }
    function filterEdges() {
      const index = state.locked === null ? undefined : row.get(state.locked);
      edges.update({ regionFilter: state.lockedEdgesOnly && index !== undefined ? [parcels.anchors[index]!] : null });
      viewer.requestRender();
      countEdges();
    }
    function seedReadouts(seed: number | null) {
      if (seed === null) {
        valueReadout.set('—');
        partnerReadout.set('—');
        return;
      }
      const seedRow = row.get(seed)!;
      let bestIndex = -1, bestValue = 0;
      for (let j = 0; j < n; j++) {
        if (j === seedRow) continue;
        const value = matrix[seedRow * n + j]!;
        if (bestIndex < 0 || Math.abs(value) > Math.abs(bestValue)) { bestIndex = j; bestValue = value; }
      }
      partnerReadout.set(`${nameOf(atlas, parcels.ids[bestIndex]!)} (${fmt(bestValue)})`);
    }
    function setSeed(seed: number | null) {
      if (seedLayer.getSeedParcelId() !== seed) {
        seedLayer.setSeedParcel(seed);
        viewer.requestRender();
      }
      seedReadouts(seed);
      drawMatrix();
    }
    function applyLens() {
      let focus = state.locked;
      if (focus === null) {
        let best = 0;
        statistic.forEach((value, i) => { if (value > statistic[best]!) best = i; });
        focus = parcels.ids[best]!;
      }
      const shells = computeNeighborhoodShells(parcels.adjacency, focus, state.hops);
      const lens = new Map<number, number>();
      for (const [node, hop] of shells) lens.set(Number(node), Math.max(0, 1 - hop / (state.hops + 0.3)));
      lensLayer.setParcelData(topologyData(lens), 'lens');
      viewer.requestRender();
      const index = row.get(focus)!;
      focusReadout.set(`${nameOf(atlas, focus)}${state.locked === null ? ' (auto)' : ''}`);
      if (state.mode === 'topology') {
        film.set('br', 'focus', 'Lens', nameOf(atlas, focus));
        film.set('br', 'statistic', 'Value', `${fmt(statistic[index]!)} · q ${fmt(quality[index]!)}`);
      }
    }
    function applyMode() {
      const mode = state.mode;
      const topology = mode === 'topology';
      for (const element of new Set(Object.values(sections).flat())) element.hidden = !sections[mode].includes(element);
      const visibility: Record<string, boolean> = {
        networks: !topology,
        'seed-map': mode === 'seed',
        'topology-values': topology,
        'topology-lens': topology,
        'topology-tension': topology && state.tension,
        outline: !topology || !state.quality,
        'quality-high': topology && state.quality,
        'quality-mid': topology && state.quality,
        'quality-low': topology && state.quality,
        edges: mode === 'edges'
      };
      for (const [id, visible] of Object.entries(visibility)) viewer.updateLayer(SURFACE_ID, id, { visible });
      for (const key of Object.keys(bottomLabels)) film.set('bl', key, bottomLabels[key]!, null);
      for (const key of modeKeys[mode]) if (bottomValues.has(key)) film.set('bl', key, bottomLabels[key]!, bottomValues.get(key)!);
      for (const key of ['focus', 'statistic']) film.set('br', key, '', null);
      if (topology) {
        film.set('br', 'r', '', null);
        applyLens();
      } else {
        seedReadouts(state.locked ?? state.hovered);
      }
      ctx.status(`${MODES.find(entry => entry.value === mode)!.label} · ${n} parcels`);
    }
    function setMode(next: Mode) {
      state.mode = next;
      applyMode();
    }

    const onHover = (event: ParcelInteractionEvent) => {
      const id = event.surfaceId === SURFACE_ID ? event.parcelId : null;
      if (id === state.hovered) return;
      state.hovered = id;
      const parcel = id === null ? null : atlas.parcels.find(entry => entry.id === id);
      film.set('br', 'hover', 'Parcel', nameOf(atlas, id));
      const seedValue = id === null ? null : seedLayer.getConnectivityValue(id, state.locked ?? id);
      if (state.mode !== 'topology') film.set('br', 'r', 'r', seedValue === null ? '—' : fmt(seedValue));
      hoverNetwork.set(parcel ? networkNames[networkOf(parcel.label) ?? ''] ?? '—' : '—');
      if (state.locked === null) setSeed(id);
      else {
        const value = id === null ? null : seedLayer.getConnectivityValue(id);
        valueReadout.set(value === null ? '—' : fmt(value));
        drawMatrix();
      }
    };
    const onClick = (event: ParcelInteractionEvent) => {
      if (event.parcelId === null) return;
      if (state.locked === event.parcelId) viewer.clearParcelSelection();
      else viewer.setParcelSelection(SURFACE_ID, event.parcelId);
    };
    const onSelected = (event: ParcelSelectionEvent) => {
      state.locked = event.selected ? event.parcelId : null;
      parcelSelect.set(state.locked === null ? '' : String(state.locked));
      lockedReadout.set(nameOf(atlas, state.locked));
      film.set('br', 'locked', 'Locked', nameOf(atlas, state.locked));
      setSeed(state.locked ?? state.hovered);
      filterEdges();
      if (state.mode === 'topology') applyLens();
    };
    viewer.on('parcel:hover', onHover);
    viewer.on('parcel:click', onClick);
    viewer.on('parcel:selected', onSelected);

    paintMatrix();
    lockedReadout.set('—');
    valueReadout.set('—');
    partnerReadout.set('—');
    film.set('br', 'locked', 'Locked', '—');
    film.set('br', 'hover', 'Parcel', '—');
    for (const key of ['threshold', 'alpha']) bottomValues.set(key, key === 'threshold' ? fmt(seedThreshold.input.valueAsNumber) : 'Constant');
    bottomValues.set('edge-threshold', fmt(0.5));
    bottomValues.set('topn', '150');
    bottomValues.set('hops', String(state.hops));
    bottomValues.set('tension', 'ON');
    countEdges();
    applyMode();
    ctx.perf(`${n} parcels · ${(labels.length).toLocaleString('en-US')} vertices · ${((n * (n - 1)) / 2).toLocaleString('en-US')} parcel pairs`);
    ctx.setBusy(false);
    return () => {
      viewer.off('parcel:hover', onHover);
      viewer.off('parcel:click', onClick);
      viewer.off('parcel:selected', onSelected);
      matrixCanvas.removeEventListener('mousemove', onMatrixMove);
      matrixCanvas.removeEventListener('mouseleave', onMatrixLeave);
      matrixCanvas.removeEventListener('click', onMatrixClick);
      cleanup();
    };
  }
};
