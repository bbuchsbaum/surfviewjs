/**
 * Browser-ready SurfView entrypoint.
 *
 * Unlike the npm library entrypoint, this build owns its Three.js runtime so
 * classic-script consumers such as R htmlwidgets cannot accidentally combine
 * incompatible global copies.
 */
import * as THREE from 'three';

export * from './index';

export const SURFVIEW_EMBED_THREE_REVISION = THREE.REVISION;

if (THREE.REVISION !== '185') {
  throw new Error(
    `surfview embed expected Three.js revision 185, received ${THREE.REVISION}`
  );
}
