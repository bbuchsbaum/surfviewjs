import {
  MultiLayerNeuroSurface,
  SurfaceMetric,
  getDisplayGeometryBinding,
  StatisticalMapLayer,
  computeBonferroniThreshold,
  computeFDRThreshold,
  tToZ
} from '@src/index.js';
import type { AnatomicalView, ColorMap2DPreset, SurfaceGeometry, TwoDataLayer } from '@src/index.js';
import excerpt from '../excerpts/statistics.ts?raw';
import { choice, fmt, note, readout, section, select, slider, toggle } from '../kit/controls';
import { FOCI, addFields, blobField, CURVATURE_UNDERLAY, curvatureOf, loadBilateral, mirror, seededRandom, smoothNoise } from '../kit/data';
import { createFilmViewer } from '../kit/film';
import type { Scenario } from '../types';
import './statistics.css';

type Side = 'left' | 'right';
type HemiId = 'lh' | 'rh';
type Correction = 'none' | 'fdr' | 'bonferroni' | 'cluster' | 'area';
type Mode = 'stat' | 'bivariate';

const DF = 28;
const SUBJECTS = DF + 1;

const VIEWS: ReadonlyArray<{ value: AnatomicalView; label: string }> = [
  { value: 'lateral', label: 'Lateral' },
  { value: 'medial', label: 'Medial' },
  { value: 'dorsal', label: 'Dorsal' },
  { value: 'posterior', label: 'Posterior' }
];

const CORRECTIONS: ReadonlyArray<{ value: Correction; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'fdr', label: 'FDR' },
  { value: 'bonferroni', label: 'Bonferroni' },
  { value: 'cluster', label: 'Cluster extent' },
  { value: 'area', label: 'Cluster area (descriptive)' }
];

const COLORMAPS = [
  { value: 'coolwarm', label: 'Cool–warm (diverging)' },
  { value: 'seismic', label: 'Seismic (diverging)' },
  { value: 'surface-heat', label: 'Surface heat' },
  { value: 'RdBu', label: 'Red–blue' }
] as const;

const PRESETS: ReadonlyArray<{ value: ColorMap2DPreset; label: string }> = [
  { value: 'confidence', label: 'Confidence' },
  { value: 'diverging', label: 'Diverging' },
  { value: 'hot_cold', label: 'Hot / cold' },
  { value: 'magnitude_phase', label: 'Magnitude / phase' },
  { value: 'rgba_wheel', label: 'Colour wheel' }
];

/** Complementary error function (Numerical Recipes erfcc; fractional error < 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Benjamini–Hochberg adjusted p-values (q-values), same order as the input. */
function bhAdjust(p: Float32Array): Float32Array {
  const m = p.length;
  const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => p[a]! - p[b]!);
  const q = new Float32Array(m);
  let running = 1;
  for (let rank = m; rank >= 1; rank--) {
    const index = order[rank - 1]!;
    running = Math.min(running, (p[index]! * m) / rank);
    q[index] = running;
  }
  return q;
}

interface Hemisphere {
  id: HemiId;
  side: Side;
  geometry: SurfaceGeometry;
  surface: MultiLayerNeuroSurface;
  t: Float32Array;
  p: Float32Array;
  q: Float32Array;
  stat: StatisticalMapLayer;
  bivariate: TwoDataLayer | null;
}

/**
 * A synthetic one-sample t-map (df 28): Gaussian effects at anatomical foci, smooth
 * spatial noise and seeded per-vertex noise. Two-sided p-values come from the exact
 * t → z conversion (`tToZ`) and the normal tail.
 */
function syntheticTMap(vertices: Float32Array, side: Side) {
  const at = (point: readonly [number, number, number]) => (side === 'left' ? point : mirror(point));
  const signal = blobField(vertices, [
    { center: at(FOCI.primaryVisual), amplitude: 8, sigma: 15 },
    { center: at(FOCI.motorHand), amplitude: side === 'left' ? 7 : 4, sigma: 12 },
    { center: at(FOCI.auditory), amplitude: 5.5, sigma: 11 },
    { center: at(FOCI.intraparietal), amplitude: 5.5, sigma: 11 },
    { center: at(FOCI.inferiorFrontal), amplitude: side === 'left' ? 5 : 3, sigma: 10 },
    { center: at(FOCI.posteriorCingulate), amplitude: -5.5, sigma: 11 },
    { center: at(FOCI.medialPrefrontal), amplitude: -5, sigma: 12 }
  ]);
  const t = addFields(signal, smoothNoise(vertices, side === 'left' ? 41 : 42, 0.8, 30));
  const random = seededRandom(side === 'left' ? 7 : 8);
  for (let v = 0; v < t.length; v++) {
    const gaussian = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    t[v] = t[v]! + 0.6 * gaussian;
  }
  const p = new Float32Array(t.length);
  for (let v = 0; v < t.length; v++) {
    p[v] = Math.min(1, Math.max(Number.MIN_VALUE, erfc(Math.abs(tToZ(t[v]!, DF)) / Math.SQRT2)));
  }
  return { t, p, q: bhAdjust(p) };
}

