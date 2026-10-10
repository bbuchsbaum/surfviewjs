import {
  SURFVIEW_SCENE_SCHEMA,
  createSceneAsset,
  getStylePreset,
  listStylePresets,
  mountSurfView,
  REPORT_BRAIN_VIEWS
} from '@src/index.js';
import type {
  FigureBackground,
  FigureColorbarSource,
  FigureExportOptions,
  NeuroSurfaceViewer,
  ReportBrainView,
  SceneAssetDescriptor,
  SurfViewMountHandle,
  SurfViewSceneManifest,
  SurfViewStylePresetName
} from '@src/index.js';
import excerpt from '../excerpts/figures.ts?raw';
import { action, actions, choice, fmt, note, readout, section, select, toggle } from '../kit/controls';
import { FOCI, addFields, blobField, curvatureOf, loadBilateral, mirror, smoothNoise } from '../kit/data';
import { FILM_BASE, createFilmViewer } from '../kit/film';
import { SYNTHETIC_CONTRAST_NOTE, addCortex, syntheticContrast } from '../kit/workflows-cortex';
import type { Side } from '../kit/workflows-cortex';
import type { Scenario } from '../types';
import './figures.css';

type Mode = 'viewer' | 'report';
type BackgroundChoice = 'preset' | 'viewer' | 'transparent';
type SizeChoice = 'preset' | '1200x900' | '640x480';

const BRAIN_VIEW_LABELS: Record<ReportBrainView, string> = {
  oblique: 'Oblique',
  left: 'Left',
  right: 'Right',
  'left-medial': 'Left medial',
  'right-medial': 'Right medial',
  dorsal: 'Dorsal',
  ventral: 'Ventral',
  anterior: 'Anterior',
  posterior: 'Posterior'
};

/** The library's whole-brain views, oblique (the default pose) first. */
const BRAIN_VIEWS = ['oblique' as const, ...REPORT_BRAIN_VIEWS.filter(view => view !== 'oblique')]
  .map(value => ({ value, label: BRAIN_VIEW_LABELS[value] }));

const REPORT_MAPS = [
  { value: 'contrast', label: 'Visual–motor contrast' },
  { value: 'frontoparietal', label: 'Frontoparietal contrast' }
] as const;
type ReportMap = (typeof REPORT_MAPS)[number]['value'];

const FILENAME = 'surfview-figure.png';

/** A second synthetic map for the report scene: frontoparietal effects, so `oblique: 'auto'` has two maps to choose for. */
function frontoparietal(vertices: Float32Array, side: Side): Float32Array {
  const at = (point: readonly [number, number, number]) => (side === 'left' ? point : mirror(point));
  const signal = blobField(vertices, [
    { center: at(FOCI.intraparietal), amplitude: 5.0, sigma: 12 },
    { center: at(FOCI.inferiorFrontal), amplitude: side === 'left' ? 4.6 : 3.0, sigma: 12 },
    { center: at(FOCI.medialPrefrontal), amplitude: 3.2, sigma: 10 }
  ]);
  return addFields(signal, smoothNoise(vertices, side === 'left' ? 41 : 42, 0.8, 34));
}

/** Both fsaverage5 hemispheres and two synthetic maps as an inline `surfview.scene.v1` manifest. */
async function buildReportManifest(): Promise<SurfViewSceneManifest> {
  const { left, right } = await loadBilateral();
  const assets: Record<string, SceneAssetDescriptor> = {};
  const add = async (values: ArrayLike<number>, role: 'vertices' | 'faces' | 'curvature' | 'values', shape: number[]) => {
    const { descriptor } = await createSceneAsset(values, { role, dtype: role === 'faces' ? 'uint32' : 'float32', shape });
    assets[descriptor.id] = descriptor;
    return descriptor.id;
  };
  const geometries: SurfViewSceneManifest['geometries'] = {};
  const values: Record<ReportMap, Record<string, { values: string }>> = { contrast: {}, frontoparietal: {} };
  for (const [id, side, geometry, mesh] of [
    ['left', 'left', left, 'fsaverage5Left'],
    ['right', 'right', right, 'fsaverage5Right']
  ] as const) {
    const vertexCount = geometry.vertices.length / 3, faceCount = geometry.faces.length / 3;
    geometries[id] = {
      id, hemisphere: side, vertexCount, faceCount,
      vertices: await add(geometry.vertices, 'vertices', [vertexCount, 3]),
      faces: await add(geometry.faces, 'faces', [faceCount, 3]),
      curvature: await add(curvatureOf(mesh, geometry), 'curvature', [vertexCount])
    };
    values.contrast[id] = { values: await add(syntheticContrast(geometry.vertices, side), 'values', [vertexCount]) };
    values.frontoparietal[id] = { values: await add(frontoparietal(geometry.vertices, side), 'values', [vertexCount]) };
  }
  const layer = (id: ReportMap, label: string) => ({
    id, label, values: values[id], colorMap: 'surface-heat', limits: [-6, 6] as [number, number],
    threshold: [-2.3, 2.3] as [number, number], units: 'z', legend: { title: label, units: 'z', visible: true },
    provenance: { synthetic: true, generator: 'SurfView demo' }
  });
  return {
    schemaVersion: SURFVIEW_SCENE_SCHEMA,
    id: 'figures-report-scene',
    assets,
    geometries,
    layers: {
      // The colour key reads these labels; provenance records that both maps are synthetic.
      contrast: layer('contrast', REPORT_MAPS[0].label),
      frontoparietal: layer('frontoparietal', REPORT_MAPS[1].label)
    },
    selectedLayer: 'contrast',
    provenance: { generator: 'SurfView demo, Figures chapter', meshes: 'fsaverage5 pial' }
  };
}

