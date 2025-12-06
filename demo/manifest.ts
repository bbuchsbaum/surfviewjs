import type { Scenario } from './types';
import { quickstart } from './scenarios/quickstart';
import { multilayer } from './scenarios/multilayer';
import { hemispheres } from './scenarios/hemispheres';
import { fileLoading } from './scenarios/fileLoading';
import { lighting } from './scenarios/lighting';
import { fslrFunc } from './scenarios/fslrFunc';
import { gpuCompositing } from './scenarios/gpuCompositing';
import { curvature } from './scenarios/curvature';
import { clipping } from './scenarios/clipping';

export const scenarios: Scenario[] = [
  quickstart,
  multilayer,
  curvature,
  clipping,
  lighting,
  hemispheres,
  fslrFunc,
  gpuCompositing,
  fileLoading
];
