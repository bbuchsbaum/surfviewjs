import {
  AlignmentQAWorkspace,
  DataLayer,
  MultiLayerNeuroSurface,
  computeMeanCurvature,
  loadSurface,
  loadSurfaceFromFile,
  normalizeCurvature
} from '@src/index.js';
import type { AnatomicalView, NeuroSurfaceViewer, RestorationReport, SurfaceGeometry, ViewerStateV2 } from '@src/index.js';
import excerpt from '../excerpts/dataInOut.ts?raw';
import { action, actions, choice, fmt, note, readout, section, select, slider } from '../kit/controls';
import { MESH_URLS, loadMesh } from '../kit/data';
import { syntheticReference, alignmentTransform, TRANSFORMS } from '../kit/data-alignment';
import type { TransformName } from '../kit/data-alignment';
import { createFilmViewer } from '../kit/film';
import { addCortex, showCortexView } from '../kit/workflows-cortex';
import type { Scenario, ScenarioRunContext } from '../types';
import './dataInOut.css';

type Mode = 'load' | 'share' | 'alignment';

const MODES: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: 'load', label: 'Load' },
  { value: 'share', label: 'Save & share' },
  { value: 'alignment', label: 'Alignment QA' }
];

const SAMPLES = [
  { id: 'fsaverage5', label: 'fsaverage5 left pial', url: MESH_URLS.fsaverage5Left, hemisphere: 'left', format: 'GIFTI, gzip base64' },
  { id: 'tetrahedron', label: 'Tetrahedron', url: new URL('../../tests/data/tetrahedron.gii', import.meta.url).href, hemisphere: 'unknown', format: 'GIFTI' },
  { id: 'ascii', label: 'ASCII GIFTI', url: new URL('../../tests/data/ascii.surf.gii', import.meta.url).href, hemisphere: 'unknown', format: 'GIFTI, ASCII' }
] as const;

/**
 * What loadSurfaceFromFile detects: .gii (GIFTI, ASCII/base64/gzip arrays), .ply (ASCII PLY 1.0),
 * and FreeSurfer binary surfaces, recognised by name (lh.pial, rh.white, *.inflated, ...).
 */
const ACCEPT = '.gii,.ply,.pial,.white,.inflated,.sphere,.orig,.smoothwm,.fiducial,.surf';

const SHARE_VIEWS: ReadonlyArray<{ value: AnatomicalView; label: string }> = [
  { value: 'lateral', label: 'Lateral' },
  { value: 'medial', label: 'Medial' },
  { value: 'dorsal', label: 'Dorsal' },
  { value: 'ventral', label: 'Ventral' }
];

const COLORMAPS = [
  { value: 'coolwarm', label: 'Cool–warm' },
  { value: 'RdBu', label: 'Red–blue' },
  { value: 'viridis', label: 'Viridis' }
] as const;

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function chars(count: number): string {
  return `${count.toLocaleString('en-US')} chars`;
}

function describeRestore(report: RestorationReport): string {
  const surfaces = report.surfacesRestored.join(', ') || 'none';
  const issues = report.errors.length + report.warnings.length;
  return `${report.success ? 'Restored' : 'Not restored'}: surfaces ${surfaces}${issues ? `, ${issues} issue${issues === 1 ? '' : 's'}` : ''}`;
}

/** Show one loaded surface, with a curvature underlay when the mesh is large enough to have one. */
function showGeometry(viewer: NeuroSurfaceViewer, geometry: SurfaceGeometry) {
  for (const id of viewer.getSurfaceIds()) viewer.removeSurface(id);
  const vertexCount = geometry.vertices.length / 3;
  const curvature = vertexCount >= 500 ? (normalizeCurvature(computeMeanCurvature(geometry)) as Float32Array) : undefined;
  const surface = new MultiLayerNeuroSurface(geometry, {
    baseColor: 0xb7c0c8,
    ...(curvature ? { curvature, showCurvature: true, curvatureOptions: { brightness: 0.64, contrast: 0.42 } } : {})
  });
  viewer.addSurface(surface, 'loaded');
  viewer.setAnatomicalView('lateral', { layout: 'single', surfaceId: 'loaded', fit: true });
  viewer.fitToView({ padding: 0.08 });
}

