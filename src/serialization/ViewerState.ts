import { deflateSync, inflateSync } from 'fflate';
import type { InspectionSelection } from '../Inspection';
import {
  assertFiniteJSONNumbers,
  finiteNumber,
  finitePair,
  opacity,
  rgbInteger
} from '../utils/validation';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const CURRENT_VERSION = 2;

// ---------------------------------------------------------------------------
// State interfaces
// ---------------------------------------------------------------------------

export interface CameraState {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  zoom: number;
  fov: number;
}

export interface LightingState {
  ambientIntensity?: number;
  directionalIntensity?: number;
  directionalPosition?: [number, number, number];
}

export interface ViewerConfigState {
  background?: number;
  lighting?: LightingState;
  rimStrength?: number;
}

export interface ClipPlaneState {
  axis: 'x' | 'y' | 'z' | 'custom';
  normal: [number, number, number];
  distance: number;
  enabled: boolean;
  flip: boolean;
}

export interface LayerState {
  id: string;
  type: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  /** Legacy initialization order. ViewerState v2 uses SurfaceState.layerOrder. */
  order?: number;
  [key: string]: unknown; // type-specific fields
}

export interface SurfaceStateV1 {
  id: string;
  type: string;
  hemisphere?: string;
  visible: boolean;
  layers: LayerState[];
  clipPlanes: ClipPlaneState[];
}

export interface SurfaceState extends SurfaceStateV1 {
  /** Exact bottom-to-top order used by rendering and compositing. */
  layerOrder: string[];
}

export interface CrosshairState {
  visible: boolean;
  surfaceId: string | null;
  vertexIndex: number | null;
  size: number;
  color: number;
  mode: string | null;
}

export interface TimelineState {
  currentTime: number;
  speed: number;
  loopMode: string;
  playing: boolean;
}

/** @deprecated Legacy ViewerStateV1 pane focus; never scientific selection. */
export interface SelectionState {
  surfaceId: string | null;
  layerId: string | null;
}

/** Plain serialized descriptor for an explicitly coordinated surface group. */
export interface SurfaceGroupState {
  kind: 'bilateral';
  id: string;
  leftSurfaceId: string;
  rightSurfaceId: string;
}

export interface ViewerStateV1 {
  version: 1;
  camera: CameraState;
  config: ViewerConfigState;
  surfaces: Record<string, SurfaceStateV1>;
  crosshair: CrosshairState;
  timeline: TimelineState | null;
  selection: SelectionState;
}

export interface ViewerStateV2 {
  version: 2;
  camera: CameraState;
  config: ViewerConfigState;
  surfaces: Record<string, SurfaceState>;
  surfaceGroups: SurfaceGroupState[];
  crosshair: CrosshairState;
  timeline: TimelineState | null;
  inspectionSelection: InspectionSelection;
}

export type ViewerState = ViewerStateV1 | ViewerStateV2;

/**
 * Reject numeric state that cannot be restored without producing invalid camera,
 * layer, correction, or timeline values. This also prevents JSON.stringify from
 * silently converting NaN or infinities to null.
 */
