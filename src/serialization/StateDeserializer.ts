import { normalizeAnatomicalHemisphere } from '../AnatomicalView';
import type { InspectionSelection } from '../Inspection';
import {
  CURRENT_VERSION,
  migrateViewerState
} from './ViewerState';
import type {
  ViewerState,
  ViewerStateV2,
  RestorationIssue,
  RestorationIssueCode,
  RestorationReport,
  LayerState,
  ClipPlaneState,
  SurfaceGroupState
} from './ViewerState';

/**
 * Validate and apply a serialized viewer state.
 *
 * v1 input is migrated before validation. All schema and target-reference
 * errors are collected before any canonical viewer state is mutated. Runtime
 * adapter failures after successful validation remain warnings in the report.
 */
export function deserialize(
  viewer: any,
  input: ViewerState
): RestorationReport {
  const sourceVersion = getSourceVersion(input);
  const report: RestorationReport = {
    success: false,
    sourceVersion,
    restoredVersion: CURRENT_VERSION,
    errors: [],
    warnings: [],
    surfacesRestored: [],
    surfacesSkipped: []
  };

  let state: ViewerStateV2;
  try {
    state = migrateViewerState(input);
  } catch (error) {
    addIssue(
      report.errors,
      sourceVersion === null ? 'unsupported-version' : 'invalid-state',
      sourceVersion === null ? 'version' : '$',
      (error as Error).message
    );
    return finish(viewer, report, false);
  }

  report.errors.push(...validateRestoration(viewer, state));
  report.surfacesSkipped.push(...report.errors
    .filter(issue => issue.code === 'surface-not-found')
    .map(issue => issue.path.match(/^surfaces\.([^.]*)/)?.[1])
    .filter((id): id is string => Boolean(id)));

  if (report.errors.length > 0) {
    return finish(viewer, report, false);
  }

  applySection(report, 'config', () => applyConfig(viewer, state.config));
  applySection(report, 'camera', () => applyCamera(viewer, state.camera));
  applySection(report, 'surfaces', () => applySurfaces(viewer, state, report));
  applySection(report, 'surfaceGroups', () => applySurfaceGroups(viewer, state.surfaceGroups));
  applySection(report, 'crosshair', () => applyCrosshair(viewer, state.crosshair));
  if (state.timeline) {
    applySection(report, 'timeline', () => applyTimeline(viewer, state.timeline));
  }
  applySection(
    report,
    'inspectionSelection',
    () => applyInspectionSelection(viewer, state.inspectionSelection)
  );

  return finish(viewer, report, true);
}

function getSourceVersion(input: unknown): 1 | 2 | null {
  if (!input || typeof input !== 'object') return null;
  const version = (input as { version?: unknown }).version;
  return version === 1 || version === 2 ? version : null;
}

function addIssue(
  issues: RestorationIssue[],
  code: RestorationIssueCode,
  path: string,
  message: string
): void {
  issues.push({ code, path, message });
}

function applySection(
  report: RestorationReport,
  section: string,
  operation: () => void
): void {
  try {
    operation();
  } catch (error) {
    report.warnings.push(`${section}: ${(error as Error).message}`);
  }
}

function finish(
  viewer: any,
  report: RestorationReport,
  requestRender: boolean
): RestorationReport {
  report.success = report.errors.length === 0 && report.warnings.length === 0;
  if (typeof viewer?.emit === 'function') viewer.emit('state:restored', report);
  if (requestRender && typeof viewer?.requestRender === 'function') viewer.requestRender();
  return report;
}

// ---------------------------------------------------------------------------
// Validation — no viewer mutation is permitted below this line
// ---------------------------------------------------------------------------

