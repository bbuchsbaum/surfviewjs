import {
  defineSurfViewControlsElement,
  mountSurfViewControls,
  SurfViewControlsElement
} from '../../src/controls-ui';
import type {
  SurfViewControlsHandle,
  SurfViewControlsOptions
} from '../../src/controls-ui';
import type {
  NeuroSurfaceViewer,
  SurfViewControlSession
} from '../../src';

declare const viewer: NeuroSurfaceViewer;
declare const container: HTMLElement;

const constructor: typeof SurfViewControlsElement = defineSurfViewControlsElement();
const options = {
  label: 'Surface controls',
  theme: 'dark',
  density: 'compact',
  features: {
    include: ['view', 'layers', 'layer-inspector', 'selection', 'figure']
  },
  target: { histogramBins: 32 },
  session: {
    focusedSurfaceId: 'lh',
    focusedLayerId: 'stat',
    expandedSections: ['view', 'layers']
  }
} satisfies SurfViewControlsOptions;
const handle: SurfViewControlsHandle = mountSurfViewControls(
  viewer,
  container,
  options
);
const session: SurfViewControlSession = handle.session;
const element: HTMLElement = handle.element;
const update: Promise<boolean> = handle.element.updateComplete;

void constructor.prototype;
void constructor.styles.toString();
session.getSnapshot();
void element.isConnected;
void update;
handle.element.theme = 'light';
handle.element.density = 'comfortable';

// @ts-expect-error handle state is readonly
handle.disposed = false;
// @ts-expect-error docking is an application-layout concern, not a mount option
mountSurfViewControls(viewer, container, { mode: 'dock' });
// @ts-expect-error theme is a closed vocabulary
mountSurfViewControls(viewer, container, { theme: 'sepia' });
// @ts-expect-error density is a closed vocabulary
handle.element.density = 'spacious';
// @ts-expect-error features are scientific workflow sections, not devtools
mountSurfViewControls(viewer, container, { features: { include: ['gpu-diagnostics'] } });
