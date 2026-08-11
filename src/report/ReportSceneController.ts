import * as THREE from 'three';
import {
  ANATOMICAL_VIEWS,
  freezeBilateralSurfaceGroup,
  getAnatomicalViewAxes
} from '../AnatomicalView';
import type {
  AnatomicalView,
  AnatomicalViewChangedEvent,
  BilateralSurfaceGroup
} from '../AnatomicalView';
import type {
  AnatomicalViewTargetRef,
  ControlCommandResult
} from '../controls/ControlTarget';
import type { MultiLayerNeuroSurface } from '../MultiLayerNeuroSurface';
import type { NeuroSurfaceViewer } from '../NeuroSurfaceViewer';
import type { SurfViewSceneManifest } from '../scene';

export interface ReportAnatomicalMesh {
  readonly id: string;
  readonly hemisphere: 'left' | 'right';
  readonly mesh: THREE.Object3D;
}

export interface ReportSceneControllerOptions {
  readonly bilateralGroup?: BilateralSurfaceGroup;
  readonly initialView?: AnatomicalView;
  readonly hemisphereGap?: number;
}

export interface ReportSceneControllerState {
  readonly displayedLayerId: string | null;
  readonly currentView: {
    readonly view: AnatomicalView;
    readonly target: AnatomicalViewTargetRef;
  } | null;
}

export type ReportSceneMutationPhase = 'begin' | 'end';
export type ReportSceneMutationListener = (phase: ReportSceneMutationPhase) => void;
export type ReportSceneDisposingListener = () => void;

const SUCCESS: ControlCommandResult = Object.freeze({ ok: true });

function failure(
  code: 'surface-not-found' | 'layer-not-found' | 'group-not-found' |
    'unsupported' | 'invalid-value' | 'conflict' | 'disposed',
  message: string
): ControlCommandResult {
  return Object.freeze({ ok: false, code, message });
}

function viewQuaternion(
  hemisphere: 'left' | 'right',
  view: AnatomicalView
): THREE.Quaternion {
  const axes = getAnatomicalViewAxes(hemisphere, view);
  const sourceForward = new THREE.Vector3(...axes.direction).normalize();
  const sourceUp = new THREE.Vector3(...axes.up).normalize();
  const sourceRight = sourceUp.clone().cross(sourceForward).normalize();
  sourceUp.copy(sourceForward).cross(sourceRight).normalize();

  const sourceBasis = new THREE.Matrix4().makeBasis(
    sourceRight,
    sourceUp,
    sourceForward
  );
  return new THREE.Quaternion().setFromRotationMatrix(sourceBasis.invert());
}

/** Deterministic report-mesh mechanics over an explicitly coordinated target list. */
export function layoutReportAnatomicalMeshes(
  targets: readonly ReportAnatomicalMesh[],
  view: AnatomicalView,
  hemisphereGap: number,
  paired: boolean
): void {
  if (!Number.isFinite(hemisphereGap) || hemisphereGap < 0) {
    throw new RangeError('hemisphereGap must be a finite, non-negative number');
  }
  const dimensions = new Map<string, THREE.Vector3>();
  for (const target of targets) {
    target.mesh.position.set(0, 0, 0);
    target.mesh.quaternion.copy(viewQuaternion(target.hemisphere, view));
    target.mesh.updateMatrixWorld(true);
    dimensions.set(
      target.id,
      new THREE.Box3().setFromObject(target.mesh).getSize(new THREE.Vector3())
    );
  }

  for (const target of targets) {
    const center = new THREE.Box3().setFromObject(target.mesh).getCenter(new THREE.Vector3());
    target.mesh.position.sub(center);
    if (paired) {
      const ownWidth = dimensions.get(target.id)?.x ?? 0;
      target.mesh.position.x += target.hemisphere === 'left'
        ? -(ownWidth / 2 + hemisphereGap / 2)
        : ownWidth / 2 + hemisphereGap / 2;
    }
    target.mesh.updateMatrixWorld(true);
  }
}

/**
 * Owns the coordinated semantics that make a portable report scene different
 * from an ordinary viewer: one displayed map and one explicit report view
 * target. It never writes the pane-era selected layer or surface fields.
 */
export class ReportSceneController {
  readonly options: ReportSceneControllerOptions;
  private readonly initialView: AnatomicalView;
  private readonly hemisphereGap: number;
  private readonly viewerUnsubscribers: Array<() => void> = [];
  private readonly mutationListeners = new Set<ReportSceneMutationListener>();
  private readonly disposingListeners = new Set<ReportSceneDisposingListener>();
  private displayedLayerId: string | null;
  private currentView: ReportSceneControllerState['currentView'] = null;
  private changingLayers = false;
  private changingView = false;
  private mutationDepth = 0;
  private disposed = false;

