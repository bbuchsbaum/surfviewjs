import {
  SurfacePolyline, OutlineLayer, SurfaceMetric, GeodesicIndex, getDisplayGeometryBinding,
  evaluateSurfaceLocation, summarizeSurfaceRegion,
  buildSurfaceBoundaryGraph, traceBoundaryCurves
} from '@src/index.js';
import type { NeuroSurfaceViewer, SurfaceGeometry, SurfaceLocation, SurfaceBoundaryGraph } from '@src/index.js';
import type { ScenarioRunContext } from '../types';
import { action, actions, choice, note, readout, section, slider, toggle } from './controls';

export function metricFor(viewer: NeuroSurfaceViewer, id: string, geometry: SurfaceGeometry): SurfaceMetric {
  const mesh = viewer.getSurface(id)?.mesh;
  if (!mesh) throw new Error('Missing display surface');
  return new SurfaceMetric(getDisplayGeometryBinding(mesh).domain, { positions: geometry.vertices, frame: 'fsaverage5-RAS', units: 'mm' });
}

/** Sample actual visible triangle hits, so examples also work after rotating the camera. */
type PreciseHit = ReturnType<NeuroSurfaceViewer['pickSurfaceLocation']>;
export function visibleSurfaceHits(viewer: NeuroSurfaceViewer): PreciseHit[] {
  viewer.render();
  const box = viewer.renderer.domElement.getBoundingClientRect(), hits: PreciseHit[] = [];
  for (const [x, y] of [[0.4, 0.45], [0.55, 0.55], [0.3, 0.5], [0.6, 0.45], [0.5, 0.6], [0.5, 0.5], [0.65, 0.5], [0.35, 0.6]]) {
    const hit = viewer.pickSurfaceLocation({ x: box.left + box.width * x!, y: box.top + box.height * y! });
    if (hit.location && hit.surfaceId && hit.vertexIndex !== null) hits.push(hit);
  }
  return hits;
}