function validateRestoration(viewer: any, state: ViewerStateV2): RestorationIssue[] {
  const issues: RestorationIssue[] = [];
  if (!state.surfaces || typeof state.surfaces !== 'object' || Array.isArray(state.surfaces)) {
    addIssue(issues, 'invalid-state', 'surfaces', 'ViewerState v2 surfaces must be an object.');
    return issues;
  }
  if (!Array.isArray(state.surfaceGroups)) {
    addIssue(issues, 'invalid-state', 'surfaceGroups', 'ViewerState v2 surfaceGroups must be an array.');
  }
  if (!state.inspectionSelection || typeof state.inspectionSelection !== 'object') {
    addIssue(
      issues,
      'invalid-state',
      'inspectionSelection',
      'ViewerState v2 inspectionSelection must be an object.'
    );
  }

  validateSurfaces(viewer, state, issues);
  if (Array.isArray(state.surfaceGroups)) validateSurfaceGroups(viewer, state, issues);
  if (state.inspectionSelection && typeof state.inspectionSelection === 'object') {
    validateInspectionSelection(viewer, state, issues);
  }
  return issues;
}

function validateSurfaces(
  viewer: any,
  state: ViewerStateV2,
  issues: RestorationIssue[]
): void {
  const viewerSurfaces: Map<string, any> | undefined = viewer?.surfaces;
  if (!(viewerSurfaces instanceof Map)) {
    addIssue(issues, 'invalid-state', 'surfaces', 'The target does not expose a surface map.');
    return;
  }

  for (const [surfaceId, surfaceState] of Object.entries(state.surfaces)) {
    const path = `surfaces.${surfaceId}`;
    if (!surfaceState || typeof surfaceState !== 'object') {
      addIssue(issues, 'invalid-state', path, 'Each serialized surface must be an object.');
      continue;
    }
    if (!surfaceId || surfaceState?.id !== surfaceId) {
      addIssue(
        issues,
        'surface-id-mismatch',
        `${path}.id`,
        `Serialized surface id ${JSON.stringify(surfaceState?.id)} does not match key "${surfaceId}".`
      );
    }

    const surface = viewerSurfaces.get(surfaceId);
    if (!surface) {
      addIssue(issues, 'surface-not-found', path, `Surface "${surfaceId}" was not found.`);
      continue;
    }

    if (!Array.isArray(surfaceState.layers)) {
      addIssue(issues, 'invalid-state', `${path}.layers`, 'Surface layers must be an array.');
      continue;
    }
    if (!Array.isArray(surfaceState.layerOrder)) {
      addIssue(
        issues,
        'invalid-layer-order',
        `${path}.layerOrder`,
        'ViewerState v2 requires an explicit layerOrder array.'
      );
      continue;
    }

    const layerIds = surfaceState.layers.map(layer => layer?.id);
    const duplicateLayerId = firstDuplicate(layerIds);
    if (duplicateLayerId !== null) {
      addIssue(
        issues,
        'duplicate-layer-id',
        `${path}.layers`,
        `Layer id "${duplicateLayerId}" occurs more than once.`
      );
    }
    layerIds.forEach((layerId, index) => {
      if (typeof layerId !== 'string' || layerId.length === 0) {
        addIssue(
          issues,
          'invalid-layer-order',
          `${path}.layers.${index}.id`,
          'Layer IDs must be non-empty strings.'
        );
      }
    });

    const orderIds = surfaceState.layerOrder;
    const duplicateOrderId = firstDuplicate(orderIds);
    if (duplicateOrderId !== null) {
      addIssue(
        issues,
        'duplicate-layer-id',
        `${path}.layerOrder`,
        `Layer order contains duplicate id "${duplicateOrderId}".`
      );
    }
    orderIds.forEach((layerId, index) => {
      if (typeof layerId !== 'string' || layerId.length === 0) {
        addIssue(
          issues,
          'invalid-layer-order',
          `${path}.layerOrder.${index}`,
          'Layer order IDs must be non-empty strings.'
        );
      }
    });

    const validLayerIds = layerIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (!sameIdSet(validLayerIds, orderIds)) {
      addIssue(
        issues,
        'invalid-layer-order',
        `${path}.layerOrder`,
        'Layer order must contain every serialized layer ID exactly once and no other IDs.'
      );
    }

    const stack = surface.layerStack;
    if (!stack) {
      if (validLayerIds.length > 0) {
        addIssue(
          issues,
          'unsupported-layer-order',
          `${path}.layerOrder`,
          `Surface "${surfaceId}" does not expose a layer stack.`
        );
      }
      continue;
    }

    for (const layerId of validLayerIds) {
      if (!stack.getLayer?.(layerId)) {
        addIssue(
          issues,
          'layer-not-found',
          `${path}.layers.${layerId}`,
          `Layer "${layerId}" was not found on surface "${surfaceId}".`
        );
      }
    }

    const liveLayerIds = (stack.getOrderedLayers?.() ?? stack.getAllLayers?.() ?? [])
      .map((layer: any) => layer.id);
    if (!sameIdSet(liveLayerIds, orderIds)) {
      addIssue(
        issues,
        'invalid-layer-order',
        `${path}.layerOrder`,
        'Layer order must contain every live layer ID exactly once and no other IDs.'
      );
    }

    const validateOrder = surface.validateLayerOrder?.bind(surface)
      ?? stack.validateLayerOrder?.bind(stack);
    if (typeof validateOrder === 'function' && sameIdSet(liveLayerIds, orderIds)) {
      let result: any;
      try {
        result = validateOrder(orderIds);
      } catch (error) {
        result = { ok: false, message: (error as Error).message };
      }
      if (!result?.ok) {
        addIssue(
          issues,
          'invalid-layer-order',
          `${path}.layerOrder`,
          result?.message ?? 'The target rejected the serialized layer order.'
        );
      }
    } else if (orderIds.length > 0 &&
        typeof surface.setLayerOrder !== 'function' &&
        typeof stack.setLayerOrder !== 'function') {
      addIssue(
        issues,
        'unsupported-layer-order',
        `${path}.layerOrder`,
        `Surface "${surfaceId}" cannot restore canonical layer order.`
      );
    }
  }
}

