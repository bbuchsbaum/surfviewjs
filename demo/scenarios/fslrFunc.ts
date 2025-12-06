import { gunzipSync, unzlibSync } from 'fflate';
import {
  DataLayer,
  MultiLayerNeuroSurface,
  loadSurface,
  type SurfaceGeometry
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

const surfaceUrl = new URL('../../tests/data/fs_LR.32k.L.inflated.surf.gii', import.meta.url).href;
const funcUrl = new URL('../../tests/data/gaussian_splat_demo.func.gii', import.meta.url).href;

function base64ToUint8(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toTypedArray(buffer: ArrayBuffer, dataType: string, littleEndian: boolean): Float32Array | Uint32Array | null {
  switch (dataType) {
    case 'NIFTI_TYPE_FLOAT32':
      return new Float32Array(buffer);
    case 'NIFTI_TYPE_INT32':
      return new Uint32Array(buffer);
    default:
      // Default to float32 when intent is scalar/shape
      return new Float32Array(buffer);
  }
}

function parseGiiDataArray(dataArray: Element): Float32Array | Uint32Array | null {
  const dataType = dataArray.getAttribute('DataType') || '';
  const encoding = dataArray.getAttribute('Encoding') || 'ASCII';
  const endian = dataArray.getAttribute('Endian') || 'LittleEndian';
  const data = dataArray.getElementsByTagName('Data')[0];
  if (!data || !data.textContent) return null;

  const text = data.textContent.trim();
  const littleEndian = endian !== 'BigEndian';

  if (encoding === 'ASCII') {
    const values = text.split(/\s+/).filter(Boolean);
    const parsed = values.map(parseFloat);
    return new Float32Array(parsed);
  }

  if (encoding === 'Base64Binary') {
    const buffer = base64ToUint8(text).buffer;
    return toTypedArray(buffer, dataType, littleEndian);
  }

  if (encoding === 'GZipBase64Binary') {
    const compressed = base64ToUint8(text);
    let unzipped: Uint8Array;
    try {
      unzipped = gunzipSync(compressed);
    } catch (gzipError) {
      unzipped = unzlibSync(compressed);
    }
    const buffer = new ArrayBuffer(unzipped.byteLength);
    new Uint8Array(buffer).set(unzipped);
    return toTypedArray(buffer, dataType, littleEndian);
  }

  return null;
}

async function loadMetric(url: string): Promise<Float32Array> {
  const text = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`Failed to fetch metric: ${r.status}`);
    return r.text();
  });
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const dataArrays = Array.from(doc.getElementsByTagName('DataArray'));
  const metricArray = dataArrays.find(da => {
    const intent = da.getAttribute('Intent') || '';
    return intent.toUpperCase().includes('INTENT_SHAPE') || intent.toUpperCase().includes('INTENT_SCALAR');
  });
  if (!metricArray) {
    throw new Error('No metric DataArray found in func.gii');
  }

  const parsed = parseGiiDataArray(metricArray);
  if (!parsed) throw new Error('Failed to parse metric array');

  // Clean NaNs and gather stats
  const data = new Float32Array(parsed.length);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < parsed.length; i++) {
    const v = (parsed as any)[i];
    const clean = Number.isFinite(v) ? v : 0;
    data[i] = clean;
    min = Math.min(min, clean);
    max = Math.max(max, clean);
  }
  return data;
}

function computeRange(data: Float32Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  return [min, max];
}

export const fslrFunc: Scenario = {
  id: 'fslr-func',
  title: 'FSLR 32k + func overlay',
  description: 'Loads fs_LR inflated L surface with Gaussian splat func overlay.',
  tags: ['gifti', 'fslr', 'data-layer'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.setBusy(true, 'Loading surface and metric');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      backgroundColor: 0x050912,
      ambientLightColor: 0x404040
    });

    const [geom, metric] = await Promise.all([
      loadSurface(surfaceUrl, 'gifti', 'left', 30000, true, 120),
      loadMetric(funcUrl)
    ]);

    const surface = new MultiLayerNeuroSurface(geom, {
      baseColor: 0xd9d9e3,
      useGPUCompositing: true
    });
    viewer.addSurface(surface, 'fslr');
    viewer.centerCamera();

    const range = computeRange(metric);
    const layer = new DataLayer('func', metric, null, 'Spectral', {
      range,
      opacity: 0.9,
      threshold: [0, 0], // show everything by default; neuro threshold applied via UI
      blendMode: 'normal'
    });
    viewer.addLayer('fslr', layer);
    ctx.setBusy(false);
    ctx.status(`Loaded metric (${metric.length} values)`);
    ctx.perf(`Range ${range[0].toFixed(2)} to ${range[1].toFixed(2)}`);

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>FSLR func overlay</h4>
        <p>Uses fs_LR.32k.L inflated surface with gaussian_splat_demo.func.gii as DataLayer.</p>
        <div class="panel-controls">
          <button id="toggle-gpu" class="ghost">Toggle GPU/CPU</button>
          <button id="recenter" class="ghost">Re-center</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Threshold</h4>
        <p>Neuro-style: hide values in [-t, t]; show |v| > t. Default shows all.</p>
        <input id="thresh-slider" type="range" min="0" max="${range[1].toFixed(3)}" step="${(range[1] / 200).toFixed(5)}" value="0" />
        <div class="stat">|v| &gt; <span id="thresh-label">0</span> shown</div>
      </div>
    `;

    ctx.panel.querySelector('#toggle-gpu')?.addEventListener('click', () => {
      const useGPU = surface.getCompositingMode() === 'CPU';
      surface.setCompositingMode(useGPU);
      viewer.requestRender();
      ctx.perf(`Mode ${surface.getCompositingMode()} | Range ${range[0].toFixed(2)}–${range[1].toFixed(2)}`);
    });

    ctx.panel.querySelector('#recenter')?.addEventListener('click', () => {
      viewer.centerCamera();
      ctx.status('Camera centered');
    });

    const slider = ctx.panel.querySelector('#thresh-slider') as HTMLInputElement | null;
    const label = ctx.panel.querySelector('#thresh-label');
    slider?.addEventListener('input', () => {
      const t = parseFloat(slider.value) || 0;
      const thresh: [number, number] = [-t, t];
      layer.setThreshold(thresh);
      surface.updateLayer('func', { threshold: thresh } as any);
      viewer.requestRender();
      if (label) label.textContent = t.toFixed(4);
      ctx.status(`Showing |value| > ${t.toFixed(4)}`);
    });

    return () => {
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
