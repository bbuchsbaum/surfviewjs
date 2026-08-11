import {
  DataLayer,
  FlatMapView,
  LinkedBrainWorkspace,
  SurfaceSet,
  VariantSurface,
  loadSurface,
  roiToLabelGIFTI,
  roiToSVG
} from '@src/index.js';
import type { VertexROI } from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

const pialSurfaceUrl = new URL('../../tests/data/fsaverage5-lh-pial.gii', import.meta.url).href;

async function loadDemoSurface(): Promise<{ positions: Float32Array; faces: Uint32Array }> {
  const geometry = await loadSurface(pialSurfaceUrl, 'gifti', 'left', 30000, false);
  return {
    positions: normalizePositions(geometry.vertices, 118),
    faces: geometry.faces
  };
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

function inflate(positions: Float32Array, radius = 56): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const len = Math.max(1e-6, Math.hypot(x, y, z));
    out[i] = (x / len) * radius;
    out[i + 1] = (y / len) * radius;
    out[i + 2] = (z / len) * radius;
  }
  return out;
}

function flatten(positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    out[i] = y * 0.92 + x * 0.16;
    out[i + 1] = z * 1.05;
    out[i + 2] = 0;
  }
  return out;
}

function makeActivation(positions: Float32Array): Float32Array {
  const vertexCount = positions.length / 3;
  const data = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    data[i] =
      Math.sin(y * 0.105) * 1.45 +
      Math.cos(z * 0.13 + x * 0.018) * 1.25 +
      Math.sin((y + z) * 0.055) * 0.7;
  }
  return data;
}

