import {
  MAX_DEVICE_PIXEL_RATIO,
  NeuroSurfaceViewer,
  NumericValidationError,
  type NumericValidationErrorCode,
  type ResolvedNeuroSurfaceViewerConfig,
  type ResolvedSurfaceConfig
} from '../../src';

declare const viewer: NeuroSurfaceViewer;
const viewerConfig: ResolvedNeuroSurfaceViewerConfig = viewer.config;
const maximumDpr: number = MAX_DEVICE_PIXEL_RATIO;

declare const surfaceConfig: ResolvedSurfaceConfig;
const alpha: number = surfaceConfig.alpha;
const materialType: 'phong' | 'standard' | 'physical' = surfaceConfig.materialType;

declare const error: unknown;
if (error instanceof NumericValidationError) {
  const code: NumericValidationErrorCode = error.code;
  const parameter: string = error.parameter;
  void code;
  void parameter;
}

void viewerConfig;
void maximumDpr;
void alpha;
void materialType;
