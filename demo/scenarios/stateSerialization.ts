import {
  MultiLayerNeuroSurface,
  SurfaceGeometry,
  DataLayer,
  serialize,
  deserialize,
  encode,
  decode,
  THREE
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';
import type { ViewerStateV1 } from '@src/serialization';

// ---------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------

function makeSphere(detail = 48): SurfaceGeometry {
  const geo = new THREE.SphereGeometry(55, detail, detail);
  const vertices = new Float32Array(geo.attributes.position.array);
  const faces = new Uint32Array(geo.index?.array || []);
  return new SurfaceGeometry(vertices, faces, 'ser');
}

function makeGradient(vertices: Float32Array): Float32Array {
  const V = vertices.length / 3;
  const values = new Float32Array(V);
  for (let i = 0; i < V; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];
    values[i] = Math.sin(x * 0.08) * Math.cos(y * 0.06) + z * 0.015;
  }
  return values;
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export const stateSerialization: Scenario = {
  id: 'stateSerialization',
  title: 'State serialization',
  description:
    'Save / restore viewer state as JSON or compressed URL hash. Demonstrates roundtrip fidelity.',
  tags: ['serialization', 'state', 'url', 'json', 'share'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building sphere + gradient overlay');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      backgroundColor: 0x0a0f1c,
      preset: 'presentation',
      rimStrength: 0.1
    });

    const geometry = makeSphere();
    const surface = new MultiLayerNeuroSurface(geometry, {
      baseColor: 0xc8cdd8,
      useGPUCompositing: false
    });
    viewer.addSurface(surface, 'ser');
    viewer.centerCamera();

    const values = makeGradient(geometry.vertices);
    const dataLayer = new DataLayer(
      'gradient', values, null, 'viridis',
      { range: [-2, 2], threshold: [-0.5, 0.5], opacity: 0.85 }
    );
    viewer.addLayer('ser', dataLayer);
    viewer.requestRender();

    // --- Saved state slot ---
    let savedState: ViewerStateV1 | null = null;

    const updateStatus = () => {
      const tag = savedState ? 'State saved' : 'No saved state';
      ctx.status(`Serialization demo | ${tag}`);
    };
    updateStatus();

    // --- UI ---
    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Snapshot</h4>
        <div class="panel-controls">
          <button id="btn-save" class="primary">Save state</button>
          <button id="btn-restore" class="ghost" disabled>Restore state</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>URL sharing</h4>
        <div class="panel-controls">
          <button id="btn-url" class="ghost">Copy share URL</button>
          <button id="btn-json" class="ghost">Copy JSON</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Roundtrip test</h4>
        <div class="panel-controls">
          <button id="btn-roundtrip" class="ghost">Encode → decode → restore</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Log</h4>
        <pre id="log-area" style="font-size:0.8em;color:#8cf;max-height:160px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin:0;"></pre>
      </div>
    `;

    const logArea = ctx.panel.querySelector('#log-area')!;
    const restoreBtn = ctx.panel.querySelector('#btn-restore') as HTMLButtonElement;

    const log = (msg: string) => {
      const ts = new Date().toLocaleTimeString([], { hour12: false });
      logArea.textContent += `[${ts}] ${msg}\n`;
      logArea.scrollTop = logArea.scrollHeight;
    };

    // Save state
    ctx.panel.querySelector('#btn-save')?.addEventListener('click', () => {
      savedState = serialize(viewer as any);
      restoreBtn.disabled = false;
      const hash = encode(savedState);
      log(`Saved. Hash length: ${hash.length} chars`);
      updateStatus();
    });

    // Restore state
    restoreBtn.addEventListener('click', () => {
      if (!savedState) return;
      const report = deserialize(viewer as any, savedState);
      viewer.requestRender();
      log(
        `Restored. success=${report.success}, ` +
        `warnings=${report.warnings.length}, ` +
        `surfaces=${report.surfacesRestored.join(',') || 'none'}`
      );
      updateStatus();
    });

    // Copy share URL
    ctx.panel.querySelector('#btn-url')?.addEventListener('click', () => {
      const url = viewer.toURL();
      navigator.clipboard.writeText(url).then(
        () => log(`URL copied (${url.length} chars)`),
        () => log(`URL (${url.length} chars): ${url.slice(0, 80)}…`)
      );
    });

    // Copy JSON
    ctx.panel.querySelector('#btn-json')?.addEventListener('click', () => {
      const state = serialize(viewer as any);
      const json = JSON.stringify(state, null, 2);
      navigator.clipboard.writeText(json).then(
        () => log(`JSON copied (${json.length} chars)`),
        () => log(`JSON length: ${json.length} chars (clipboard unavailable)`)
      );
    });

    // Full roundtrip
    ctx.panel.querySelector('#btn-roundtrip')?.addEventListener('click', () => {
      const t0 = performance.now();
      const state = serialize(viewer as any);
      const hash = encode(state);
      const decoded = decode(hash);
      const report = deserialize(viewer as any, decoded);
      const dt = (performance.now() - t0).toFixed(1);
      viewer.requestRender();

      log(
        `Roundtrip in ${dt}ms. hash=${hash.length} chars, ` +
        `success=${report.success}, ` +
        `surfaces=${report.surfacesRestored.join(',') || 'none'}`
      );
      ctx.perf(`Roundtrip: ${dt}ms`);
    });

    return () => {
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