export function assertValidViewerStateNumbers(state: ViewerState): void {
  assertFiniteJSONNumbers(state);
  const camera = state.camera;
  finiteTuple(camera.position, '$.camera.position', 3);
  finiteTuple(camera.quaternion, '$.camera.quaternion', 4);
  finiteTuple(camera.target, '$.camera.target', 3);
  finiteTuple(camera.up, '$.camera.up', 3);
  finiteNumber(camera.zoom, '$.camera.zoom', { minimum: 0, minimumExclusive: true });
  finiteNumber(camera.fov, '$.camera.fov', {
    minimum: 0,
    minimumExclusive: true,
    maximum: 180,
    maximumExclusive: true
  });

  if (state.config.background !== undefined) {
    rgbInteger(state.config.background, '$.config.background');
  }
  if (state.config.rimStrength !== undefined) {
    finiteNumber(state.config.rimStrength, '$.config.rimStrength', { minimum: 0 });
  }
  const lighting = state.config.lighting;
  if (lighting?.ambientIntensity !== undefined) {
    finiteNumber(lighting.ambientIntensity, '$.config.lighting.ambientIntensity', { minimum: 0 });
  }
  if (lighting?.directionalIntensity !== undefined) {
    finiteNumber(
      lighting.directionalIntensity,
      '$.config.lighting.directionalIntensity',
      { minimum: 0 }
    );
  }
  if (lighting?.directionalPosition !== undefined) {
    finiteTuple(lighting.directionalPosition, '$.config.lighting.directionalPosition', 3);
  }

  for (const [surfaceId, surface] of Object.entries(state.surfaces ?? {})) {
    for (const [index, layer] of (surface.layers ?? []).entries()) {
      const path = `$.surfaces.${surfaceId}.layers[${index}]`;
      opacity(layer.opacity, `${path}.opacity`);
      if (layer.order !== undefined) finiteNumber(layer.order, `${path}.order`);
      for (const key of [
        'range', 'threshold', 'rangeX', 'rangeY', 'thresholdX', 'thresholdY',
        'positiveRange', 'negativeRange'
      ]) {
        const value = layer[key];
        if (value !== undefined) finitePair(value, `${path}.${key}`);
      }
      if (layer.degreesOfFreedom !== undefined) {
        finiteNumber(layer.degreesOfFreedom, `${path}.degreesOfFreedom`, {
          minimum: 0,
          minimumExclusive: true
        });
      }
      for (const key of ['fdrQ', 'bonferroniAlpha']) {
        const value = layer[key];
        if (value !== undefined) {
          finiteNumber(value, `${path}.${key}`, { minimum: 0, maximum: 1 });
        }
      }
    }
    for (const [index, clip] of (surface.clipPlanes ?? []).entries()) {
      finiteTuple(clip.normal, `$.surfaces.${surfaceId}.clipPlanes[${index}].normal`, 3);
      finiteNumber(clip.distance, `$.surfaces.${surfaceId}.clipPlanes[${index}].distance`);
    }
  }

  finiteNumber(state.crosshair.size, '$.crosshair.size', {
    minimum: 0,
    minimumExclusive: true
  });
  rgbInteger(state.crosshair.color, '$.crosshair.color');
  if (state.crosshair.vertexIndex !== null) {
    finiteNumber(state.crosshair.vertexIndex, '$.crosshair.vertexIndex', {
      minimum: 0,
      integer: true
    });
  }
  if (state.timeline) {
    finiteNumber(state.timeline.currentTime, '$.timeline.currentTime');
    finiteNumber(state.timeline.speed, '$.timeline.speed', {
      minimum: 0,
      minimumExclusive: true
    });
  }
}

function finiteTuple(value: unknown, parameter: string, length: number): void {
  if (!Array.isArray(value) || value.length !== length) {
    throw new RangeError(`${parameter} must contain exactly ${length} finite values.`);
  }
  value.forEach((item, index) => finiteNumber(item, `${parameter}[${index}]`));
}

// ---------------------------------------------------------------------------
// Restoration report
// ---------------------------------------------------------------------------

export type RestorationIssueCode =
  | 'invalid-state'
  | 'unsupported-version'
  | 'surface-not-found'
  | 'surface-id-mismatch'
  | 'layer-not-found'
  | 'duplicate-layer-id'
  | 'invalid-layer-order'
  | 'unsupported-layer-order'
  | 'invalid-surface-group'
  | 'unsupported-surface-groups'
  | 'invalid-selection'
  | 'unsupported-selection';

export interface RestorationIssue {
  code: RestorationIssueCode;
  path: string;
  message: string;
}

export interface RestorationReport {
  success: boolean;
  sourceVersion: 1 | 2 | null;
  restoredVersion: 2;
  errors: RestorationIssue[];
  warnings: string[];
  surfacesRestored: string[];
  surfacesSkipped: string[];
}

// ---------------------------------------------------------------------------
// Base64url helpers (no +, /, = characters)
// ---------------------------------------------------------------------------

function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    // `i` is bounded by the captured typed-array length.
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Restore padding
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Encode / Decode
// ---------------------------------------------------------------------------

const HASH_PREFIX = 'svjs=';

/**
 * Encode a versioned viewer state object into a URL hash fragment string.
 * Pipeline: JSON → UTF-8 → deflate → base64url → "svjs=..."
 */
export function encode(state: ViewerState): string {
  assertValidViewerStateNumbers(state);
  const json = JSON.stringify(state);
  const utf8 = new TextEncoder().encode(json);
  const compressed = deflateSync(utf8);
  return HASH_PREFIX + toBase64url(compressed);
}

/**
 * Decode a URL hash fragment and normalize it to the current ViewerStateV2.
 * Throws on invalid input, corrupted data, or unsupported versions.
 */
