import * as THREE from 'three';
import { FlatMapView, GeometryWorkerClient, ColorMap, vertexLocation, roiToSVG, roiToLabelGIFTI } from '@src/index.js';
import { FlatMapViewAttachment, buildSurfaceReliefInWorker, FlatMapController, FlatMapSampler, FlatMapFrame, FlatMapField, WebGLFlatMapRenderer, FlatMapSurfaceBinding, computeFlatMapDistortion, exportFlatMap } from '@src/index.flatmap.js';
import type { SurfaceLocation, VertexROI } from '@src/index.js';
import type { FlatMapPresentation } from '@src/index.flatmap.js';
import { loadMatchedFlatMap } from './flatmap-data';
import { createFilmViewer } from './film';
import { action, actions, choice, note, readout, section, slider, toggle } from './controls';
import type { ScenarioRunContext } from '../types';
import type { FilmOverlay } from './film';

const MARK = '#f2c230';
type Context = { ctx: ScenarioRunContext; film: FilmOverlay; panel: HTMLElement; isCurrent: () => boolean };

export async function quantitativeFlatmapMode({ ctx, film, panel, isCurrent }: Context): Promise<(() => void) | null> {
  ctx.setBusy(true, 'Loading matched S1 white, pial and flat surfaces');
  const data = await loadMatchedFlatMap(undefined, { volumePattern: 'depth-demo' }); if (!isCurrent()) return null;
  const owned: Array<() => void> = [];
  const cleanup = () => { while (owned.length) owned.pop()!(); };
  let alive = true;
  owned.push(() => { alive = false; });
  const current = () => alive && isCurrent();
  const worker = new GeometryWorkerClient({ workerFactory: () => new Worker(new URL('../../src/geometry/geometryWorker.ts', import.meta.url), { type: 'module' }) });
  owned.push(() => worker.dispose());
  try {
    ctx.setBusy(true, 'Preparing anatomical folding height in a worker');
    const relief = await buildSurfaceReliefInWorker(worker, data.chart, data.white, data.pial,
      { mmPerUnit: data.calibration, regularizationFwhmMm: 2.5 }, { isCurrent: current });
    if (!current()) { cleanup(); return null; }
    const { chart, domain } = data, vertexCount = domain.vertexCount;
    const pair = document.createElement('div'); pair.className = 'anat-pair'; pair.dataset.visualQa = 'linked-flatmap';
    const cell = (label: string) => {
      const root = document.createElement('div'); root.className = 'anat-cell';
      const mount = document.createElement('div'); mount.className = 'anat-viewer';
      const caption = document.createElement('span'); caption.className = 'anat-cell-label'; caption.textContent = label;
      root.append(mount, caption); pair.append(root); return { root, mount, caption };
    };
    const solid = cell('Folded · shared scalar field'), right = cell('Flat · unlit quantitative map');
    const sheet = document.createElement('div'); sheet.className = 'anat-flat-sheet'; right.root.prepend(sheet);
    right.mount.hidden = true; ctx.mount.replaceChildren(pair);
    const leftView = createFilmViewer(solid.mount), rightView = createFilmViewer(right.mount);
    owned.push(leftView.cleanup, rightView.cleanup);
    const viewer = leftView.viewer;
    rightView.viewer.stopRenderLoop(); // Hidden relief does not consume a render frame.
    let colorMap = ColorMap.fromPreset('coolwarm', { range: [-1.2, 1.2] }), opacity = 0.9, coverage = true;
    const presentation = (): FlatMapPresentation => ({ colorMap, opacity, showCoverage: coverage, underlay: [0.48, 0.52, 0.56] });
    const field = new FlatMapField(presentation()); owned.push(() => field.dispose());
    const renderer = new WebGLFlatMapRenderer(presentation(), { field }); owned.push(() => renderer.dispose());
    const controller = new FlatMapController(chart, { worker, tileSize: 64 }); owned.push(() => controller.dispose());
    const scalarSampler = new FlatMapSampler({ kind: 'vertex-scalar', domain });
    controller.setSource(scalarSampler, data.scalar);
    const anatomyController = new FlatMapController(chart, { worker, tileSize: 64, budgetBytes: 16 * 1024 * 1024 });
    owned.push(() => anatomyController.dispose());
    anatomyController.setSource(scalarSampler, new FlatMapFrame(Float64Array.from(relief.copyHeightMm().subarray(0, vertexCount), h => Number.isFinite(h) ? .55 + Math.min(6, Math.max(0, h)) / 8 : 1)));
    let anatomyGridWidth = 0, anatomyPixels = new Float32Array();
    const surface = new FlatMapSurfaceBinding(chart, data.pial, field, { relief });
    const reliefSurface = new FlatMapSurfaceBinding(chart, data.pial, field, { relief });
    viewer.addSurface(surface, 'lh'); rightView.viewer.addSurface(reliefSurface, 'lh');
    viewer.setAnatomicalView('lateral', { layout: 'single', surfaceId: 'lh', fit: true });
    viewer.fitToView({ padding: 0.08 });
    reliefSurface.setDeformation(1, 2, true);
    rightView.viewer.camera.position.set(0, -160, 290); rightView.viewer.camera.up.set(0, 1, 0);
    rightView.viewer.camera.lookAt(0, 0, 0); rightView.viewer.fitToView({ padding: 0.12 });
    const xy = chart.copyCoordinates(), chartIds = chart.copyAnatomicalVertices(), vertices = new Float32Array(chart.vertexCount * 3);
    for (let v = 0; v < chart.vertexCount; v++) { vertices[v * 3] = xy[v * 2]!; vertices[v * 3 + 1] = xy[v * 2 + 1]!; }
    const size = () => [Math.max(64, Math.floor(sheet.clientWidth || 420)), Math.max(64, Math.floor(sheet.clientHeight || 420))] as const;
    const [width, height] = size();
    const flatmap = new FlatMapView(sheet, { surfaceId: 'lh', vertices, faces: chart.copyFaces() }, {
      width, height, padding: 10, autoRender: false, background: 'rgba(0,0,0,0)', selectionStyle: MARK
    });
    owned.push(() => flatmap.dispose());
    flatmap.canvas.dataset.visualQa = 'linked-flatmap-canvas'; flatmap.canvas.setAttribute('aria-label', 'Quantitative flat map of S1 left hemisphere');
    const attachment = new FlatMapViewAttachment(flatmap, controller, renderer);
    owned.push(flatmap.on('render:needed', () => flatmap.render()));
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => {
      if (!current() || sheet.hidden) return; const [w, h] = size(); flatmap.resize(w, h);
    }); });
    observer.observe(sheet); owned.push(() => { observer.disconnect(); cancelAnimationFrame(resizeFrame); });
    const map = section(panel, 'Quantitative map');
    const linkStatus = readout(map, 'Status', 'lf-status'); linkStatus.element.dataset.linkedFlatmapStatus = '';
    const diagnostic = readout(map, 'Preparation', 'qf-preparation');
    const legend = document.createElement('div'); legend.className = 'anat-quant-legend'; legend.setAttribute('aria-label', 'Shared scalar color key');
    right.root.append(legend);
    const legendText = document.createElement('span'), bar = document.createElement('span'); bar.className = 'anat-quant-bar'; legend.append(bar, legendText);
    function recolor() {
      renderer.setPresentation(presentation()); flatmap.render();
      const colors = colorMap.getColors();
      bar.style.background = `linear-gradient(to right,${[0, 0.25, 0.5, 0.75, 1].map(t => {
        const c = colors[Math.floor(t * (colors.length - 1))]!; return `rgb(${c.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
      }).join(',')})`;
      legendText.textContent = `${colorMap.getRange()[0].toFixed(1)} — ${colorMap.getRange()[1].toFixed(1)} · ${mode === 'distortion' ? 'log₂ relative area' : 'synthetic signal'}`;
    }
    let source: 'scalar' | 'volume' = 'scalar', mode: 'map' | 'relief' | 'distortion' = 'map';
    let depth = 0.5, resolution = 512, exaggeration = 2, updateRevision = 0;
    let lastMapPalette = colorMap, distortionFrame: FlatMapFrame | undefined;
    function distortion() {
      if (distortionFrame) return distortionFrame;
      const d = computeFlatMapDistortion(chart, data.pial), faces = chart.copyFaces();
      const values = new Float64Array(vertexCount), mass = new Float64Array(vertexCount);
      // Display average only; the diagnostic itself remains per-face and is inspectable below.
      for (let f = 0; f < chart.faceCount; f++) for (let k = 0; k < 3; k++) {
        const v = chartIds[faces[f * 3 + k]!]!; values[v]! += Math.log2(d.relativeAreaRatio[f]!); mass[v]!++;
      }
      for (let v = 0; v < vertexCount; v++) values[v] = mass[v] ? values[v]! / mass[v]! : NaN;
      return distortionFrame = new FlatMapFrame(values);
    }
    async function prepare() {
      const revision = ++updateRevision; const started = performance.now();
      linkStatus.set('Preparing…'); pair.setAttribute('aria-busy', 'true'); pair.dataset.pending = 'true';
      if (mode === 'distortion') controller.setSource(scalarSampler, distortion());
      else if (source === 'scalar') controller.setSource(scalarSampler, data.scalar);
      else controller.setSource(new FlatMapSampler({ kind: 'volume-scalar', white: data.white, pial: data.pial,
        dims: data.dims, voxelToWorld: data.voxelToWorld, frame: data.manifest.frame,
        depth: { interval: [Math.max(0, depth - 0.15), Math.min(1, depth + 0.15)], samples: 8 } }), data.volume,
        { missing: 'renormalize', minCoverage: 0.5 });
      try {
        await attachment.prepare(resolution);
        if (!current() || revision !== updateRevision) return;
        if (anatomyGridWidth !== resolution) {
          const grid = field.grid!; const pixels = new Float32Array(grid.width * grid.height).fill(1);
          await anatomyController.render(grid, (tile, samples) => {
            for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
              const i = y * tile.width + x; if (samples.valid[i]) pixels[(tile.y + y) * grid.width + tile.x + x] = samples.values[i]!;
            }
          });
          if (!current() || revision !== updateRevision) return;
          anatomyGridWidth = resolution; anatomyPixels = pixels;
        }
        renderer.setAnatomy(anatomyPixels); flatmap.render();
        if (!current() || revision !== updateRevision) return;
        linkStatus.set(`Ready: ${vertexCount.toLocaleString()} linked vertices`);
        diagnostic.set(`${Math.round(performance.now() - started)} ms · ${controller.diagnostics.planBuilds} plans · ${(controller.diagnostics.retainedBytes / 1048576).toFixed(1)} MiB`);
        pair.dataset.pending = 'false'; pair.setAttribute('aria-busy', 'false');
      } catch (error) {
        if (current() && revision === updateRevision) { linkStatus.set(`Preparation failed: ${String(error)}. Change a control to retry.`); pair.setAttribute('aria-busy', 'false'); }
      }
    }
    const sourceControl = choice(map, { id: 'qf-source', label: 'Synthetic input', options: [{ value: 'scalar', label: 'Surface' }, { value: 'volume', label: 'Volume' }], value: source,
      onChange: next => { source = next; updateDepthControls(); void prepare(); } });
    const depthControl = slider(map, { id: 'qf-depth', label: 'Ribbon depth', min: 0, max: 1, step: 0.05, value: depth, format: v => `${Math.round(v * 100)}%`,
      onInput: v => { depth = v; updateDepthControls(); if (source === 'volume' && mode !== 'distortion') void prepare(); } });
    const depthHint = note(map, ''); depthHint.id = 'qf-depth-help';
    depthControl.input.setAttribute('aria-describedby', depthHint.id);
    function updateDepthControls() {
      depthControl.input.disabled = source !== 'volume' || mode === 'distortion';
      sourceControl.element.disabled = mode === 'distortion';
      depthHint.textContent = mode === 'distortion' ? 'Depth does not affect chart distortion.'
        : source === 'scalar' ? 'Select Volume to sample between white matter and pial surfaces.'
          : `Eight samples from ${Math.round(Math.max(0, depth - 0.15) * 100)}–${Math.round(Math.min(1, depth + 0.15) * 100)}% through the ribbon (white → pial). The synthetic volume has spatial waves to make depth changes visible.`;
    }
    updateDepthControls();
    toggle(map, { id: 'qf-coverage', label: 'Hatch incomplete support', checked: coverage, onChange: v => { coverage = v; recolor(); } });
    slider(map, { id: 'qf-opacity', label: 'Map opacity', min: 0, max: 1, step: 0.05, value: opacity, onInput: v => { opacity = v; recolor(); } });
    slider(map, { id: 'qf-threshold', label: 'Hide values near zero', min: 0, max: 1, step: 0.05, value: 0,
      onInput: v => { colorMap.setThreshold([-v, v]); recolor(); } });
    const display = section(panel, 'Sheet appearance');
    choice(display, { id: 'qf-mode', label: 'View', options: [{ value: 'map', label: 'Map' }, { value: 'relief', label: 'Relief' }, { value: 'distortion', label: 'Distortion' }], value: mode,
      onChange: next => {
        const wasDistortion = mode === 'distortion'; mode = next;
        updateDepthControls();
        reliefControl.input.disabled = next !== 'relief';
        sheet.hidden = next === 'relief'; right.mount.hidden = next !== 'relief';
        if (next === 'relief') rightView.viewer.startRenderLoop(); else rightView.viewer.stopRenderLoop();
        right.caption.textContent = next === 'relief' ? 'Relief · display only' : next === 'distortion' ? 'Chart area distortion · vertex average' : 'Flat · unlit quantitative map';
        if (next === 'distortion' && !wasDistortion) { lastMapPalette = colorMap; colorMap = ColorMap.fromPreset('coolwarm', { range: [-2, 2] }); }
        else if (wasDistortion) colorMap = lastMapPalette;
        recolor(); if (wasDistortion || next === 'distortion') void prepare();
      } });
    const reliefControl = slider(display, { id: 'qf-exaggeration', label: 'Relief exaggeration', min: 0, max: 6, step: 0.25, value: exaggeration, format: v => `${v.toFixed(2)}×`,
      onInput: v => { exaggeration = v; reliefSurface.setDeformation(1, exaggeration, true); } });
    reliefControl.input.disabled = true;
    note(display, 'Relief changes display height and lighting only. Quantitative colors are unlit in Map. Distortion shows log₂ chart area / pial area, normalized across this chart.');
    const inspect = section(panel, 'Pinned anatomical point'), pinned = readout(inspect, 'Value / support', 'qf-pinned');
    pinned.set('Click either view or enter an anatomical vertex.');
    note(inspect, 'Yellow pins stay visible through folds. They mark the same anatomical point in both views.');
    const inputLabel = document.createElement('label'); inputLabel.textContent = 'Anatomical vertex'; inputLabel.htmlFor = 'qf-vertex';
    const input = document.createElement('input'); input.id = 'qf-vertex'; input.type = 'number'; input.min = '0'; input.max = String(vertexCount - 1); input.value = '86934';
    inspect.append(inputLabel, input);
    action(inspect, { id: 'qf-pin', label: 'Pin vertex', onClick: () => { const v = Number(input.value); if (Number.isInteger(v) && v >= 0 && v < vertexCount) controller.select(vertexLocation(domain, v)); } });
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Depth samples and voxel footprint';
    const profile = document.createElement('pre'); profile.className = 'anat-export'; details.append(summary, profile); inspect.append(details);
    let annotationLeft: string | null = null, annotationRight: string | null = null;
    function addPin(target: typeof viewer, location: SurfaceLocation): string | null {
      const id = target.annotations.addAnchor('lh', { location, offset: 0 }, { label: 'Pinned' }, { colorOff: 0xf2c230, radius: 2 });
      const marker = id ? target.annotations.get(id)?.marker : undefined;
      // The demo owns one pin per view. Its public annotation mesh is an overlay:
      // a selection in a sulcus or on the far side must still be visible.
      if (marker) {
        marker.renderOrder = 1000;
        const materials = Array.isArray(marker.material) ? marker.material : [marker.material];
        for (const material of materials) { material.depthTest = false; material.depthWrite = false; }
      }
      return id;
    }
    function selected(location: SurfaceLocation | null) {
      if (annotationLeft) viewer.annotations.remove(annotationLeft);
      if (annotationRight) rightView.viewer.annotations.remove(annotationRight);
      annotationLeft = annotationRight = null;
      viewer.hideCrosshair(); rightView.viewer.hideCrosshair();
      if (!location) {
        linkStatus.set('No selected point'); pinned.set('No selected point'); profile.textContent = '';
        film.set('br', 'selected', 'Pinned', null); film.set('br', 'value', 'Signal', null);
        return;
      }
      const read = controller.inspect(location);
      linkStatus.set(location.kind === 'vertex' ? `Selected vertex ${location.vertex}` : `Selected face ${location.face}`);
      pinned.set(`${Number.isFinite(read.value) ? read.value.toFixed(4) : 'no value'} · ${Math.round(read.coverage * 100)}% · ${read.status}`);
      film.set('br', 'selected', 'Pinned', location.kind === 'vertex' ? `LH ${location.vertex}` : `Face ${location.face}`);
      film.set('br', 'value', mode === 'distortion' ? 'log₂ area' : 'Signal', `${Number.isFinite(read.value) ? read.value.toFixed(3) : '—'} / ${Math.round(read.coverage * 100)}%`);
      profile.textContent = read.samples.map(s => `${s.depth === null ? 'surface' : `depth ${s.depth.toFixed(3)}`}: ${s.valid ? s.value.toFixed(5) : 'missing'}\n  ${s.contributors.filter(c => c.weight > 0).map(c => `${c.index}@${c.weight.toFixed(3)}`).join(', ')}`).join('\n');
      if (chart.chartPoints(location).length) {
        annotationLeft = addPin(viewer, location);
        annotationRight = addPin(rightView.viewer, location);
      }
      if (location.kind === 'vertex') flatmap.setSelection(location.vertex, { emit: false });
    }
    owned.push(controller.on('selection', event => selected(event.location)));
    const pick = (event: MouseEvent, target: typeof viewer) => {
      const result = target.pickSurfaceLocation({ x: event.clientX, y: event.clientY }); if (result.location) controller.select(result.location);
    };
    const pickLeft = (event: MouseEvent) => pick(event, viewer), pickRight = (event: MouseEvent) => pick(event, rightView.viewer);
    solid.mount.addEventListener('click', pickLeft); right.mount.addEventListener('click', pickRight);
    owned.push(() => { solid.mount.removeEventListener('click', pickLeft); right.mount.removeEventListener('click', pickRight); });
    owned.push(flatmap.on('vertex:hover', event => {
      if (event.vertexIndex === null) viewer.hideCrosshair();
      else viewer.showCrosshair('lh', chartIds[event.vertexIndex]!, { mode: 'hover', color: 0x66ccff });
    }));
    const leaveFlatmap = () => flatmap.setHover(null);
    flatmap.canvas.addEventListener('mouseleave', leaveFlatmap);
    owned.push(() => flatmap.canvas.removeEventListener('mouseleave', leaveFlatmap));
    owned.push(viewer.on('vertex:hover', event => flatmap.setHover(event.vertexIndex, { emit: false })));
  const rois = section(panel, 'Regions of interest');
  const roiStatus = readout(rois, 'ROI', 'roi-status');
  roiStatus.element.dataset.roiStatus = '';
  roiStatus.set('No ROI');
  const drawRow = actions(rois);
  const polygon = action(drawRow, { id: 'roi-polygon', label: 'Draw polygon', onClick: () => startDrawing('polygon') });
  const lasso = action(drawRow, { id: 'roi-lasso', label: 'Draw lasso', onClick: () => startDrawing('lasso') });
  action(drawRow, { id: 'roi-seed', label: 'Seed ROI', onClick: () => seed() });
  action(drawRow, { id: 'roi-clear', label: 'Clear ROIs', onClick: () => clearROIs() });
  const drawNote = note(rois, 'Polygon: click points on the flat map, double-click to close. Lasso: press and drag.');
  const exportRow = actions(rois);
  const svgButton = action(exportRow, { id: 'roi-svg', label: 'SVG', onClick: () => showExport('svg') });
  const giftiButton = action(exportRow, { id: 'roi-label', label: 'Label GIFTI', onClick: () => showExport('gifti') });
  const download = document.createElement('a');
  download.className = 'action';
  download.id = 'roi-download';
  download.hidden = true;
  exportRow.append(download);
  const exportBox = document.createElement('pre');
  exportBox.className = 'anat-export';
  exportBox.dataset.roiExport = '';
  exportBox.hidden = true;
  exportBox.tabIndex = 0;
  exportBox.setAttribute('aria-label', 'ROI export');
  rois.append(exportBox);

  let activeROI: VertexROI | null = null;
  let downloadUrl: string | null = null;

  const syncButtons = () => {
    svgButton.disabled = !activeROI;
    giftiButton.disabled = !activeROI;
  };
  const updateMask = () => {
    const next = new Float32Array(vertexCount);
    for (const roi of flatmap.rois.list()) for (const index of roi.vertexIndices) next[chartIds[index]!] = 1;
    surface.setROI(next); reliefSurface.setROI(next);
    film.set('bl', 'rois', 'ROIs', String(flatmap.rois.list().length));
  };
  const setDrawing = (mode: 'polygon' | 'lasso' | null) => {
    polygon.setAttribute('aria-pressed', String(mode === 'polygon'));
    lasso.setAttribute('aria-pressed', String(mode === 'lasso'));
    drawNote.classList.toggle('anat-note-active', mode !== null);
  };
  const nextName = () => `ROI_${flatmap.rois.list().length + 1}`;
  function startDrawing(mode: 'polygon' | 'lasso') {
    flatmap.startROIDrawing({ mode, name: nextName(), color: MARK, provenance: { sourceSurface: 'lh' } });
    setDrawing(mode);
    roiStatus.set(mode === 'polygon' ? 'Drawing a polygon' : 'Drawing a lasso');
  }
  function seed() {
    const { width, height } = flatmap.canvas;
    const roi = flatmap.createROIFromPolygon([
      { x: width * 0.4, y: height * 0.36 },
      { x: width * 0.6, y: height * 0.36 },
      { x: width * 0.64, y: height * 0.58 },
      { x: width * 0.44, y: height * 0.64 }
    ], { name: nextName(), color: MARK, provenance: { sourceSurface: 'lh', tool: 'seed' } });
    if (roi) {
      const focus = roi.vertexIndices[Math.floor(roi.vertexIndices.length / 2)];
      if (focus !== undefined) controller.select(vertexLocation(domain, chartIds[focus]!));
    }
  }
  function clearROIs() {
    flatmap.cancelROIDrawing();
    flatmap.clearROIs();
    activeROI = null;
    exportBox.textContent = '';
    exportBox.hidden = true;
    download.hidden = true;
    roiStatus.set('No ROI');
    setDrawing(null);
    syncButtons();
    updateMask();
    ctx.status('ROIs cleared');
  }
  function showExport(kind: 'svg' | 'gifti') {
    if (!activeROI) return;
    const text = kind === 'svg'
      ? roiToSVG(activeROI, { width: flatmap.canvas.width, height: flatmap.canvas.height, stroke: MARK })
      : roiToLabelGIFTI({ ...activeROI, vertexIndices: Array.from(new Set(activeROI.vertexIndices.map(v => chartIds[v]!))) }, { vertexCount });
    exportBox.textContent = text.length > 900 ? `${text.slice(0, 900)}…` : text;
    exportBox.hidden = false;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([text], { type: kind === 'svg' ? 'image/svg+xml' : 'application/xml' }));
    download.href = downloadUrl;
    download.download = `${activeROI.name}.${kind === 'svg' ? 'svg' : 'label.gii'}`;
    download.textContent = `Save ${download.download}`;
    download.hidden = false;
  }

    owned.push(flatmap.on('roi:created', ({ roi }) => {
      activeROI = roi; roiStatus.set(`${roi.name}: ${roi.vertexIndices.length} vertices`); setDrawing(null); syncButtons(); updateMask();
    }));
    owned.push(flatmap.on('roi:drawing', ({ mode }) => { if (mode === null) setDrawing(null); }));
    owned.push(() => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
    syncButtons();
    const advanced = document.createElement('details'), advancedSummary = document.createElement('summary'); advancedSummary.textContent = 'Resolution, export and provenance';
    advanced.append(advancedSummary); panel.append(advanced);
    choice(advanced, { id: 'qf-resolution', label: 'Sampling width', options: [{ value: '256', label: '256' }, { value: '512', label: '512' }, { value: '1024', label: '1024' }], value: '512',
      onChange: value => { resolution = Number(value); void prepare(); } });
    const exportStatus = readout(advanced, 'Export', 'qf-export-status');
    const exportLinks = document.createElement('div'); exportLinks.className = 'actions'; advanced.append(exportLinks);
    const urls: string[] = []; owned.push(() => urls.forEach(url => URL.revokeObjectURL(url)));
    action(advanced, { id: 'qf-export', label: 'Prepare 1024 px PNG + metadata', onClick: () => { void (async () => {
      exportStatus.set('Preparing independent unlit export…');
      try {
        const artifact = await exportFlatMap(controller, presentation(), { width: 1024, label: 'S1 left · real anatomy / synthetic data',
          execution: { worker, tileSize: 64 }, provenance: { sourceRevision: data.manifest.sourceRevision, assetSha256: data.manifest.sha256, reliefMethod: relief.method } });
        if (!current()) return;
        exportLinks.replaceChildren();
        for (const [name, blob] of [['flatmap.png', artifact.png], ['flatmap.json', artifact.metadata]] as const) {
          const url = URL.createObjectURL(blob); urls.push(url); const link = document.createElement('a'); link.className = 'action'; link.href = url; link.download = name; link.textContent = `Save ${name}`; exportLinks.append(link);
        }
        exportStatus.set('Ready · unlit map and reproducibility metadata');
      } catch (error) { if (current()) exportStatus.set(`Export failed: ${String(error)}`); }
    })(); } });
    note(advanced, `Matched S1 left cortex: ${vertexCount.toLocaleString()} vertices; ${chart.faceCount.toLocaleString()} chart faces. 288 inverted/overlapping source faces explicitly omitted. Source: pycortex ${data.manifest.sourceRevision.slice(0, 8)}. BSD-2-Clause; see dataset manifest. No MNI registration is implied.`);
    film.set('tl', 'surface', 'Surface', 'S1 left · matched anatomy'); film.set('tl', 'data', 'Data', 'Synthetic scalar / volume');
    film.set('tr', 'method', 'Sampling', 'Scalar before color'); film.set('bl', 'relief', 'Relief', 'Display only');
    film.set('bl', 'rois', 'ROIs', '0');
    recolor(); await prepare();
    if (!current()) { cleanup(); return null; }
    ctx.setBusy(false); ctx.perf(`${vertexCount.toLocaleString()} anatomical vertices · ${chart.faceCount.toLocaleString()} admitted faces · WebGL2 + worker`);
    return cleanup;
  } catch (error) {
    cleanup();
    if (!isCurrent()) return null;
    ctx.setBusy(false); note(panel, `The quantitative flatmap could not be prepared: ${String(error)}. Reopen Flat map to retry.`);
    return null;
  }
}
