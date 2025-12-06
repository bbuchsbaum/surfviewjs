import {
  MultiLayerNeuroSurface,
  SurfaceGeometry,
  DataLayer,
  computeMeanCurvature,
  normalizeCurvature,
  THREE
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

/**
 * Build a "bumpy sphere" geometry that has actual curvature variation.
 * This simulates a folded brain surface at a basic level.
 */
function buildBumpySphere(radius = 50, subdivisions = 60): SurfaceGeometry {
  const geometry = new THREE.SphereGeometry(radius, subdivisions, subdivisions);
  const positions = geometry.attributes.position.array as Float32Array;

  // Add bumps to simulate sulci/gyri
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    // Normalize to get direction
    const len = Math.sqrt(x * x + y * y + z * z);
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;

    // Create bumps using multiple sine waves (simulates folding)
    const bump1 = Math.sin(x * 0.15) * Math.cos(y * 0.12) * 3;
    const bump2 = Math.sin(y * 0.18) * Math.cos(z * 0.14) * 2;
    const bump3 = Math.cos(z * 0.1) * Math.sin(x * 0.2) * 2.5;
    const totalBump = bump1 + bump2 + bump3;

    // Apply bump along normal direction
    positions[i] = x + nx * totalBump;
    positions[i + 1] = y + ny * totalBump;
    positions[i + 2] = z + nz * totalBump;
  }

  const vertices = new Float32Array(positions);
  const indices = geometry.index
    ? new Uint32Array(geometry.index.array)
    : new Uint32Array(Array.from({ length: vertices.length / 3 }, (_, i) => i));

  return new SurfaceGeometry(vertices, indices, 'bumpy-sphere');
}

/**
 * Generate synthetic functional data for overlay
 */
function generateFunctionalData(vertexCount: number, scale = 1): Float32Array {
  const data = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    // Create a patchy activation pattern
    const x = Math.sin(i * 0.01) * scale;
    const y = Math.cos(i * 0.015) * scale;
    data[i] = Math.sin(x * 5) * Math.cos(y * 3) * 2 + Math.random() * 0.5;
  }
  return data;
}

