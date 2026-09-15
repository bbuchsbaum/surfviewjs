import * as THREE from 'three';
import { loadSurface, NeuroSurfaceViewer, buildParcelPuzzle, type ParcelData, type ParcelPuzzleGeometry } from '@src/index';
import { buildParcelMapMesh, flattenParcelMap, ParcelMapOptimizer, DEFAULT_PARCEL_MAP_PARAMETERS,
  type ParcelMapMesh, type ParcelMapMetrics, type ParcelMapParameters } from '../../src/puzzle/ParcelMap';
import type { Scenario } from '../types';
import { mutedNetworkColors } from './atlasPalettes';
import meshURL from '../../tests/data/fs_LR.32k.L.inflated.surf.gii?url';
import schaeferURL from '../data/schaefer/left-fslr32k-7networks.json?url';
import glasserURL from '../data/glasser/left-fslr32k.json?url';
import { mapLabStyles } from './parcelMapLabStyles';

interface Atlas extends ParcelData { vertexLabels: number[]; source?: unknown }
interface Snapshot { label: string; coordinates: Float64Array; parameters: ParcelMapParameters; metrics: ParcelMapMetrics; image: string }
const presets = [
  { name: 'Fidelity', angleWeight: 1.5, areaWeight: 1, compactnessWeight: 0.1, equalArea: 0 },
  { name: 'Balanced', angleWeight: 0.3, areaWeight: 3, compactnessWeight: 0.6, equalArea: 0.35 },
  { name: 'Tile emphasis', angleWeight: 0.08, areaWeight: 8, compactnessWeight: 2, equalArea: 0.8 }
];
const nameOf = (label: string): string => label.replace(/^(?:7|17)Networks_LH_/, '').replace(/_/g, ' ');
const network = (label: string): string => /^(?:7|17)Networks_LH_([^_]+)/.exec(label)?.[1] ?? '';

function toy(): { vertices: number[]; faces: number[]; data: Atlas } {
  const seeds = [[0.16, 0.15], [0.48, 0.12], [0.81, 0.18], [0.27, 0.45], [0.57, 0.5], [0.88, 0.52], [0.1, 0.81], [0.48, 0.85], [0.8, 0.83]];
  const vertices: number[] = [], faces: number[] = [], vertexLabels: number[] = [];
  const size = 25;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    vertices.push(u * 100, v * 100, 18 * Math.sin(u * 3.8) * Math.cos(v * 4.2));
    let nearest = 0, distance = Infinity;
    seeds.forEach(([a, b], i) => {
      const d = (u + 0.08 * Math.sin(v * 12) - a) ** 2 + (v - b) ** 2;
      if (d < distance) { distance = d; nearest = i; }
    });
    vertexLabels.push(nearest + 1);
    if (x < size - 1 && y < size - 1) { const a = y * size + x; faces.push(a, a + 1, a + size + 1, a, a + size + 1, a + size); }
  }
  return { vertices, faces, data: { schema_version: '1.0.0', atlas: { id: 'synthetic-nine', name: 'Nine-piece synthetic sheet', n_parcels: 9 },
    parcels: seeds.map((_, i) => ({ id: i + 1, label: `Piece ${i + 1}`, hemi: null, color: ['#a7bbc6', '#bea68f', '#a6b897', '#c5aebd', '#a8bfc0', '#c7bd98', '#bfa4a4', '#a6aabf', '#adb79e'][i] })), vertexLabels } };
}

