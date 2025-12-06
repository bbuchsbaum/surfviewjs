import { MultiLayerNeuroSurface, loadSurface } from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

const leftSample = new URL('../../tests/data/fsaverage5-lh-pial.gii', import.meta.url).href;
const rightSample = new URL('../../tests/data/fsaverage5-rh-pial.gii', import.meta.url).href;

export const hemispheres: Scenario = {
  id: 'hemispheres',
  title: 'Hemisphere views',
  description: 'Loads two hemispheres, separation slider, preset viewpoints.',
  tags: ['hemisphere', 'camera', 'layout'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.setBusy(true, 'Loading GIFTI samples');
    ctx.status('Loading sample hemispheres');

    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: false,
      preset: 'presentation',
      backgroundColor: 0x0a0f1e
    });

    const [lhGeom, rhGeom] = await Promise.all([
      loadSurface(leftSample, 'gifti', 'left'),
      loadSurface(rightSample, 'gifti', 'right')
    ]);

    const leftSurface = new MultiLayerNeuroSurface(lhGeom, { baseColor: 0x9fb3ff });
    const rightSurface = new MultiLayerNeuroSurface(rhGeom, { baseColor: 0xffcf8b });
    leftSurface.hemisphere = 'left';
    rightSurface.hemisphere = 'right';

    viewer.addSurface(leftSurface, 'lh');
    viewer.addSurface(rightSurface, 'rh');
    viewer.centerCamera();
    viewer.separateHemispheres(24);
    viewer.setHemisphereView('lateral');

    ctx.setBusy(false);
    ctx.status('Hemispheres loaded');
    ctx.perf('Use view buttons to verify camera presets');

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Camera presets</h4>
        <div class="panel-controls">
          <button data-view="lateral" class="ghost">Lateral</button>
          <button data-view="medial" class="ghost">Medial</button>
          <button data-view="anterior" class="ghost">Anterior</button>
          <button data-view="posterior" class="ghost">Posterior</button>
          <button data-view="inferior" class="ghost">Inferior</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Spacing</h4>
        <p>Adjust hemisphere separation to check transforms.</p>
        <input id="hemi-gap" type="range" min="0" max="60" step="2" value="24" />
        <div class="stat">Current: <span id="gap-value">24</span> units</div>
      </div>
    `;

    ctx.panel.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = (btn as HTMLButtonElement).dataset.view as any;
        viewer.setHemisphereView(view);
        ctx.status(`View: ${view}`);
      });
    });

    const gapInput = ctx.panel.querySelector('#hemi-gap') as HTMLInputElement | null;
    const gapLabel = ctx.panel.querySelector('#gap-value');
    gapInput?.addEventListener('input', () => {
      const gap = parseFloat(gapInput.value);
      viewer.separateHemispheres(gap);
      if (gapLabel) gapLabel.textContent = gap.toString();
      ctx.perf(`Gap: ${gap.toFixed(0)} | Camera aligned`);
    });

    return () => {
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
