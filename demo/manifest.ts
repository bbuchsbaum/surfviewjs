import type { Scenario } from './types';
import { quickstart } from './scenarios/quickstart';
import { multilayer } from './scenarios/multilayer';
import { hemispheres } from './scenarios/hemispheres';
import { fileLoading } from './scenarios/fileLoading';
import { lighting } from './scenarios/lighting';
import { fslrFunc } from './scenarios/fslrFunc';
import { gpuCompositing } from './scenarios/gpuCompositing';
import { volumeProjection } from './scenarios/volumeProjection';
import { curvature } from './scenarios/curvature';
import { clipping } from './scenarios/clipping';
import { colormap2d } from './scenarios/colormap2d';
import { morphing } from './scenarios/morphing';
import { gpupicking } from './scenarios/gpupicking';
import { temporalPlayback } from './scenarios/temporalPlayback';
import { statisticalMap } from './scenarios/statisticalMap';
import { connectivity } from './scenarios/connectivity';
import { stateSerialization } from './scenarios/stateSerialization';
import { topologyLens } from './scenarios/topologyLens';

export const scenarios: Scenario[] = [
  quickstart,
  multilayer,
  curvature,
  clipping,
  colormap2d,
  morphing,
  gpupicking,
  temporalPlayback,
  statisticalMap,
  connectivity,
  topologyLens,
  stateSerialization,
  lighting,
  hemispheres,
  fslrFunc,
  gpuCompositing,
  volumeProjection,
  fileLoading
];
