import { deflateSync, inflateSync } from 'fflate';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const CURRENT_VERSION = 1;

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
  order: number;
  [key: string]: unknown; // type-specific fields
}

export interface SurfaceState {
  id: string;
  type: string;
  hemisphere?: string;
  visible: boolean;
  layers: LayerState[];
  clipPlanes: ClipPlaneState[];
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

export interface SelectionState {
  surfaceId: string | null;
  layerId: string | null;
}

export interface ViewerStateV1 {
  version: 1;
  camera: CameraState;
  config: ViewerConfigState;
  surfaces: Record<string, SurfaceState>;
  crosshair: CrosshairState;
  timeline: TimelineState | null;
  selection: SelectionState;
}

// ---------------------------------------------------------------------------
// Restoration report
// ---------------------------------------------------------------------------

export interface RestorationReport {
  success: boolean;
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
    binary += String.fromCharCode(bytes[i]);
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
 * Encode a ViewerStateV1 object into a URL hash fragment string.
 * Pipeline: JSON → UTF-8 → deflate → base64url → "svjs=..."
 */
export function encode(state: ViewerStateV1): string {
  const json = JSON.stringify(state);
  const utf8 = new TextEncoder().encode(json);
  const compressed = deflateSync(utf8);
  return HASH_PREFIX + toBase64url(compressed);
}

/**
 * Decode a URL hash fragment string back into a ViewerStateV1.
 * Throws on invalid input, corrupted data, or unsupported version.
 */
export function decode(hash: string): ViewerStateV1 {
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
    throw new Error(`State decode failed: corrupted or invalid data (${(err as Error).message})`);
  }

  const json = new TextDecoder().decode(decompressed);
  let state: ViewerStateV1;
  try {
    state = JSON.parse(json);
  } catch {
    throw new Error('State decode failed: invalid JSON');
  }

  if (!state || typeof state !== 'object') {
    throw new Error('State decode failed: not an object');
  }

  if (!('version' in state)) {
    throw new Error('State decode failed: missing version field');
  }

  if (state.version > CURRENT_VERSION) {
    throw new Error(
      `State version ${state.version} is newer than supported (${CURRENT_VERSION}). ` +
      `Please upgrade surfviewjs to load this state.`
    );
  }

  // Apply migrations for older versions
  if (state.version < CURRENT_VERSION) {
    return migrate(state);
  }

  return state;
}

// ---------------------------------------------------------------------------
// Version migration chain
// ---------------------------------------------------------------------------

function migrate(state: any): ViewerStateV1 {
  let current = state;

  // Future: if (current.version === 1) current = migrateV1toV2(current);
  // Future: if (current.version === 2) current = migrateV2toV3(current);

  return current as ViewerStateV1;
}

// Stub for future use
// function migrateV1toV2(state: ViewerStateV1): ViewerStateV2 { ... }

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

export const DEFAULT_SELECTION: SelectionState = {
  surfaceId: null,
  layerId: null
};
