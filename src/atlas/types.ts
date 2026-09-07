import type { ParcelData, ParcelRecord } from '../parcellation';

export type AtlasPlateOrientation = 'lateral' | 'medial';
export interface AtlasPoint { x: number; y: number }
export interface AtlasBounds extends AtlasPoint { width: number; height: number }
export interface AtlasPlateProvenance {
  source: string;
  citation?: string;
  license?: string;
  checksum?: string;
}

/** Mesh coordinates must be RAS, with labels in the same vertex ordering. */
export interface AtlasPlateInput {
  vertices: ArrayLike<number>;
  faces: ArrayLike<number>;
  vertexLabels: ArrayLike<number>;
  parcelData: ParcelData;
  hemisphere: 'left' | 'right';
  provenance?: AtlasPlateProvenance;
}

export interface AtlasPlateOptions {
  view?: AtlasPlateOrientation;
  width?: number;
  height?: number;
  /** Margin reserved for callouts, in SVG units. */
  padding?: number;
  /** Visibility samples per SVG unit. Higher values retain smaller features. */
  resolution?: number;
  fontSize?: number;
  /** Minimum visible area to label, in square SVG units. Fills are never filtered. */
  minLabelArea?: number;
  /** Maximum callout length in SVG units; increase to attempt more labels. */
  maxLeaderLength?: number;
  /** Minimum space between margin labels in SVG units (default 16). */
  calloutGap?: number;
  /** Optional grouping, e.g. parcel ID to network name. Never inferred from colors. */
  parcelGroups?: ReadonlyMap<number, string>;
  /** Display smoothing in SVG units (0–8, default 0). Curves move at most this
   * distance plus 0.4/resolution from sampled interfaces. Zero retains polylines. */
  contourSmoothing?: number;
  /** Short display text, e.g. Schaefer parcel IDs; full names remain in region titles. */
  labelText?: (parcel: Readonly<ParcelRecord>) => string;
  /** Optional text measurement in SVG units, e.g. a configured canvas measureText. */
  measureText?: (text: string, fontSize: number) => number;
  /** View-specific label positions; anchors remain attached to the visible ROI. */
  labelPositions?: ReadonlyMap<number, AtlasPoint>;
  /** Optional magnifications at which to prepare denser interior labels (1–8).
   * No new surface samples are created. Omit to build the overview only. */
  detailScales?: readonly number[];
}

export interface AtlasPlateRegion {
  id: number;
  label: string;
  /** Compound SVG path, with holes; use fill-rule="evenodd". */
  path: string;
  visibleArea: number;
  /** Bounds of the visible samples, before display smoothing. */
  bounds: AtlasBounds;
  group?: string;
}

export interface AtlasPlateLabel extends AtlasPoint {
  id: number;
  text: string;
  anchor: AtlasPoint;
  width: number;
  height: number;
  callout: boolean;
  calloutSide?: 'left' | 'right' | 'top' | 'bottom';
}

/** Reusable geometry and layout. Recoloring does not rebuild this object. */
export interface AtlasPlate {
  atlasId: string;
  atlasName: string;
  provenance?: AtlasPlateProvenance;
  hemisphere: 'left' | 'right';
  view: AtlasPlateOrientation;
  width: number;
  height: number;
  fontSize: number;
  resolution: number;
  contourSmoothing: number;
  /** Fingerprint of the projected label domain; binds saved positions to a view. */
  layoutKey: string;
  regions: readonly AtlasPlateRegion[];
  labels: readonly AtlasPlateLabel[];
  /** Precomputed interior layouts; label dimensions are in plate coordinates. */
  detailLevels: readonly { scale: number; labels: readonly AtlasPlateLabel[] }[];
  boundaryPath: string;
  /** Subset of shared interfaces separating two explicitly different groups. */
  groupBoundaryPath?: string;
  silhouettePath: string;
  /** Visible parcels for which a label did not fit or fell below minLabelArea. */
  unlabeledParcelIds: readonly number[];
  /** Parcels with no visible samples in this view. */
  hiddenParcelIds: readonly number[];
}

/** Internal orthographic visibility buffer. Zero means background/medial wall. */
export interface AtlasRaster {
  width: number;
  height: number;
  resolution: number;
  ids: Uint32Array;
}