function extentOf(vertices: Float32Array): string {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, vertices[i + a]!);
      max[a] = Math.max(max[a]!, vertices[i + a]!);
    }
  }
  return max.map((value, a) => fmt(value - min[a]!, 0)).join(' × ');
}

async function runLoad(ctx: ScenarioRunContext, panel: HTMLElement): Promise<() => void> {
  const { viewer, cleanup } = createFilmViewer(ctx.mount);
  const film = ctx.film;
  film.trackOrientation(viewer);
  const status = readout(panel, 'Loaded', 'data-load-status');

  const present = (geometry: SurfaceGeometry, source: string, format: string) => {
    showGeometry(viewer, geometry);
    const vertices = geometry.vertices.length / 3, faces = geometry.faces.length / 3;
    film.set('tl', 'source', 'Source', source);
    film.set('tl', 'format', 'Format', format);
    film.set('tr', 'hemisphere', 'Hemisphere', geometry.hemi ?? 'unknown');
    film.set('bl', 'extent', 'Extent', `${extentOf(geometry.vertices)} (file units)`);
    film.set('br', 'vertices', 'Vertices', vertices.toLocaleString('en-US'));
    film.set('br', 'faces', 'Faces', faces.toLocaleString('en-US'));
    status.set(`${source}: ${vertices.toLocaleString('en-US')} vertices, ${faces.toLocaleString('en-US')} faces`);
    ctx.status(`Loaded ${source}`);
  };
  const fail = (source: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    status.set(`${source} could not be loaded: ${message}`);
    status.element.classList.add('data-error');
    ctx.status(`Failed to load ${source}`);
  };

  const samples = section(panel, 'Bundled samples');
  const row = actions(samples);
  const loadSample = async (sample: (typeof SAMPLES)[number]) => {
    status.element.classList.remove('data-error');
    ctx.setBusy(true, `Loading ${sample.label}`);
    try {
      present(await loadSurface(sample.url, 'gifti', sample.hemisphere), sample.label, sample.format);
    } catch (error) {
      fail(sample.label, error);
    } finally {
      ctx.setBusy(false);
    }
  };
  for (const sample of SAMPLES) {
    action(row, { id: `data-sample-${sample.id}`, label: sample.label, onClick: () => loadSample(sample) });
  }

  const own = section(panel, 'Your file');
  note(own, 'GIFTI surfaces (.gii; ASCII, base64 or gzip-compressed arrays), ASCII PLY (.ply), or FreeSurfer binary surfaces named like lh.pial or rh.white. The file is read in this browser and not uploaded.');
  const field = document.createElement('div');
  field.className = 'control data-file';
  field.innerHTML = '<label for="data-file-input">Surface file</label>';
  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'data-file-input';
  input.accept = ACCEPT;
  field.append(input);
  own.append(field);
  const onFile = async () => {
    const file = input.files?.[0];
    if (!file) return;
    status.element.classList.remove('data-error');
    ctx.setBusy(true, `Reading ${file.name}`);
    try {
      const geometry = await loadSurfaceFromFile(file, 'auto');
      present(geometry, file.name, `${Math.round(file.size / 1024).toLocaleString('en-US')} KB, detected from name`);
    } catch (error) {
      fail(file.name, error);
    } finally {
      ctx.setBusy(false);
    }
  };
  input.addEventListener('change', onFile);

  await loadSample(SAMPLES[0]);
  return () => {
    input.removeEventListener('change', onFile);
    cleanup();
  };
}