function validateSurfaceGroups(
  viewer: any,
  state: ViewerStateV2,
  issues: RestorationIssue[]
): void {
  const groups = state.surfaceGroups;
  const existingGroups = viewer.getBilateralSurfaceGroups?.() ?? [];
  if ((groups.length > 0 || existingGroups.length > 0) &&
      (typeof viewer.registerBilateralSurfaceGroup !== 'function' ||
       typeof viewer.unregisterBilateralSurfaceGroup !== 'function')) {
    addIssue(
      issues,
      'unsupported-surface-groups',
      'surfaceGroups',
      'The target cannot replace explicit bilateral surface groups.'
    );
    return;
  }

  const groupIds = new Set<string>();
  const memberships = new Set<string>();
  groups.forEach((group, index) => {
    const path = `surfaceGroups.${index}`;
    if (!group || group.kind !== 'bilateral') {
      addIssue(issues, 'invalid-surface-group', `${path}.kind`, 'Only bilateral groups are supported.');
      return;
    }
    if (typeof group.id !== 'string' || group.id.trim().length === 0 || groupIds.has(group.id)) {
      addIssue(
        issues,
        'invalid-surface-group',
        `${path}.id`,
        'Surface group IDs must be non-empty and unique.'
      );
    } else {
      groupIds.add(group.id);
    }

    const members = [group.leftSurfaceId, group.rightSurfaceId];
    if (members.some(id => typeof id !== 'string' || id.length === 0) || members[0] === members[1]) {
      addIssue(
        issues,
        'invalid-surface-group',
        path,
        'A bilateral group requires distinct, non-empty left and right surface IDs.'
      );
      return;
    }
    for (const surfaceId of members) {
      if (memberships.has(surfaceId)) {
        addIssue(
          issues,
          'invalid-surface-group',
          path,
          `Surface "${surfaceId}" belongs to more than one group.`
        );
      }
      memberships.add(surfaceId);
      if (!state.surfaces[surfaceId] || !viewer.surfaces?.has(surfaceId)) {
        addIssue(
          issues,
          'invalid-surface-group',
          path,
          `Surface group references unknown surface "${surfaceId}".`
        );
      }
    }

    const left = viewer.surfaces?.get(group.leftSurfaceId);
    const right = viewer.surfaces?.get(group.rightSurfaceId);
    if (left && normalizeAnatomicalHemisphere(String(left.hemisphere ?? '')) !== 'left') {
      addIssue(
        issues,
        'invalid-surface-group',
        `${path}.leftSurfaceId`,
        `Surface "${group.leftSurfaceId}" is not marked as the left hemisphere.`
      );
    }
    if (right && normalizeAnatomicalHemisphere(String(right.hemisphere ?? '')) !== 'right') {
      addIssue(
        issues,
        'invalid-surface-group',
        `${path}.rightSurfaceId`,
        `Surface "${group.rightSurfaceId}" is not marked as the right hemisphere.`
      );
    }
  });
}

