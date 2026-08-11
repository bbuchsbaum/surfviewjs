/**
 * Report-runtime subpath.
 *
 * The production artifact re-exports these symbols from the sibling core
 * bundle so report consumers do not receive a second SurfView implementation.
 */
export {
  createReportSceneControlTarget,
  layoutReportAnatomicalMeshes,
  mountSurfView,
  ReportSceneController,
  ReportSceneControlTarget
} from './index';

export type {
  MountSurfViewOptions,
  ReportAnatomicalMesh,
  ReportSceneControlTargetOptions,
  ReportSceneControllerOptions,
  ReportSceneControllerState,
  ReportSceneDisposingListener,
  ReportSceneMutationListener,
  ReportSceneMutationPhase,
  SurfViewSceneManifest,
  SurfViewMountHandle,
  SurfViewSceneView
} from './index';