async function runShare(ctx: ScenarioRunContext, panel: HTMLElement): Promise<() => void> {
  const { viewer, cleanup } = createFilmViewer(ctx.mount);
  const film = ctx.film;
  const scene = await addCortex(viewer, { window: 5, threshold: 1.65 });
  showCortexView(viewer, 'lateral');
  film.trackOrientation(viewer);
  film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L + R');
  film.set('tl', 'layer', 'Layer', 'Synthetic contrast (z)');

  const layerOf = () => viewer.getOrderedLayers('lh').find((layer): layer is DataLayer => layer instanceof DataLayer && layer.id === 'contrast');
  const update = (changes: Record<string, unknown>) => {
    for (const id of ['lh', 'rh']) viewer.updateLayer(id, 'contrast', changes);
  };

  const edit = section(panel, 'Change the scene');
  const views = choice(edit, {
    id: 'data-view',
    label: 'View',
    options: SHARE_VIEWS,
    value: 'lateral',
    print: { film, corner: 'tr', key: 'view', label: 'View' },
    onChange: view => showCortexView(viewer, view)
  });
  const colormap = select(edit, {
    id: 'data-colormap',
    label: 'Colormap',
    options: COLORMAPS,
    value: 'coolwarm',
    print: { film, corner: 'tr', key: 'colormap', label: 'Colormap' },
    onChange: next => update({ colorMap: next })
  });
  const threshold = slider(edit, {
    id: 'data-threshold',
    label: 'Hide values within (±z)',
    min: 0, max: 4, step: 0.05, value: 1.65,
    format: value => (value === 0 ? 'off' : `±${fmt(value, 2)}`),
    print: { film, corner: 'bl', key: 'threshold', label: 'Threshold' },
    onInput: value => update({ threshold: [-value, value] })
  });

  /** Bring the margin controls back in line with the viewer after a restore. */
  const syncControls = () => {
    const layer = layerOf();
    if (layer) {
      const name = layer.getColorMapName();
      if (COLORMAPS.some(entry => entry.value === name)) colormap.set(name as (typeof COLORMAPS)[number]['value']);
      threshold.set(Math.abs(layer.getThreshold()[1]));
    }
    const view = viewer.getCurrentAnatomicalView()?.view;
    if (view && SHARE_VIEWS.some(entry => entry.value === view)) views.set(view);
    else {
      for (const radio of views.element.querySelectorAll('input')) radio.checked = false;
      film.set('tr', 'view', 'View', 'restored camera');
    }
  };

  const snapshot = section(panel, 'Save and restore');
  const stateStatus = readout(snapshot, 'State', 'data-state-status');
  let saved: ViewerStateV2 | null = null;
  const snapshotRow = actions(snapshot);
  const restoreButton = action(snapshotRow, {
    id: 'data-restore',
    label: 'Restore saved',
    onClick: () => {
      if (!saved) return;
      const report = viewer.fromJSON(saved);
      syncControls();
      stateStatus.set(describeRestore(report));
      ctx.status(describeRestore(report));
    }
  });
  snapshotRow.prepend(action(snapshotRow, {
    id: 'data-save',
    label: 'Save state',
    kind: 'primary',
    onClick: () => {
      saved = viewer.toJSON();
      const json = JSON.stringify(saved);
      const layers = Object.values(saved.surfaces).reduce((count, surface) => count + surface.layers.length, 0);
      stateStatus.set(`Saved ${chars(json.length)}: camera, ${Object.keys(saved.surfaces).length} surfaces, ${layers} layers`);
      restoreButton.disabled = false;
    }
  }));
  restoreButton.disabled = true;
  note(snapshot, 'State is the camera, lighting, surface visibility, layer settings (colormap, range, threshold, opacity, order) and selection. It does not contain meshes or map values; restoring applies it to a viewer that already holds them.');

  const share = section(panel, 'Share link');
  const linkStatus = readout(share, 'Link', 'data-link-status');
  const linkField = document.createElement('input');
  linkField.type = 'text';
  linkField.readOnly = true;
  linkField.id = 'data-link';
  linkField.className = 'data-link';
  linkField.setAttribute('aria-label', 'Share link');
  share.append(linkField);
  const shareRow = actions(share);
  const base = () => {
    const url = new URL(location.href);
    url.hash = '';
    url.search = '?scenario=data&mode=share';
    return url.href;
  };
  action(shareRow, {
    id: 'data-make-link',
    label: 'Make share link',
    onClick: async () => {
      const link = viewer.toURL(base());
      linkField.value = link;
      let copied = false;
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch {
        linkField.select();
      }
      linkStatus.set(`${chars(link.length)}${copied ? ', copied' : ''}`);
    }
  });
  action(shareRow, {
    id: 'data-restore-link',
    label: 'Restore from link',
    onClick: () => {
      if (!linkField.value) return;
      // fromURL decodes a hash fragment, so pass the link's #svjs=… part.
      const report = viewer.fromURL(new URL(linkField.value).hash);
      syncControls();
      linkStatus.set(describeRestore(report));
    }
  });
  note(share, 'The link carries the state, compressed, in its #svjs= fragment. Opening it loads this chapter and restores the view.');

  const exportSection = section(panel, 'Scene export');
  const exportStatus = readout(exportSection, 'Exported', 'data-export-status');
  const exportRow = actions(exportSection);
  const sceneOptions = () => ({
    id: 'surfview-demo-scene',
    assets: [
      { id: 'lh-pial', type: 'surface' as const, uri: MESH_URLS.fsaverage5Left, format: 'gifti' },
      { id: 'rh-pial', type: 'surface' as const, uri: MESH_URLS.fsaverage5Right, format: 'gifti' }
    ],
    provenance: { generator: 'SurfView demo, Data in & out', synthetic: ['contrast'] }
  });
  action(exportRow, {
    id: 'data-export-json',
    label: 'Scene JSON',
    onClick: () => {
      const json = viewer.exportSceneJSON(sceneOptions());
      download(json, 'surfview-scene.json', 'application/vnd.surfview.scene+json');
      exportStatus.set(`surfview-scene.json, ${chars(json.length)}`);
    }
  });
  action(exportRow, {
    id: 'data-export-html',
    label: 'Static HTML',
    onClick: () => {
      const html = viewer.exportStaticHTML({ ...sceneOptions(), title: 'SurfView scene' });
      download(html, 'surfview-scene.html', 'text/html');
      exportStatus.set(`surfview-scene.html, ${chars(html.length)}`);
    }
  });
  note(exportSection, 'The manifest records the state above with provenance and asset references (here the two GIFTI meshes). The HTML shell embeds it and expects surfview.es.js beside it.');

  // Opened from a share link: restore the state carried in the fragment, then drop it.
  if (location.hash.startsWith('#svjs=')) {
    const report = viewer.fromURL();
    syncControls();
    linkStatus.set(`Opened from link. ${describeRestore(report)}`);
    history.replaceState(history.state, '', location.pathname + location.search);
  }

  ctx.perf(`${scene.vertexCount.toLocaleString('en-US')} vertices`);
  return cleanup;
}

