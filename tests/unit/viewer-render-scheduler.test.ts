import { describe, expect, it, vi } from 'vitest';
import type { AnimationFrameDriver } from '../../src/viewer/AnimationFrameDriver';
import { ViewerRenderScheduler } from '../../src/viewer/ViewerRenderScheduler';

function fixture(options: { damping?: boolean; initiallyDirty?: boolean } = {}) {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const frameDriver: AnimationFrameDriver = {
    request(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    }
  };
  let runnable = true;
  const host = {
    canInvalidate: () => true,
    canRun: () => runnable,
    updateControls: vi.fn(),
    render: vi.fn(),
    controlsHaveDamping: () => options.damping ?? false,
    onRenderNeeded: vi.fn()
  };
  const scheduler = new ViewerRenderScheduler(host, {
    initiallyDirty: options.initiallyDirty ?? false,
    frameDriver
  });
  const flush = () => {
    const next = callbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!next) return false;
    callbacks.delete(next[0]);
    next[1](0);
    return true;
  };
  return {
    scheduler,
    host,
    callbacks,
    flush,
    block: () => { runnable = false; }
  };
}

describe('ViewerRenderScheduler', () => {
  it('coalesces invalidations into one frame and one transition event', () => {
    const { scheduler, host, callbacks, flush } = fixture();
    scheduler.requestRender();
    scheduler.requestRender();
    expect(callbacks.size).toBe(1);
    expect(host.onRenderNeeded).toHaveBeenCalledOnce();

    expect(flush()).toBe(true);
    expect(host.updateControls).toHaveBeenCalledOnce();
    expect(host.render).toHaveBeenCalledOnce();
    expect(callbacks.size).toBe(0);
  });

  it('schedules exactly one follow-up when render invalidates itself', () => {
    const { scheduler, host, callbacks, flush } = fixture();
    host.render.mockImplementationOnce(() => scheduler.requestRender());
    scheduler.requestRender();
    flush();
    expect(callbacks.size).toBe(1);
    flush();
    expect(host.render).toHaveBeenCalledTimes(2);
    expect(callbacks.size).toBe(0);
  });

  it('continues interaction frames but stops damping when controls settle', () => {
    const { scheduler, host, callbacks, flush } = fixture({ damping: true });
    host.updateControls.mockImplementationOnce(() => scheduler.noteControlsChanged());
    scheduler.beginControlsInteraction();
    flush();
    expect(callbacks.size).toBe(1);
    scheduler.endControlsInteraction();
    flush();
    // The final frame reports no control change, so settling terminates.
    expect(callbacks.size).toBe(0);
  });

  it('cancels pending work on stop/dispose and respects a blocked host', () => {
    const { scheduler, callbacks, block, flush } = fixture();
    scheduler.requestRender();
    scheduler.stop();
    expect(callbacks.size).toBe(0);
    scheduler.start();
    expect(callbacks.size).toBe(1);
    block();
    flush();
    expect(callbacks.size).toBe(0);
    scheduler.dispose();
    expect(callbacks.size).toBe(0);
  });
});
