import { describe, expect, it, vi } from 'vitest';
import type { AnimationFrameDriver } from '../../src/viewer/AnimationFrameDriver';
import { SurfaceColorUpdateScheduler } from '../../src/surface/SurfaceColorUpdateScheduler';

function fixture() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const driver: AnimationFrameDriver = {
    request(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    }
  };
  let dirty = false;
  const host = {
    needsComposite: () => dirty,
    updateColors: vi.fn(() => { dirty = false; }),
    onRenderNeeded: vi.fn()
  };
  const scheduler = new SurfaceColorUpdateScheduler(host, driver);
  return {
    scheduler,
    host,
    callbacks,
    markDirty: () => { dirty = true; }
  };
}

describe('SurfaceColorUpdateScheduler', () => {
  it('coalesces requests and flushes exactly once before viewer paint', () => {
    const { scheduler, host, callbacks } = fixture();
    scheduler.request();
    scheduler.request();
    expect(callbacks.size).toBe(1);
    expect(scheduler.flush()).toBe(true);
    expect(callbacks.size).toBe(0);
    expect(host.updateColors).toHaveBeenCalledOnce();
    expect(host.onRenderNeeded).toHaveBeenCalledOnce();
    expect(scheduler.flush()).toBe(false);
  });

  it('flushes unscheduled dirty composition and becomes inert after disposal', () => {
    const { scheduler, host, callbacks, markDirty } = fixture();
    markDirty();
    expect(scheduler.flush()).toBe(true);
    scheduler.request();
    scheduler.dispose();
    expect(callbacks.size).toBe(0);
    expect(scheduler.flush()).toBe(false);
    expect(host.updateColors).toHaveBeenCalledOnce();
  });
});
