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
  if (hits.length === 0) {
    return { point: null, faceIndex: null, distance: null };
  }
  const hit = hits[0];
  if (!hit) {
    return { point: null, faceIndex: null, distance: null };
  }
  return {
    point: hit.point ? hit.point.clone() : null,
    faceIndex: hit.faceIndex ?? null,
    distance: hit.distance ?? null,
    ...(hit.uv ? { uv: hit.uv.clone() } : {})
  };
}

/**
 * Whether the renderer would draw `object` for `camera`: the object and every
 * ancestor are visible, it shares a layer with the camera (when given), and at
 * least one of its materials is visible. Raycasting ignores all of these, so
 * pickers must filter with this to avoid reporting hidden surfaces (e.g. the
 * opposite hemisphere hidden by a medial view, which sits between the camera
 * and the hemisphere on screen).
 */
export function isObjectDrawn(object: THREE.Object3D, camera?: THREE.Camera): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  if (camera && !object.layers.test(camera.layers)) return false;
  const material = (object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
  if (material) {
    const materials = Array.isArray(material) ? material : [material];
    if (materials.length > 0 && materials.every(item => item.visible === false)) return false;
  }
  return true;
}
