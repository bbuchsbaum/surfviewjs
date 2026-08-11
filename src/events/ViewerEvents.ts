/**
 * Events emitted by the viewer
 */

import { NeuroSurface } from '../classes';
import type { AnnotationRecord } from '../annotations';
import type { Layer } from '../layers';
import type { RestorationReport } from '../serialization/ViewerState';
import type {
  AnatomicalViewChangedEvent,
  BilateralSurfaceGroupRegisteredEvent,
  BilateralSurfaceGroupRemovedEvent
} from '../AnatomicalView';
import type { InspectionSelectionChangedEvent } from '../Inspection';
import * as THREE from 'three';

export type NumericRange = [number, number];

/** Stable viewer-state sections used by coarse invalidation subscribers. */
export type ControlDomain =
  | 'camera'
  | 'surfaces'
  | 'layers'
  | 'selection'
  | 'appearance'
  | 'timeline';

/**
 * Coarse, synchronous invalidation emitted after a control-relevant mutation.
 * This is a state revision, not a render-completed notification.
 */
export interface ViewerStateChangedEvent {
  readonly revision: number;
  readonly domains: readonly ControlDomain[];
}

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

export interface LayerReorderedEvent {
  surfaceId: string;
  order: readonly string[];
  previousOrder: readonly string[];
  movedLayerId?: string;
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
  /** Emitted once after disposal begins and before viewer-owned resources are torn down. */
  'viewer:disposing': void;
  'context:lost': void;
  'context:restored': void;
  'surface:added': ViewerSurfaceEvent;
  'surface:removed': ViewerSurfaceEvent;
  'surface:selected': { surface: NeuroSurface | null };
  'surface:variant': { surfaceId: string; variant: string };
  'surface:colormap': { surfaceId: string; colormap: string };
  'surface-group:registered': BilateralSurfaceGroupRegisteredEvent;
  'surface-group:removed': BilateralSurfaceGroupRemovedEvent;
  'camera:changed': CameraChangedEvent;
  'viewpoint:changed': ViewpointChangedEvent;
  'anatomical-view:changed': AnatomicalViewChangedEvent;
  'anatomical-view:reset': void;
  'mouse:move': { position: THREE.Vector2; intersection: THREE.Vector3 | null };
  'mouse:click': { position: THREE.Vector2; surface: NeuroSurface | null; point: THREE.Vector3 | null };
  'layer:added': LayerEvent;
  'layer:removed': LayerEvent;
  'layer:updated': LayerUpdatedEvent;
  'layer:reordered': LayerReorderedEvent;
  'layer:colormap': LayerColormapEvent;
  'layer:intensity': LayerRangeEvent;
  'layer:threshold': LayerThresholdEvent;
  'layer:opacity': LayerOpacityEvent;
  'surface:click': SurfacePickEvent;
  'vertex:hover': VertexHoverEvent;
  'parcel:hover': ParcelInteractionEvent;
  'parcel:click': ParcelInteractionEvent;
  'parcel:selected': ParcelSelectionEvent;
  'selection:changed': InspectionSelectionChangedEvent;
  'annotation:added': AnnotationEvent;
  'annotation:moved': AnnotationEvent;
  'annotation:removed': AnnotationEvent;
  'annotation:activated': AnnotationEvent;
  'annotation:reset': void;
  'state:restored': RestorationReport;
  'state:changed': ViewerStateChangedEvent;
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