export const linkedFlatmap: Scenario = {
  id: 'linked-flatmap',
  title: 'Linked 3D and flatmap',
  description: 'Folded cortical surface linked to a 2D flatmap through shared vertex identity.',
  tags: ['flatmap', 'linked-view', 'picking'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Loading linked cortical surface...');
    ctx.setBusy(true, 'Loading fsaverage5 surface');

    const layout = document.createElement('div');
    layout.dataset.visualQa = 'linked-flatmap';
    layout.className = 'demo-linked-layout';

    const viewerMount = document.createElement('div');
    const flatMount = document.createElement('div');
    const viewerLabel = document.createElement('div');
    const flatLabel = document.createElement('div');
    viewerMount.className = 'demo-linked-view';
    flatMount.className = 'demo-linked-flatmap';
    viewerLabel.className = 'demo-view-label';
    flatLabel.className = 'demo-view-label';
    viewerLabel.textContent = 'Folded 3D';
    flatLabel.textContent = 'Flatmap';
    viewerMount.style.minWidth = '0';
    flatMount.style.minWidth = '0';
    viewerMount.appendChild(viewerLabel);
    flatMount.appendChild(flatLabel);
    layout.append(viewerMount, flatMount);
    ctx.mount.replaceChildren(layout);

    const { viewer, cleanup } = createViewer(viewerMount, {
      hoverCrosshair: true,
      backgroundColor: 0x07101d,
      ambientLightColor: 0xb8c4d6,
      directionalLightIntensity: 1.45,
      rimStrength: 0.18
    });

    const { positions, faces } = await loadDemoSurface();
    const inflated = inflate(positions);
    const flat = flatten(positions);
    const vertexCount = positions.length / 3;
    const activation = makeActivation(positions);

    const surfaceSet = new SurfaceSet({
      hemi: 'left',
      faces,
      defaultVariant: 'folded',
      variants: {
        folded: positions,
        inflated,
        flat
      }
    });
    const surface = new VariantSurface(surfaceSet, {
      baseColor: 0x8a8f98,
      materialType: 'standard',
      roughness: 0.65
    });
    surface.addLayer(new DataLayer('activation', activation, null, 'RdBu', {
      range: [-3, 3],
      threshold: [-0.4, 0.4],
      opacity: 0.82
    }));
    viewer.addSurface(surface, 'lh');
    viewer.setViewpoint('lateral');
    viewer.setZoom(viewer.config.initialZoom * 0.68, { updateInitial: false });

    const flatmap = new FlatMapView(flatMount, {
      surfaceId: 'lh',
      vertices: flat,
      faces
    }, {
      width: flatMount.clientWidth || 420,
      height: flatMount.clientHeight || 420,
      padding: 22,
      background: '#0a101b',
      fillStyle: 'rgba(160, 172, 190, 0.14)',
      strokeStyle: 'rgba(226, 232, 240, 0.12)',
      hoverStyle: '#67e8f9',
      selectionStyle: '#facc15'
    });
    flatmap.canvas.dataset.visualQa = 'linked-flatmap-canvas';
    const workspace = new LinkedBrainWorkspace({ viewer, flatmap, surfaceId: 'lh' });

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Linked Vertex Identity</h4>
        <div class="metric-grid">
          <div class="metric-chip">
            <span>Vertices</span>
            <strong>${vertexCount}</strong>
          </div>
          <div class="metric-chip">
            <span>Selected</span>
            <strong id="lf-selected" data-linked-selected>none</strong>
          </div>
        </div>
        <p id="lf-status" data-linked-flatmap-status>Ready: ${vertexCount} linked vertices.</p>
      </div>
      <div class="panel-section">
        <div class="panel-controls">
          <button id="lf-folded" class="ghost active">Folded 3D</button>
          <button id="lf-inflated" class="ghost">Inflated 3D</button>
          <button id="lf-flat" class="ghost">Flat 3D</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>ROI Editing</h4>
        <div class="metric-grid">
          <div class="metric-chip">
            <span>ROI vertices</span>
            <strong id="roi-count" data-roi-count>0</strong>
          </div>
          <div class="metric-chip">
            <span>Format</span>
            <strong id="roi-format" data-roi-format>none</strong>
          </div>
        </div>
        <div class="panel-controls">
          <button id="roi-polygon" class="ghost">Draw Polygon</button>
          <button id="roi-lasso" class="ghost">Draw Lasso</button>
          <button id="roi-seed" class="ghost">Seed ROI</button>
          <button id="roi-svg" class="ghost">SVG</button>
          <button id="roi-label" class="ghost">Label GIFTI</button>
          <button id="roi-clear" class="ghost">Clear</button>
        </div>
        <p id="roi-status" data-roi-status>No ROI</p>
        <pre id="roi-export" data-roi-export class="demo-export-box"></pre>
      </div>
    `;

    const status = ctx.panel.querySelector('#lf-status');
    const selectedStatus = ctx.panel.querySelector('#lf-selected');
    const roiStatus = ctx.panel.querySelector('#roi-status');
    const roiCount = ctx.panel.querySelector('#roi-count');
    const roiFormat = ctx.panel.querySelector('#roi-format');
    const roiExport = ctx.panel.querySelector('#roi-export');
    let activeROI: VertexROI | null = null;

    function setROIStatus(message: string, count = activeROI?.vertexIndices.length ?? 0) {
      if (roiStatus) roiStatus.textContent = message;
      if (roiCount) roiCount.textContent = String(count);
    }

    function focusVertex(vertexIndex: number | null) {
      if (selectedStatus) selectedStatus.textContent = vertexIndex === null ? 'none' : String(vertexIndex);
      if (vertexIndex === null) return;
      flatmap.setSelection(vertexIndex, { emit: false });
      viewer.showCrosshair('lh', vertexIndex, {
        mode: 'selection',
        color: 0xfacc15,
        size: 2.4
      });
    }

    function setSurfaceVariant(name: 'folded' | 'inflated' | 'flat', label: string) {
      surface.setVariant(name, { animate: true });
      viewerLabel.textContent = label;
      ctx.panel.querySelectorAll('#lf-folded, #lf-inflated, #lf-flat').forEach(button => {
        button.classList.toggle('active', button.id === `lf-${name}`);
      });
    }

    flatmap.on('selection:changed', ({ vertexIndex }) => {
      if (selectedStatus) selectedStatus.textContent = vertexIndex === null ? 'none' : String(vertexIndex);
      if (status) status.textContent = vertexIndex === null
        ? 'No flatmap selection'
        : `Selected vertex ${vertexIndex}`;
    });
    flatmap.on('roi:created', ({ roi }) => {
      activeROI = roi;
      setROIStatus(`${roi.name}: ${roi.vertexIndices.length} vertices`, roi.vertexIndices.length);
      if (roiFormat) roiFormat.textContent = 'vertex set';
    });
    ctx.panel.querySelector('#lf-folded')?.addEventListener('click', () => setSurfaceVariant('folded', 'Folded 3D'));
    ctx.panel.querySelector('#lf-inflated')?.addEventListener('click', () => setSurfaceVariant('inflated', 'Inflated 3D'));
    ctx.panel.querySelector('#lf-flat')?.addEventListener('click', () => setSurfaceVariant('flat', 'Flat 3D'));
    ctx.panel.querySelector('#roi-polygon')?.addEventListener('click', () => {
      flatmap.startROIDrawing({
        mode: 'polygon',
        name: `ROI_${flatmap.rois.list().length + 1}`,
        color: '#ffd166',
        provenance: { sourceLayer: 'activation', sourceSurface: 'lh' }
      });
      setROIStatus('Polygon drawing active');
    });
    ctx.panel.querySelector('#roi-lasso')?.addEventListener('click', () => {
      flatmap.startROIDrawing({
        mode: 'lasso',
        name: `ROI_${flatmap.rois.list().length + 1}`,
        color: '#58c4ff',
        provenance: { sourceLayer: 'activation', sourceSurface: 'lh' }
      });
      setROIStatus('Lasso drawing active');
    });
    ctx.panel.querySelector('#roi-seed')?.addEventListener('click', () => {
      const roi = flatmap.createROIFromPolygon([
        { x: flatmap.canvas.width * 0.38, y: flatmap.canvas.height * 0.34 },
        { x: flatmap.canvas.width * 0.62, y: flatmap.canvas.height * 0.34 },
        { x: flatmap.canvas.width * 0.66, y: flatmap.canvas.height * 0.58 },
        { x: flatmap.canvas.width * 0.42, y: flatmap.canvas.height * 0.64 }
      ], {
        name: `ROI_${flatmap.rois.list().length + 1}`,
        color: '#ffd166',
        provenance: { sourceLayer: 'activation', sourceSurface: 'lh', tool: 'seed' }
      });
      if (roi) {
        activeROI = roi;
        setROIStatus(`${roi.name}: ${roi.vertexIndices.length} vertices`, roi.vertexIndices.length);
        const focus = roi.vertexIndices[Math.floor(roi.vertexIndices.length / 2)] ?? null;
        focusVertex(focus);
        if (status && focus !== null) status.textContent = `Selected vertex ${focus}`;
      }
    });
    ctx.panel.querySelector('#roi-svg')?.addEventListener('click', () => {
      if (!activeROI || !roiExport) return;
      roiExport.textContent = roiToSVG(activeROI, {
        width: flatmap.canvas.width,
        height: flatmap.canvas.height
      }).slice(0, 900);
      if (roiFormat) roiFormat.textContent = 'SVG';
    });
    ctx.panel.querySelector('#roi-label')?.addEventListener('click', () => {
      if (!activeROI || !roiExport) return;
      roiExport.textContent = roiToLabelGIFTI(activeROI, { vertexCount }).slice(0, 900);
      if (roiFormat) roiFormat.textContent = 'GIFTI';
    });
    ctx.panel.querySelector('#roi-clear')?.addEventListener('click', () => {
      flatmap.clearROIs();
      activeROI = null;
      if (roiExport) roiExport.textContent = '';
      setROIStatus('No ROI', 0);
      if (roiFormat) roiFormat.textContent = 'none';
      focusVertex(null);
    });

    ctx.status('Ready - linked 3D and flatmap');
    ctx.setBusy(false);

    return () => {
      workspace.dispose();
      flatmap.dispose();
      cleanup();
      ctx.status('Idle');
    };
  }
};