async function runAlignment(ctx: ScenarioRunContext, panel: HTMLElement): Promise<() => void> {
  const film = ctx.film;
  film.trackOrientation(null);
  const pial = await loadMesh('fsaverage5Left');
  const reference = syntheticReference(pial.vertices);
  const host = document.createElement('div');
  host.className = 'data-alignment';
  host.dataset.visualQa = 'alignment-qa';
  ctx.mount.replaceChildren(host);
  const mark = getComputedStyle(document.documentElement).getPropertyValue('--mark').trim() || '#f2c230';
  const surfaces = [{ id: 'pial', kind: 'pial', vertices: pial.vertices, color: mark }];
  const dims = reference.volume.dims.join(' × ');
  film.set('tl', 'volume', 'Volume', `synthetic boldref, ${dims}`);
  film.set('tl', 'voxel', 'Voxel', `${reference.voxelSize} mm`);
  film.set('tr', 'surface', 'Surface', 'fsaverage5 left pial');

  const metrics = section(panel, 'Transform');
  const stateReadout = readout(metrics, 'Status', 'data-alignment-status');
  stateReadout.element.dataset.alignmentStatus = '';
  const oob = readout(metrics, 'Vertices outside volume');
  const distance = readout(metrics, 'Mean distance outside (voxels)');
  const dropout = readout(metrics, 'Vertices in signal dropout');
  const gradient = readout(metrics, 'Mean intensity gradient at vertices');

  let workspace: AlignmentQAWorkspace | null = null;
  const show = (name: TransformName) => {
    workspace?.dispose();
    const transform = alignmentTransform(name, reference.center);
    workspace = new AlignmentQAWorkspace(host, { volume: reference.volume, surfaces, transform });
    const report = workspace.getReport().metrics;
    const label = TRANSFORMS.find(entry => entry.value === name)!.label;
    stateReadout.set(`${name}: ${transform.id}`);
    oob.set(`${fmt(report.surfaceVoxelDistance.outOfBoundsFraction * 100, 1)} %`);
    distance.set(fmt(report.surfaceVoxelDistance.meanDistance, 2));
    dropout.set(`${fmt(report.dropoutOverlay.dropoutFraction * 100, 1)} %`);
    gradient.set(fmt(report.edgeAgreement.meanGradient, 3));
    film.set('tr', 'transform', 'Transform', label);
    ctx.status(`Alignment QA: ${label}`);
  };
  choice(metrics, {
    id: 'data-transform',
    label: 'Surface-to-volume transform',
    options: TRANSFORMS,
    value: 'aligned',
    onChange: show
  });
  // Put the transform choice first, above its readouts.
  metrics.insertBefore(metrics.lastElementChild!, metrics.children[1]!);
  note(metrics, 'The pial vertices are drawn in yellow over sagittal, coronal and axial slices through the volume centre, with a top-down view of every vertex. Dropout is signal at or below 0.2 of full scale.');
  show('aligned');
  return () => {
    workspace?.dispose();
    workspace = null;
  };
}