function validateInspectionSelection(
  viewer: any,
  state: ViewerStateV2,
  issues: RestorationIssue[]
): void {
  const selection = state.inspectionSelection;
  if (selection.kind === 'none') {
    const existing = viewer.getInspectionSelection?.();
    if (existing?.kind !== undefined && existing.kind !== 'none' &&
        typeof viewer.setInspectionSelection !== 'function') {
      addIssue(
        issues,
        'unsupported-selection',
        'inspectionSelection',
        'The target cannot clear its scientific inspection selection.'
      );
    }
    return;
  }

  if (selection.kind !== 'vertex' && selection.kind !== 'parcel') {
    addIssue(
      issues,
      'invalid-selection',
      'inspectionSelection.kind',
      `Unsupported inspection selection kind ${JSON.stringify((selection as any).kind)}.`
    );
    return;
  }
  if (typeof viewer.setInspectionSelection !== 'function') {
    addIssue(
      issues,
      'unsupported-selection',
      'inspectionSelection',
      'The target cannot restore scientific inspection selection.'
    );
    return;
  }
  if (typeof selection.surfaceId !== 'string' || !state.surfaces[selection.surfaceId]) {
    addIssue(
      issues,
      'invalid-selection',
      'inspectionSelection.surfaceId',
      `Inspection selection references unknown surface "${String(selection.surfaceId)}".`
    );
    return;
  }

  const surface = viewer.surfaces?.get(selection.surfaceId);
  if (!surface) {
    addIssue(
      issues,
      'invalid-selection',
      'inspectionSelection.surfaceId',
      `Inspection selection references missing target surface "${selection.surfaceId}".`
    );
    return;
  }

  if (selection.kind === 'vertex') {
    if (!Number.isInteger(selection.vertexIndex) || selection.vertexIndex < 0 ||
        !canInspectVertex(viewer, selection.surfaceId, selection.vertexIndex)) {
      addIssue(
        issues,
        'invalid-selection',
        'inspectionSelection.vertexIndex',
        `Vertex ${selection.vertexIndex} is invalid for surface "${selection.surfaceId}".`
      );
    }
    return;
  }

  if (!Number.isInteger(selection.parcelId) || !hasParcel(surface, selection.parcelId)) {
    addIssue(
      issues,
      'invalid-selection',
      'inspectionSelection.parcelId',
      `Parcel ${selection.parcelId} is invalid for surface "${selection.surfaceId}".`
    );
  }
  if (selection.representativeVertexIndex !== undefined &&
      (!Number.isInteger(selection.representativeVertexIndex) ||
       selection.representativeVertexIndex < 0 ||
       !canInspectVertex(viewer, selection.surfaceId, selection.representativeVertexIndex))) {
    addIssue(
      issues,
      'invalid-selection',
      'inspectionSelection.representativeVertexIndex',
      `Representative vertex ${selection.representativeVertexIndex} is invalid.`
    );
  }
  if (selection.atlasId !== undefined && typeof surface.getParcelData === 'function') {
    const atlasId = getAtlasId(surface);
    if (atlasId !== undefined && atlasId !== selection.atlasId) {
      addIssue(
        issues,
        'invalid-selection',
        'inspectionSelection.atlasId',
        `Atlas "${selection.atlasId}" does not match surface atlas "${atlasId}".`
      );
    }
  }
}