export function decode(hash: string): ViewerStateV2 {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) {
    throw new Error('Invalid state hash: missing "svjs=" prefix');
  }

  const b64 = raw.slice(HASH_PREFIX.length);
  if (b64.length === 0) {
    throw new Error('Invalid state hash: empty payload');
  }

  let decompressed: Uint8Array;
  try {
    const compressed = fromBase64url(b64);
    decompressed = inflateSync(compressed);
  } catch (err) {
    throw new Error(
      `State decode failed: corrupted or invalid data (${(err as Error).message})`,
      { cause: err }
    );
  }

  const json = new TextDecoder().decode(decompressed);
  let state: unknown;
  try {
    state = JSON.parse(json);
  } catch {
    throw new Error('State decode failed: invalid JSON');
  }

  return migrateViewerState(state);
}

// ---------------------------------------------------------------------------
// Version migration chain
// ---------------------------------------------------------------------------

export function migrateViewerState(state: unknown): ViewerStateV2 {
  if (!state || typeof state !== 'object') {
    throw new Error('State migration failed: not an object');
  }
  if (!('version' in state)) {
    throw new Error('State migration failed: missing version field');
  }

  const version = (state as { version?: unknown }).version;
  if (version === 2) return state as ViewerStateV2;
  if (version === 1) return migrateV1toV2(state as ViewerStateV1);
  if (typeof version === 'number' && version > CURRENT_VERSION) {
    throw new Error(
      `State version ${version} is newer than supported (${CURRENT_VERSION}). ` +
      'Please upgrade surfviewjs to load this state.'
    );
  }
  throw new Error(`State migration failed: unsupported version ${String(version)}`);
}

/**
 * Deterministically migrate the legacy v1 schema.
 *
 * Missing or non-finite LayerState.order values use the legacy default of 0;
 * source-array position is the stable tie-breaker. Legacy selection contains
 * pane focus and is never promoted. The sole legacy scientific-selection rule
 * is a visible crosshair whose mode is exactly "selection", whose surface ID is
 * non-empty, and whose vertex index is a non-negative integer.
 */
export function migrateV1toV2(state: ViewerStateV1): ViewerStateV2 {
  if (!state.surfaces || typeof state.surfaces !== 'object') {
    throw new Error('State migration failed: v1 surfaces must be an object');
  }

  const surfaces: Record<string, SurfaceState> = {};
  for (const [surfaceId, surface] of Object.entries(state.surfaces)) {
    const layers = Array.isArray(surface?.layers)
      ? surface.layers.map(layer => {
          const order = layer.order;
          return {
            ...layer,
            order: typeof order === 'number' && Number.isFinite(order) ? order : 0
          };
        })
      : [];
    const layerOrder = layers
      .map((layer, index) => ({ id: layer.id, order: layer.order ?? 0, index }))
      .sort((left, right) => left.order - right.order || left.index - right.index)
      .map(layer => layer.id);

    surfaces[surfaceId] = {
      ...surface,
      layers,
      layerOrder
    };
  }

  return {
    version: 2,
    camera: state.camera,
    config: state.config,
    surfaces,
    surfaceGroups: [],
    crosshair: state.crosshair,
    timeline: state.timeline,
    inspectionSelection: migrateLegacyCrosshairSelection(state.crosshair)
  };
}

function migrateLegacyCrosshairSelection(crosshair: CrosshairState): InspectionSelection {
  if (
    crosshair?.visible === true &&
    crosshair.mode === 'selection' &&
    typeof crosshair.surfaceId === 'string' &&
    crosshair.surfaceId.length > 0 &&
    Number.isInteger(crosshair.vertexIndex) &&
    (crosshair.vertexIndex as number) >= 0
  ) {
    return {
      kind: 'vertex',
      surfaceId: crosshair.surfaceId,
      vertexIndex: crosshair.vertexIndex as number
    };
  }
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// Default state (for delta mode comparison)
// ---------------------------------------------------------------------------

export const DEFAULT_CAMERA: CameraState = {
  position: [0, 0, 200],
  quaternion: [0, 0, 0, 1],
  target: [0, 0, 0],
  up: [0, 1, 0],
  zoom: 1,
  fov: 45
};

export const DEFAULT_CROSSHAIR: CrosshairState = {
  visible: false,
  surfaceId: null,
  vertexIndex: null,
  size: 1.5,
  color: 0xffcc00,
  mode: null
};

/** @deprecated Legacy ViewerStateV1 pane focus; use inspection selection instead. */
export const DEFAULT_SELECTION: SelectionState = {
  surfaceId: null,
  layerId: null
};
