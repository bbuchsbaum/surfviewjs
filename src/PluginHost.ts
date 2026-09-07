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
  private disposed = false;

  constructor(viewer: PluginHostViewer) {
    this.viewer = viewer;
  }

  register(plugin: ViewerPlugin, options: RegisterPluginOptions = {}): PluginRegistration {
    if (this.disposed) {
      throw new Error('PluginHost is disposed');
    }
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
    let cleaned = false;

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

    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      let failure: unknown;
      let failed = false;
      const run = (step: () => void): void => {
        try {
          step();
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
      };
      while (subscriptions.length) {
        const unsubscribe = subscriptions.pop();
        if (unsubscribe) run(unsubscribe);
      }
      run(() => this.runTeardown(teardown));
      if (plugin.unmount) run(() => plugin.unmount?.());
      if (autoContainer && container.parentNode) {
        container.parentNode.removeChild(container);
      }
      if (failed) throw failure;
    };

    try {
      teardown = plugin.mount(container, api);
    } catch (err) {
      try {
        cleanup();
      } catch (cleanupError) {
        console.error(`Plugin "${plugin.id}" cleanup failed after mount error`, cleanupError);
      }
      throw err;
    }

    const dispose = (): void => {
      if (this.registrations.get(plugin.id) === registration) {
        this.registrations.delete(plugin.id);
      }
      cleanup();
    };

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
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    let failed = false;
    for (const id of Array.from(this.registrations.keys())) {
      try {
        this.unregister(id);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
    if (failed) throw failure;
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
