import { ColorMappedNeuroSurface, SurfaceGeometry, THREE } from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

function buildSphere(detail = 32): SurfaceGeometry {
  const geometry = new THREE.SphereGeometry(50, detail, detail);
  const vertices = new Float32Array(geometry.attributes.position.array);
  const indices = new Uint32Array(geometry.index?.array || []);
  return new SurfaceGeometry(vertices, indices, 'quickstart');
}

function makeNoise(vertexCount: number): Float32Array {
  const data = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    data[i] = Math.sin(i * 0.3) * 0.5 + Math.random() * 0.5;
  }
  return data;
}

export const quickstart: Scenario = {
  id: 'quickstart',
  title: 'Quick start viewer',
  description: 'Sphere with random data, controls toggle, and colormap sanity check.',
  tags: ['core', 'controls', 'colormap'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building viewer');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      useControls: true,
      allowCDNFallback: true,
      backgroundColor: 0x050912
    });

    const geometry = buildSphere(48);
    const vertexCount = geometry.vertices.length / 3;
    const data = makeNoise(vertexCount);

    const surface = new ColorMappedNeuroSurface(
      geometry,
      null,
      data,
      'viridis',
      {
        alpha: 0.92,
        materialType: 'standard',
        metalness: 0.1,
        roughness: 0.55
      }
    );

    viewer.addSurface(surface, 'quick-surface');
    viewer.centerCamera();
    ctx.status('Ready - random field on sphere');

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>What this shows</h4>
        <p>Baseline viewer setup, control overlay, and colormap updates.</p>
        <div class="panel-controls">
          <button id="regen-data" class="primary">Regenerate data</button>
          <button id="toggle-controls" class="ghost">Toggle controls</button>
          <button id="spin-view" class="ghost">Re-center view</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Status</h4>
        <p id="qs-status">Data: ${vertexCount} vertices, colormap viridis.</p>
      </div>
    `;

    const regenBtn = ctx.panel.querySelector('#regen-data');
    const toggleBtn = ctx.panel.querySelector('#toggle-controls');
    const spinBtn = ctx.panel.querySelector('#spin-view');
    const info = ctx.panel.querySelector('#qs-status');

    const setInfo = (msg: string) => {
      if (info) info.textContent = msg;
      ctx.status(msg);
    };

    regenBtn?.addEventListener('click', () => {
      const next = makeNoise(vertexCount);
      surface.setData(next);
      setInfo('Updated data with new random field');
      viewer.requestRender();
    });

    toggleBtn?.addEventListener('click', () => {
      viewer.toggleControls();
    });

    spinBtn?.addEventListener('click', () => {
      viewer.centerCamera();
      viewer.setViewpoint('lateral');
    });

    return () => {
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
