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

export const clipping: Scenario = {
  id: 'clipping',
  title: 'Clip Plane Slicing',
  description: 'Clip the rendered surface with arbitrary planes. Useful for revealing internal structures, medial wall, or focusing on specific regions.',
  tags: ['clipping', 'slice', 'planes', 'visualization'],
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

    ctx.status('Computing curvature and creating surface...');
    const rawCurvature = computeMeanCurvature(geom);
    const curvatureData = normalizeCurvature(rawCurvature, 98);

    // Create surface with curvature and data overlay
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

    // Add a functional data layer for visual interest
    const funcData = generateFunctionalData(vertexCount);
    const dataLayer = new DataLayer(
      'functional',
      funcData,
      new Uint32Array(vertexCount).map((_, i) => i),
      'hot',
      {
        range: [-2, 2],
        threshold: [0.5, 0.5],
        opacity: 0.7,
        blendMode: 'normal'
      }
    );
    surface.addLayer(dataLayer);

    viewer.addSurface(surface);
    viewer.centerCamera();

    // Clip plane state
    const clipState = {
      x: { enabled: false, distance: 0, flip: false },
      y: { enabled: false, distance: 0, flip: false },
      z: { enabled: false, distance: 0, flip: false }
    };

    function updateClipPlane(axis: 'x' | 'y' | 'z') {
      const state = clipState[axis];
      if (state.enabled) {
        surface.setClipPlane(axis, state.distance, true, state.flip);
      } else {
        surface.disableClipPlane(axis);
      }
      ctx.status(`Clip ${axis.toUpperCase()}: ${state.enabled ? `${state.distance.toFixed(1)}` : 'off'}`);
    }

    function createAxisControl(axis: 'x' | 'y' | 'z', label: string, color: string) {
      const state = clipState[axis];
      return `
        <div class="clip-axis" style="margin-bottom: 12px; padding: 8px; border-left: 3px solid ${color}; background: rgba(255,255,255,0.03);">
          <div style="display: flex; align-items: center; margin-bottom: 6px;">
            <input type="checkbox" id="clip-${axis}-enable" ${state.enabled ? 'checked' : ''}>
            <label style="margin-left: 6px; font-weight: bold; color: ${color};">${label}</label>
            <button id="clip-${axis}-flip" class="ghost" style="margin-left: auto; padding: 2px 6px; font-size: 10px;">Flip</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="range" id="clip-${axis}-dist" min="-60" max="60" step="1" value="${state.distance}" style="flex: 1;" ${!state.enabled ? 'disabled' : ''}>
            <span id="clip-${axis}-val" style="min-width: 40px; text-align: right;">${state.distance.toFixed(0)}</span>
          </div>
        </div>
      `;
    }

    // Build control panel
    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Clip Planes</h4>
        <p style="font-size: 11px; color: #888; margin-bottom: 12px;">
          Enable clip planes to slice through the surface. Adjust distance to move the cutting plane.
        </p>
        ${createAxisControl('x', 'X Axis (Sagittal)', '#ff6b6b')}
        ${createAxisControl('y', 'Y Axis (Coronal)', '#69db7c')}
        ${createAxisControl('z', 'Z Axis (Axial)', '#74c0fc')}
      </div>
      <div class="panel-section">
        <h4>Quick Presets</h4>
        <div class="panel-controls" style="display: flex; flex-wrap: wrap; gap: 4px;">
          <button id="preset-midline" class="ghost" style="flex: 1;">Midline</button>
          <button id="preset-anterior" class="ghost" style="flex: 1;">Anterior</button>
          <button id="preset-clear" class="ghost" style="flex: 1;">Clear All</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>About Clipping</h4>
        <p style="font-size: 11px; color: #888;">
          Clip planes remove parts of the surface on one side of a plane.
          <br><br>
          <strong>Uses:</strong>
          <ul style="margin: 4px 0 0 16px; padding: 0;">
            <li>Reveal medial wall structures</li>
            <li>Focus on specific brain regions</li>
            <li>Create presentation figures</li>
            <li>Inspect internal geometry</li>
          </ul>
          <br>
          <strong>Tip:</strong> Use "Flip" to change which side is clipped.
        </p>
      </div>
    `;

    // Wire up event listeners for each axis
    (['x', 'y', 'z'] as const).forEach(axis => {
      const state = clipState[axis];

      const enableCheck = ctx.panel.querySelector(`#clip-${axis}-enable`) as HTMLInputElement;
      const distSlider = ctx.panel.querySelector(`#clip-${axis}-dist`) as HTMLInputElement;
      const distVal = ctx.panel.querySelector(`#clip-${axis}-val`) as HTMLSpanElement;
      const flipBtn = ctx.panel.querySelector(`#clip-${axis}-flip`) as HTMLButtonElement;

      enableCheck?.addEventListener('change', () => {
        state.enabled = enableCheck.checked;
        distSlider.disabled = !state.enabled;
        updateClipPlane(axis);
      });

      distSlider?.addEventListener('input', () => {
        state.distance = parseFloat(distSlider.value);
        distVal.textContent = state.distance.toFixed(0);
        if (state.enabled) {
          updateClipPlane(axis);
        }
      });

      flipBtn?.addEventListener('click', () => {
        state.flip = !state.flip;
        flipBtn.style.background = state.flip ? 'rgba(255,255,255,0.1)' : '';
        if (state.enabled) {
          updateClipPlane(axis);
        }
      });
    });

    // Preset buttons
    ctx.panel.querySelector('#preset-midline')?.addEventListener('click', () => {
      clipState.x.enabled = true;
      clipState.x.distance = 0;
      clipState.x.flip = false;
      (ctx.panel.querySelector('#clip-x-enable') as HTMLInputElement).checked = true;
      (ctx.panel.querySelector('#clip-x-dist') as HTMLInputElement).disabled = false;
      (ctx.panel.querySelector('#clip-x-dist') as HTMLInputElement).value = '0';
      (ctx.panel.querySelector('#clip-x-val') as HTMLSpanElement).textContent = '0';
      updateClipPlane('x');
      ctx.status('Applied midline preset (X=0)');
    });

    ctx.panel.querySelector('#preset-anterior')?.addEventListener('click', () => {
      clipState.y.enabled = true;
      clipState.y.distance = 20;
      clipState.y.flip = false;
      (ctx.panel.querySelector('#clip-y-enable') as HTMLInputElement).checked = true;
      (ctx.panel.querySelector('#clip-y-dist') as HTMLInputElement).disabled = false;
      (ctx.panel.querySelector('#clip-y-dist') as HTMLInputElement).value = '20';
      (ctx.panel.querySelector('#clip-y-val') as HTMLSpanElement).textContent = '20';
      updateClipPlane('y');
      ctx.status('Applied anterior preset (Y=20)');
    });

    ctx.panel.querySelector('#preset-clear')?.addEventListener('click', () => {
      (['x', 'y', 'z'] as const).forEach(axis => {
        clipState[axis].enabled = false;
        clipState[axis].distance = 0;
        clipState[axis].flip = false;
        (ctx.panel.querySelector(`#clip-${axis}-enable`) as HTMLInputElement).checked = false;
        (ctx.panel.querySelector(`#clip-${axis}-dist`) as HTMLInputElement).disabled = true;
        (ctx.panel.querySelector(`#clip-${axis}-dist`) as HTMLInputElement).value = '0';
        (ctx.panel.querySelector(`#clip-${axis}-val`) as HTMLSpanElement).textContent = '0';
        (ctx.panel.querySelector(`#clip-${axis}-flip`) as HTMLButtonElement).style.background = '';
      });
      surface.clearClipPlanes();
      ctx.status('Cleared all clip planes');
    });

    ctx.status(`Ready - ${vertexCount.toLocaleString()} vertices with clipping support`);

    return () => {
      cleanup();
      ctx.status('Idle');
    };
  }
};
