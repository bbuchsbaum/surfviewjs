import {
  MorphableSurface,
  Easing,
  SurfaceGeometry,
  computeMeanCurvature,
  normalizeCurvature,
  THREE
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

/**
 * Build a bumpy sphere (base geometry)
 */
function buildBumpySphere(radius = 50, subdivisions = 60): {
  positions: Float32Array;
  faces: Uint32Array;
} {
  const geometry = new THREE.SphereGeometry(radius, subdivisions, subdivisions);
  const positions = geometry.attributes.position.array as Float32Array;

  // Add bumps
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    const len = Math.sqrt(x * x + y * y + z * z);
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;

    const bump1 = Math.sin(x * 0.15) * Math.cos(y * 0.12) * 3;
    const bump2 = Math.sin(y * 0.18) * Math.cos(z * 0.14) * 2;
    const bump3 = Math.cos(z * 0.1) * Math.sin(x * 0.2) * 2.5;
    const totalBump = bump1 + bump2 + bump3;

    positions[i] = x + nx * totalBump;
    positions[i + 1] = y + ny * totalBump;
    positions[i + 2] = z + nz * totalBump;
  }

  const vertices = new Float32Array(positions);
  const indices = geometry.index
    ? new Uint32Array(geometry.index.array)
    : new Uint32Array(Array.from({ length: vertices.length / 3 }, (_, i) => i));

  return { positions: vertices, faces: indices };
}

/**
 * Create an inflated version (smooth sphere)
 */
function createInflatedPositions(basePositions: Float32Array, radius = 50): Float32Array {
  const inflated = new Float32Array(basePositions.length);

  for (let i = 0; i < basePositions.length; i += 3) {
    const x = basePositions[i];
    const y = basePositions[i + 1];
    const z = basePositions[i + 2];

    const len = Math.sqrt(x * x + y * y + z * z);
    const scale = radius / len;

    inflated[i] = x * scale;
    inflated[i + 1] = y * scale;
    inflated[i + 2] = z * scale;
  }

  return inflated;
}

/**
 * Create a flat (2D projection) version
 */
function createFlatPositions(basePositions: Float32Array, radius = 50): Float32Array {
  const flat = new Float32Array(basePositions.length);

  for (let i = 0; i < basePositions.length; i += 3) {
    const x = basePositions[i];
    const y = basePositions[i + 1];
    const z = basePositions[i + 2];

    // Spherical to planar projection (equirectangular-like)
    const len = Math.sqrt(x * x + y * y + z * z);
    const theta = Math.atan2(y, x);  // azimuth angle
    const phi = Math.acos(z / len);  // polar angle

    // Map to flat plane
    flat[i] = theta * radius * 0.8;  // x based on azimuth
    flat[i + 1] = (phi - Math.PI / 2) * radius * 0.8;  // y based on polar
    flat[i + 2] = 0;  // flat z
  }

  return flat;
}

/**
 * Create an exaggerated bumpy version
 */
function createExaggeratedPositions(basePositions: Float32Array): Float32Array {
  const exaggerated = new Float32Array(basePositions.length);

  for (let i = 0; i < basePositions.length; i += 3) {
    const x = basePositions[i];
    const y = basePositions[i + 1];
    const z = basePositions[i + 2];

    const len = Math.sqrt(x * x + y * y + z * z);
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;

    // Double the bumps
    const bump1 = Math.sin(x * 0.15) * Math.cos(y * 0.12) * 6;
    const bump2 = Math.sin(y * 0.18) * Math.cos(z * 0.14) * 4;
    const bump3 = Math.cos(z * 0.1) * Math.sin(x * 0.2) * 5;
    const totalBump = bump1 + bump2 + bump3;

    exaggerated[i] = nx * 50 + nx * totalBump;
    exaggerated[i + 1] = ny * 50 + ny * totalBump;
    exaggerated[i + 2] = nz * 50 + nz * totalBump;
  }

  return exaggerated;
}

