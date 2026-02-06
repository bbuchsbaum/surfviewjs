import { MultiLayerNeuroSurface, SurfaceGeometry, VolumeProjectionLayer, VolumeTexture3D, THREE } from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

function buildIcosphere(radius = 50, subdivisions = 5): SurfaceGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, subdivisions);
  const pos = geometry.getAttribute('position');
  const vertices = new Float32Array(pos.array);
  const faces = geometry.index
    ? new Uint32Array(geometry.index.array)
    : new Uint32Array(Array.from({ length: pos.count }, (_, i) => i));
  geometry.dispose();
  return new SurfaceGeometry(vertices, faces, 'volume');
}

function makePatternVolume(dims: [number, number, number]): Float32Array {
  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz);

  let idx = 0;
  for (let k = 0; k < nz; k++) {
    const z = (k / Math.max(1, nz - 1)) * Math.PI * 2.0;
    for (let j = 0; j < ny; j++) {
      const y = (j / Math.max(1, ny - 1)) * Math.PI * 2.0;
      for (let i = 0; i < nx; i++) {
        const x = (i / Math.max(1, nx - 1)) * Math.PI * 2.0;
        data[idx++] = 0.5 + 0.5 * Math.sin(x * 3.0) * Math.cos(y * 2.0) * Math.sin(z * 4.0);
      }
    }
  }

  return data;
}

