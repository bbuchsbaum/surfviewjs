import type { AnatomicalView } from '../AnatomicalView';
import type { InspectionSelection, VertexInspection } from '../Inspection';
import type { BlendMode, LayerPinnedPosition, LayerRole } from '../layers';

/** JSON values allowed in control descriptors and extension metadata. */
export type ControlJsonPrimitive = string | number | boolean | null;

export interface ControlJsonObject {
  readonly [key: string]: ControlJsonValue;
}

export type ControlJsonValue =
  | ControlJsonPrimitive
  | ControlJsonObject
  | readonly ControlJsonValue[];

/** Why a control operation is currently available or unavailable. */
export interface CapabilityAvailability {
  readonly enabled: boolean;
  readonly reason?: string;
}

export interface ControlOptionDescriptor<TId extends string = string> {
  readonly id: TId;
  readonly label: string;
  readonly availability: CapabilityAvailability;
}

export interface NumericRangeControlDescriptor {
  readonly value: readonly [number, number];
  readonly minimum: number;
  readonly maximum: number;
  readonly step?: number;
}

export interface HistogramControlDescriptor {
  readonly edges: readonly number[];
  readonly counts: readonly number[];
}

export interface LayerDataSummaryControlDescriptor {
  readonly finiteCount: number;
  readonly missingCount: number;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly histogram?: HistogramControlDescriptor;
}

/** Scalar mapping is the only specialized layer editor required by v0.1. */
export interface ScalarMappingControls {
  readonly availability: CapabilityAvailability;
  /** Changes only when the scalar data or its vertex domain changes. */
  readonly dataRevision: number;
  readonly colorMap: ControlOptionDescriptor;
  readonly availableColorMaps: readonly ControlOptionDescriptor[];
  readonly displayRange: NumericRangeControlDescriptor;
  /** Values inside this interval are masked; equal endpoints disable masking. */
  readonly maskInterval: NumericRangeControlDescriptor;
  readonly summary?: LayerDataSummaryControlDescriptor;
}

/** Independently evolvable placeholder for two-variable color mapping. */
export interface BivariateMappingControls {
  readonly availability: CapabilityAvailability;
  readonly xRange: NumericRangeControlDescriptor;
  readonly yRange: NumericRangeControlDescriptor;
  readonly colorMapId?: string;
}

/** Independently evolvable temporal-layer descriptor. */
export interface TemporalControls {
  readonly availability: CapabilityAvailability;
  readonly currentTime: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly loopMode?: string;
}

/** Independently evolvable parcel/atlas descriptor. */
export interface ParcelControls {
  readonly availability: CapabilityAvailability;
  readonly atlasId?: string;
  readonly atlasLabel?: string;
  readonly parcelCount?: number;
}

/** Independently evolvable outline descriptor. */
export interface OutlineControls {
  readonly availability: CapabilityAvailability;
  readonly color?: string;
  readonly width?: number;
}

export interface LayerColorPreviewDescriptor {
  readonly kind: 'solid' | 'colormap' | 'categorical';
  readonly label: string;
  readonly css: string;
}

/**
 * One canonical layer descriptor. Optional capability families are absent when
 * unsupported; callers never need to inspect a concrete layer subclass.
 */
export interface LayerControlDescriptor {
  readonly id: string;
  readonly surfaceId: string;
  readonly label: string;
  readonly description?: string;
  readonly units?: string;
  readonly metadata?: ControlJsonObject;
  readonly index: number;
  readonly role: LayerRole;
  readonly pinned: LayerPinnedPosition;
  readonly reorderable: boolean;
  /** Authoritative validity of the panel's visual Move Up command. */
  readonly moveUp: CapabilityAvailability;
  /** Authoritative validity of the panel's visual Move Down command. */
  readonly moveDown: CapabilityAvailability;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly colorPreview?: LayerColorPreviewDescriptor;
  readonly scalarMapping?: ScalarMappingControls;
  readonly bivariateMapping?: BivariateMappingControls;
  readonly temporal?: TemporalControls;
  readonly parcels?: ParcelControls;
  readonly outline?: OutlineControls;
}

