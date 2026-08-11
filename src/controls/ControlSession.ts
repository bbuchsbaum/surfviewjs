import type { InspectionSelection } from '../Inspection';
import type { BlendMode } from '../layers';
import type {
  ControlCommandFailure,
  ControlCommandResult,
  FigureExportRequest,
  FigureExportResult,
  LayerControlAddress,
  LayerControlDescriptor,
  LayerDataSummaryControlDescriptor,
  ScalarMappingUpdate,
  SetAnatomicalViewRequest,
  SurfaceControlDescriptor,
  SurfViewControlSectionId,
  SurfViewControlSessionState,
  SurfViewControlSnapshot,
  SurfViewControlSubscription,
  SurfViewControlTarget,
  SurfViewControlTargetCommands
} from './ControlTarget';

export interface SurfViewControlSessionOptions {
  readonly focusedSurfaceId?: string | null;
  readonly focusedLayerId?: string | null;
  readonly expandedSections?: readonly SurfViewControlSectionId[];
  readonly advancedVisible?: boolean;
  readonly symmetricRangeLock?: boolean;
}

export interface SurfViewControlFocusSnapshot {
  readonly surface: SurfaceControlDescriptor | null;
  readonly layer: LayerControlDescriptor | null;
  /** Lazily queried only for the session-focused scalar layer. */
  readonly scalarSummary: LayerDataSummaryControlDescriptor | null;
}

/**
 * Immutable presentation state for one mounted control surface.
 *
 * `canonical` is shared target state. `state` and `focus` belong only to this
 * session, so local focus and disclosure changes advance `sessionRevision`
 * without changing `canonical.revision`.
 */
export interface SurfViewControlSessionSnapshot {
  readonly sessionRevision: number;
  readonly canonical: SurfViewControlSnapshot;
  readonly state: SurfViewControlSessionState;
  readonly focus: SurfViewControlFocusSnapshot;
}

export type SurfViewControlSessionSnapshotListener = (
  snapshot: SurfViewControlSessionSnapshot
) => void;

const SECTION_ORDER: readonly SurfViewControlSectionId[] = Object.freeze([
  'view',
  'layers',
  'selected-layer',
  'selection',
  'figure'
]);

const DEFAULT_EXPANDED_SECTIONS: readonly SurfViewControlSectionId[] = Object.freeze([
  'view',
  'layers',
  'selected-layer'
]);

const SUCCESS: ControlCommandResult = Object.freeze({ ok: true });

function failure(
  code: ControlCommandFailure['code'],
  message: string
): ControlCommandFailure {
  return Object.freeze({ ok: false, code, message });
}

function isSectionId(value: unknown): value is SurfViewControlSectionId {
  return typeof value === 'string' && SECTION_ORDER.includes(
    value as SurfViewControlSectionId
  );
}

function normalizeExpandedSections(
  sections: readonly SurfViewControlSectionId[]
): readonly SurfViewControlSectionId[] {
  const included = new Set(sections);
  return Object.freeze(SECTION_ORDER.filter(section => included.has(section)));
}

function deeplyFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deeplyFreeze(child);
  }
  return value;
}

function preferredVisibleLayer(
  surface: SurfaceControlDescriptor
): LayerControlDescriptor | null {
  const visibleLayers = surface.layers.filter(layer => layer.visible);
  for (let index = visibleLayers.length - 1; index >= 0; index -= 1) {
    const layer = visibleLayers[index];
    if (layer && layer.role !== 'anatomy') return layer;
  }
  return visibleLayers[visibleLayers.length - 1] ?? null;
}

/**
 * Reconciles focus after every target change.
 *
 * A visible focused entity is retained. Otherwise focus falls back to the
 * first visible surface in canonical order, then the topmost visible
 * non-anatomy layer on that surface (or its topmost visible layer). With no
 * visible candidate, the corresponding focus ID is null.
 */
