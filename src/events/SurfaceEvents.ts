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
  'layer:updated': { surface: NeuroSurface; layer?: Layer | null; changes?: Record<string, unknown> };
  'data:updated': { surface: NeuroSurface; data: Float32Array };
  'geometry:updated': { surface: NeuroSurface };
  'geometry:smoothed': { surface: NeuroSurface; iterations: number; lambda: number; method: string };
  'variant:changed': { surface: NeuroSurface; variant: string };
  'material:updated': { surface: NeuroSurface };
  'morph:changed': { surface: NeuroSurface; target?: string; weight?: number; weights?: Record<string, number> };
  'morph:animating': { surface: NeuroSurface; progress: number };
  'morph:complete': { surface: NeuroSurface; target?: string; weights?: Record<string, number> };
  'morph:cancelled': { surface: NeuroSurface };
  'dispose': { surface: NeuroSurface };
  'render:needed': { surface: NeuroSurface };
}

export type SurfaceEventType = keyof SurfaceEventMap;
