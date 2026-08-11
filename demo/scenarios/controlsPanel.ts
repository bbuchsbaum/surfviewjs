import {
  DataLayer,
  loadSurface,
  MultiLayerNeuroSurface
} from '@src/index.js';
import { mountSurfViewControls } from '@src/controls-ui/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

const leftSample = new URL('../../tests/data/fsaverage5-lh-pial.gii', import.meta.url).href;
const rightSample = new URL('../../tests/data/fsaverage5-rh-pial.gii', import.meta.url).href;

function makeField(
  vertices: Float32Array,
  phase: number,
  scale: number
): Float32Array {
  const values = new Float32Array(vertices.length / 3);
  for (let index = 0; index < values.length; index += 1) {
    const x = vertices[index * 3] ?? 0;
    const y = vertices[index * 3 + 1] ?? 0;
    const z = vertices[index * 3 + 2] ?? 0;
    values[index] = scale * (
      Math.sin(x * 0.035 + phase) +
      Math.cos(y * 0.028 - phase) +
      Math.sin(z * 0.032 + phase * 0.5)
    ) / 3;
  }
  return values;
}

export const controlsPanel: Scenario = {
  id: 'controls-panel',
  title: 'First-party controls panel',
  description: 'Responsive scientific controls and figure export over a bilateral cortical scene.',
  tags: ['controls', 'accessibility', 'layers', 'camera', 'export'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.setBusy(true, 'Loading controls fixture');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      backgroundColor: 0x080c16,
      preset: 'presentation',
      rimStrength: 0.1
    });

    const [leftGeometry, rightGeometry] = await Promise.all([
      loadSurface(leftSample, 'gifti', 'left'),
      loadSurface(rightSample, 'gifti', 'right')
    ]);
    const left = new MultiLayerNeuroSurface(leftGeometry, { baseColor: 0xb8c0cc });
    const right = new MultiLayerNeuroSurface(rightGeometry, { baseColor: 0xb8c0cc });
    left.hemisphere = 'left';
    right.hemisphere = 'right';
    viewer.addSurface(left, 'lh');
    viewer.addSurface(right, 'rh');
    viewer.registerBilateralSurfaceGroup({
      id: 'cortex',
      leftSurfaceId: 'lh',
      rightSurfaceId: 'rh'
    });

    for (const [surfaceId, geometry, phase] of [
      ['lh', leftGeometry, 0.2],
      ['rh', rightGeometry, 0.8]
    ] as const) {
      viewer.addLayer(surfaceId, new DataLayer(
        'activation',
        makeField(geometry.vertices, phase, 4.5),
        null,
        'hot',
        {
          range: [-4.5, 4.5],
          threshold: [-1.2, 1.2],
          opacity: 0.9,
          presentation: { label: 'Activation', units: 'z' }
        }
      ));
      viewer.addLayer(surfaceId, new DataLayer(
        'variance',
        makeField(geometry.vertices, phase + 1.4, 1.8),
        null,
        'viridis',
        {
          range: [-1.8, 1.8],
          opacity: 0.62,
          presentation: { label: 'Variance', units: 'a.u.' }
        }
      ));
      viewer.addLayer(surfaceId, new DataLayer(
        'quality',
        makeField(geometry.vertices, phase + 2.7, 1),
        null,
        'plasma',
        {
          range: [-1, 1],
          opacity: 0.45,
          presentation: { label: 'Quality index' }
        }
      ));
    }

    viewer.setAnatomicalView('lateral', {
      layout: 'paired',
      groupId: 'cortex',
      fit: true,
      hemisphereGap: 12
    });

    ctx.panel.replaceChildren();
    ctx.panel.dataset.visualQa = 'controls-panel-host';
    ctx.panel.style.fontFamily = 'Georgia, serif';
    const fixtureTools = document.createElement('div');
    fixtureTools.className = 'panel-controls';
    fixtureTools.dataset.visualQa = 'controls-panel-fixtures';
    fixtureTools.innerHTML = `
      <button type="button" class="ghost" data-fixture-selection="vertex">
        Fixture: select vertex
      </button>
      <button type="button" class="ghost" data-fixture-selection="clear">
        Fixture: clear selection
      </button>
      <button type="button" class="ghost" data-fixture-state="one">
        Fixture: one layer
      </button>
      <button type="button" class="ghost" data-fixture-state="empty">
        Fixture: empty
      </button>
      <button type="button" class="ghost" data-fixture-external="opacity">
        Fixture: external opacity
      </button>
    `;
    ctx.panel.appendChild(fixtureTools);
    const controls = mountSurfViewControls(viewer, ctx.panel, {
      label: 'Cortical scene controls',
      theme: 'dark',
      density: 'comfortable',
      session: { focusedSurfaceId: 'lh', focusedLayerId: 'activation' }
    });
    controls.element.dataset.visualQa = 'controls-panel';
    const fixtureWindow = window as typeof window & {
      __surfviewControlsFixture?: {
        getLayerOpacity(surfaceId: string, layerId: string): number | null;
      };
    };
    fixtureWindow.__surfviewControlsFixture = {
      getLayerOpacity(surfaceId, layerId) {
        return viewer.getSurface(surfaceId)?.getLayer(layerId)?.opacity ?? null;
      }
    };

    fixtureTools.querySelector('[data-fixture-selection="vertex"]')
      ?.addEventListener('click', () => {
        viewer.setInspectionSelection({
          kind: 'vertex',
          surfaceId: 'lh',
          vertexIndex: 2
        });
        ctx.status('Controls fixture: selected vertex 2 on lh');
      });
    fixtureTools.querySelector('[data-fixture-selection="clear"]')
      ?.addEventListener('click', () => {
        viewer.clearInspectionSelection();
        ctx.status('Controls fixture: selection cleared');
      });

    fixtureTools.querySelector('[data-fixture-state="one"]')
      ?.addEventListener('click', () => {
        left.clearLayers();
        viewer.removeSurface('rh');
        ctx.status('Controls fixture: one surface with one base layer');
      });
    fixtureTools.querySelector('[data-fixture-state="empty"]')
      ?.addEventListener('click', () => {
        viewer.clearSurfaces();
        ctx.status('Controls fixture: empty scene');
      });
    fixtureTools.querySelector('[data-fixture-external="opacity"]')
      ?.addEventListener('click', () => {
        viewer.updateLayer('lh', 'variance', { opacity: 0.31 });
        ctx.status('Controls fixture: external variance opacity update');
      });

    ctx.setBusy(false);
    ctx.status('First-party controls ready');
    ctx.perf('View and layer commands use the headless control session');

    return () => {
      controls.dispose();
      delete fixtureWindow.__surfviewControlsFixture;
      delete ctx.panel.dataset.visualQa;
      ctx.panel.style.removeProperty('font-family');
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
