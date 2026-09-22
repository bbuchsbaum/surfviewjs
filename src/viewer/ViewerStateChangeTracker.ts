import type { ViewerEventMap, ViewerEventType } from '../events/ViewerEvents';
import type {
  ControlDomain,
  ViewerStateChangedEvent
} from '../events/ViewerEvents';
import type { RestorationReport } from '../serialization/ViewerState';

export const CONTROL_DOMAIN_ORDER: readonly ControlDomain[] = Object.freeze([
  'camera',
  'surfaces',
  'layers',
  'selection',
  'appearance',
  'timeline'
]);

/** Map one canonical viewer event to the coarse state domains it invalidates. */
export function controlDomainsForViewerEvent<Type extends ViewerEventType>(
  event: Type,
  payload: ViewerEventMap[Type] | undefined
): readonly ControlDomain[] {
  switch (event) {
    case 'camera:changed':
    case 'viewpoint:changed':
    case 'controls:changed':
      return ['camera'];
    case 'surface:added':
    case 'surface:removed':
    case 'surface:variant':
    case 'surface-group:registered':
    case 'surface-group:removed':
      return ['surfaces'];
    case 'anatomical-view:changed':
      return (payload as { layout?: string } | undefined)?.layout === 'paired'
        ? ['camera', 'surfaces']
        : ['camera'];
    case 'anatomical-view:reset':
      return ['camera'];
    case 'surface:colormap':
      return ['appearance'];
    case 'surface:selected':
    case 'parcel:selected':
    case 'selection:changed':
      return ['selection'];
    case 'layer:added':
    case 'layer:removed':
    case 'layer:reordered':
    case 'layer:colormap':
    case 'layer:intensity':
    case 'layer:threshold':
    case 'layer:opacity':
      return ['layers'];
    case 'layer:updated': {
      const changes = (payload as { changes?: Record<string, unknown> } | undefined)?.changes;
      return changes && 'timeline' in changes ? ['layers', 'timeline'] : ['layers'];
    }
    case 'annotation:added':
    case 'annotation:moved':
    case 'annotation:removed':
    case 'annotation:activated':
    case 'annotation:reset':
      return ['selection', 'appearance'];
    case 'resize':
      return ['camera', 'appearance'];
    case 'context:restored':
      return ['appearance'];
    case 'state:restored':
      return (payload as RestorationReport | undefined)?.success
        ? CONTROL_DOMAIN_ORDER
        : [];
    default:
      return [];
  }
}

/**
 * Owns monotonic state revisions and nested invalidation batches.
 * It has no viewer, DOM, renderer, or module-global state.
 */
export class ViewerStateChangeTracker {
  private revision = 0;
  private batchDepth = 0;
  private readonly pending = new Set<ControlDomain>();
  private disposed = false;

  constructor(
    private readonly onChange: (event: ViewerStateChangedEvent) => void
  ) {}

  getRevision(): number {
    return this.revision;
  }

  invalidate(domains: readonly ControlDomain[]): void {
    if (this.disposed) return;
    for (const domain of domains) this.pending.add(domain);
    if (this.batchDepth === 0) this.flush();
  }

  beginBatch(): void {
    if (!this.disposed) this.batchDepth += 1;
  }

  endBatch(): void {
    if (this.batchDepth === 0) return;
    this.batchDepth -= 1;
    if (this.batchDepth === 0) this.flush();
  }

  runBatch<Result>(operation: () => Result): Result {
    this.beginBatch();
    try {
      return operation();
    } finally {
      this.endBatch();
    }
  }

  /** Reset construction-time invalidations without publishing a revision. */
  reset(): void {
    this.revision = 0;
    this.batchDepth = 0;
    this.pending.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.batchDepth = 0;
    this.pending.clear();
  }

  private flush(): void {
    if (this.disposed || this.pending.size === 0) return;
    const domains = Object.freeze(
      CONTROL_DOMAIN_ORDER.filter(domain => this.pending.has(domain))
    );
    this.pending.clear();
    this.revision += 1;
    this.onChange(Object.freeze({ revision: this.revision, domains }));
  }
}
