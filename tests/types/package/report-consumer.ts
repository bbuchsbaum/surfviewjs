import {
  createReportSceneControlTarget,
  mountSurfView,
  ReportSceneController
} from 'surfview/report';
import type {
  MountSurfViewOptions,
  SurfViewMountHandle,
  SurfViewSceneManifest
} from 'surfview/report';

declare const container: HTMLElement;
declare const manifest: SurfViewSceneManifest;

const options = {
  controls: true,
  initialView: 'dorsal'
} satisfies MountSurfViewOptions;
const handle: SurfViewMountHandle = mountSurfView(container, manifest, options);
handle.controlTarget?.getSnapshot();

void createReportSceneControlTarget;
void ReportSceneController;

// @ts-expect-error report views use the closed anatomical vocabulary.
mountSurfView(container, manifest, { initialView: 'top' });