export const curvature: Scenario = {
  id: 'curvature',
  title: 'Curvature Underlay',
  description: 'Display mesh curvature as a grayscale underlay beneath data layers. Curvature shows sulci (dark) and gyri (light).',
  tags: ['curvature', 'underlay', 'anatomy', 'layers'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building bumpy sphere geometry...');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      backgroundColor: 0x1a1a1a,
      ambientLightColor: 0x606060,
      directionalLightIntensity: 0.7
    });

    // Build geometry with actual curvature variation
    const geom = buildBumpySphere(50, 60);
    const vertexCount = geom.vertices.length / 3;

    ctx.status('Computing mean curvature...');
    const rawCurvature = computeMeanCurvature(geom);
    const curvatureData = normalizeCurvature(rawCurvature, 98);

    ctx.status('Creating surface with curvature underlay...');

    // Create surface with curvature as underlay
    const surface = new MultiLayerNeuroSurface(geom, {
      baseColor: 0x888888,
      curvature: curvatureData,
      showCurvature: true,
      curvatureOptions: {
        brightness: 0.5,
        contrast: 0.5,
        smoothness: 1.0
      }
    });

    viewer.addSurface(surface);
    viewer.centerCamera();

    // Current state
    let showData = false;
    let brightness = 0.5;
    let contrast = 0.5;
    let smoothness = 1.0;
    let curvatureVisible = true;

    function updateCurvatureParams() {
      const layer = surface.getCurvatureLayer();
      if (layer) {
        layer.setBrightness(brightness);
        layer.setContrast(contrast);
        layer.setSmoothness(smoothness);
        surface.requestColorUpdate();
      }
    }

    function toggleDataOverlay() {
      showData = !showData;
      if (showData) {
        // Add functional data overlay
        const funcData = generateFunctionalData(vertexCount);
        const dataLayer = new DataLayer(
          'functional',
          funcData,
          new Uint32Array(vertexCount).map((_, i) => i),
          'hot',
          {
            range: [-2, 2],
            threshold: [0.5, 0.5],
            opacity: 0.8,
            blendMode: 'normal'
          }
        );
        surface.addLayer(dataLayer);
        ctx.status('Added functional data overlay');
      } else {
        surface.removeLayer('functional');
        ctx.status('Removed functional data overlay');
      }
      updateDataButton();
    }

    function updateDataButton() {
      const btn = ctx.panel.querySelector('#toggle-data') as HTMLButtonElement;
      if (btn) {
        btn.textContent = showData ? 'Hide Data Overlay' : 'Show Data Overlay';
      }
    }

    function toggleCurvature() {
      curvatureVisible = !curvatureVisible;
      surface.showCurvature(curvatureVisible);
      const btn = ctx.panel.querySelector('#toggle-curvature') as HTMLButtonElement;
      if (btn) {
        btn.textContent = curvatureVisible ? 'Hide Curvature' : 'Show Curvature';
      }
      ctx.status(curvatureVisible ? 'Curvature visible' : 'Curvature hidden');
    }

    // Build control panel
    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Curvature Display</h4>
        <div class="panel-controls">
          <button id="toggle-curvature" class="ghost">Hide Curvature</button>
        </div>
        <div class="panel-controls" style="margin-top: 8px;">
          <label style="display: block; margin-bottom: 4px;">
            Brightness: <span id="brightness-val">${brightness.toFixed(2)}</span>
          </label>
          <input type="range" id="brightness" min="0" max="1" step="0.05" value="${brightness}" style="width: 100%;">
        </div>
        <div class="panel-controls" style="margin-top: 8px;">
          <label style="display: block; margin-bottom: 4px;">
            Contrast: <span id="contrast-val">${contrast.toFixed(2)}</span>
          </label>
          <input type="range" id="contrast" min="0" max="1" step="0.05" value="${contrast}" style="width: 100%;">
        </div>
        <div class="panel-controls" style="margin-top: 8px;">
          <label style="display: block; margin-bottom: 4px;">
            Smoothness: <span id="smoothness-val">${smoothness.toFixed(2)}</span>
          </label>
          <input type="range" id="smoothness" min="0.1" max="3" step="0.1" value="${smoothness}" style="width: 100%;">
        </div>
      </div>
      <div class="panel-section">
        <h4>Data Overlay</h4>
        <div class="panel-controls">
          <button id="toggle-data" class="ghost">Show Data Overlay</button>
        </div>
        <p style="font-size: 11px; color: #888; margin-top: 8px;">
          Add a functional data overlay on top of the curvature underlay.
        </p>
      </div>
      <div class="panel-section">
        <h4>About Curvature</h4>
        <p style="font-size: 11px; color: #888;">
          Curvature is computed from mesh geometry using the discrete Laplacian.
          <br><br>
          <strong>Dark regions</strong> = sulci (concave, negative curvature)<br>
          <strong>Light regions</strong> = gyri (convex, positive curvature)
          <br><br>
          This provides anatomical context even when viewing inflated surfaces.
        </p>
      </div>
    `;

    // Wire up event listeners
    ctx.panel.querySelector('#toggle-curvature')?.addEventListener('click', toggleCurvature);
    ctx.panel.querySelector('#toggle-data')?.addEventListener('click', toggleDataOverlay);

    const brightnessSlider = ctx.panel.querySelector('#brightness') as HTMLInputElement;
    const contrastSlider = ctx.panel.querySelector('#contrast') as HTMLInputElement;
    const smoothnessSlider = ctx.panel.querySelector('#smoothness') as HTMLInputElement;

    brightnessSlider?.addEventListener('input', () => {
      brightness = parseFloat(brightnessSlider.value);
      const label = ctx.panel.querySelector('#brightness-val');
      if (label) label.textContent = brightness.toFixed(2);
      updateCurvatureParams();
    });

    contrastSlider?.addEventListener('input', () => {
      contrast = parseFloat(contrastSlider.value);
      const label = ctx.panel.querySelector('#contrast-val');
      if (label) label.textContent = contrast.toFixed(2);
      updateCurvatureParams();
    });

    smoothnessSlider?.addEventListener('input', () => {
      smoothness = parseFloat(smoothnessSlider.value);
      const label = ctx.panel.querySelector('#smoothness-val');
      if (label) label.textContent = smoothness.toFixed(2);
      updateCurvatureParams();
    });

    ctx.status(`Ready - ${vertexCount.toLocaleString()} vertices, curvature computed`);

    return () => {
      cleanup();
      ctx.status('Idle');
    };
  }
};
