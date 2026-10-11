import { DataLayer, MultiLayerNeuroSurface } from '@src/index.js';
import type { AnatomicalView } from '@src/index.js';
import excerpt from '../excerpts/firstLook.ts?raw';
import { action, actions, choice, fmt, section, select, slider, toggle } from '../kit/controls';
import { FOCI, blobField, CURVATURE_UNDERLAY, curvatureOf, loadBilateral, mirror, smoothNoise, addFields } from '../kit/data';
import { createFilmViewer } from '../kit/film';
import type { Scenario } from '../types';

const VIEWS: ReadonlyArray<{ value: AnatomicalView; label: string }> = [
  { value: 'lateral', label: 'Lateral' },
  { value: 'medial', label: 'Medial' },
  { value: 'dorsal', label: 'Dorsal' },
  { value: 'ventral', label: 'Ventral' },
  { value: 'anterior', label: 'Anterior' },
  { value: 'posterior', label: 'Posterior' }
];

const COLORMAPS = [
  { value: 'coolwarm', label: 'Cool–warm (diverging)' },
  { value: 'seismic', label: 'Seismic (diverging)' },
  { value: 'surface-heat', label: 'Surface heat' },
  { value: 'viridis', label: 'Viridis' }
] as const;

/** A synthetic contrast: visual and motor activation, inferior frontal deactivation, plus smooth noise. */
function contrast(vertices: Float32Array, side: 'left' | 'right'): Float32Array {
  const at = (point: readonly [number, number, number]) => (side === 'left' ? point : mirror(point));
  const signal = blobField(vertices, [
    { center: at(FOCI.primaryVisual), amplitude: 5.2, sigma: 13 },
    { center: at(FOCI.motorHand), amplitude: side === 'left' ? 4.6 : 2.4, sigma: 10 },
    { center: at(FOCI.auditory), amplitude: 3.1, sigma: 9 },
    { center: at(FOCI.inferiorFrontal), amplitude: -3.4, sigma: 11 },
    { center: at(FOCI.posteriorCingulate), amplitude: -3.0, sigma: 10 }
  ]);
  return addFields(signal, smoothNoise(vertices, side === 'left' ? 11 : 12, 0.9, 32));
}

export const firstLook: Scenario = {
  id: 'first-look',
  aliases: ['quickstart', 'lighting'],
  title: 'First look',
  short: 'First look',
  group: 'surfaces',
  tags: ['viewer', 'data layer', 'threshold', 'anatomical views'],
  summary:
    'Both fsaverage5 hemispheres with a curvature underlay and one data layer. Set the colour window and the threshold, switch anatomical views, and hover to read values. Drag to rotate; scroll to zoom.',
  synthetic:
    'The map is a constructed contrast (Gaussian effects at visual, motor, auditory, inferior frontal and posterior cingulate foci, plus smooth noise), not a result.',
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fsaverage5 hemispheres');
    const { viewer, cleanup } = createFilmViewer(ctx.mount);
    const { left, right } = await loadBilateral();
    const values = { lh: contrast(left.vertices, 'left'), rh: contrast(right.vertices, 'right') };
    const state = { colormap: 'coolwarm', window: 5, threshold: 1.6 };

    for (const [id, geometry, hemisphere, mesh] of [
      ['lh', left, 'left', 'fsaverage5Left'],
      ['rh', right, 'right', 'fsaverage5Right']
    ] as const) {
      const surface = new MultiLayerNeuroSurface(geometry, {
        curvature: curvatureOf(mesh, geometry),
        showCurvature: true,
        curvatureOptions: CURVATURE_UNDERLAY
      });
      surface.hemisphere = hemisphere;
      viewer.addSurface(surface, id);
      viewer.addLayer(id, new DataLayer('map', values[id], null, state.colormap, {
        range: [-state.window, state.window],
        threshold: [-state.threshold, state.threshold],
        presentation: { label: 'Synthetic contrast', units: 'z' }
      }));
    }
    viewer.registerBilateralSurfaceGroup({ id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' });
    const showView = (next: AnatomicalView) => {
      viewer.setAnatomicalView(next, { layout: 'paired', groupId: 'cortex', fit: true, hemisphereGap: 6 });
      viewer.fitToView({ padding: 0.05 });
    };
    showView('lateral');

    const film = ctx.film;
    film.trackOrientation(viewer);
    const vertexCount = (left.vertices.length + right.vertices.length) / 3;
    film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L + R');
    film.set('tl', 'vertices', 'Vertices', vertexCount.toLocaleString('en-US'));
    film.set('tr', 'layer', 'Layer', 'Synthetic contrast (z)');

    const update = (changes: Record<string, unknown>) => {
      for (const id of ['lh', 'rh']) viewer.updateLayer(id, 'map', changes);
    };

    const view = section(ctx.panel, 'View');
    choice(view, {
      id: 'first-look-view',
      label: 'Anatomical view',
      options: VIEWS,
      value: 'lateral',
      print: { film, corner: 'tr', key: 'view', label: 'View' },
      onChange: next => {
        showView(next);
        ctx.status(`View: ${next}`);
      }
    });
    const row = actions(view);
    action(row, { label: 'Fit to view', onClick: () => { viewer.fitToView(); } });
    toggle(view, {
      label: 'Camera interaction',
      checked: true,
      onChange: enabled => viewer.setInteractionEnabled(enabled)
    });

    const map = section(ctx.panel, 'Map');
    select(map, {
      id: 'first-look-colormap',
      label: 'Colormap',
      options: COLORMAPS,
      value: 'coolwarm',
      print: { film, corner: 'tr', key: 'colormap', label: 'Colormap' },
      onChange: next => update({ colorMap: next })
    });
    slider(map, {
      id: 'first-look-window',
      label: 'Colour window (±z)',
      min: 2, max: 10, step: 0.5, value: state.window,
      format: value => `±${fmt(value, 1)}`,
      print: { film, corner: 'bl', key: 'window', label: 'Window' },
      onInput: value => { state.window = value; update({ range: [-value, value] }); }
    });
    slider(map, {
      id: 'first-look-threshold',
      label: 'Hide values within (±z)',
      min: 0, max: 5, step: 0.1, value: state.threshold,
      format: value => (value === 0 ? 'off' : `±${fmt(value, 1)}`),
      print: { film, corner: 'bl', key: 'threshold', label: 'Threshold' },
      onInput: value => { state.threshold = value; update({ threshold: [-value, value] }); }
    });

    const onHover = (event: { surfaceId: string | null; vertexIndex: number | null }) => {
      const id = event.surfaceId as 'lh' | 'rh' | null;
      if (!id || event.vertexIndex === null || !(id in values)) {
        film.set('br', 'cursor', 'Vertex', '—');
        film.set('br', 'value', 'Value', '—');
        return;
      }
      const value = values[id][event.vertexIndex]!;
      film.set('br', 'cursor', 'Vertex', `${id.toUpperCase()} ${event.vertexIndex}`);
      film.set('br', 'value', 'Value', `${fmt(value)} z${Math.abs(value) <= state.threshold ? ' (hidden)' : ''}`);
    };
    viewer.on('vertex:hover', onHover);
    onHover({ surfaceId: null, vertexIndex: null });

    ctx.perf(`${vertexCount.toLocaleString('en-US')} vertices`);
    ctx.setBusy(false);
    return () => {
      viewer.off('vertex:hover', onHover);
      cleanup();
    };
  }
};
