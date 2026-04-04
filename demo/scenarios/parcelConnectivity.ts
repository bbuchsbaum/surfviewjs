import {
  ParcelSurface,
  SurfaceGeometry,
  THREE,
  type ParcelData
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

interface ParcelCoord {
  id: number;
  lat: number;
  lon: number;
  latNorm: number;
  lonNorm: number;
  network: string;
}

interface HeatmapState {
  hoveredParcel: number | null;
}

function makeSphere(detail = 72): SurfaceGeometry {
  const geo = new THREE.SphereGeometry(55, detail, detail);
  const vertices = new Float32Array(geo.attributes.position.array);
  const faces = new Uint32Array(geo.index?.array || []);
  return new SurfaceGeometry(vertices, faces, 'parcel-connectivity');
}

function buildSyntheticParcellation(
  vertices: Float32Array,
  latBins: number,
  lonBins: number
): { vertexLabels: Uint32Array; parcelCoords: ParcelCoord[] } {
  const V = vertices.length / 3;
  const labels = new Uint32Array(V);
  const parcelCoords: ParcelCoord[] = [];
  const networkNames = ['visual', 'somatomotor', 'attention', 'default'];

  for (let lat = 0; lat < latBins; lat++) {
    for (let lon = 0; lon < lonBins; lon++) {
      const id = lat * lonBins + lon + 1;
      const latNorm = (lat + 0.5) / latBins;
      const lonNorm = (lon + 0.5) / lonBins;
      parcelCoords.push({
        id,
        lat,
        lon,
        latNorm,
        lonNorm,
        network: networkNames[(lat + lon) % networkNames.length]
      });
    }
  }

  for (let i = 0; i < V; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];
    const r = Math.sqrt(x * x + y * y + z * z) || 1;

    const theta = Math.acos(Math.max(-1, Math.min(1, y / r)));
    let phi = Math.atan2(z, x);
    if (phi < 0) {
      phi += Math.PI * 2;
    }

    const lat = Math.min(latBins - 1, Math.floor((theta / Math.PI) * latBins));
    const lon = Math.min(lonBins - 1, Math.floor((phi / (Math.PI * 2)) * lonBins));
    labels[i] = lat * lonBins + lon + 1;
  }

  return { vertexLabels: labels, parcelCoords };
}

function makeParcelData(parcelCoords: ParcelCoord[]): ParcelData {
  return {
    schema_version: '1.0.0',
    atlas: {
      id: 'synthetic-sphere-grid',
      name: 'Synthetic Sphere Grid',
      n_parcels: parcelCoords.length,
      representation: 'surface',
      space: 'synthetic',
      confidence: 'approximate'
    },
    parcels: parcelCoords.map(parcel => ({
      id: parcel.id,
      label: `Parcel ${parcel.id}`,
      hemi: parcel.lonNorm < 0.5 ? 'left' : 'right',
      network: parcel.network,
      lat: parcel.lat,
      lon: parcel.lon
    }))
  };
}

function wrapDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 1 - raw);
}

function makeConnectivityMatrix(parcelCoords: ParcelCoord[]): number[][] {
  const n = parcelCoords.length;
  const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const a = parcelCoords[i];
      const b = parcelCoords[j];
      const dLat = Math.abs(a.latNorm - b.latNorm);
      const dLon = wrapDistance(a.lonNorm, b.lonNorm);
      const radial = Math.sqrt(dLat * dLat + dLon * dLon);
      const localSimilarity = Math.exp(-(radial * radial) / (2 * 0.23 * 0.23));
      const networkBoost = a.network === b.network ? 0.52 : -0.12;
      const oscillation = 0.18 * Math.cos((a.lonNorm - b.lonNorm) * Math.PI * 4);
      const anteriorPosterior = 0.12 * Math.sin((a.latNorm + b.latNorm) * Math.PI * 1.5);

      const value = Math.max(
        -1,
        Math.min(1, localSimilarity * 0.92 + networkBoost + oscillation + anteriorPosterior)
      );

      matrix[i][j] = value;
      matrix[j][i] = value;
    }
  }

  return matrix;
}

