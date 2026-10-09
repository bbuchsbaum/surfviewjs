import { DataLayer, MultiLayerNeuroSurface, projectVolume, SurfaceGeometry, THREE } from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario } from '../types';

export const normalProjection: Scenario = {
  id: 'normal-projection',
  title: 'Normal Volume Projection',
  description: 'Sample a synthetic signed volume along anatomical normals, then display ordinary vertex data.',
  tags: ['volume', 'normals', 'data'],
  run(ctx) {
    const { viewer, cleanup } = createViewer(ctx.mount, { backgroundColor: 0x0b1020 });
    const sphere = new THREE.IcosahedronGeometry(42, 12);
    const positions = new Float32Array(sphere.getAttribute('position').array);
    const normals = new Float32Array(positions); // Radial anatomical normals; normalized by projectVolume.
    const faces = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
    sphere.dispose();
    const surface = new MultiLayerNeuroSurface(new SurfaceGeometry(positions, faces, 'volume'));
    viewer.addSurface(surface, 'normal-projection');
    viewer.centerCamera();
    const data = new Float32Array(64 ** 3);
    for (let k = 0; k < 64; k++) for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const x = 2 * i - 64, y = 2 * j - 64, z = 2 * k - 64;
      data[i + 64 * (j + 64 * k)] = Math.sin(x / 8) * Math.cos(y / 11) * Math.sin(z / 9);
    }
    const volume = {
      data, dims: [64, 64, 64] as const,
      voxelToWorld: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -64, -64, -64, 1]
    };
    let layer: DataLayer | null = null;
    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Sampling along normals</h4>
        <p>Synthetic signed volume. Depths are millimetres along outward radial normals.</p>
        <div class="panel-controls">
          <label>Depth below surface (mm)<input id="normal-low" type="range" min="-12" max="0" step="1" value="-4"></label>
          <label>Depth above surface (mm)<input id="normal-high" type="range" min="0" max="12" step="1" value="4"></label>
          <label>Samples<input id="normal-steps" type="range" min="1" max="16" step="1" value="5"></label>
          <label>Interpolation<select id="normal-interpolation"><option value="linear">linear</option><option value="nearest">nearest</option></select></label>
          <label>Reduction<select id="normal-reducer"><option value="mean">mean</option><option value="max-abs">signed maximum absolute</option></select></label>
          <div id="normal-result" role="status"></div>
        </div>
      </div>`;
    const low = ctx.panel.querySelector<HTMLInputElement>('#normal-low')!;
    const high = ctx.panel.querySelector<HTMLInputElement>('#normal-high')!;
    const steps = ctx.panel.querySelector<HTMLInputElement>('#normal-steps')!;
    const interpolation = ctx.panel.querySelector<HTMLSelectElement>('#normal-interpolation')!;
    const reducer = ctx.panel.querySelector<HTMLSelectElement>('#normal-reducer')!;
    const resultLabel = ctx.panel.querySelector<HTMLElement>('#normal-result')!;
    function project() {
      const start = performance.now();
      const result = projectVolume(volume, { positions, normals }, {
        depthMm: [Number(low.value), Number(high.value)], steps: Number(steps.value),
        interpolation: interpolation.value as 'linear' | 'nearest', reducer: reducer.value as 'mean' | 'max-abs'
      });
      const elapsed = performance.now() - start;
      if (layer) layer.setData(result.values);
      else {
        layer = new DataLayer('projected', result.values, null, 'seismic', { range: [-1, 1] });
        surface.addLayer(layer);
      }
      surface.updateColors();
      viewer.requestRender();
      const valid = result.validSamples.reduce((n, count) => n + Number(count > 0), 0);
      resultLabel.textContent = `${valid.toLocaleString()} / ${result.values.length.toLocaleString()} vertices; depths [${low.value}, ${high.value}] mm; ${steps.value} samples; ${reducer.value}; ${elapsed.toFixed(1)} ms`;
    }
    for (const control of [low, high, steps, interpolation, reducer]) control.addEventListener('input', project);
    project();
    ctx.status('Ready: anatomical projection → DataLayer');
    ctx.setBusy(false);
    return () => { cleanup(); ctx.panel.innerHTML = ''; ctx.perf(''); };
  }
};
