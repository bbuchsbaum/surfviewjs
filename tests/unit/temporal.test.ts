/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TemporalDataLayer } from '../../src/temporal/TemporalDataLayer';
import { TimelineController } from '../../src/temporal/TimelineController';
import { SparklineOverlay } from '../../src/temporal/SparklineOverlay';

// ──────────────────────────────────────────────────────
// TemporalDataLayer
// ──────────────────────────────────────────────────────
describe('TemporalDataLayer', () => {
  function makeFrames(T: number, V: number): Float32Array[] {
    return Array.from({ length: T }, (_, t) => {
      const f = new Float32Array(V);
      for (let v = 0; v < V; v++) f[v] = t * 10 + v;
      return f;
    });
  }

  const times3 = [0, 0.5, 1.0];
  const frames3 = makeFrames(3, 5); // 3 frames, 5 vertices

  it('constructs with valid input', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    expect(layer.id).toBe('t1');
    expect(layer.getFrameCount()).toBe(3);
    expect(layer.getVertexCount()).toBe(5);
  });

  it('throws on empty frames', () => {
    expect(() => new TemporalDataLayer('t', [], [0], 'jet', {})).toThrow();
  });

  it('throws on times/frames length mismatch', () => {
    expect(() =>
      new TemporalDataLayer('t', frames3, [0, 1], 'jet', {})
    ).toThrow();
  });

  it('throws on inconsistent frame vertex counts', () => {
    const bad = [new Float32Array(5), new Float32Array(3)];
    expect(() =>
      new TemporalDataLayer('t', bad, [0, 1], 'jet', {})
    ).toThrow();
  });

  it('throws on unsorted times', () => {
    const unsorted = [1.0, 0.5, 0];
    expect(() =>
      new TemporalDataLayer('t', frames3, unsorted, 'jet', {})
    ).toThrow();
  });

  it('throws on factor assignment length mismatch', () => {
    expect(() =>
      new TemporalDataLayer('t', frames3, times3, 'jet', {
        factor: { name: 'cond', levels: ['A', 'B'], assignment: [0, 1] } // needs 3
      })
    ).toThrow();
  });

  it('initializes data to first frame', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    const data = layer.getData();
    expect(data).not.toBeNull();
    // First frame: [0, 1, 2, 3, 4]
    expect(data![0]).toBe(0);
    expect(data![4]).toBe(4);
  });

  it('setTime interpolates correctly at alpha=0', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    layer.setTime(0, 1, 0); // pure frame 0
    const data = layer.getData()!;
    expect(data[0]).toBeCloseTo(0);
    expect(data[4]).toBeCloseTo(4);
  });

  it('setTime interpolates correctly at alpha=1', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    layer.setTime(0, 1, 1); // pure frame 1
    const data = layer.getData()!;
    // Frame 1: [10, 11, 12, 13, 14]
    expect(data[0]).toBeCloseTo(10);
    expect(data[4]).toBeCloseTo(14);
  });

  it('setTime interpolates correctly at alpha=0.5', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    layer.setTime(0, 1, 0.5);
    const data = layer.getData()!;
    // Midpoint: (0+10)/2=5, (4+14)/2=9
    expect(data[0]).toBeCloseTo(5);
    expect(data[4]).toBeCloseTo(9);
  });

  it('setTime between last two frames', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    layer.setTime(1, 2, 0.5);
    const data = layer.getData()!;
    // Frame1[0]=10, Frame2[0]=20 -> midpoint = 15
    expect(data[0]).toBeCloseTo(15);
  });

  it('getRGBAData returns correct length', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {
      range: [0, 25]
    });
    const rgba = layer.getRGBAData(5);
    expect(rgba.length).toBe(5 * 4);
  });

  it('getTimeSeries extracts per-vertex series', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    const series = layer.getTimeSeries(0);
    expect(series.length).toBe(3);
    // Vertex 0 across frames: [0, 10, 20]
    expect(series[0]).toBe(0);
    expect(series[1]).toBe(10);
    expect(series[2]).toBe(20);
  });

  it('getTimeSeries for last vertex', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    const series = layer.getTimeSeries(4);
    // Vertex 4 across frames: [4, 14, 24]
    expect(series[0]).toBe(4);
    expect(series[1]).toBe(14);
    expect(series[2]).toBe(24);
  });

  it('getTimes returns a copy', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    const t = layer.getTimes();
    expect(t).toEqual([0, 0.5, 1.0]);
    t[0] = 999;
    expect(layer.getTimes()[0]).toBe(0); // original unchanged
  });

  it('getFactorDescriptor returns null when none provided', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    expect(layer.getFactorDescriptor()).toBeNull();
  });

  it('getFactorDescriptor returns descriptor when provided', () => {
    const factor = { name: 'cond', levels: ['A', 'B'], assignment: [0, 1, 0] };
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {
      factor
    });
    expect(layer.getFactorDescriptor()).toEqual(factor);
  });

  it('handles single-frame edge case', () => {
    const singleFrame = [new Float32Array([1, 2, 3])];
    const layer = new TemporalDataLayer('t1', singleFrame, [0], 'jet', {});
    expect(layer.getFrameCount()).toBe(1);
    layer.setTime(0, 0, 0);
    expect(layer.getData()![0]).toBeCloseTo(1);
  });

  it('dispose cleans up', () => {
    const layer = new TemporalDataLayer('t1', frames3, times3, 'jet', {});
    layer.dispose();
    expect(layer.getFrameCount()).toBe(0);
  });
});

