import { quantitativeFlatmapMode } from '../kit/quantitative-flatmap';
import { addSurfaceMeasurements } from '../kit/surface-geometry';
import {
  DataLayer,
  Easing,
  FlatMapView,
  LinkedBrainWorkspace,
  curvatureToGrayscale,
  MorphableSurface,
  MultiLayerNeuroSurface,
  SurfaceSet,
  VariantSurface,
  roiToLabelGIFTI,
  roiToSVG
} from '@src/index.js';
import type { AnatomicalView, NeuroSurfaceViewer, SurfaceGeometry, VertexHoverEvent, VertexROI } from '@src/index.js';
import anatomyExcerpt from '../excerpts/anatomy.ts?raw';
import flatmapExcerpt from '../../examples/quantitative-flatmap.ts?raw';
import { inflateMesh, projectFlat } from '../kit/anatomy-geometry';
import { action, actions, choice, fmt, note, readout, section, select, slider, toggle } from '../kit/controls';
import { CURVATURE_UNDERLAY, DEPTH_UNDERLAY, curvatureOf, loadBilateral, loadMesh, sulcalDepthOf } from '../kit/data';
import type { MeshName } from '../kit/data';
import { createFilmViewer } from '../kit/film';
import type { FilmOverlay } from '../kit/film';
import type { Scenario, ScenarioRunContext } from '../types';
import './anatomy.css';

const excerpt = `${anatomyExcerpt}\n\n${flatmapExcerpt}`;

type Mode = 'views' | 'clip' | 'morph' | 'flatmap';
type SurfaceId = 'lh' | 'rh';
type Axis = 'x' | 'y' | 'z';

const MODES: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: 'views', label: 'Views' },
  { value: 'clip', label: 'Clip' },
  { value: 'morph', label: 'Inflate' },
  { value: 'flatmap', label: 'Flat map' }
];

const VIEWS: ReadonlyArray<{ value: AnatomicalView; label: string }> = [
  { value: 'lateral', label: 'Lateral' },
  { value: 'medial', label: 'Medial' },
  { value: 'dorsal', label: 'Dorsal' },
  { value: 'ventral', label: 'Ventral' },
  { value: 'anterior', label: 'Anterior' },
  { value: 'posterior', label: 'Posterior' }
];

/** Chinagraph yellow (--mark): the user's ROIs and pinned selection. Ink-high for the cursor. */
const MARK = '#f2c230';
const CURSOR = 0xedf2f5;
/** Folded surfaces: crisp mean-curvature underlay. */
const SURFACE_STYLE = { showCurvature: true, curvatureOptions: CURVATURE_UNDERLAY } as const;
/** Inflating surfaces: sulcal depth from the folded mesh, which survives inflation. */
const INFLATED_STYLE = { showCurvature: true, curvatureOptions: DEPTH_UNDERLAY } as const;
const INFLATE_ITERATIONS = 30;
const VERY_INFLATE_ITERATIONS = 160;

/** Smoothed targets are expensive enough to keep between mode switches. */
const inflatedCache = new Map<string, Float32Array>();
function inflated(name: MeshName, geometry: SurfaceGeometry, iterations: number): Float32Array {
  const key = `${name}:${iterations}`;
  let result = inflatedCache.get(key);
  if (!result) {
    result = inflateMesh(geometry.vertices, geometry.faces, iterations);
    inflatedCache.set(key, result);
  }
  return result;
}

interface ModeContext {
  ctx: ScenarioRunContext;
  film: FilmOverlay;
  panel: HTMLElement;
  isCurrent: () => boolean;
}

type ModeCleanup = () => void;

