import { DataLayer, MultiLayerNeuroSurface, RGBALayer } from '@src/index.js';
import type { AnatomicalView } from '@src/index.js';
import excerpt from '../excerpts/layers.ts?raw';
import { action, actions, choice, fmt, note, readout, section, select, slider, toggle } from '../kit/controls';
import { curvatureOf, loadMesh, smoothNoise } from '../kit/data';
import { createFilmViewer } from '../kit/film';
import { METRIC_URLS, loadGiftiMetric } from '../kit/layers-metric';
import type { Scenario } from '../types';

type OverlayId = 'func' | 'activation' | 'tint';
type Mode = 'CPU' | 'GPU';

interface OverlaySpec {
  id: OverlayId;
  name: string;
  short: string;
  kind: 'data' | 'rgba';
  /** Largest |value| in the layer's data; bounds the threshold slider. */
  maxAbs: number;
  make: () => DataLayer | RGBALayer;
}

const VIEWS: ReadonlyArray<{ value: AnatomicalView; label: string }> = [
  { value: 'lateral', label: 'Lateral' },
  { value: 'medial', label: 'Medial' },
  { value: 'dorsal', label: 'Dorsal' },
  { value: 'posterior', label: 'Posterior' }
];

/** Precomputed colours: a translucent tint along the anterior–posterior axis. */
function axisTint(vertices: Float32Array): Float32Array {
  const count = vertices.length / 3;
  let low = Infinity, high = -Infinity;
  for (let v = 0; v < count; v++) {
    const y = vertices[v * 3 + 1]!;
    if (y < low) low = y;
    if (y > high) high = y;
  }
  const rgba = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    const t = (vertices[v * 3 + 1]! - low) / Math.max(1e-6, high - low);
    rgba.set([0.22 + 0.6 * t, 0.42 - 0.1 * t, 0.86 - 0.42 * t, 0.42], v * 4);
  }
  return rgba;
}

/**
 * A sequential RGBA ramp whose alpha rises from zero, so a map's falloff fades into
 * whatever the underlay shows beneath it instead of ending in a rim (every preset is
 * opaque and starts dark). Alpha travels with the colour into the threshold isoline.
 */
const FADING_RAMP: Array<[number, number, number, number]> = (() => {
  const stops: Array<[number, number, number, number]> = [
    [0.36, 0.7, 0.66, 0], [0.13, 0.57, 0.55, 0.7], [0.36, 0.78, 0.39, 1], [0.99, 0.91, 0.15, 1]
  ];
  const ramp: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 64; i++) {
    const x = (i / 63) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(x)), f = x - k;
    ramp.push(stops[k]!.map((c, a) => c + f * (stops[k + 1]![a]! - c)) as [number, number, number, number]);
  }
  return ramp;
})();

function maxAbsOf(values: Float32Array): number {
  let max = 0;
  for (const value of values) if (Number.isFinite(value) && Math.abs(value) > max) max = Math.abs(value);
  return max;
}