  constructor(
    readonly viewer: NeuroSurfaceViewer,
    readonly manifest: SurfViewSceneManifest,
    options: ReportSceneControllerOptions = {}
  ) {
    this.options = Object.freeze({
      ...options,
      ...(options.bilateralGroup
        ? { bilateralGroup: freezeBilateralSurfaceGroup(options.bilateralGroup) }
        : {})
    });
    this.initialView = this.options.initialView ?? 'lateral';
    this.hemisphereGap = this.options.hemisphereGap ?? 8;
    if (!ANATOMICAL_VIEWS.includes(this.initialView)) {
      throw new RangeError(`Unsupported initial report view "${String(this.initialView)}".`);
    }
    if (!Number.isFinite(this.hemisphereGap) || this.hemisphereGap < 0) {
      throw new RangeError('hemisphereGap must be a finite, non-negative number');
    }
    this.displayedLayerId = this.deriveDisplayedLayerId();
    this.viewerUnsubscribers.push(
      viewer.on('state:changed', event => {
        if (!this.changingLayers &&
            (event.domains.includes('layers') || event.domains.includes('surfaces'))) {
          this.displayedLayerId = this.deriveDisplayedLayerId();
        }
        if (!this.changingView && event.domains.includes('camera')) {
          this.currentView = null;
        }
      }),
      viewer.on('anatomical-view:changed', event => this.observeView(event)),
      viewer.on('anatomical-view:reset', () => {
        if (!this.changingView) this.currentView = null;
      }),
      viewer.on('viewer:disposing', () => this.dispose())
    );
  }

  getState(): ReportSceneControllerState {
    return Object.freeze({
      displayedLayerId: this.displayedLayerId,
      currentView: this.currentView
    });
  }

