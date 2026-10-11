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
import excerpt from '../excerpts/anatomy.ts?raw';
import { inflateMesh, projectFlat } from '../kit/anatomy-geometry';
import { action, actions, choice, fmt, note, readout, section, select, slider, toggle } from '../kit/controls';
import { CURVATURE_UNDERLAY, DEPTH_UNDERLAY, curvatureOf, loadBilateral, loadMesh, sulcalDepthOf } from '../kit/data';
import type { MeshName } from '../kit/data';
import { createFilmViewer } from '../kit/film';
import type { FilmOverlay } from '../kit/film';
import type { Scenario, ScenarioRunContext } from '../types';
import './anatomy.css';

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
  return () => {
    viewer.off('vertex:hover', print);
    for (const surface of Object.values(surfaces)) surface.cancelAnimation();
    cleanup();
  };
}

// ───────────────────────────── Flat map ─────────────────────────────

async function flatmapMode({ ctx, film, panel, isCurrent }: ModeContext): Promise<ModeCleanup | null> {
  const [pial, depth] = await Promise.all([loadMesh('fsaverage5Left'), sulcalDepthOf('fsaverage5Left')]);
  if (!isCurrent()) return null;
  ctx.setBusy(true, 'Inflating and projecting the left hemisphere');
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (!isCurrent()) return null;
  const vertexCount = pial.vertices.length / 3;
  const inflatedPositions = inflated('fsaverage5Left', pial, INFLATE_ITERATIONS);
  const flat = projectFlat(inflated('fsaverage5Left', pial, VERY_INFLATE_ITERATIONS), pial.faces, 'left');

  const pair = document.createElement('div');
  pair.className = 'anat-pair';
  pair.dataset.visualQa = 'linked-flatmap';
  const solid = document.createElement('div');
  solid.className = 'anat-cell';
  const solidMount = document.createElement('div');
  solidMount.className = 'anat-viewer';
  const solidLabel = document.createElement('span');
  solidLabel.className = 'anat-cell-label';
  solidLabel.textContent = 'Folded 3D';
  solid.append(solidMount, solidLabel);
  const sheetCell = document.createElement('div');
  sheetCell.className = 'anat-cell anat-cell-flat';
  const sheet = document.createElement('div');
  sheet.className = 'anat-flat-sheet';
  const sheetLabel = document.createElement('span');
  sheetLabel.className = 'anat-cell-label';
  sheetLabel.textContent = 'Flat map';
  sheetCell.append(sheet, sheetLabel);
  pair.append(solid, sheetCell);
  ctx.mount.replaceChildren(pair);

  const { viewer, cleanup } = createFilmViewer(solidMount, { hoverCrosshair: true, hoverCrosshairColor: CURSOR, hoverCrosshairSize: 4 });
  const set = new SurfaceSet({
    hemi: 'left',
    faces: pial.faces,
    defaultVariant: 'folded',
    variants: { folded: pial.vertices, inflated: inflatedPositions }
  });
  const surface = new VariantSurface(set, { ...SURFACE_STYLE, curvature: curvatureOf('fsaverage5Left', pial) });
  surface.hemisphere = 'left';
  const mask = new Float32Array(vertexCount);
  surface.addLayer(new DataLayer('roi', mask, null, [MARK, MARK], {
    range: [0, 1],
    threshold: [-0.5, 0.5],
    opacity: 0.72,
    presentation: { label: 'ROI', units: '' }
  }));
  viewer.addSurface(surface, 'lh');
  viewer.setAnatomicalView('lateral', { layout: 'single', surfaceId: 'lh', fit: true });
  viewer.fitToView({ padding: 0.06 });

  const sheetSize = () => [
    Math.max(64, Math.floor(sheet.clientWidth || 420)),
    Math.max(64, Math.floor(sheet.clientHeight || 420))
  ] as const;
  const [initialWidth, initialHeight] = sheetSize();
  // FlatMapView draws one flat fill, so the folding pattern is painted on a canvas beneath
  // it from the same projected vertices (projectVertex), and the map itself is transparent.
  const underlay = document.createElement('canvas');
  underlay.className = 'anat-flat-underlay';
  underlay.setAttribute('aria-hidden', 'true');
  sheet.append(underlay);
  // An unlit flat sheet shows depth with more contrast than the lit 3D underlay needs.
  const shade = curvatureToGrayscale(depth, { brightness: 0.55, contrast: 0.5, smoothness: 0.5 });
  const flatmap = new FlatMapView(sheet, { surfaceId: 'lh', vertices: flat.vertices, faces: flat.faces }, {
    width: initialWidth,
    height: initialHeight,
    padding: 18,
    background: 'rgba(0, 0, 0, 0)',
    fillStyle: 'rgba(0, 0, 0, 0)',
    strokeStyle: 'rgba(0, 0, 0, 0)',
    hoverStyle: '#edf2f5',
    selectionStyle: MARK,
    pointRadius: 3.5
  });
  const paintUnderlay = () => {
    underlay.width = flatmap.canvas.width;
    underlay.height = flatmap.canvas.height;
    const context = underlay.getContext('2d');
    if (!context) return;
    const points = new Float32Array(vertexCount * 2);
    for (let v = 0; v < vertexCount; v++) {
      const point = flatmap.projectVertex(v);
      points[v * 2] = point.x;
      points[v * 2 + 1] = point.y;
    }
    // Sulci in the film's darker step (--d2), gyri toward --ink-lo.
    const dark = [22, 33, 43], light = [147, 166, 180];
    context.lineWidth = 0.6;
    for (let f = 0; f < flat.faces.length; f += 3) {
      const a = flat.faces[f]!, b = flat.faces[f + 1]!, c = flat.faces[f + 2]!;
      const t = (shade[a]! + shade[b]! + shade[c]!) / 3;
      const color = `rgb(${dark.map((d, i) => Math.round(d + (light[i]! - d) * t)).join(', ')})`;
      context.fillStyle = color;
      context.strokeStyle = color;
      context.beginPath();
      context.moveTo(points[a * 2]!, points[a * 2 + 1]!);
      context.lineTo(points[b * 2]!, points[b * 2 + 1]!);
      context.lineTo(points[c * 2]!, points[c * 2 + 1]!);
      context.closePath();
      context.fill();
      context.stroke();
    }
  };
  paintUnderlay();
  flatmap.canvas.dataset.visualQa = 'linked-flatmap-canvas';
  flatmap.canvas.setAttribute('aria-label', 'Flat map of the left hemisphere');
  const workspace = new LinkedBrainWorkspace({ viewer, flatmap, surfaceId: 'lh' });
  let resizeFrame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      const [width, height] = sheetSize();
      if (width !== flatmap.canvas.width || height !== flatmap.canvas.height) {
        flatmap.resize(width, height);
        paintUnderlay();
      }
    });
  });
  observer.observe(sheet);
  ctx.setBusy(false);

  film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, left');
  film.set('tl', 'flat', 'Flat', 'equal-area projection');
  film.set('bl', 'rois', 'ROIs', '0');

  const link = section(panel, 'Linked views');
  const linkStatus = readout(link, 'Status', 'lf-status');
  linkStatus.element.dataset.linkedFlatmapStatus = '';
  linkStatus.set(`Ready: ${vertexCount} linked vertices`);
  choice(link, {
    id: 'anatomy-variant',
    label: '3D surface',
    options: [
      { value: 'folded', label: 'Folded' },
      { value: 'inflated', label: 'Inflated' }
    ] as const,
    value: 'folded',
    print: { film, corner: 'tr', key: 'variant', label: '3D' },
    onChange: next => {
      surface.setVariant(next, { animate: true, duration: 640 });
      solidLabel.textContent = next === 'folded' ? 'Folded 3D' : 'Inflated 3D';
    }
  });
  note(link, 'Hover either view to find the same vertex in the other; a click on the flat map pins it in 3D.');

  const rois = section(panel, 'Regions of interest');
  const roiStatus = readout(rois, 'ROI', 'roi-status');
  roiStatus.element.dataset.roiStatus = '';
  roiStatus.set('No ROI');
  const drawRow = actions(rois);
  const polygon = action(drawRow, { id: 'roi-polygon', label: 'Draw polygon', onClick: () => startDrawing('polygon') });
  const lasso = action(drawRow, { id: 'roi-lasso', label: 'Draw lasso', onClick: () => startDrawing('lasso') });
  action(drawRow, { id: 'roi-seed', label: 'Seed ROI', onClick: () => seed() });
  action(drawRow, { id: 'roi-clear', label: 'Clear ROIs', onClick: () => clearROIs() });
  const drawNote = note(rois, 'Polygon: click points on the flat map, double-click to close. Lasso: press and drag.');
  const exportRow = actions(rois);
  const svgButton = action(exportRow, { id: 'roi-svg', label: 'SVG', onClick: () => showExport('svg') });
  const giftiButton = action(exportRow, { id: 'roi-label', label: 'Label GIFTI', onClick: () => showExport('gifti') });
  const download = document.createElement('a');
  download.className = 'action';
  download.id = 'roi-download';
  download.hidden = true;
  exportRow.append(download);
  const exportBox = document.createElement('pre');
  exportBox.className = 'anat-export';
  exportBox.dataset.roiExport = '';
  exportBox.hidden = true;
  exportBox.tabIndex = 0;
  exportBox.setAttribute('aria-label', 'ROI export');
  rois.append(exportBox);

  let activeROI: VertexROI | null = null;
  let downloadUrl: string | null = null;

  const syncButtons = () => {
    svgButton.disabled = !activeROI;
    giftiButton.disabled = !activeROI;
  };
  const updateMask = () => {
    const next = new Float32Array(vertexCount);
    for (const roi of flatmap.rois.list()) for (const index of roi.vertexIndices) next[index] = 1;
    viewer.updateLayer('lh', 'roi', { data: next });
    film.set('bl', 'rois', 'ROIs', String(flatmap.rois.list().length));
  };
  const setDrawing = (mode: 'polygon' | 'lasso' | null) => {
    polygon.setAttribute('aria-pressed', String(mode === 'polygon'));
    lasso.setAttribute('aria-pressed', String(mode === 'lasso'));
    drawNote.classList.toggle('anat-note-active', mode !== null);
  };
  const nextName = () => `ROI_${flatmap.rois.list().length + 1}`;
  function startDrawing(mode: 'polygon' | 'lasso') {
    flatmap.startROIDrawing({ mode, name: nextName(), color: MARK, provenance: { sourceSurface: 'lh' } });
    setDrawing(mode);
    roiStatus.set(mode === 'polygon' ? 'Drawing a polygon' : 'Drawing a lasso');
  }
  function seed() {
    const { width, height } = flatmap.canvas;
    const roi = flatmap.createROIFromPolygon([
      { x: width * 0.4, y: height * 0.36 },
      { x: width * 0.6, y: height * 0.36 },
      { x: width * 0.64, y: height * 0.58 },
      { x: width * 0.44, y: height * 0.64 }
    ], { name: nextName(), color: MARK, provenance: { sourceSurface: 'lh', tool: 'seed' } });
    if (roi) {
      const focus = roi.vertexIndices[Math.floor(roi.vertexIndices.length / 2)];
      if (focus !== undefined) flatmap.setSelection(focus);
    }
  }
  function clearROIs() {
    flatmap.cancelROIDrawing();
    flatmap.clearROIs();
    activeROI = null;
    exportBox.textContent = '';
    exportBox.hidden = true;
    download.hidden = true;
    roiStatus.set('No ROI');
    setDrawing(null);
    syncButtons();
    updateMask();
    ctx.status('ROIs cleared');
  }
  function showExport(kind: 'svg' | 'gifti') {
    if (!activeROI) return;
    const text = kind === 'svg'
      ? roiToSVG(activeROI, { width: flatmap.canvas.width, height: flatmap.canvas.height, stroke: MARK })
      : roiToLabelGIFTI(activeROI, { vertexCount });
    exportBox.textContent = text.length > 900 ? `${text.slice(0, 900)}…` : text;
    exportBox.hidden = false;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([text], { type: kind === 'svg' ? 'image/svg+xml' : 'application/xml' }));
    download.href = downloadUrl;
    download.download = `${activeROI.name}.${kind === 'svg' ? 'svg' : 'label.gii'}`;
    download.textContent = `Save ${download.download}`;
    download.hidden = false;
  }

  const onCreated = ({ roi }: { roi: VertexROI }) => {
    activeROI = roi;
    roiStatus.set(`${roi.name}: ${roi.vertexIndices.length} vertices`);
    setDrawing(null);
    syncButtons();
    updateMask();
    ctx.status(`${roi.name}: ${roi.vertexIndices.length} vertices`);
  };
  const onDrawing = ({ mode }: { mode: 'polygon' | 'lasso' | null }) => { if (mode === null) setDrawing(null); };
  const onSelection = ({ vertexIndex }: { vertexIndex: number | null }) => {
    linkStatus.set(vertexIndex === null ? 'No flat-map selection' : `Selected vertex ${vertexIndex}`);
    film.set('br', 'selected', 'Selected', vertexIndex === null ? '—' : `LH ${vertexIndex}`);
    if (vertexIndex !== null) viewer.showCrosshair('lh', vertexIndex, { mode: 'selection', color: 0xf2c230, size: 4 });
  };
  const print = hoverPrinter(film, { lh: pial });
  const offs = [
    flatmap.on('roi:created', onCreated),
    flatmap.on('roi:drawing', onDrawing),
    flatmap.on('selection:changed', onSelection),
    flatmap.on('vertex:hover', print)
  ];
  viewer.on('vertex:hover', print);
  film.set('br', 'selected', 'Selected', '—');
  setDrawing(null);
  syncButtons();
  ctx.perf(`${vertexCount.toLocaleString('en-US')} linked vertices · ${flat.droppedFaces} faces cut at the medial wall`);

  return () => {
    for (const off of offs) off();
    viewer.off('vertex:hover', print);
    cancelAnimationFrame(resizeFrame);
    observer.disconnect();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    workspace.dispose();
    flatmap.dispose();
    cleanup();
  };
}

