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
