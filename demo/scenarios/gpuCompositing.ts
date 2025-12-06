import { MultiLayerNeuroSurface, SurfaceGeometry, DataLayer, THREE } from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

function buildSphereGeometry(subdivisions = 50): SurfaceGeometry {
  const geometry = new THREE.SphereGeometry(50, subdivisions, subdivisions);
  const vertices = new Float32Array(geometry.attributes.position.array);
  const indices = geometry.index
    ? new Uint32Array(geometry.index.array)
    : new Uint32Array(Array.from({ length: vertices.length / 3 }, (_, i) => i));
  return new SurfaceGeometry(vertices, indices, 'gpu-test');
}

function generateLayerData(vertexCount: number, seed: number): Float32Array {
  const data = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    data[i] = Math.sin(i * 0.1 + seed) * 5 + Math.random() * 2;
  }
  return data;
}

export const gpuCompositing: Scenario = {
  id: 'gpu-compositing',
  title: 'GPU vs CPU Compositing',
  description: 'Compare GPU and CPU layer compositing performance with animated multi-layer data.',
  tags: ['performance', 'gpu', 'layers', 'benchmark'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Setting up GPU compositing test');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      backgroundColor: 0x1a1a1a,
      ambientLightColor: 0x404040,
      directionalLightIntensity: 0.5
    });

    let currentMode: 'CPU' | 'GPU' = 'CPU';
    let isAnimating = false;
    let animationId: number | null = null;
    let layerCount = 0;
    let nextLayerId = 1;
    const colorMaps = ['jet', 'hot', 'cool', 'viridis'];

    // Performance tracking
    let frameCount = 0;
    let lastFpsTime = performance.now();
    let currentFps = 0;

    const geom = buildSphereGeometry(50);
    const surface = new MultiLayerNeuroSurface(geom, {
      baseColor: 0x808080,
      useGPUCompositing: false
    });

    viewer.addSurface(surface);
    viewer.centerCamera();

    function addLayer() {
      const vertexCount = surface.vertexCount;
      const data = generateLayerData(vertexCount, performance.now() * 0.001);
      const colorMapName = colorMaps[layerCount % colorMaps.length];
      const layer = new DataLayer(
        `layer-${nextLayerId++}`,
        data,
        new Uint32Array(vertexCount).map((_, i) => i),
        colorMapName,
        {
          range: [-5, 10],
          threshold: [0, 0],
          opacity: 0.7,
          blendMode: 'normal'
        }
      );
      surface.addLayer(layer);
      layerCount++;
      updateStats();
    }

    function removeLayer() {
      const layers = surface.layerStack.getAllLayers();
      if (layers.length > 1) {
        const lastLayer = layers[layers.length - 1];
        surface.removeLayer(lastLayer.id);
        layerCount--;
        updateStats();
      }
    }

    function animateLayers() {
      if (!isAnimating) return;

      const layers = surface.layerStack.getLayers();
      const time = performance.now() * 0.001;

      layers.forEach((layer, index) => {
        if (layer.type === 'data') {
          const dataLayer = layer as DataLayer;
          const data = new Float32Array(surface.vertexCount);
          for (let i = 0; i < data.length; i++) {
            data[i] = Math.sin(i * 0.05 + time * (index + 1)) * 5 +
                     Math.cos(i * 0.03 - time * 0.5) * 3;
          }
          dataLayer.setData(data);
        }
      });

      surface.updateColors();
      viewer.requestRender();

      // FPS tracking
      frameCount++;
      const now = performance.now();
      if (now - lastFpsTime >= 1000) {
        currentFps = frameCount;
        frameCount = 0;
        lastFpsTime = now;
        updateStats();
      }

      animationId = requestAnimationFrame(animateLayers);
    }

    function updateStats() {
      const statsEl = ctx.panel.querySelector('#stats');
      if (statsEl) {
        statsEl.innerHTML = `
          <div class="stat">Mode: <strong>${currentMode}</strong></div>
          <div class="stat">Vertices: <strong>${surface.vertexCount.toLocaleString()}</strong></div>
          <div class="stat">Layers: <strong>${layerCount + 1}</strong></div>
          <div class="stat">FPS: <strong>${currentFps}</strong></div>
        `;
      }
      ctx.perf(`${currentMode} | ${layerCount + 1} layers | ${currentFps} FPS`);
    }

    // Add initial layers
    for (let i = 0; i < 3; i++) {
      addLayer();
    }

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Performance Stats</h4>
        <div id="stats" class="panel-controls"></div>
      </div>
      <div class="panel-section">
        <h4>Compositing Mode</h4>
        <div class="panel-controls">
          <button id="toggle-mode" class="ghost">Switch to GPU</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Layer Management</h4>
        <div class="panel-controls">
          <button id="add-layer" class="ghost">Add Layer</button>
          <button id="remove-layer" class="ghost">Remove Layer</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Animation</h4>
        <div class="panel-controls">
          <button id="toggle-animation" class="ghost">Start Animation</button>
        </div>
      </div>
    `;

    updateStats();

    const toggleModeBtn = ctx.panel.querySelector('#toggle-mode') as HTMLButtonElement;
    const addLayerBtn = ctx.panel.querySelector('#add-layer');
    const removeLayerBtn = ctx.panel.querySelector('#remove-layer');
    const toggleAnimBtn = ctx.panel.querySelector('#toggle-animation') as HTMLButtonElement;

    toggleModeBtn?.addEventListener('click', () => {
      currentMode = currentMode === 'CPU' ? 'GPU' : 'CPU';
      surface.setCompositingMode(currentMode === 'GPU');
      toggleModeBtn.textContent = `Switch to ${currentMode === 'CPU' ? 'GPU' : 'CPU'}`;
      updateStats();
      ctx.status(`Switched to ${currentMode} compositing`);
    });

    addLayerBtn?.addEventListener('click', () => {
      addLayer();
      ctx.status(`Added layer (total: ${layerCount + 1})`);
    });

    removeLayerBtn?.addEventListener('click', () => {
      removeLayer();
      ctx.status(`Removed layer (total: ${layerCount + 1})`);
    });

    toggleAnimBtn?.addEventListener('click', () => {
      isAnimating = !isAnimating;
      toggleAnimBtn.textContent = isAnimating ? 'Stop Animation' : 'Start Animation';
      if (isAnimating) {
        lastFpsTime = performance.now();
        frameCount = 0;
        animateLayers();
        ctx.status('Animation started');
      } else {
        if (animationId) {
          cancelAnimationFrame(animationId);
          animationId = null;
        }
        ctx.status('Animation stopped');
      }
    });

    ctx.status('Ready - toggle modes and add layers to test performance');

    return () => {
      isAnimating = false;
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
