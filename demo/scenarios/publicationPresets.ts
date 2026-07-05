import {
  ColorMappedNeuroSurface,
  loadSurface,
  SurfaceGeometry
} from '@src/index.js';
import type { SurfViewStylePresetName } from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

const presetNames: SurfViewStylePresetName[] = [
  'paper-light',
  'talk-dark',
  'clinical-qc',
  'retinotopy',
  'glass-brain-surface'
];

const pialSurfaceUrl = new URL('../../tests/data/fsaverage5-lh-pial.gii', import.meta.url).href;

async function loadFigureGeometry(): Promise<SurfaceGeometry> {
  const geometry = await loadSurface(pialSurfaceUrl, 'gifti', 'left', 30000, false);
  return new SurfaceGeometry(
    normalizePositions(geometry.vertices, 118),
    geometry.faces,
    'publication-presets'
  );
}

function normalizePositions(vertices: Float32Array, targetSize: number): Float32Array {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    minX = Math.min(minX, vertices[i]);
    maxX = Math.max(maxX, vertices[i]);
    minY = Math.min(minY, vertices[i + 1]);
    maxY = Math.max(maxY, vertices[i + 1]);
    minZ = Math.min(minZ, vertices[i + 2]);
    maxZ = Math.max(maxZ, vertices[i + 2]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const scale = targetSize / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
  const out = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    out[i] = (vertices[i] - cx) * scale;
    out[i + 1] = (vertices[i + 1] - cy) * scale;
    out[i + 2] = (vertices[i + 2] - cz) * scale;
  }
  return out;
}

function makeActivation(vertices: Float32Array): Float32Array {
  const data = new Float32Array(vertices.length / 3);
  for (let i = 0; i < data.length; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];
    data[i] = Math.sin(x * 0.09) * 1.7 + Math.cos(y * 0.07) + Math.sin(z * 0.05) * 0.8;
  }
  return data;
}

