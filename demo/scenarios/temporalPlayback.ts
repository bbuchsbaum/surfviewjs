import {
  MultiLayerNeuroSurface,
  SurfaceGeometry,
  TemporalDataLayer,
  TimelineController,
  SparklineOverlay,
  computeMeanCurvature,
  normalizeCurvature,
  THREE
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

/**
 * Build a sphere with enough vertices to show spatial frequency gradients.
 */
function buildSphere(radius = 50, detail = 48): SurfaceGeometry {
  const geo = new THREE.SphereGeometry(radius, detail, detail);
  const vertices = new Float32Array(geo.attributes.position.array);
  const faces = new Uint32Array(geo.index?.array || []);
  return new SurfaceGeometry(vertices, faces, 'temporal-sphere');
}

/**
 * Generate synthetic oscillating brain data.
 * Each vertex has a sine wave with spatially-varying frequency and phase.
 */
function generateTemporalData(
  vertices: Float32Array,
  numFrames: number,
  duration: number
): { frames: Float32Array[]; times: number[] } {
  const V = vertices.length / 3;
  const frames: Float32Array[] = [];
  const times: number[] = [];

  for (let t = 0; t < numFrames; t++) {
    const time = (t / (numFrames - 1)) * duration;
    times.push(time);

    const frame = new Float32Array(V);
    for (let v = 0; v < V; v++) {
      const x = vertices[v * 3];
      const y = vertices[v * 3 + 1];
      const z = vertices[v * 3 + 2];

      // Spatial frequency gradient: varies with position
      const freq = 0.5 + Math.abs(y) * 0.02;
      const phase = (x + z) * 0.08;

      frame[v] = Math.sin(2 * Math.PI * freq * time + phase) * 0.5 + 0.5;
    }
    frames.push(frame);
  }

  return { frames, times };
}

export const temporalPlayback: Scenario = {
  id: 'temporal-playback',
  title: 'Temporal Playback + Sparklines',
  description:
    'Animated time-series data on a brain surface with playback controls and hover sparkline tooltips.',
  tags: ['temporal', 'animation', 'sparkline', 'playback'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building surface...');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    mount.style.position = 'relative';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      backgroundColor: 0x0a0a14,
      hoverCrosshair: true
    });

    // Geometry
    const geometry = buildSphere(50, 48);
    const vertexCount = geometry.vertices.length / 3;

    // Curvature for underlay
    const rawCurv = computeMeanCurvature(geometry);
    const curvData = normalizeCurvature(rawCurv, 98);

    // Temporal data: 60 frames over 2 seconds
    const numFrames = 60;
    const duration = 2; // seconds (in time-space)
    const { frames, times } = generateTemporalData(geometry.vertices, numFrames, duration);

    // Surface
    const surface = new MultiLayerNeuroSurface(geometry, {
      baseColor: 0x888888,
      curvature: curvData,
      showCurvature: true,
      curvatureOptions: { brightness: 0.5, contrast: 0.4 }
    });

    // Temporal layer
    const temporalLayer = new TemporalDataLayer(
      'activation',
      frames,
      times,
      'hot',
      {
        range: [0, 1],
        threshold: [0.15, 0],
        opacity: 0.85,
        order: 1
      }
    );
    surface.addLayer(temporalLayer);

    viewer.addSurface(surface, 'temporal-surface');
    viewer.centerCamera();

    // Timeline controller
    const timeline = new TimelineController(times, {
      speed: 0.5,
      loop: 'loop'
    });

    // Wire timeline -> layer -> render
    timeline.on('timechange', (e: { frameA: number; frameB: number; alpha: number }) => {
      temporalLayer.setTime(e.frameA, e.frameB, e.alpha);
      surface.requestColorUpdate();
    });

    // Sparkline overlay
    const sparkline = new SparklineOverlay(mount, {
      width: 220,
      height: 90,
      lineColor: '#ff8800',
      timeMarkerColor: '#ff2222'
    });

    // Wire hover -> sparkline
    viewer.on('vertex:hover', (e: { surfaceId: string | null; vertexIndex: number | null; screenX: number; screenY: number }) => {
      if (e.surfaceId && e.vertexIndex !== null) {
        const series = temporalLayer.getTimeSeries(e.vertexIndex);
        const state = timeline.getState();
        sparkline.show(series, times, state.currentTime, e.screenX, e.screenY);
      } else {
        sparkline.hide();
      }
    });

    // Update sparkline time marker during playback
    timeline.on('timechange', (e: { time: number }) => {
      sparkline.updateTimeMarker(e.time);
    });

    // ── Controls panel ──
    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Playback</h4>
        <div class="panel-controls" style="display: flex; gap: 6px; flex-wrap: wrap;">
          <button id="tp-play" class="primary">Play</button>
          <button id="tp-stop" class="ghost">Stop</button>
        </div>
        <div style="margin-top: 8px;">
          <label style="font-size: 11px;">Time:</label>
          <input type="range" id="tp-scrub" min="0" max="${duration}" step="${duration / 200}" value="0" style="width: 100%;">
          <span id="tp-time-label" style="font-size: 11px;">0.000s</span>
        </div>
      </div>
      <div class="panel-section">
        <h4>Speed</h4>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="range" id="tp-speed" min="0.1" max="3" step="0.1" value="0.5" style="flex: 1;">
          <span id="tp-speed-label" style="min-width: 35px; font-size: 11px;">0.5x</span>
        </div>
      </div>
      <div class="panel-section">
        <h4>Loop Mode</h4>
        <select id="tp-loop" style="width: 100%;">
          <option value="loop" selected>Loop</option>
          <option value="bounce">Bounce</option>
          <option value="none">None</option>
        </select>
      </div>
      <div class="panel-section">
        <h4>About</h4>
        <p style="font-size: 11px; color: #888;">
          ${numFrames} frames &times; ${vertexCount.toLocaleString()} vertices.<br>
          Hover surface to see vertex sparkline with playhead marker.
        </p>
      </div>
    `;

    const playBtn = ctx.panel.querySelector('#tp-play') as HTMLButtonElement;
    const stopBtn = ctx.panel.querySelector('#tp-stop') as HTMLButtonElement;
    const scrub = ctx.panel.querySelector('#tp-scrub') as HTMLInputElement;
    const timeLabel = ctx.panel.querySelector('#tp-time-label') as HTMLElement;
    const speedSlider = ctx.panel.querySelector('#tp-speed') as HTMLInputElement;
    const speedLabel = ctx.panel.querySelector('#tp-speed-label') as HTMLElement;
    const loopSelect = ctx.panel.querySelector('#tp-loop') as HTMLSelectElement;

    // Play / pause toggle
    playBtn?.addEventListener('click', () => {
      timeline.toggle();
      playBtn.textContent = timeline.getState().playing ? 'Pause' : 'Play';
    });

    stopBtn?.addEventListener('click', () => {
      timeline.stop();
      playBtn.textContent = 'Play';
    });

    // Scrubber
    let scrubbing = false;
    scrub?.addEventListener('pointerdown', () => { scrubbing = true; });
    scrub?.addEventListener('pointerup', () => { scrubbing = false; });
    scrub?.addEventListener('input', () => {
      timeline.seek(parseFloat(scrub.value));
    });

    // Speed
    speedSlider?.addEventListener('input', () => {
      const val = parseFloat(speedSlider.value);
      timeline.setSpeed(val);
      if (speedLabel) speedLabel.textContent = `${val.toFixed(1)}x`;
    });

    // Loop
    loopSelect?.addEventListener('change', () => {
      timeline.setLoop(loopSelect.value as 'none' | 'loop' | 'bounce');
    });

    // Sync scrubber with timeline
    timeline.on('timechange', (e: { time: number }) => {
      if (!scrubbing && scrub) {
        scrub.value = String(e.time);
      }
      if (timeLabel) {
        timeLabel.textContent = `${e.time.toFixed(3)}s`;
      }
    });

    ctx.status(`Ready - ${numFrames} frames, ${vertexCount.toLocaleString()} vertices`);

    return () => {
      timeline.dispose();
      sparkline.dispose();
      surface.dispose();
      cleanup();
      ctx.status('Idle');
    };
  }
};