function canInspectVertex(viewer: any, surfaceId: string, vertexIndex: number): boolean {
  if (typeof viewer.inspectVertex !== 'function') return false;
  try {
    return viewer.inspectVertex(surfaceId, vertexIndex) !== null;
  } catch {
    return false;
  }
}

function hasParcel(surface: any, parcelId: number): boolean {
  if (typeof surface.getParcelRecord !== 'function') return false;
  try {
    return Boolean(surface.getParcelRecord(parcelId));
  } catch {
    return false;
  }
}

function getAtlasId(surface: any): string | undefined {
  try {
    return surface.getParcelData()?.atlas?.id;
  } catch {
    return undefined;
  }
}

function firstDuplicate(ids: readonly unknown[]): string | null {
  const seen = new Set<unknown>();
  for (const id of ids) {
    if (seen.has(id)) return String(id);
    seen.add(id);
  }
  return null;
}

function sameIdSet(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return rightSet.size === right.length && left.every(id => rightSet.has(id));
}

// ---------------------------------------------------------------------------
// Application — called only after validation succeeds
// ---------------------------------------------------------------------------

function applyCamera(viewer: any, camera: ViewerStateV2['camera']): void {
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

  const cameraControls = viewer.cameraControls;
  if (cameraControls?.target) {
    cameraControls.target.set(camera.target[0], camera.target[1], camera.target[2]);
    cameraControls.update?.();
  }
}

function applyConfig(viewer: any, config: ViewerStateV2['config']): void {
  if (!config) return;
  if (config.background !== undefined && viewer.scene) {
    viewer.scene.background = new (simpleColor())(config.background);
  }
  if (config.lighting) {
    if (config.lighting.ambientIntensity !== undefined && viewer.ambientLight) {
      viewer.ambientLight.intensity = config.lighting.ambientIntensity;
    }
    if (config.lighting.directionalIntensity !== undefined && viewer.directionalLight) {
      viewer.directionalLight.intensity = config.lighting.directionalIntensity;
    }
    if (config.lighting.directionalPosition && viewer.directionalLight) {
      viewer.directionalLight.position.set(...config.lighting.directionalPosition);
    }
  }
}

function simpleColor(): any {
  return class SimpleColor {
    r: number;
    g: number;
    b: number;
    isColor = true;

    constructor(hex: number) {
      this.r = ((hex >> 16) & 255) / 255;
      this.g = ((hex >> 8) & 255) / 255;
      this.b = (hex & 255) / 255;
    }
  };
}

function applySurfaces(
  viewer: any,
  state: ViewerStateV2,
  report: RestorationReport
): void {
  for (const [surfaceId, surfaceState] of Object.entries(state.surfaces)) {
    const surface = viewer.surfaces.get(surfaceId);
    if (surface.mesh && surfaceState.visible !== undefined) {
      surface.mesh.visible = surfaceState.visible;
    }
    applyLayers(surface, surfaceState.layers, surfaceState.layerOrder);
    if (surfaceState.clipPlanes && surface.clipPlanes) {
      applyClipPlanes(surface, surfaceState.clipPlanes);
    }
    report.surfacesRestored.push(surfaceId);
  }
}