export const parcelMapLab: Scenario = {
  id: 'parcel-map-lab', title: '2D parcel map laboratory',
  description: 'Flatten Glasser or Schaefer parcels into one connected 2D map, then compare explicit geometric tradeoffs.',
  tags: ['Glasser', 'Schaefer', 'atlas', 'parcels', '2d', 'flatmap', 'experimental'],
  layout: 'wide',
  run: async ctx => {
    const root = document.createElement('div'); root.className = 'parcel-map-lab';
    root.innerHTML = `<style>${mapLabStyles}</style>
      <div class="pml-main">
        <div class="pml-metrics" aria-live="polite">
          <div><span>Area mismatch ↓</span><strong data-metric-area>—</strong></div>
          <div><span>Angle distortion ↓</span><strong data-metric-angle>—</strong></div>
          <div><span>Mean compactness ↑</span><strong data-metric-compactness>—</strong></div>
          <div><span>Flipped triangles</span><strong data-metric-flips>—</strong></div>
        </div>
        <div class="pml-stage">
          <canvas data-map-canvas aria-label="Planar parcel map. Select a piece to inspect its original 3D shape."></canvas>
          <div class="pml-tooltip" hidden></div>
          <div class="pml-loading" role="status">Preparing the cortical map…</div>
          <aside class="pml-detail" aria-label="Original parcel shape" hidden>
            <button type="button" data-close-detail aria-label="Close parcel detail">×</button>
            <small>Original curved piece</small><h3 data-detail-title></h3><div data-preview></div><div data-detail-values></div>
            <p>Drag the preview to rotate.</p>
          </aside>
          <div class="pml-legend" data-color-legend></div>
        </div>
        <div class="pml-state" role="status" data-map-status>Preparing…</div>
        <div class="pml-comparison-heading"><h3>Compare maps</h3><button type="button" data-save>Keep this map</button></div>
        <div class="pml-comparisons"><p>Keep a result, change the controls, and compare. Click a saved map to restore it.</p></div>
      </div>
      <aside class="pml-controls" aria-label="Map experiment controls">
        <h2>Shape the map</h2>
        <label>Dataset<select aria-label="Map dataset"><option value="schaefer">Schaefer–Yeo · 200 left parcels</option><option value="glasser">Glasser · 180 left parcels</option><option value="toy">Nine-piece synthetic sheet</option></select></label>
        <div class="pml-two"><label>Outline<select aria-label="Map outline"><option value="2">Disk</option><option value="4">Rounded square</option><option value="6">Nearly square</option></select></label>
        <label>Aspect ratio <output data-output-aspect>1.00</output><input aria-label="Map aspect ratio" data-aspect type="range" min="0.6" max="1.8" step="0.1" value="1"></label></div>
        <p class="pml-hint" data-boundary-note>The medial-wall opening becomes the outside edge. Interior contacts remain joined.</p>
        <h3>Optimization goals</h3>
        <label>Angle fidelity <output data-output-angleWeight>0.30</output><input aria-label="Angle fidelity weight" data-setting="angleWeight" type="range" min="0" max="4" step="0.05" value="0.3"></label>
        <label>Area matching <output data-output-areaWeight>2.00</output><input aria-label="Area matching weight" data-setting="areaWeight" type="range" min="0" max="10" step="0.1" value="2"></label>
        <label>Compact pieces <output data-output-compactnessWeight>0.30</output><input aria-label="Compactness weight" data-setting="compactnessWeight" type="range" min="0" max="4" step="0.05" value="0.3"></label>
        <label>Area target <output data-output-equalArea>35% equalization</output><input aria-label="Equal area target" data-setting="equalArea" type="range" min="0" max="1" step="0.05" value="0.35"><span class="pml-range-labels"><span>Source proportions</span><span>Equal pieces</span></span></label>
        <label>Deformation detail <output data-output-resolution>14 × 14</output><input aria-label="Deformation resolution" data-setting="resolution" type="range" min="6" max="24" step="2" value="14"></label>
        <p class="pml-hint">Weights express priorities. Area matching uses the target above; source proportions refer to the inflated display surface.</p>
        <div class="pml-buttons"><button type="button" data-optimize>Optimize 80 steps</button><button type="button" data-stop>Stop</button><button type="button" data-reset>Reset map</button></div>
        <label class="pml-check"><input type="checkbox" data-auto checked> Optimize after changing a goal</label>
        <button type="button" data-sweep>Compare three balances</button>
        <h3>Inspect</h3>
        <label>Color by<select aria-label="Map color mode"><option value="atlas">Atlas colors</option><option value="area">Area relative to target</option><option value="compactness">Compactness</option></select></label>
        <label class="pml-check"><input type="checkbox" data-labels> Show parcel IDs</label>
        <label class="pml-check"><input type="checkbox" data-reference> Overlay starting boundaries</label>
        <label>Inspect parcel<select aria-label="Inspect map parcel"><option value="">Choose a piece…</option></select></label>
        <button type="button" data-export>Export map & parameters</button>
        <details><summary>What the numbers mean</summary><p>Area mismatch is the RMS relative error, weighted by target area. Angle distortion is a source-area-weighted conformal distortion; zero preserves local angles. Compactness is 4πA/P²; a circle scores 1.</p><p>The optimizer accepts only decreasing objective steps with positive triangle areas and a fixed convex boundary. It can stop at a constraint or local limit; it does not certify a global optimum. Source shape and area are from this inflated mesh.</p></details>
      </aside>`;
    ctx.mount.replaceChildren(root); ctx.panel.replaceChildren();
    const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
    const canvas = $<HTMLCanvasElement>('[data-map-canvas]'), stage = $('.pml-stage'), context = canvas.getContext('2d')!;
    const status = $('[data-map-status]'), loading = $('.pml-loading'), dataset = $<HTMLSelectElement>('[aria-label="Map dataset"]');
    const inspector = $<HTMLSelectElement>('[aria-label="Inspect map parcel"]');
    let disposed = false, request = 0, runToken = 0, debounce: ReturnType<typeof setTimeout> | undefined;
    let abort: AbortController | null = null, mesh: ParcelMapMesh | null = null, optimizer: ParcelMapOptimizer | null = null;
    let data: Atlas | null = null, shells: ParcelPuzzleGeometry | null = null, preview: NeuroSurfaceViewer | null = null;
    let previewMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial[]> | null = null;
    let metrics: ParcelMapMetrics | null = null, selected: number | null = null, hovered: number | null = null, iterations = 0;
    let paths: Path2D[] = [], loops: number[][][] = [], colors: string[] = [], saved: Snapshot[] = [];
    let transform = { scale: 1, x: 0, y: 0 }, settings: ParcelMapParameters = { ...DEFAULT_PARCEL_MAP_PARAMETERS };
    const listeners: (() => void)[] = [], cache = new Map<string, { mesh: ParcelMapMesh; input: { vertices: ArrayLike<number>; faces: ArrayLike<number>; vertexLabels: number[]; parcelData: Atlas } }>();
    let surfacePromise: ReturnType<typeof loadSurface> | null = null;
    const on = (target: EventTarget, type: string, handler: EventListener): void => { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); };
    const say = (text: string): void => { status.textContent = text; ctx.status(text); };
    const stop = (): void => { runToken++; clearTimeout(debounce); root.dataset.running = 'false'; };

    function updateSettings(next: ParcelMapParameters): void {
      settings = { ...next }; optimizer?.setParameters(settings);
      root.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(input => {
        const key = input.dataset.setting as keyof ParcelMapParameters; input.value = String(settings[key]);
        $(`[data-output-${key}]`).textContent = key === 'equalArea' ? `${Math.round(settings[key] * 100)}% equalization` :
          key === 'resolution' ? `${settings[key]} × ${settings[key]}` : settings[key].toFixed(2);
      });
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
          const first = outgoing.keys().next().value!, loop = [first]; let current = first;
          do {
            const next = outgoing.get(current);
            if (!next?.length) throw new Error('Parcel boundary path is open');
            current = next.pop()!; if (!next.length) outgoing.delete(loop[loop.length - 1]!);
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
        parcel.forEach(loop => { loop.forEach((v, j) => j ? path.lineTo(uv[v * 2]!, -uv[v * 2 + 1]!) : path.moveTo(uv[v * 2]!, -uv[v * 2 + 1]!)); path.closePath(); });
        return path;
      });
    }
    function draw(): void {
      if (!optimizer || !mesh || !metrics || disposed) return;
      const width = stage.clientWidth, height = stage.clientHeight, ratio = Math.min(devicePixelRatio || 1, 2);
      if (!width || !height) return;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
      context.fillStyle = '#f4f6f6'; context.fillRect(0, 0, width, height);
      const uv = optimizer.coordinates;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      mesh.boundary.forEach(i => { minX = Math.min(minX, uv[i * 2]!); maxX = Math.max(maxX, uv[i * 2]!); minY = Math.min(minY, uv[i * 2 + 1]!); maxY = Math.max(maxY, uv[i * 2 + 1]!); });
      const scale = Math.min((width - 52) / (maxX - minX), (height - 72) / (maxY - minY));
      transform = { scale, x: width / 2 - scale * (minX + maxX) / 2, y: height / 2 + scale * (minY + maxY) / 2 - 6 };
      context.translate(transform.x, transform.y); context.scale(scale, scale);
      paths = makePaths(uv);
      const mode = $<HTMLSelectElement>('[aria-label="Map color mode"]').value;
      paths.forEach((path, i) => {
        let fill = colors[i]!;
        if (mode === 'area') {
          const error = Math.max(-1, Math.min(1, Math.log2(metrics!.parcelAreas[i]! / metrics!.targetAreas[i]!) / 2));
          fill = error < 0 ? `hsl(204 42% ${90 + error * 40}%)` : `hsl(12 52% ${90 - error * 39}%)`;
        } else if (mode === 'compactness') fill = `hsl(${18 + 155 * Math.min(1, metrics!.parcelCompactness[i]!)} 35% 64%)`;
        context.fillStyle = fill; context.fill(path);
        context.strokeStyle = '#ffffffba'; context.lineWidth = 0.75 / scale; context.stroke(path);
      });
      if ($<HTMLInputElement>('[data-reference]').checked) {
        context.strokeStyle = '#263e526a'; context.lineWidth = 0.8 / scale; context.setLineDash([3 / scale, 3 / scale]);
        makePaths(optimizer.reference).forEach(path => context.stroke(path)); context.setLineDash([]);
      }
      for (const owner of [hovered, selected]) if (owner !== null && paths[owner]) {
        context.strokeStyle = owner === selected ? '#153b53' : '#ffffff'; context.lineWidth = 2.5 / scale; context.stroke(paths[owner]!);
      }
      if ($<HTMLInputElement>('[data-labels]').checked) {
        const sums = mesh.parcelIds.map(() => [0, 0, 0]);
        for (let f = 0; f < mesh.faces.length; f += 3) {
          const a = mesh.faces[f]! * 2, b = mesh.faces[f + 1]! * 2, c = mesh.faces[f + 2]! * 2;
          const area = ((uv[b]! - uv[a]!) * (uv[c + 1]! - uv[a + 1]!) - (uv[b + 1]! - uv[a + 1]!) * (uv[c]! - uv[a]!)) / 2;
          const s = sums[mesh.faceParcels[f / 3]!]!; s[0]! += area * (uv[a]! + uv[b]! + uv[c]!) / 3; s[1]! += area * (uv[a + 1]! + uv[b + 1]! + uv[c + 1]!) / 3; s[2]! += area;
        }
        context.font = `${11 / scale}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#172e3c';
        sums.forEach(([x, y, area], i) => { if (area! * scale * scale > 220) { context.strokeStyle = '#ffffffb0'; context.lineWidth = 2 / scale; context.strokeText(String(mesh!.parcelIds[i]), x! / area!, -y! / area!); context.fillText(String(mesh!.parcelIds[i]), x! / area!, -y! / area!); } });
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      $('[data-color-legend]').textContent = mode === 'area' ? 'Blue: smaller than target · pale: on target · red: larger (±2 log₂)' :
        mode === 'compactness' ? 'Orange: elongated / irregular · teal: compact' : `${mesh.parcelIds.length} pieces · click to inspect the original curved shape`;
    }
    function refresh(): void {
      if (!optimizer) return;
      metrics = optimizer.measure();
      $('[data-metric-area]').textContent = `${(100 * Math.sqrt(metrics.areaError)).toFixed(1)}%`;
      $('[data-metric-angle]').textContent = metrics.angleDistortion.toFixed(3);
      $('[data-metric-compactness]').textContent = metrics.meanCompactness.toFixed(3);
      $('[data-metric-flips]').textContent = String(metrics.flippedTriangles);
      root.dataset.iterations = String(iterations); root.dataset.flips = String(metrics.flippedTriangles); root.dataset.objective = String(metrics.objective);
      root.dataset.minimumAreaRatio = String(metrics.minimumAreaRatio);
      if (selected !== null) detailValues();
      draw();
    }
    function detailValues(): void {
      if (selected === null || !mesh || !metrics) return;
      $('[data-detail-values]').textContent = `Area / target: ${(metrics.parcelAreas[selected]! / metrics.targetAreas[selected]!).toFixed(2)}× · Compactness: ${metrics.parcelCompactness[selected]!.toFixed(3)}`;
    }
    function selectPiece(owner: number | null): void {
      selected = owner;
      $<HTMLElement>('.pml-detail').hidden = owner === null;
      inspector.value = owner === null ? '' : String(mesh!.parcelIds[owner]);
      root.dataset.selectedParcel = owner === null ? '' : String(mesh!.parcelIds[owner]);
      if (owner === null) { previewMesh?.removeFromParent(); previewMesh?.material.forEach(m => m.dispose()); previewMesh = null; draw(); return; }
      const piece = shells!.pieces.get(mesh!.parcelIds[owner]!)!;
      $('[data-detail-title]').textContent = nameOf(piece.parcel.label);
      detailValues();
      const mount = $('[data-preview]');
      if (!preview) {
        preview = new NeuroSurfaceViewer(mount, mount.clientWidth || 200, 158, { backgroundColor: 0xf0f3f4, useShaders: false,
          ambientLightColor: 0xffffff, directionalLightIntensity: 2.3, hoverCrosshair: false });
        preview.ambientLight.intensity = 1.4; preview.startRenderLoop();
      }
      previewMesh?.removeFromParent(); previewMesh?.material.forEach(m => m.dispose());
      const top = new THREE.MeshStandardMaterial({ color: colors[owner], roughness: 0.7 });
      previewMesh = new THREE.Mesh(piece.geometry, [top, new THREE.MeshStandardMaterial({ color: top.color.clone().multiplyScalar(0.65), roughness: 0.9 })]);
      preview.scene.add(previewMesh);
      const radius = piece.geometry.boundingSphere!.radius + piece.geometry.boundingSphere!.center.length();
      preview.cameraControls.target.set(0, 0, 0); preview.camera.position.copy(piece.normal).multiplyScalar(radius * 4.3);
      preview.camera.up.set(0, 0, 1); if (Math.abs(piece.normal.z) > 0.9) preview.camera.up.set(0, 1, 0);
      preview.camera.lookAt(0, 0, 0); preview.cameraControls.update(); preview.resize(mount.clientWidth || 200, 158); preview.requestRender(); draw();
    }
    function pick(event: PointerEvent): number | null {
      const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left - transform.x) / transform.scale, y = (event.clientY - rect.top - transform.y) / transform.scale;
      context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
      const owner = paths.findIndex(path => context.isPointInPath(path, x, y)); context.restore(); return owner < 0 ? null : owner;
    }
    function snapshots(): void {
      const container = $('.pml-comparisons'); container.replaceChildren();
      saved.forEach((snapshot, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'pml-snapshot';
        button.setAttribute('aria-label', `Restore ${snapshot.label}`);
        const image = document.createElement('img'); image.src = snapshot.image; image.alt = snapshot.label;
        const title = document.createElement('strong'); title.textContent = snapshot.label;
        const text = document.createElement('span'); text.textContent = `Area ${(Math.sqrt(snapshot.metrics.areaError) * 100).toFixed(0)}% · compactness ${snapshot.metrics.meanCompactness.toFixed(2)}`;
        button.append(image, title, text);
        button.onclick = () => { stop(); optimizer!.restore(snapshot.coordinates); updateSettings(snapshot.parameters); iterations = 0; refresh(); say(`Restored ${saved[index]!.label}. Area mismatch is relative to this map's saved target.`); };
        container.append(button);
      });
    }
    function save(label: string): void {
      if (!optimizer || !metrics) return;
      // Images and coordinates describe exactly the same accepted iterate.
      draw(); saved.push({ label, coordinates: optimizer.coordinates.slice(), parameters: { ...settings }, metrics, image: canvas.toDataURL('image/png') });
      if (saved.length > 4) saved.shift(); snapshots();
    }
    async function run(count: number, token: number): Promise<boolean> {
      if (!optimizer || root.dataset.ready !== 'true') return false;
      root.dataset.running = 'true';
      for (let i = 0; i < count; i++) {
        if (disposed || token !== runToken) return false;
        const result = optimizer.step();
        if (!result.accepted) { refresh(); root.dataset.running = 'false'; say(`Stopped after ${iterations} accepted steps: no admissible decreasing step at this resolution. Try another balance or finer deformation.`); return true; }
        iterations++; metrics = result.metrics;
        if (i % 4 === 0 || i === count - 1) { refresh(); say(`Optimizing · ${iterations} accepted steps · no triangle flips`); }
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (token !== runToken || disposed) return false;
      root.dataset.running = 'false'; refresh(); say(`${iterations} accepted steps · 0 flipped triangles · shared boundaries retained. Keep this map or adjust a goal.`); return true;
    }
    const optimize = (): void => { stop(); void run(80, runToken).catch(error => { stop(); say(String(error)); }); };
    async function initialize(): Promise<void> {
      stop(); const version = ++request; abort?.abort(); const controller = new AbortController(); abort = controller;
      root.dataset.ready = 'false'; root.dataset.running = 'false'; loading.hidden = false; loading.textContent = 'Building the shared cortical sheet…';
      selectPiece(null); preview?.dispose(); preview = null; shells?.dispose(); shells = null;
      paths = []; hovered = null; $('.pml-tooltip').hidden = true; optimizer = null; saved = []; $('.pml-comparisons').replaceChildren();
      try {
        let cached = cache.get(dataset.value);
        if (!cached) {
          if (dataset.value === 'toy') {
            const t = toy(), input = { vertices: t.vertices, faces: t.faces, vertexLabels: t.data.vertexLabels, parcelData: t.data };
            cached = { mesh: buildParcelMapMesh(input), input };
          } else {
            surfacePromise ??= loadSurface(meshURL, 'gifti', 'left', 30000, false);
            const [surface, atlas] = await Promise.all([surfacePromise, fetch(dataset.value === 'glasser' ? glasserURL : schaeferURL).then(response => {
              if (!response.ok) throw new Error(`Atlas request failed: ${response.status}`); return response.json() as Promise<Atlas>;
            })]);
            if (disposed || version !== request) return;
            const input = { vertices: surface.vertices, faces: surface.faces, vertexLabels: atlas.vertexLabels, parcelData: atlas };
            cached = { mesh: buildParcelMapMesh(input), input };
          }
          cache.set(dataset.value, cached);
        }
        mesh = cached.mesh; data = cached.input.parcelData;
        $('[data-boundary-note]').textContent = dataset.value === 'toy' ? 'The synthetic sheet’s outside edge is fixed. Interior contacts remain joined.' :
          'The medial-wall opening becomes the outside edge. Interior contacts remain joined.';
        const uv = await flattenParcelMap(mesh, { signal: controller.signal, boundaryShape: Number($<HTMLSelectElement>('[aria-label="Map outline"]').value), aspectRatio: Number($<HTMLInputElement>('[data-aspect]').value),
          onProgress: (_, residual) => { if (version === request) loading.textContent = `Unfolding the shared sheet · solver residual ${residual.toExponential(1)}`; } });
        if (disposed || version !== request) return;
        optimizer = new ParcelMapOptimizer(mesh, uv, settings); iterations = 0;
        shells = buildParcelPuzzle(cached.input, { thickness: 2 });
        const table = new Map(data.parcels.map(p => [p.id, p]));
        colors = mesh.parcelIds.map(id => { const p = table.get(id)!; return mutedNetworkColors[network(p.label)] ?? (typeof p.color === 'string' ? p.color : '#a8bdc7'); });
        inspector.replaceChildren(new Option('Choose a piece…', ''));
        mesh.parcelIds.forEach(id => inspector.add(new Option(`${nameOf(table.get(id)!.label)} · ${id}`, String(id))));
        makeLoops(); loading.hidden = true; root.dataset.ready = 'true'; root.dataset.dataset = dataset.value;
        refresh(); save('Starting map');
        say(`${mesh.parcelIds.length} pieces · one disk · no internal cuts. Adjust a goal or optimize.`);
      } catch (error) { if (!disposed && version === request && !controller.signal.aborted) { loading.textContent = String(error); say(String(error)); } }
    }
    on(canvas, 'pointermove', event => {
      if (!optimizer) return;
      const pointer = event as PointerEvent, owner = pick(pointer);
      if (owner !== hovered) { hovered = owner; draw(); }
      const tooltip = $('.pml-tooltip'); tooltip.hidden = owner === null;
      if (owner !== null) {
        const parcel = data!.parcels.find(p => p.id === mesh!.parcelIds[owner])!;
        tooltip.textContent = `${nameOf(parcel.label)} · ${parcel.id}`;
        const rect = stage.getBoundingClientRect(); tooltip.style.left = `${Math.min(pointer.clientX - rect.left + 12, stage.clientWidth - 230)}px`; tooltip.style.top = `${pointer.clientY - rect.top + 18}px`;
      }
    });
    on(canvas, 'pointerleave', () => { hovered = null; $('.pml-tooltip').hidden = true; draw(); });
    on(canvas, 'click', event => { if (optimizer) selectPiece(pick(event as PointerEvent)); });
    on(inspector, 'change', () => selectPiece(inspector.value ? mesh!.parcelIds.indexOf(Number(inspector.value)) : null));
    on($('[data-close-detail]'), 'click', () => selectPiece(null));
    on(root, 'keydown', event => { if ((event as KeyboardEvent).key === 'Escape') selectPiece(null); });
    on(dataset, 'change', () => {
      const url = new URL(location.href);
      url.searchParams.set('dataset', dataset.value);
      history.replaceState(history.state, '', url);
      void initialize();
    });
    on($('[aria-label="Map outline"]'), 'change', () => { void initialize(); });
    on($('[data-aspect]'), 'input', () => { $('[data-output-aspect]').textContent = Number($<HTMLInputElement>('[data-aspect]').value).toFixed(2); });
    on($('[data-aspect]'), 'change', () => { void initialize(); });
    root.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(input => on(input, 'input', () => {
      stop(); updateSettings({ ...settings, [input.dataset.setting!]: Number(input.value) }); refresh();
      if ($<HTMLInputElement>('[data-auto]').checked) debounce = setTimeout(optimize, 300);
    }));
    on($('[data-optimize]'), 'click', optimize);
    on($('[data-stop]'), 'click', () => { stop(); say(`Paused at ${iterations} accepted steps.`); });
    on($('[data-auto]'), 'change', () => { if (!$<HTMLInputElement>('[data-auto]').checked) clearTimeout(debounce); });
    on($('[data-reset]'), 'click', () => { stop(); optimizer?.reset(); iterations = 0; refresh(); say('Restored the starting harmonic map. Current optimization goals are retained.'); });
    on($('[data-save]'), 'click', () => save(`Map ${saved.length + 1}`));
    on($('[data-sweep]'), 'click', () => {
      if (!optimizer || root.dataset.ready !== 'true') return;
      stop(); const token = runToken;
      void (async () => {
        saved = []; optimizer!.reset(); refresh(); save('Starting map');
        for (const preset of presets) {
          if (disposed || token !== runToken) return;
          optimizer!.reset(); iterations = 0;
          const { name, ...weights } = preset; updateSettings({ ...settings, ...weights });
          if (!await run(80, token)) return; save(name);
        }
        say('Three balances compared from the same starting map. Click a card to inspect or continue it. Area errors use each card’s own target.');
      })().catch(error => { stop(); say(String(error)); });
    });
    for (const selector of ['[aria-label="Map color mode"]', '[data-labels]', '[data-reference]']) on($(selector), 'change', draw);
    on($('[data-export]'), 'click', () => {
      if (!optimizer || !mesh || !metrics) return;
      const record = { schema: 'surfview.parcel-map-experiment.v1', atlas: data!.atlas, source: data!.source ?? { kind: 'synthetic' },
        referenceSurface: dataset.value === 'toy' ? 'synthetic corrugated sheet' : 'fs_LR.32k.L.inflated.surf.gii',
        outline: Number($<HTMLSelectElement>('[aria-label="Map outline"]').value), aspectRatio: Number($<HTMLInputElement>('[data-aspect]').value),
        parameters: settings, acceptedStepsSinceResetOrRestore: iterations, metrics: { ...metrics, parcelAreas: Array.from(metrics.parcelAreas), parcelCompactness: Array.from(metrics.parcelCompactness), targetAreas: Array.from(metrics.targetAreas) },
        parcels: data!.parcels, displayColors: colors, colorMode: $<HTMLSelectElement>('[aria-label="Map color mode"]').value,
        parcelIds: mesh.parcelIds, sourceAreas: Array.from(mesh.sourceAreas), faces: Array.from(mesh.faces), faceParcels: Array.from(mesh.faceParcels), boundary: Array.from(mesh.boundary),
        coordinates: Array.from(optimizer.coordinates), referenceCoordinates: Array.from(optimizer.reference), sourcePositions: Array.from(mesh.positions) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(record)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `parcel-map-${dataset.value}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const observer = new ResizeObserver(draw); observer.observe(stage);
    const choice = new URLSearchParams(location.search).get('dataset'); if (['schaefer', 'glasser', 'toy'].includes(choice ?? '')) dataset.value = choice!;
    await initialize();
    return () => { disposed = true; request++; stop(); abort?.abort(); observer.disconnect(); listeners.forEach(dispose => dispose());
      previewMesh?.removeFromParent(); previewMesh?.material.forEach(material => material.dispose()); preview?.dispose(); shells?.dispose(); root.remove(); };
  }
};
