import type { Scenario, ScenarioRunContext } from '../types';
import { MultiLayerNeuroSurface, SurfaceGeometry, DataLayer } from '@src/index.js';
import { createViewer } from '../viewerHarness';

export const gpupicking: Scenario = {
  id: 'gpupicking',
  title: 'GPU Picking',
  description: 'Fast GPU-based vertex picking with render-to-texture.',
  tags: ['picking', 'gpu', 'interaction'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building high-res sphere for GPU picking...');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      useControls: false,
      hoverCrosshair: true,
      hoverCrosshairColor: 0x00ff00,
      hoverCrosshairSize: 1.5,
      backgroundColor: 0x0b1020
    });

    const geometry = createHighResSphere(96);
    const vertexCount = geometry.vertices.length / 3;
    const data = generatePatternData(geometry.vertices);

    const surface = new MultiLayerNeuroSurface(geometry, { useGPUCompositing: false });
    const dataLayer = new DataLayer('pattern', data, null, 'viridis', {
      range: [-2, 2],
      opacity: 0.9
    });
    surface.addLayer(dataLayer);
    viewer.addSurface(surface, 'sphere');
    viewer.setViewpoint('lateral');
    viewer.enableGPUPicking();

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>GPU Picking</h4>
        <div id="pick-count">Pick count: 0</div>
        <div id="avg-pick-time">Avg pick time: 0 ms</div>
        <div id="last-vertex">Last vertex: --</div>
        <div id="last-value">Data value: --</div>
        <div style="margin-top: 8px;">
          <label><input type="checkbox" id="use-gpu" checked> Use GPU picker</label>
        </div>
        <div style="margin-top: 4px;">
          <label><input type="checkbox" id="show-crosshair" checked> Hover crosshair</label>
        </div>
      </div>
    `;

    const pickCountEl = ctx.panel.querySelector('#pick-count');
    const avgPickTimeEl = ctx.panel.querySelector('#avg-pick-time');
    const lastVertexEl = ctx.panel.querySelector('#last-vertex');
    const lastValueEl = ctx.panel.querySelector('#last-value');
    const useGPUCheckbox = ctx.panel.querySelector('#use-gpu') as HTMLInputElement | null;
    const showCrosshairCheckbox = ctx.panel.querySelector('#show-crosshair') as HTMLInputElement | null;

    let pickCount = 0;
    let totalPickTime = 0;

    if (useGPUCheckbox) {
      useGPUCheckbox.addEventListener('change', () => {
        if (useGPUCheckbox.checked) {
          viewer.enableGPUPicking();
        } else {
          viewer.disableGPUPicking();
        }
        pickCount = 0;
        totalPickTime = 0;
        if (avgPickTimeEl) avgPickTimeEl.textContent = 'Avg pick time: 0 ms';
      });
    }

    if (showCrosshairCheckbox) {
      showCrosshairCheckbox.addEventListener('change', () => {
        viewer.config.hoverCrosshair = showCrosshairCheckbox.checked;
        if (!showCrosshairCheckbox.checked) viewer.hideCrosshair();
      });
    }

    const canvas = viewer.renderer.domElement;
    canvas.addEventListener('mousemove', (event: MouseEvent) => {
      const start = performance.now();
      const result = viewer.pick({
        x: event.clientX,
        y: event.clientY,
        useGPU: useGPUCheckbox?.checked ?? true
      });
      const elapsed = performance.now() - start;
      pickCount++;
      totalPickTime += elapsed;
      if (pickCountEl) pickCountEl.textContent = `Pick count: ${pickCount}`;
      if (avgPickTimeEl) avgPickTimeEl.textContent = `Avg pick time: ${(totalPickTime / pickCount).toFixed(3)} ms`;
      if (result.vertexIndex != null) {
        if (lastVertexEl) lastVertexEl.textContent = `Last vertex: ${result.vertexIndex}`;
        if (lastValueEl) lastValueEl.textContent = `Data value: ${data[result.vertexIndex].toFixed(3)}`;
      }
    });

    viewer.on('surface:click', (event: any) => {
      if (event.vertexIndex != null) {
        console.log('Clicked vertex:', event.vertexIndex, 'Value:', data[event.vertexIndex]);
      }
    });

    return () => {
      cleanup();
      ctx.panel.innerHTML = '';
    };
  }
};

function createHighResSphere(segments: number): SurfaceGeometry {
  const radius = 50;
  const widthSegments = segments;
  const heightSegments = segments;

  const positions: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const theta = v * Math.PI;
    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const phi = u * Math.PI * 2;
      const px = -radius * Math.sin(theta) * Math.cos(phi);
      const py = radius * Math.cos(theta);
      const pz = radius * Math.sin(theta) * Math.sin(phi);
      positions.push(px, py, pz);
    }
  }

  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c);
      indices.push(c, b, d);
    }
  }

  return new SurfaceGeometry(
    new Float32Array(positions),
    new Uint32Array(indices),
    'sphere'
  );
}

function generatePatternData(vertices: Float32Array): Float32Array {
  const vertexCount = vertices.length / 3;
  const data = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];
    data[i] = Math.sin(x * 0.1) * Math.cos(y * 0.12) + Math.sin(z * 0.08) * 0.5;
  }
  return data;
}
