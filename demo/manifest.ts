import { firstLook } from './chapters/firstLook';
import { layers } from './chapters/layers';
import { statistics } from './chapters/statistics';
import { volume } from './chapters/volume';
import { timeSeries } from './chapters/timeSeries';
import { anatomy } from './chapters/anatomy';
import { inspect } from './chapters/inspect';
import { atlasPlates } from './chapters/atlasPlates';
import { parcelPuzzle } from './chapters/parcelPuzzle';
import { parcelMapLab } from './chapters/parcelMapLab';
import { connectivity } from './chapters/connectivity';
import { figures } from './chapters/figures';
import { controls } from './chapters/controls';
import { dataInOut } from './chapters/dataInOut';
import type { Scenario } from './types';

/** Chapter order on the viewbox strip. The first chapter opens by default. */
export const scenarios: Scenario[] = [
  firstLook,
  layers,
  statistics,
  volume,
  timeSeries,
  anatomy,
  inspect,
  atlasPlates,
  parcelPuzzle,
  parcelMapLab,
  connectivity,
  figures,
  controls,
  dataInOut
];

/** The one-word subject printed under each chapter's title on the strip. */
export const STRIP_SUBJECTS: Readonly<Record<string, string>> = {
  'first-look': 'viewer',
  layers: 'compositing',
  statistics: 'inference',
  volume: 'projection',
  'time-series': 'playback',
  anatomy: 'geometry',
  inspect: 'picking',
  'atlas-illustration': 'vector',
  'parcel-puzzle': 'pieces',
  'parcel-map-lab': 'flatmap',
  connectivity: 'networks',
  figures: 'export',
  controls: 'panel',
  data: 'files'
};
