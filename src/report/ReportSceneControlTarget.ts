import { ANATOMICAL_VIEWS } from '../AnatomicalView';
import type { InspectionSelection } from '../Inspection';
import type { BlendMode } from '../layers';
import {
  createViewerControlTarget
} from '../controls/ViewerControlTarget';
import type { ViewerControlTargetOptions } from '../controls/ViewerControlTarget';
import type {
  AnatomicalViewTargetRef,
  CapabilityAvailability,
  ControlCommandFailure,
  ControlCommandResult,
  ControlJsonObject,
  ControlJsonValue,
  ControlQueryResult,
  FigureExportRequest,
  FigureExportResult,
  LayerControlAddress,
  LayerControlDescriptor,
  LayerDataSummaryControlDescriptor,
  ScalarMappingUpdate,
  SelectionControlDescriptor,
  SetAnatomicalViewRequest,
  SurfaceControlDescriptor,
  SurfViewControlSnapshot,
  SurfViewControlSnapshotListener,
  SurfViewControlSubscription,
  SurfViewControlTarget,
  ViewControlDescriptor
} from '../controls/ControlTarget';
import type { SurfViewSceneLayerManifest } from '../scene';
import { ReportSceneController } from './ReportSceneController';

export type ReportSceneControlTargetOptions = ViewerControlTargetOptions;

const ENABLED: CapabilityAvailability = Object.freeze({ enabled: true });

function disabled(reason: string): CapabilityAvailability {
  return Object.freeze({ enabled: false, reason });
}

function failure(
  code: ControlCommandFailure['code'],
  message: string
): ControlCommandFailure {
  return Object.freeze({ ok: false, code, message });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function cloneControlJson(value: unknown): ControlJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => cloneControlJson(item) ?? null));
  }
  if (!value || typeof value !== 'object') return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const copy: Record<string, ControlJsonValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const cloned = cloneControlJson(item);
    if (cloned !== undefined) copy[key] = cloned;
  }
  return Object.freeze(copy);
}

function asControlObject(value: unknown): ControlJsonObject | undefined {
  const cloned = cloneControlJson(value);
  return cloned && !Array.isArray(cloned) && typeof cloned === 'object'
    ? cloned as ControlJsonObject
    : undefined;
}

