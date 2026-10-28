import { DataLayer, GeometryWorkerClient } from '@src/index.js';
import type { NeuroSurfaceViewer, SurfaceGeometry } from '@src/index.js';
import type { ScenarioRunContext } from '../types';
import { metricFor } from './surface-measurements';
import { note, readout, section, slider, toggle } from './controls';

export function addTemporalSmoothing(ctx: ScenarioRunContext, viewer: NeuroSurfaceViewer, geometry: SurfaceGeometry, values: () => Float32Array | null) {
  const controls = section(ctx.panel, 'Physical smoothing — left hemisphere');
  if (ctx.params.get('task') === 'smoothing') ctx.panel.prepend(controls);
  note(controls, 'Compare the original playback with an area-weighted Gaussian on the left hemisphere. Change the width, then scrub or play: the same weights apply to every frame. The right hemisphere stays original.');
  const status = readout(controls, 'Kernel', 'surface-smoothing-status');
  const difference = readout(controls, 'RMS change', 'surface-smoothing-difference');
  let client: GeometryWorkerClient | undefined, metricHandle: Promise<string> | undefined, plan: string | undefined, output: DataLayer | undefined;
  let enabled = false, alive = true, fwhm = 3, revision = 0, frameRevision = 0, applying = false, pending = false;
  let buildAbort: AbortController | undefined, applyAbort: AbortController | undefined;
  const worker = () => client ??= new GeometryWorkerClient({ workerFactory: () => new Worker(new URL('../../src/geometry/geometryWorker.ts', import.meta.url), { type: 'module' }) });
  const register = () => metricHandle ??= (async () => {
    const metric = metricFor(viewer, 'lh', geometry), engine = worker();
    const domain = await engine.registerDomain(metric.domain);
    const handle = await engine.registerMetric(domain, metric); await engine.release(domain); return handle;
  })();
  const showStatus = (text: string) => { status.set(text); ctx.film.set('tr', 'smoothing', 'LH smoothing', text); };
  const refresh = () => {
    frameRevision++;
    if (!alive || !enabled || !plan) return;
    pending = true; void applyLatest();
  };
  const applyLatest = async () => {
    if (applying || !pending || !alive || !enabled || !plan) return;
    const source = values(); if (!source) return;
    pending = false; applying = true;
    const frame = source.slice(), current = revision, currentFrame = frameRevision, handle = plan;
    applyAbort = new AbortController();
    try {
      const result = (await worker().applyBatch(handle, [frame], { signal: applyAbort.signal, isCurrent: () => alive && enabled && revision === current && frameRevision === currentFrame }))[0]!;
      const data = Float32Array.from(result.values);
      if (!output) { output = new DataLayer('area-smoothed', data, null, 'coolwarm', { range: [-1.5, 1.5], threshold: [-0.2, 0.2], presentation: { label: 'Synthetic BOLD, area smoothing' } }); viewer.addLayer('lh', output); }
      else output.setData(data);
      output.setVisible(true);
      let sum = 0, count = 0;
      result.values.forEach((value, i) => { if (Number.isFinite(value) && Number.isFinite(frame[i])) { sum += (value - frame[i]!) ** 2; count++; } });
      difference.set(`${Math.sqrt(sum / Math.max(1, count)).toFixed(4)} % signal`);
      difference.element.dataset.frameRevision = String(currentFrame);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : '';
      if (alive && enabled && revision === current && code !== 'cancelled' && code !== 'stale-input') showStatus(`Smoothing failed: ${String(error)}. Toggle off and retry.`);
    } finally { applying = false; if (pending) void applyLatest(); }
  };
  const build = async () => {
    const current = ++revision, width = fwhm;
    buildAbort?.abort(); applyAbort?.abort(); buildAbort = new AbortController();
    output?.setVisible(false); pending = false;
    const old = plan; plan = undefined; if (old) void worker().release(old);
    if (!enabled) { controls.setAttribute('aria-busy', 'false'); showStatus('Original playback'); difference.set('—'); return; }
    showStatus(`Building ${width} mm weights…`); controls.setAttribute('aria-busy', 'true'); difference.set('—');
    try {
      const metric = await register();
      if (!alive || !enabled || revision !== current) return;
      const job = { signal: buildAbort.signal, previewKey: 'smoothing', isCurrent: () => alive && enabled && revision === current };
      const smoothing = await worker().buildSmoothing(metric, { fwhmMm: width }, job);
      try { plan = await worker().prepareSmoothing(smoothing, {}, undefined, job); }
      finally { void worker().release(smoothing); }
      showStatus(`${width} mm FWHM; weights ready in worker`); refresh();
    } catch (error) {
      if (alive && revision === current && enabled) { showStatus(`Could not build smoothing: ${String(error)}. Reduce the width and retry.`); }
    } finally { if (alive && revision === current) controls.setAttribute('aria-busy', 'false'); }
  };
  toggle(controls, { id: 'surface-smoothing', label: 'Show smoothed playback', checked: false, onChange: value => { enabled = value; void build(); } });
  slider(controls, { id: 'surface-smoothing-fwhm', label: 'Gaussian FWHM (mm)', min: 0, max: 8, step: 1, value: fwhm, onInput: value => { fwhm = value; if (enabled) void build(); } });
  note(controls, 'Zero width is identity. The kernel uses 4σ support and preserves constants; it does not promise area-integral conservation. Building and application run in a worker. Prepared batches reuse fixed-validity denominators.');
  showStatus('Original playback'); difference.set('—');
  return { refresh, dispose: () => { alive = false; revision++; pending = false; buildAbort?.abort(); applyAbort?.abort(); client?.dispose(); } };
}