function reconcileState(
  canonical: SurfViewControlSnapshot,
  requested: SurfViewControlSessionState
): SurfViewControlSessionState {
  const visibleSurfaces = canonical.surfaces.filter(surface => surface.visible);
  const requestedSurface = visibleSurfaces.find(
    surface => surface.id === requested.focusedSurfaceId
  );
  const surface = requestedSurface ?? visibleSurfaces[0] ?? null;
  const requestedLayer = surface && requestedSurface
    ? surface.layers.find(
        layer => layer.id === requested.focusedLayerId && layer.visible
      ) ?? null
    : null;
  const layer = surface ? requestedLayer ?? preferredVisibleLayer(surface) : null;
  const displayRange = layer?.scalarMapping?.displayRange.value;
  const symmetricRangeLock = requested.symmetricRangeLock && displayRange
    ? Math.abs(displayRange[0] + displayRange[1]) <= Number.EPSILON * 8 * Math.max(
        1,
        Math.abs(displayRange[0]),
        Math.abs(displayRange[1])
      )
    : requested.symmetricRangeLock;

  return deeplyFreeze({
    focusedSurfaceId: surface?.id ?? null,
    focusedLayerId: layer?.id ?? null,
    expandedSections: normalizeExpandedSections(requested.expandedSections),
    advancedVisible: requested.advancedVisible,
    symmetricRangeLock
  });
}

function sameState(
  left: SurfViewControlSessionState,
  right: SurfViewControlSessionState
): boolean {
  return left.focusedSurfaceId === right.focusedSurfaceId &&
    left.focusedLayerId === right.focusedLayerId &&
    left.advancedVisible === right.advancedVisible &&
    left.symmetricRangeLock === right.symmetricRangeLock &&
    left.expandedSections.length === right.expandedSections.length &&
    left.expandedSections.every((section, index) =>
      section === right.expandedSections[index]
    );
}

function buildSessionSnapshot(
  sessionRevision: number,
  canonical: SurfViewControlSnapshot,
  state: SurfViewControlSessionState,
  scalarSummary: LayerDataSummaryControlDescriptor | null
): SurfViewControlSessionSnapshot {
  const surface = state.focusedSurfaceId === null
    ? null
    : canonical.surfaces.find(candidate =>
        candidate.id === state.focusedSurfaceId
      ) ?? null;
  const layer = surface && state.focusedLayerId !== null
    ? surface.layers.find(candidate => candidate.id === state.focusedLayerId) ?? null
    : null;

  return deeplyFreeze({
    sessionRevision,
    canonical,
    state,
    focus: {
      surface,
      layer,
      scalarSummary
    }
  });
}

class SessionSubscription implements SurfViewControlSubscription {
  private active = true;
  private deliveredRevision = -1;

  constructor(
    private readonly listener: SurfViewControlSessionSnapshotListener,
    private readonly onClose: (subscription: SessionSubscription) => void
  ) {}

  get closed(): boolean {
    return !this.active;
  }

  unsubscribe(): void {
    if (!this.active) return;
    this.active = false;
    this.onClose(this);
  }

  closeFromSession(): void {
    this.active = false;
  }

  deliver(snapshot: SurfViewControlSessionSnapshot): void {
    if (!this.active || this.deliveredRevision === snapshot.sessionRevision) return;
    this.deliveredRevision = snapshot.sessionRevision;
    this.listener(snapshot);
  }
}

/**
 * Headless state machine for one control panel.
 *
 * The target remains the canonical state owner and is never disposed by the
 * session. Target updates are incorporated immediately into getSnapshot(),
 * while listener delivery is coalesced to the latest canonical revision in a
 * microtask. Local focus and disclosure remain independent across sessions.
 */
export class SurfViewControlSession implements SurfViewControlTargetCommands {
  private readonly subscriptions = new Set<SessionSubscription>();
  private readonly targetSubscription: SurfViewControlSubscription;
  private canonical: SurfViewControlSnapshot;
  private state: SurfViewControlSessionState;
  private snapshot: SurfViewControlSessionSnapshot;
  private sessionRevision = 0;
  private disposed = false;
  private notificationScheduled = false;
  private readonly scalarSummaryCache = new Map<
    string,
    { readonly dataRevision: number; readonly summary: LayerDataSummaryControlDescriptor }
  >();
  private focusedScalarSummary: LayerDataSummaryControlDescriptor | null = null;