  /** @internal Target adapters use this boundary to publish compound commands atomically. */
  subscribeMutationBoundary(listener: ReportSceneMutationListener): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('A report mutation subscription requires a listener function.');
    }
    if (this.disposed) return () => {};
    this.mutationListeners.add(listener);
    return () => this.mutationListeners.delete(listener);
  }

  /** @internal Eager lifecycle signal for target adapters owned by this controller. */
  subscribeDisposing(listener: ReportSceneDisposingListener): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('A report disposal subscription requires a listener function.');
    }
    if (this.disposed) {
      listener();
      return () => {};
    }
    this.disposingListeners.add(listener);
    return () => this.disposingListeners.delete(listener);
  }

  getAvailableLayerIds(): readonly string[] {
    return Object.freeze(Object.values(this.manifest.layers)
      .filter(layer => this.getReportSurfaces().some(({ id }) =>
        this.viewer.getOrderedLayers(id).some(candidate => candidate.id === layer.id)
      ))
      .map(layer => layer.id));
  }

  getViewTarget(): AnatomicalViewTargetRef | null {
    if (this.options.bilateralGroup) {
      const configured = this.options.bilateralGroup;
      const registered = this.viewer.getBilateralSurfaceGroup(configured.id);
      return registered &&
        registered.leftSurfaceId === configured.leftSurfaceId &&
        registered.rightSurfaceId === configured.rightSurfaceId &&
        this.viewer.getSurface(configured.leftSurfaceId) &&
        this.viewer.getSurface(configured.rightSurfaceId)
        ? Object.freeze({ kind: 'group', groupId: configured.id })
        : null;
    }
    const surfaceIds = Object.keys(this.manifest.geometries);
    return surfaceIds.length === 1 && this.viewer.getSurface(surfaceIds[0])
      ? Object.freeze({ kind: 'surface', surfaceId: surfaceIds[0] })
      : null;
  }

  setDisplayedLayer(layerId: string): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (typeof layerId !== 'string' || layerId.length === 0) {
      return failure('invalid-value', 'A displayed report layer requires a stable layer ID.');
    }
    if (!this.manifest.layers[layerId]) {
      return failure('layer-not-found', `Report layer "${layerId}" was not found.`);
    }
    const reportSurfaces = this.getReportSurfaces();
    if (reportSurfaces.length === 0) {
      return failure('surface-not-found', 'No report surfaces are loaded.');
    }
    const layerInstances = reportSurfaces.flatMap(({ id }) =>
      this.viewer.getOrderedLayers(id).filter(layer =>
        Object.prototype.hasOwnProperty.call(this.manifest.layers, layer.id)
      )
    );
    if (!layerInstances.some(layer => layer.id === layerId)) {
      return failure('layer-not-found', `Report layer "${layerId}" has no loaded surface data.`);
    }

    return this.withMutationBoundary(() => {
      this.displayedLayerId = layerId;
      this.changingLayers = true;
      try {
        for (const layer of layerInstances) layer.setVisible(layer.id === layerId);
      } finally {
        this.changingLayers = false;
      }
      return SUCCESS;
    });
  }

  setAnatomicalView(
    view: AnatomicalView,
    target: AnatomicalViewTargetRef,
    options: { readonly fit?: boolean; readonly hemisphereGap?: number } = {}
  ): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (!ANATOMICAL_VIEWS.includes(view)) {
      return failure('invalid-value', `Unsupported anatomical view "${String(view)}".`);
    }
    if (!target || (target.kind !== 'surface' && target.kind !== 'group') ||
        (target.kind === 'surface' && typeof target.surfaceId !== 'string') ||
        (target.kind === 'group' && typeof target.groupId !== 'string')) {
      return failure('invalid-value', 'A report view requires a valid surface or group target.');
    }
    const reportTarget = this.getViewTarget();
    if (!reportTarget) {
      return failure(
        'unsupported',
        'Multiple report surfaces require an explicit bilateral group.'
      );
    }
    if (!this.targetsEqual(target, reportTarget)) {
      return target.kind === 'group'
        ? failure('group-not-found', `Report group "${target.groupId}" is not controlled here.`)
        : failure('surface-not-found', `Report surface "${target.surfaceId}" is not controlled here.`);
    }
    const gap = options.hemisphereGap ?? this.hemisphereGap;
    if (!Number.isFinite(gap) || gap < 0) {
      return failure('invalid-value', 'hemisphereGap must be a finite, non-negative number.');
    }
    const targets = this.resolveViewSurfaces();
    if ('ok' in targets) return targets;
    const fit = options.fit ?? true;

    return this.withMutationBoundary(() => {
      this.changingView = true;
      try {
        layoutReportAnatomicalMeshes(
          targets.map(({ id, hemisphere, surface }) => ({
            id,
            hemisphere,
            mesh: surface.mesh!
          })),
          view,
          gap,
          reportTarget.kind === 'group'
        );
        if (fit) this.fitCamera(targets);
        this.currentView = Object.freeze({ view, target: reportTarget });
        this.viewer.emit('anatomical-view:changed', {
          view,
          layout: reportTarget.kind === 'group' ? 'paired' : 'single',
          surfaceIds: Object.freeze(targets.map(surface => surface.id)),
          fit
        });
        this.viewer.requestRender();
      } finally {
        this.changingView = false;
      }
      return SUCCESS;
    });
  }

  fitView(): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    const targets = this.resolveViewSurfaces();
    if ('ok' in targets) return targets;
    return this.withMutationBoundary(() => {
      this.changingView = true;
      try {
        this.fitCamera(targets);
        this.viewer.emit('camera:changed', {
          camera: this.viewer.camera,
          position: this.viewer.camera.position.clone(),
          target: this.viewer.cameraControls.target.clone()
        });
        this.viewer.requestRender();
      } finally {
        this.changingView = false;
      }
      return SUCCESS;
    });
  }

  resetView(): ControlCommandResult {
    const target = this.getViewTarget();
    return target
      ? this.setAnatomicalView(this.initialView, target, { fit: true })
      : failure('unsupported', 'No coordinated report view target is available.');
  }

  resizeFit(): void {
    if (this.commandUnavailable()) return;
    const targets = this.resolveViewSurfaces();
    if ('ok' in targets) return;
    this.fitCamera(targets);
  }

  isDisposed(): boolean {
    return this.disposed || this.viewer.isDisposed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.viewerUnsubscribers.splice(0)) unsubscribe();
    for (const listener of [...this.disposingListeners]) this.deliverDisposing(listener);
    this.disposingListeners.clear();
    this.mutationListeners.clear();
  }

  private commandUnavailable(): ControlCommandResult | null {
    if (this.isDisposed()) {
      return failure('disposed', 'The report scene controller has been disposed.');
    }
    if (this.viewer.initializationFailed) {
      return failure('unsupported', 'The report viewer did not initialize successfully.');
    }
    return null;
  }

  private withMutationBoundary<T>(operation: () => T): T {
    this.mutationDepth += 1;
    if (this.mutationDepth === 1) this.deliverMutationPhase('begin');
    try {
      return operation();
    } finally {
      this.mutationDepth -= 1;
      if (this.mutationDepth === 0) this.deliverMutationPhase('end');
    }
  }

  private deliverMutationPhase(phase: ReportSceneMutationPhase): void {
    for (const listener of [...this.mutationListeners]) {
      try {
        listener(phase);
      } catch {
        // Observer failures must not leave a coordinated scene half-mutated.
      }
    }
  }

  private deliverDisposing(listener: ReportSceneDisposingListener): void {
    try {
      listener();
    } catch {
      // Viewer disposal continues even if an external observer is faulty.
    }
  }

  private getReportSurfaces(): Array<{
    readonly id: string;
    readonly hemisphere: 'left' | 'right';
    readonly surface: MultiLayerNeuroSurface;
  }> {
    return Object.values(this.manifest.geometries).flatMap(geometry => {
      const surface = this.viewer.getSurface(geometry.id);
      return surface
        ? [{ id: geometry.id, hemisphere: geometry.hemisphere, surface: surface as MultiLayerNeuroSurface }]
        : [];
    });
  }

  private resolveViewSurfaces(): ReturnType<ReportSceneController['getReportSurfaces']> |
    ControlCommandResult {
    const reportSurfaces = this.getReportSurfaces();
    const target = this.getViewTarget();
    if (!target) {
      return failure('unsupported', 'No coordinated report view target is available.');
    }
    const ids = target.kind === 'group'
      ? [
          this.options.bilateralGroup!.leftSurfaceId,
          this.options.bilateralGroup!.rightSurfaceId
        ]
      : [target.surfaceId];
    const resolved = ids.flatMap(id => reportSurfaces.filter(surface => surface.id === id));
    if (resolved.length !== ids.length || resolved.some(({ surface }) => !surface.mesh)) {
      return failure('surface-not-found', 'A coordinated report surface is unavailable.');
    }
    return resolved;
  }

  private deriveDisplayedLayerId(): string | null {
    const visible = new Set<string>();
    const surfaceLayers = this.getReportSurfaces().map(({ id }) =>
      this.viewer.getOrderedLayers(id).filter(layer =>
        Object.prototype.hasOwnProperty.call(this.manifest.layers, layer.id)
      )
    );
    for (const layers of surfaceLayers) {
      for (const layer of layers) {
        if (layer.visible) visible.add(layer.id);
      }
    }
    if (visible.size !== 1) return null;
    const candidate = [...visible][0];
    return surfaceLayers.every(layers => {
      const candidateLayer = layers.find(layer => layer.id === candidate);
      return (!candidateLayer || candidateLayer.visible) &&
        layers.every(layer => layer.id === candidate || !layer.visible);
    }) ? candidate : null;
  }

  private observeView(event: AnatomicalViewChangedEvent): void {
    if (this.changingView) return;
    const target = this.getViewTarget();
    if (!target) {
      this.currentView = null;
      return;
    }
    const expectedIds = target.kind === 'group'
      ? [
          this.options.bilateralGroup!.leftSurfaceId,
          this.options.bilateralGroup!.rightSurfaceId
        ]
      : [target.surfaceId];
    this.currentView = expectedIds.length === event.surfaceIds.length &&
      expectedIds.every(id => event.surfaceIds.includes(id))
      ? Object.freeze({ view: event.view, target })
      : null;
  }

  private targetsEqual(
    left: AnatomicalViewTargetRef,
    right: AnatomicalViewTargetRef
  ): boolean {
    return left.kind === right.kind && (left.kind === 'surface'
      ? left.surfaceId === (right as { readonly surfaceId: string }).surfaceId
      : left.groupId === (right as { readonly groupId: string }).groupId);
  }

  private fitCamera(targets: ReturnType<ReportSceneController['getReportSurfaces']>): void {
    const bounds = new THREE.Box3();
    for (const { surface } of targets) {
      if (surface.mesh) bounds.expandByObject(surface.mesh);
    }
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(this.viewer.camera.fov);
    const horizontalFov = 2 * Math.atan(
      Math.tan(verticalFov / 2) * this.viewer.camera.aspect
    );
    const distance = Math.max(
      size.y / (2 * Math.tan(verticalFov / 2)),
      size.x / (2 * Math.tan(horizontalFov / 2))
    ) + size.z / 2;
    const paddedDistance = Math.max(distance * 1.12, 1);
    this.viewer.camera.position.copy(center).add(new THREE.Vector3(0, 0, paddedDistance));
    this.viewer.camera.up.set(0, 1, 0);
    this.viewer.camera.lookAt(center);
    this.viewer.camera.near = Math.max(paddedDistance / 1000, 0.001);
    this.viewer.camera.far = Math.max(paddedDistance * 10, 100);
    this.viewer.camera.updateProjectionMatrix();
    this.viewer.cameraControls.target.copy(center);
    this.viewer.cameraControls.update();
  }
}
