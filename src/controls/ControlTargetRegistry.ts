import type { UnsubscribeFn } from '../EventEmitter';
import type { NeuroSurfaceViewer } from '../NeuroSurfaceViewer';
import {
  SurfViewControlSession
} from './ControlSession';
import type { SurfViewControlSessionOptions } from './ControlSession';
import {
  createViewerControlTarget
} from './ViewerControlTarget';
import type {
  ViewerControlTarget,
  ViewerControlTargetOptions
} from './ViewerControlTarget';

export interface ManagedViewerControlSessionOptions {
  /** Shared adapter configuration. The first owner fixes it for this viewer. */
  readonly target?: ViewerControlTargetOptions;
  /** State owned only by the newly created panel session. */
  readonly session?: SurfViewControlSessionOptions;
}

interface ManagedTargetEntry {
  readonly target: ViewerControlTarget;
  readonly histogramBins: number;
  readonly sessions: Set<ManagedControlSession>;
  unsubscribeViewerDisposing: UnsubscribeFn;
  closing: boolean;
}

const DEFAULT_HISTOGRAM_BINS = 32;
const managedTargets = new WeakMap<NeuroSurfaceViewer, ManagedTargetEntry>();

function normalizedHistogramBins(
  options: ViewerControlTargetOptions | undefined
): number {
  const histogramBins = options?.histogramBins ?? DEFAULT_HISTOGRAM_BINS;
  if (!Number.isInteger(histogramBins) || histogramBins < 1 || histogramBins > 4096) {
    throw new RangeError('histogramBins must be an integer between 1 and 4096.');
  }
  return histogramBins;
}

function closeEntry(
  viewer: NeuroSurfaceViewer,
  entry: ManagedTargetEntry
): void {
  if (entry.closing) return;
  entry.closing = true;
  if (managedTargets.get(viewer) === entry) managedTargets.delete(viewer);
  entry.unsubscribeViewerDisposing();
  for (const session of [...entry.sessions]) session.disposeFromRegistry();
  entry.sessions.clear();
  entry.target.dispose();
}

function releaseSession(
  viewer: NeuroSurfaceViewer,
  entry: ManagedTargetEntry,
  session: ManagedControlSession
): void {
  if (!entry.sessions.delete(session)) return;
  if (entry.sessions.size === 0) closeEntry(viewer, entry);
}

class ManagedControlSession extends SurfViewControlSession {
  private released = false;

  constructor(
    target: ViewerControlTarget,
    options: SurfViewControlSessionOptions | undefined,
    private readonly releaseOwner: (session: ManagedControlSession) => void
  ) {
    super(target, options);
  }

  override dispose(): void {
    if (this.released) return;
    super.dispose();
    this.released = true;
    this.releaseOwner(this);
  }

  disposeFromRegistry(): void {
    if (this.released) return;
    this.released = true;
    super.dispose();
  }
}

function createEntry(
  viewer: NeuroSurfaceViewer,
  histogramBins: number
): ManagedTargetEntry {
  const target = createViewerControlTarget(viewer, { histogramBins });
  const entry: ManagedTargetEntry = {
    target,
    histogramBins,
    sessions: new Set(),
    unsubscribeViewerDisposing: () => {},
    closing: false
  };

  try {
    entry.unsubscribeViewerDisposing = viewer.on('viewer:disposing', () => {
      closeEntry(viewer, entry);
    });
  } catch (error) {
    target.dispose();
    throw error;
  }

  managedTargets.set(viewer, entry);
  return entry;
}

/**
 * Creates one panel-local session over a viewer-scoped managed target.
 *
 * Calls for the same viewer reuse one adapter. Disposing the returned session
 * releases exactly one owner; the target is disposed after the final owner or
 * when the viewer starts disposal. The direct
 * `createSurfViewControlSession(target)` API is separate and always leaves its
 * explicitly supplied target caller-owned.
 */
export function createManagedViewerControlSession(
  viewer: NeuroSurfaceViewer,
  options: ManagedViewerControlSessionOptions = {}
): SurfViewControlSession {
  if (!viewer || typeof viewer.isDisposed !== 'function' ||
      typeof viewer.on !== 'function') {
    throw new TypeError('A managed control session requires a NeuroSurfaceViewer.');
  }
  if (viewer.isDisposed()) {
    throw new Error('Cannot create a managed control session for a disposed viewer.');
  }

  const histogramBins = normalizedHistogramBins(options.target);
  let entry = managedTargets.get(viewer);
  if (entry?.target.isDisposed()) {
    closeEntry(viewer, entry);
    entry = undefined;
  }
  if (entry && options.target?.histogramBins !== undefined &&
      entry.histogramBins !== histogramBins) {
    throw new Error(
      'A managed viewer control target already exists with different target options.'
    );
  }
  entry ??= createEntry(viewer, histogramBins);

  let session: ManagedControlSession;
  try {
    session = new ManagedControlSession(
      entry.target,
      options.session,
      current => releaseSession(viewer, entry, current)
    );
  } catch (error) {
    if (entry.sessions.size === 0) closeEntry(viewer, entry);
    throw error;
  }
  entry.sessions.add(session);
  return session;
}