/** Anatomical lengths and areas stay fixed while attachments follow display morphs. */
export function addSurfaceMeasurements(ctx: ScenarioRunContext, viewer: NeuroSurfaceViewer, geometries: Record<string, SurfaceGeometry>) {
  const controls = section(ctx.panel, 'Surface ruler & brush');
  if (ctx.params.get('task') === 'measure' || ctx.params.get('task') === 'borders' || ctx.params.get('scenario') === 'inspect') ctx.panel.prepend(controls);
  note(controls, 'Show an example, or enable clicks and choose two points on one hemisphere. Yellow anchors and the ruler follow inflation; distances use the original pial mesh. The brush is centred on the nearest vertex.');
  const row = actions(controls);
  let enabled = false, radius = 10, boundaryMode: 'midpoint' | 'transition-edges' = 'midpoint';
  let previous: { id: string; location: SurfaceLocation } | null = null;
  let brush: { id: string; vertex: number } | null = null;
  const indices = new Map<string, GeodesicIndex>(), metrics = new Map<string, SurfaceMetric>();
  const outlines = new Map<string, OutlineLayer>(), graphs = new Map<string, SurfaceBoundaryGraph>(), labels = new Map<string, Uint32Array>();
  const markers: string[] = [];
  let path: { id: string; locations: SurfaceLocation[]; line: SurfacePolyline; revision: string } | null = null;
  const output = readout(controls, 'Measurement', 'surface-measurement');
  const straight = readout(controls, 'Straight chord', 'surface-chord');
  const areaOutput = readout(controls, 'Brush area', 'surface-brush-area');
  const borders = readout(controls, 'Border graph', 'surface-border-status');
  const anchorOutput = readout(controls, 'Attachment', 'surface-anchor-status');
  const positionOutput = readout(controls, 'Display point', 'surface-anchor-position');
  const print = (text: string) => { output.set(text); ctx.film.set('bl', 'measurement', 'Surface ruler', text); };
  const clearPath = () => { if (path) { path.line.dispose(); path = null; } };
  const clearMarkers = () => { markers.splice(0).forEach(id => viewer.removeAnnotation(id)); };
  const clear = () => {
    clearPath(); clearMarkers(); previous = null; brush = null;
    for (const id of outlines.keys()) viewer.removeLayer(id, 'measurement-brush');
    outlines.clear(); graphs.clear(); labels.clear();
    print('Choose two points or show an example'); straight.set('—'); areaOutput.set('—'); borders.set('—'); anchorOutput.set('—'); positionOutput.set('—');
    ctx.film.set('br', 'brush', 'Brush', '—'); viewer.requestRender();
  };
  const metricAndIndex = (id: string) => {
    let metric = metrics.get(id);
    if (!metric) { metric = metricFor(viewer, id, geometries[id]!); metrics.set(id, metric); indices.set(id, new GeodesicIndex(metric)); }
    return { metric, index: indices.get(id)! };
  };
  const updateBrush = () => {
    if (!brush) return;
    const { id, vertex } = brush, { metric, index } = metricAndIndex(id), roi = new Uint8Array(metric.domain.vertexCount);
    index.withinRadius([vertex], radius).vertices.forEach(v => { roi[v] = 1; });
    const old = labels.get(id), edits: { vertex: number; label: number }[] = [];
    if (old) roi.forEach((label, vertex) => { if (old[vertex] !== label) edits.push({ vertex, label }); });
    const next = Uint32Array.from(roi); labels.set(id, next);
    let outline = outlines.get(id), graph = graphs.get(id);
    if (!outline || !graph) {
      outline = new OutlineLayer('measurement-brush', { roiLabels: next, boundaryMode, color: 0xf2c230, width: 2, offset: 0.2 });
      viewer.addLayer(id, outline); outlines.set(id, outline);
      graph = buildSurfaceBoundaryGraph(metric.domain, next, { background: 0 }); graphs.set(id, graph);
    } else { outline.updateLabelVertices(edits); graph.updateLabels(edits); }
    const ones = new Float64Array(roi.length).fill(1);
    const member = summarizeSurfaceRegion(metric, ones, { mode: 'vertex-membership', roi });
    const partition = summarizeSurfaceRegion(metric, ones, { mode: 'label-partition', labels: next, selectedLabels: [1] });
    const curves = traceBoundaryCurves(graph);
    areaOutput.set(`${partition.totalAreaMm2.toFixed(1)} mm² partition; ${member.totalAreaMm2.toFixed(1)} mm² vertex membership`);
    areaOutput.element.dataset.partitionArea = String(partition.totalAreaMm2);
    borders.set(`${curves.length} curve${curves.length === 1 ? '' : 's'}; ${graph.segments().length} segments; ${curves.filter(c => c.closed).length} closed`);
    ctx.film.set('br', 'brush', 'Brush', `${radius} mm; ${partition.totalAreaMm2.toFixed(1)} mm²`);
    viewer.requestRender();
  };
  const update = () => {
    if (!previous) return;
    const binding = getDisplayGeometryBinding(viewer.getSurface(previous.id)!.mesh!);
    const point = evaluateSurfaceLocation(previous.location, binding);
    const text = [...point].map(v => v.toFixed(2)).join(', ');
    if (positionOutput.element.textContent !== text) positionOutput.set(text);
    if (!path || binding.revision === path.revision) return;
    path.line.updateBinding(binding); path.revision = binding.revision;
  };
  const place = (hit: PreciseHit) => {
    if (!hit.location || !hit.surfaceId || hit.vertexIndex === null || !geometries[hit.surfaceId]) return;
    const id = hit.surfaceId, { metric, index } = metricAndIndex(id), start = previous?.id === id ? previous.location : null;
    clearMarkers(); clearPath();
    for (const location of start ? [start, hit.location] : [hit.location]) {
      const marker = viewer.annotations.addAnchor(id, { location, offset: 0.25 }, undefined, { colorOn: 0xf2c230, colorOff: 0xf2c230, radius: 1.1 });
      if (marker) markers.push(marker);
    }
    if (start) {
      const route = index.shortestPathLocations(start, hit.location);
      const line = new SurfacePolyline(route.locations);
      viewer.getSurface(id)!.mesh!.add(line); path = { id, locations: route.locations, line, revision: '' };
      print(`${route.lengthMm.toFixed(2)} mm along surface`);
      const a = evaluateSurfaceLocation(start, metric), b = evaluateSurfaceLocation(hit.location, metric);
      straight.set(`${Math.hypot(...a.map((x, i) => x - b[i]!)).toFixed(2)} mm`);
    } else { print('First point; choose the second'); straight.set('—'); }
    previous = { id, location: hit.location }; brush = { id, vertex: hit.vertexIndex };
    anchorOutput.set(hit.location.kind === 'triangle' ? `Face ${hit.location.face}; weights ${hit.location.weights.map(w => w.toFixed(3)).join(', ')}` : `Vertex ${hit.vertexIndex}`);
    updateBrush(); update(); viewer.requestRender();
  };
  const safely = (run: () => void) => { try { run(); } catch (error) { print(error instanceof Error ? error.message : String(error)); } };
  const enable = toggle(controls, { id: 'surface-measure-enabled', label: 'Measure on click', checked: false, onChange: value => { enabled = value; if (value) viewer.hideCrosshair(); } });
  slider(controls, { id: 'surface-brush-radius', label: 'Brush radius (mm)', min: 1, max: 30, step: 1, value: radius, onInput: value => { radius = value; safely(updateBrush); } });
  choice(controls, { id: 'surface-boundary-mode', label: 'Draw brush border', value: boundaryMode, options: [{ value: 'midpoint', label: 'Midpoint curves' }, { value: 'transition-edges', label: 'Label-crossing edges' }], onChange: value => {
    boundaryMode = value; for (const outline of outlines.values()) outline.update({ boundaryMode }); viewer.requestRender();
  } });
  note(controls, 'Midpoint curves follow the categorical partition inside triangles. Label-crossing edges are a mesh diagnostic and can form teeth or spurs. Vertex membership and partition area are different estimands. Paths use the unfolded triangle-pair approximation.');
  const showExample = () => safely(() => {
    const hits = visibleSurfaceHits(viewer), first = hits[0], second = hits.find(hit => hit.surfaceId === first?.surfaceId && hit.vertexIndex !== first?.vertexIndex);
    if (!first || !second) throw new Error('No visible pair found. Fit the surface, then try again.');
    clear(); enabled = true; enable.set(true); place(first); place(second);
  });
  action(row, { id: 'surface-measure-example', label: 'Show example ruler', onClick: showExample });
  action(row, { id: 'surface-measure-clear', label: 'Clear ruler & brush', onClick: clear });
  let down: { x: number; y: number } | null = null, dragged = false;
  const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; dragged = false; };
  const onUp = (event: PointerEvent) => { dragged = !!down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4; down = null; };
  const click = () => { if (enabled && !dragged) safely(() => place(viewer.pickSurfaceLocation())); };
  const canvas = viewer.renderer.domElement;
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);
  const beforeRender = () => { if (enabled) viewer.hideCrosshair(); update(); };
  viewer.on('surface:click', click); viewer.on('render:before', beforeRender); clear();
  if (ctx.params.get('task') === 'measure' || ctx.params.get('task') === 'borders') showExample();
  return { isActive: () => enabled, dispose: () => {
    viewer.off('surface:click', click); viewer.off('render:before', beforeRender);
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); clear();
  } };
}