function hoverPrinter(film: FilmOverlay, natives: Partial<Record<SurfaceId, SurfaceGeometry>>) {
  const print = (event: Pick<VertexHoverEvent, 'surfaceId' | 'vertexIndex'>) => {
    const id = event.surfaceId as SurfaceId | null;
    const geometry = id ? natives[id] : undefined;
    if (!id || !geometry || event.vertexIndex === null) {
      film.set('br', 'vertex', 'Vertex', '—');
      film.set('br', 'ras', 'RAS', '—');
      return;
    }
    const v = event.vertexIndex * 3;
    film.set('br', 'vertex', 'Vertex', `${id.toUpperCase()} ${event.vertexIndex}`);
    film.set('br', 'ras', 'RAS', [0, 1, 2].map(axis => fmt(geometry.vertices[v + axis]!, 1)).join(' '));
  };
  print({ surfaceId: null, vertexIndex: null });
  return print;
}

function addCortex(viewer: NeuroSurfaceViewer, left: SurfaceGeometry, right: SurfaceGeometry) {
  const surfaces = {} as Record<SurfaceId, MultiLayerNeuroSurface>;
  for (const [id, geometry, hemisphere, mesh] of [
    ['lh', left, 'left', 'fsaverage5Left'],
    ['rh', right, 'right', 'fsaverage5Right']
  ] as const) {
    const surface = new MultiLayerNeuroSurface(geometry, { ...SURFACE_STYLE, curvature: curvatureOf(mesh, geometry) });
    surface.hemisphere = hemisphere;
    viewer.addSurface(surface, id);
    surfaces[id] = surface;
  }
  viewer.registerBilateralSurfaceGroup({ id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' });
  return surfaces;
}

function pairedView(viewer: NeuroSurfaceViewer, view: AnatomicalView) {
  viewer.setAnatomicalView(view, { layout: 'paired', groupId: 'cortex', fit: true });
  viewer.fitToView({ padding: 0.05 });
}

// ───────────────────────────── Views ─────────────────────────────

async function viewsMode({ ctx, film, panel, isCurrent }: ModeContext): Promise<ModeCleanup | null> {
  const { left, right } = await loadBilateral();
  if (!isCurrent()) return null;
  const { viewer, cleanup } = createFilmViewer(ctx.mount);
  const surfaces = addCortex(viewer, left, right);
  const state: { view: AnatomicalView; layout: 'pair' | 'left' | 'right'; gap: number } = { view: 'lateral', layout: 'pair', gap: 0 };

  const apply = () => {
    const medialPair = state.layout === 'pair' && state.view === 'medial';
    surfaces.lh.setVisible(state.layout !== 'right');
    surfaces.rh.setVisible(state.layout !== 'left' && !medialPair);
    viewer.separateHemispheres(state.layout === 'pair' ? state.gap : 0);
    if (state.layout === 'pair') {
      viewer.setAnatomicalView(state.view, { layout: 'paired', groupId: 'cortex', fit: true });
    } else {
      viewer.setAnatomicalView(state.view, { layout: 'single', surfaceId: state.layout === 'left' ? 'lh' : 'rh', fit: true });
    }
    viewer.fitToView({ padding: 0.05 });
    film.set('tr', 'hidden', 'Hidden', medialPair ? 'RH, in front of the medial wall' : null);
  };

  film.trackOrientation(viewer);
  film.set('tl', 'surface', 'Surface', 'fsaverage5 pial');
  film.set('tl', 'vertices', 'Vertices', ((left.vertices.length + right.vertices.length) / 3).toLocaleString('en-US'));

  const view = section(panel, 'View');
  choice(view, {
    id: 'anatomy-view',
    label: 'Anatomical view',
    options: VIEWS,
    value: state.view,
    print: { film, corner: 'tr', key: 'view', label: 'View' },
    onChange: next => {
      state.view = next;
      apply();
      ctx.status(`View: ${next}`);
    }
  });
  choice(view, {
    id: 'anatomy-layout',
    label: 'Hemispheres',
    options: [
      { value: 'pair', label: 'Both' },
      { value: 'left', label: 'Left' },
      { value: 'right', label: 'Right' }
    ] as const,
    value: state.layout,
    print: { film, corner: 'tr', key: 'layout', label: 'Shown' },
    onChange: next => {
      state.layout = next;
      gap.input.disabled = next !== 'pair';
      apply();
      ctx.status(`Hemispheres: ${next}`);
    }
  });
  const gap = slider(view, {
    id: 'hemi-gap',
    label: 'Hemisphere gap (mm)',
    min: 0, max: 60, step: 2, value: state.gap,
    format: value => (value === 0 ? 'anatomical' : `${value} mm`),
    print: { film, corner: 'bl', key: 'gap', label: 'Gap' },
    onInput: value => {
      state.gap = value;
      apply();
      ctx.perf(`Gap ${value} mm`);
    }
  });
  note(view, 'A medial view of both hemispheres hides the right one, which would stand in front of the left medial wall.');
  const row = actions(view);
  action(row, { label: 'Fit to view', onClick: () => { viewer.fitToView({ padding: 0.05 }); } });

  const print = hoverPrinter(film, { lh: left, rh: right });
  viewer.on('vertex:hover', print);
  apply();
  return () => {
    viewer.off('vertex:hover', print);
    cleanup();
  };
}

// ───────────────────────────── Clip ─────────────────────────────

const AXES: ReadonlyArray<{ axis: Axis; name: string; below: string; above: string }> = [
  { axis: 'x', name: 'Sagittal plane', below: 'left of', above: 'right of' },
  { axis: 'y', name: 'Coronal plane', below: 'behind', above: 'in front of' },
  { axis: 'z', name: 'Axial plane', below: 'below', above: 'above' }
];

async function clipMode({ ctx, film, panel, isCurrent }: ModeContext): Promise<ModeCleanup | null> {
  const { left, right } = await loadBilateral();
  if (!isCurrent()) return null;
  const { viewer, cleanup } = createFilmViewer(ctx.mount);
  const surfaces = addCortex(viewer, left, right);
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const geometry of [left, right]) {
    for (let i = 0; i < geometry.vertices.length; i++) {
      const axis = i % 3;
      bounds.min[axis] = Math.min(bounds.min[axis]!, geometry.vertices[i]!);
      bounds.max[axis] = Math.max(bounds.max[axis]!, geometry.vertices[i]!);
    }
  }
  const planes: Record<Axis, { enabled: boolean; offset: number; flip: boolean }> = {
    x: { enabled: false, offset: 0, flip: false },
    y: { enabled: false, offset: 0, flip: false },
    z: { enabled: false, offset: 0, flip: false }
  };

  film.trackOrientation(viewer);
  film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L + R');

  const describe = (axis: Axis) => {
    const plane = planes[axis];
    const entry = AXES.find(item => item.axis === axis)!;
    return `keeps ${plane.flip ? entry.below : entry.above} ${axis} = ${fmt(plane.offset, 0)}`;
  };
  const printPlanes = () => {
    const active = AXES.filter(({ axis }) => planes[axis].enabled);
    film.set('bl', 'planes', 'Planes', active.length === 0 ? 'none' : String(active.length));
    for (const { axis } of AXES) {
      film.set('bl', `plane-${axis}`, axis.toUpperCase(), planes[axis].enabled ? describe(axis) : null);
    }
  };
  const applyPlane = (axis: Axis) => {
    const plane = planes[axis];
    for (const surface of Object.values(surfaces)) {
      if (plane.enabled) surface.setClipPlane(axis, plane.offset, true, plane.flip);
      else surface.disableClipPlane(axis);
    }
    printPlanes();
    ctx.status(plane.enabled ? `Clip ${axis.toUpperCase()}: ${describe(axis)}` : `Clip ${axis.toUpperCase()}: off`);
  };

  const view = section(panel, 'View');
  const viewChoice = choice(view, {
    id: 'clip-view',
    label: 'Anatomical view',
    options: VIEWS,
    value: 'lateral',
    print: { film, corner: 'tr', key: 'view', label: 'View' },
    onChange: next => pairedView(viewer, next)
  });

  const handles = {} as Record<Axis, { enable: ReturnType<typeof toggle>; offset: ReturnType<typeof slider>; flip: ReturnType<typeof toggle> }>;
  for (const { axis, name, below } of AXES) {
    const group = section(panel, `${name} (${axis})`);
    const lo = Math.floor(bounds.min[AXES.findIndex(item => item.axis === axis)]!);
    const hi = Math.ceil(bounds.max[AXES.findIndex(item => item.axis === axis)]!);
    const enable = toggle(group, {
      id: `clip-${axis}-enable`,
      label: `Cut along ${axis}`,
      checked: false,
      onChange: enabled => {
        planes[axis].enabled = enabled;
        offset.input.disabled = !enabled;
        flip.input.disabled = !enabled;
        applyPlane(axis);
      }
    });
    const offset = slider(group, {
      id: `clip-${axis}-offset`,
      label: `Plane position (${axis}, mm)`,
      min: lo, max: hi, step: 1, value: 0,
      format: value => fmt(value, 0),
      onInput: value => {
        planes[axis].offset = value;
        if (planes[axis].enabled) applyPlane(axis);
      }
    });
    const flip = toggle(group, {
      id: `clip-${axis}-flip`,
      label: `Keep the part ${below} the plane`,
      checked: false,
      onChange: flipped => {
        planes[axis].flip = flipped;
        if (planes[axis].enabled) applyPlane(axis);
      }
    });
    offset.input.disabled = true;
    flip.input.disabled = true;
    handles[axis] = { enable, offset, flip };
  }

  const setPlane = (axis: Axis, enabled: boolean, offsetValue = 0, flipped = false) => {
    planes[axis] = { enabled, offset: offsetValue, flip: flipped };
    handles[axis].enable.set(enabled);
    handles[axis].offset.set(offsetValue);
    handles[axis].flip.set(flipped);
    handles[axis].offset.input.disabled = !enabled;
    handles[axis].flip.input.disabled = !enabled;
    applyPlane(axis);
  };
  const preset = (planesOn: Array<[Axis, number, boolean]>, nextView: AnatomicalView, label: string) => {
    for (const { axis } of AXES) {
      const match = planesOn.find(([candidate]) => candidate === axis);
      setPlane(axis, Boolean(match), match?.[1] ?? 0, match?.[2] ?? false);
    }
    viewChoice.set(nextView);
    pairedView(viewer, nextView);
    ctx.status(`Preset: ${label}`);
  };

  const presets = section(panel, 'Presets');
  const row = actions(presets);
  action(row, { id: 'clip-preset-medial', label: 'Left medial wall', onClick: () => preset([['x', 0, true]], 'medial', 'left medial wall (keeps x ≤ 0)') });
  action(row, { id: 'clip-preset-coronal', label: 'Coronal cut', onClick: () => preset([['y', -18, false]], 'posterior', 'coronal cut at y = −18') });
  action(row, { id: 'clip-preset-axial', label: 'Axial cut', onClick: () => preset([['z', 30, true]], 'dorsal', 'axial cut at z = 30') });
  action(row, {
    id: 'clip-clear',
    label: 'Clear planes',
    onClick: () => {
      for (const { axis } of AXES) setPlane(axis, false);
      for (const surface of Object.values(surfaces)) surface.clearClipPlanes();
      ctx.status('Clip planes cleared');
    }
  });
  note(presets, 'Plane positions are in the meshes’ RAS millimetres; the hemispheres keep their anatomical placement here.');

  const print = hoverPrinter(film, { lh: left, rh: right });
  viewer.on('vertex:hover', print);
  pairedView(viewer, 'lateral');
  printPlanes();
  return () => {
    viewer.off('vertex:hover', print);
    cleanup();
  };
}

// ───────────────────────────── Inflate ─────────────────────────────

const EASINGS = [
  { value: 'easeInOut', label: 'Ease in-out' },
  { value: 'easeInOutCubic', label: 'Ease in-out (cubic)' },
  { value: 'easeOutCubic', label: 'Ease out (cubic)' },
  { value: 'linear', label: 'Linear' }
] as const;

const STAGES = ['Folded', 'Inflated', 'Very inflated'] as const;
/** The mode opens inflated: folded would look exactly like Views until the slider moved. */
const OPENING_STAGE = 1;
const MORPH_GAP = 16;

async function morphMode({ ctx, film, panel, isCurrent }: ModeContext): Promise<ModeCleanup | null> {
  const [{ left, right }, lhDepth, rhDepth] = await Promise.all([
    loadBilateral(),
    sulcalDepthOf('fsaverage5Left'),
    sulcalDepthOf('fsaverage5Right')
  ]);
  if (!isCurrent()) return null;
  const depths: Record<SurfaceId, Float32Array> = { lh: lhDepth, rh: rhDepth };
  ctx.setBusy(true, 'Smoothing the pial meshes');
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (!isCurrent()) return null;
  const { viewer, cleanup } = createFilmViewer(ctx.mount);
  const surfaces = {} as Record<SurfaceId, MorphableSurface>;
  for (const [id, geometry, hemisphere, mesh] of [
    ['lh', left, 'left', 'fsaverage5Left'],
    ['rh', right, 'right', 'fsaverage5Right']
  ] as const) {
    const surface = new MorphableSurface(geometry, {
      ...INFLATED_STYLE,
      curvature: depths[id],
      morphTargets: [
        { name: 'inflated', positions: inflated(mesh, geometry, INFLATE_ITERATIONS) },
        { name: 'very-inflated', positions: inflated(mesh, geometry, VERY_INFLATE_ITERATIONS) }
      ]
    });
    surface.hemisphere = hemisphere;
    surface.setMorphValue(OPENING_STAGE);
    viewer.addSurface(surface, id);
    surfaces[id] = surface;
  }
  viewer.registerBilateralSurfaceGroup({ id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' });
  viewer.separateHemispheres(MORPH_GAP);
  ctx.setBusy(false);

  film.trackOrientation(viewer);
  film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L + R');
  film.set('tl', 'curvature', 'Shading', 'sulcal depth');
  film.set('bl', 'gap', 'Gap', `${MORPH_GAP} mm`);
  const state = { duration: 900, easing: 'easeInOut' as (typeof EASINGS)[number]['value'], transition: 0 };
  let transitions = 0;

  const stageLabel = (value: number) => {
    const nearest = Math.round(value);
    return Math.abs(value - nearest) < 0.005 ? STAGES[nearest]! : fmt(value, 2);
  };
  const printMorph = (value: number) => film.set('tr', 'morph', 'Shape', stageLabel(value));

  const shape = section(panel, 'Shape');
  const amount = slider(shape, {
    id: 'anatomy-inflation',
    label: 'Inflation (folded → very inflated)',
    min: 0, max: 2, step: 0.01, value: OPENING_STAGE,
    format: stageLabel,
    onInput: value => {
      // The slider takes over from a running transition; its promise never settles once cancelled.
      endTransition();
      for (const surface of Object.values(surfaces)) {
        surface.cancelAnimation();
        surface.setMorphValue(value);
      }
      printMorph(value);
    }
  });
  const row = actions(shape);
  const buttons: HTMLButtonElement[] = [];
  const endTransition = () => {
    state.transition = 0;
    for (const button of buttons) button.disabled = false;
  };
  const morphTo = async (stage: 0 | 1 | 2) => {
    if (state.transition !== 0) return;
    const transition = ++transitions;
    state.transition = transition;
    for (const button of buttons) button.disabled = true;
    const options = {
      duration: state.duration,
      easing: Easing[state.easing],
      onProgress: () => {
        const value = surfaces.lh.getMorphValue();
        amount.set(value);
        printMorph(value);
      }
    };
    const target = stage === 1 ? 'inflated' : 'very-inflated';
    await Promise.all(Object.values(surfaces).map(surface => (stage === 0 ? surface.morphToBase(options) : surface.morphTo(target, options))));
    if (!isCurrent() || state.transition !== transition) return;
    amount.set(stage);
    printMorph(stage);
    endTransition();
    ctx.status(`Shape: ${STAGES[stage]!.toLowerCase()}`);
  };
  STAGES.forEach((label, stage) => {
    buttons.push(action(row, { id: `morph-stage-${stage}`, label, onClick: () => morphTo(stage as 0 | 1 | 2) }));
  });
  const motion = section(panel, 'Transition');
  slider(motion, {
    id: 'morph-duration',
    label: 'Duration',
    min: 200, max: 2400, step: 100, value: state.duration,
    format: value => `${value} ms`,
    onInput: value => { state.duration = value; }
  });
  select(motion, {
    id: 'morph-easing',
    label: 'Easing',
    options: EASINGS,
    value: state.easing,
    onChange: next => { state.easing = next; }
  });

  const view = section(panel, 'View');
  choice(view, {
    id: 'morph-view',
    label: 'Anatomical view',
    options: VIEWS.filter(entry => entry.value !== 'medial'),
    value: 'lateral',
    print: { film, corner: 'tr', key: 'view', label: 'View' },
    onChange: next => pairedView(viewer, next)
  });

  const print = hoverPrinter(film, { lh: left, rh: right });
  viewer.on('vertex:hover', print);
  pairedView(viewer, 'lateral');
  printMorph(OPENING_STAGE);
  const measurements = addSurfaceMeasurements({ ...ctx, panel }, viewer, { lh: left, rh: right });
  return () => {
    measurements.dispose();
    viewer.off('vertex:hover', print);
    for (const surface of Object.values(surfaces)) surface.cancelAnimation();
    cleanup();
  };
}

// ───────────────────────────── Flat map ─────────────────────────────


const BUILDERS: Record<Mode, (context: ModeContext) => Promise<ModeCleanup | null>> = {
  views: viewsMode,
  clip: clipMode,
  morph: morphMode,
  flatmap: quantitativeFlatmapMode
};

export const anatomy: Scenario = {
  id: 'anatomy',
  aliases: ['hemispheres', 'clipping', 'morphing', 'linked-flatmap'],
  title: 'Anatomy & views',
  short: 'Anatomy',
  group: 'surfaces',
  tags: ['anatomical views', 'hemispheres', 'clip planes', 'morphing', 'inflation', 'flat map', 'linked views', 'ROI'],
  summary:
    'Explore cortical viewpoints, clipping, inflation and quantitative flatmaps. In Flat map, inspect the same scalar or volume signal on folded and flat anatomy, draw an ROI, and compare display-only relief with chart distortion.',
  synthetic:
    'Views and Inflate use fsaverage5 with browser-generated inflation. Flat map uses matched real S1 surfaces from pycortex; its scalar and volume signals and missing regions are constructed. Relief does not change anatomy or data.',
  excerpt,
  run: async ctx => {
    const film = ctx.film;
    const requested = ctx.params.get('mode') as Mode | null;
    let mode: Mode = requested && requested in BUILDERS ? requested : 'views';
    let revision = 0;
    let current: ModeCleanup | null = null;

    const modeSection = section(ctx.panel);
    choice(modeSection, {
      id: 'anatomy-mode',
      label: 'Show',
      options: MODES,
      value: mode,
      onChange: next => { void open(next); }
    });
    const body = document.createElement('div');
    body.className = 'anat-body';
    ctx.panel.append(body);

    async function open(next: Mode) {
      const mine = ++revision;
      mode = next;
      current?.();
      current = null;
      body.replaceChildren();
      film.clear();
      ctx.perf('');
      ctx.setBusy(true, next === 'flatmap' ? 'Loading matched S1 surfaces' : 'Loading fsaverage5');
      const url = new URL(location.href);
      if (next === 'views') url.searchParams.delete('mode');
      else url.searchParams.set('mode', next);
      history.replaceState(history.state, '', url);
      const cleanup = await BUILDERS[next]({ ctx, film, panel: body, isCurrent: () => mine === revision });
      if (mine !== revision) {
        cleanup?.();
        return;
      }
      current = cleanup;
      ctx.setBusy(false);
      ctx.status(`Showing: ${MODES.find(entry => entry.value === next)!.label}`);
    }

    await open(mode);
    return () => {
      revision++;
      current?.();
      current = null;
    };
  }
};