export const volumeProjection: Scenario = {
  id: 'volume-projection',
  title: 'GPU Volume Projection',
  description: 'Sample a 3D volume texture at surface vertices in the GPU compositor.',
  tags: ['volume', 'gpu', 'layers', 'webgl2'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Setting up volume projection demo…');
    ctx.setBusy(true, 'Initializing');

    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      backgroundColor: 0x0b1020,
      ambientLightColor: 0x404040,
      directionalLightIntensity: 0.65
    });

    const geometry = buildIcosphere(52, 5);
    const surface = new MultiLayerNeuroSurface(geometry, {
      baseColor: 0x2b2f38,
      useGPUCompositing: true
    });

    viewer.addSurface(surface, 'brain');
    viewer.centerCamera();
    surface.setCompositingMode(true);

    const dims: [number, number, number] = [64, 64, 64];
    const voxelSize: [number, number, number] = [2, 2, 2];
    const volumeOrigin: [number, number, number] = [
      -(dims[0] * voxelSize[0]) / 2,
      -(dims[1] * voxelSize[1]) / 2,
      -(dims[2] * voxelSize[2]) / 2
    ];
    const volumeData = makePatternVolume(dims);

    let colormap = 'viridis';
    let range: [number, number] = [0, 1];
    let threshold: [number, number] = [0, 0];
    let opacity = 1.0;
    let useHalfFloat = false;
    const fillValue = -1;

    let volumeLayer: VolumeProjectionLayer | null = null;

    function ensureVolumeLayer() {
      if (volumeLayer) {
        surface.removeLayer(volumeLayer.id);
        volumeLayer.dispose();
        volumeLayer = null;
      }

      volumeLayer = new VolumeProjectionLayer('volume', volumeData, dims, {
        colormap,
        range,
        threshold,
        opacity,
        blendMode: 'normal',
        voxelSize,
        volumeOrigin,
        useHalfFloat,
        fillValue
      });

      surface.addLayer(volumeLayer);

      const supportedLinear = VolumeTexture3D.isSupported(viewer.renderer, {
        requireLinearFiltering: true,
        useHalfFloat
      });
      if (!supportedLinear) {
        const texture = volumeLayer.getVolumeTexture().texture;
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.needsUpdate = true;
        ctx.status('Float linear filtering unsupported; using nearest sampling.');
      }
    }

    ensureVolumeLayer();

    function setCompositingMode(mode: 'CPU' | 'GPU') {
      surface.setCompositingMode(mode === 'GPU');
      ctx.status(`Compositing: ${surface.getCompositingMode()}`);
    }

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Volume Projection</h4>
        <div class="panel-controls">
          <div class="stat">Surface vertices: <strong>${surface.vertexCount.toLocaleString()}</strong></div>
          <div class="stat">Volume dims: <strong>${dims.join('×')}</strong></div>
          <div class="stat">Mode: <strong id="mode-label">${surface.getCompositingMode()}</strong></div>
        </div>
      </div>
      <div class="panel-section">
        <h4>Compositing</h4>
        <div class="panel-controls">
          <button id="toggle-mode" class="ghost">Switch to ${surface.getCompositingMode() === 'CPU' ? 'GPU' : 'CPU'}</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Display</h4>
        <div class="panel-controls">
          <label>Colormap
            <select id="colormap">
              <option value="viridis">viridis</option>
              <option value="jet">jet</option>
              <option value="hot">hot</option>
              <option value="cool">cool</option>
              <option value="seismic">seismic</option>
            </select>
          </label>
          <label>Opacity <span id="opacity-label">${opacity.toFixed(2)}</span>
            <input id="opacity" type="range" min="0" max="1" step="0.01" value="${opacity}" />
          </label>
        </div>
      </div>
      <div class="panel-section">
        <h4>Intensity Range</h4>
        <div class="panel-controls">
          <label>Min <span id="range-min-label">${range[0].toFixed(2)}</span>
            <input id="range-min" type="range" min="0" max="1" step="0.01" value="${range[0]}" />
          </label>
          <label>Max <span id="range-max-label">${range[1].toFixed(2)}</span>
            <input id="range-max" type="range" min="0" max="1" step="0.01" value="${range[1]}" />
          </label>
        </div>
      </div>
      <div class="panel-section">
        <h4>Threshold (hide inside [low, high])</h4>
        <div class="panel-controls">
          <label>Low <span id="thr-low-label">${threshold[0].toFixed(2)}</span>
            <input id="thr-low" type="range" min="0" max="1" step="0.01" value="${threshold[0]}" />
          </label>
          <label>High <span id="thr-high-label">${threshold[1].toFixed(2)}</span>
            <input id="thr-high" type="range" min="0" max="1" step="0.01" value="${threshold[1]}" />
          </label>
        </div>
      </div>
      <div class="panel-section">
        <h4>GPU Texture</h4>
        <div class="panel-controls">
          <label><input id="half-float" type="checkbox" ${useHalfFloat ? 'checked' : ''} /> Half-float (saves VRAM)</label>
        </div>
      </div>
    `;

    const modeLabel = ctx.panel.querySelector('#mode-label');
    const toggleModeBtn = ctx.panel.querySelector('#toggle-mode') as HTMLButtonElement | null;
    const colormapSelect = ctx.panel.querySelector('#colormap') as HTMLSelectElement | null;
    const opacityInput = ctx.panel.querySelector('#opacity') as HTMLInputElement | null;
    const opacityLabel = ctx.panel.querySelector('#opacity-label');
    const rangeMinInput = ctx.panel.querySelector('#range-min') as HTMLInputElement | null;
    const rangeMaxInput = ctx.panel.querySelector('#range-max') as HTMLInputElement | null;
    const rangeMinLabel = ctx.panel.querySelector('#range-min-label');
    const rangeMaxLabel = ctx.panel.querySelector('#range-max-label');
    const thrLowInput = ctx.panel.querySelector('#thr-low') as HTMLInputElement | null;
    const thrHighInput = ctx.panel.querySelector('#thr-high') as HTMLInputElement | null;
    const thrLowLabel = ctx.panel.querySelector('#thr-low-label');
    const thrHighLabel = ctx.panel.querySelector('#thr-high-label');
    const halfFloatInput = ctx.panel.querySelector('#half-float') as HTMLInputElement | null;

    if (colormapSelect) colormapSelect.value = colormap;

    function applySettings() {
      if (!volumeLayer) return;
      volumeLayer.setColormap(colormap);
      volumeLayer.setOpacity(opacity);
      volumeLayer.setRange(range);
      volumeLayer.setThreshold(threshold);
      surface.updateColors();
      viewer.requestRender();
    }

    toggleModeBtn?.addEventListener('click', () => {
      const next = surface.getCompositingMode() === 'CPU' ? 'GPU' : 'CPU';
      setCompositingMode(next);
      if (modeLabel) modeLabel.textContent = surface.getCompositingMode();
      if (toggleModeBtn) {
        toggleModeBtn.textContent = `Switch to ${surface.getCompositingMode() === 'CPU' ? 'GPU' : 'CPU'}`;
      }
      applySettings();
    });

    colormapSelect?.addEventListener('change', () => {
      colormap = colormapSelect.value;
      applySettings();
    });

    opacityInput?.addEventListener('input', () => {
      opacity = Number(opacityInput.value);
      if (opacityLabel) opacityLabel.textContent = opacity.toFixed(2);
      applySettings();
    });

    rangeMinInput?.addEventListener('input', () => {
      range = [Number(rangeMinInput.value), range[1]];
      if (rangeMinLabel) rangeMinLabel.textContent = range[0].toFixed(2);
      if (range[0] > range[1]) {
        range = [range[1], range[0]];
        rangeMinInput.value = String(range[0]);
      }
      applySettings();
    });

    rangeMaxInput?.addEventListener('input', () => {
      range = [range[0], Number(rangeMaxInput.value)];
      if (rangeMaxLabel) rangeMaxLabel.textContent = range[1].toFixed(2);
      if (range[0] > range[1]) {
        range = [range[1], range[0]];
        rangeMaxInput.value = String(range[1]);
      }
      applySettings();
    });

    thrLowInput?.addEventListener('input', () => {
      threshold = [Number(thrLowInput.value), threshold[1]];
      if (thrLowLabel) thrLowLabel.textContent = threshold[0].toFixed(2);
      if (threshold[0] > threshold[1]) {
        threshold = [threshold[1], threshold[0]];
        thrLowInput.value = String(threshold[0]);
      }
      applySettings();
    });

    thrHighInput?.addEventListener('input', () => {
      threshold = [threshold[0], Number(thrHighInput.value)];
      if (thrHighLabel) thrHighLabel.textContent = threshold[1].toFixed(2);
      if (threshold[0] > threshold[1]) {
        threshold = [threshold[1], threshold[0]];
        thrHighInput.value = String(threshold[1]);
      }
      applySettings();
    });

    halfFloatInput?.addEventListener('change', () => {
      useHalfFloat = !!halfFloatInput.checked;
      ensureVolumeLayer();
      applySettings();
    });

    ctx.status(`Ready (WebGL2=${viewer.renderer.capabilities.isWebGL2 ? 'yes' : 'no'})`);
    ctx.setBusy(false);

    return () => {
      if (volumeLayer) {
        surface.removeLayer(volumeLayer.id);
        volumeLayer.dispose();
        volumeLayer = null;
      }
      cleanup();
      ctx.panel.innerHTML = '';
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