// ──────────────────────────────────────────────────────
// TimelineController
// ──────────────────────────────────────────────────────
describe('TimelineController', () => {
  const times = [0, 0.5, 1.0, 1.5, 2.0];

  it('constructs with valid times', () => {
    const tc = new TimelineController(times);
    const state = tc.getState();
    expect(state.currentTime).toBe(0);
    expect(state.playing).toBe(false);
    expect(state.speed).toBe(1);
    expect(state.loopMode).toBe('loop');
  });

  it('throws on empty times', () => {
    expect(() => new TimelineController([])).toThrow();
  });

  it('seek clamps to range', () => {
    const tc = new TimelineController(times);
    tc.seek(5);
    expect(tc.getState().currentTime).toBe(2.0);
    tc.seek(-1);
    expect(tc.getState().currentTime).toBe(0);
  });

  it('seek emits timechange', () => {
    const tc = new TimelineController(times);
    const fn = vi.fn();
    tc.on('timechange', fn);
    tc.seek(1.0);
    expect(fn).toHaveBeenCalledTimes(1);
    const event = fn.mock.calls[0][0];
    expect(event.time).toBe(1.0);
    expect(event.frameA).toBe(2);
    expect(event.frameB).toBe(2);
    expect(event.alpha).toBe(0);
  });

  it('seek to midpoint gives correct frameA/frameB/alpha', () => {
    const tc = new TimelineController(times);
    const fn = vi.fn();
    tc.on('timechange', fn);
    tc.seek(0.75);
    const event = fn.mock.calls[0][0];
    expect(event.frameA).toBe(1);
    expect(event.frameB).toBe(2);
    expect(event.alpha).toBeCloseTo(0.5);
  });

  it('play emits play event', () => {
    const tc = new TimelineController(times);
    const fn = vi.fn();
    tc.on('play', fn);
    tc.play();
    expect(fn).toHaveBeenCalledTimes(1);
    tc.dispose();
  });

  it('pause emits pause event', () => {
    const tc = new TimelineController(times);
    const fn = vi.fn();
    tc.on('pause', fn);
    tc.play();
    tc.pause();
    expect(fn).toHaveBeenCalledTimes(1);
    tc.dispose();
  });

  it('stop resets to beginning', () => {
    const tc = new TimelineController(times);
    tc.seek(1.5);
    tc.stop();
    expect(tc.getState().currentTime).toBe(0);
    expect(tc.getState().playing).toBe(false);
  });

  it('toggle alternates play/pause', () => {
    const tc = new TimelineController(times);
    tc.toggle();
    expect(tc.getState().playing).toBe(true);
    tc.toggle();
    expect(tc.getState().playing).toBe(false);
    tc.dispose();
  });

  it('setSpeed updates speed', () => {
    const tc = new TimelineController(times);
    tc.setSpeed(2.5);
    expect(tc.getState().speed).toBe(2.5);
  });

  it('setSpeed clamps to minimum', () => {
    const tc = new TimelineController(times);
    tc.setSpeed(-1);
    expect(tc.getState().speed).toBe(0.01);
  });

  it('setLoop changes loop mode', () => {
    const tc = new TimelineController(times);
    tc.setLoop('bounce');
    expect(tc.getState().loopMode).toBe('bounce');
    tc.setLoop('none');
    expect(tc.getState().loopMode).toBe('none');
  });

  it('resolves frame boundaries correctly', () => {
    const tc = new TimelineController(times);
    // At exact frame time
    tc.seek(0.5);
    const state = tc.getState();
    expect(state.frameA).toBe(1);
    expect(state.frameB).toBe(1);
    expect(state.alpha).toBe(0);
  });

  it('resolves at time=0 correctly', () => {
    const tc = new TimelineController(times);
    tc.seek(0);
    const state = tc.getState();
    expect(state.frameA).toBe(0);
    expect(state.frameB).toBe(0);
    expect(state.alpha).toBe(0);
  });

  it('resolves at time=max correctly', () => {
    const tc = new TimelineController(times);
    tc.seek(2.0);
    const state = tc.getState();
    expect(state.frameA).toBe(4);
    expect(state.frameB).toBe(4);
    expect(state.alpha).toBe(0);
  });

  it('autoPlay starts playing', () => {
    const tc = new TimelineController(times, { autoPlay: true });
    expect(tc.getState().playing).toBe(true);
    tc.dispose();
  });

  it('dispose stops playback and removes listeners', () => {
    const tc = new TimelineController(times);
    tc.play();
    tc.dispose();
    expect(tc.getState().playing).toBe(false);
  });

  it('constructor options set speed and loop', () => {
    const tc = new TimelineController(times, { speed: 2, loop: 'bounce' });
    expect(tc.getState().speed).toBe(2);
    expect(tc.getState().loopMode).toBe('bounce');
  });
});

