/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../src/EventEmitter';
import { PluginHost, PluginHostViewer, ViewerPlugin } from '../../src/PluginHost';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import type { ViewerEventMap } from '../../src/events';

class FakeViewer extends EventEmitter<ViewerEventMap> implements PluginHostViewer {
  container: HTMLElement;
  renderRequests = 0;

  constructor() {
    super();
    this.container = document.createElement('div');
  }

  requestRender(): void {
    this.renderRequests += 1;
  }
}

describe('PluginHost', () => {
  it('mounts plugins and cleans up typed event subscriptions on unregister', () => {
    const viewer = new FakeViewer();
    const host = new PluginHost(viewer);
    const teardown = vi.fn();
    const unmount = vi.fn();
    const seen: Array<number | null> = [];

    const plugin: ViewerPlugin = {
      id: 'vertex-panel',
      mount(container, api) {
        container.textContent = 'mounted';
        api.on('vertex:hover', ({ vertexIndex }) => {
          seen.push(vertexIndex);
        });
        return teardown;
      },
      unmount
    };

    const registration = host.register(plugin);
    expect(registration.container.textContent).toBe('mounted');
    expect(viewer.container.children).toHaveLength(1);

    viewer.emit('vertex:hover', {
      surfaceId: 'lh',
      vertexIndex: 7,
      screenX: 10,
      screenY: 20
    });
    expect(seen).toEqual([7]);

    expect(host.unregister('vertex-panel')).toBe(true);
    expect(teardown).toHaveBeenCalledOnce();
    expect(unmount).toHaveBeenCalledOnce();
    expect(viewer.container.children).toHaveLength(0);

    viewer.emit('vertex:hover', {
      surfaceId: 'lh',
      vertexIndex: 9,
      screenX: 10,
      screenY: 20
    });
    expect(seen).toEqual([7]);
  });

  it('supports explicit plugin containers and requestRender forwarding', () => {
    const viewer = new FakeViewer();
    const host = new PluginHost(viewer);
    const container = document.createElement('section');

    host.register({
      id: 'render-panel',
      mount(_container, api) {
        api.requestRender();
      }
    }, { container });

    expect(viewer.renderRequests).toBe(1);
    expect(host.get('render-panel')?.container).toBe(container);
    expect(host.unregister('render-panel')).toBe(true);
    expect(container.parentNode).toBeNull();
  });

  it('rejects duplicate plugin ids unless replace is requested', () => {
    const viewer = new FakeViewer();
    const host = new PluginHost(viewer);
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();

    host.register({
      id: 'stats',
      mount() {
        return firstDispose;
      }
    });

    expect(() => host.register({
      id: 'stats',
      mount() {}
    })).toThrow(/already registered/);

    host.register({
      id: 'stats',
      mount() {
        return secondDispose;
      }
    }, { replace: true });

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).not.toHaveBeenCalled();

    host.dispose();
    expect(secondDispose).toHaveBeenCalledOnce();
  });

  it('deregisters and tears down exactly once when the registration handle is disposed', () => {
    const viewer = new FakeViewer();
    const host = new PluginHost(viewer);
    const teardown = vi.fn();
    const unmount = vi.fn();
    const seen = vi.fn();

    const registration = host.register({
      id: 'direct-dispose',
      mount(_container, api) {
        api.on('render:needed', seen);
        return teardown;
      },
      unmount
    });

    registration.dispose();
    registration.dispose();

    expect(host.get('direct-dispose')).toBeNull();
    expect(host.list()).toEqual([]);
    expect(host.unregister('direct-dispose')).toBe(false);
    host.dispose();
    viewer.emit('render:needed');

    expect(teardown).toHaveBeenCalledOnce();
    expect(unmount).toHaveBeenCalledOnce();
    expect(seen).not.toHaveBeenCalled();
  });

  it('viewer disposal tears down registrations exactly once and rejects later registration', () => {
    const viewer = new EventEmitter<ViewerEventMap>() as any;
    Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
    viewer.container = document.createElement('div');
    viewer.requestRender = vi.fn();
    viewer.disposed = false;
    viewer.initializationFailed = true;
    viewer.pendingStateDomains = new Set();
    viewer.plugins = new PluginHost(viewer);

    const teardown = vi.fn();
    const unmount = vi.fn();
    const registration = viewer.registerPlugin({
      id: 'viewer-owned',
      mount() {
        return teardown;
      },
      unmount
    });

    viewer.dispose();
    registration.dispose();
    viewer.dispose();

    expect(teardown).toHaveBeenCalledOnce();
    expect(unmount).toHaveBeenCalledOnce();
    expect(viewer.getPlugin('viewer-owned')).toBeNull();
    expect(() => viewer.registerPlugin({ id: 'late', mount() {} })).toThrow(/disposed/);
  });

  it('finishes deregistration and unmount even when teardown throws', () => {
    const viewer = new FakeViewer();
    const host = new PluginHost(viewer);
    const unmount = vi.fn();
    const registration = host.register({
      id: 'failing-teardown',
      mount() {
        return () => {
          throw new Error('teardown failed');
        };
      },
      unmount
    });

    expect(() => registration.dispose()).toThrow('teardown failed');
    expect(host.get('failing-teardown')).toBeNull();
    expect(unmount).toHaveBeenCalledOnce();
    expect(() => registration.dispose()).not.toThrow();
  });
});
