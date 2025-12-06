import type { Scenario } from './types';
import { quickstart } from './scenarios/quickstart';
import { multilayer } from './scenarios/multilayer';
import { hemispheres } from './scenarios/hemispheres';
import { fileLoading } from './scenarios/fileLoading';
import { lighting } from './scenarios/lighting';
import { fslrFunc } from './scenarios/fslrFunc';

export const scenarios: Scenario[] = [
  quickstart,
  multilayer,
  lighting,
  hemispheres,
  fslrFunc,
  fileLoading
];