export const dataInOut: Scenario = {
  id: 'data',
  aliases: ['file-loading', 'stateSerialization', 'alignment-qa'],
  title: 'Data in & out',
  short: 'Data in & out',
  group: 'workflows',
  tags: ['GIFTI', 'PLY', 'FreeSurfer', 'file loading', 'state', 'share link', 'scene export', 'alignment QA'],
  summary:
    'Surfaces in, views out. Load reads a bundled GIFTI sample or a surface file of your own. Save & share stores and restores the viewer state, packs it into a share link, and exports a scene manifest or HTML shell. Alignment QA draws the fsaverage5 pial surface on slices of a reference volume under a chosen transform and reports the fit.',
  synthetic:
    'Save & share shows a constructed contrast (Gaussian effects at anatomical foci plus smooth noise). The Alignment QA volume is built from the pial mesh (blurred vertex density) with dropout placed at the orbitofrontal cortex and temporal pole; it is not an image.',
  excerpt,
  run: async ctx => {
    let mode: Mode = MODES.some(entry => entry.value === ctx.params.get('mode')) ? (ctx.params.get('mode') as Mode) : 'load';
    if (location.hash.startsWith('#svjs=')) mode = 'share';
    let cleanup: (() => void) | null = null;
    let revision = 0;

    const modes = section(ctx.panel);
    const body = document.createElement('div');
    body.className = 'data-mode-body';

    const show = async (next: Mode) => {
      const current = ++revision;
      mode = next;
      cleanup?.();
      cleanup = null;
      ctx.film.clear();
      ctx.mount.replaceChildren();
      body.replaceChildren();
      ctx.perf('');
      ctx.setBusy(true, next === 'alignment' ? 'Building the reference volume' : 'Loading');
      try {
        const run = next === 'load' ? runLoad : next === 'share' ? runShare : runAlignment;
        const dispose = await run(ctx, body);
        if (current !== revision) dispose();
        else cleanup = dispose;
      } finally {
        if (current === revision) ctx.setBusy(false);
      }
    };

    choice(modes, {
      id: 'data-mode',
      label: 'Mode',
      options: MODES,
      value: mode,
      onChange: next => { void show(next); }
    });
    ctx.panel.append(body);
    await show(mode);
    return () => {
      revision++;
      cleanup?.();
    };
  }
};
