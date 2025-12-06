import { EventEmitter } from './EventEmitter';

/**
 * No-op viewer for SSR / non-DOM environments.
 * Exposes a minimal API surface compatible with NeuroSurfaceViewer without touching the DOM or WebGL.
 */
export class NoopNeuroSurfaceViewer extends EventEmitter {
  container: any;
  constructor(container?: any) {
    super();
    this.container = container;
  }
  render(): void { /* no-op */ }
  addSurface(): void { /* no-op */ }
  clearSurfaces(): void { /* no-op */ }
  resize(): void { /* no-op */ }
  dispose(): void { /* no-op */ }
}

export function hasDOM(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && !!document.createElement;
}