export interface SurfaceControlDescriptor {
  readonly id: string;
  readonly label: string;
  readonly hemisphere: 'left' | 'right' | 'unknown';
  readonly visible: boolean;
  readonly groupId: string | null;
  /** Exact bottom-to-top rendering and compositing order. */
  readonly layers: readonly LayerControlDescriptor[];
  readonly metadata?: ControlJsonObject;
}

export type AnatomicalViewTargetRef =
  | { readonly kind: 'surface'; readonly surfaceId: string }
  | { readonly kind: 'group'; readonly groupId: string };

export interface AnatomicalViewTargetDescriptor {
  readonly target: AnatomicalViewTargetRef;
  readonly label: string;
  readonly availability: CapabilityAvailability;
}

export interface CurrentAnatomicalViewDescriptor {
  readonly view: AnatomicalView;
  readonly target: AnatomicalViewTargetRef;
}

export interface ViewControlDescriptor {
  readonly current: CurrentAnatomicalViewDescriptor | null;
  readonly anatomicalViews: readonly ControlOptionDescriptor<AnatomicalView>[];
  readonly targets: readonly AnatomicalViewTargetDescriptor[];
  readonly fit: CapabilityAvailability;
  readonly reset: CapabilityAvailability;
}

export interface SelectionControlDescriptor {
  readonly current: InspectionSelection;
  readonly inspection: VertexInspection | null;
  readonly vertexSelection: CapabilityAvailability;
  readonly parcelSelection: CapabilityAvailability;
}

export interface FigurePresetControlDescriptor extends ControlOptionDescriptor {
  readonly description?: string;
}

export interface FigureControlDescriptor {
  readonly preset: FigurePresetControlDescriptor;
  readonly availablePresets: readonly FigurePresetControlDescriptor[];
  readonly background: number;
  readonly transparent: boolean;
  readonly defaultWidth: number;
  readonly defaultHeight: number;
  readonly defaultDpi?: number;
  /** Preset default for PNG export; distinct from the live viewer background. */
  readonly defaultTransparent?: boolean;
  readonly defaultColorbar?: boolean;
  readonly exportPNG: CapabilityAvailability;
}

/** Optional report-style policy: exactly one map is displayed across a scene. */
export interface ExclusiveMapCapability {
  readonly availability: CapabilityAvailability;
  readonly displayedLayerId: string | null;
  readonly availableLayerIds: readonly string[];
}

export interface SurfViewControlCapabilities {
  readonly anatomicalViews: CapabilityAvailability;
  readonly surfaceVisibility: CapabilityAvailability;
  readonly layerVisibility: CapabilityAvailability;
  readonly layerOpacity: CapabilityAvailability;
  readonly layerBlendMode: CapabilityAvailability;
  readonly layerOrder: CapabilityAvailability;
  readonly scalarMapping: CapabilityAvailability;
  readonly scientificSelection: CapabilityAvailability;
  readonly figurePresets: CapabilityAvailability;
  readonly figureBackground: CapabilityAvailability;
  readonly exportPNG: CapabilityAvailability;
  /** Absent for ordinary viewers unless an application explicitly supplies it. */
  readonly exclusiveMap?: ExclusiveMapCapability;
}

/** Deeply readonly, JSON-like canonical state observed by every session. */
export interface SurfViewControlSnapshot {
  readonly revision: number;
  readonly view: ViewControlDescriptor;
  readonly surfaces: readonly SurfaceControlDescriptor[];
  readonly selection: SelectionControlDescriptor;
  readonly figure: FigureControlDescriptor;
  readonly capabilities: SurfViewControlCapabilities;
}

export type ControlCommandFailureCode =
  | 'surface-not-found'
  | 'layer-not-found'
  | 'group-not-found'
  | 'unsupported'
  | 'invalid-value'
  | 'conflict'
  | 'disposed';

export interface ControlCommandFailure {
  readonly ok: false;
  readonly code: ControlCommandFailureCode;
  readonly message: string;
}

export type ControlCommandSuccess<
  TValue extends ControlJsonValue | void = void
> = [TValue] extends [void]
  ? { readonly ok: true }
  : { readonly ok: true; readonly value: TValue };

export type ControlCommandResult<
  TValue extends ControlJsonValue | void = void
> = ControlCommandSuccess<TValue> | ControlCommandFailure;

/** Typed result for read-only target queries whose values are descriptors. */
export type ControlQueryResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | ControlCommandFailure;

