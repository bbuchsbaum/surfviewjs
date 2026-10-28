import { DataLayer, LabelLayer, SurfaceDomain, SurfaceResamplingPlan, exportSurfaceResamplingPlan, importSurfaceResamplingPlan } from '@src/index.js';
import type { NeuroSurfaceViewer, SurfaceResamplingArtifact, THREE } from '@src/index.js';
import type { ScenarioRunContext } from '../types';
import { action, actions, choice, note, readout, section } from './controls';

export function addMappingInterchange(ctx: ScenarioRunContext, viewer: NeuroSurfaceViewer): () => void {
  const controls = section(ctx.panel, 'Surface mapping & interchange');
  if (ctx.params.get('task') === 'mapping') ctx.panel.prepend(controls);
  note(controls, 'Apply scalar values or categorical labels through reusable weights. Identity preserves the source; neighbour blend mixes connected vertices. These are explicit example mappings, not anatomical registration. Save a plan, then load it back on the same mesh.');
  const status = readout(controls, 'Mapping', 'surface-mapping-status');
  const coverage = readout(controls, 'Support', 'surface-mapping-coverage');
  let alive = true, revision = 0, kind: 'scalar' | 'labels' = 'scalar', method: 'identity' | 'blend' = 'identity';
  let currentArtifact: SurfaceResamplingArtifact | undefined;
  const domains = new WeakMap<THREE.Mesh, Promise<SurfaceDomain>>();
  const domainFor = (mesh: THREE.Mesh) => {
    let pending = domains.get(mesh);
    if (!pending) {
      pending = (async () => {
        const positions = mesh.geometry.getAttribute('position'), index = mesh.geometry.getIndex();
        if (!index) throw new Error('An indexed surface is required. Load a bundled sample.');
        // Stable demo identity: exact positions and ordered faces, so a saved plan can
        // be reloaded after Reset without treating equal vertex counts as correspondence.
        const bytes = new ArrayBuffer(positions.count * 24 + index.count * 4), view = new DataView(bytes);
        for (let v = 0; v < positions.count; v++) { view.setFloat64(v * 24, positions.getX(v), true); view.setFloat64(v * 24 + 8, positions.getY(v), true); view.setFloat64(v * 24 + 16, positions.getZ(v), true); }
        for (let i = 0; i < index.count; i++) view.setUint32(positions.count * 24 + i * 4, index.getX(i), true);
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
        return new SurfaceDomain({ id: `demo-mapping-${hash}`, structure: 'demo-loaded-surface', vertexCount: positions.count, faces: index.array });
      })();
      domains.set(mesh, pending);
    }
    return pending;
  };
  const makePlan = (domain: SurfaceDomain) => {
    const offsets = new Uint32Array(domain.vertexCount + 1), indices: number[] = [], weights: number[] = [];
    for (let v = 0; v < domain.vertexCount; v++) {
      const neighbors = method === 'blend' ? domain.topology.neighbors(v) : new Uint32Array();
      indices.push(v); weights.push(neighbors.length ? 0.5 : 1);
      for (const neighbor of neighbors) { indices.push(neighbor); weights.push(0.5 / neighbors.length); }
      offsets[v + 1] = indices.length;
    }
    return new SurfaceResamplingPlan(domain, domain, { offsets, indices, weights }, { method: 'provided', correspondence: `demo-${method}` });
  };
  const show = (plan: SurfaceResamplingPlan, mesh: THREE.Mesh) => {
    const positions = mesh.geometry.getAttribute('position'), n = plan.target.vertexCount;
    const values = Float64Array.from({ length: n }, (_, i) => positions.getX(i));
    let min = Infinity, max = -Infinity; values.forEach(x => { min = Math.min(min, x); max = Math.max(max, x); });
    const labels = Float64Array.from(values, x => x < min + (max - min) / 3 ? 1 : x < min + 2 * (max - min) / 3 ? 2 : 3);
    const result = kind === 'scalar' ? plan.apply(values) : plan.applyLabels(labels);
    viewer.removeLayer('loaded', 'mapped-coordinate'); viewer.removeLayer('loaded', 'mapped-labels');
    if (kind === 'scalar') viewer.addLayer('loaded', new DataLayer('mapped-coordinate', Float32Array.from(result.values), null, 'viridis', { range: [min, max > min ? max : min + 1], presentation: { label: 'Synthetic x-coordinate, mapped' } }));
    else viewer.addLayer('loaded', new LabelLayer('mapped-labels', { labels: Array.from(result.values), labelDefs: [{ id: 1, name: 'Low x', color: '#719baf' }, { id: 2, name: 'Middle x', color: '#cdbba0' }, { id: 3, name: 'High x', color: '#b8675d' }] }));
    const supported = result.valid.reduce((a, b) => a + b, 0);
    coverage.set(`${supported.toLocaleString()} / ${n.toLocaleString()} vertices; ${kind === 'labels' ? 'weighted label votes' : 'weighted scalar mean'}`);
    ctx.film.set('tr', 'mapping', 'Mapping', `${kind}; ${plan.provenance.correspondence.replace('demo-', '')}`);
    ctx.film.set('br', 'mapping-support', 'Support', `${supported.toLocaleString()} / ${n.toLocaleString()}`);
    return supported;
  };
  const buttons = actions(controls);
  let saveButton: HTMLButtonElement, applyButton: HTMLButtonElement;
  const setBusy = (busy: boolean) => { controls.setAttribute('aria-busy', String(busy)); saveButton.disabled = busy; applyButton.disabled = busy; };
  const run = async (download: boolean, artifact?: SurfaceResamplingArtifact) => {
    if (!alive) return;
    const current = ++revision, mesh = viewer.getSurface('loaded')?.mesh;
    if (!mesh) return;
    setBusy(true); status.set(artifact ? 'Validating mapping…' : 'Building mapping…');
    try {
      const domain = await domainFor(mesh);
      const plan = artifact ? await importSurfaceResamplingPlan(artifact, domain, domain) : makePlan(domain);
      const exported = artifact ?? await exportSurfaceResamplingPlan(plan);
      const restored = artifact ? plan : await importSurfaceResamplingPlan(exported, domain, domain);
      if (!alive || current !== revision || viewer.getSurface('loaded')?.mesh !== mesh) return;
      const supported = show(restored, mesh);
      currentArtifact = exported;
      if (download) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(exported)], { type: 'application/json' })), link = document.createElement('a');
        link.href = url; link.download = 'surface-mapping.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      status.element.removeAttribute('data-error'); status.element.classList.remove('data-error'); status.set(`${supported.toLocaleString()} supported rows; checksum verified`);
    } catch (error) {
      if (alive && current === revision) { status.element.dataset.error = 'true'; status.element.classList.add('data-error'); status.set(`Mapping rejected: ${error instanceof Error ? error.message : String(error)}. Reload the matching mesh or apply a new example.`); }
    } finally { if (alive && current === revision) setBusy(false); }
  };
  choice(controls, { id: 'surface-mapping-kind', label: 'Values to map', value: kind, options: [{ value: 'scalar', label: 'Scalar field' }, { value: 'labels', label: 'Categorical labels' }], onChange: value => { kind = value; void run(false, currentArtifact); } });
  choice(controls, { id: 'surface-mapping-method', label: 'Example correspondence', value: method, options: [{ value: 'identity', label: 'Identity' }, { value: 'blend', label: 'Neighbour blend' }], onChange: value => { method = value; void run(false); } });
  applyButton = action(buttons, { id: 'surface-mapping-apply', label: 'Apply mapping', onClick: () => run(false) });
  saveButton = action(buttons, { id: 'surface-mapping-roundtrip', label: 'Apply & save mapping', onClick: () => run(true, currentArtifact) });
  const label = document.createElement('label'); label.htmlFor = 'surface-mapping-file'; label.textContent = 'Load mapping weights (.json)';
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.id = label.htmlFor;
  const field = document.createElement('div'); field.className = 'control data-file'; field.append(label, input); controls.append(field);
  const onFile = async () => {
    const file = input.files?.[0]; if (!file) return;
    const current = ++revision;
    try { const artifact = JSON.parse(await file.text()) as SurfaceResamplingArtifact; if (alive && revision === current) await run(false, artifact); }
    catch { if (alive && revision === current) { status.element.dataset.error = 'true'; status.element.classList.add('data-error'); status.set('Mapping rejected: invalid JSON. Choose a saved mapping file.'); setBusy(false); } }
  };
  input.addEventListener('change', onFile);
  status.set('Apply an example or load saved weights'); coverage.set('—');
  const changed = () => { revision++; currentArtifact = undefined; setBusy(false); status.element.removeAttribute('data-error'); status.element.classList.remove('data-error'); status.set('Mesh changed; apply an example or load matching weights'); coverage.set('—'); ctx.film.set('tr', 'mapping', 'Mapping', '—'); ctx.film.set('br', 'mapping-support', 'Support', '—'); };
  viewer.on('surface:added', changed);
  return () => { alive = false; revision++; viewer.off('surface:added', changed); input.removeEventListener('change', onFile); };
}