function getNetworkColor(network: string): number {
  switch (network) {
    case 'visual':
      return 0x2f6fed;
    case 'somatomotor':
      return 0xf97316;
    case 'attention':
      return 0x16a34a;
    case 'default':
      return 0x9333ea;
    default:
      return 0x6b7280;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function connectivityToCss(value: number): string {
  const v = clamp01((value + 1) / 2);
  const r = v >= 0.5 ? 255 : Math.round(v * 2 * 255);
  const b = v <= 0.5 ? 255 : Math.round((1 - v) * 2 * 255);
  const g = Math.round((1 - Math.abs(v - 0.5) * 2) * 245);
  return `rgb(${r}, ${g}, ${b})`;
}

export const parcelConnectivity: Scenario = {
  id: 'parcel-connectivity',
  title: 'Parcel Connectivity',
  description:
    'Synthetic parcel x parcel connectivity painted back onto the surface on hover, with thresholding, graded alpha, and click-to-lock.',
  tags: ['connectivity', 'parcellation', 'hover', 'matrix', 'parcel'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building synthetic parcellation and connectivity matrix');

    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      backgroundColor: 0xf4f7fb,
      preset: 'presentation',
      rimStrength: 0.08,
      ambientLightColor: 0xa8b0bb,
      directionalLightIntensity: 1.9,
      hoverCrosshair: true,
      hoverCrosshairColor: 0x0f172a
    });

    const geometry = makeSphere(72);
    const { vertexLabels, parcelCoords } = buildSyntheticParcellation(geometry.vertices, 8, 14);
    const parcelData = makeParcelData(parcelCoords);
    const matrix = makeConnectivityMatrix(parcelCoords);

    const surface = new ParcelSurface(geometry, {
      parcelData,
      vertexLabels,
      baseColor: 0xf6f8fb,
      useGPUCompositing: false
    });
    viewer.addSurface(surface, 'parcel-connectivity');

    surface.addParcelColorLayer(
      'parcel-networks',
      parcel => getNetworkColor(String(parcel.network)),
      { opacity: 0.16, order: 1 }
    );

    surface.addParcelOutlineLayer('parcel-outline', {
      color: 0x1e293b,
      width: 0.7,
      opacity: 0.14,
      order: 3
    });

    const connectivityLayer = surface.addParcelConnectivityLayer(
      'parcel-connectivity-overlay',
      matrix,
      'bwr',
      {
        range: [-1, 1],
        threshold: 0.18,
        alphaMode: 'constant',
        alphaRange: [0.92, 0.92],
        showSeedParcel: true,
        opacity: 1,
        order: 6
      }
    );

    viewer.centerCamera();

    let selectedParcel: number | null = null;
    let threshold = 0.18;
    let alphaMode: 'magnitude' | 'constant' = 'constant';
    let showSeedParcel = true;
    let cmapIndex = 0;
    const cmaps = ['bwr', 'coolwarm', 'spectral'];
    const heatmapState: HeatmapState = { hoveredParcel: null };

    const infoEl = document.createElement('div');
    infoEl.className = 'demo-callout';
    infoEl.style.position = 'absolute';
    infoEl.style.left = '16px';
    infoEl.style.bottom = '16px';
    infoEl.style.padding = '10px 12px';
    infoEl.style.background = 'rgba(6, 17, 29, 0.84)';
    infoEl.style.border = '1px solid rgba(148, 163, 184, 0.2)';
    infoEl.style.borderRadius = '10px';
    infoEl.style.color = '#e2e8f0';
    infoEl.style.fontSize = '13px';
    infoEl.style.maxWidth = '320px';
    mount.appendChild(infoEl);

    const matrixByParcelId = new Map<number, number>();
    for (let i = 0; i < parcelCoords.length; i++) {
      matrixByParcelId.set(parcelCoords[i].id, i);
    }

    const heatmapWrap = document.createElement('div');
    heatmapWrap.style.marginTop = '14px';
    heatmapWrap.style.border = '1px solid rgba(148, 163, 184, 0.14)';
    heatmapWrap.style.borderRadius = '12px';
    heatmapWrap.style.padding = '10px';
    heatmapWrap.style.background = 'rgba(15, 23, 42, 0.45)';

    const heatmapTitle = document.createElement('div');
    heatmapTitle.textContent = 'External Heatmap';
    heatmapTitle.style.fontSize = '12px';
    heatmapTitle.style.fontWeight = '700';
    heatmapTitle.style.letterSpacing = '0.04em';
    heatmapTitle.style.textTransform = 'uppercase';
    heatmapTitle.style.color = '#cbd5e1';
    heatmapTitle.style.marginBottom = '8px';

    const heatmapHint = document.createElement('div');
    heatmapHint.textContent = 'Hover cells to drive parcel hover. Click a cell to select that parcel.';
    heatmapHint.style.fontSize = '12px';
    heatmapHint.style.color = '#94a3b8';
    heatmapHint.style.marginBottom = '10px';
    heatmapHint.style.lineHeight = '1.35';

    const heatmapCanvas = document.createElement('canvas');
    heatmapCanvas.width = 252;
    heatmapCanvas.height = 252;
    heatmapCanvas.style.width = '252px';
    heatmapCanvas.style.height = '252px';
    heatmapCanvas.style.maxWidth = '100%';
    heatmapCanvas.style.display = 'block';
    heatmapCanvas.style.borderRadius = '10px';
    heatmapCanvas.style.cursor = 'crosshair';
    heatmapCanvas.style.background = '#020617';

    const heatmapLegend = document.createElement('div');
    heatmapLegend.style.marginTop = '8px';
    heatmapLegend.style.fontSize = '12px';
    heatmapLegend.style.color = '#cbd5e1';

    heatmapWrap.appendChild(heatmapTitle);
    heatmapWrap.appendChild(heatmapHint);
    heatmapWrap.appendChild(heatmapCanvas);
    heatmapWrap.appendChild(heatmapLegend);

    const updateInfo = (parcelId: number | null) => {
      if (parcelId === null) {
        infoEl.innerHTML = 'Hover a parcel to paint the surface by its connectivity row.<br>Click to lock a parcel.';
        ctx.status(`Synthetic parcels: ${parcelCoords.length}`);
        return;
      }

      const parcel = surface.getParcelRecord(parcelId);
      let bestTarget: number | null = null;
      let bestValue = -Infinity;
      for (const target of surface.getParcelData().parcels) {
        if (target.id === parcelId) {
          continue;
        }
        const value = connectivityLayer.getConnectivityValue(target.id, parcelId);
        if (value !== null && Math.abs(value) > bestValue) {
          bestValue = Math.abs(value);
          bestTarget = target.id;
        }
      }

      const targetValue = bestTarget !== null
        ? connectivityLayer.getConnectivityValue(bestTarget, parcelId)
        : null;
      const lockText = selectedParcel === null ? 'hover' : 'locked';

      infoEl.innerHTML = `
        <strong>Parcel ${parcelId}</strong> (${String(parcel?.network ?? 'unknown')})<br>
        mode: ${lockText}<br>
        strongest target: ${bestTarget ?? 'n/a'}${targetValue !== null ? ` (${targetValue.toFixed(2)})` : ''}
      `;
      ctx.status(`Parcel ${parcelId} | threshold ${threshold.toFixed(2)} | ${alphaMode} alpha`);
    };

    updateInfo(null);

    const redrawHeatmap = () => {
      const ctx2d = heatmapCanvas.getContext('2d');
      if (!ctx2d) {
        return;
      }

      const size = parcelCoords.length;
      const width = heatmapCanvas.width;
      const height = heatmapCanvas.height;
      const cell = Math.min(width / size, height / size);
      ctx2d.clearRect(0, 0, width, height);
      ctx2d.fillStyle = '#020617';
      ctx2d.fillRect(0, 0, width, height);

      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          ctx2d.fillStyle = connectivityToCss(matrix[row][col]);
          ctx2d.fillRect(col * cell, row * cell, Math.ceil(cell), Math.ceil(cell));
        }
      }

      const activeParcel = selectedParcel ?? heatmapState.hoveredParcel;
      if (activeParcel !== null) {
        const activeIndex = matrixByParcelId.get(activeParcel);
        if (activeIndex !== undefined) {
          ctx2d.save();
          ctx2d.strokeStyle = selectedParcel !== null ? '#f8fafc' : '#facc15';
          ctx2d.lineWidth = selectedParcel !== null ? 2 : 1.2;
          ctx2d.strokeRect(0, activeIndex * cell, width, cell);
          ctx2d.strokeRect(activeIndex * cell, 0, cell, height);
          ctx2d.restore();
        }
      }

      const focusLabel = activeParcel === null ? 'none' : `parcel ${activeParcel}`;
      const modeLabel = selectedParcel !== null
        ? 'selection locked'
        : heatmapState.hoveredParcel !== null
          ? 'hover sync'
          : 'idle';
      heatmapLegend.textContent = `Focus: ${focusLabel} | mode: ${modeLabel}`;
    };

    const setSeedParcel = (parcelId: number | null) => {
      connectivityLayer.setSeedParcel(parcelId);
      viewer.requestRender();
      updateInfo(parcelId);
      redrawHeatmap();
    };

    const hoverHandler = (event: { parcelId?: number | null }) => {
      heatmapState.hoveredParcel = selectedParcel === null ? (event.parcelId ?? null) : heatmapState.hoveredParcel;
      if (selectedParcel !== null) {
        redrawHeatmap();
        return;
      }
      setSeedParcel(event.parcelId ?? null);
    };

    const clickHandler = (event: { parcelId?: number | null }) => {
      const parcelId = event.parcelId ?? null;
      if (parcelId === null) {
        return;
      }
      if (selectedParcel === parcelId) {
        viewer.clearParcelSelection();
        ctx.perf('Unlocked seed parcel');
      } else {
        viewer.setParcelSelection('parcel-connectivity', parcelId);
        ctx.perf(`Locked parcel ${parcelId}`);
      }
    };

    const selectionHandler = (event: { parcelId: number | null; selected: boolean }) => {
      selectedParcel = event.selected ? event.parcelId : null;
      if (!event.selected) {
        heatmapState.hoveredParcel = null;
      }
      setSeedParcel(selectedParcel);
      if (!event.selected) {
        ctx.perf('Selection cleared');
      }
    };

    viewer.on('parcel:hover', hoverHandler as any);
    viewer.on('parcel:click', clickHandler as any);
    viewer.on('parcel:selected', selectionHandler as any);

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Connectivity Lens</h4>
        <p style="margin:0;color:#94a3b8;font-size:0.9em;">
          Hover parcels to paint their connectivity row. Click to lock and compare patterns.
        </p>
      </div>
      <div class="panel-section">
        <h4>Threshold</h4>
        <div class="panel-controls">
          <input id="sl-threshold" type="range" min="0" max="100" value="18" style="width:100%">
          <span id="lbl-threshold" style="font-size:0.85em;color:#94a3b8;">0.18</span>
        </div>
      </div>
      <div class="panel-section">
        <h4>Display</h4>
        <div class="panel-controls">
          <button id="btn-alpha" class="ghost">Alpha: thresholded</button>
          <button id="btn-cmap" class="ghost">Colormap: bwr</button>
          <button id="btn-seed" class="ghost">Hide seed: off</button>
          <button id="btn-random" class="ghost">Select random</button>
          <button id="btn-clear" class="primary">Clear lock</button>
        </div>
      </div>
    `;
    ctx.panel.appendChild(heatmapWrap);

    const parcelIdFromHeatmapEvent = (event: MouseEvent): number | null => {
      const rect = heatmapCanvas.getBoundingClientRect();
      const size = parcelCoords.length;
      const cell = Math.min(heatmapCanvas.width / size, heatmapCanvas.height / size);
      const x = ((event.clientX - rect.left) / rect.width) * heatmapCanvas.width;
      const y = ((event.clientY - rect.top) / rect.height) * heatmapCanvas.height;
      const row = Math.floor(y / cell);
      if (row < 0 || row >= size) {
        return null;
      }
      return parcelCoords[row]?.id ?? null;
    };

    heatmapCanvas.addEventListener('mousemove', (event) => {
      if (selectedParcel !== null) {
        return;
      }
      const parcelId = parcelIdFromHeatmapEvent(event);
      heatmapState.hoveredParcel = parcelId;
      redrawHeatmap();
      if (parcelId === null) {
        viewer.clearParcelHover();
      } else {
        viewer.setParcelHover('parcel-connectivity', parcelId, {
          screenX: event.clientX,
          screenY: event.clientY
        });
      }
    });

    heatmapCanvas.addEventListener('mouseleave', () => {
      if (selectedParcel !== null) {
        return;
      }
      heatmapState.hoveredParcel = null;
      redrawHeatmap();
      viewer.clearParcelHover();
    });

    heatmapCanvas.addEventListener('click', (event) => {
      const parcelId = parcelIdFromHeatmapEvent(event);
      if (parcelId === null) {
        return;
      }
      if (selectedParcel === parcelId) {
        viewer.clearParcelSelection();
      } else {
        viewer.setParcelSelection('parcel-connectivity', parcelId);
      }
    });

    redrawHeatmap();

    const thresholdSlider = ctx.panel.querySelector('#sl-threshold') as HTMLInputElement | null;
    const thresholdLabel = ctx.panel.querySelector('#lbl-threshold');
    thresholdSlider?.addEventListener('input', () => {
      threshold = Number(thresholdSlider.value) / 100;
      thresholdLabel!.textContent = threshold.toFixed(2);
      connectivityLayer.setThreshold(threshold);
      viewer.requestRender();
      updateInfo(connectivityLayer.getSeedParcelId());
    });

    ctx.panel.querySelector('#btn-alpha')?.addEventListener('click', (event) => {
      alphaMode = alphaMode === 'magnitude' ? 'constant' : 'magnitude';
      connectivityLayer.setAlphaMode(alphaMode);
      (event.currentTarget as HTMLButtonElement).textContent =
        alphaMode === 'constant' ? 'Alpha: thresholded' : 'Alpha: magnitude';
      viewer.requestRender();
    });

    ctx.panel.querySelector('#btn-cmap')?.addEventListener('click', (event) => {
      cmapIndex = (cmapIndex + 1) % cmaps.length;
      connectivityLayer.setColorMap(cmaps[cmapIndex]);
      (event.currentTarget as HTMLButtonElement).textContent = `Colormap: ${cmaps[cmapIndex]}`;
      viewer.requestRender();
    });

    ctx.panel.querySelector('#btn-seed')?.addEventListener('click', (event) => {
      showSeedParcel = !showSeedParcel;
      connectivityLayer.update({ showSeedParcel });
      (event.currentTarget as HTMLButtonElement).textContent = `Hide seed: ${showSeedParcel ? 'off' : 'on'}`;
      viewer.requestRender();
    });

    ctx.panel.querySelector('#btn-random')?.addEventListener('click', () => {
      const randomParcel = parcelCoords[Math.floor(Math.random() * parcelCoords.length)]?.id ?? null;
      if (randomParcel === null) {
        return;
      }
      viewer.setParcelSelection('parcel-connectivity', randomParcel);
      ctx.perf(`External select parcel ${randomParcel}`);
    });

    ctx.panel.querySelector('#btn-clear')?.addEventListener('click', () => {
      viewer.clearParcelSelection();
      ctx.perf('Cleared locked parcel');
    });

    return () => {
      viewer.off('parcel:hover', hoverHandler as any);
      viewer.off('parcel:click', clickHandler as any);
      viewer.off('parcel:selected', selectionHandler as any);
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
