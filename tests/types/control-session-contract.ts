import {
  createManagedViewerControlSession,
  createSurfViewControlSession
} from '../../src';
import type {
  NeuroSurfaceViewer,
  SurfViewControlSession,
  SurfViewControlSessionSnapshot,
  SurfViewControlTarget,
  SurfViewControlTargetCommands
} from '../../src';

type Assert<T extends true> = T;
type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2)
    ? true
    : false;

type _SessionDoesNotExposeTarget = Assert<IsEqual<
  Extract<'target', keyof SurfViewControlSession>,
  never
>>;
type _SessionImplementsTargetCommands = Assert<IsEqual<
  Exclude<keyof SurfViewControlTargetCommands, keyof SurfViewControlSession>,
  never
>>;

declare const target: SurfViewControlTarget;
declare const viewer: NeuroSurfaceViewer;
declare const snapshot: SurfViewControlSessionSnapshot;

const session = createSurfViewControlSession(target, {
  focusedSurfaceId: 'lh',
  focusedLayerId: 'stat',
  expandedSections: ['view', 'layers', 'selected-layer'],
  advancedVisible: false,
  symmetricRangeLock: true
});
const commands: SurfViewControlTargetCommands = session;

commands.setLayerOpacity({ surfaceId: 'lh', layerId: 'stat' }, 0.5);
session.setFocusedLayer({ surfaceId: 'lh', layerId: 'stat' });
session.setSectionExpanded('figure', true);
session.getSnapshot();
const managedSession: SurfViewControlSession = createManagedViewerControlSession(viewer, {
  target: { histogramBins: 48 },
  session: { focusedSurfaceId: 'lh', focusedLayerId: 'stat' }
});
managedSession.dispose();

// @ts-expect-error session snapshots are readonly
snapshot.sessionRevision = 2;
// @ts-expect-error panel-local state is readonly
snapshot.state.focusedLayerId = 'other';
// @ts-expect-error canonical target descriptors remain readonly
snapshot.canonical.surfaces[0].layers[0].opacity = 0.2;
// @ts-expect-error section IDs are closed and stable
session.setSectionExpanded('diagnostics', true);
