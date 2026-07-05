import type { UnsubscribeFn } from './EventEmitter';
import type { ViewerEventMap, ViewerEventType } from './events/ViewerEvents';
import type { FlatMapView } from './FlatMapView';

export interface LinkOptions {
  hover?: boolean;
  selection?: boolean;
  layerState?: boolean;
  time?: boolean;
}

export interface LinkedViewerLike {
  on<K extends ViewerEventType>(event: K, listener: ViewerEventMap[K] extends void ? () => void : (event: ViewerEventMap[K]) => void): UnsubscribeFn;
  showCrosshair?(surfaceId: string, vertexIndex: number, options?: Record<string, unknown>): void;
  hideCrosshair?(): void;
}

export interface LinkedTimelineLike {
  on(event: 'timechange', listener: (event: { time: number }) => void): UnsubscribeFn;
}

export interface LinkedBrainWorkspaceOptions {
  viewer: LinkedViewerLike;
  flatmap: FlatMapView;
  timeline?: LinkedTimelineLike;
  surfaceId?: string;
  link?: LinkOptions;
}

export class LinkedBrainWorkspace {
  readonly viewer: LinkedViewerLike;
  readonly flatmap: FlatMapView;
  readonly timeline: LinkedTimelineLike | null;
  readonly surfaceId: string | null;

  private unsubs: UnsubscribeFn[] = [];
  private syncing = false;
  private link: Required<LinkOptions>;

  constructor(options: LinkedBrainWorkspaceOptions) {
    this.viewer = options.viewer;
    this.flatmap = options.flatmap;
    this.timeline = options.timeline ?? null;
    this.surfaceId = options.surfaceId ?? options.flatmap.surfaceId;
    this.link = {
      hover: options.link?.hover ?? true,
      selection: options.link?.selection ?? true,
      layerState: options.link?.layerState ?? true,
      time: options.link?.time ?? true
    };

    this.bind();
  }

  dispose(): void {
    while (this.unsubs.length) {
      this.unsubs.pop()?.();
    }
  }

  private bind(): void {
    if (this.link.hover) {
      this.unsubs.push(this.viewer.on('vertex:hover', (event) => {
        if (this.syncing) return;
        if (!this.matchesSurface(event.surfaceId)) return;
        this.withSync(() => this.flatmap.setHover(event.vertexIndex, { emit: false }));
      }));
      this.unsubs.push(this.flatmap.on('vertex:hover', (event) => {
        if (this.syncing) return;
        if (event.vertexIndex === null || !event.surfaceId) {
          this.viewer.hideCrosshair?.();
          return;
        }
        this.viewer.showCrosshair?.(event.surfaceId, event.vertexIndex, { mode: 'hover' });
      }));
    }

    if (this.link.selection) {
      this.unsubs.push(this.viewer.on('parcel:selected', (event) => {
        if (this.syncing) return;
        if (!this.matchesSurface(event.surfaceId)) return;
        this.withSync(() => this.flatmap.setSelection(event.vertexIndex, { emit: false }));
      }));
      this.unsubs.push(this.flatmap.on('selection:changed', (event) => {
        if (this.syncing) return;
        if (event.vertexIndex === null || !event.surfaceId) {
          this.viewer.hideCrosshair?.();
          return;
        }
        this.viewer.showCrosshair?.(event.surfaceId, event.vertexIndex, { mode: 'selection' });
      }));
    }

    if (this.link.layerState) {
      this.unsubs.push(this.viewer.on('layer:updated', (event) => {
        if (!this.matchesSurface(event.surfaceId)) return;
        this.flatmap.setLayerState(event.layerId, {
          layer: event.layer ?? null,
          changes: event.changes ?? null
        });
      }));
      this.unsubs.push(this.viewer.on('layer:opacity', (event) => {
        if (!this.matchesSurface(event.surfaceId)) return;
        this.flatmap.setLayerState(event.layerId, { opacity: event.opacity });
      }));
      this.unsubs.push(this.viewer.on('layer:threshold', (event) => {
        if (!this.matchesSurface(event.surfaceId)) return;
        this.flatmap.setLayerState(event.layerId, { threshold: event.threshold });
      }));
      this.unsubs.push(this.viewer.on('layer:intensity', (event) => {
        if (!this.matchesSurface(event.surfaceId)) return;
        this.flatmap.setLayerState(event.layerId, { range: event.range });
      }));
      this.unsubs.push(this.viewer.on('layer:colormap', (event) => {
        if (!this.matchesSurface(event.surfaceId)) return;
        this.flatmap.setLayerState(event.layerId, { colormap: event.colormap });
      }));
    }

    if (this.link.time && this.timeline) {
      this.unsubs.push(this.timeline.on('timechange', (event) => {
        this.flatmap.setTime(event.time);
      }));
    }
  }

  private matchesSurface(surfaceId: string | null): boolean {
    if (!this.surfaceId) return true;
    return surfaceId === this.surfaceId;
  }

  private withSync(callback: () => void): void {
    this.syncing = true;
    try {
      callback();
    } finally {
      this.syncing = false;
    }
  }
}
