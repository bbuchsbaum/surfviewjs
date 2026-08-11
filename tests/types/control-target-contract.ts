import { createViewerControlTarget } from '../../src';
import type {
  ControlCommandFailureCode,
  ControlJsonObject,
  ControlJsonPrimitive,
  ControlJsonValue,
  LayerControlDescriptor,
  SurfViewControlSessionState,
  SurfViewControlSnapshot,
  SurfViewControlTarget,
  ViewerControlTarget,
  ViewerControlTargetOptions,
  ViewerFigureBackground
} from '../../src';
import type { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import type { Layer } from '../../src/layers';

type AllTrue<T> = Exclude<T, true> extends never ? true : false;
type IsAny<T> = 0 extends (1 & T) ? true : false;
type IsJsonLike<T> = IsAny<T> extends true
  ? false
  : T extends ControlJsonPrimitive
    ? true
    : T extends ControlJsonObject
      ? true
    : T extends (...args: any[]) => unknown
      ? false
      : T extends readonly (infer TItem)[]
        ? [TItem] extends [ControlJsonValue]
          ? true
          : IsJsonLike<TItem>
        : T extends object
          ? AllTrue<{
              [TKey in keyof T]-?: IsJsonLike<Exclude<T[TKey], undefined>>
            }[keyof T]>
          : false;
type Assert<T extends true> = T;
type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2)
    ? true
    : false;

type _ViewIsJsonLike = Assert<IsJsonLike<SurfViewControlSnapshot['view']>>;
type _SurfacesAreJsonLike = Assert<IsJsonLike<SurfViewControlSnapshot['surfaces']>>;
type _SelectionIsJsonLike = Assert<IsJsonLike<SurfViewControlSnapshot['selection']>>;
type _FigureIsJsonLike = Assert<IsJsonLike<SurfViewControlSnapshot['figure']>>;
type _CapabilitiesAreJsonLike = Assert<IsJsonLike<SurfViewControlSnapshot['capabilities']>>;
type _SnapshotIsJsonLike = Assert<IsJsonLike<SurfViewControlSnapshot>>;
type _ViewerIsNotJson = Assert<IsEqual<
  NeuroSurfaceViewer extends ControlJsonValue ? true : false,
  false
>>;
type _LayerIsNotJson = Assert<IsEqual<
  Layer extends ControlJsonValue ? true : false,
  false
>>;
type _TypedArrayIsNotJson = Assert<IsEqual<
  Float32Array extends ControlJsonValue ? true : false,
  false
>>;
type _MapIsNotJson = Assert<IsEqual<
  Map<string, unknown> extends ControlJsonValue ? true : false,
  false
>>;
type _CanonicalStateHasNoFocus = Assert<IsEqual<
  Extract<'focusedSurfaceId' | 'focusedLayerId', keyof SurfViewControlSnapshot>,
  never
>>;
type _SessionOwnsFocus = Assert<IsEqual<
  Extract<'focusedSurfaceId' | 'focusedLayerId', keyof SurfViewControlSessionState>,
  'focusedSurfaceId' | 'focusedLayerId'
>>;
type _ScalarCapabilityIsOptional = Assert<
  {} extends Pick<LayerControlDescriptor, 'scalarMapping'> ? true : false
>;
type _FigureBackgroundIsJsonLike = Assert<IsJsonLike<ViewerFigureBackground>>;
type _ViewerTargetHasNoPublicViewer = Assert<IsEqual<
  Extract<'viewer', keyof ViewerControlTarget>,
  never
>>;
type _ViewerTargetAddsNoNonProtocolMethods = Assert<IsEqual<
  Exclude<keyof ViewerControlTarget, keyof SurfViewControlTarget>,
  never
>>;

declare const snapshot: SurfViewControlSnapshot;
declare const target: SurfViewControlTarget;
declare const viewer: NeuroSurfaceViewer;

// @ts-expect-error canonical snapshots are readonly
snapshot.revision = 2;
// @ts-expect-error canonical layer arrays are readonly
snapshot.surfaces[0].layers.push(snapshot.surfaces[0].layers[0]);
// @ts-expect-error target capabilities are readonly
snapshot.capabilities.layerOrder.enabled = false;

target.setLayerOpacity({ surfaceId: 'lh', layerId: 'stat' }, 0.5);
target.setLayerOrder('lh', ['base', 'stat']);
const viewerTarget: SurfViewControlTarget = createViewerControlTarget(viewer, {
  histogramBins: 48
} satisfies ViewerControlTargetOptions);
viewerTarget.getSnapshot();
viewerTarget.getLayerDataSummary({ surfaceId: 'lh', layerId: 'stat' });

export function describeControlFailure(code: ControlCommandFailureCode): string {
  switch (code) {
    case 'surface-not-found':
      return 'surface';
    case 'layer-not-found':
      return 'layer';
    case 'group-not-found':
      return 'group';
    case 'unsupported':
      return 'unsupported';
    case 'invalid-value':
      return 'value';
    case 'conflict':
      return 'conflict';
    case 'disposed':
      return 'disposed';
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

export const scalarlessLayer = {
  id: 'base',
  surfaceId: 'lh',
  label: 'Anatomy',
  index: 0,
  role: 'anatomy',
  pinned: 'bottom',
  reorderable: false,
  moveUp: { enabled: false, reason: 'Already first.' },
  moveDown: { enabled: false, reason: 'Fixed in stack.' },
  visible: true,
  opacity: 1,
  blendMode: 'normal'
} satisfies LayerControlDescriptor;