  constructor(
    private readonly target: SurfViewControlTarget,
    options: SurfViewControlSessionOptions = {}
  ) {
    if (!target || typeof target.getSnapshot !== 'function' ||
        typeof target.getLayerDataSummary !== 'function' ||
        typeof target.subscribe !== 'function') {
      throw new TypeError('A control session requires a SurfViewControlTarget.');
    }
    if (options.expandedSections !== undefined &&
        (!Array.isArray(options.expandedSections) ||
          !options.expandedSections.every(isSectionId))) {
      throw new TypeError('expandedSections contains an unknown control section.');
    }

    this.canonical = target.getSnapshot();
    this.state = reconcileState(this.canonical, deeplyFreeze({
      focusedSurfaceId: options.focusedSurfaceId ?? null,
      focusedLayerId: options.focusedLayerId ?? null,
      expandedSections: normalizeExpandedSections(
        options.expandedSections ?? DEFAULT_EXPANDED_SECTIONS
      ),
      advancedVisible: options.advancedVisible ?? false,
      symmetricRangeLock: options.symmetricRangeLock ?? false
    }));
    this.refreshFocusedScalarSummary();
    this.snapshot = buildSessionSnapshot(
      this.sessionRevision,
      this.canonical,
      this.state,
      this.focusedScalarSummary
    );

    this.targetSubscription = target.subscribe(canonical => {
      if (canonical === this.canonical || this.disposed) return;
      this.applyCanonicalSnapshot(canonical);
    });
  }

  getSnapshot(): SurfViewControlSessionSnapshot {
    return this.snapshot;
  }

  subscribe(
    listener: SurfViewControlSessionSnapshotListener
  ): SurfViewControlSubscription {
    if (typeof listener !== 'function') {
      throw new TypeError('A control-session subscription requires a listener function.');
    }
    const subscription = new SessionSubscription(listener, current => {
      this.subscriptions.delete(current);
    });
    subscription.deliver(this.snapshot);
    if (this.disposed) {
      subscription.closeFromSession();
      return subscription;
    }
    this.subscriptions.add(subscription);
    return subscription;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.targetSubscription.unsubscribe();
    for (const subscription of this.subscriptions) {
      subscription.closeFromSession();
    }
    this.subscriptions.clear();
    this.scalarSummaryCache.clear();
  }

  setFocusedSurface(surfaceId: string): ControlCommandResult {
    const unavailable = this.localMutationUnavailable();
    if (unavailable) return unavailable;
    if (typeof surfaceId !== 'string') {
      return failure('invalid-value', 'Focused surface requires a stable surface ID.');
    }
    const surface = this.canonical.surfaces.find(candidate => candidate.id === surfaceId);
    if (!surface) {
      return failure('surface-not-found', `Surface "${surfaceId}" was not found.`);
    }
    if (!surface.visible) {
      return failure('conflict', `Surface "${surfaceId}" is hidden and cannot receive focus.`);
    }
    this.updateLocalState({
      ...this.state,
      focusedSurfaceId: surfaceId,
      focusedLayerId: null
    });
    return SUCCESS;
  }

  setFocusedLayer(address: LayerControlAddress): ControlCommandResult {
    const unavailable = this.localMutationUnavailable();
    if (unavailable) return unavailable;
    if (!address || typeof address.surfaceId !== 'string' ||
        typeof address.layerId !== 'string') {
      return failure(
        'invalid-value',
        'Focused layer requires stable surface and layer IDs.'
      );
    }
    const surface = this.canonical.surfaces.find(
      candidate => candidate.id === address.surfaceId
    );
    if (!surface) {
      return failure(
        'surface-not-found',
        `Surface "${address.surfaceId}" was not found.`
      );
    }
    const layer = surface.layers.find(candidate => candidate.id === address.layerId);
    if (!layer) {
      return failure('layer-not-found', `Layer "${address.layerId}" was not found.`);
    }
    if (!surface.visible || !layer.visible) {
      return failure(
        'conflict',
        `Layer "${address.layerId}" is hidden and cannot receive focus.`
      );
    }
    this.updateLocalState({
      ...this.state,
      focusedSurfaceId: address.surfaceId,
      focusedLayerId: address.layerId
    });
    return SUCCESS;
  }