export const layers: Scenario = {
  id: 'layers',
  aliases: ['multilayer', 'curvature', 'gpu-compositing', 'fslr-func'],
  title: 'Layers & thresholds',
  short: 'Layers',
  group: 'surfaces',
  tags: ['MultiLayerNeuroSurface', 'curvature underlay', 'RGBA layer', 'blend modes', 'threshold edges', 'GPU compositing'],
  summary:
    'The fs_LR 32k inflated left hemisphere with a curvature underlay and three overlays composited in order: an RGBA tint, an additive activation layer and the Gaussian-splat metric read from a GIFTI func file. Pick a layer to change its opacity and threshold, raise or lower it, or take it out of the stack. Threshold edges, the outline band and silhouette darkening are fragment shading on the CPU compositing path; switch to GPU compositing and animate the layers to compare frame cost.',
  synthetic:
    'The func map (tests/data/gaussian_splat_demo.func.gii) is a synthetic Gaussian-splat pattern; the activation layer is seeded smooth random waves and the tint is a colour ramp along the anterior–posterior axis. Only the mesh is real.',
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fs_LR 32k surface and func metric');
    const { viewer, cleanup } = createFilmViewer(ctx.mount);
    const [geometry, metric] = await Promise.all([loadMesh('fsLR32kLeftInflated'), loadGiftiMetric(METRIC_URLS.gaussianSplat)]);
    const vertexCount = geometry.vertices.length / 3;
    if (metric.values.length !== vertexCount) {
      throw new Error(`Metric has ${metric.values.length} values for ${vertexCount} vertices`);
    }

    const shading = { thresholdEdges: true, thresholdOutline: 0, thresholdOutlineShade: 0.55, silhouetteDarkening: 0.25 };
    const curvature = { brightness: 0.6, contrast: 0.45, smoothness: 1 };
    const surface = new MultiLayerNeuroSurface(geometry, {
      baseColor: 0xb7c0c8,
      curvature: curvatureOf('fsLR32kLeftInflated', geometry),
      showCurvature: true,
      curvatureOptions: curvature,
      shading
    });
    surface.hemisphere = 'left';
    viewer.addSurface(surface, 'lh');

    // Two smooth fields mixed by phase: the activation drifts when animated.
    const waveA = smoothNoise(geometry.vertices, 21, 1.6, 36);
    const waveB = smoothNoise(geometry.vertices, 22, 1.6, 36);
    const activationAt = (phase: number, out = new Float32Array(vertexCount)) => {
      const c = Math.cos(phase), s = Math.sin(phase);
      for (let v = 0; v < vertexCount; v++) out[v] = Math.max(0, c * waveA[v]! + s * waveB[v]!);
      return out;
    };
    const activation = activationAt(0);
    const funcMax = Math.max(Math.abs(metric.range[0]), Math.abs(metric.range[1])) || 1;
    const tint = axisTint(geometry.vertices);

    const state = {
      opacity: { func: 0.8, activation: 0.85, tint: 0.6 } as Record<OverlayId, number>,
      threshold: { func: 0.03, activation: 0.35, tint: 0 } as Record<OverlayId, number>,
      visible: { func: true, activation: true, tint: true } as Record<OverlayId, boolean>,
      editing: 'func' as OverlayId,
      animating: false
    };

    const specs: Record<OverlayId, OverlaySpec> = {
      func: {
        id: 'func', name: 'Func map (GIFTI)', short: 'Func', kind: 'data', maxAbs: funcMax,
        make: () => new DataLayer('func', metric.values, null, FADING_RAMP, {
          range: [0, funcMax],
          threshold: [-state.threshold.func, state.threshold.func],
          opacity: state.opacity.func,
          visible: state.visible.func,
          presentation: { label: 'Gaussian splat (synthetic)' }
        })
      },
      activation: {
        id: 'activation', name: 'Activation (additive)', short: 'Activation', kind: 'data', maxAbs: maxAbsOf(activation),
        make: () => new DataLayer('activation', activation, null, 'hot', {
          range: [0, 1.4],
          threshold: [-state.threshold.activation, state.threshold.activation],
          opacity: state.opacity.activation,
          visible: state.visible.activation,
          blendMode: 'additive'
        })
      },
      tint: {
        id: 'tint', name: 'Axis tint (RGBA)', short: 'Tint', kind: 'rgba', maxAbs: 0,
        make: () => new RGBALayer('tint', tint, { opacity: state.opacity.tint, visible: state.visible.tint })
      }
    };
    const order: OverlayId[] = ['tint', 'activation', 'func'];
    const instances = new Map<OverlayId, DataLayer | RGBALayer>();
    const inStack = (id: OverlayId) => instances.has(id) && surface.getLayer(id) === instances.get(id);
    const isOverlay = (id: string): id is OverlayId => id in specs;

    const addOverlay = (id: OverlayId) => {
      if (inStack(id)) return;
      const layer = specs[id].make();
      instances.set(id, layer);
      viewer.addLayer('lh', layer);
    };
    const removeOverlay = (id: OverlayId) => {
      if (!inStack(id)) return;
      viewer.removeLayer('lh', id);
      instances.delete(id);
    };
    for (const id of order) addOverlay(id);

    /** Overlays in the stack, top first. */
    const stackTopDown = () => surface.getOrderedLayers().map(layer => layer.id).filter(isOverlay).reverse();

    viewer.setAnatomicalView('lateral', { layout: 'single', surfaceId: 'lh', fit: true });
    viewer.fitToView({ padding: 0.05 });
    const film = ctx.film;
    film.trackOrientation(viewer);
    film.set('tl', 'surface', 'Surface', 'fs_LR 32k inflated, L');
    film.set('tl', 'underlay', 'Underlay', 'mean curvature');

    // ── perf readout: compositing mode, overlay count, and frame cost while animating
    const perfState = { frames: 0, compositeMs: 0, since: performance.now(), fps: 0, ms: 0 };
    const mode = (): Mode => surface.getCompositingMode();
    const showPerf = () => {
      const count = stackTopDown().length;
      const timing = state.animating
        ? `${perfState.fps} fps · ${fmt(perfState.ms, 1)} ms/composite`
        : 'static';
      ctx.perf(`${mode()} compositing · ${count} overlay${count === 1 ? '' : 's'} · ${timing}`);
    };

    /** Which layer gets fragment-level threshold edges, mirroring the library's rule. */
    const edgeState = () => {
      if (mode() === 'GPU') return 'per vertex (GPU)';
      if (!shading.thresholdEdges) return 'off';
      const visible = surface.getOrderedLayers().filter(layer => layer.visible);
      const top = visible[visible.length - 1];
      if (!top || !isOverlay(top.id) || specs[top.id].kind !== 'data') return 'none (top is not a data layer)';
      if (top.blendMode !== 'normal') return `none (${specs[top.id].short} is additive)`;
      if (state.threshold[top.id] === 0) return `none (${specs[top.id].short} unthresholded)`;
      return `${specs[top.id].short} isoline`;
    };

    const stackReadout = { set: (_: string) => {} };
    const refresh = () => {
      const stack = stackTopDown();
      const text = stack.length ? stack.map(id => specs[id].short).join(' › ') : 'underlay only';
      stackReadout.set(stack.length ? `${text} › curvature` : text);
      film.set('tr', 'stack', 'Stack', text);
      film.set('tr', 'compositing', 'Compositing', mode());
      film.set('tr', 'edges', 'Edges', edgeState());
      syncEditor();
      showPerf();
    };

    // ── View
    const view = section(ctx.panel, 'View');
    choice(view, {
      id: 'layers-view',
      label: 'Anatomical view',
      options: VIEWS,
      value: 'lateral',
      onChange: next => {
        viewer.setAnatomicalView(next, { layout: 'single', surfaceId: 'lh', fit: true });
        viewer.fitToView({ padding: 0.05 });
      }
    });

    // ── Layer stack
    const stackSection = section(ctx.panel, 'Layer stack');
    const stackLine = readout(stackSection, 'Top to bottom', 'layers-stack');
    stackReadout.set = stackLine.set;
    select(stackSection, {
      id: 'layers-edit',
      label: 'Edit layer',
      options: order.slice().reverse().map(id => ({ value: id, label: specs[id].name })),
      value: state.editing,
      onChange: next => { state.editing = next; syncEditor(); }
    });
    const inStackToggle = toggle(stackSection, {
      id: 'layers-in-stack',
      label: 'In the stack',
      checked: true,
      onChange: checked => {
        if (checked) addOverlay(state.editing);
        else removeOverlay(state.editing);
        refresh();
      }
    });
    const visibleToggle = toggle(stackSection, {
      id: 'layers-visible',
      label: 'Visible',
      checked: true,
      onChange: checked => {
        state.visible[state.editing] = checked;
        if (inStack(state.editing)) viewer.updateLayerVisibility('lh', state.editing, checked);
        refresh();
      }
    });
    const opacitySlider = slider(stackSection, {
      id: 'layers-opacity',
      label: 'Opacity',
      min: 0, max: 1, step: 0.05, value: state.opacity.func,
      format: value => fmt(value, 2),
      print: { film, corner: 'bl', key: 'opacity', label: 'Opacity' },
      onInput: value => {
        state.opacity[state.editing] = value;
        if (inStack(state.editing)) viewer.updateLayer('lh', state.editing, { opacity: value });
      }
    });
    const thresholdSlider = slider(stackSection, {
      id: 'layers-threshold',
      label: 'Hide values within (±)',
      min: 0, max: 1, step: 0.01, value: state.threshold.func,
      format: value => (specs[state.editing].kind === 'rgba' ? 'n/a' : value === 0 ? 'off' : `±${fmt(value, 2)}`),
      print: { film, corner: 'bl', key: 'threshold', label: 'Threshold' },
      onInput: value => {
        const id = state.editing;
        if (specs[id].kind !== 'data') return;
        state.threshold[id] = value;
        if (inStack(id)) viewer.updateLayer('lh', id, { threshold: [-value, value] });
        film.set('tr', 'edges', 'Edges', edgeState());
      }
    });
    const orderRow = actions(stackSection);
    const move = (direction: 1 | -1) => {
      const id = state.editing;
      const ids = surface.getOrderedLayers().map(layer => layer.id);
      const index = ids.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ids.length || !isOverlay(ids[target]!)) return;
      const result = surface.moveLayer(id, target);
      if (!result.ok) ctx.status(result.message);
      refresh();
    };
    const raise = action(orderRow, { id: 'layers-raise', label: 'Raise', onClick: () => move(1) });
    const lower = action(orderRow, { id: 'layers-lower', label: 'Lower', onClick: () => move(-1) });

    const syncEditor = () => {
      const id = state.editing;
      const spec = specs[id];
      const present = inStack(id);
      inStackToggle.set(present);
      visibleToggle.set(state.visible[id]);
      visibleToggle.input.disabled = !present;
      opacitySlider.set(state.opacity[id]);
      const threshold = thresholdSlider.input;
      threshold.disabled = spec.kind !== 'data';
      threshold.max = String(Math.max(0.01, Number(spec.maxAbs.toFixed(2))));
      threshold.step = String(spec.maxAbs > 2 ? 0.05 : 0.01);
      thresholdSlider.set(state.threshold[id]);
      const stack = stackTopDown();
      raise.disabled = !present || stack[0] === id;
      lower.disabled = !present || stack[stack.length - 1] === id;
    };

    const stackRow = actions(stackSection);
    action(stackRow, {
      id: 'layers-clear',
      label: 'Clear to underlay',
      onClick: () => {
        for (const id of order) removeOverlay(id);
        refresh();
        ctx.status('Overlays removed; curvature underlay remains');
      }
    });
    action(stackRow, {
      id: 'layers-restore',
      label: 'Restore all layers',
      onClick: () => {
        for (const id of order) addOverlay(id);
        // Re-added layers go on top; put them back in the original order.
        const ids = surface.getOrderedLayers().map(layer => layer.id);
        surface.setLayerOrder([...ids.filter(id => !isOverlay(id)), ...order]);
        refresh();
        ctx.status('All three overlays restored');
      }
    });

    // ── Curvature underlay
    const underlay = section(ctx.panel, 'Curvature underlay');
    const curvatureLayer = () => surface.getCurvatureLayer();
    toggle(underlay, {
      id: 'layers-curvature',
      label: 'Show curvature (off: flat base colour)',
      checked: true,
      onChange: checked => {
        surface.showCurvature(checked);
        film.set('tl', 'underlay', 'Underlay', checked ? 'mean curvature' : 'base colour');
      }
    });
    slider(underlay, {
      id: 'layers-curv-brightness',
      label: 'Brightness',
      min: 0, max: 1, step: 0.02, value: curvature.brightness,
      format: value => fmt(value, 2),
      print: { film, corner: 'bl', key: 'brightness', label: 'Curv bright' },
      onInput: value => curvatureLayer()?.setBrightness(value)
    });
    slider(underlay, {
      id: 'layers-curv-contrast',
      label: 'Contrast',
      min: 0, max: 1, step: 0.02, value: curvature.contrast,
      format: value => fmt(value, 2),
      print: { film, corner: 'bl', key: 'contrast', label: 'Curv contrast' },
      onInput: value => curvatureLayer()?.setContrast(value)
    });
    slider(underlay, {
      id: 'layers-curv-smoothness',
      label: 'Smoothness (curvature scale)',
      min: 0.1, max: 3, step: 0.1, value: curvature.smoothness,
      format: value => fmt(value, 1),
      onInput: value => curvatureLayer()?.setSmoothness(value)
    });

    // ── Threshold edge shading (2.3.0)
    const edges = section(ctx.panel, 'Threshold edges');
    note(edges, 'The top layer, when it is a thresholded data layer with normal blending, is drawn with a per-fragment isoline at its threshold instead of a per-vertex staircase. CPU compositing only.');
    toggle(edges, {
      id: 'layers-edges',
      label: 'Fragment isoline at threshold',
      checked: shading.thresholdEdges,
      onChange: checked => {
        shading.thresholdEdges = checked;
        surface.setShading({ thresholdEdges: checked });
        refresh();
      }
    });
    slider(edges, {
      id: 'layers-outline',
      label: 'Outline band width',
      min: 0, max: 4, step: 0.25, value: shading.thresholdOutline,
      format: value => (value === 0 ? 'off' : fmt(value, 2)),
      onInput: value => surface.setShading({ thresholdOutline: value })
    });
    slider(edges, {
      id: 'layers-outline-shade',
      label: 'Outline brightness (0 black)',
      min: 0, max: 1, step: 0.05, value: shading.thresholdOutlineShade,
      format: value => fmt(value, 2),
      onInput: value => surface.setShading({ thresholdOutlineShade: value })
    });
    slider(edges, {
      id: 'layers-silhouette',
      label: 'Silhouette darkening',
      min: 0, max: 1, step: 0.05, value: shading.silhouetteDarkening,
      format: value => (value === 0 ? 'off' : fmt(value, 2)),
      onInput: value => surface.setShading({ silhouetteDarkening: value })
    });

    // ── Compositing: the one CPU/GPU switch in the gallery
    const compositingSection = section(ctx.panel, 'Compositing');
    const compositing = choice(compositingSection, {
      id: 'layers-compositing',
      label: 'Compositor',
      options: [
        { value: 'CPU', label: 'CPU' },
        { value: 'GPU', label: 'GPU (WebGL2)' }
      ],
      value: 'CPU',
      onChange: next => {
        surface.setCompositingMode(next === 'GPU');
        if (mode() !== next) {
          compositing.set(mode());
          ctx.status('GPU compositing is unavailable in this browser; staying on CPU');
        } else {
          ctx.status(`Switched compositing to ${mode()}`);
        }
        perfState.frames = 0;
        perfState.compositeMs = 0;
        perfState.since = performance.now();
        refresh();
      }
    });

    let frame = 0;
    const funcFrame = new Float32Array(vertexCount);
    const activationFrame = new Float32Array(vertexCount);
    const tick = (now: number) => {
      if (!state.animating) return;
      const t = now / 1000;
      const pulse = 0.55 + 0.45 * Math.sin(t * 2.1);
      for (let v = 0; v < vertexCount; v++) funcFrame[v] = metric.values[v]! * pulse;
      activationAt(t * 0.9, activationFrame);
      const func = instances.get('func');
      const act = instances.get('activation');
      if (func instanceof DataLayer && inStack('func')) func.setData(funcFrame);
      if (act instanceof DataLayer && inStack('activation')) act.setData(activationFrame);
      const start = performance.now();
      surface.updateColors();
      perfState.compositeMs += performance.now() - start;
      perfState.frames++;
      const elapsed = now - perfState.since;
      if (elapsed >= 500) {
        perfState.fps = Math.round((perfState.frames * 1000) / elapsed);
        perfState.ms = perfState.compositeMs / Math.max(1, perfState.frames);
        perfState.frames = 0;
        perfState.compositeMs = 0;
        perfState.since = now;
        showPerf();
      }
      frame = requestAnimationFrame(tick);
    };
    const stopAnimation = () => {
      state.animating = false;
      cancelAnimationFrame(frame);
      // Leave the layers showing their unanimated data.
      const func = instances.get('func');
      const act = instances.get('activation');
      if (func instanceof DataLayer && inStack('func')) func.setData(metric.values);
      if (act instanceof DataLayer && inStack('activation')) act.setData(activation);
    };
    toggle(compositingSection, {
      id: 'layers-animate',
      label: 'Animate layer data (measures compositing cost)',
      checked: false,
      onChange: checked => {
        if (checked) {
          state.animating = true;
          perfState.frames = 0;
          perfState.compositeMs = 0;
          perfState.fps = 0;
          perfState.ms = 0;
          perfState.since = performance.now();
          frame = requestAnimationFrame(tick);
          ctx.status('Animating func and activation data every frame');
        } else {
          stopAnimation();
          ctx.status('Animation stopped');
        }
        showPerf();
      }
    });
    note(compositingSection, 'While animating, both data layers receive new values every frame and the edge print reports frames per second and the time spent compositing each frame.');

    // ── Hover
    const onHover = (event: { surfaceId: string | null; vertexIndex: number | null }) => {
      const index = event.vertexIndex;
      if (event.surfaceId !== 'lh' || index === null) {
        film.set('br', 'cursor', 'Vertex', '—');
        film.set('br', 'func', 'Func', '—');
        film.set('br', 'activation', 'Activation', '—');
        return;
      }
      const funcValue = metric.values[index]!;
      const actValue = activation[index]!;
      film.set('br', 'cursor', 'Vertex', `L ${index}`);
      film.set('br', 'func', 'Func', `${fmt(funcValue, 3)}${funcValue <= state.threshold.func ? ' (hidden)' : ''}`);
      film.set('br', 'activation', 'Activation', `${fmt(actValue, 2)}${actValue <= state.threshold.activation ? ' (hidden)' : ''}`);
    };
    viewer.on('vertex:hover', onHover);
    onHover({ surfaceId: null, vertexIndex: null });

    refresh();
    ctx.setBusy(false);
    return () => {
      stopAnimation();
      viewer.off('vertex:hover', onHover);
      cleanup();
    };
  }
};
