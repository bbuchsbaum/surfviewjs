/** Stable anatomical orientation names shared by viewer and report adapters. */
export type AnatomicalView =
  | 'lateral'
  | 'medial'
  | 'dorsal'
  | 'ventral'
  | 'anterior'
  | 'posterior';

export type AnatomicalHemisphere = 'left' | 'right';
export type AnatomicalViewLayout = 'single' | 'paired';
export type Vector3Tuple = readonly [number, number, number];

export const ANATOMICAL_VIEWS: readonly AnatomicalView[] = Object.freeze([
  'lateral',
  'medial',
  'dorsal',
  'ventral',
  'anterior',
  'posterior'
]);

export interface AnatomicalViewAxes {
  /** Unit vector from the target toward the camera. */
  readonly direction: Vector3Tuple;
  /** Screen-up direction for the view. */
  readonly up: Vector3Tuple;
}

export interface SingleAnatomicalViewOptions {
  readonly layout: 'single';
  readonly surfaceId: string;
  /** Fit the named surface to the viewport. Defaults to true. */
  readonly fit?: boolean;
}

export interface PairedAnatomicalViewOptions {
  readonly layout: 'paired';
  readonly groupId: string;
  /** Fit the registered pair to the viewport. Defaults to true. */
  readonly fit?: boolean;
  /** Adapter-specific space between paired hemispheres. Must be finite and non-negative. */
  readonly hemisphereGap?: number;
}

/** A view always names its target; loading two hemispheres never creates a pair implicitly. */
export type AnatomicalViewOptions =
  | SingleAnatomicalViewOptions
  | PairedAnatomicalViewOptions;

export interface BilateralSurfaceGroup {
  readonly id: string;
  readonly leftSurfaceId: string;
  readonly rightSurfaceId: string;
}

export type BilateralSurfaceGroupFailureCode =
  | 'disposed'
  | 'invalid-group-id'
  | 'group-id-exists'
  | 'group-not-found'
  | 'surface-not-found'
  | 'duplicate-surface'
  | 'invalid-hemisphere'
  | 'surface-already-grouped';

export type BilateralSurfaceGroupResult =
  | {
      readonly ok: true;
      readonly group: BilateralSurfaceGroup;
    }
  | {
      readonly ok: false;
      readonly code: BilateralSurfaceGroupFailureCode;
      readonly message: string;
    };

export type AnatomicalViewFailureCode =
  | 'disposed'
  | 'surface-not-found'
  | 'group-not-found'
  | 'invalid-hemisphere'
  | 'invalid-gap';

export type AnatomicalViewResult =
  | {
      readonly ok: true;
      readonly view: AnatomicalView;
      readonly layout: AnatomicalViewLayout;
      readonly surfaceIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: AnatomicalViewFailureCode;
      readonly message: string;
    };

export type AnatomicalViewResetResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'disposed' | 'unsupported';
      readonly message: string;
    };

export interface AnatomicalViewCapabilities {
  readonly views: readonly AnatomicalView[];
  readonly singleSurfaceIds: readonly string[];
  readonly bilateralGroups: readonly BilateralSurfaceGroup[];
}

export type BilateralSurfaceGroupRemovalReason =
  | 'explicit'
  | 'surface-removed'
  | 'surface-replaced'
  | 'surfaces-cleared';

export interface BilateralSurfaceGroupRegisteredEvent {
  readonly group: BilateralSurfaceGroup;
}

export interface BilateralSurfaceGroupRemovedEvent {
  readonly group: BilateralSurfaceGroup;
  readonly reason: BilateralSurfaceGroupRemovalReason;
  readonly removedSurfaceId?: string;
}

export interface AnatomicalViewChangedEvent {
  readonly view: AnatomicalView;
  readonly layout: AnatomicalViewLayout;
  readonly surfaceIds: readonly string[];
  readonly fit: boolean;
}

const LEFT_LATERAL: AnatomicalViewAxes = Object.freeze({
  direction: Object.freeze([-1, 0, 0]) as Vector3Tuple,
  up: Object.freeze([0, 0, 1]) as Vector3Tuple
});
const RIGHT_LATERAL: AnatomicalViewAxes = Object.freeze({
  direction: Object.freeze([1, 0, 0]) as Vector3Tuple,
  up: Object.freeze([0, 0, 1]) as Vector3Tuple
});
const LEFT_MEDIAL: AnatomicalViewAxes = Object.freeze({
  direction: Object.freeze([1, 0, 0]) as Vector3Tuple,
  up: Object.freeze([0, 0, 1]) as Vector3Tuple
});
const RIGHT_MEDIAL: AnatomicalViewAxes = Object.freeze({
  direction: Object.freeze([-1, 0, 0]) as Vector3Tuple,
  up: Object.freeze([0, 0, 1]) as Vector3Tuple
});
const DORSAL: AnatomicalViewAxes = Object.freeze({
  direction: Object.freeze([0, 0, 1]) as Vector3Tuple,
  up: Object.freeze([0, 1, 0]) as Vector3Tuple
});
const VENTRAL: AnatomicalViewAxes = Object.freeze({
  direction: Object.freeze([0, 0, -1]) as Vector3Tuple,
  up: Object.freeze([0, 1, 0]) as Vector3Tuple
});
const ANTERIOR: AnatomicalViewAxes = Object.freeze({
  direction: Object.freeze([0, 1, 0]) as Vector3Tuple,
  up: Object.freeze([0, 0, 1]) as Vector3Tuple
});
const POSTERIOR: AnatomicalViewAxes = Object.freeze({
  direction: Object.freeze([0, -1, 0]) as Vector3Tuple,
  up: Object.freeze([0, 0, 1]) as Vector3Tuple
});

/** Normalize common hemisphere aliases without guessing unknown metadata. */
export function normalizeAnatomicalHemisphere(value: string): AnatomicalHemisphere | null {
  switch (value.trim().toLowerCase()) {
    case 'left':
    case 'lh':
    case 'l':
      return 'left';
    case 'right':
    case 'rh':
    case 'r':
      return 'right';
    default:
      return null;
  }
}

/** Pure RAS-space orientation fixture used by every anatomical-view adapter. */
export function getAnatomicalViewAxes(
  hemisphere: AnatomicalHemisphere,
  view: AnatomicalView
): AnatomicalViewAxes {
  switch (view) {
    case 'lateral':
      return hemisphere === 'left' ? LEFT_LATERAL : RIGHT_LATERAL;
    case 'medial':
      return hemisphere === 'left' ? LEFT_MEDIAL : RIGHT_MEDIAL;
    case 'dorsal':
      return DORSAL;
    case 'ventral':
      return VENTRAL;
    case 'anterior':
      return ANTERIOR;
    case 'posterior':
      return POSTERIOR;
  }
}

export function freezeBilateralSurfaceGroup(
  group: BilateralSurfaceGroup
): BilateralSurfaceGroup {
  return Object.freeze({
    id: group.id,
    leftSurfaceId: group.leftSurfaceId,
    rightSurfaceId: group.rightSurfaceId
  });
}
