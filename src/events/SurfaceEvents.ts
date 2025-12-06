/**
 * Events emitted by surfaces
 */

import { NeuroSurface } from '../classes';
import { Layer } from '../layers';

export interface SurfaceEventMap {
  'visibility:changed': { surface: NeuroSurface; visible: boolean };
  'opacity:changed': { surface: NeuroSurface; opacity: number };
  'color:changed': { surface: NeuroSurface; color: any };
  'layer:added': { surface: NeuroSurface; layer: Layer };
  'layer:removed': { surface: NeuroSurface; layerId: string };
  'layer:updated': { surface: NeuroSurface; layer: Layer };
  'data:updated': { surface: NeuroSurface; data: Float32Array };
  'geometry:updated': { surface: NeuroSurface };
  'material:updated': { surface: NeuroSurface };
  'dispose': { surface: NeuroSurface };
  'render:needed': { surface: NeuroSurface };
}

export type SurfaceEventType = keyof SurfaceEventMap;