export interface SetAnatomicalViewRequest {
  readonly view: AnatomicalView;
  readonly target: AnatomicalViewTargetRef;
  readonly fit?: boolean;
  readonly hemisphereGap?: number;
}

export interface LayerControlAddress {
  readonly surfaceId: string;
  readonly layerId: string;
}

export interface ScalarMappingUpdate {
  readonly colorMapId?: string;
  readonly displayRange?: readonly [number, number];
  /** Mask values inside this interval; equal endpoints disable masking. */
  readonly maskInterval?: readonly [number, number];
}

export interface FigureExportRequest {
  readonly width?: number;
  readonly height?: number;
  readonly dpi?: number;
  readonly transparent?: boolean;
  readonly colorbar?: boolean;
  readonly title?: string;
  readonly subtitle?: string;
  readonly filename?: string;
}

export interface FigureExportResult extends ControlJsonObject {
  readonly dataUrl: string;
  readonly mimeType: 'image/png';
  readonly width: number;
  readonly height: number;
  readonly filename: string | null;
}

/**
 * Commands shared by viewer and report-scene target adapters. An ok result
 * means the next canonical snapshot reflects the command; a failed command
 * must not mutate target state.
 */
export interface SurfViewControlTargetCommands {
  setAnatomicalView(request: SetAnatomicalViewRequest): ControlCommandResult;
  fitView(): ControlCommandResult;
  resetView(): ControlCommandResult;
  setSurfaceVisibility(surfaceId: string, visible: boolean): ControlCommandResult;
  setLayerVisibility(address: LayerControlAddress, visible: boolean): ControlCommandResult;
  setLayerOpacity(address: LayerControlAddress, opacity: number): ControlCommandResult;
  setLayerBlendMode(address: LayerControlAddress, blendMode: BlendMode): ControlCommandResult;
  setLayerOrder(surfaceId: string, layerIds: readonly string[]): ControlCommandResult;
  updateScalarMapping(address: LayerControlAddress, update: ScalarMappingUpdate): ControlCommandResult;
  setInspectionSelection(selection: InspectionSelection): ControlCommandResult;
  applyFigurePreset(presetId: string): ControlCommandResult;
  setFigureBackground(background: number, transparent?: boolean): ControlCommandResult;
  exportFigure(request?: FigureExportRequest): Promise<ControlCommandResult<FigureExportResult>>;
  /** Returns unsupported when ExclusiveMapCapability is absent. */
  setDisplayedLayer(layerId: string): ControlCommandResult;
}

export type SurfViewControlSnapshotListener = (snapshot: SurfViewControlSnapshot) => void;

export interface SurfViewControlSubscription {
  readonly closed: boolean;
  /** Idempotent; a closed subscription never receives another snapshot. */
  unsubscribe(): void;
}

/**
 * Stable control port implemented by viewer and report-scene adapters.
 *
 * subscribe() synchronously delivers the current snapshot once, then delivers
 * later canonical revisions. dispose() is idempotent, closes subscriptions,
 * and causes every subsequent command to return a disposed failure. A disposed
 * target may continue returning its last immutable snapshot from getSnapshot().
 */
export interface SurfViewControlTarget extends SurfViewControlTargetCommands {
  getSnapshot(): SurfViewControlSnapshot;
  /** Lazily obtain the configured histogram summary for one scalar layer. */
  getLayerDataSummary(
    address: LayerControlAddress
  ): ControlQueryResult<LayerDataSummaryControlDescriptor>;
  subscribe(listener: SurfViewControlSnapshotListener): SurfViewControlSubscription;
  isDisposed(): boolean;
  dispose(): void;
}

export type SurfViewControlSectionId =
  | 'view'
  | 'layers'
  | 'selected-layer'
  | 'selection'
  | 'figure';

/**
 * Presentation-local state owned by one future ControlSession. None of these
 * values belong in SurfViewControlSnapshot or ViewerState.
 */
export interface SurfViewControlSessionState {
  readonly focusedSurfaceId: string | null;
  readonly focusedLayerId: string | null;
  readonly expandedSections: readonly SurfViewControlSectionId[];
  readonly advancedVisible: boolean;
  readonly symmetricRangeLock: boolean;
}
