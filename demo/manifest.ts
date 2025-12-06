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
import { colormap2d } from './scenarios/colormap2d';

export const scenarios: Scenario[] = [
  quickstart,
  multilayer,
  curvature,
  clipping,
  colormap2d,
  lighting,
  hemispheres,
  fslrFunc,
  gpuCompositing,
  fileLoading
];
