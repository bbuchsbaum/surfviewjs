/** No scientific inspection target is selected. */
export interface NoInspectionSelection {
  readonly kind: 'none';
}

/** One concrete vertex on one stable surface ID. */
export interface VertexInspectionSelection {
  readonly kind: 'vertex';
  readonly surfaceId: string;
  readonly vertexIndex: number;
}

/** One parcel, optionally anchored to a representative mesh vertex. */
export interface ParcelInspectionSelection {
  readonly kind: 'parcel';
  readonly surfaceId: string;
  readonly parcelId: number;
  readonly representativeVertexIndex?: number;
  readonly atlasId?: string;
}

export type InspectionSelection =
  | NoInspectionSelection
  | VertexInspectionSelection
  | ParcelInspectionSelection;

export const NO_INSPECTION_SELECTION: NoInspectionSelection = Object.freeze({ kind: 'none' });

export interface InspectionSelectionOptions {
  /** Mirror the selection with the viewer crosshair. Defaults to false. */
  readonly showCrosshair?: boolean;
}

export type InspectionSelectionFailureCode =
  | 'disposed'
  | 'surface-not-found'
  | 'invalid-vertex'
  | 'unsupported'
  | 'parcel-not-found'
  | 'atlas-mismatch';

export type InspectionSelectionResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly selection: InspectionSelection;
    }
  | {
      readonly ok: false;
      readonly code: InspectionSelectionFailureCode;
      readonly message: string;
    };

export interface InspectionSelectionChangedEvent {
  readonly selection: InspectionSelection;
  readonly previous: InspectionSelection;
}

export interface VertexInspectionLayerValue {
  readonly layerId: string;
  readonly label: string;
  readonly value: number | string | null;
  readonly units?: string;
  readonly missing: boolean;
}

export interface VertexInspectionParcel {
  readonly id: number;
  readonly label?: string;
}

export interface VertexInspectionAtlas {
  readonly id: string;
  readonly name?: string;
}

/** Immutable, control-neutral result for one surface vertex. */
export interface VertexInspection {
  readonly surfaceId: string;
  readonly vertexIndex: number;
  readonly world: readonly [number, number, number];
  readonly parcel?: VertexInspectionParcel;
  readonly atlas?: VertexInspectionAtlas;
  readonly values: readonly VertexInspectionLayerValue[];
}

/** @internal Normalize a validated selection and discard structural extras. */
export function freezeInspectionSelection(selection: InspectionSelection): InspectionSelection {
  switch (selection.kind) {
    case 'none':
      return NO_INSPECTION_SELECTION;
    case 'vertex':
      return Object.freeze({
        kind: 'vertex',
        surfaceId: selection.surfaceId,
        vertexIndex: selection.vertexIndex
      });
    case 'parcel':
      return Object.freeze({
        kind: 'parcel',
        surfaceId: selection.surfaceId,
        parcelId: selection.parcelId,
        ...(selection.representativeVertexIndex !== undefined
          ? { representativeVertexIndex: selection.representativeVertexIndex }
          : {}),
        ...(selection.atlasId !== undefined ? { atlasId: selection.atlasId } : {})
      });
  }
}

/** @internal Value equality for normalized immutable selections. */
export function inspectionSelectionsEqual(
  left: InspectionSelection,
  right: InspectionSelection
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'none' || right.kind === 'none') return true;
  if (left.kind === 'vertex' && right.kind === 'vertex') {
    return left.surfaceId === right.surfaceId && left.vertexIndex === right.vertexIndex;
  }
  if (left.kind === 'parcel' && right.kind === 'parcel') {
    return left.surfaceId === right.surfaceId &&
      left.parcelId === right.parcelId &&
      left.representativeVertexIndex === right.representativeVertexIndex &&
      left.atlasId === right.atlasId;
  }
  return false;
}
