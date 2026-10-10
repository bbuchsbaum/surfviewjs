import { MultiLayerNeuroSurface, SparklineOverlay, TemporalDataLayer, TimelineController } from '@src/index.js';
import type { AnatomicalView, VertexHoverEvent } from '@src/index.js';
import excerpt from '../excerpts/timeSeries.ts?raw';
import { action, actions, choice, fmt, readout, section, slider } from '../kit/controls';
import { FOCI, blobField, curvatureOf, loadBilateral, mirror, seededRandom, smoothNoise } from '../kit/data';
import { createFilmViewer } from '../kit/film';
import type { Scenario } from '../types';
import './timeSeries.css';

/** One run: 100 volumes at TR = 1 s, alternating visual and motor blocks with rest between. */
const FRAMES = 100;
const TR = 1;
const BLOCKS: ReadonlyArray<{ condition: 'visual' | 'motor'; start: number; end: number }> = [
  { condition: 'visual', start: 8, end: 20 },
  { condition: 'motor', start: 28, end: 40 },
  { condition: 'visual', start: 48, end: 60 },
  { condition: 'motor', start: 68, end: 80 }
];

const VIEWS: ReadonlyArray<{ value: AnatomicalView; label: string }> = [
  { value: 'posterior', label: 'Posterior' },
  { value: 'dorsal', label: 'Dorsal' },
  { value: 'lateral', label: 'Lateral' }
];

/** Frame the chapter opens on: inside the first visual block, near its response peak. */
const OPEN_FRAME = 16;

/** Plot frame of the time-course figure; the overlay canvas sits at its origin. */
const TRACE = { width: 272, height: 96, padding: 8, left: 44, top: 14, bottom: 34 } as const;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The time-course figure in the margin: stimulus blocks and axes drawn in SVG beneath the
 * SparklineOverlay canvas (which has no axes of its own), with value labels that follow the
 * overlay's own min–max scaling of the plotted series.
 */
function traceFigure(parent: HTMLElement) {
  const figure = document.createElement('figure');
  figure.className = 'ts-trace';
  const frame = document.createElement('div');
  frame.className = 'ts-trace-frame';
  const svg = document.createElementNS(SVG_NS, 'svg');
  const fullWidth = TRACE.left + TRACE.width, fullHeight = TRACE.top + TRACE.height + TRACE.bottom;
  svg.setAttribute('viewBox', `0 0 ${fullWidth} ${fullHeight}`);
  svg.setAttribute('width', String(fullWidth));
  svg.setAttribute('height', String(fullHeight));
  svg.setAttribute('aria-hidden', 'true');
  const host = document.createElement('div');
  host.className = 'ts-trace-plot';
  const caption = document.createElement('figcaption');
  caption.id = 'ts-trace-caption';
  frame.append(svg, host);
  figure.append(frame, caption);
  parent.append(figure);

  const plotLeft = TRACE.left + TRACE.padding, plotWidth = TRACE.width - TRACE.padding * 2;
  const plotTop = TRACE.top + TRACE.padding, plotBottom = TRACE.top + TRACE.height - TRACE.padding;
  const x = (time: number) => plotLeft + (time / ((FRAMES - 1) * TR)) * plotWidth;
  const add = (tag: string, attributes: Record<string, string | number>, text?: string) => {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    if (text !== undefined) element.textContent = text;
    svg.append(element);
    return element;
  };
  for (const block of BLOCKS) {
    add('rect', { class: 'ts-band', x: x(block.start), y: plotTop, width: x(block.end) - x(block.start), height: plotBottom - plotTop });
    add('text', { class: 'ts-band-label', x: (x(block.start) + x(block.end)) / 2, y: TRACE.top - 4, 'text-anchor': 'middle' }, block.condition);
  }
  add('line', { class: 'ts-axis', x1: plotLeft, x2: plotLeft + plotWidth, y1: plotBottom + 3, y2: plotBottom + 3 });
  add('line', { class: 'ts-axis', x1: plotLeft - 3, x2: plotLeft - 3, y1: plotTop, y2: plotBottom });
  for (const tick of [0, 20, 40, 60, 80]) {
    add('line', { class: 'ts-axis', x1: x(tick), x2: x(tick), y1: plotBottom + 3, y2: plotBottom + 6 });
    add('text', { class: 'ts-tick', x: x(tick), y: plotBottom + 16, 'text-anchor': 'middle' }, String(tick));
  }
  add('text', { class: 'ts-tick', x: plotLeft + plotWidth / 2, y: plotBottom + 29, 'text-anchor': 'middle' }, 'time (s)');
  const maxLabel = add('text', { class: 'ts-tick', x: plotLeft - 7, y: plotTop + 4, 'text-anchor': 'end' });
  const minLabel = add('text', { class: 'ts-tick', x: plotLeft - 7, y: plotBottom, 'text-anchor': 'end' });
  const zero = add('line', { class: 'ts-zero', x1: plotLeft, x2: plotLeft + plotWidth });
  add('text', { class: 'ts-unit', x: 4, y: (plotTop + plotBottom) / 2 + 3 }, '%');

  return {
    host,
    label(series: Float32Array, vertex: string) {
      let min = Infinity, max = -Infinity;
      for (const value of series) { if (value < min) min = value; if (value > max) max = value; }
      if (max === min) max = min + 1;
      maxLabel.textContent = fmt(max, 1);
      minLabel.textContent = fmt(min, 1);
      const zeroY = plotBottom - ((0 - min) / (max - min)) * (plotBottom - plotTop);
      zero.setAttribute('y1', String(zeroY));
      zero.setAttribute('y2', String(zeroY));
      zero.setAttribute('visibility', min < 0 && max > 0 ? 'visible' : 'hidden');
      caption.textContent = `${vertex} · % signal change`;
    }
  };
}

