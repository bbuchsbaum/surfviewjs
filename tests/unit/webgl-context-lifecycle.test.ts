import { describe, expect, it, vi } from 'vitest';
import { WebGLContextLifecycle } from '../../src/viewer/WebGLContextLifecycle';

function fixture() {
  const listeners = new Map<string, EventListener>();
  const canvas = {
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(type, listener as EventListener);
    }),
    removeEventListener: vi.fn((type: string) => listeners.delete(type))
  };
  const callbacks = { onLost: vi.fn(), onRestored: vi.fn() };
  const lifecycle = new WebGLContextLifecycle(canvas, callbacks);
  return { lifecycle, canvas, callbacks, listeners };
}

describe('WebGLContextLifecycle', () => {
  it('attaches idempotently and emits one transition per real state change', () => {
    const { lifecycle, canvas, callbacks, listeners } = fixture();
    lifecycle.attach();
    lifecycle.attach();
    expect(canvas.addEventListener).toHaveBeenCalledTimes(2);

    const lostEvent = { preventDefault: vi.fn() } as unknown as Event;
    listeners.get('webglcontextlost')!(lostEvent);
    listeners.get('webglcontextlost')!(lostEvent);
    expect(lostEvent.preventDefault).toHaveBeenCalledTimes(2);
    expect(callbacks.onLost).toHaveBeenCalledOnce();
    expect(lifecycle.isLost()).toBe(true);

    listeners.get('webglcontextrestored')!(new Event('webglcontextrestored'));
    expect(callbacks.onRestored).toHaveBeenCalledOnce();
    expect(lifecycle.isLost()).toBe(false);
  });

  it('detaches listener identity and remains inert after disposal', () => {
    const { lifecycle, canvas, callbacks, listeners } = fixture();
    lifecycle.attach();
    const lost = listeners.get('webglcontextlost')!;
    lifecycle.dispose();
    expect(canvas.removeEventListener).toHaveBeenCalledTimes(2);
    lost({ preventDefault: vi.fn() } as unknown as Event);
    expect(callbacks.onLost).not.toHaveBeenCalled();
    expect(lifecycle.isLost()).toBe(true);
  });
});