function applyLayers(
  surface: any,
  layerStates: LayerState[],
  layerOrder: string[]
): void {
  const stack = surface.layerStack;
  if (!stack) return;

  for (const state of layerStates) {
    const layer = stack.getLayer(state.id);
    if (state.visible !== undefined) layer.setVisible?.(state.visible);
    if (state.opacity !== undefined) layer.setOpacity?.(state.opacity);
    if (state.blendMode !== undefined) layer.setBlendMode?.(state.blendMode);

    if (typeof layer.fromStateJSON === 'function') {
      layer.fromStateJSON(state);
    } else if (typeof layer.update === 'function') {
      const update: any = {};
      if (state.colorMapName !== undefined) update.colorMap = state.colorMapName;
      if (state.range !== undefined) update.range = state.range;
      if (state.threshold !== undefined) update.threshold = state.threshold;
      layer.update(update);
    }
    layer.needsUpdate = true;
  }

  const result = surface.setLayerOrder?.(layerOrder) ?? stack.setLayerOrder?.(layerOrder);
  if (!result?.ok) {
    throw new Error(result?.message ?? 'The target failed to restore canonical layer order.');
  }
}

function applyClipPlanes(surface: any, clipStates: ClipPlaneState[]): void {
  if (typeof surface.clipPlanes.fromStateJSON === 'function') {
    surface.clipPlanes.fromStateJSON(clipStates);
    return;
  }
  for (const state of clipStates) {
    if (state.axis === 'custom') continue;
    const plane = surface.clipPlanes.getClipPlane?.(state.axis);
    if (plane) {
      plane.setFromAxisDistance(state.axis, state.distance, state.flip);
      plane.enabled = state.enabled;
    }
  }
}

function applySurfaceGroups(viewer: any, groups: SurfaceGroupState[]): void {
  const existingGroups = viewer.getBilateralSurfaceGroups?.() ?? [];
  for (const group of existingGroups) {
    const result = viewer.unregisterBilateralSurfaceGroup(group.id);
    if (!result?.ok) throw new Error(result?.message ?? `Could not remove surface group "${group.id}".`);
  }
  for (const group of groups) {
    const result = viewer.registerBilateralSurfaceGroup({
      id: group.id,
      leftSurfaceId: group.leftSurfaceId,
      rightSurfaceId: group.rightSurfaceId
    });
    if (!result?.ok) throw new Error(result?.message ?? `Could not restore surface group "${group.id}".`);
  }
}

function applyCrosshair(viewer: any, crosshair: ViewerStateV2['crosshair']): void {
  if (!viewer.crosshair || !crosshair) return;
  const target = viewer.crosshair;
  if (typeof target.fromStateJSON === 'function') {
    target.fromStateJSON(crosshair);
    return;
  }
  target.size = crosshair.size ?? target.size;
  target.color = crosshair.color ?? target.color;
  target.surfaceId = crosshair.surfaceId ?? null;
  target.vertexIndex = crosshair.vertexIndex ?? null;
  target.mode = crosshair.mode ?? null;
  if (!crosshair.visible) target.hide?.();
}

function applyTimeline(viewer: any, timeline: ViewerStateV2['timeline']): void {
  if (!timeline) return;
  for (const surface of viewer.surfaces?.values?.() ?? []) {
    const controller = surface.timelineController;
    if (!controller) continue;
    if (typeof controller.fromStateJSON === 'function') {
      controller.fromStateJSON(timeline);
      return;
    }
    controller.seek?.(timeline.currentTime);
    controller.setSpeed?.(timeline.speed);
    if (timeline.playing) controller.play?.();
    else controller.pause?.();
    return;
  }
}

function applyInspectionSelection(viewer: any, selection: InspectionSelection): void {
  if (typeof viewer.setInspectionSelection !== 'function') return;
  const result = viewer.setInspectionSelection(selection, { showCrosshair: false });
  if (!result?.ok) {
    throw new Error(result?.message ?? 'The target failed to restore inspection selection.');
  }
}
