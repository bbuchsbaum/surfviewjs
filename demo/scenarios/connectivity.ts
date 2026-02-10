import {
  MultiLayerNeuroSurface,
  SurfaceGeometry,
  ConnectivityLayer,
  THREE
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';
import type { ConnectivityEdge } from '@src/ConnectivityLayer';

// ---------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------

function makeSphere(detail = 32): SurfaceGeometry {
  const geo = new THREE.SphereGeometry(55, detail, detail);
  const vertices = new Float32Array(geo.attributes.position.array);
  const faces = new Uint32Array(geo.index?.array || []);
  return new SurfaceGeometry(vertices, faces, 'conn');
}

function makeRandomEdges(vertexCount: number, n: number): ConnectivityEdge[] {
  const edges: ConnectivityEdge[] = [];
  const used = new Set<string>();
  while (edges.length < n) {
    const a = Math.floor(Math.random() * vertexCount);
    let b = Math.floor(Math.random() * vertexCount);
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (used.has(key)) continue;
    used.add(key);
    edges.push({
      source: Math.min(a, b),
      target: Math.max(a, b),
      weight: Math.random()
    });
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export const connectivity: Scenario = {
  id: 'connectivity',
  title: 'Connectivity layer',
  description:
    'Edge rendering (line / tube), node spheres, weight thresholding, topN filtering.',
  tags: ['connectivity', 'layers', 'edges', 'nodes', 'colormap'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building sphere + random edges');
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
    viewer.addSurface(surface, 'conn');
    viewer.centerCamera();

    const V = geometry.getVertexCount();
    let edges = makeRandomEdges(V, 500);

    const connLayer = new ConnectivityLayer('connectome', edges, {
      colorMap: 'hot',
      renderMode: 'tube',
      tubeRadius: 0.2,
      tubeRadiusScale: true,
      showNodes: true,
      nodeRadius: 0.6,
      nodeColor: 0x2196f3,
      opacity: 0.85,
      threshold: 0.3
    });

    viewer.addLayer('conn', connLayer);
    viewer.requestRender();

    // State
    let threshold = 0.3;
    let renderMode: 'tube' | 'line' = 'tube';
    let showNodes = true;

    const updateStatus = () => {
      ctx.status(
        `${connLayer.getEdgeCount()} edges | ${renderMode} mode | threshold=${threshold.toFixed(2)}`
      );
    };
    updateStatus();

    // --- UI ---
    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Threshold</h4>
        <div class="panel-controls">
          <input id="sl-thresh" type="range" min="0" max="100" value="30" style="width:100%">
          <span id="lbl-thresh" style="font-size:0.85em;color:#aaa;">0.30</span>
        </div>
      </div>
      <div class="panel-section">
        <h4>Display</h4>
        <div class="panel-controls">
          <button id="btn-mode" class="ghost">Toggle line/tube</button>
          <button id="btn-nodes" class="ghost">Toggle nodes</button>
          <button id="btn-cmap" class="ghost">Cycle colormap</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Data</h4>
        <div class="panel-controls">
          <button id="btn-regen" class="primary">Regenerate edges</button>
          <button id="btn-topn" class="ghost">Top 50 only</button>
        </div>
      </div>
    `;

    // Threshold slider
    const slider = ctx.panel.querySelector('#sl-thresh') as HTMLInputElement;
    const label = ctx.panel.querySelector('#lbl-thresh')!;
    slider?.addEventListener('input', () => {
      threshold = parseInt(slider.value) / 100;
      label.textContent = threshold.toFixed(2);
      connLayer.update({ threshold });
      viewer.requestRender();
      updateStatus();
    });

    // Render mode toggle
    ctx.panel.querySelector('#btn-mode')?.addEventListener('click', () => {
      renderMode = renderMode === 'tube' ? 'line' : 'tube';
      connLayer.update({ renderMode });
      viewer.requestRender();
      updateStatus();
    });

    // Node toggle
    ctx.panel.querySelector('#btn-nodes')?.addEventListener('click', () => {
      showNodes = !showNodes;
      connLayer.update({ showNodes });
      viewer.requestRender();
    });

    // Colormap cycling
    const cmaps = ['hot', 'viridis', 'plasma', 'inferno', 'jet'];
    let cmapIdx = 0;
    ctx.panel.querySelector('#btn-cmap')?.addEventListener('click', () => {
      cmapIdx = (cmapIdx + 1) % cmaps.length;
      connLayer.update({ colorMap: cmaps[cmapIdx] });
      viewer.requestRender();
      ctx.perf(`Colormap: ${cmaps[cmapIdx]}`);
    });

    // Regenerate edges
    ctx.panel.querySelector('#btn-regen')?.addEventListener('click', () => {
      edges = makeRandomEdges(V, 500);
      connLayer.update({ edges, threshold });
      viewer.requestRender();
      updateStatus();
    });

    // Top 50
    let topNActive = false;
    ctx.panel.querySelector('#btn-topn')?.addEventListener('click', () => {
      topNActive = !topNActive;
      connLayer.update({ topN: topNActive ? 50 : 0 });
      viewer.requestRender();
      updateStatus();
    });

    return () => {
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
