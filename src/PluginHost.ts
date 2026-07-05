import type { UnsubscribeFn, TypedEventListener } from './EventEmitter';
import type { ViewerEventMap, ViewerEventType } from './events/ViewerEvents';

export interface PluginHostViewer {
  container: HTMLElement;
  on<K extends ViewerEventType>(event: K, listener: TypedEventListener<ViewerEventMap[K]>): UnsubscribeFn;
  requestRender(): void;
}

export interface ViewerPluginContext {
  readonly viewer: PluginHostViewer;
  readonly container: HTMLElement;
  on<K extends ViewerEventType>(event: K, listener: TypedEventListener<ViewerEventMap[K]>): UnsubscribeFn;
  requestRender(): void;
}

export type PluginTeardown = void | UnsubscribeFn | { dispose(): void } | { unmount(): void };

export interface ViewerPlugin {
  id: string;
  mount(container: HTMLElement, api: ViewerPluginContext): PluginTeardown;
  unmount?(): void;
}

export interface RegisterPluginOptions {
  container?: HTMLElement;
  replace?: boolean;
}

export interface PluginRegistration {
  id: string;
  plugin: ViewerPlugin;
  container: HTMLElement;
  dispose(): void;
}

interface StoredPluginRegistration extends PluginRegistration {
  autoContainer: boolean;
}

export class PluginHost {
  private viewer: PluginHostViewer;
  private registrations = new Map<string, StoredPluginRegistration>();

  constructor(viewer: PluginHostViewer) {
    this.viewer = viewer;
  }

  register(plugin: ViewerPlugin, options: RegisterPluginOptions = {}): PluginRegistration {
    if (!plugin || typeof plugin.id !== 'string' || plugin.id.trim() === '') {
      throw new Error('PluginHost.register requires a plugin with a non-empty id');
    }
    if (typeof plugin.mount !== 'function') {
      throw new Error(`Plugin "${plugin.id}" requires a mount() function`);
    }

    if (this.registrations.has(plugin.id)) {
      if (!options.replace) {
        throw new Error(`Plugin "${plugin.id}" is already registered`);
      }
      this.unregister(plugin.id);
    }

    const autoContainer = !options.container;
    const container = options.container ?? this.createPluginContainer(plugin.id);
    const subscriptions: UnsubscribeFn[] = [];
    let teardown: PluginTeardown = undefined;

    const api: ViewerPluginContext = {
      viewer: this.viewer,
      container,
      on: (event, listener) => {
        const unsubscribe = this.viewer.on(event, listener);
        subscriptions.push(unsubscribe);
        return () => {
          unsubscribe();
          const index = subscriptions.indexOf(unsubscribe);
          if (index >= 0) {
            subscriptions.splice(index, 1);
          }
        };
      },
      requestRender: () => this.viewer.requestRender()
    };

    const dispose = (): void => {
      while (subscriptions.length) {
        subscriptions.pop()?.();
      }
      this.runTeardown(teardown);
      plugin.unmount?.();
      if (autoContainer && container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };

    try {
      teardown = plugin.mount(container, api);
    } catch (err) {
      dispose();
      throw err;
    }

    const registration: StoredPluginRegistration = {
      id: plugin.id,
      plugin,
      container,
      dispose,
      autoContainer
    };

    this.registrations.set(plugin.id, registration);
    return registration;
  }

  unregister(id: string): boolean {
    const registration = this.registrations.get(id);
    if (!registration) return false;

    this.registrations.delete(id);
    registration.dispose();
    return true;
  }

  get(id: string): PluginRegistration | null {
    return this.registrations.get(id) ?? null;
  }

  list(): PluginRegistration[] {
    return Array.from(this.registrations.values());
  }

  dispose(): void {
    for (const id of Array.from(this.registrations.keys())) {
      this.unregister(id);
    }
  }

  private createPluginContainer(id: string): HTMLElement {
    const root = this.viewer.container;
    if (!root || typeof root.appendChild !== 'function') {
      throw new Error(`Plugin "${id}" requires an explicit container`);
    }

    const doc = root.ownerDocument ?? document;
    const container = doc.createElement('div');
    container.dataset.surfviewPlugin = id;
    root.appendChild(container);
    return container;
  }

  private runTeardown(teardown: PluginTeardown): void {
    if (typeof teardown === 'function') {
      teardown();
      return;
    }
    if (teardown && typeof teardown === 'object' && 'dispose' in teardown && typeof teardown.dispose === 'function') {
      teardown.dispose();
      return;
    }
    if (teardown && typeof teardown === 'object' && 'unmount' in teardown && typeof teardown.unmount === 'function') {
      teardown.unmount();
    }
  }
}
