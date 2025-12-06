import {
  ColorMappedNeuroSurface,
  SurfaceGeometry,
  loadSurface,
  loadSurfaceFromFile
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

const tetraPath = new URL('../../tests/data/tetrahedron.gii', import.meta.url).href;
const asciiPath = new URL('../../tests/data/ascii.surf.gii', import.meta.url).href;

function buildDataFromZ(vertices: Float32Array): Float32Array {
  const data = new Float32Array(vertices.length / 3);
  for (let i = 0; i < data.length; i++) {
    data[i] = vertices[i * 3 + 2] * 2;
  }
  return data;
}

async function showSurface(
  viewer: any,
  geom: SurfaceGeometry,
  label: string,
  ctx: ScenarioRunContext
) {
  viewer.getSurfaceIds().forEach((id: string) => viewer.removeSurface(id));
  const data = buildDataFromZ(geom.vertices);
  const surface = new ColorMappedNeuroSurface(geom, null, data, 'coolwarm', {
    alpha: 0.95,
    flatShading: true,
    materialType: 'standard',
    roughness: 0.6,
    metalness: 0.1
  });
  viewer.addSurface(surface, label);
  viewer.centerCamera();
  ctx.status(`Loaded ${label} (${geom.vertices.length / 3} vertices)`);
}

export const fileLoading: Scenario = {
  id: 'file-loading',
  title: 'File + sample loading',
  description: 'Load local GIFTI/PLY files or baked samples, verify parsing and rendering.',
  tags: ['io', 'gifti', 'files'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.setBusy(true, 'Spinning up viewer');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      backgroundColor: 0x0b1222
    });
    ctx.setBusy(false);
    ctx.status('Ready to load');

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Sample surfaces</h4>
        <div class="panel-controls">
          <button data-sample="tetra" class="ghost">Tetrahedron</button>
          <button data-sample="ascii" class="ghost">fsaverage (ascii)</button>
        </div>
        <div class="linkish">Uses fixtures in tests/data</div>
      </div>
      <div class="panel-section">
        <h4>Load your own</h4>
        <p>Accepts .gii, .ply, or FreeSurfer surface files.</p>
        <input id="file-input" type="file" accept=".gii,.ply" />
        <div class="stat" id="file-status">No file chosen</div>
      </div>
    `;

    const sampleButtons = ctx.panel.querySelectorAll('[data-sample]');
    sampleButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const sample = (btn as HTMLElement).dataset.sample;
        ctx.setBusy(true, 'Loading sample');
        try {
          const geom =
            sample === 'tetra'
              ? await loadSurface(tetraPath, 'gifti', 'unknown', 20000, true, 50)
              : await loadSurface(asciiPath, 'gifti', 'left', 20000, true, 80);
          await showSurface(viewer, geom, sample || 'sample', ctx);
          ctx.perf(`Vertices: ${geom.vertices.length / 3} | Faces: ${geom.faces.length / 3}`);
        } catch (err) {
          console.error(err);
          ctx.status('Failed to load sample');
        } finally {
          ctx.setBusy(false);
        }
      });
    });

    const fileInput = ctx.panel.querySelector('#file-input') as HTMLInputElement | null;
    const fileStatus = ctx.panel.querySelector('#file-status');

    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (fileStatus) {
        fileStatus.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
      }
      ctx.setBusy(true, 'Reading file');
      try {
        const geom = await loadSurfaceFromFile(file, 'auto', 'unknown', true, 90);
        await showSurface(viewer, geom, file.name, ctx);
        ctx.perf(`Vertices: ${geom.vertices.length / 3} | Faces: ${geom.faces.length / 3}`);
      } catch (err) {
        console.error(err);
        ctx.status('Failed to load file');
      } finally {
        ctx.setBusy(false);
      }
    });

    return () => {
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
