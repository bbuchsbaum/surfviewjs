/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../src/EventEmitter';
import { PluginHost, PluginHostViewer, ViewerPlugin } from '../../src/PluginHost';
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
});
