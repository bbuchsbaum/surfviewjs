import {
  DataLayer,
  MultiLayerNeuroSurface,
  RGBALayer,
  SurfaceGeometry,
  THREE
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

function makeSphere(detail = 64): SurfaceGeometry {
  const geometry = new THREE.SphereGeometry(55, detail, detail);
  const vertices = new Float32Array(geometry.attributes.position.array);
  const indices = new Uint32Array(geometry.index?.array || []);
  return new SurfaceGeometry(vertices, indices, 'multi');
}

function makeActivation(vertices: Float32Array): Float32Array {
  const data = new Float32Array(vertices.length / 3);
  for (let i = 0; i < data.length; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];
    const r1 = Math.exp(-(Math.hypot(x - 25, y, z) ** 2) / 500);
    const r2 = Math.exp(-(Math.hypot(x + 20, y + 5, z) ** 2) / 480);
    data[i] = (r1 + r2) * 8 + Math.random() * 0.4;
  }
  return data;
}

function makeRGBA(vertexCount: number): Float32Array {
  const rgba = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    const t = i / vertexCount;
    const base = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
    const offset = i * 4;
    rgba[offset] = 0.2 + 0.6 * base;
    rgba[offset + 1] = 0.5 * (1 - base);
    rgba[offset + 2] = 0.9 * (1 - base);
    rgba[offset + 3] = 0.55;
  }
  return rgba;
}

export const multilayer: Scenario = {
  id: 'multilayer',
  title: 'Multi-layer + compositing',
  description: 'Layer stack with RGBA and data overlays, CPU/GPU switch, thresholds.',
  tags: ['layers', 'gpu', 'colormap'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Preparing multi-layer surface');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      backgroundColor: 0x060b16,
      preset: 'presentation',
      rimStrength: 0.12
    });

    const geometry = makeSphere();
    const surface = new MultiLayerNeuroSurface(geometry, {
      baseColor: 0xced3dd,
      useGPUCompositing: true
    });

    viewer.addSurface(surface, 'multi');
    viewer.centerCamera();
    ctx.status('Base surface ready');

    const vertexCount = surface.vertexCount;

    const addRGBA = () => {
      const rgba = makeRGBA(vertexCount);
      viewer.addLayer('multi', new RGBALayer('rgba', rgba, { opacity: 0.8 }));
      ctx.status('Added RGBA gradient layer');
    };

    const addActivation = () => {
      const data = makeActivation(geometry.vertices);
      viewer.addLayer(
        'multi',
        new DataLayer('activation', data, null, 'hot', {
          range: [0, 10],
          threshold: [2, 9],
          opacity: 0.9,
          blendMode: 'additive'
        })
      );
      ctx.status('Added activation data layer');
      ctx.perf(`Mode: ${surface.getCompositingMode()} | Layers: ${surface.layerStack.layerOrder.length}`);
    };

    const resetLayers = () => {
      surface.clearLayers();
      viewer.requestRender();
      ctx.status('Cleared layers (base remains)');
      ctx.perf(`Mode: ${surface.getCompositingMode()} | Layers: 1`);
    };

    const toggleGPU = () => {
      const useGPU = surface.getCompositingMode() === 'CPU';
      surface.setCompositingMode(useGPU);
      ctx.status(`Switched compositing to ${surface.getCompositingMode()}`);
      ctx.perf(`Mode: ${surface.getCompositingMode()} | Layers: ${surface.layerStack.layerOrder.length}`);
      viewer.requestRender();
    };

    // Seed with one activation layer by default
    addActivation();

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Actions</h4>
        <div class="panel-controls">
          <button id="add-rgba" class="ghost">Add RGBA layer</button>
          <button id="add-activation" class="ghost">Add activation</button>
          <button id="reset-layers" class="ghost">Clear to base</button>
          <button id="toggle-gpu" class="primary">Toggle GPU/CPU</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Notes</h4>
        <p>Use this to verify layer ordering, colormaps, thresholds, and GPU compositing fallback.</p>
      </div>
    `;

    ctx.panel.querySelector('#add-rgba')?.addEventListener('click', () => {
      addRGBA();
      viewer.requestRender();
      ctx.perf(`Mode: ${surface.getCompositingMode()} | Layers: ${surface.layerStack.layerOrder.length}`);
    });

    ctx.panel.querySelector('#add-activation')?.addEventListener('click', () => {
      addActivation();
      viewer.requestRender();
    });

    ctx.panel.querySelector('#reset-layers')?.addEventListener('click', () => {
      resetLayers();
    });

    ctx.panel.querySelector('#toggle-gpu')?.addEventListener('click', () => {
      toggleGPU();
    });

    return () => {
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
