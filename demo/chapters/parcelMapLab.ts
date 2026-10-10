import './parcelMapLab.css';
import {
  DEFAULT_PARCEL_MAP_PARAMETERS, ParcelMapOptimizer, THREE, buildParcelMapMesh, buildParcelPuzzle, flattenParcelMap
} from '@src/index.js';
import type {
  NeuroSurfaceViewer, ParcelData, ParcelMapMesh, ParcelMapMetrics, ParcelMapParameters, ParcelPuzzleGeometry, ParcelPuzzleInput
} from '@src/index.js';
import excerpt from '../excerpts/parcelMapLab.ts?raw';
import { action, actions, fmt, note, section, select, slider, toggle, type SliderHandle } from '../kit/controls';
import { loadAtlas, loadMesh, type AtlasFile } from '../kit/data';
import { createFilmViewer, type FilmViewer } from '../kit/film';
import type { Scenario } from '../types';
import { mutedNetworkColors, networkOf, shortParcelName } from './atlasPalettes';

type Dataset = 'schaefer' | 'glasser' | 'toy';
type ColorMode = 'atlas' | 'area' | 'compactness';
type Setting = keyof ParcelMapParameters;
interface Atlas extends ParcelData { vertexLabels: number[]; source?: unknown }
interface Snapshot { label: string; coordinates: Float64Array; parameters: ParcelMapParameters; metrics: ParcelMapMetrics; image: string }
interface Prepared { mesh: ParcelMapMesh; input: ParcelPuzzleInput & { parcelData: Atlas } }

const DATASETS: ReadonlyArray<{ value: Dataset; label: string }> = [
  { value: 'schaefer', label: 'Schaefer–Yeo · 200 left parcels' },
  { value: 'glasser', label: 'Glasser · 180 left parcels' },
  { value: 'toy', label: 'Nine-piece synthetic sheet' }
];
const OUTLINES = [{ value: '2', label: 'Disk' }, { value: '4', label: 'Rounded square' }, { value: '6', label: 'Nearly square' }] as const;
const PRESETS = [
  { name: 'Fidelity', angleWeight: 1.5, areaWeight: 1, compactnessWeight: 0.1, equalArea: 0 },
  { name: 'Balanced', angleWeight: 0.3, areaWeight: 3, compactnessWeight: 0.6, equalArea: 0.35 },
  { name: 'Tile emphasis', angleWeight: 0.08, areaWeight: 8, compactnessWeight: 2, equalArea: 0.8 }
];
const SETTINGS: ReadonlyArray<{ key: Setting; label: string; name: string; min: number; max: number; step: number; format: (value: number) => string }> = [
  { key: 'angleWeight', label: 'Angle fidelity', name: 'Angle fidelity weight', min: 0, max: 4, step: 0.05, format: value => fmt(value) },
  { key: 'areaWeight', label: 'Area matching', name: 'Area matching weight', min: 0, max: 10, step: 0.1, format: value => fmt(value) },
  { key: 'compactnessWeight', label: 'Compactness', name: 'Compactness weight', min: 0, max: 4, step: 0.05, format: value => fmt(value) },
  { key: 'equalArea', label: 'Area target', name: 'Equal area target', min: 0, max: 1, step: 0.05, format: value => `${Math.round(value * 100)}% equalization` },
  { key: 'resolution', label: 'Deformation resolution', name: 'Deformation resolution', min: 6, max: 24, step: 2, format: value => `${value} × ${value}` }
];

