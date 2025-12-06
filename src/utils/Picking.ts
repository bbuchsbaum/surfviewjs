import * as THREE from 'three';

export interface PickInfo {
  point: THREE.Vector3 | null;
  faceIndex: number | null;
  distance: number | null;
  uv?: THREE.Vector2;
}

/**
  * Basic raycast helper to get the closest intersection on a mesh.
  */
export function computePickInfo(raycaster: THREE.Raycaster, mesh: THREE.Mesh): PickInfo {
  const hits = raycaster.intersectObject(mesh, false);
  if (!hits || hits.length === 0) {
    return { point: null, faceIndex: null, distance: null };
  }
  const hit = hits[0];
  return {
    point: hit.point ? hit.point.clone() : null,
    faceIndex: hit.faceIndex ?? null,
    distance: hit.distance ?? null,
    uv: hit.uv ? hit.uv.clone() : undefined
  };
}
