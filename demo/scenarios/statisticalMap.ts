import {
  MultiLayerNeuroSurface,
  SurfaceGeometry,
  StatisticalMapLayer,
  THREE
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

// ---------------------------------------------------------------------------
// Synthetic data generators
// ---------------------------------------------------------------------------

function makeSphere(detail = 64): SurfaceGeometry {
  const geo = new THREE.SphereGeometry(55, detail, detail);
  const vertices = new Float32Array(geo.attributes.position.array);
  const faces = new Uint32Array(geo.index?.array || []);
  return new SurfaceGeometry(vertices, faces, 'stat');
}

/**
 * Generate a synthetic t-map with 3 Gaussian blobs (2 positive, 1 negative)
 * plus uniform noise. Returns { tValues, pValues }.
 */
function makeSyntheticTMap(vertices: Float32Array): {
  tValues: Float32Array;
  pValues: Float32Array;
} {
  const V = vertices.length / 3;
  const tValues = new Float32Array(V);
  const pValues = new Float32Array(V);

  // Blob centers in vertex space
  const blobs = [
    { cx: 30, cy: 20, cz: 10, sigma: 400, sign: 1 },   // positive blob 1
    { cx: -25, cy: 15, cz: -5, sigma: 350, sign: 1 },   // positive blob 2
    { cx: 10, cy: -30, cz: 15, sigma: 300, sign: -1 }    // negative blob
  ];

  for (let i = 0; i < V; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];

    let t = (Math.random() - 0.5) * 1.2; // baseline noise

    for (const b of blobs) {
      const dist2 = (x - b.cx) ** 2 + (y - b.cy) ** 2 + (z - b.cz) ** 2;
      t += b.sign * 6 * Math.exp(-dist2 / b.sigma);
    }

    tValues[i] = t;

    // Approximate p-value from |t| using a simple sigmoid-like mapping
    // (not statistically exact, but visually correct for demo purposes)
    const absT = Math.abs(t);
    pValues[i] = Math.exp(-0.5 * absT * absT);
  }

  return { tValues, pValues };
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export const statisticalMap: Scenario = {
  id: 'statisticalMap',
  title: 'Statistical map layer',
  description:
    'FDR / Bonferroni / cluster correction, dual-threshold colormaps, vertex stat queries.',
  tags: ['statistics', 'layers', 'colormap', 'fdr', 'cluster'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building sphere + synthetic t-map');
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
      useGPUCompositing: false // CPU for stat layer compatibility
    });
    viewer.addSurface(surface, 'stat');
    viewer.centerCamera();

    // Generate synthetic data
    const { tValues, pValues } = makeSyntheticTMap(geometry.vertices);

    // Create the stat layer
    const statLayer = new StatisticalMapLayer('tmap', tValues, null, 'hot', {
      range: [-6, 6],
      threshold: [-1.5, 1.5],
      pValues,
      statType: 'tstat',
      degreesOfFreedom: 28,
      opacity: 0.95
    });

    statLayer.setMeshAdjacency(geometry);
    viewer.addLayer('stat', statLayer);
    viewer.requestRender();

    // State
    let correctionMode = 'none';
    let dualMode = false;

    const updateStatus = () => {
      const method = statLayer.getCorrectionMethod();
      const dual = dualMode ? ' | Dual threshold' : '';
      ctx.status(`Correction: ${method}${dual}`);
    };
    updateStatus();

    // --- UI ---
    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Correction Method</h4>
        <div class="panel-controls">
          <button id="btn-none" class="ghost">None</button>
          <button id="btn-fdr" class="primary">FDR (q=0.05)</button>
          <button id="btn-bonf" class="ghost">Bonferroni</button>
          <button id="btn-cluster" class="ghost">Cluster (k≥20)</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Display</h4>
        <div class="panel-controls">
          <button id="btn-dual" class="ghost">Toggle dual threshold</button>
          <button id="btn-cmap" class="ghost">Cycle colormap</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Info</h4>
        <p id="vertex-info" style="font-size:0.85em;color:#aaa;">
          Hover over the surface to see vertex statistics.
        </p>
      </div>
    `;

    // Correction buttons
    ctx.panel.querySelector('#btn-none')?.addEventListener('click', () => {
      statLayer.clearCorrection();
      correctionMode = 'none';
      viewer.requestRender();
      updateStatus();
    });

    ctx.panel.querySelector('#btn-fdr')?.addEventListener('click', () => {
      statLayer.applyFDR(0.05);
      correctionMode = 'fdr';
      viewer.requestRender();
      updateStatus();
    });

    ctx.panel.querySelector('#btn-bonf')?.addEventListener('click', () => {
      statLayer.applyBonferroni(0.05);
      correctionMode = 'bonferroni';
      viewer.requestRender();
      updateStatus();
    });

    ctx.panel.querySelector('#btn-cluster')?.addEventListener('click', () => {
      statLayer.applyClusterThreshold(2.0, { minClusterSize: 20 });
      correctionMode = 'cluster';
      viewer.requestRender();
      updateStatus();
    });

    // Dual threshold toggle
    ctx.panel.querySelector('#btn-dual')?.addEventListener('click', () => {
      dualMode = !dualMode;
      if (dualMode) {
        statLayer.setDualThreshold({
          positiveColorMap: 'hot',
          negativeColorMap: 'cool',
          positiveRange: [1.5, 6],
          negativeRange: [-6, -1.5]
        });
      } else {
        statLayer.clearDualThreshold();
      }
      viewer.requestRender();
      updateStatus();
    });

    // Colormap cycling
    const cmaps = ['hot', 'viridis', 'plasma', 'inferno', 'jet'];
    let cmapIdx = 0;
    ctx.panel.querySelector('#btn-cmap')?.addEventListener('click', () => {
      cmapIdx = (cmapIdx + 1) % cmaps.length;
      if (!dualMode) {
        statLayer.setColorMap(cmaps[cmapIdx]);
      } else {
        statLayer.setDualThreshold({
          positiveColorMap: cmaps[cmapIdx],
          negativeColorMap: 'cool',
          positiveRange: [1.5, 6],
          negativeRange: [-6, -1.5]
        });
      }
      viewer.requestRender();
      ctx.perf(`Colormap: ${cmaps[cmapIdx]}`);
    });

    // Vertex hover info
    const infoEl = ctx.panel.querySelector('#vertex-info');
    viewer.on('vertex:hover', (e: { vertexIndex: number }) => {
      if (!infoEl) return;
      const info = statLayer.getVertexStatInfo(e.vertexIndex);
      if (info) {
        const z = info.zScore !== null ? info.zScore.toFixed(2) : '—';
        const p = info.pValue !== null ? info.pValue.toExponential(2) : '—';
        const cl = info.clusterIndex >= 0
          ? `cluster #${info.clusterIndex} (n=${info.clusterSize})`
          : 'none';
        infoEl.textContent =
          `v${e.vertexIndex}: t=${info.value.toFixed(2)}, z=${z}, p=${p}, ${cl}`;
      }
    });

    return () => {
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