const BUILDERS: Record<Mode, (context: ModeContext) => Promise<ModeCleanup | null>> = {
  views: viewsMode,
  clip: clipMode,
  morph: morphMode,
  flatmap: flatmapMode
};

export const anatomy: Scenario = {
  id: 'anatomy',
  aliases: ['hemispheres', 'clipping', 'morphing', 'linked-flatmap'],
  title: 'Anatomy & views',
  short: 'Anatomy',
  group: 'surfaces',
  tags: ['anatomical views', 'hemispheres', 'clip planes', 'morphing', 'inflation', 'flat map', 'linked views', 'ROI'],
  summary:
    'The fsaverage5 cortex itself, four ways. Views: the six anatomical views of either or both hemispheres, with an adjustable gap between them. Clip: sagittal, coronal and axial cut planes with position and side, plus presets. Inflate: morph the pial surface toward a smoothed, inflated shape and back. Flat map: the left hemisphere in 3D beside a flat map that shares its vertices; draw or seed an ROI on the map, see it on the cortex, and export it as SVG or a label GIFTI.',
  synthetic:
    'The meshes are real fsaverage5 pial surfaces. The inflated shapes are computed in the browser by Laplacian smoothing of the pial mesh and rescaling (an approximation of FreeSurfer inflation, not mris_inflate), and the flat map is an equal-area projection of the smoothed left hemisphere with the medial wall cut (not a FreeSurfer flat patch). No data maps are shown.',
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
      ctx.setBusy(true, 'Loading fsaverage5');
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
