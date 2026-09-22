/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventEmitter } from '../../src/EventEmitter';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import { PluginHost } from '../../src/PluginHost';
import type { ViewerEventMap } from '../../src/events';

type Listener = (event: Event) => void;

class ListenerTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback = typeof listener === 'function'
      ? listener as Listener
      : listener.handleEvent.bind(listener);
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== 'function') return;
    this.listeners.get(type)?.delete(listener as Listener);
  }

  dispatch(type: string, event: Event = new Event(type)): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }

  count(type?: string): number {
    if (type) return this.listeners.get(type)?.size ?? 0;
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

interface FakeFrames {
  readonly request: ReturnType<typeof vi.fn>;
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly callbacks: Map<number, FrameRequestCallback>;
  flush(timestamp?: number): void;
}

function installFakeFrames(): FakeFrames {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => callbacks.delete(id));
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return {
    request,
    cancel,
    callbacks,
    flush(timestamp = 16) {
      const next = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!next) throw new Error('No animation frame is pending');
      callbacks.delete(next[0]);
      next[1](timestamp);
    }
  };
}

interface ViewerHarness {
  readonly viewer: NeuroSurfaceViewer;
  readonly canvas: ListenerTarget;
  readonly controls: ListenerTarget & {
    target: THREE.Vector3;
    enabled: boolean;
    staticMoving: boolean;
    update: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  readonly render: ReturnType<typeof vi.fn>;
}

function makeViewerHarness(options: { attachListeners?: boolean } = {}): ViewerHarness {
  const viewer = new EventEmitter<ViewerEventMap>() as unknown as NeuroSurfaceViewer;
  Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
  const mutable = viewer as any;
  const canvas = new ListenerTarget();
  const controlsTarget = new ListenerTarget();
  const controls = Object.assign(controlsTarget, {
    target: new THREE.Vector3(),
    enabled: true,
    staticMoving: true,
    update: vi.fn(),
    dispose: vi.fn()
  });
  const render = vi.fn();

  mutable.disposed = false;
  mutable.initializationFailed = false;
  mutable.renderingPaused = false;
  mutable.frameRunning = false;
  mutable.controlsInteractionActive = false;
  mutable.controlsSettling = false;
  mutable.controlsChangedDuringFrame = false;
  mutable.animationId = null;
  mutable.needsRender = false;
  mutable.animate = NeuroSurfaceViewer.prototype.animate.bind(viewer);
  mutable.handleSurfaceClick = vi.fn();
  mutable.handleMouseMove = vi.fn();
  mutable.onControlsChange = NeuroSurfaceViewer.prototype.onControlsChange.bind(viewer);
  mutable.onControlsStart = (NeuroSurfaceViewer.prototype as any).onControlsStart.bind(viewer);
  mutable.onControlsEnd = (NeuroSurfaceViewer.prototype as any).onControlsEnd.bind(viewer);
  mutable.cameraInteractionEnabled = true;
  mutable.camera = new THREE.PerspectiveCamera();
  mutable.cameraControls = controls;
  mutable.renderer = {
    domElement: canvas,
    render,
    dispose: vi.fn(),
    forceContextLoss: vi.fn(() => canvas.dispatch('webglcontextlost'))
  };
  mutable.config = { useShaders: false };
  mutable.surfaces = new Map();
  mutable.scene = new THREE.Scene();
  mutable.composer = { dispose: vi.fn() };
  mutable.ssaoPass = null;
  mutable.gpuPicker = null;
  mutable.environmentMap = null;
  mutable.crosshair = { visible: false, dispose: vi.fn() };
  mutable.annotations = { removeBySurface: vi.fn(), dispose: vi.fn() };
  mutable.plugins = new PluginHost(viewer);
  mutable.pendingStateDomains = new Set();
  mutable.stateChangeBatchDepth = 0;
  mutable.stateRevision = 0;
  mutable.inspectionSelection = Object.freeze({ kind: 'none' });
  mutable.bilateralSurfaceGroups = new Map();
  mutable.surfaceGroupMembership = new Map();
  mutable.surfaceSubscriptions = new Map();
  mutable.selectedSurfaceId = null;
  mutable.selectedLayerId = null;
  mutable.currentAnatomicalView = null;
  mutable.render = render;

  if (options.attachListeners) {
    (viewer as any).setupContextLossHandling();
    (viewer as any).attachControlListeners();
    canvas.addEventListener('click', mutable.handleSurfaceClick);
    canvas.addEventListener('mousemove', mutable.handleMouseMove);
  }
  return { viewer, canvas, controls, render };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NeuroSurfaceViewer frame ownership', () => {
  it('coalesces invalidations and becomes RAF-silent after one settled frame', () => {
    const frames = installFakeFrames();
    const { viewer, render } = makeViewerHarness();
    const needed = vi.fn();
    viewer.on('render:needed', needed);

    viewer.requestRender();
    viewer.requestRender();
    viewer.requestRender();

    expect(frames.callbacks.size).toBe(1);
    expect(frames.request).toHaveBeenCalledOnce();
    expect(needed).toHaveBeenCalledOnce();

    frames.flush();

    expect(render).toHaveBeenCalledOnce();
    expect(frames.callbacks.size).toBe(0);
  });

  it('keeps frames only while Trackball interaction or damping changes the camera', () => {
    const frames = installFakeFrames();
    const { controls, render } = makeViewerHarness({ attachListeners: true });
    let updates = 0;
    controls.staticMoving = false;
    controls.update.mockImplementation(() => {
      updates += 1;
      if (updates <= 2) controls.dispatch('change');
    });

    controls.dispatch('start');
    controls.dispatch('end');
    frames.flush(16);
    expect(frames.callbacks.size).toBe(1);
    frames.flush(32);
    expect(frames.callbacks.size).toBe(1);
    frames.flush(48);

    expect(render).toHaveBeenCalledTimes(2);
    expect(frames.callbacks.size).toBe(0);
  });

  it('pauses on context loss and restores at most one frame for a live viewer', () => {
    const frames = installFakeFrames();
    const { viewer, canvas, render } = makeViewerHarness({ attachListeners: true });
    const lost = vi.fn();
    const restored = vi.fn();
    viewer.on('context:lost', lost);
    viewer.on('context:restored', restored);

    viewer.requestRender();
    const pending = [...frames.callbacks.values()][0];
    const lossEvent = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatch('webglcontextlost', lossEvent);

    expect(lossEvent.defaultPrevented).toBe(true);
    expect(lost).toHaveBeenCalledOnce();
    expect(frames.callbacks.size).toBe(0);
    viewer.requestRender();
    expect(frames.callbacks.size).toBe(0);

    canvas.dispatch('webglcontextrestored');
    canvas.dispatch('webglcontextrestored');
    expect(restored).toHaveBeenCalledOnce();
    expect(frames.callbacks.size).toBe(1);
    frames.flush();
    expect(render).toHaveBeenCalledOnce();

    pending(64);
    expect(render).toHaveBeenCalledOnce();
    expect(frames.callbacks.size).toBe(0);
  });

  it('removes every listener and rejects queued or late restart paths after disposal', () => {
    const frames = installFakeFrames();

    for (let iteration = 0; iteration < 5; iteration += 1) {
      const { viewer, canvas, controls, render } = makeViewerHarness({ attachListeners: true });
      expect(canvas.count()).toBe(4);
      expect(controls.count()).toBe(3);

      viewer.requestRender();
      const staleCallback = [...frames.callbacks.values()][0];
      viewer.dispose();
      viewer.dispose();

      expect(canvas.count()).toBe(0);
      expect(controls.count()).toBe(0);
      expect(frames.callbacks.size).toBe(0);
      expect(controls.dispose).toHaveBeenCalledOnce();

      viewer.start();
      viewer.requestRender();
      canvas.dispatch('webglcontextrestored');
      staleCallback(80);
      expect(render).not.toHaveBeenCalled();
      expect(frames.callbacks.size).toBe(0);
    }
  });

  it('stop pauses automatic rendering and start resumes with one coalesced frame', () => {
    const frames = installFakeFrames();
    const { viewer, render } = makeViewerHarness();

    viewer.stop();
    viewer.requestRender();
    expect(frames.callbacks.size).toBe(0);

    viewer.start();
    viewer.startRenderLoop();
    expect(frames.callbacks.size).toBe(1);
    frames.flush();
    expect(render).toHaveBeenCalledOnce();
    expect(frames.callbacks.size).toBe(0);
  });
});
