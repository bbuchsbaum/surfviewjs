import {
  MultiLayerNeuroSurface,
  SurfaceGeometry,
  TwoDataLayer,
  ColorMap2D,
  computeMeanCurvature,
  normalizeCurvature,
  THREE
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

/**
 * Build a "bumpy sphere" geometry that has actual curvature variation.
 */
function buildBumpySphere(radius = 50, subdivisions = 60): SurfaceGeometry {
  const geometry = new THREE.SphereGeometry(radius, subdivisions, subdivisions);
  const positions = geometry.attributes.position.array as Float32Array;

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

  return new SurfaceGeometry(vertices, indices, 'bumpy-sphere');
}

/**
 * Generate synthetic "effect size" data (centered around 0, can be positive or negative)
 */
function generateEffectData(vertexCount: number): Float32Array {
  const data = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    // Create patchy effect patterns
    const x = Math.sin(i * 0.008) * 2;
    const y = Math.cos(i * 0.012) * 2;
    // Effect size: -2 to +2 range with spatial variation
    data[i] = Math.sin(x * 3) * Math.cos(y * 2) * 2 + (Math.random() - 0.5) * 0.5;
  }
  return data;
}

/**
 * Generate synthetic "confidence/significance" data (0 to 1 range)
 */
function generateConfidenceData(vertexCount: number): Float32Array {
  const data = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    // Create confidence that's higher where effects are stronger
    const x = Math.sin(i * 0.008) * 2;
    const y = Math.cos(i * 0.012) * 2;
    const effectStrength = Math.abs(Math.sin(x * 3) * Math.cos(y * 2));
    // Confidence: higher for stronger effects, with some noise
    data[i] = Math.min(1, effectStrength * 0.8 + Math.random() * 0.3);
  }
  return data;
}

export const colormap2d: Scenario = {
  id: 'colormap2d',
  title: '2D Colormaps',
  description: 'Visualize relationships between two variables using 2D colormaps. Perfect for showing effect size vs. confidence, or any two correlated scalar fields.',
  tags: ['colormap', '2d', 'bivariate', 'confidence', 'layers'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building geometry...');
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

    const geom = buildBumpySphere(50, 60);
    const vertexCount = geom.vertices.length / 3;

    ctx.status('Computing curvature...');
    const rawCurvature = computeMeanCurvature(geom);
    const curvatureData = normalizeCurvature(rawCurvature, 98);

    // Create surface with curvature underlay
    const surface = new MultiLayerNeuroSurface(geom, {
      baseColor: 0x888888,
      curvature: curvatureData,
      showCurvature: true,
      curvatureOptions: {
        brightness: 0.5,
        contrast: 0.3,
        smoothness: 1.0
      }
    });

    viewer.addSurface(surface);
    viewer.centerCamera();

    // Generate synthetic data
    ctx.status('Generating effect and confidence data...');
    const effectData = generateEffectData(vertexCount);
    const confidenceData = generateConfidenceData(vertexCount);

    // State
    let currentPreset: string = 'confidence';
    let thresholdY = 0.3;
    let layer: TwoDataLayer | null = null;

    function createLayer() {
      // Remove existing layer if any
      if (layer) {
        surface.removeLayer('twodata');
      }

      // Create new 2D data layer
      layer = surface.addTwoDataLayer(
        'twodata',
        effectData,
        confidenceData,
        currentPreset as any,
        {
          rangeX: [-2, 2],
          rangeY: [0, 1],
          thresholdY: [0, thresholdY],
          opacity: 0.85
        }
      );

      ctx.status(`2D colormap: ${currentPreset}`);
    }

    createLayer();

    // Build control panel
    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>2D Colormap Preset</h4>
        <div class="panel-controls" style="display: flex; flex-direction: column; gap: 4px;">
          <button id="preset-confidence" class="ghost active">Confidence</button>
          <button id="preset-diverging" class="ghost">Diverging</button>
          <button id="preset-hot_cold" class="ghost">Hot/Cold</button>
          <button id="preset-magnitude_phase" class="ghost">Magnitude/Phase</button>
          <button id="preset-rgba_wheel" class="ghost">RGBA Wheel</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Confidence Threshold</h4>
        <p style="font-size: 11px; color: #888; margin-bottom: 8px;">
          Hide values with low confidence (Y &lt; threshold)
        </p>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="range" id="threshold-y" min="0" max="0.9" step="0.05" value="${thresholdY}" style="flex: 1;">
          <span id="threshold-val" style="min-width: 40px;">${thresholdY.toFixed(2)}</span>
        </div>
      </div>
      <div class="panel-section">
        <h4>Data Interpretation</h4>
        <p style="font-size: 11px; color: #888;">
          <strong>X axis (Effect Size):</strong> -2 to +2<br>
          Negative = decrease, Positive = increase
          <br><br>
          <strong>Y axis (Confidence):</strong> 0 to 1<br>
          Higher = more certain, Lower = uncertain
          <br><br>
          The 2D colormap maps both values simultaneously,
          allowing you to see relationships between effect
          magnitude and statistical confidence.
        </p>
      </div>
      <div class="panel-section">
        <h4>About 2D Colormaps</h4>
        <p style="font-size: 11px; color: #888;">
          Traditional 1D colormaps show a single variable.
          2D colormaps can represent <em>two</em> variables at once:
          <br><br>
          <strong>Confidence:</strong> X=value/hue, Y=saturation<br>
          <strong>Diverging:</strong> X=blue-white-red, Y=intensity<br>
          <strong>Hot/Cold:</strong> X=temperature, Y=brightness<br>
          <strong>Magnitude/Phase:</strong> X=brightness, Y=hue<br>
          <strong>RGBA Wheel:</strong> Polar coordinates to color
        </p>
      </div>
    `;

    // Preset buttons
    const presets = ['confidence', 'diverging', 'hot_cold', 'magnitude_phase', 'rgba_wheel'];
    presets.forEach(preset => {
      ctx.panel.querySelector(`#preset-${preset}`)?.addEventListener('click', () => {
        currentPreset = preset;
        // Update active state
        presets.forEach(p => {
          const btn = ctx.panel.querySelector(`#preset-${p}`) as HTMLButtonElement;
          if (btn) btn.classList.toggle('active', p === preset);
        });
        createLayer();
      });
    });

    // Threshold slider
    const thresholdSlider = ctx.panel.querySelector('#threshold-y') as HTMLInputElement;
    const thresholdVal = ctx.panel.querySelector('#threshold-val') as HTMLSpanElement;

    thresholdSlider?.addEventListener('input', () => {
      thresholdY = parseFloat(thresholdSlider.value);
      thresholdVal.textContent = thresholdY.toFixed(2);
      if (layer) {
        layer.setThresholdY([0, thresholdY]);
        surface.requestColorUpdate();
      }
    });

    ctx.status(`Ready - ${vertexCount.toLocaleString()} vertices with 2D colormap`);

    return () => {
      cleanup();
      ctx.status('Idle');
    };
  }
};
