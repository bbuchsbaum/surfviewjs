import {
  createReportSceneControlTarget,
  ReportSceneController,
  ReportSceneControlTarget
} from '../../src';
import type {
  NeuroSurfaceViewer,
  ReportSceneControlTargetOptions,
  SurfViewControlTarget,
  SurfViewMountHandle,
  SurfViewSceneManifest
} from '../../src';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

declare const viewer: NeuroSurfaceViewer;
declare const manifest: SurfViewSceneManifest;
declare const handle: SurfViewMountHandle;

const controller = new ReportSceneController(viewer, manifest, {
  initialView: 'dorsal',
  bilateralGroup: {
    id: 'cortex',
    leftSurfaceId: 'lh',
    rightSurfaceId: 'rh'
  }
});
const options = { histogramBins: 24 } satisfies ReportSceneControlTargetOptions;
const concrete = createReportSceneControlTarget(controller, options);
const target: SurfViewControlTarget = concrete;

type _ReportTargetImplementsPort = Assert<
  ReportSceneControlTarget extends SurfViewControlTarget ? true : false
>;
type _NoConcreteObjectsOnTarget = Assert<Equal<
  Extract<'viewer' | 'manifest' | 'controller', keyof ReportSceneControlTarget>,
  never
>>;
type _MountTargetIsNullablePort = Assert<Equal<
  SurfViewMountHandle['controlTarget'],
  SurfViewControlTarget | null
>>;

target.setDisplayedLayer('activation');
handle.controlTarget?.setDisplayedLayer('activation');

// @ts-expect-error report targets do not expose their concrete viewer
void concrete.viewer;

import type { SceneReferenceLayerManifest, ReferenceLayersCapability } from '../../src';
const referenceManifest: SceneReferenceLayerManifest = {
  id: 'reference', role: 'reference', label: 'Region', color: '#8844aa', boundary: 'midpoint',
  values: { lh: { values: 'mask-left' }, rh: { values: 'mask-right' } }
};
// @ts-expect-error references have categorical colors, never quantitative limits
referenceManifest.limits = [0, 1];
// @ts-expect-error continuous membership boundaries are not supported
referenceManifest.boundary = 'linear';
const references: ReferenceLayersCapability | undefined = target.getSnapshot().capabilities.referenceLayers;
if (references?.availability.enabled && references.layers[0]) {
  target.setLayerVisibility(references.layers[0].address, false);
  target.setLayerOpacity(references.layers[0].address, 0.25);
  // @ts-expect-error reference capability snapshots are immutable
  references.layers[0].opacity = 0.5;
}