/** A 25 × 25 corrugated sheet split into nine Voronoi-like pieces, for fast experiments. */
function toy(): { vertices: number[]; faces: number[]; data: Atlas } {
  const seeds = [[0.16, 0.15], [0.48, 0.12], [0.81, 0.18], [0.27, 0.45], [0.57, 0.5], [0.88, 0.52], [0.1, 0.81], [0.48, 0.85], [0.8, 0.83]];
  const vertices: number[] = [], faces: number[] = [], vertexLabels: number[] = [];
  const size = 25;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    vertices.push(u * 100, v * 100, 18 * Math.sin(u * 3.8) * Math.cos(v * 4.2));
    let nearest = 0, distance = Infinity;
    seeds.forEach(([a, b], i) => {
      const d = (u + 0.08 * Math.sin(v * 12) - a!) ** 2 + (v - b!) ** 2;
      if (d < distance) { distance = d; nearest = i; }
    });
    vertexLabels.push(nearest + 1);
    if (x < size - 1 && y < size - 1) { const a = y * size + x; faces.push(a, a + 1, a + size + 1, a, a + size + 1, a + size); }
  }
  const colors = ['#a7bbc6', '#bea68f', '#a6b897', '#c5aebd', '#a8bfc0', '#c7bd98', '#bfa4a4', '#a6aabf', '#adb79e'];
  return {
    vertices, faces,
    data: {
      schema_version: '1.0.0', atlas: { id: 'synthetic-nine', name: 'Nine-piece synthetic sheet', n_parcels: 9 },
      parcels: seeds.map((_, i) => ({ id: i + 1, label: `Piece ${i + 1}`, hemi: null, color: colors[i] })), vertexLabels
    }
  };
}

/** The room's tokens, read once per draw so the canvas map uses the same exposure scale as the page. */
function tokens() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return { base: read('--d0'), inkHi: read('--ink-hi'), mark: read('--mark'), box: read('--box') };
}

