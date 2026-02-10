import type {
  ViewerStateV1,
  RestorationReport,
  LayerState,
  ClipPlaneState
} from './ViewerState';

// ---------------------------------------------------------------------------
// StateDeserializer — applies a ViewerStateV1 to a live viewer
// ---------------------------------------------------------------------------

/**
 * Apply a serialized state to a NeuroSurfaceViewer.
 *
 * Each section applies independently — one failure does not block others.
 * Returns a RestorationReport describing what succeeded and what was skipped.
 */
export function deserialize(
  viewer: any,
  state: ViewerStateV1
): RestorationReport {
  const report: RestorationReport = {
    success: true,
    warnings: [],
    surfacesRestored: [],
    surfacesSkipped: []
  };

  // 1. Viewer config
  try {
    applyConfig(viewer, state.config);
  } catch (err) {
    report.warnings.push(`config: ${(err as Error).message}`);
  }

  // 2. Camera
  try {
    applyCamera(viewer, state.camera);
  } catch (err) {
    report.warnings.push(`camera: ${(err as Error).message}`);
  }

  // 3. Surfaces (layers, clip planes, visibility)
  try {
    applySurfaces(viewer, state.surfaces, report);
  } catch (err) {
    report.warnings.push(`surfaces: ${(err as Error).message}`);
  }

  // 4. Crosshair
  try {
    applyCrosshair(viewer, state.crosshair);
  } catch (err) {
    report.warnings.push(`crosshair: ${(err as Error).message}`);
  }

  // 5. Timeline
  if (state.timeline) {
    try {
      applyTimeline(viewer, state.timeline);
    } catch (err) {
      report.warnings.push(`timeline: ${(err as Error).message}`);
    }
  }

  // 6. Selection
  try {
    applySelection(viewer, state.selection);
  } catch (err) {
    report.warnings.push(`selection: ${(err as Error).message}`);
  }

  report.success = report.warnings.length === 0;

  // Emit state:restored event
  if (typeof viewer.emit === 'function') {
    viewer.emit('state:restored', report);
  }

  // Request render
  if (typeof viewer.requestRender === 'function') {
    viewer.requestRender();
  }

  return report;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function applyCamera(viewer: any, camera: ViewerStateV1['camera']): void {
  if (!viewer.camera || !camera) return;

  const cam = viewer.camera;
  cam.position.set(camera.position[0], camera.position[1], camera.position[2]);
  cam.quaternion.set(
    camera.quaternion[0], camera.quaternion[1],
    camera.quaternion[2], camera.quaternion[3]
  );
  cam.up.set(camera.up[0], camera.up[1], camera.up[2]);

  if (camera.zoom !== undefined) cam.zoom = camera.zoom;
  if (camera.fov !== undefined) cam.fov = camera.fov;
  cam.updateProjectionMatrix?.();

  // Controls target
  if (viewer.controls?.target) {
    viewer.controls.target.set(
      camera.target[0], camera.target[1], camera.target[2]
    );
    viewer.controls.update?.();
  }
}

// ---------------------------------------------------------------------------
// Viewer config
// ---------------------------------------------------------------------------

function applyConfig(viewer: any, config: ViewerStateV1['config']): void {
  if (!config) return;

  if (config.background !== undefined && viewer.scene) {
    viewer.scene.background = new (await3Color())(config.background);
  }

  if (config.lighting) {
    if (config.lighting.ambientIntensity !== undefined && viewer.ambientLight) {
      viewer.ambientLight.intensity = config.lighting.ambientIntensity;
    }
    if (config.lighting.directionalIntensity !== undefined && viewer.directionalLight) {
      viewer.directionalLight.intensity = config.lighting.directionalIntensity;
    }
    if (config.lighting.directionalPosition && viewer.directionalLight) {
      const [x, y, z] = config.lighting.directionalPosition;
      viewer.directionalLight.position.set(x, y, z);
    }
  }
}

// Lazy THREE.Color to avoid importing THREE at module level
function await3Color(): any {
  // Access through the viewer's THREE or dynamic import
  // Since we duck-type the viewer, use inline constructor
  return class SimpleColor {
    r: number; g: number; b: number;
    isColor = true;
    constructor(hex: number) {
      this.r = ((hex >> 16) & 255) / 255;
      this.g = ((hex >> 8) & 255) / 255;
      this.b = (hex & 255) / 255;
    }
  };
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

function applySurfaces(
  viewer: any,
  surfaces: Record<string, ViewerStateV1['surfaces'][string]>,
  report: RestorationReport
): void {
  const viewerSurfaces: Map<string, any> | undefined = viewer.surfaces;
  if (!viewerSurfaces || !surfaces) return;

  for (const [id, surfaceState] of Object.entries(surfaces)) {
    const surface = viewerSurfaces.get(id);
    if (!surface) {
      report.surfacesSkipped.push(id);
      report.warnings.push(`surface "${id}" not found — skipped`);
      continue;
    }

    report.surfacesRestored.push(id);

    // Visibility
    if (surface.mesh && surfaceState.visible !== undefined) {
      surface.mesh.visible = surfaceState.visible;
    }

    // Layers
    if (surfaceState.layers && surface.layerStack) {
      applyLayers(surface, surfaceState.layers, report);
    }

    // Clip planes
    if (surfaceState.clipPlanes && surface.clipPlanes) {
      applyClipPlanes(surface, surfaceState.clipPlanes);
    }
  }
}

function applyLayers(
  surface: any,
  layerStates: LayerState[],
  report: RestorationReport
): void {
  const stack = surface.layerStack;
  if (!stack) return;

  for (const ls of layerStates) {
    const layer = stack.getLayer?.(ls.id);
    if (!layer) {
      report.warnings.push(`layer "${ls.id}" not found — skipped`);
      continue;
    }

    // Common properties
    if (ls.visible !== undefined) layer.setVisible?.(ls.visible);
    if (ls.opacity !== undefined) layer.setOpacity?.(ls.opacity);
    if (ls.blendMode !== undefined) layer.setBlendMode?.(ls.blendMode);
    if (ls.order !== undefined) layer.order = ls.order;

    // Type-specific restoration via fromStateJSON or update
    if (typeof layer.fromStateJSON === 'function') {
      layer.fromStateJSON(ls);
    } else if (typeof layer.update === 'function') {
      // Apply known DataLayer fields
      const update: any = {};
      if (ls.colorMapName !== undefined) update.colorMap = ls.colorMapName;
      if (ls.range !== undefined) update.range = ls.range;
      if (ls.threshold !== undefined) update.threshold = ls.threshold;
      layer.update(update);
    }

    layer.needsUpdate = true;
  }
}

function applyClipPlanes(surface: any, clipStates: ClipPlaneState[]): void {
  if (typeof surface.clipPlanes.fromStateJSON === 'function') {
    surface.clipPlanes.fromStateJSON(clipStates);
    return;
  }

  // Manual approach: iterate and apply
  for (const cs of clipStates) {
    if (cs.axis !== 'custom') {
      const plane = surface.clipPlanes.getClipPlane?.(cs.axis);
      if (plane) {
        plane.setFromAxisDistance(cs.axis, cs.distance, cs.flip);
        plane.enabled = cs.enabled;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Crosshair
// ---------------------------------------------------------------------------

function applyCrosshair(viewer: any, crosshair: ViewerStateV1['crosshair']): void {
  if (!viewer.crosshair || !crosshair) return;

  const ch = viewer.crosshair;

  if (typeof ch.fromStateJSON === 'function') {
    ch.fromStateJSON(crosshair);
    return;
  }

  ch.size = crosshair.size ?? ch.size;
  ch.color = crosshair.color ?? ch.color;

  if (!crosshair.visible) {
    if (typeof ch.hide === 'function') ch.hide();
  }
  // Note: showing crosshair requires a mesh + vertexIndex, done via surface interaction
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function applyTimeline(viewer: any, timeline: ViewerStateV1['timeline']): void {
  if (!timeline) return;

  const surfaces: Map<string, any> | undefined = viewer.surfaces;
  if (!surfaces) return;

  for (const [, surface] of surfaces) {
    const tc = surface.timelineController;
    if (!tc) continue;

    if (typeof tc.fromStateJSON === 'function') {
      tc.fromStateJSON(timeline);
      return;
    }

    if (typeof tc.seek === 'function' && timeline.currentTime !== undefined) {
      tc.seek(timeline.currentTime);
    }
    if (typeof tc.setSpeed === 'function' && timeline.speed !== undefined) {
      tc.setSpeed(timeline.speed);
    }
    if (timeline.playing && typeof tc.play === 'function') {
      tc.play();
    } else if (!timeline.playing && typeof tc.pause === 'function') {
      tc.pause();
    }
    return; // Apply to first found controller
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function applySelection(viewer: any, selection: ViewerStateV1['selection']): void {
  if (!selection) return;
  if (selection.surfaceId !== undefined) {
    viewer.selectedSurfaceId = selection.surfaceId;
  }
  if (selection.layerId !== undefined) {
    viewer.selectedLayerId = selection.layerId;
  }
}
