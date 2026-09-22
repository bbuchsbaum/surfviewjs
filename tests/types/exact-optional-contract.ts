import type {
  NeuroSurfaceViewer,
  NeuroSurfaceViewerConfig,
  ParcelConnectivityLayerConfig,
  ResolvedSurfaceConfig,
  SurfaceConfig,
  ViewerStateV2
} from '../../src';

const omittedViewerConfig: NeuroSurfaceViewerConfig = {};
const omittedSurfaceConfig: SurfaceConfig = {};
const nullableParcelThreshold: ParcelConnectivityLayerConfig = { threshold: null };
const omittedResolvedSmoothing: ResolvedSurfaceConfig = {
  color: 0xcccccc,
  flatShading: false,
  materialType: 'phong',
  shininess: 30,
  specularColor: 0x555555,
  metalness: 0,
  roughness: 0.5,
  emissive: 0,
  emissiveIntensity: 0,
  alpha: 1,
  thresh: [0, 0],
  irange: [0, 1]
};

declare const viewer: NeuroSurfaceViewer;
viewer.onSurfaceClick = undefined;

declare const state: ViewerStateV2;
const timelineReset: ViewerStateV2 = { ...state, timeline: null };

// @ts-expect-error omission uses the default; explicit undefined is not a value.
const undefinedViewerConfig: NeuroSurfaceViewerConfig = { initialZoom: undefined };
// @ts-expect-error omission preserves the current value; explicit undefined is not a reset.
const undefinedSurfaceConfig: SurfaceConfig = { alpha: undefined };
// @ts-expect-error threshold resets with null, not explicit undefined.
const undefinedParcelThreshold: ParcelConnectivityLayerConfig = { threshold: undefined };
// @ts-expect-error normalized optional fields are omitted rather than stored as undefined.
const undefinedResolvedSmoothing: ResolvedSurfaceConfig = {
  ...omittedResolvedSmoothing,
  smoothingAngle: undefined
};

void omittedViewerConfig;
void omittedSurfaceConfig;
void nullableParcelThreshold;
void timelineReset;
void undefinedViewerConfig;
void undefinedSurfaceConfig;
void undefinedParcelThreshold;
void undefinedResolvedSmoothing;