function presetLabel(name: SurfViewStylePresetName): string {
  return getStylePreset(name).label;
}

/** Decoded size of a base64 PNG data URL in bytes. */
function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}

function describeKey(source: FigureColorbarSource | null): string {
  if (!source) return 'no scalar layer shown';
  const [low, high] = source.range;
  const mask = source.threshold ? `, masked ${fmt(source.threshold[0], 2)} to ${fmt(source.threshold[1], 2)}` : '';
  return `${source.label}: ${fmt(low, 1)} to ${fmt(high, 1)}${mask}`;
}

function textField(parent: HTMLElement, options: { id: string; label: string; value: string; onInput: (value: string) => void }) {
  const row = document.createElement('div');
  row.className = 'control control-text';
  const label = document.createElement('label');
  label.htmlFor = options.id;
  label.textContent = options.label;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = options.id;
  input.value = options.value;
  input.addEventListener('input', () => options.onInput(input.value));
  row.append(label, input);
  parent.append(row);
  return input;
}

export const figures: Scenario = {
  id: 'figures',
  aliases: ['publication-presets'],
  title: 'Figures',
  short: 'Figures',
  group: 'workflows',
  tags: ['figures', 'style presets', 'PNG export', 'colour key', 'report scenes'],
  summary:
    'Turn the scene into a figure. A style preset sets lighting, material and curvature contrast; Export PNG renders at the chosen size with a colour key read from the map (colormap, range, masked interval) and a title, downloads it, and previews it here. Report scene mounts the same brains with mountSurfView: one rigid brain, whole-brain views, an oblique angle chosen per map. No scale bar: under a perspective camera no single millimetre length holds.',
  synthetic: `${SYNTHETIC_CONTRAST_NOTE} The report scene’s frontoparietal map is built the same way.`,
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fsaverage5 hemispheres');
    const film = ctx.film;
    const state = {
      mode: 'viewer' as Mode,
      preset: 'paper-light' as SurfViewStylePresetName,
      background: 'preset' as BackgroundChoice,
      size: '1200x900' as SizeChoice,
      colorbar: true,
      title: 'Synthetic contrast',
      brainView: 'oblique' as ReportBrainView,
      autoOblique: true,
      reportMap: 'contrast' as ReportMap
    };
    let viewerCleanup: (() => void) | null = null;
    let viewer: NeuroSurfaceViewer | null = null;
    let report: SurfViewMountHandle | null = null;
    let manifest: Promise<SurfViewSceneManifest> | null = null;
    let revision = 0;

    // ── margin ────────────────────────────────────────────────────────────
    const modeSection = section(ctx.panel);
    choice(modeSection, {
      id: 'figures-mode',
      label: 'Figure source',
      options: [
        { value: 'viewer', label: 'Viewer' },
        { value: 'report', label: 'Report scene' }
      ],
      value: 'viewer',
      onChange: next => { void showMode(next); }
    });

    const styleSection = section(ctx.panel, 'Style preset');
    const presetChoice = choice(styleSection, {
      id: 'figures-preset',
      label: 'Preset',
      options: listStylePresets().map(name => ({ value: name, label: presetLabel(name) })),
      value: state.preset,
      print: { film, corner: 'tr', key: 'preset', label: 'Preset' },
      onChange: next => applyPreset(next)
    });
    const presetFacts = readout(styleSection, 'Preset figure', 'figures-preset-facts');

    const reportSection = section(ctx.panel, 'Report scene');
    reportSection.hidden = true;
    choice(reportSection, {
      id: 'figures-brain-view',
      label: 'Whole-brain view',
      options: BRAIN_VIEWS,
      value: state.brainView,
      print: { film, corner: 'tr', key: 'brain-view', label: 'View' },
      onChange: next => {
        state.brainView = next;
        report?.setBrainView(next);
      }
    });
    select(reportSection, {
      id: 'figures-report-map',
      label: 'Map',
      options: REPORT_MAPS,
      value: state.reportMap,
      print: { film, corner: 'bl', key: 'map', label: 'Map' },
      onChange: next => {
        state.reportMap = next;
        report?.selectLayer(next);
        // The data-driven oblique angle belongs to the displayed map: re-pose.
        if (state.brainView === 'oblique') report?.setBrainView('oblique');
        printKey();
      }
    });
    toggle(reportSection, {
      id: 'figures-auto-oblique',
      label: 'Choose the oblique angle from the map (oblique: auto)',
      checked: state.autoOblique,
      print: { film, corner: 'tr', key: 'oblique', label: 'Oblique auto' },
      onChange: on => {
        state.autoOblique = on;
        void showMode('report');
      }
    });

    const exportSection = section(ctx.panel, 'Export');
    choice(exportSection, {
      id: 'figures-background',
      label: 'Background',
      options: [
        { value: 'preset', label: 'Preset colour' },
        { value: 'viewer', label: 'Viewer' },
        { value: 'transparent', label: 'Transparent' }
      ],
      value: state.background,
      onChange: next => { state.background = next; }
    });
    select(exportSection, {
      id: 'figures-size',
      label: 'Size',
      options: [
        { value: 'preset', label: 'Preset size' },
        { value: '1200x900', label: '1200 × 900 px' },
        { value: '640x480', label: '640 × 480 px' }
      ],
      value: state.size,
      onChange: next => { state.size = next; }
    });
    toggle(exportSection, {
      id: 'figures-colorbar',
      label: 'Colour key from the map',
      checked: state.colorbar,
      onChange: on => { state.colorbar = on; }
    });
    const keyReadout = readout(exportSection, 'Key describes', 'figures-key');
    textField(exportSection, {
      id: 'figures-title',
      label: 'Title',
      value: state.title,
      onInput: value => { state.title = value; }
    });
    const row = actions(exportSection);
    const exportButton = action(row, { id: 'figures-export', label: 'Export PNG', kind: 'primary', onClick: () => exportFigure() });
    const status = readout(exportSection, 'Figure', 'figures-status');
    status.element.dataset.publicationStatus = '';
    const preview = document.createElement('img');
    preview.className = 'figure-preview';
    preview.alt = 'Preview of the exported PNG';
    preview.hidden = true;
    exportSection.append(preview);
    note(exportSection, 'The PNG is rendered at full size off screen; the live viewer keeps the film base so the figure background is chosen here.');

    // ── scene ─────────────────────────────────────────────────────────────
    function activePresetName(): SurfViewStylePresetName {
      return state.mode === 'report' ? 'report' : state.preset;
    }

    function printPresetFacts() {
      const figure = getStylePreset(activePresetName()).figure;
      presetFacts.set(`${figure.width} × ${figure.height} px, ${figure.dpi} dpi${figure.transparent ? ', transparent' : ''}`);
    }

    function printKey() {
      const source = state.mode === 'report'
        ? report?.viewer?.getFigureColorbarSource(state.reportMap) ?? null
        : viewer?.getFigureColorbarSource('contrast') ?? null;
      keyReadout.set(describeKey(source));
      film.set('bl', 'key', 'Key', source ? `${fmt(source.range[0], 1)} to ${fmt(source.range[1], 1)}` : '—');
      film.set('bl', 'mask', 'Masked', source?.threshold ? `±${fmt(source.threshold[1], 2)}` : 'none');
    }

    function applyPreset(name: SurfViewStylePresetName) {
      state.preset = name;
      if (!viewer) return;
      const style = viewer.applyStylePreset(name);
      // Presets do not recolour existing layers; apply the preset's diverging colormap explicitly.
      for (const id of ['lh', 'rh']) viewer.updateLayer(id, 'contrast', { colorMap: style.colormaps.diverging });
      // Keep the live film base; the figure background is an export option.
      viewer.setFigureBackground(FILM_BASE);
      film.set('tr', 'colormap', 'Colormap', style.colormaps.diverging);
      printPresetFacts();
      printKey();
      status.set(style.label);
      ctx.status(`Preset: ${style.label}`);
    }

    function teardown() {
      viewer?.off('layer:updated', printKey);
      viewerCleanup?.();
      viewerCleanup = null;
      viewer = null;
      report?.dispose();
      report = null;
      ctx.mount.replaceChildren();
    }

    async function showViewerMode(current: number) {
      const created = createFilmViewer(ctx.mount);
      viewerCleanup = created.cleanup;
      viewer = created.viewer;
      await addCortex(viewer, { window: 5, threshold: 1.65 });
      if (current !== revision) return;
      viewer.setAnatomicalView('lateral', { layout: 'paired', groupId: 'cortex', fit: true });
      viewer.fitToView({ padding: 0.06 });
      film.trackOrientation(viewer);
      film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L + R');
      film.set('tl', 'source', 'Source', 'NeuroSurfaceViewer');
      film.set('tr', 'brain-view', 'View', 'lateral, paired');
      film.set('tr', 'oblique', 'Oblique auto', null);
      film.set('bl', 'map', 'Map', 'Synthetic contrast');
      viewer.on('layer:updated', printKey);
      applyPreset(state.preset);
    }

    async function showReportMode(current: number) {
      manifest ??= buildReportManifest();
      const scene = await manifest;
      if (current !== revision) return;
      const host = document.createElement('div');
      host.className = 'figure-report';
      ctx.mount.replaceChildren(host);
      report = mountSurfView(host, scene, {
        lazy: false,
        controls: false,
        preset: 'report',
        layout: 'anatomical',
        initialBrainView: state.brainView,
        oblique: state.autoOblique ? 'auto' : undefined,
        hemisphereGap: 6,
        bilateralGroup: { id: 'cortex', leftSurfaceId: 'left', rightSurfaceId: 'right' },
        onError: error => ctx.status(`Report scene failed: ${error.message}`)
      });
      report.selectLayer(state.reportMap);
      await report.ready;
      if (current !== revision) return;
      // Keep the live film base under the report preset; the export chooses its background.
      report.viewer?.setFigureBackground(FILM_BASE);
      film.trackOrientation(null);
      film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L + R');
      film.set('tl', 'source', 'Source', 'mountSurfView, anatomical');
      film.set('tr', 'preset', 'Preset', 'Report');
      film.set('tr', 'colormap', 'Colormap', 'surface-heat');
      film.set('tr', 'brain-view', 'View', BRAIN_VIEWS.find(view => view.value === state.brainView)!.label);
      film.set('tr', 'oblique', 'Oblique auto', state.autoOblique ? 'ON' : 'OFF');
      film.set('bl', 'map', 'Map', REPORT_MAPS.find(map => map.value === state.reportMap)!.label);
      printPresetFacts();
      printKey();
    }

    async function showMode(mode: Mode) {
      const current = ++revision;
      state.mode = mode;
      styleSection.hidden = mode !== 'viewer';
      reportSection.hidden = mode !== 'report';
      exportButton.disabled = true;
      ctx.setBusy(true, mode === 'report' ? 'Mounting report scene' : 'Loading fsaverage5 hemispheres');
      teardown();
      try {
        if (mode === 'report') await showReportMode(current);
        else await showViewerMode(current);
      } finally {
        if (current === revision) {
          exportButton.disabled = false;
          status.set('Ready');
          ctx.status(mode === 'report' ? 'Report scene ready' : `Preset: ${presetLabel(state.preset)}`);
          ctx.setBusy(false);
        }
      }
    }

    function exportFigure() {
      const target = state.mode === 'report' ? report : viewer;
      if (!target) return;
      const style = getStylePreset(activePresetName());
      const [width, height] = state.size === 'preset'
        ? [style.figure.width, style.figure.height]
        : state.size.split('x').map(Number) as [number, number];
      const background: FigureBackground = state.background === 'preset' ? style.background.clearColor : state.background;
      const options: FigureExportOptions = {
        preset: style.name,
        width,
        height,
        background,
        colorbar: state.colorbar,
        colorbarLayer: state.mode === 'report' ? state.reportMap : 'contrast',
        roiLabels: false,
        scaleBar: false,
        downloadFilename: FILENAME,
        ...(state.title.trim() ? { title: state.title.trim() } : {})
      };
      const started = performance.now();
      const dataUrl = target.exportPNG(options);
      const elapsed = performance.now() - started;
      const kb = dataUrlBytes(dataUrl) / 1024;
      preview.src = dataUrl;
      preview.hidden = false;
      preview.dataset.width = String(width);
      preview.dataset.height = String(height);
      status.set(`PNG ${width} × ${height} px, ${fmt(kb, 0)} KB, saved as ${FILENAME}`);
      film.set('br', 'export', 'Exported', `${width} × ${height} px`);
      film.set('br', 'bytes', 'Size', `${fmt(kb, 0)} KB`);
      ctx.perf(`PNG export ${fmt(elapsed, 0)} ms`);
    }

    await showMode('viewer');
    presetChoice.set(state.preset);
    return () => {
      revision++;
      teardown();
    };
  }
};