function blockAt(time: number): string {
  return BLOCKS.find(block => time >= block.start && time < block.end)?.condition ?? 'rest';
}

function gammaPdf(t: number, shape: number): number {
  if (t <= 0) return 0;
  let factorial = 1;
  for (let i = 2; i < shape; i++) factorial *= i;
  return (t ** (shape - 1) * Math.exp(-t)) / factorial;
}

/** Canonical double-gamma haemodynamic response sampled at the TR, peak-normalised. */
function predictedResponse(condition: 'visual' | 'motor'): Float32Array {
  const kernel = Array.from({ length: 32 }, (_, i) => gammaPdf(i * TR, 6) - gammaPdf(i * TR, 16) / 6);
  const boxcar = Array.from({ length: FRAMES }, (_, i) =>
    BLOCKS.some(block => block.condition === condition && i * TR >= block.start && i * TR < block.end) ? 1 : 0
  );
  const response = new Float32Array(FRAMES);
  for (let t = 0; t < FRAMES; t++) {
    let sum = 0;
    for (let k = 0; k < kernel.length && k <= t; k++) sum += kernel[k]! * boxcar[t - k]!;
    response[t] = sum;
  }
  const peak = Math.max(...response);
  return response.map(value => value / peak);
}

/**
 * Synthetic BOLD (% signal change): visual blocks drive both occipital poles, right-hand
 * motor blocks drive the left hand knob (weaker on the right), the posterior cingulate
 * deactivates during either task, plus spatially smooth AR(1) noise. Seeded.
 */
function synthesise(vertices: Float32Array, side: 'left' | 'right', visual: Float32Array, motor: Float32Array): Float32Array[] {
  const at = (point: readonly [number, number, number]) => (side === 'left' ? point : mirror(point));
  const wVisual = blobField(vertices, [{ center: at(FOCI.primaryVisual), amplitude: 1.4, sigma: 14 }]);
  const wMotor = blobField(vertices, [{ center: at(FOCI.motorHand), amplitude: side === 'left' ? 1.25 : 0.4, sigma: 10 }]);
  const wDefault = blobField(vertices, [{ center: at(FOCI.posteriorCingulate), amplitude: -0.55, sigma: 11 }]);
  const seedBase = side === 'left' ? 401 : 433;
  const fields = [0, 1, 2, 3].map(i => smoothNoise(vertices, seedBase + i, 1, 36));
  const random = seededRandom(seedBase + 17);
  const coefficients = fields.map(() => 0);
  const frames: Float32Array[] = [];
  for (let t = 0; t < FRAMES; t++) {
    for (let k = 0; k < coefficients.length; k++) coefficients[k] = 0.7 * coefficients[k]! + 0.12 * (random() * 2 - 1);
    const frame = new Float32Array(vertices.length / 3);
    const task = Math.max(visual[t]!, motor[t]!);
    for (let v = 0; v < frame.length; v++) {
      let noise = 0;
      for (let k = 0; k < fields.length; k++) noise += coefficients[k]! * fields[k]![v]!;
      frame[v] = wVisual[v]! * visual[t]! + wMotor[v]! * motor[t]! + wDefault[v]! * task + noise;
    }
    frames.push(frame);
  }
  return frames;
}