function labelForPreset(name: SurfViewStylePresetName): string {
  return name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function hexColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

export const publicationPresets: Scenario = {
  id: 'publication-presets',
  title: 'Publication presets',
  description: 'Publication and talk styling presets with high-resolution figure export.',
  tags: ['presentation', 'export', 'aesthetics'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Loading figure surface');
    ctx.setBusy(true, 'Loading fsaverage5 surface');

    const stage = document.createElement('div');
    stage.className = 'figure-stage';
    stage.dataset.visualQa = 'publication-stage';
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    mount.style.position = 'absolute';
    mount.style.inset = '0';
    const legend = document.createElement('div');
    legend.className = 'figure-legend';
    legend.innerHTML = `
      <div class="figure-colorbar"></div>
      <div class="figure-legend-values">
        <span>+3 z</span>
        <span>0</span>
        <span>-3 z</span>
      </div>
    `;
    stage.append(mount, legend);
    ctx.mount.replaceChildren(stage);

    const { viewer, cleanup } = createViewer(mount, {
      preset: 'paper-light',
      showControls: false,
      hoverCrosshair: true
    });

    const geom = await loadFigureGeometry();
    const data = makeActivation(geom.vertices);
    const surface = new ColorMappedNeuroSurface(
      geom,
      null,
      data,
      'RdBu',
      {
        irange: [-3, 3],
        thresh: [-0.25, 0.25],
        alpha: 1,
        materialType: 'standard',
        roughness: 0.66
      }
    );

    viewer.addSurface(surface, 'figure');
    viewer.centerCamera();
    viewer.setViewpoint('lateral');
    viewer.setZoom(viewer.config.initialZoom * 0.72, { updateInitial: false });
    viewer.annotations.add('figure', 18, { label: 'V1' }, { active: true });
    viewer.applyStylePreset('paper-light');

    let activePreset: SurfViewStylePresetName = 'paper-light';

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Preset</h4>
        <div class="panel-controls" id="preset-buttons"></div>
      </div>
      <div class="panel-section">
        <h4>Figure Style</h4>
        <div class="preset-summary" data-preset-summary>
          <div class="preset-swatch">
            <div class="preset-swatch-color" data-preset-swatch></div>
            <div>
              <strong data-preset-name>Paper Light</strong>
              <span data-preset-material>standard | roughness 0.72</span>
            </div>
          </div>
          <div class="metric-grid">
            <div class="metric-chip">
              <span>Export</span>
              <strong data-export-spec>2400 x 1800</strong>
            </div>
            <div class="metric-chip">
              <span>DPI</span>
              <strong data-export-dpi>300</strong>
            </div>
          </div>
        </div>
      </div>
      <div class="panel-section">
        <h4>Figure</h4>
        <div class="panel-controls">
          <button id="export-png" class="ghost">Export PNG</button>
        </div>
        <p id="publication-status" data-publication-status>Ready</p>
      </div>
    `;

    const buttonHost = ctx.panel.querySelector('#preset-buttons');
    const status = ctx.panel.querySelector('#publication-status');
    const presetName = ctx.panel.querySelector('[data-preset-name]');
    const presetMaterial = ctx.panel.querySelector('[data-preset-material]');
    const presetSwatch = ctx.panel.querySelector('[data-preset-swatch]') as HTMLElement | null;
    const exportSpec = ctx.panel.querySelector('[data-export-spec]');
    const exportDpi = ctx.panel.querySelector('[data-export-dpi]');

    function applyPreset(name: SurfViewStylePresetName) {
      activePreset = name;
      const style = viewer.applyStylePreset(name);
      stage.style.background = style.background.css;
      if (presetName) presetName.textContent = style.label;
      if (presetMaterial) {
        presetMaterial.textContent = `${style.material.materialType} | roughness ${style.material.roughness.toFixed(2)}`;
      }
      if (presetSwatch) {
        presetSwatch.style.background = style.background.css;
        presetSwatch.style.borderColor = hexColor(style.material.baseColor as number);
      }
      if (exportSpec) exportSpec.textContent = `${style.figure.width} x ${style.figure.height}`;
      if (exportDpi) exportDpi.textContent = String(style.figure.dpi);
      buttonHost?.querySelectorAll('button').forEach(el => {
        el.classList.toggle('active', el.textContent === labelForPreset(name));
      });
      ctx.status(`Preset: ${labelForPreset(name)}`);
      if (status) status.textContent = labelForPreset(name);
    }

    presetNames.forEach(name => {
      const button = document.createElement('button');
      button.className = `ghost${name === activePreset ? ' active' : ''}`;
      button.textContent = labelForPreset(name);
      button.addEventListener('click', () => {
        applyPreset(name);
      });
      buttonHost?.appendChild(button);
    });
    applyPreset('paper-light');

    ctx.panel.querySelector('#export-png')?.addEventListener('click', () => {
      const dataUrl = viewer.exportPNG({
        preset: activePreset,
        width: 960,
        height: 720,
        colorbar: true,
        colorbarLabel: 'z',
        colorbarRange: [-3, 3],
        roiLabels: [{ text: 'V1', x: 0.62, y: 0.36, normalized: true }],
        scaleBar: true,
        scaleBarLabel: '20 mm',
        title: 'Subject 01'
      });
      if (status) status.textContent = `PNG ${dataUrl.length} chars`;
      ctx.perf(`PNG export ${Math.round(dataUrl.length / 1024)} KB`);
    });

    (window as any).__surfviewPublicationDemo = {
      viewer,
      exportPNG: () => viewer.exportPNG({
        preset: activePreset,
        width: 640,
        height: 480,
        colorbar: true,
        roiLabels: true,
        scaleBar: true
      })
    };

    ctx.status('Ready');
    if (status) status.textContent = 'Ready';
    ctx.setBusy(false);

    return () => {
      delete (window as any).__surfviewPublicationDemo;
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