export const morphing: Scenario = {
  id: 'morphing',
  title: 'Surface Morphing',
  description: 'GPU-accelerated morphing between surface representations using Three.js morphTargets. Demonstrates smooth transitions between folded, inflated, and flat views.',
  tags: ['morphing', 'animation', 'gpu', 'morphTargets', 'transitions'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building geometries...');
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

    // Build base geometry (bumpy sphere = "folded" brain analog)
    const { positions: basePositions, faces } = buildBumpySphere(50, 60);

    // Create morph targets
    const inflatedPositions = createInflatedPositions(basePositions, 50);
    const flatPositions = createFlatPositions(basePositions, 50);
    const exaggeratedPositions = createExaggeratedPositions(basePositions);

    // Create surface geometry
    const geom = new SurfaceGeometry(basePositions, faces, 'morph-demo');
    const vertexCount = geom.vertices.length / 3;

    ctx.status('Computing curvature...');
    const rawCurvature = computeMeanCurvature(geom);
    const curvatureData = normalizeCurvature(rawCurvature, 98);

    // Create morphable surface
    const surface = new MorphableSurface(geom, {
      baseColor: 0x888888,
      curvature: curvatureData,
      showCurvature: true,
      curvatureOptions: {
        brightness: 0.5,
        contrast: 0.4,
        smoothness: 1.0
      },
      morphTargets: [
        { name: 'inflated', positions: inflatedPositions },
        { name: 'flat', positions: flatPositions },
        { name: 'exaggerated', positions: exaggeratedPositions }
      ]
    });

    viewer.addSurface(surface);
    viewer.centerCamera();

    // State
    let currentTarget = 'base';
    let morphValue = 0;
    let isAnimating = false;

    // Build control panel
    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Morph Targets</h4>
        <p style="font-size: 11px; color: #888; margin-bottom: 8px;">
          Click to animate between surface representations
        </p>
        <div class="panel-controls" style="display: flex; flex-direction: column; gap: 4px;">
          <button id="morph-base" class="ghost active">Base (Folded)</button>
          <button id="morph-inflated" class="ghost">Inflated</button>
          <button id="morph-flat" class="ghost">Flat</button>
          <button id="morph-exaggerated" class="ghost">Exaggerated</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Morph Slider</h4>
        <p style="font-size: 11px; color: #888; margin-bottom: 8px;">
          Drag to blend between targets sequentially
        </p>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="range" id="morph-slider" min="0" max="3" step="0.01" value="0" style="flex: 1;">
          <span id="morph-val" style="min-width: 40px;">0.00</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #666; margin-top: 4px;">
          <span>Base</span>
          <span>Inflated</span>
          <span>Flat</span>
          <span>Exagg</span>
        </div>
      </div>
      <div class="panel-section">
        <h4>Animation Options</h4>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="min-width: 70px;">Duration:</label>
            <input type="range" id="anim-duration" min="100" max="2000" step="100" value="500" style="flex: 1;">
            <span id="duration-val" style="min-width: 50px;">500ms</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="min-width: 70px;">Easing:</label>
            <select id="easing-select" style="flex: 1;">
              <option value="linear">Linear</option>
              <option value="easeIn">Ease In</option>
              <option value="easeOut">Ease Out</option>
              <option value="easeInOut" selected>Ease In-Out</option>
              <option value="easeInCubic">Ease In Cubic</option>
              <option value="easeOutCubic">Ease Out Cubic</option>
              <option value="easeInOutCubic">Ease In-Out Cubic</option>
            </select>
          </div>
        </div>
      </div>
      <div class="panel-section">
        <h4>Individual Weights</h4>
        <p style="font-size: 11px; color: #888; margin-bottom: 8px;">
          Manually control each morph target weight
        </p>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="min-width: 80px; font-size: 11px;">Inflated:</label>
            <input type="range" id="weight-inflated" min="0" max="1" step="0.01" value="0" style="flex: 1;">
            <span id="weight-inflated-val" style="min-width: 30px; font-size: 11px;">0.00</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="min-width: 80px; font-size: 11px;">Flat:</label>
            <input type="range" id="weight-flat" min="0" max="1" step="0.01" value="0" style="flex: 1;">
            <span id="weight-flat-val" style="min-width: 30px; font-size: 11px;">0.00</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="min-width: 80px; font-size: 11px;">Exaggerated:</label>
            <input type="range" id="weight-exaggerated" min="0" max="1" step="0.01" value="0" style="flex: 1;">
            <span id="weight-exaggerated-val" style="min-width: 30px; font-size: 11px;">0.00</span>
          </div>
        </div>
      </div>
      <div class="panel-section">
        <h4>About Morphing</h4>
        <p style="font-size: 11px; color: #888;">
          Surface morphing uses GPU-accelerated morph targets
          (Three.js morphTargets) for smooth interpolation between
          different surface representations.
          <br><br>
          <strong>Use cases:</strong>
          <ul style="margin: 4px 0; padding-left: 16px;">
            <li>Folded → Inflated: Reveal buried cortex</li>
            <li>Inflated → Flat: 2D map projection</li>
            <li>Base → Exaggerated: Emphasize features</li>
          </ul>
          <br>
          Normals are automatically interpolated by the GPU
          for correct lighting during transitions.
        </p>
      </div>
    `;

    // Get animation options
    function getAnimationDuration(): number {
      const slider = ctx.panel.querySelector('#anim-duration') as HTMLInputElement;
      return parseInt(slider?.value ?? '500');
    }

    function getEasingFunction(): (t: number) => number {
      const select = ctx.panel.querySelector('#easing-select') as HTMLSelectElement;
      const easingName = select?.value ?? 'easeInOut';
      return (Easing as any)[easingName] ?? Easing.easeInOut;
    }

    // Update button active states
    function updateButtonStates(target: string) {
      const targets = ['base', 'inflated', 'flat', 'exaggerated'];
      targets.forEach(t => {
        const btn = ctx.panel.querySelector(`#morph-${t}`) as HTMLButtonElement;
        if (btn) btn.classList.toggle('active', t === target);
      });
      currentTarget = target;
    }

    // Update weight sliders to reflect current state
    function updateWeightSliders() {
      const weights = surface.getMorphWeights();
      for (const [name, weight] of Object.entries(weights)) {
        const slider = ctx.panel.querySelector(`#weight-${name}`) as HTMLInputElement;
        const val = ctx.panel.querySelector(`#weight-${name}-val`) as HTMLSpanElement;
        if (slider) slider.value = weight.toString();
        if (val) val.textContent = weight.toFixed(2);
      }
    }

    // Update morph slider to reflect current state
    function updateMorphSlider() {
      const slider = ctx.panel.querySelector('#morph-slider') as HTMLInputElement;
      const val = ctx.panel.querySelector('#morph-val') as HTMLSpanElement;
      morphValue = surface.getMorphValue();
      if (slider) slider.value = morphValue.toString();
      if (val) val.textContent = morphValue.toFixed(2);
    }

    // Target buttons
    const targets = ['base', 'inflated', 'flat', 'exaggerated'];
    targets.forEach(target => {
      ctx.panel.querySelector(`#morph-${target}`)?.addEventListener('click', async () => {
        if (isAnimating) return;
        isAnimating = true;
        ctx.status(`Morphing to ${target}...`);

        const duration = getAnimationDuration();
        const easing = getEasingFunction();

        if (target === 'base') {
          await surface.morphToBase({
            duration,
            easing,
            onProgress: () => {
              updateWeightSliders();
              updateMorphSlider();
            }
          });
        } else {
          await surface.morphTo(target, {
            duration,
            easing,
            onProgress: () => {
              updateWeightSliders();
              updateMorphSlider();
            }
          });
        }

        updateButtonStates(target);
        updateWeightSliders();
        updateMorphSlider();
        isAnimating = false;
        ctx.status(`Ready - ${target} view`);
      });
    });

    // Morph slider
    const morphSlider = ctx.panel.querySelector('#morph-slider') as HTMLInputElement;
    const morphVal = ctx.panel.querySelector('#morph-val') as HTMLSpanElement;
    morphSlider?.addEventListener('input', () => {
      morphValue = parseFloat(morphSlider.value);
      morphVal.textContent = morphValue.toFixed(2);
      surface.setMorphValue(morphValue);
      updateWeightSliders();

      // Update active button based on position
      if (morphValue < 0.5) {
        updateButtonStates('base');
      } else if (morphValue < 1.5) {
        updateButtonStates('inflated');
      } else if (morphValue < 2.5) {
        updateButtonStates('flat');
      } else {
        updateButtonStates('exaggerated');
      }
    });

    // Duration slider
    const durationSlider = ctx.panel.querySelector('#anim-duration') as HTMLInputElement;
    const durationVal = ctx.panel.querySelector('#duration-val') as HTMLSpanElement;
    durationSlider?.addEventListener('input', () => {
      durationVal.textContent = `${durationSlider.value}ms`;
    });

    // Individual weight sliders
    ['inflated', 'flat', 'exaggerated'].forEach(name => {
      const slider = ctx.panel.querySelector(`#weight-${name}`) as HTMLInputElement;
      const val = ctx.panel.querySelector(`#weight-${name}-val`) as HTMLSpanElement;
      slider?.addEventListener('input', () => {
        const weight = parseFloat(slider.value);
        val.textContent = weight.toFixed(2);
        surface.setMorphWeight(name, weight);
        updateMorphSlider();
      });
    });

    // Listen for morph events to keep UI in sync
    surface.on('morph:changed', () => {
      viewer.requestRender();
    });

    ctx.status(`Ready - ${vertexCount.toLocaleString()} vertices with 3 morph targets`);

    return () => {
      surface.dispose();
      cleanup();
      ctx.status('Idle');
    };
  }
};
