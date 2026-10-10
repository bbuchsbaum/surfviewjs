/**
 * Report-runtime subpath.
 *
 * The production artifact re-exports these symbols from the sibling core
 * bundle so report consumers do not receive a second SurfView implementation.
 */
export {
  createReportSceneControlTarget,
  DEFAULT_REPORT_OBLIQUE,
  layoutReportAnatomicalMeshes,
  mountSurfView,
  REPORT_BRAIN_VIEWS,
  ReportSceneController,
  ReportSceneControlTarget
} from './index';

export type {
  MountSurfViewOptions,
  ReportAnatomicalMesh,
  ReportBrainView,
  ReportObliqueAngle,
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