  setExpandedSections(
    sections: readonly SurfViewControlSectionId[]
  ): ControlCommandResult {
    const unavailable = this.localMutationUnavailable();
    if (unavailable) return unavailable;
    if (!Array.isArray(sections) || !sections.every(isSectionId)) {
      return failure('invalid-value', 'Expanded sections contain an unknown control section.');
    }
    this.updateLocalState({
      ...this.state,
      expandedSections: normalizeExpandedSections(sections)
    });
    return SUCCESS;
  }

  setSectionExpanded(
    section: SurfViewControlSectionId,
    expanded: boolean
  ): ControlCommandResult {
    const unavailable = this.localMutationUnavailable();
    if (unavailable) return unavailable;
    if (!isSectionId(section) || typeof expanded !== 'boolean') {
      return failure('invalid-value', 'Section expansion requires a known section and boolean.');
    }
    const sections = new Set(this.state.expandedSections);
    if (expanded) sections.add(section);
    else sections.delete(section);
    this.updateLocalState({
      ...this.state,
      expandedSections: normalizeExpandedSections([...sections])
    });
    return SUCCESS;
  }

  setAdvancedVisible(visible: boolean): ControlCommandResult {
    const unavailable = this.localMutationUnavailable();
    if (unavailable) return unavailable;
    if (typeof visible !== 'boolean') {
      return failure('invalid-value', 'Advanced visibility requires a boolean.');
    }
    this.updateLocalState({ ...this.state, advancedVisible: visible });
    return SUCCESS;
  }

  setSymmetricRangeLock(enabled: boolean): ControlCommandResult {
    const unavailable = this.localMutationUnavailable();
    if (unavailable) return unavailable;
    if (typeof enabled !== 'boolean') {
      return failure('invalid-value', 'Symmetric range lock requires a boolean.');
    }
    this.updateLocalState({ ...this.state, symmetricRangeLock: enabled });
    return SUCCESS;
  }

  setAnatomicalView(request: SetAnatomicalViewRequest): ControlCommandResult {
    return this.forward(() => this.target.setAnatomicalView(request));
  }

  fitView(): ControlCommandResult {
    return this.forward(() => this.target.fitView());
  }

  resetView(): ControlCommandResult {
    return this.forward(() => this.target.resetView());
  }

  setSurfaceVisibility(surfaceId: string, visible: boolean): ControlCommandResult {
    return this.forward(() => this.target.setSurfaceVisibility(surfaceId, visible));
  }

  setLayerVisibility(
    address: LayerControlAddress,
    visible: boolean
  ): ControlCommandResult {
    return this.forward(() => this.target.setLayerVisibility(address, visible));
  }

  setLayerOpacity(
    address: LayerControlAddress,
    opacity: number
  ): ControlCommandResult {
    return this.forward(() => this.target.setLayerOpacity(address, opacity));
  }

  setLayerBlendMode(
    address: LayerControlAddress,
    blendMode: BlendMode
  ): ControlCommandResult {
    return this.forward(() => this.target.setLayerBlendMode(address, blendMode));
  }

  setLayerOrder(
    surfaceId: string,
    layerIds: readonly string[]
  ): ControlCommandResult {
    return this.forward(() => this.target.setLayerOrder(surfaceId, layerIds));
  }

  updateScalarMapping(
    address: LayerControlAddress,
    update: ScalarMappingUpdate
  ): ControlCommandResult {
    return this.forward(() => this.target.updateScalarMapping(address, update));
  }

