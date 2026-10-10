import { DataLayer } from '@src/index.js';
import type { AnatomicalView, InspectionSelection } from '@src/index.js';
import { mountSurfViewControls } from '@src/controls-ui/index.js';
import type { SurfViewControlsFeature } from '@src/controls-ui/index.js';
import excerpt from '../excerpts/controls.ts?raw';
import { choice, fmt, section, toggle } from '../kit/controls';
import { smoothNoise } from '../kit/data';
import { createFilmViewer } from '../kit/film';
import { SYNTHETIC_CONTRAST_NOTE, addCortex, showCortexView } from '../kit/workflows-cortex';
import type { HemisphereId } from '../kit/workflows-cortex';
import type { Scenario } from '../types';
import './controls.css';

type Task = 'full' | 'view-and-layers' | 'view' | 'layers';

const TASK_FEATURES: Record<Task, readonly SurfViewControlsFeature[]> = {
  full: ['view', 'layers', 'layer-inspector', 'selection', 'figure'],
  'view-and-layers': ['view', 'layers'],
  view: ['view'],
  layers: ['layers', 'layer-inspector']
};

const TASKS: ReadonlyArray<{ value: Task; label: string }> = [
  { value: 'full', label: 'Full panel' },
  { value: 'view-and-layers', label: 'View + layers' },
  { value: 'view', label: 'View' },
  { value: 'layers', label: 'Layers' }
];

/** `?mode=product&task=view|layers` opens a task-focused panel (the links in the controls guide). */
function initialTask(params: URLSearchParams): Task {
  if (params.get('mode') !== 'product') return 'full';
  const task = params.get('task');
  return task === 'view' || task === 'layers' ? task : 'view-and-layers';
}

/** Split-half reliability in [0, 1]: smooth, higher over the contrast's foci. Synthetic. */
function reliability(vertices: Float32Array, contrast: Float32Array, seed: number): Float32Array {
  const noise = smoothNoise(vertices, seed, 0.18, 46);
  const values = new Float32Array(contrast.length);
  for (let v = 0; v < values.length; v++) {
    values[v] = Math.min(1, Math.max(0, 0.42 + 0.09 * Math.abs(contrast[v]!) + noise[v]!));
  }
  return values;
}

