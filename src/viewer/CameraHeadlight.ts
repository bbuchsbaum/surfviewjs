import * as THREE from 'three';

/**
 * Direction towards a light in camera space: +x right, +y up, +z towards the
 * viewer. Need not be normalised.
 */
export type CameraSpaceOffset = readonly [number, number, number];

/** Key light: slightly above and right of the line of sight (about 17° off axis). */
export const HEADLIGHT_KEY_OFFSET: CameraSpaceOffset = [0.35, 0.5, 2];
/** Fill light: low and left, so the key's shadow side is not black. */
export const HEADLIGHT_FILL_OFFSET: CameraSpaceOffset = [-0.8, -0.3, 1.4];
/** World position of the fill light when the headlight is off (the legacy rig). */
export const WORLD_FILL_POSITION: CameraSpaceOffset = [-1, -0.5, -1];

const worldOffset = new THREE.Vector3();

/**
 * Aim a directional light at the orbit target from a camera-space direction,
 * so the lit side follows every pose and free rotation. A directional light
 * depends only on the direction from its target to itself; the light is put
 * at the camera's distance only to keep its position in a sensible range.
 */
export function placeCameraLight(
  light: THREE.DirectionalLight,
  camera: THREE.Camera,
  target: THREE.Vector3,
  offset: CameraSpaceOffset
): void {
  const distance = camera.position.distanceTo(target) || 1;
  worldOffset.set(offset[0], offset[1], offset[2]).normalize()
    .multiplyScalar(distance)
    .applyQuaternion(camera.quaternion);
  light.position.copy(target).add(worldOffset);
  light.target.position.copy(target);
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
}

export interface CameraHeadlightOptions {
  keyOffset?: CameraSpaceOffset;
  fillOffset?: CameraSpaceOffset;
}

/**
 * Key and fill directional lights held fixed relative to the camera. Cortical
 * surfaces are viewed from every side; with world-fixed lights a lateral view
 * of one hemisphere can face away from the key light and be lit only by
 * ambient and fill, which reads as flat, muddy grey.
 */
export class CameraHeadlight {
  readonly keyOffset: CameraSpaceOffset;
  readonly fillOffset: CameraSpaceOffset;

  constructor(options: CameraHeadlightOptions = {}) {
    this.keyOffset = options.keyOffset ?? HEADLIGHT_KEY_OFFSET;
    this.fillOffset = options.fillOffset ?? HEADLIGHT_FILL_OFFSET;
  }

  /**
   * Re-aim the given key and fill lights for the current camera pose and orbit
   * target. The lights are passed on each call rather than held, so a caller
   * that replaces its light objects keeps them aimed.
   */
  update(
    camera: THREE.Camera,
    target: THREE.Vector3,
    key: THREE.DirectionalLight | undefined,
    fill: THREE.DirectionalLight | undefined
  ): void {
    if (key) placeCameraLight(key, camera, target, this.keyOffset);
    if (fill) placeCameraLight(fill, camera, target, this.fillOffset);
  }
}
