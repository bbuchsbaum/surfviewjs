import { AlignmentQAWorkspace, THREE } from '@src/index.js';
import { Scenario, ScenarioRunContext } from '../types';

function makeReferenceVolume(dims: [number, number, number]): Float32Array {
  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz);
  let offset = 0;
  const cx = (nx - 1) / 2;
  const cy = (ny - 1) / 2;
  const cz = (nz - 1) / 2;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const r = Math.hypot((i - cx) / nx, (j - cy) / ny, (k - cz) / nz);
        data[offset++] = Math.exp(-120 * (r - 0.18) * (r - 0.18));
      }
    }
  }
  return data;
}

function makeSurfaceShell(radius: number, center: [number, number, number]): Float32Array {
  const vertices: number[] = [];
  for (let lat = -60; lat <= 60; lat += 20) {
    const phi = (lat * Math.PI) / 180;
    for (let lon = 0; lon < 360; lon += 18) {
      const theta = (lon * Math.PI) / 180;
      vertices.push(
        center[0] + radius * Math.cos(phi) * Math.cos(theta),
        center[1] + radius * Math.cos(phi) * Math.sin(theta),
        center[2] + radius * Math.sin(phi)
      );
    }
  }
  return new Float32Array(vertices);
}

export const alignmentQA: Scenario = {
  id: 'alignment-qa',
  title: 'Alignment QA',
  description: 'Reference volume slices with pial/white overlays and transform QA metrics.',
  tags: ['qc', 'alignment', 'volume', 'surface'],
  run: async (ctx: ScenarioRunContext) => {
    const layout = document.createElement('div');
    layout.dataset.visualQa = 'alignment-qa';
    layout.style.width = '100%';
    layout.style.height = '100%';
    ctx.mount.replaceChildren(layout);

    const dims: [number, number, number] = [48, 48, 48];
    const center: [number, number, number] = [24, 24, 24];
    const volume = {
      id: 'synthetic-boldref',
      data: makeReferenceVolume(dims),
      dims,
      space: 'boldref',
      dropoutThreshold: 0.08
    };
    const surfaces = [
      { id: 'white', kind: 'white', vertices: makeSurfaceShell(8.2, center), color: '#ffd166' },
      { id: 'pial', kind: 'pial', vertices: makeSurfaceShell(10.5, center), color: '#58c4ff' }
    ];

    let workspace: AlignmentQAWorkspace | null = null;

    function mountWorkspace(misaligned = false) {
      workspace?.dispose();
      const matrix = misaligned
        ? new THREE.Matrix4().makeTranslation(16, 0, 0)
        : new THREE.Matrix4();
      workspace = new AlignmentQAWorkspace(layout, {
        volume,
        surfaces,
        transform: {
          id: misaligned ? 'anat-to-boldref-shifted' : 'anat-to-boldref',
          from: 'anat',
          to: 'boldref',
          matrix,
          provenance: { source: 'synthetic-demo' }
        }
      });
      const report = workspace.getReport();
      const message = `Alignment QA: ${misaligned ? 'shifted' : 'aligned'} | out-of-bounds ${report.metrics.surfaceVoxelDistance.outOfBoundsFraction.toFixed(3)}`;
      ctx.status(message);
      const status = ctx.panel.querySelector('[data-alignment-status]');
      if (status) status.textContent = message;
      const state = ctx.panel.querySelector('[data-alignment-state]');
      if (state) state.textContent = misaligned ? 'shifted' : 'aligned';
      const oob = ctx.panel.querySelector('[data-alignment-oob]');
      if (oob) oob.textContent = report.metrics.surfaceVoxelDistance.outOfBoundsFraction.toFixed(3);
      const dropout = ctx.panel.querySelector('[data-alignment-dropout]');
      if (dropout) dropout.textContent = report.metrics.dropoutOverlay.dropoutFraction.toFixed(3);
      const distance = ctx.panel.querySelector('[data-alignment-distance]');
      if (distance) distance.textContent = report.metrics.surfaceVoxelDistance.meanDistance.toFixed(3);
    }

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Alignment QA</h4>
        <div class="metric-grid">
          <div class="metric-chip">
            <span>State</span>
            <strong data-alignment-state>aligned</strong>
          </div>
          <div class="metric-chip">
            <span>Out of bounds</span>
            <strong data-alignment-oob>0.000</strong>
          </div>
          <div class="metric-chip">
            <span>Dropout</span>
            <strong data-alignment-dropout>0.000</strong>
          </div>
          <div class="metric-chip">
            <span>Mean distance</span>
            <strong data-alignment-distance>0.000</strong>
          </div>
        </div>
        <div class="panel-controls">
          <button id="aq-aligned" class="ghost">Aligned</button>
          <button id="aq-shifted" class="ghost">Shifted</button>
        </div>
        <p data-alignment-status>Preparing alignment QA</p>
      </div>
    `;
    ctx.panel.querySelector('#aq-aligned')?.addEventListener('click', () => mountWorkspace(false));
    ctx.panel.querySelector('#aq-shifted')?.addEventListener('click', () => mountWorkspace(true));

    mountWorkspace(false);

    return () => {
      workspace?.dispose();
      workspace = null;
      ctx.status('Idle');
    };
  }
};