export const timeSeries: Scenario = {
  id: 'time-series',
  aliases: ['temporal-playback'],
  title: 'Time series',
  short: 'Time series',
  group: 'surfaces',
  tags: ['temporal', 'playback', 'timeline', 'sparkline', 'block design'],
  summary:
    'A 100-volume block-design run on both fsaverage5 hemispheres, played as a temporal data layer. Play, pause, stop, scrub to any time, set the playback rate and loop mode. The margin plots one vertex’s time course against the stimulus blocks, with the playhead marked; hover the cortex to plot another. Time, frame and the current block print in the lower corner.',
  synthetic:
    'The run is simulated: visual blocks drive both occipital poles, right-hand motor blocks drive the left hand knob (weakly the right), the posterior cingulate deactivates during either task, convolved with a canonical double-gamma response, plus seeded smooth noise. Not a recording.',
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fsaverage5 hemispheres');
    const { viewer, cleanup } = createFilmViewer(ctx.mount, { hoverCrosshair: false });
    const { left, right } = await loadBilateral();
    const times = Array.from({ length: FRAMES }, (_, i) => i * TR);
    const span = times[times.length - 1]! - times[0]!;
    const visual = predictedResponse('visual');
    const motor = predictedResponse('motor');
    ctx.setBusy(true, 'Simulating the run');

    const surfaces = new Map<'lh' | 'rh', MultiLayerNeuroSurface>();
    const layers = new Map<'lh' | 'rh', TemporalDataLayer>();
    for (const [id, geometry, hemisphere, mesh] of [
      ['lh', left, 'left', 'fsaverage5Left'],
      ['rh', right, 'right', 'fsaverage5Right']
    ] as const) {
      const surface = new MultiLayerNeuroSurface(geometry, {
        baseColor: 0xb7c0c8,
        curvature: curvatureOf(mesh, geometry),
        showCurvature: true,
        curvatureOptions: { brightness: 0.64, contrast: 0.42 }
      });
      surface.hemisphere = hemisphere;
      viewer.addSurface(surface, id);
      const layer = new TemporalDataLayer('bold', synthesise(geometry.vertices, hemisphere, visual, motor), times, 'coolwarm', {
        range: [-1.5, 1.5],
        threshold: [-0.2, 0.2],
        presentation: { label: 'Synthetic BOLD', units: '% signal' }
      });
      viewer.addLayer(id, layer);
      surfaces.set(id, surface);
      layers.set(id, layer);
    }
    viewer.registerBilateralSurfaceGroup({ id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' });
    const showView = (view: AnatomicalView) => {
      viewer.setAnatomicalView(view, { layout: 'paired', groupId: 'cortex', fit: true });
      viewer.fitToView({ padding: 0.05 });
    };
    showView('posterior');

    const film = ctx.film;
    film.trackOrientation(viewer);
    film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L + R');
    film.set('tl', 'run', 'Run', `${FRAMES} vols, TR ${fmt(TR, 1)} s`);
    film.set('tr', 'layer', 'Layer', 'Synthetic BOLD (% signal)');

    const timeline = new TimelineController(times, { speed: 8 / span, loop: 'loop' });
    // Until the cursor finds a vertex, plot the left occipital vertex with the largest visual response.
    const lh = layers.get('lh')!;
    let peak = 0, peakValue = -Infinity;
    for (let v = 0; v < lh.getVertexCount(); v++) {
      const value = lh.getTimeSeries(v)[OPEN_FRAME]!;
      if (value > peakValue) { peakValue = value; peak = v; }
    }
    let hovered: { id: 'lh' | 'rh'; vertex: number } = { id: 'lh', vertex: peak };

    const playback = section(ctx.panel, 'Playback');
    const row = actions(playback);
    const play = action(row, {
      id: 'ts-play',
      label: 'Play',
      kind: 'primary',
      onClick: () => timeline.toggle()
    });
    action(row, { id: 'ts-stop', label: 'Stop', onClick: () => timeline.stop() });
    const scrub = slider(playback, {
      id: 'ts-time',
      label: 'Time',
      min: 0, max: span, step: 0.5, value: OPEN_FRAME * TR,
      format: value => `${fmt(value, 1)} s`,
      onInput: value => timeline.seek(value)
    });
    const frameReadout = readout(playback, 'Frame', 'ts-frame');
    const blockReadout = readout(playback, 'Block', 'ts-block');
    slider(playback, {
      id: 'ts-rate',
      label: 'Playback rate (× real time)',
      min: 1, max: 30, step: 1, value: 8,
      format: value => `${value}×`,
      print: { film, corner: 'tr', key: 'rate', label: 'Rate' },
      onInput: value => timeline.setSpeed(value / span)
    });
    choice(playback, {
      id: 'ts-loop',
      label: 'At the end of the run',
      options: [
        { value: 'loop', label: 'Loop' },
        { value: 'bounce', label: 'Bounce' },
        { value: 'none', label: 'Hold at end' }
      ] as const,
      value: 'loop',
      print: { film, corner: 'tr', key: 'loop', label: 'End' },
      onChange: mode => timeline.setLoop(mode)
    });

    const course = section(ctx.panel, 'Time course');
    const trace = traceFigure(course);
    const sparkline = new SparklineOverlay(trace.host, {
      width: TRACE.width,
      height: TRACE.height,
      padding: TRACE.padding,
      lineColor: '#edf2f5',
      bgColor: 'rgba(0, 0, 0, 0)',
      timeMarkerColor: '#f2c230'
    });
    const plot = () => {
      const series = layers.get(hovered.id)!.getTimeSeries(hovered.vertex);
      trace.label(series, `${hovered.id.toUpperCase()} ${hovered.vertex}`);
      // The overlay offsets itself 12 px from the point it is given; this pins it to the plot frame.
      const box = trace.host.getBoundingClientRect();
      sparkline.show(series, times, timeline.getState().currentTime, box.left - 12, box.top - 12);
    };

    const view = section(ctx.panel, 'View');
    choice(view, {
      id: 'ts-view',
      label: 'Anatomical view',
      options: VIEWS,
      value: 'posterior',
      print: { film, corner: 'tr', key: 'view', label: 'View' },
      onChange: next => {
        showView(next);
        ctx.status(`View: ${next}`);
      }
    });

    const printVertex = (time: number) => {
      const series = layers.get(hovered.id)!.getTimeSeries(hovered.vertex);
      const frame = Math.min(FRAMES - 1, Math.round(time / TR));
      film.set('br', 'vertex', 'Vertex', `${hovered.id.toUpperCase()} ${hovered.vertex}`);
      film.set('br', 'value', 'Value', `${fmt(series[frame]!)} %`);
    };

    const onTime = (event: { time: number; frameA: number; frameB: number; alpha: number }) => {
      for (const [id, layer] of layers) {
        layer.setTime(event.frameA, event.frameB, event.alpha);
        surfaces.get(id)!.requestColorUpdate();
      }
      sparkline.updateTimeMarker(event.time);
      scrub.set(Math.round(event.time * 2) / 2);
      const frame = `${Math.min(FRAMES, Math.floor(event.time / TR) + 1)} / ${FRAMES}`;
      const block = blockAt(event.time);
      frameReadout.set(frame);
      blockReadout.set(block);
      film.set('bl', 'time', 'Time', `${fmt(event.time, 1)} s`);
      film.set('bl', 'frame', 'Frame', frame);
      film.set('bl', 'block', 'Block', block);
      printVertex(event.time);
    };
    const onPlay = () => { play.textContent = 'Pause'; ctx.status('Playing'); };
    const onPause = () => { play.textContent = 'Play'; ctx.status('Paused'); };
    const onStop = () => { play.textContent = 'Play'; ctx.status('Stopped at 0 s'); };
    const unsubscribe = [
      timeline.on('timechange', onTime),
      timeline.on('play', onPlay),
      timeline.on('pause', onPause),
      timeline.on('stop', onStop)
    ];

    const onHover = (event: VertexHoverEvent) => {
      const id = event.surfaceId as 'lh' | 'rh' | null;
      // Leaving the cortex keeps the last vertex plotted.
      if (!id || event.vertexIndex === null || !layers.has(id)) return;
      if (id === hovered.id && event.vertexIndex === hovered.vertex) return;
      hovered = { id, vertex: event.vertexIndex };
      plot();
      printVertex(timeline.getState().currentTime);
    };
    viewer.on('vertex:hover', onHover);
    plot();
    // Open inside the first visual block, near the response peak, so the map is visible at rest.
    timeline.seek(OPEN_FRAME * TR);

    const vertexCount = (left.vertices.length + right.vertices.length) / 3;
    ctx.perf(`${FRAMES} frames × ${vertexCount.toLocaleString('en-US')} vertices`);
    ctx.setBusy(false);
    return () => {
      viewer.off('vertex:hover', onHover);
      for (const off of unsubscribe) off();
      timeline.dispose();
      sparkline.dispose();
      cleanup();
    };
  }
};
