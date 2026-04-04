/**
 * Events emitted by the viewer
 */

import { NeuroSurface } from '../classes';
import * as THREE from 'three';

export interface SurfacePickEvent {
  surfaceId: string | null;
  point: THREE.Vector3 | null;
  vertexIndex: number | null;
  parcelId?: number | null;
  parcel?: Record<string, unknown> | null;
  parcelLabel?: string | null;
  atlasId?: string | null;
}

export interface VertexHoverEvent {
  surfaceId: string | null;
  vertexIndex: number | null;
  screenX: number;
  screenY: number;
  parcelId?: number | null;
  parcel?: Record<string, unknown> | null;
  parcelLabel?: string | null;
  atlasId?: string | null;
}

export interface ParcelInteractionEvent {
  surfaceId: string | null;
  point?: THREE.Vector3 | null;
  vertexIndex: number | null;
  screenX?: number;
  screenY?: number;
  parcelId: number | null;
  parcel: Record<string, unknown> | null;
  parcelLabel: string | null;
  atlasId: string | null;
}

export interface ParcelSelectionEvent extends ParcelInteractionEvent {
  selected: boolean;
}

export interface ViewerEventMap {
  'surface:added': { surface: NeuroSurface; id: string };
  'surface:removed': { surface: NeuroSurface; id: string };
  'surface:selected': { surface: NeuroSurface | null };
  'camera:changed': { camera: THREE.Camera };
  'viewpoint:changed': { viewpoint: string };
  'mouse:move': { position: THREE.Vector2; intersection: THREE.Vector3 | null };
  'mouse:click': { position: THREE.Vector2; surface: NeuroSurface | null; point: THREE.Vector3 | null };
  'surface:click': SurfacePickEvent;
  'vertex:hover': VertexHoverEvent;
  'parcel:hover': ParcelInteractionEvent;
  'parcel:click': ParcelInteractionEvent;
  'parcel:selected': ParcelSelectionEvent;
  'render:before': void;
  'render:after': void;
  'resize': { width: number; height: number };
  'controls:changed': { enabled: boolean };
}

export type ViewerEventType = keyof ViewerEventMap;
