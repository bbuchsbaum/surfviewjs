import type {
  ViewerStateV1,
  CameraState,
  ViewerConfigState,
  SurfaceState,
  LayerState,
  ClipPlaneState,
  CrosshairState,
  TimelineState,
  SelectionState
} from './ViewerState';
import { CURRENT_VERSION } from './ViewerState';

// ---------------------------------------------------------------------------
// StateSerializer — extracts a ViewerStateV1 from a live viewer
// ---------------------------------------------------------------------------

/**
 * Serialize a NeuroSurfaceViewer into a portable JSON state object.
 *
 * The viewer is accessed via duck-typing to avoid circular imports.
 * Components that implement `toStateJSON()` are preferred; otherwise
 * the serializer reads public fields directly.
 */
export function serialize(viewer: any): ViewerStateV1 {
  return {
    version: CURRENT_VERSION,
    camera: serializeCamera(viewer),
    config: serializeConfig(viewer),
    surfaces: serializeSurfaces(viewer),
    crosshair: serializeCrosshair(viewer),
    timeline: serializeTimeline(viewer),
    selection: serializeSelection(viewer)
  };
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function serializeCamera(viewer: any): CameraState {
  const cam = viewer.camera;
  if (!cam) {
    return {
      position: [0, 0, 200],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1,
      fov: 45
    };
  }

  const target = viewer.controls?.target ?? { x: 0, y: 0, z: 0 };

  return {
    position: [cam.position.x, cam.position.y, cam.position.z],
    quaternion: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
    target: [target.x, target.y, target.z],
    up: [cam.up.x, cam.up.y, cam.up.z],
    zoom: cam.zoom ?? 1,
    fov: cam.fov ?? 45
  };
}

// ---------------------------------------------------------------------------
// Viewer config
// ---------------------------------------------------------------------------

function serializeConfig(viewer: any): ViewerConfigState {
  const cfg: ViewerConfigState = {};

  if (viewer.config) {
    if (viewer.config.backgroundColor !== undefined) {
      cfg.background = viewer.config.backgroundColor;
    }
    if (viewer.config.rimStrength !== undefined) {
      cfg.rimStrength = viewer.config.rimStrength;
    }
  }

  cfg.lighting = {};
  if (viewer.ambientLight) {
    cfg.lighting.ambientIntensity = viewer.ambientLight.intensity;
  }
  if (viewer.directionalLight) {
    cfg.lighting.directionalIntensity = viewer.directionalLight.intensity;
    const p = viewer.directionalLight.position;
    cfg.lighting.directionalPosition = [p.x, p.y, p.z];
  }

  return cfg;
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

function serializeSurfaces(viewer: any): Record<string, SurfaceState> {
  const result: Record<string, SurfaceState> = {};
  const surfaces: Map<string, any> | undefined = viewer.surfaces;
  if (!surfaces) return result;

  for (const [id, surface] of surfaces) {
    // Prefer toStateJSON if available
    if (typeof surface.toStateJSON === 'function') {
      result[id] = surface.toStateJSON();
      result[id].id = id;
      continue;
    }

    const state: SurfaceState = {
      id,
      type: surface.constructor?.name ?? 'unknown',
      visible: surface.mesh?.visible ?? true,
      layers: [],
      clipPlanes: []
    };

    if (surface.hemisphere) {
      state.hemisphere = surface.hemisphere;
    }

    // Layers
    if (surface.layerStack) {
      const layers = surface.layerStack.getAllLayers?.() ?? [];
      for (const layer of layers) {
        state.layers.push(serializeLayer(layer));
      }
    }

    // Clip planes
    if (surface.clipPlanes && typeof surface.clipPlanes.toStateJSON === 'function') {
      state.clipPlanes = surface.clipPlanes.toStateJSON();
    }

    result[id] = state;
  }

  return result;
}

function serializeLayer(layer: any): LayerState {
  // Prefer toStateJSON() if available
  if (typeof layer.toStateJSON === 'function') {
    return layer.toStateJSON();
  }

  // Fallback: read common fields
  return {
    id: layer.id,
    type: layer.constructor?.name ?? 'unknown',
    visible: layer.visible ?? true,
    opacity: layer.opacity ?? 1,
    blendMode: layer.blendMode ?? 'normal',
    order: layer.order ?? 0
  };
}

// ---------------------------------------------------------------------------
// Crosshair
// ---------------------------------------------------------------------------

function serializeCrosshair(viewer: any): CrosshairState {
  const ch = viewer.crosshair;
  if (!ch) {
    return {
      visible: false,
      surfaceId: null,
      vertexIndex: null,
      size: 1.5,
      color: 0xffcc00,
      mode: null
    };
  }

  if (typeof ch.toStateJSON === 'function') {
    return ch.toStateJSON();
  }

  return {
    visible: ch.visible ?? false,
    surfaceId: ch.surfaceId ?? null,
    vertexIndex: ch.vertexIndex ?? null,
    size: ch.size ?? 1.5,
    color: ch.color ?? 0xffcc00,
    mode: ch.mode ?? null
  };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function serializeTimeline(viewer: any): TimelineState | null {
  // Look for timeline controller on surfaces
  const surfaces: Map<string, any> | undefined = viewer.surfaces;
  if (!surfaces) return null;

  for (const [, surface] of surfaces) {
    if (surface.timelineController) {
      const tc = surface.timelineController;
      if (typeof tc.toStateJSON === 'function') {
        return tc.toStateJSON();
      }
      return {
        currentTime: tc.getCurrentTime?.() ?? 0,
        speed: tc.getSpeed?.() ?? 1,
        loopMode: tc.getLoopMode?.() ?? 'loop',
        playing: tc.isPlaying?.() ?? false
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function serializeSelection(viewer: any): SelectionState {
  return {
    surfaceId: viewer.selectedSurfaceId ?? null,
    layerId: viewer.selectedLayerId ?? null
  };
}