function labelFromId(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

class ReportTargetSubscription implements SurfViewControlSubscription {
  private active = true;

  constructor(
    readonly listener: SurfViewControlSnapshotListener,
    private readonly onClose: (subscription: ReportTargetSubscription) => void
  ) {}

  get closed(): boolean {
    return !this.active;
  }

  unsubscribe(): void {
    if (!this.active) return;
    this.active = false;
    this.onClose(this);
  }

  closeFromTarget(): void {
    this.active = false;
  }

  deliver(snapshot: SurfViewControlSnapshot): void {
    if (this.active) this.listener(snapshot);
  }
}

/**
 * Control adapter for one coordinated report scene. It composes the ordinary
 * viewer port for shared commands, while owning report view, exclusive-map,
 * and manifest-presentation semantics explicitly.
 */
export class ReportSceneControlTarget implements SurfViewControlTarget {
  private readonly viewerTarget;
  private readonly subscriptions = new Set<ReportTargetSubscription>();
  private readonly baseSubscription: SurfViewControlSubscription;
  private readonly controllerMutationUnsubscribe: () => void;
  private readonly controllerDisposingUnsubscribe: () => void;
  private baseSnapshot: SurfViewControlSnapshot;
  private snapshot: SurfViewControlSnapshot;
  private coordinatedCommandDepth = 0;
  private pendingBaseSnapshot: SurfViewControlSnapshot | null = null;
  private disposed = false;

  constructor(
    private readonly controller: ReportSceneController,
    options: ReportSceneControlTargetOptions = {}
  ) {
    if (controller.isDisposed()) {
      throw new Error('Cannot create a report-scene target for a disposed controller.');
    }
    this.viewerTarget = createViewerControlTarget(controller.viewer, options);
    this.baseSnapshot = this.viewerTarget.getSnapshot();
    this.snapshot = this.buildSnapshot(this.baseSnapshot, this.baseSnapshot.revision);
    let initialDelivery = true;
    this.baseSubscription = this.viewerTarget.subscribe(base => {
      if (initialDelivery) {
        initialDelivery = false;
        return;
      }
      this.baseSnapshot = base;
      if (this.coordinatedCommandDepth > 0) {
        this.pendingBaseSnapshot = base;
        return;
      }
      this.publishBaseSnapshot(base);
    });
    this.controllerMutationUnsubscribe = controller.subscribeMutationBoundary(phase => {
      if (phase === 'begin') {
        this.coordinatedCommandDepth += 1;
        return;
      }
      this.coordinatedCommandDepth = Math.max(0, this.coordinatedCommandDepth - 1);
      if (this.coordinatedCommandDepth === 0 && this.pendingBaseSnapshot) {
        const pending = this.pendingBaseSnapshot;
        this.pendingBaseSnapshot = null;
        this.publishBaseSnapshot(pending);
      }
    });
    this.controllerDisposingUnsubscribe = controller.subscribeDisposing(() => {
      this.dispose();
    });
  }

  getSnapshot(): SurfViewControlSnapshot {
    return this.snapshot;
  }

  getLayerDataSummary(
    address: LayerControlAddress
  ): ControlQueryResult<LayerDataSummaryControlDescriptor> {
    const unavailable = this.commandUnavailable();
    return unavailable ?? this.viewerTarget.getLayerDataSummary(address);
  }

  subscribe(listener: SurfViewControlSnapshotListener): SurfViewControlSubscription {
    if (typeof listener !== 'function') {
      throw new TypeError('A control-target subscription requires a listener function.');
    }
    listener(this.snapshot);
    const subscription = new ReportTargetSubscription(listener, current => {
      this.subscriptions.delete(current);
    });
    if (this.isDisposed()) {
      subscription.closeFromTarget();
      return subscription;
    }
    this.subscriptions.add(subscription);
    return subscription;
  }

  isDisposed(): boolean {
    if (!this.disposed && (this.controller.isDisposed() || this.viewerTarget.isDisposed())) {
      this.dispose();
    }
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controllerMutationUnsubscribe();
    this.controllerDisposingUnsubscribe();
    this.baseSubscription.unsubscribe();
    this.viewerTarget.dispose();
    for (const subscription of this.subscriptions) subscription.closeFromTarget();
    this.subscriptions.clear();
  }

  setAnatomicalView(request: SetAnatomicalViewRequest): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (!request || !ANATOMICAL_VIEWS.includes(request.view) || !request.target) {
      return failure('invalid-value', 'A report view requires a supported view and target.');
    }
    if (request.fit !== undefined && typeof request.fit !== 'boolean') {
      return failure('invalid-value', 'Anatomical-view fit must be a boolean when provided.');
    }
    return this.controller.setAnatomicalView(
      request.view,
      request.target,
      {
      ...(request.fit !== undefined ? { fit: request.fit } : {}),
      ...(request.hemisphereGap !== undefined
        ? { hemisphereGap: request.hemisphereGap }
        : {})
      }
    );
  }

  fitView(): ControlCommandResult {
    return this.commandUnavailable() ?? this.controller.fitView();
  }

  resetView(): ControlCommandResult {
    return this.commandUnavailable() ?? this.controller.resetView();
  }

  setSurfaceVisibility(surfaceId: string, visible: boolean): ControlCommandResult {
    return this.commandUnavailable() ??
      this.viewerTarget.setSurfaceVisibility(surfaceId, visible);
  }

  setLayerVisibility(
    _address: LayerControlAddress,
    _visible: boolean
  ): ControlCommandResult {
    return this.commandUnavailable() ?? failure(
      'unsupported',
      'Report scenes use setDisplayedLayer() to preserve their exclusive-map policy.'
    );
  }

  setLayerOpacity(address: LayerControlAddress, opacity: number): ControlCommandResult {
    return this.commandUnavailable() ?? this.viewerTarget.setLayerOpacity(address, opacity);
  }

  setLayerBlendMode(
    address: LayerControlAddress,
    blendMode: BlendMode
  ): ControlCommandResult {
    return this.commandUnavailable() ??
      this.viewerTarget.setLayerBlendMode(address, blendMode);
  }

  setLayerOrder(
    _surfaceId: string,
    _layerIds: readonly string[]
  ): ControlCommandResult {
    return this.commandUnavailable() ?? failure(
      'unsupported',
      'Report map order is fixed by the portable scene manifest.'
    );
  }

  updateScalarMapping(
    address: LayerControlAddress,
    update: ScalarMappingUpdate
  ): ControlCommandResult {
    return this.commandUnavailable() ??
      this.viewerTarget.updateScalarMapping(address, update);
  }

  setInspectionSelection(selection: InspectionSelection): ControlCommandResult {
    return this.commandUnavailable() ??
      this.viewerTarget.setInspectionSelection(selection);
  }

  applyFigurePreset(presetId: string): ControlCommandResult {
    return this.commandUnavailable() ?? this.viewerTarget.applyFigurePreset(presetId);
  }

  setFigureBackground(background: number, transparent = false): ControlCommandResult {
    return this.commandUnavailable() ??
      this.viewerTarget.setFigureBackground(background, transparent);
  }

  async exportFigure(
    request: FigureExportRequest = {}
  ): Promise<ControlCommandResult<FigureExportResult>> {
    const unavailable = this.commandUnavailable();
    return unavailable ?? this.viewerTarget.exportFigure(request);
  }

  setDisplayedLayer(layerId: string): ControlCommandResult {
    return this.commandUnavailable() ?? this.controller.setDisplayedLayer(layerId);
  }

  private commandUnavailable(): ControlCommandFailure | null {
    return this.isDisposed()
      ? failure('disposed', 'The report-scene control target has been disposed.')
      : null;
  }

  private publishBaseSnapshot(base: SurfViewControlSnapshot): void {
    const revision = Math.max(base.revision, this.snapshot.revision + 1);
    this.snapshot = this.buildSnapshot(base, revision);
    for (const subscription of this.subscriptions) subscription.deliver(this.snapshot);
  }

  private buildSnapshot(
    base: SurfViewControlSnapshot,
    revision: number
  ): SurfViewControlSnapshot {
    const availableLayerIds = this.controller.getAvailableLayerIds();
    const exclusiveAvailability = availableLayerIds.length > 0
      ? ENABLED
      : disabled('No report maps are loaded.');
    return deepFreeze({
      revision,
      view: this.buildView(base.view),
      surfaces: base.surfaces.map(surface => this.joinSurface(surface)),
      selection: this.joinSelection(base.selection),
      figure: base.figure,
      capabilities: {
        ...base.capabilities,
        anatomicalViews: this.controller.getViewTarget()
          ? ENABLED
          : disabled('No coordinated report view target is available.'),
        layerVisibility: disabled(
          'Report scenes use one displayed map selected through the exclusive-map capability.'
        ),
        layerOrder: disabled('Report map order is fixed by the portable scene manifest.'),
        exclusiveMap: {
          availability: exclusiveAvailability,
          displayedLayerId: this.controller.getState().displayedLayerId,
          availableLayerIds
        }
      }
    });
  }

  private buildView(base: ViewControlDescriptor): ViewControlDescriptor {
    const target = this.controller.getViewTarget();
    const current = this.controller.getState().currentView;
    const availability = target
      ? ENABLED
      : disabled('No coordinated report view target is available.');
    return deepFreeze({
      current: current && target && this.targetsEqual(current.target, target)
        ? current
        : null,
      anatomicalViews: ANATOMICAL_VIEWS.map(view => ({
        id: view,
        label: labelFromId(view),
        availability
      })),
      targets: target ? [{
        target,
        label: target.kind === 'group'
          ? `${labelFromId(target.groupId)} Report Pair`
          : labelFromId(target.surfaceId),
        availability
      }] : [],
      fit: target ? base.fit : availability,
      reset: target ? base.reset : availability
    });
  }

  private joinSurface(surface: SurfaceControlDescriptor): SurfaceControlDescriptor {
    const geometry = this.controller.manifest.geometries[surface.id];
    const geometryMetadata = asControlObject(geometry?.metadata);
    return deepFreeze({
      ...surface,
      layers: surface.layers.map(layer => this.joinLayer(layer)),
      ...(geometryMetadata ? { metadata: geometryMetadata } : {})
    });
  }

  private joinSelection(
    selection: SelectionControlDescriptor
  ): SelectionControlDescriptor {
    if (!selection.inspection) return selection;
    return deepFreeze({
      ...selection,
      inspection: {
        ...selection.inspection,
        values: selection.inspection.values.map(value => {
          const manifest = this.controller.manifest.layers[value.layerId];
          if (!manifest) return value;
          return {
            ...value,
            label: manifest.legend?.title ?? manifest.label ?? manifest.id,
            ...(manifest.legend?.units ?? manifest.units
              ? { units: manifest.legend?.units ?? manifest.units }
              : {})
          };
        })
      }
    });
  }

  private joinLayer(layer: LayerControlDescriptor): LayerControlDescriptor {
    const manifest = this.controller.manifest.layers[layer.id];
    if (!manifest) return layer;
    const metadata = this.layerMetadata(manifest);
    return deepFreeze({
      ...layer,
      label: manifest.legend?.title ?? manifest.label ?? manifest.id,
      ...(manifest.legend?.units ?? manifest.units
        ? { units: manifest.legend?.units ?? manifest.units }
        : {}),
      ...(metadata ? { metadata } : {})
    });
  }

  private layerMetadata(
    manifest: SurfViewSceneLayerManifest
  ): ControlJsonObject | undefined {
    const metadata = asControlObject(manifest.metadata);
    const provenance = asControlObject(manifest.provenance);
    const legend = asControlObject(manifest.legend);
    const joined = asControlObject({
      ...(metadata ?? {}),
      ...(provenance ? { provenance } : {}),
      ...(legend ? { legend } : {})
    });
    return joined && Object.keys(joined).length > 0 ? joined : undefined;
  }

  private targetsEqual(
    left: AnatomicalViewTargetRef,
    right: AnatomicalViewTargetRef
  ): boolean {
    return left.kind === right.kind && (left.kind === 'surface'
      ? left.surfaceId === (right as { readonly surfaceId: string }).surfaceId
      : left.groupId === (right as { readonly groupId: string }).groupId);
  }
}

export function createReportSceneControlTarget(
  controller: ReportSceneController,
  options: ReportSceneControlTargetOptions = {}
): ReportSceneControlTarget {
  return new ReportSceneControlTarget(controller, options);
}