  setInspectionSelection(selection: InspectionSelection): ControlCommandResult {
    return this.forward(() => this.target.setInspectionSelection(selection));
  }

  applyFigurePreset(presetId: string): ControlCommandResult {
    return this.forward(() => this.target.applyFigurePreset(presetId));
  }

  setFigureBackground(background: number, transparent?: boolean): ControlCommandResult {
    return this.forward(() => this.target.setFigureBackground(background, transparent));
  }

  exportFigure(
    request?: FigureExportRequest
  ): Promise<ControlCommandResult<FigureExportResult>> {
    const unavailable = this.localMutationUnavailable();
    if (unavailable) return Promise.resolve(unavailable);
    return this.target.exportFigure(request);
  }

  setDisplayedLayer(layerId: string): ControlCommandResult {
    return this.forward(() => this.target.setDisplayedLayer(layerId));
  }

  private localMutationUnavailable(): ControlCommandFailure | null {
    return this.disposed
      ? failure('disposed', 'The control session has been disposed.')
      : null;
  }

  private forward(command: () => ControlCommandResult): ControlCommandResult {
    const unavailable = this.localMutationUnavailable();
    return unavailable ?? command();
  }

  private updateLocalState(requested: SurfViewControlSessionState): void {
    const next = reconcileState(this.canonical, requested);
    if (sameState(next, this.state)) return;
    this.state = next;
    this.commitSnapshot();
  }

  private applyCanonicalSnapshot(canonical: SurfViewControlSnapshot): void {
    this.canonical = canonical;
    this.state = reconcileState(canonical, this.state);
    this.commitSnapshot();
  }

  private commitSnapshot(): void {
    this.refreshFocusedScalarSummary();
    this.sessionRevision += 1;
    this.snapshot = buildSessionSnapshot(
      this.sessionRevision,
      this.canonical,
      this.state,
      this.focusedScalarSummary
    );
    this.scheduleNotification();
  }

  private refreshFocusedScalarSummary(): void {
    const surfaceId = this.state.focusedSurfaceId;
    const layerId = this.state.focusedLayerId;
    const surface = surfaceId === null
      ? null
      : this.canonical.surfaces.find(candidate => candidate.id === surfaceId) ?? null;
    const layer = surface && layerId !== null
      ? surface.layers.find(candidate => candidate.id === layerId) ?? null
      : null;
    const scalar = layer?.scalarMapping;
    if (!surface || !layer || !scalar) {
      this.focusedScalarSummary = null;
      return;
    }
    const key = JSON.stringify([surface.id, layer.id]);
    const cached = this.scalarSummaryCache.get(key);
    if (cached?.dataRevision === scalar.dataRevision) {
      this.focusedScalarSummary = cached.summary;
      return;
    }
    const result = this.target.getLayerDataSummary({
      surfaceId: surface.id,
      layerId: layer.id
    });
    const summary = result.ok ? result.value : scalar.summary ?? null;
    this.focusedScalarSummary = summary;
    if (summary) {
      this.scalarSummaryCache.set(key, {
        dataRevision: scalar.dataRevision,
        summary
      });
    } else {
      this.scalarSummaryCache.delete(key);
    }
  }

  private scheduleNotification(): void {
    if (this.notificationScheduled || this.disposed) return;
    this.notificationScheduled = true;
    queueMicrotask(() => {
      this.notificationScheduled = false;
      if (this.disposed) return;
      const snapshot = this.snapshot;
      for (const subscription of [...this.subscriptions]) {
        try {
          subscription.deliver(snapshot);
        } catch (error) {
          console.error('surfview: SurfViewControlSession subscriber failed', error);
        }
      }
    });
  }
}

/**
 * Creates a session over an explicitly supplied, caller-owned target.
 * Disposing the session never disposes or transfers ownership of the target.
 */
export function createSurfViewControlSession(
  target: SurfViewControlTarget,
  options: SurfViewControlSessionOptions = {}
): SurfViewControlSession {
  return new SurfViewControlSession(target, options);
}