export const parcelMapLab: Scenario = {
  id: 'parcel-map-lab',
  aliases: [],
  title: 'Parcel map lab',
  short: 'Map lab',
  group: 'atlases',
  layout: 'wide',
  tags: ['atlas', 'Glasser', 'Schaefer', 'parcels', '2d', 'flatmap', 'experimental'],
  summary:
    'Cuts the fs_LR 32k inflated left hemisphere at the medial wall and unfolds Schaefer or Glasser parcels into one connected planar map with no internal cuts. Weight angle fidelity, area matching and compactness, optimize, keep results to compare side by side, color the map by area error or compactness, and click a piece to see its original curved shape. Export the map with its parameters as JSON.',
  synthetic:
    'Parcels are the published atlases. The "Nine-piece synthetic sheet" dataset is a constructed corrugated grid for fast experiments.',
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Preparing the cortical map');
    const film = ctx.film;
    const root = document.createElement('div');
    root.className = 'parcel-map-lab';
    root.innerHTML = `<div class="pml-stage">
        <canvas data-map-canvas aria-label="Planar parcel map. Select a piece to inspect its original 3D shape."></canvas>
        <p class="pml-legend" data-color-legend></p>
        <div class="pml-tooltip" hidden></div>
        <div class="pml-loading" role="status">Preparing the cortical map</div>
        <aside class="pml-detail" aria-label="Original parcel shape" hidden>
          <div class="pml-detail-head"><h3 data-detail-title></h3>
            <button type="button" class="action" data-close-detail aria-label="Close parcel detail">Close</button></div>
          <div data-preview></div>
          <p data-detail-values></p>
          <p class="pml-detail-help">Original curved piece. Drag the preview to rotate it.</p>
        </aside>
      </div>
      <aside class="pml-controls" aria-label="Map experiment controls"></aside>`;
    ctx.mount.replaceChildren(root);
    const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
    const canvas = $<HTMLCanvasElement>('[data-map-canvas]'), stage = $('.pml-stage'), context = canvas.getContext('2d')!;
    const loading = $('.pml-loading'), tooltip = $('.pml-tooltip'), controls = $('.pml-controls');

    let disposed = false, request = 0, runToken = 0, debounce: ReturnType<typeof setTimeout> | undefined;
    let abort: AbortController | null = null, mesh: ParcelMapMesh | null = null, optimizer: ParcelMapOptimizer | null = null;
    let data: Atlas | null = null, shells: ParcelPuzzleGeometry | null = null, preview: FilmViewer | null = null;
    let previewMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial[]> | null = null;
    let metrics: ParcelMapMetrics | null = null, selected: number | null = null, hovered: number | null = null, iterations = 0;
    let paths: Path2D[] = [], loops: number[][][] = [], colors: string[] = [], saved: Snapshot[] = [];
    let transform = { scale: 1, x: 0, y: 0 }, settings: ParcelMapParameters = { ...DEFAULT_PARCEL_MAP_PARAMETERS };
    let dataset: Dataset = DATASETS.some(entry => entry.value === ctx.params.get('dataset')) ? ctx.params.get('dataset') as Dataset : 'schaefer';
    let colorMode: ColorMode = 'atlas';
    let outline = 2, aspect = 1;
    const listeners: Array<() => void> = [], cache = new Map<Dataset, Prepared>();
    const on = (target: EventTarget, type: string, handler: EventListener): void => {
      target.addEventListener(type, handler);
      listeners.push(() => target.removeEventListener(type, handler));
    };
    /** Instructions and outcomes go to the margin note; the film's edge print carries only counts (see refresh). */
    const say = (text: string): void => { status.textContent = text; };
    const stop = (): void => { runToken++; clearTimeout(debounce); root.dataset.running = 'false'; };

    // ── controls (inside the film: wide layout) ──
    const mapSection = section(controls, 'Map');
    const datasetSelect = select(mapSection, {
      id: 'pml-dataset', label: 'Dataset', options: DATASETS, value: dataset,
      print: { film, corner: 'tl', key: 'dataset', label: 'Dataset' },
      onChange: next => {
        dataset = next;
        const url = new URL(location.href);
        url.searchParams.set('dataset', dataset);
        history.replaceState(history.state, '', url);
        void initialize();
      }
    });
    datasetSelect.element.setAttribute('aria-label', 'Map dataset');
    const outlineSelect = select(mapSection, {
      id: 'pml-outline', label: 'Outline', options: OUTLINES, value: '2',
      print: { film, corner: 'tl', key: 'outline', label: 'Outline' },
      onChange: next => { outline = Number(next); void initialize(); }
    });
    outlineSelect.element.setAttribute('aria-label', 'Map outline');
    const aspectSlider = slider(mapSection, {
      id: 'pml-aspect', label: 'Aspect ratio', min: 0.6, max: 1.8, step: 0.1, value: 1,
      format: value => fmt(value), onInput: () => {}
    });
    aspectSlider.input.setAttribute('aria-label', 'Map aspect ratio');
    aspectSlider.input.dataset.aspect = '';
    on(aspectSlider.input, 'change', () => { aspect = Number(aspectSlider.input.value); void initialize(); });
    const boundaryNote = note(mapSection, '');

    const goals = section(controls, 'Optimization goals');
    const handles = new Map<Setting, SliderHandle>();
    for (const setting of SETTINGS) {
      const handle = slider(goals, {
        id: `pml-${setting.key}`, label: setting.label, min: setting.min, max: setting.max, step: setting.step,
        value: settings[setting.key], format: setting.format,
        onInput: value => {
          stop();
          updateSettings({ ...settings, [setting.key]: value });
          refresh();
          if (auto.input.checked) debounce = setTimeout(optimize, 300);
        }
      });
      handle.input.setAttribute('aria-label', setting.name);
      handle.input.dataset.setting = setting.key;
      handles.set(setting.key, handle);
    }
    note(goals, 'Weights express priorities. Area matching uses the target above; source proportions refer to the inflated display surface.');
    const runRow = actions(goals);
    action(runRow, { id: 'pml-optimize', label: 'Optimize 80 steps', kind: 'primary', onClick: () => optimize() });
    action(runRow, { id: 'pml-stop', label: 'Stop', onClick: () => { stop(); say(`Paused at ${iterations} accepted steps.`); } });
    action(runRow, {
      id: 'pml-reset', label: 'Reset map',
      onClick: () => { stop(); optimizer?.reset(); iterations = 0; refresh(); say('Restored the starting harmonic map. Current optimization goals are retained.'); }
    });
    const auto = toggle(goals, {
      id: 'pml-auto', label: 'Optimize after changing a goal', checked: true,
      onChange: checked => { if (!checked) clearTimeout(debounce); }
    });
    auto.input.dataset.auto = '';
    const status = note(goals, 'Preparing', 'margin-note pml-state');
    status.setAttribute('role', 'status');
    status.dataset.mapStatus = '';

    const compare = section(controls, 'Compare maps');
    const compareRow = actions(compare);
    action(compareRow, { id: 'pml-save', label: 'Keep this map', onClick: () => save(`Map ${saved.length + 1}`) });
    action(compareRow, { id: 'pml-sweep', label: 'Compare three balances', onClick: () => sweep() });
    const comparisons = document.createElement('div');
    comparisons.className = 'pml-comparisons';
    compare.append(comparisons);
    note(compare, 'Keep a result, change the goals and compare. Click a kept map to restore it.');

    const inspect = section(controls, 'Inspect');
    const colorSelect = select(inspect, {
      id: 'pml-color', label: 'Color mode',
      options: [{ value: 'atlas', label: 'Atlas colors' }, { value: 'area', label: 'Area relative to target' }, { value: 'compactness', label: 'Compactness' }],
      value: colorMode,
      print: { film, corner: 'tr', key: 'color', label: 'Color' },
      onChange: next => { colorMode = next; draw(); }
    });
    colorSelect.element.setAttribute('aria-label', 'Map color mode');
    const labels = toggle(inspect, { id: 'pml-labels', label: 'Show parcel IDs', checked: false, onChange: () => draw() });
    labels.input.dataset.labels = '';
    const reference = toggle(inspect, { id: 'pml-reference', label: 'Overlay starting boundaries', checked: false, onChange: () => draw() });
    reference.input.dataset.reference = '';
    const inspector = select(inspect, {
      id: 'pml-inspect', label: 'Inspect map parcel', options: [{ value: '', label: 'Choose a piece' }], value: '',
      onChange: value => selectPiece(value && mesh ? mesh.parcelIds.indexOf(Number(value)) : null)
    }).element;
    action(actions(inspect), { id: 'pml-export', label: 'Export map & parameters', onClick: () => exportMap() });
    const details = document.createElement('details');
    details.className = 'pml-notes';
    details.innerHTML = '<summary>What the numbers mean</summary>' +
      '<p>Area mismatch is the RMS relative error, weighted by target area. Angle distortion is a source-area-weighted conformal distortion; zero preserves local angles. Compactness is 4πA/P²; a circle scores 1.</p>' +
      '<p>The optimizer accepts only decreasing objective steps with positive triangle areas and a fixed convex boundary. It can stop at a constraint or local limit; it does not certify a global optimum. Source shape and area are from this inflated mesh.</p>';
    inspect.append(details);

    function updateSettings(next: ParcelMapParameters): void {
      settings = { ...next };
      optimizer?.setParameters(settings);
      for (const [key, handle] of handles) handle.set(settings[key]);
    }
    function makeLoops(): void {
      if (!mesh) return;
      loops = mesh.parcelIds.map((_, owner) => {
        const outgoing = new Map<number, number[]>();
        for (const edge of mesh!.edges) {
          if (edge.left === edge.right) continue;
          const a = edge.left === owner ? edge.a : edge.right === owner ? edge.b : -1;
          const b = edge.left === owner ? edge.b : edge.a;
          if (a !== -1) { const next = outgoing.get(a) ?? []; next.push(b); outgoing.set(a, next); }
        }
        const result: number[][] = [];
        while (outgoing.size) {
          const first = outgoing.keys().next().value!, loop = [first];
          let current = first;
          do {
            const next = outgoing.get(current);
            if (!next?.length) throw new Error('Parcel boundary path is open');
            current = next.pop()!;
            if (!next.length) outgoing.delete(loop[loop.length - 1]!);
            loop.push(current);
          } while (current !== first);
          result.push(loop);
        }
        return result;
      });
    }
    function makePaths(uv: Float64Array): Path2D[] {
      return loops.map(parcel => {
        const path = new Path2D();
        parcel.forEach(loop => {
          loop.forEach((v, j) => j ? path.lineTo(uv[v * 2]!, -uv[v * 2 + 1]!) : path.moveTo(uv[v * 2]!, -uv[v * 2 + 1]!));
          path.closePath();
        });
        return path;
      });
    }
    function draw(): void {
      if (!optimizer || !mesh || !metrics || disposed) return;
      const width = stage.clientWidth, height = stage.clientHeight, ratio = Math.min(devicePixelRatio || 1, 2);
      if (!width || !height) return;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      const ink = tokens();
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = ink.base;
      context.fillRect(0, 0, width, height);
      const uv = optimizer.coordinates;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      mesh.boundary.forEach(i => {
        minX = Math.min(minX, uv[i * 2]!); maxX = Math.max(maxX, uv[i * 2]!);
        minY = Math.min(minY, uv[i * 2 + 1]!); maxY = Math.max(maxY, uv[i * 2 + 1]!);
      });
      // Leave room for the scan corners above and below the map.
      const scale = Math.min((width - 64) / (maxX - minX), (height - 180) / (maxY - minY));
      transform = { scale, x: width / 2 - scale * (minX + maxX) / 2, y: height / 2 + scale * (minY + maxY) / 2 };
      context.translate(transform.x, transform.y);
      context.scale(scale, scale);
      paths = makePaths(uv);
      paths.forEach((path, i) => {
        let fill = colors[i]!;
        if (colorMode === 'area') {
          const error = Math.max(-1, Math.min(1, Math.log2(metrics!.parcelAreas[i]! / metrics!.targetAreas[i]!) / 2));
          fill = error < 0 ? `hsl(204 42% ${90 + error * 40}%)` : `hsl(12 52% ${90 - error * 39}%)`;
        } else if (colorMode === 'compactness') {
          fill = `hsl(${18 + 155 * Math.min(1, metrics!.parcelCompactness[i]!)} 35% 64%)`;
        }
        context.fillStyle = fill;
        context.fill(path);
        context.globalAlpha = 0.7;
        context.strokeStyle = ink.base;
        context.lineWidth = 0.9 / scale;
        context.stroke(path);
        context.globalAlpha = 1;
      });
      if (reference.input.checked) {
        context.globalAlpha = 0.55;
        context.strokeStyle = ink.base;
        context.lineWidth = 1 / scale;
        context.setLineDash([3 / scale, 3 / scale]);
        makePaths(optimizer.reference).forEach(path => context.stroke(path));
        context.setLineDash([]);
        context.globalAlpha = 1;
      }
      for (const owner of [hovered, selected]) {
        if (owner === null || !paths[owner]) continue;
        context.strokeStyle = owner === selected ? ink.mark : ink.inkHi;
        context.lineWidth = 2.5 / scale;
        context.stroke(paths[owner]!);
      }
      if (labels.input.checked) {
        const sums = mesh.parcelIds.map(() => [0, 0, 0]);
        for (let f = 0; f < mesh.faces.length; f += 3) {
          const a = mesh.faces[f]! * 2, b = mesh.faces[f + 1]! * 2, c = mesh.faces[f + 2]! * 2;
          const area = ((uv[b]! - uv[a]!) * (uv[c + 1]! - uv[a + 1]!) - (uv[b + 1]! - uv[a + 1]!) * (uv[c]! - uv[a]!)) / 2;
          const sum = sums[mesh.faceParcels[f / 3]!]!;
          sum[0]! += area * (uv[a]! + uv[b]! + uv[c]!) / 3;
          sum[1]! += area * (uv[a + 1]! + uv[b + 1]! + uv[c + 1]!) / 3;
          sum[2]! += area;
        }
        context.font = `${11 / scale}px "JetBrains Mono Variable", ui-monospace, monospace`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = ink.base;
        sums.forEach(([x, y, area], i) => {
          if (area! * scale * scale <= 220) return;
          const id = String(mesh!.parcelIds[i]);
          context.globalAlpha = 0.65;
          context.strokeStyle = ink.box;
          context.lineWidth = 2 / scale;
          context.strokeText(id, x! / area!, -y! / area!);
          context.globalAlpha = 1;
          context.fillText(id, x! / area!, -y! / area!);
        });
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      $('[data-color-legend]').textContent = colorMode === 'area' ? 'Blue: smaller than target · pale: on target · red: larger (±2 log₂)' :
        colorMode === 'compactness' ? 'Orange: elongated or irregular · teal: compact' : `${mesh.parcelIds.length} pieces · click a piece to inspect its original curved shape`;
    }
    function refresh(): void {
      if (!optimizer) return;
      metrics = optimizer.measure();
      film.set('bl', 'area', 'Area mismatch', `${(100 * Math.sqrt(metrics.areaError)).toFixed(1)}%`);
      film.set('bl', 'angle', 'Angle distortion', metrics.angleDistortion.toFixed(3));
      film.set('bl', 'compactness', 'Compactness', metrics.meanCompactness.toFixed(3));
      film.set('bl', 'flips', 'Flipped', String(metrics.flippedTriangles));
      film.set('tr', 'steps', 'Steps', String(iterations));
      if (mesh) ctx.status(`${mesh.parcelIds.length} pieces · ${iterations} accepted steps · ${metrics.flippedTriangles} flipped`);
      root.dataset.iterations = String(iterations);
      root.dataset.flips = String(metrics.flippedTriangles);
      root.dataset.objective = String(metrics.objective);
      root.dataset.minimumAreaRatio = String(metrics.minimumAreaRatio);
      if (selected !== null) detailValues();
      draw();
    }
    function detailValues(): void {
      if (selected === null || !mesh || !metrics) return;
      $('[data-detail-values]').textContent = `Area / target ${(metrics.parcelAreas[selected]! / metrics.targetAreas[selected]!).toFixed(2)}× · compactness ${metrics.parcelCompactness[selected]!.toFixed(3)}`;
    }
    function disposePreviewMesh(): void {
      previewMesh?.removeFromParent();
      previewMesh?.material.forEach(material => material.dispose());
      previewMesh = null;
    }
    function selectPiece(owner: number | null): void {
      selected = owner;
      $('.pml-detail').hidden = owner === null;
      inspector.value = owner === null ? '' : String(mesh!.parcelIds[owner]);
      root.dataset.selectedParcel = owner === null ? '' : String(mesh!.parcelIds[owner]);
      if (owner === null) {
        disposePreviewMesh();
        film.set('br', 'selected', 'Selected', '—');
        draw();
        return;
      }
      const piece = shells!.pieces.get(mesh!.parcelIds[owner]!)!;
      const name = shortParcelName(piece.parcel.label);
      $('[data-detail-title]').textContent = name;
      film.set('br', 'selected', 'Selected', `${piece.parcel.id} · ${name}`);
      detailValues();
      const mount = $('[data-preview]');
      preview ??= createFilmViewer(mount, { useShaders: false, ambientLightColor: 0xffffff, directionalLightIntensity: 2.3, hoverCrosshair: false });
      const viewer: NeuroSurfaceViewer = preview.viewer;
      disposePreviewMesh();
      const top = new THREE.MeshStandardMaterial({ color: colors[owner], roughness: 0.7 });
      previewMesh = new THREE.Mesh(piece.geometry, [top, new THREE.MeshStandardMaterial({ color: top.color.clone().multiplyScalar(0.65), roughness: 0.9 })]);
      viewer.scene.add(previewMesh);
      const radius = piece.geometry.boundingSphere!.radius + piece.geometry.boundingSphere!.center.length();
      viewer.cameraControls.target.set(0, 0, 0);
      viewer.camera.position.copy(piece.normal).multiplyScalar(radius * 4.3);
      viewer.camera.up.set(0, 0, 1);
      if (Math.abs(piece.normal.z) > 0.9) viewer.camera.up.set(0, 1, 0);
      viewer.camera.lookAt(0, 0, 0);
      viewer.cameraControls.update();
      viewer.requestRender();
      draw();
    }
    function pick(event: MouseEvent): number | null {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left - transform.x) / transform.scale, y = (event.clientY - rect.top - transform.y) / transform.scale;
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      const owner = paths.findIndex(path => context.isPointInPath(path, x, y));
      context.restore();
      return owner < 0 ? null : owner;
    }
    function renderSnapshots(): void {
      comparisons.replaceChildren();
      saved.forEach((snapshot, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pml-snapshot';
        button.setAttribute('aria-label', `Restore ${snapshot.label}`);
        const image = document.createElement('img');
        image.src = snapshot.image;
        image.alt = '';
        const title = document.createElement('strong');
        title.textContent = snapshot.label;
        const text = document.createElement('span');
        text.textContent = `Area ${(Math.sqrt(snapshot.metrics.areaError) * 100).toFixed(0)}% · compact ${snapshot.metrics.meanCompactness.toFixed(2)}`;
        button.append(image, title, text);
        button.addEventListener('click', () => {
          stop();
          optimizer!.restore(snapshot.coordinates);
          updateSettings(snapshot.parameters);
          iterations = 0;
          refresh();
          say(`Restored ${saved[index]!.label}. Area mismatch is relative to this map's saved target.`);
        });
        comparisons.append(button);
      });
    }
    function save(label: string): void {
      if (!optimizer || !metrics) return;
      // Images and coordinates describe exactly the same accepted iterate.
      draw();
      saved.push({ label, coordinates: optimizer.coordinates.slice(), parameters: { ...settings }, metrics, image: canvas.toDataURL('image/png') });
      if (saved.length > 4) saved.shift();
      renderSnapshots();
    }
    async function run(count: number, token: number): Promise<boolean> {
      if (!optimizer || root.dataset.ready !== 'true') return false;
      root.dataset.running = 'true';
      for (let i = 0; i < count; i++) {
        if (disposed || token !== runToken) return false;
        const result = optimizer.step();
        if (!result.accepted) {
          refresh();
          root.dataset.running = 'false';
          say(`Stopped after ${iterations} accepted steps: no admissible decreasing step at this resolution. Try another balance or finer deformation.`);
          return true;
        }
        iterations++;
        metrics = result.metrics;
        if (i % 4 === 0 || i === count - 1) { refresh(); say(`Optimizing · ${iterations} accepted steps · no triangle flips`); }
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (token !== runToken || disposed) return false;
      root.dataset.running = 'false';
      refresh();
      say(`${iterations} accepted steps · 0 flipped triangles · shared boundaries retained. Keep this map or adjust a goal.`);
      return true;
    }
    function optimize(): void {
      stop();
      void run(80, runToken).catch(error => { stop(); say(String(error)); });
    }
    function sweep(): void {
      if (!optimizer || root.dataset.ready !== 'true') return;
      stop();
      const token = runToken;
      void (async () => {
        saved = [];
        optimizer!.reset();
        refresh();
        save('Starting map');
        for (const preset of PRESETS) {
          if (disposed || token !== runToken) return;
          optimizer!.reset();
          iterations = 0;
          const { name, ...weights } = preset;
          updateSettings({ ...settings, ...weights });
          if (!await run(80, token)) return;
          save(name);
        }
        say('Three balances compared from the same starting map. Click a kept map to inspect or continue it. Area errors use each map’s own target.');
      })().catch(error => { stop(); say(String(error)); });
    }
    function exportMap(): void {
      if (!optimizer || !mesh || !metrics) return;
      const record = {
        schema: 'surfview.parcel-map-experiment.v1', atlas: data!.atlas, source: data!.source ?? { kind: 'synthetic' },
        referenceSurface: dataset === 'toy' ? 'synthetic corrugated sheet' : 'fs_LR.32k.L.inflated.surf.gii',
        outline, aspectRatio: aspect, parameters: settings, acceptedStepsSinceResetOrRestore: iterations,
        metrics: { ...metrics, parcelAreas: Array.from(metrics.parcelAreas), parcelCompactness: Array.from(metrics.parcelCompactness), targetAreas: Array.from(metrics.targetAreas) },
        parcels: data!.parcels, displayColors: colors, colorMode,
        parcelIds: mesh.parcelIds, sourceAreas: Array.from(mesh.sourceAreas), faces: Array.from(mesh.faces), faceParcels: Array.from(mesh.faceParcels),
        boundary: Array.from(mesh.boundary), coordinates: Array.from(optimizer.coordinates), referenceCoordinates: Array.from(optimizer.reference),
        sourcePositions: Array.from(mesh.positions)
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(record)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `parcel-map-${dataset}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function prepare(which: Dataset): Promise<Prepared | null> {
      const cached = cache.get(which);
      if (cached) return cached;
      let input: Prepared['input'];
      if (which === 'toy') {
        const sheet = toy();
        input = { vertices: sheet.vertices, faces: sheet.faces, vertexLabels: sheet.data.vertexLabels, parcelData: sheet.data };
      } else {
        const [surface, atlas] = await Promise.all([loadMesh('fsLR32kLeftInflated'), loadAtlas(which === 'glasser' ? 'glasser' : 'schaefer400x7') as Promise<AtlasFile & Atlas>]);
        if (disposed) return null;
        input = { vertices: surface.vertices, faces: surface.faces, vertexLabels: atlas.vertexLabels, parcelData: atlas };
      }
      const prepared = { mesh: buildParcelMapMesh(input), input };
      cache.set(which, prepared);
      return prepared;
    }
    async function initialize(): Promise<void> {
      stop();
      const version = ++request;
      abort?.abort();
      const controller = new AbortController();
      abort = controller;
      root.dataset.ready = 'false';
      root.dataset.running = 'false';
      loading.hidden = false;
      loading.textContent = 'Building the shared cortical sheet';
      selectPiece(null);
      preview?.cleanup();
      preview = null;
      shells?.dispose();
      shells = null;
      paths = [];
      hovered = null;
      tooltip.hidden = true;
      optimizer = null;
      saved = [];
      comparisons.replaceChildren();
      try {
        const prepared = await prepare(dataset);
        if (!prepared || disposed || version !== request) return;
        mesh = prepared.mesh;
        data = prepared.input.parcelData;
        boundaryNote.textContent = dataset === 'toy' ? 'The synthetic sheet’s outside edge is fixed. Interior contacts remain joined.' :
          'The medial-wall opening becomes the outside edge. Interior contacts remain joined.';
        const uv = await flattenParcelMap(mesh, {
          signal: controller.signal, boundaryShape: outline, aspectRatio: aspect,
          onProgress: (_, residual) => { if (version === request) loading.textContent = `Unfolding the shared sheet · solver residual ${residual.toExponential(1)}`; }
        });
        if (disposed || version !== request) return;
        optimizer = new ParcelMapOptimizer(mesh, uv, settings);
        iterations = 0;
        shells = buildParcelPuzzle(prepared.input, { thickness: 2 });
        const table = new Map(data.parcels.map(parcel => [parcel.id, parcel]));
        colors = mesh.parcelIds.map(id => {
          const parcel = table.get(id)!;
          return mutedNetworkColors[networkOf(parcel.label) ?? ''] ?? (typeof parcel.color === 'string' ? parcel.color : '#a8bdc7');
        });
        inspector.replaceChildren(new Option('Choose a piece', ''));
        mesh.parcelIds.forEach(id => inspector.add(new Option(`${shortParcelName(table.get(id)!.label)} · ${id}`, String(id))));
        makeLoops();
        loading.hidden = true;
        root.dataset.ready = 'true';
        root.dataset.dataset = dataset;
        refresh();
        save('Starting map');
        say(`${mesh.parcelIds.length} pieces · one disk · no internal cuts. Adjust a goal or optimize.`);
      } catch (error) {
        if (!disposed && version === request && !controller.signal.aborted) {
          loading.textContent = String(error);
          say(String(error));
          ctx.status('Map failed to build');
        }
      }
    }

    on(canvas, 'pointermove', event => {
      if (!optimizer) return;
      const pointer = event as PointerEvent, owner = pick(pointer);
      if (owner !== hovered) { hovered = owner; draw(); }
      tooltip.hidden = owner === null;
      if (owner === null) {
        film.set('br', 'hover', 'Hover', '—');
        return;
      }
      const parcel = data!.parcels.find(entry => entry.id === mesh!.parcelIds[owner])!;
      const text = `${shortParcelName(parcel.label)} · ${parcel.id}`;
      tooltip.textContent = text;
      film.set('br', 'hover', 'Hover', text);
      const rect = stage.getBoundingClientRect();
      tooltip.style.left = `${Math.min(pointer.clientX - rect.left + 12, stage.clientWidth - 230)}px`;
      tooltip.style.top = `${pointer.clientY - rect.top + 18}px`;
    });
    on(canvas, 'pointerleave', () => { hovered = null; tooltip.hidden = true; film.set('br', 'hover', 'Hover', '—'); draw(); });
    on(canvas, 'click', event => { if (optimizer) selectPiece(pick(event as MouseEvent)); });
    on($('[data-close-detail]'), 'click', () => selectPiece(null));
    on(root, 'keydown', event => { if ((event as KeyboardEvent).key === 'Escape') selectPiece(null); });
    film.set('br', 'hover', 'Hover', '—');
    const observer = new ResizeObserver(() => draw());
    observer.observe(stage);

    await initialize();
    ctx.setBusy(false);
    return () => {
      disposed = true;
      request++;
      stop();
      abort?.abort();
      observer.disconnect();
      for (const dispose of listeners) dispose();
      disposePreviewMesh();
      preview?.cleanup();
      shells?.dispose();
      root.remove();
    };
  }
};
