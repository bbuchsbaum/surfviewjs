import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventEmitter } from '../../src/EventEmitter';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import type { ViewerEventMap } from '../../src/events';
import type { NeuroSurface } from '../../src/classes';
import {
  CameraHeadlight,
  HEADLIGHT_FILL_OFFSET,
  HEADLIGHT_KEY_OFFSET,
  WORLD_FILL_POSITION,
  placeCameraLight
} from '../../src/viewer/CameraHeadlight';
import { getStylePreset } from '../../src/StylePresets';

function lookFrom(camera: THREE.PerspectiveCamera, position: [number, number, number], up: [number, number, number] = [0, 0, 1]): void {
  camera.position.set(...position);
  camera.up.set(...up);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
}

/** World direction from the light's target towards the light. */
function lightDirection(light: THREE.DirectionalLight): THREE.Vector3 {
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(light.matrixWorld)
    .sub(new THREE.Vector3().setFromMatrixPosition(light.target.matrixWorld))
    .normalize();
}

/** The camera-space offset expressed in world space. */
function expectedDirection(camera: THREE.Camera, offset: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(...offset).normalize().applyQuaternion(camera.quaternion);
}

describe('placeCameraLight', () => {
  it('places a directional light at a camera-space offset, aimed at the orbit target', () => {
    const camera = new THREE.PerspectiveCamera();
    lookFrom(camera, [-300, 0, 0]);
    const light = new THREE.DirectionalLight();
    const target = new THREE.Vector3(5, 0, 0);
    placeCameraLight(light, camera, target, HEADLIGHT_KEY_OFFSET);
    expect(light.target.position.toArray()).toEqual([5, 0, 0]);
    expect(lightDirection(light).distanceTo(expectedDirection(camera, HEADLIGHT_KEY_OFFSET))).toBeLessThan(1e-6);
  });
});

describe('CameraHeadlight', () => {
  it('follows the camera so the visible side is always key-lit', () => {
    const camera = new THREE.PerspectiveCamera();
    const key = new THREE.DirectionalLight();
    const fill = new THREE.DirectionalLight();
    const headlight = new CameraHeadlight();
    const target = new THREE.Vector3();
    for (const position of [[-300, 0, 0], [300, 0, 0], [0, 0, 300], [0, -300, 10]] as Array<[number, number, number]>) {
      lookFrom(camera, position, position[2] === 300 ? [0, 1, 0] : [0, 0, 1]);
      headlight.update(camera, target, key, fill);
      const toCamera = camera.position.clone().normalize();
      expect(lightDirection(key).distanceTo(expectedDirection(camera, HEADLIGHT_KEY_OFFSET))).toBeLessThan(1e-6);
      expect(lightDirection(fill).distanceTo(expectedDirection(camera, HEADLIGHT_FILL_OFFSET))).toBeLessThan(1e-6);
      // A surface facing the camera receives most of the key light.
      expect(lightDirection(key).dot(toCamera)).toBeGreaterThan(0.8);
    }
  });

  it('tolerates a missing light', () => {
    const camera = new THREE.PerspectiveCamera();
    lookFrom(camera, [0, 0, 100], [0, 1, 0]);
    expect(() => new CameraHeadlight().update(camera, new THREE.Vector3(), undefined, undefined)).not.toThrow();
  });
});

function makeViewer(headlight: boolean): NeuroSurfaceViewer {
  const viewer = new EventEmitter<ViewerEventMap>() as NeuroSurfaceViewer;
  Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
  const mutable = viewer as any;
  mutable.disposed = false;
  mutable.initializationFailed = false;
  mutable.surfaces = new Map<string, NeuroSurface>();
  mutable.scene = new THREE.Scene();
  mutable.camera = new THREE.PerspectiveCamera(35, 2, 0.1, 1000);
  lookFrom(mutable.camera, [-300, 0, 0]);
  mutable.cameraControls = { target: new THREE.Vector3(), update: vi.fn() };
  mutable.config = { headlight, useShaders: false };
  mutable.stylePreset = getStylePreset('presentation');
  mutable.renderer = { render: vi.fn() };
  mutable.directionalLight = new THREE.DirectionalLight();
  mutable.directionalLight.position.set(...getStylePreset('presentation').lighting.directionalPosition);
  mutable.fillLight = new THREE.DirectionalLight();
  mutable.fillLight.position.set(...WORLD_FILL_POSITION);
  mutable.invalidateState = vi.fn();
  mutable.requestRender = vi.fn();
  return viewer;
}

describe('NeuroSurfaceViewer headlight', () => {
  it('moves the key and fill lights with the camera on every render when enabled', () => {
    const viewer = makeViewer(true);
    viewer.render();
    expect(lightDirection(viewer.directionalLight).distanceTo(expectedDirection(viewer.camera, HEADLIGHT_KEY_OFFSET))).toBeLessThan(1e-6);
    lookFrom(viewer.camera, [300, 0, 0]);
    viewer.render();
    expect(lightDirection(viewer.directionalLight).distanceTo(expectedDirection(viewer.camera, HEADLIGHT_KEY_OFFSET))).toBeLessThan(1e-6);
    expect(lightDirection(viewer.fillLight).distanceTo(expectedDirection(viewer.camera, HEADLIGHT_FILL_OFFSET))).toBeLessThan(1e-6);
  });

  it('keeps world-fixed lights with headlight: false and restores them when switched off', () => {
    const viewer = makeViewer(false);
    viewer.render();
    const preset = getStylePreset('presentation').lighting.directionalPosition;
    expect(viewer.directionalLight.position.toArray()).toEqual(preset);
    expect(viewer.fillLight.position.toArray()).toEqual([...WORLD_FILL_POSITION]);

    viewer.setHeadlight(true);
    expect(viewer.config.headlight).toBe(true);
    viewer.render();
    expect(viewer.directionalLight.position.toArray()).not.toEqual(preset);

    viewer.setHeadlight(false);
    expect(viewer.config.headlight).toBe(false);
    expect(viewer.directionalLight.position.toArray()).toEqual(preset);
    expect(viewer.directionalLight.target.position.toArray()).toEqual([0, 0, 0]);
    expect(viewer.fillLight.position.toArray()).toEqual([...WORLD_FILL_POSITION]);
    expect(viewer.fillLight.target.position.toArray()).toEqual([0, 0, 0]);
    viewer.render();
    expect(viewer.directionalLight.position.toArray()).toEqual(preset);
  });

  it('places the lights before render:before listeners run', () => {
    const viewer = makeViewer(true);
    let seen: THREE.Vector3 | null = null;
    viewer.on('render:before', () => { seen = lightDirection(viewer.directionalLight); });
    viewer.render();
    expect(seen!.distanceTo(expectedDirection(viewer.camera, HEADLIGHT_KEY_OFFSET))).toBeLessThan(1e-6);
  });
});
