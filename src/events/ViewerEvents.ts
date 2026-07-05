/**
 * Events emitted by the viewer
 */

import { NeuroSurface } from '../classes';
import type { AnnotationRecord } from '../annotations';
import type { Layer } from '../layers';
import type { RestorationReport } from '../serialization/ViewerState';
import * as THREE from 'three';

export type NumericRange = [number, number];

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

export interface ViewerSurfaceEvent {
  surface: NeuroSurface;
  id: string;
  surfaceId: string;
}

export interface LayerEvent {
  surfaceId: string;
  layerId: string;
  layer?: Layer | null;
}

export interface LayerUpdatedEvent extends LayerEvent {
  changes?: Record<string, unknown>;
}

export interface LayerColormapEvent extends LayerEvent {
  colormap: string;
}

export interface LayerRangeEvent extends LayerEvent {
  range: NumericRange;
}

export interface LayerThresholdEvent extends LayerEvent {
  threshold: NumericRange;
}

export interface LayerOpacityEvent extends LayerEvent {
  opacity: number;
}

export interface AnnotationEvent {
  annotation: AnnotationRecord;
  id: string;
  surfaceId: string;
  vertexIndex: number;
  active: boolean;
}

export interface ViewpointChangedEvent {
  viewpoint: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export interface CameraChangedEvent {
  camera: THREE.Camera;
  position: THREE.Vector3;
  target: THREE.Vector3 | null;
}

export interface ViewerEventMap {
  'context:lost': void;
  'context:restored': void;
  'surface:added': ViewerSurfaceEvent;
  'surface:removed': ViewerSurfaceEvent;
  'surface:selected': { surface: NeuroSurface | null };
  'surface:variant': { surfaceId: string; variant: string };
  'surface:colormap': { surfaceId: string; colormap: string };
  'camera:changed': CameraChangedEvent;
  'viewpoint:changed': ViewpointChangedEvent;
  'mouse:move': { position: THREE.Vector2; intersection: THREE.Vector3 | null };
  'mouse:click': { position: THREE.Vector2; surface: NeuroSurface | null; point: THREE.Vector3 | null };
  'layer:added': LayerEvent;
  'layer:removed': LayerEvent;
  'layer:updated': LayerUpdatedEvent;
  'layer:colormap': LayerColormapEvent;
  'layer:intensity': LayerRangeEvent;
  'layer:threshold': LayerThresholdEvent;
  'layer:opacity': LayerOpacityEvent;
  'surface:click': SurfacePickEvent;
  'vertex:hover': VertexHoverEvent;
  'parcel:hover': ParcelInteractionEvent;
  'parcel:click': ParcelInteractionEvent;
  'parcel:selected': ParcelSelectionEvent;
  'annotation:added': AnnotationEvent;
  'annotation:moved': AnnotationEvent;
  'annotation:removed': AnnotationEvent;
  'annotation:activated': AnnotationEvent;
  'annotation:reset': void;
  'state:restored': RestorationReport;
  'render:before': void;
  'render:after': void;
  'render:needed': void;
  'resize': { width: number; height: number };
  'controls:changed': { enabled: boolean };
  'controls:error': { error: unknown };
}

export type ViewerEventType = keyof ViewerEventMap;
export type ViewerEventListener<K extends ViewerEventType> =
  ViewerEventMap[K] extends void ? () => void : (event: ViewerEventMap[K]) => void;
