import type { Scenario } from '../types';
import {
  NeuroSurfaceViewer,
  MultiLayerNeuroSurface,
  SurfaceGeometry,
  DataLayer,
  ColorMap
} from '../../src/index';

/**
 * GPU Picking Demo
 *
 * Demonstrates GPU-based vertex picking for fast, accurate selection
 * on large meshes. Compares performance with raycasting.
 */
export const gpupicking: Scenario = {
  id: 'gpupicking',
  title: 'GPU Picking',
  description: 'Fast GPU-based vertex picking with render-to-texture',
  run: async (container: HTMLElement) => {
    // Create viewer with GPU picking enabled
    const viewer = new NeuroSurfaceViewer(container, 'lateral', {
      useGPUPicking: true,
      hoverCrosshair: true,
      hoverCrosshairColor: 0x00ff00,
      hoverCrosshairSize: 1.5,
      backgroundColor: 0x1a1a2e
    });

    // Create a high-resolution sphere for testing
    const resolution = 128; // Creates ~32k vertices
    const geometry = createHighResSphere(resolution);

    // Generate random data for visualization
    const vertexCount = geometry.positions.length / 3;
    const data = new Float32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      // Create some pattern based on position
      const x = geometry.positions[i * 3];
      const y = geometry.positions[i * 3 + 1];
      const z = geometry.positions[i * 3 + 2];
      data[i] = Math.sin(x * 3) * Math.cos(y * 3) + Math.sin(z * 2);
    }

    // Create surface with data layer
    const surface = new MultiLayerNeuroSurface(geometry);
    const dataLayer = new DataLayer({
      id: 'pattern',
      data,
      colormap: ColorMap.get('viridis'),
      range: { min: -2, max: 2 },
      opacity: 0.9
    });
    surface.addLayer(dataLayer);

    viewer.addSurface(surface, 'sphere');
    viewer.setViewpoint('lateral');

    // Stats tracking
    let pickCount = 0;
    let totalPickTime = 0;
    let lastVertexIndex: number | null = null;

    // Create info panel
    const infoPanel = document.createElement('div');
    infoPanel.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      padding: 15px;
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      font-family: monospace;
      font-size: 13px;
      border-radius: 8px;
      min-width: 280px;
      z-index: 1000;
    `;
    infoPanel.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 10px; color: #4fc3f7;">GPU Picking Demo</div>
      <div id="vertexCount">Vertices: ${vertexCount.toLocaleString()}</div>
      <div id="pickMethod">Method: GPU (render-to-texture)</div>
      <div id="pickTime">Pick time: --</div>
      <div id="avgPickTime">Avg pick time: --</div>
      <div id="lastVertex">Last vertex: --</div>
      <div id="lastValue">Data value: --</div>
      <hr style="border-color: #444; margin: 10px 0;">
      <div style="margin-bottom: 8px;">
        <label>
          <input type="checkbox" id="useGPU" checked>
          Use GPU Picking
        </label>
      </div>
      <div style="margin-bottom: 8px;">
        <label>
          <input type="checkbox" id="showCrosshair" checked>
          Show Hover Crosshair
        </label>
      </div>
      <button id="resetStats" style="
        background: #2196F3;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        width: 100%;
        margin-top: 10px;
      ">Reset Stats</button>
    `;
    container.appendChild(infoPanel);

    // Get UI elements
    const pickTimeEl = infoPanel.querySelector('#pickTime') as HTMLElement;
    const avgPickTimeEl = infoPanel.querySelector('#avgPickTime') as HTMLElement;
    const lastVertexEl = infoPanel.querySelector('#lastVertex') as HTMLElement;
    const lastValueEl = infoPanel.querySelector('#lastValue') as HTMLElement;
    const pickMethodEl = infoPanel.querySelector('#pickMethod') as HTMLElement;
    const useGPUCheckbox = infoPanel.querySelector('#useGPU') as HTMLInputElement;
    const showCrosshairCheckbox = infoPanel.querySelector('#showCrosshair') as HTMLInputElement;
    const resetStatsButton = infoPanel.querySelector('#resetStats') as HTMLButtonElement;

    // Toggle GPU picking
    useGPUCheckbox.addEventListener('change', () => {
      if (useGPUCheckbox.checked) {
        viewer.enableGPUPicking();
        pickMethodEl.textContent = 'Method: GPU (render-to-texture)';
      } else {
        viewer.disableGPUPicking();
        pickMethodEl.textContent = 'Method: Raycasting (CPU)';
      }
      // Reset stats when switching methods
      pickCount = 0;
      totalPickTime = 0;
    });

    // Toggle crosshair
    showCrosshairCheckbox.addEventListener('change', () => {
      viewer.config.hoverCrosshair = showCrosshairCheckbox.checked;
      if (!showCrosshairCheckbox.checked) {
        viewer.hideCrosshair();
      }
    });

    // Reset stats
    resetStatsButton.addEventListener('click', () => {
      pickCount = 0;
      totalPickTime = 0;
      avgPickTimeEl.textContent = 'Avg pick time: --';
    });

    // Handle picks with timing
    const canvas = viewer.renderer.domElement;
    canvas.addEventListener('mousemove', (event: MouseEvent) => {
      const startTime = performance.now();

      const result = viewer.pick({
        x: event.clientX,
        y: event.clientY,
        useGPU: useGPUCheckbox.checked
      });

      const endTime = performance.now();
      const pickTime = endTime - startTime;

      pickCount++;
      totalPickTime += pickTime;

      pickTimeEl.textContent = `Pick time: ${pickTime.toFixed(3)} ms`;
      avgPickTimeEl.textContent = `Avg pick time: ${(totalPickTime / pickCount).toFixed(3)} ms`;

      if (result.vertexIndex !== null) {
        lastVertexIndex = result.vertexIndex;
        lastVertexEl.textContent = `Last vertex: ${result.vertexIndex}`;
        lastValueEl.textContent = `Data value: ${data[result.vertexIndex].toFixed(3)}`;
      }
    });

    // Handle clicks
    viewer.on('surface:click', (event: any) => {
      console.log('Clicked vertex:', event.vertexIndex, 'Value:', data[event.vertexIndex]);
    });

    return viewer;
  }
};

/**
 * Create a high-resolution UV sphere geometry
 */
function createHighResSphere(segments: number): SurfaceGeometry {
  const radius = 50;
  const widthSegments = segments;
  const heightSegments = segments;

  const positions: number[] = [];
  const indices: number[] = [];

  // Generate vertices
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

  // Generate indices
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      const c = a + 1;
      const d = b + 1;

      // Two triangles per quad
      indices.push(a, b, c);
      indices.push(c, b, d);
    }
  }

  return new SurfaceGeometry(
    new Float32Array(positions),
    new Uint32Array(indices)
  );
}
