/**
 * Events emitted by the viewer
 */

import { NeuroSurface } from '../classes';
import * as THREE from 'three';

export interface ViewerEventMap {
  'surface:added': { surface: NeuroSurface; id: string };
  'surface:removed': { surface: NeuroSurface; id: string };
  'surface:selected': { surface: NeuroSurface | null };
  'camera:changed': { camera: THREE.Camera };
  'viewpoint:changed': { viewpoint: string };
  'mouse:move': { position: THREE.Vector2; intersection: THREE.Vector3 | null };
  'mouse:click': { position: THREE.Vector2; surface: NeuroSurface | null; point: THREE.Vector3 | null };
  'render:before': void;
  'render:after': void;
  'resize': { width: number; height: number };
  'controls:changed': { enabled: boolean };
}

export type ViewerEventType = keyof ViewerEventMap;