export const controls: Scenario = {
  id: 'controls',
  aliases: ['controls-panel', 'controls-gallery'],
  title: 'Controls panel',
  short: 'Controls',
  group: 'workflows',
  tags: ['controls', 'web component', 'accessibility', 'layers', 'selection', 'figure export'],
  summary:
    'The first-party <surfview-controls> panel, mounted with mountSurfViewControls over both fsaverage5 hemispheres: views, the ordered layer stack, a layer inspector (colormap, range, masking), the clicked vertex, and PNG export. Pick a task to narrow the panel to view or layer work. Click the cortex to select a vertex.',
  synthetic:
    `${SYNTHETIC_CONTRAST_NOTE} The reliability layer is smooth noise scaled by the contrast magnitude.`,
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fsaverage5 hemispheres');
    const { viewer, cleanup } = createFilmViewer(ctx.mount);
    const scene = await addCortex(viewer);
    for (const hemisphere of Object.values(scene.hemispheres)) {
      const values = reliability(hemisphere.geometry.vertices, hemisphere.contrast, hemisphere.id === 'lh' ? 31 : 32);
      // Under the contrast in the stack, hidden until switched on in the panel.
      viewer.addLayer(hemisphere.id, new DataLayer('reliability', values, null, 'viridis', {
        range: [0, 1],
        opacity: 0.7,
        visible: false,
        presentation: { label: 'Reliability', units: 'r', description: 'Synthetic split-half reliability' }
      }));
      const order = viewer.getOrderedLayers(hemisphere.id).map(layer => layer.id);
      viewer.moveLayer(hemisphere.id, 'reliability', order.indexOf('contrast'));
    }
    // Panel views arrive as anatomical-view:changed; `fitting` skips the re-pose's own events.
    let fitting = false;
    const showView = (view: AnatomicalView) => {
      fitting = true;
      try {
        showCortexView(viewer, view);
      } finally {
        fitting = false;
      }
    };
    showView('lateral');

    const film = ctx.film;
    film.trackOrientation(viewer);
    film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L + R');
    film.set('tl', 'vertices', 'Vertices', scene.vertexCount.toLocaleString('en-US'));

    let task = initialTask(ctx.params);
    const panelSection = section(ctx.panel, 'Panel');
    const host = document.createElement('div');
    host.className = 'controls-host';
    ctx.panel.append(host);

    const handle = mountSurfViewControls(viewer, host, {
      label: 'Cortical scene controls',
      theme: 'dark',
      density: 'comfortable',
      features: { include: TASK_FEATURES[task] },
      session: { focusedSurfaceId: 'lh', focusedLayerId: 'contrast' }
    });
    const element = handle.element;
    element.dataset.controlsTask = task;
    await element.updateComplete;

    choice(panelSection, {
      id: 'controls-task',
      label: 'Task',
      options: TASKS,
      value: task,
      print: { film, corner: 'tr', key: 'task', label: 'Panel' },
      onChange: next => {
        task = next;
        element.features = { include: TASK_FEATURES[next] };
        element.dataset.controlsTask = next;
        ctx.status(`Panel task: ${TASKS.find(entry => entry.value === next)!.label}`);
      }
    });
    choice(panelSection, {
      id: 'controls-density',
      label: 'Density',
      options: [
        { value: 'comfortable', label: 'Comfortable' },
        { value: 'compact', label: 'Compact' }
      ],
      value: 'comfortable',
      onChange: next => { element.density = next; }
    });
    toggle(panelSection, {
      id: 'controls-page-tokens',
      label: 'Style with page tokens (CSS custom properties)',
      checked: true,
      onChange: on => host.classList.toggle('controls-host-library', !on)
    });

    const printView = () => film.set('tr', 'view', 'View', viewer.getCurrentAnatomicalView()?.view ?? 'free');
    const onPanelView = (event: { view: AnatomicalView; layout: string }) => {
      if (!fitting && event.layout === 'paired') showView(event.view);
      printView();
    };
    viewer.on('anatomical-view:changed', onPanelView);
    viewer.on('camera:changed', printView);
    printView();

    const contrastLayer = () =>
      viewer.getOrderedLayers('lh').find((layer): layer is DataLayer => layer.id === 'contrast' && layer instanceof DataLayer);
    const printWindow = () => {
      const layer = contrastLayer();
      if (!layer) return;
      const [low, high] = layer.getRange();
      const [tLow, tHigh] = layer.getThreshold();
      film.set('bl', 'range', 'Range', `${fmt(low, 2)} to ${fmt(high, 2)} z`);
      film.set('bl', 'mask', 'Masked', tLow === tHigh ? 'off' : `${fmt(tLow, 2)} to ${fmt(tHigh, 2)}`);
      film.set('bl', 'colormap', 'Colormap', layer.getColorMapName());
    };
    const onLayer = (event: { surfaceId: string; layerId: string }) => {
      if (event.surfaceId === 'lh' && event.layerId === 'contrast') printWindow();
    };
    viewer.on('layer:updated', onLayer);
    printWindow();

    const onSelection = (event: { selection: InspectionSelection }) => {
      const selection = event.selection;
      if (selection.kind !== 'vertex' || !(selection.surfaceId in scene.hemispheres)) {
        film.set('br', 'vertex', 'Selected', 'none');
        film.set('br', 'value', 'Contrast', null);
        return;
      }
      const id = selection.surfaceId as HemisphereId;
      film.set('br', 'vertex', 'Selected', `${id.toUpperCase()} ${selection.vertexIndex}`);
      film.set('br', 'value', 'Contrast', `${fmt(scene.hemispheres[id].contrast[selection.vertexIndex]!)} z`);
    };
    viewer.on('selection:changed', onSelection);
    onSelection({ selection: viewer.getInspectionSelection() });

    ctx.perf(`${scene.vertexCount.toLocaleString('en-US')} vertices · 1 control session`);
    ctx.setBusy(false);
    return () => {
      viewer.off('anatomical-view:changed', onPanelView);
      viewer.off('camera:changed', printView);
      viewer.off('layer:updated', onLayer);
      viewer.off('selection:changed', onSelection);
      handle.dispose();
      cleanup();
    };
  }
};
