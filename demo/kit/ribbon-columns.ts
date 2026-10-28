import { GeometryWorkerClient, SurfaceMetric, projectRibbonVolume, vertexLocation } from '@src/index.js';
import type { NeuroSurfaceViewer, SurfaceGeometry, RibbonIntegrationResult, VolumeDescriptor } from '@src/index.js';
import type { ScenarioRunContext } from '../types';
import { metricFor, visibleSurfaceHits } from './surface-measurements';
import { action, actions, note, readout, section, slider, toggle } from './controls';

export function addRibbonColumns(ctx: ScenarioRunContext, viewer: NeuroSurfaceViewer, geometry: SurfaceGeometry, white: Float32Array, pial: Float32Array, volume: VolumeDescriptor): () => void {
  const controls = section(ctx.panel, 'Column-volume integration');
  if (ctx.params.get('task') === 'column') ctx.panel.prepend(controls);
  note(controls, 'Inspect a visible column or click a point. Compare its volume-weighted mean with seven samples along the white–pial segment. These measure different regions. This synthetic 2.5 mm ribbon can fold; invalid columns are rejected.');
  const row = actions(controls), status = readout(controls, 'Column', 'ribbon-column-status');
  const segment = readout(controls, 'Segment mean', 'ribbon-segment-status');
  const support = readout(controls, 'Volume support', 'ribbon-column-support');
  let enabled = false, alive = true, minimum = 1, revision = 0, exampleRun = 0, selected: number | undefined, marker: string | null = null;
  let client: GeometryWorkerClient | undefined, registration: Promise<{ domain: string; white: string; pial: string }> | undefined;
  let metric: SurfaceMetric | undefined, abort: AbortController | undefined;
  const plans = new Map<number, string>();
  const worker = () => client ??= new GeometryWorkerClient({ workerFactory: () => new Worker(new URL('../../src/geometry/geometryWorker.ts', import.meta.url), { type: 'module' }) });
  const register = () => registration ??= (async () => {
    metric = metricFor(viewer, 'lh', geometry); const engine = worker(), domain = await engine.registerDomain(metric.domain);
    const whiteHandle = await engine.registerMetric(domain, new SurfaceMetric(metric.domain, { positions: white, frame: metric.frame, units: 'mm' }));
    const pialHandle = await engine.registerMetric(domain, new SurfaceMetric(metric.domain, { positions: pial, frame: metric.frame, units: 'mm' }));
    return { domain, white: whiteHandle, pial: pialHandle };
  })();
  const inspect = async (vertex: number): Promise<boolean> => {
    const current = ++revision; selected = vertex; abort?.abort(); abort = new AbortController();
    const signal = abort.signal, isCurrent = () => alive && current === revision;
    status.set(`Integrating vertex ${vertex}…`); controls.setAttribute('aria-busy', 'true');
    try {
      const handles = await register(); if (!isCurrent()) return false;
      let plan = plans.get(vertex);
      if (!plan) {
        const targets = new Uint8Array(metric!.domain.vertexCount); targets[vertex] = 1;
        const affine = volume.voxelToWorld;
        plan = await worker().request<string>({ type: 'ribbon', ...handles, grid: { dims: volume.dims, voxelToWorld: 'elements' in affine ? affine.elements : affine, frame: metric!.frame, units: 'mm' }, options: { targets } }, { signal, previewKey: 'column', isCurrent });
        plans.set(vertex, plan);
        if (plans.size > 3) { const oldest = plans.keys().next().value!; const handle = plans.get(oldest)!; plans.delete(oldest); void worker().release(handle); }
      }
      const result = await worker().apply(plan, volume.data, { minCoverage: minimum }, { signal, previewKey: 'column-value', isCurrent }) as RibbonIntegrationResult;
      const coverage = 100 * result.validCoverage[vertex]!;
      const value = result.valid[vertex] ? result.values[vertex]!.toFixed(3) : 'unsupported';
      status.set(`v${vertex}: ${value}, ${coverage.toFixed(1)}% valid, ${result.totalVolumeMm3[vertex]!.toFixed(2)} mm³`);
      support.set(`${result.validVolumeMm3[vertex]!.toFixed(2)} / ${result.totalVolumeMm3[vertex]!.toFixed(2)} mm³; ${result.status[vertex]}`);
      const sampled = projectRibbonVolume(volume, { white: white.slice(vertex * 3, vertex * 3 + 3), pial: pial.slice(vertex * 3, vertex * 3 + 3) }, { steps: 7, interpolation: 'nearest', reducer: 'mean' });
      segment.set(`${sampled.values[0]!.toFixed(3)}; ${sampled.validSamples[0]} / 7 samples`);
      if (marker) viewer.removeAnnotation(marker);
      marker = viewer.annotations.addAnchor('lh', { location: vertexLocation(metric!.domain, vertex), offset: 0.25 }, undefined, { radius: 1.5, colorOn: 0xf2c230, colorOff: 0xf2c230 });
      viewer.requestRender(); ctx.film.set('br', 'column', 'Column coverage', `${coverage.toFixed(1)}%; ${value}`);
      return true;
    } catch (error) {
      if (isCurrent()) { status.set(`Column rejected: ${error instanceof Error ? error.message : String(error)}. Try another vertex.`); segment.set('—'); support.set('—'); }
      return false;
    } finally { if (isCurrent()) controls.setAttribute('aria-busy', 'false'); }
  };
  const enable = toggle(controls, { id: 'ribbon-column-enabled', label: 'Inspect column on click', checked: false, onChange: value => {
    enabled = value; exampleRun++;
    if (!value) { revision++; abort?.abort(); controls.setAttribute('aria-busy', 'false'); status.set('Click inspection off; choose an example to continue'); }
  } });
  const example = action(row, { id: 'ribbon-column-example', label: 'Inspect example column', onClick: async () => {
    const run = ++exampleRun;
    enabled = true; enable.set(true); example.disabled = true;
    try {
      const candidates = visibleSurfaceHits(viewer).filter(hit => hit.surfaceId === 'lh');
      if (!candidates.length) { status.set('No visible surface. Fit the view and retry.'); return; }
      for (const hit of candidates.slice(0, 4)) { if (!alive || !enabled || run !== exampleRun || await inspect(hit.vertexIndex!)) break; }
    } finally { if (alive) example.disabled = false; }
  } });
  action(row, { id: 'ribbon-column-clear', label: 'Clear column', onClick: () => {
    revision++; exampleRun++; abort?.abort(); selected = undefined; controls.setAttribute('aria-busy', 'false');
    if (marker) viewer.removeAnnotation(marker); marker = null;
    status.set('Choose a column'); segment.set('—'); support.set('—'); ctx.film.set('br', 'column', 'Column coverage', '—'); viewer.requestRender();
  } });
  slider(controls, { id: 'ribbon-column-min-coverage', label: 'Minimum valid volume (%)', min: 0, max: 100, step: 10, value: 100, onInput: value => { minimum = value / 100; exampleRun++; if (selected !== undefined) void inspect(selected); } });
  note(controls, 'Coverage is valid volume divided by full column volume, not a sample count. Construction runs in a worker; the last three column plans are reused.');
  const click = () => { if (!enabled) return; const hit = viewer.pickSurfaceLocation(); if (hit.surfaceId === 'lh' && hit.vertexIndex !== null) { exampleRun++; void inspect(hit.vertexIndex); } };
  viewer.on('surface:click', click); status.set('Choose a column'); segment.set('—'); support.set('—');
  return () => { alive = false; revision++; abort?.abort(); viewer.off('surface:click', click); if (marker) viewer.removeAnnotation(marker); client?.dispose(); };
}