function formatP(p: number): string {
  if (p >= 0.001) return fmt(p, 3);
  return p.toExponential(1).replace('-', '−');
}

export const statistics: Scenario = {
  id: 'statistics',
  aliases: ['statisticalMap', 'colormap2d'],
  title: 'Statistical maps',
  short: 'Statistics',
  group: 'surfaces',
  tags: ['StatisticalMapLayer', 'FDR', 'Bonferroni', 'cluster extent', 'cluster area', 'dual threshold', 'TwoDataLayer', '2D colormap'],
  summary:
    'A synthetic t-map on both fsaverage5 hemispheres. Apply FDR or Bonferroni correction, or filter clusters by vertex count or physical area in mm². Area filtering keeps positive and negative clusters separate and is descriptive, not a cluster significance test. Adjust the display threshold and colour window, or compare effect size with confidence in the second mode.',
  synthetic:
    'The t-map (df 28) is constructed: Gaussian effects at visual, motor, auditory, intraparietal, inferior frontal, posterior cingulate and medial prefrontal foci plus smooth and seeded per-vertex noise. Effect size is t/√29; confidence is 1 − p. Corrections run within each hemisphere’s layer (10,242 tests each).',
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fsaverage5 hemispheres');
    const { viewer, cleanup } = createFilmViewer(ctx.mount);
    const { left, right } = await loadBilateral();

    const state = {
      mode: 'stat' as Mode,
      correction: (ctx.params.get('task') === 'area' ? 'area' : 'fdr') as Correction,
      rate: 0.05,
      clusterT: 3,
      clusterSize: 20,
      clusterArea: 100,
      threshold: 2,
      window: 7,
      colormap: 'coolwarm' as string,
      dual: false,
      preset: 'confidence' as ColorMap2DPreset,
      confidence: 0.99
    };

    const hemispheres: Hemisphere[] = [];
    const areaMetrics = new Map<HemiId, SurfaceMetric>();
    const areaSurvivors = new Map<HemiId, { count: number; detail: string }>();
    for (const [id, geometry, side, mesh] of [
      ['lh', left, 'left', 'fsaverage5Left'],
      ['rh', right, 'right', 'fsaverage5Right']
    ] as const) {
      const surface = new MultiLayerNeuroSurface(geometry, {
        curvature: curvatureOf(mesh, geometry),
        showCurvature: true,
        curvatureOptions: CURVATURE_UNDERLAY
      });
      surface.hemisphere = side;
      viewer.addSurface(surface, id);
      const map = syntheticTMap(geometry.vertices, side);
      const stat = new StatisticalMapLayer('tmap', map.t, null, state.colormap, {
        range: [-state.window, state.window],
        threshold: [-state.threshold, state.threshold],
        pValues: map.p,
        statType: 'tstat',
        degreesOfFreedom: DF,
        presentation: { label: 'Synthetic t (df 28)', units: 't' }
      });
      stat.setMeshAdjacency(geometry);
      viewer.addLayer(id, stat);
      hemispheres.push({ id, side, geometry, surface, ...map, stat, bivariate: null });
    }
    viewer.registerBilateralSurfaceGroup({ id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' });
    const showView = (next: AnatomicalView) => {
      viewer.setAnatomicalView(next, { layout: 'paired', groupId: 'cortex', fit: true });
      viewer.fitToView({ padding: 0.05 });
    };
    showView('lateral');

    const film = ctx.film;
    film.trackOrientation(viewer);
    film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L + R');
    film.set('tl', 'statistic', 'Statistic', 't, df 28 (synthetic)');

    /** Vertices that survive the correction alone (before the display threshold). */
    const survivors = (hemi: Hemisphere): { count: number; detail: string } => {
      switch (state.correction) {
        case 'fdr': {
          const result = computeFDRThreshold(hemi.p, state.rate);
          return { count: result.survivingCount, detail: `p ≤ ${formatP(result.pThreshold)}` };
        }
        case 'bonferroni': {
          const result = computeBonferroniThreshold(hemi.p, state.rate);
          return { count: result.survivingCount, detail: `p ≤ ${formatP(result.pThreshold)}` };
        }
        case 'area': return areaSurvivors.get(hemi.id) ?? { count: 0, detail: 'no area clusters' };
        case 'cluster': {
          let count = 0;
          const clusters = new Set<number>();
          for (let v = 0; v < hemi.t.length; v++) {
            const info = hemi.stat.getVertexStatInfo(v);
            if (info && info.clusterIndex >= 0 && info.clusterSize >= state.clusterSize) {
              count++;
              clusters.add(info.clusterIndex);
            }
          }
          return { count, detail: `${clusters.size} cluster${clusters.size === 1 ? '' : 's'}` };
        }
        default:
          return { count: hemi.t.length, detail: 'uncorrected' };
      }
    };

    const survivingReadout = { set: (_: string) => {} };
    const applyCorrection = () => {
      for (const hemi of hemispheres) {
        const layer = hemi.stat;
        if (state.correction === 'fdr') layer.applyFDR(state.rate);
        else if (state.correction === 'bonferroni') layer.applyBonferroni(state.rate);
        else if (state.correction === 'cluster') layer.applyClusterThreshold(state.clusterT, { minClusterSize: state.clusterSize });
        else if (state.correction === 'area') {
          let metric = areaMetrics.get(hemi.id);
          if (!metric) { metric = new SurfaceMetric(getDisplayGeometryBinding(hemi.surface.mesh!).domain, { positions: hemi.geometry.vertices, frame: 'fsaverage5-RAS', units: 'mm' }); areaMetrics.set(hemi.id, metric); }
          const result = layer.applyClusterAreaThreshold(state.clusterT, { metric, minAreaMm2: state.clusterArea, signMode: 'separate' });
          areaSurvivors.set(hemi.id, { count: result.mask.reduce((a, b) => a + b, 0), detail: `≥ ${state.clusterArea} mm², signs separate` });
        } else layer.clearCorrection();
      }
      const [lh, rh] = hemispheres.map(survivors) as [ReturnType<typeof survivors>, ReturnType<typeof survivors>];
      const label = CORRECTIONS.find(entry => entry.value === state.correction)!.label;
      const level = state.correction === 'fdr' ? ` q ${fmt(state.rate, 2)}`
        : state.correction === 'bonferroni' ? ` α ${fmt(state.rate, 2)}`
        : state.correction === 'cluster' ? ` |t| > ${fmt(state.clusterT, 1)}, k ≥ ${state.clusterSize}` : '';
      film.set('bl', 'correction', 'Correction', `${label}${level}`);
      survivingReadout.set(state.correction === 'none'
        ? 'all vertices (display threshold only)'
        : `L ${lh.count.toLocaleString('en-US')} · R ${rh.count.toLocaleString('en-US')} (${lh.detail} | ${rh.detail})`);
      rateSlider.input.disabled = state.correction !== 'fdr' && state.correction !== 'bonferroni';
      clusterTSlider.input.disabled = state.correction !== 'cluster' && state.correction !== 'area';
      clusterSizeSlider.input.disabled = state.correction !== 'cluster';
      clusterAreaSlider.input.disabled = state.correction !== 'area';
    };

    const applyDisplay = () => {
      for (const hemi of hemispheres) {
        viewer.updateLayer(hemi.id, 'tmap', { range: [-state.window, state.window], threshold: [-state.threshold, state.threshold] });
        if (state.dual) {
          hemi.stat.setDualThreshold({
            positiveColorMap: 'hot',
            negativeColorMap: 'cool',
            positiveRange: [state.threshold, state.window],
            negativeRange: [-state.window, -state.threshold]
          });
        }
      }
    };

    // ── Mode
    const modeSection = section(ctx.panel, 'Map');
    choice(modeSection, {
      id: 'stats-mode',
      label: 'Display',
      options: [
        { value: 'stat', label: 'Statistical map' },
        { value: 'bivariate', label: 'Effect × confidence (2D)' }
      ],
      value: 'stat',
      print: { film, corner: 'tr', key: 'layer', label: 'Layer' },
      onChange: next => setMode(next)
    });
    choice(modeSection, {
      id: 'stats-view',
      label: 'Anatomical view',
      options: VIEWS,
      value: 'lateral',
      print: { film, corner: 'tr', key: 'view', label: 'View' },
      onChange: next => showView(next)
    });

    // ── Statistical map controls
    const correction = section(ctx.panel, 'Correction');
    correction.dataset.mode = 'stat';
    choice(correction, {
      id: 'stats-correction',
      label: 'Multiple comparisons',
      options: CORRECTIONS,
      value: state.correction,
      onChange: next => { state.correction = next; applyCorrection(); }
    });
    const rateSlider = slider(correction, {
      id: 'stats-rate',
      label: 'Error rate (FDR q or Bonferroni α)',
      min: 0.01, max: 0.2, step: 0.01, value: state.rate,
      format: value => fmt(value, 2),
      onInput: value => { state.rate = value; applyCorrection(); }
    });
    const clusterTSlider = slider(correction, {
      id: 'stats-cluster-t',
      label: 'Cluster-forming threshold (|t|)',
      min: 1.5, max: 5, step: 0.1, value: state.clusterT,
      format: value => fmt(value, 1),
      onInput: value => { state.clusterT = value; applyCorrection(); }
    });
    const clusterSizeSlider = slider(correction, {
      id: 'stats-cluster-size',
      label: 'Minimum cluster size (vertices)',
      min: 1, max: 150, step: 1, value: state.clusterSize,
      onInput: value => { state.clusterSize = value; applyCorrection(); }
    });
    const clusterAreaSlider = slider(correction, { id: 'stats-cluster-area', label: 'Minimum cluster area (mm²)', min: 10, max: 500, step: 10, value: state.clusterArea, onInput: value => { state.clusterArea = value; applyCorrection(); } });
    note(correction, 'Area filtering is descriptive and keeps positive and negative clusters separate. It supplies no cluster p-value.');
    const surviving = readout(correction, 'Surviving', 'stats-surviving');
    survivingReadout.set = surviving.set;

    const display = section(ctx.panel, 'Display');
    display.dataset.mode = 'stat';
    slider(display, {
      id: 'stats-threshold',
      label: 'Hide values within (±t)',
      min: 0, max: 6, step: 0.1, value: state.threshold,
      format: value => (value === 0 ? 'off' : `±${fmt(value, 1)}`),
      print: { film, corner: 'bl', key: 'threshold', label: 'Threshold' },
      onInput: value => { state.threshold = value; applyDisplay(); }
    });
    slider(display, {
      id: 'stats-window',
      label: 'Colour window (±t)',
      min: 3, max: 12, step: 0.5, value: state.window,
      format: value => `±${fmt(value, 1)}`,
      print: { film, corner: 'bl', key: 'window', label: 'Window' },
      onInput: value => { state.window = value; applyDisplay(); }
    });
    const colormapSelect = select(display, {
      id: 'stats-colormap',
      label: 'Colormap',
      options: COLORMAPS,
      value: 'coolwarm',
      print: { film, corner: 'tr', key: 'colormap', label: 'Colormap' },
      onChange: next => {
        state.colormap = next;
        for (const hemi of hemispheres) hemi.stat.setColorMap(next);
      }
    });
    toggle(display, {
      id: 'stats-dual',
      label: 'Separate scales for positive (hot) and negative (cool)',
      checked: false,
      onChange: checked => {
        state.dual = checked;
        colormapSelect.element.disabled = checked;
        if (!checked) for (const hemi of hemispheres) hemi.stat.clearDualThreshold();
        applyDisplay();
        film.set('tr', 'colormap', 'Colormap', checked ? 'hot + / cool −' : COLORMAPS.find(entry => entry.value === state.colormap)!.label);
      }
    });

    // ── 2D colormap controls
    const bivariate = section(ctx.panel, 'Effect × confidence');
    bivariate.dataset.mode = 'bivariate';
    note(bivariate, 'Horizontal axis of the colormap: effect size (t/√29, −1.2 to 1.2). Vertical axis: confidence, 1 − p.');
    choice(bivariate, {
      id: 'stats-preset',
      label: '2D colormap',
      options: PRESETS,
      value: state.preset,
      onChange: next => {
        state.preset = next;
        for (const hemi of hemispheres) hemi.bivariate?.setColorMap(next);
        film.set('tr', 'colormap', 'Colormap', `2D ${PRESETS.find(entry => entry.value === next)!.label}`);
      }
    });
    slider(bivariate, {
      id: 'stats-confidence',
      label: 'Hide confidence below',
      min: 0, max: 0.999, step: 0.001, value: state.confidence,
      format: value => (value === 0 ? 'off' : `${fmt(value, 3)} (p > ${fmt(1 - value, 3)})`),
      onInput: value => {
        state.confidence = value;
        for (const hemi of hemispheres) hemi.bivariate?.setThresholdY([0, value]);
      }
    });

    const ensureBivariate = (hemi: Hemisphere) => {
      if (hemi.bivariate) return hemi.bivariate;
      const effect = new Float32Array(hemi.t.length);
      const confidence = new Float32Array(hemi.t.length);
      for (let v = 0; v < effect.length; v++) {
        effect[v] = hemi.t[v]! / Math.sqrt(SUBJECTS);
        confidence[v] = 1 - hemi.p[v]!;
      }
      hemi.bivariate = hemi.surface.addTwoDataLayer('bivariate', effect, confidence, state.preset, {
        rangeX: [-1.2, 1.2],
        rangeY: [0, 1],
        thresholdY: [0, state.confidence]
      });
      return hemi.bivariate;
    };

    const setMode = (next: Mode) => {
      state.mode = next;
      for (const section of [correction, display, bivariate]) section.hidden = section.dataset.mode !== next;
      for (const hemi of hemispheres) {
        if (next === 'bivariate') ensureBivariate(hemi);
        viewer.updateLayerVisibility(hemi.id, 'tmap', next === 'stat');
        if (hemi.bivariate) viewer.updateLayerVisibility(hemi.id, 'bivariate', next === 'bivariate');
      }
      if (next === 'stat') {
        film.set('tr', 'colormap', 'Colormap', state.dual ? 'hot + / cool −' : COLORMAPS.find(entry => entry.value === state.colormap)!.label);
        applyCorrection();
        film.set('bl', 'threshold', 'Threshold', state.threshold === 0 ? 'off' : `±${fmt(state.threshold, 1)}`);
        film.set('bl', 'window', 'Window', `±${fmt(state.window, 1)}`);
        film.set('bl', 'confidence', 'Confidence', null);
      } else {
        film.set('tr', 'colormap', 'Colormap', `2D ${PRESETS.find(entry => entry.value === state.preset)!.label}`);
        for (const key of ['correction', 'threshold', 'window']) film.set('bl', key, '', null);
        film.set('bl', 'confidence', 'Confidence', `> ${fmt(state.confidence, 3)}`);
      }
      onHover({ surfaceId: null, vertexIndex: null });
    };

    // ── Hover readout
    const onHover = (event: { surfaceId: string | null; vertexIndex: number | null }) => {
      const hemi = hemispheres.find(entry => entry.id === event.surfaceId);
      const v = event.vertexIndex;
      if (!hemi || v === null) {
        film.set('br', 'cursor', 'Vertex', '—');
        for (const key of ['value', 'p', 'cluster']) film.set('br', key, '', null);
        return;
      }
      film.set('br', 'cursor', 'Vertex', `${hemi.id === 'lh' ? 'L' : 'R'} ${v}`);
      const t = hemi.t[v]!, p = hemi.p[v]!;
      if (state.mode === 'bivariate') {
        film.set('br', 'value', 'Effect', `${fmt(t / Math.sqrt(SUBJECTS), 2)} (t ${fmt(t, 2)})`);
        film.set('br', 'p', 'Confidence', `${fmt(1 - p, 4)}${1 - p <= state.confidence ? ' (hidden)' : ''}`);
        film.set('br', 'cluster', 'Cluster', null);
        return;
      }
      const info = hemi.stat.getVertexStatInfo(v);
      let corrected = '';
      let survives = Math.abs(t) > state.threshold;
      if (state.correction === 'fdr') {
        corrected = ` · FDR ${formatP(hemi.q[v]!)}`;
        survives &&= hemi.q[v]! <= state.rate;
      } else if (state.correction === 'bonferroni') {
        const adjusted = Math.min(1, p * hemi.p.length);
        corrected = ` · Bonf ${formatP(adjusted)}`;
        survives &&= adjusted <= state.rate;
      } else if (state.correction === 'cluster') {
        survives &&= !!info && info.clusterIndex >= 0 && info.clusterSize >= state.clusterSize;
      }
      film.set('br', 'value', 't', `${fmt(t, 2)} · z ${fmt(info?.zScore ?? 0, 2)}${survives ? '' : ' (hidden)'}`);
      film.set('br', 'p', 'p', `${formatP(p)}${corrected}`);
      const cluster = state.correction === 'cluster' && info && info.clusterIndex >= 0
        ? `#${info.clusterIndex}, ${info.clusterSize} vertices`
        : state.correction === 'cluster' ? 'none' : null;
      film.set('br', 'cluster', 'Cluster', cluster);
    };
    viewer.on('vertex:hover', onHover);

    setMode('stat');
    ctx.perf(`${(hemispheres[0]!.t.length * 2).toLocaleString('en-US')} vertices · ${DF} df`);
    ctx.setBusy(false);
    return () => {
      viewer.off('vertex:hover', onHover);
      cleanup();
    };
  }
};