// ──────────────────────────────────────────────────────
// SparklineOverlay
// ──────────────────────────────────────────────────────
describe('SparklineOverlay', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    container.style.position = 'relative';
    document.body.appendChild(container);
    // Mock getBoundingClientRect
    container.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: 0, toJSON: () => {}
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('creates canvas element inside container', () => {
    const overlay = new SparklineOverlay(container);
    const canvases = container.querySelectorAll('canvas');
    expect(canvases.length).toBe(1);
    overlay.dispose();
  });

  it('canvas is hidden by default', () => {
    const overlay = new SparklineOverlay(container);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.display).toBe('none');
    overlay.dispose();
  });

  it('show makes canvas visible', () => {
    const overlay = new SparklineOverlay(container);
    const series = new Float32Array([0, 0.5, 1, 0.5, 0]);
    const showTimes = [0, 0.25, 0.5, 0.75, 1.0];
    overlay.show(series, showTimes, 0.5, 100, 100);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.display).toBe('block');
    overlay.dispose();
  });

  it('hide makes canvas invisible', () => {
    const overlay = new SparklineOverlay(container);
    const series = new Float32Array([0, 1]);
    overlay.show(series, [0, 1], 0, 100, 100);
    overlay.hide();
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.display).toBe('none');
    overlay.dispose();
  });

  it('updateTimeMarker does not throw when not shown', () => {
    const overlay = new SparklineOverlay(container);
    expect(() => overlay.updateTimeMarker(0.5)).not.toThrow();
    overlay.dispose();
  });

  it('updateTimeMarker works after show', () => {
    const overlay = new SparklineOverlay(container);
    const series = new Float32Array([0, 0.5, 1]);
    overlay.show(series, [0, 0.5, 1], 0, 200, 200);
    expect(() => overlay.updateTimeMarker(0.75)).not.toThrow();
    overlay.dispose();
  });

  it('dispose removes canvas from DOM', () => {
    const overlay = new SparklineOverlay(container);
    overlay.dispose();
    expect(container.querySelectorAll('canvas').length).toBe(0);
  });

  it('respects custom options', () => {
    const overlay = new SparklineOverlay(container, {
      width: 300,
      height: 120,
      lineColor: '#ff0000'
    });
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(120);
    overlay.dispose();
  });
});
