import { ANATOMICAL_VIEWS, normalizeAnatomicalHemisphere } from '../AnatomicalView';
import type { AnatomicalViewChangedEvent } from '../AnatomicalView';
import ColorMap from '../ColorMap';
import type { InspectionSelection } from '../Inspection';
import type { NeuroSurfaceViewer } from '../NeuroSurfaceViewer';
import { getStylePreset, listStylePresets } from '../StylePresets';
import type { SurfViewStylePresetName } from '../StylePresets';
import type { ViewerStateChangedEvent } from '../events';
import type {
  BlendMode,
  Layer,
  LayerDataSummary,
  LayerPresentation
} from '../layers';
import type {
  AnatomicalViewTargetRef,
  BivariateMappingControls,
  CapabilityAvailability,
  ControlCommandFailure,
  ControlCommandResult,
  ControlQueryResult,
  ControlJsonObject,
  ControlJsonValue,
  ControlOptionDescriptor,
  CurrentAnatomicalViewDescriptor,
  FigureControlDescriptor,
  FigureExportRequest,
  FigureExportResult,
  LayerColorPreviewDescriptor,
  LayerControlAddress,
  LayerControlDescriptor,
  LayerDataSummaryControlDescriptor,
  OutlineControls,
  ParcelControls,
  ScalarMappingControls,
  ScalarMappingUpdate,
  SelectionControlDescriptor,
  SetAnatomicalViewRequest,
  SurfaceControlDescriptor,
  SurfViewControlCapabilities,
  SurfViewControlSnapshot,
  SurfViewControlSnapshotListener,
  SurfViewControlSubscription,
  SurfViewControlTarget,
  TemporalControls,
  ViewControlDescriptor
} from './ControlTarget';

export interface ViewerControlTargetOptions {
  /** Histogram bins computed lazily by scalar layers and cached by data revision. */
  readonly histogramBins?: number;
}

type ScalarLayerPort = Layer & {
  getRange(): [number, number];
  getThreshold(): [number, number];
  getColorMapName?: () => string;
  setColorMap?: (colorMap: string) => void;
  setColormap?: (colorMap: string) => void;
};

type BivariateLayerPort = Layer & {
  getRangeX(): [number, number];
  getRangeY(): [number, number];
  getColorMapName(): string;
};

type TemporalLayerPort = Layer & {
  getTimes(): number[];
};

type ParcelLayerPort = Layer & {
  getParcelData(): {
    atlas?: { id?: unknown; name?: unknown };
    parcels?: unknown[];
  };
};

type LayerOrderValidationPort = {
  validateLayerOrder(ids: readonly string[]): {
    readonly ok: boolean;
    readonly changed?: boolean;
    readonly message?: string;
  };
};

interface ResolvedScalarPort {
  readonly layer: ScalarLayerPort;
  readonly colorMapName: string;
  readonly colorMapUpdateKey: 'colorMap' | 'colormap';
  readonly range: readonly [number, number];
  readonly threshold: readonly [number, number];
}

interface ResolvedLayer {
  readonly layer: Layer;
}

interface FailedLayerResolution {
  readonly failure: ControlCommandFailure;
}

const ENABLED: CapabilityAvailability = Object.freeze({ enabled: true });
const VALID_BLEND_MODES: readonly BlendMode[] = Object.freeze([
  'normal',
  'additive',
  'multiply'
]);

let cachedColorMapOptions: readonly ControlOptionDescriptor[] | null = null;

function disabled(reason: string): CapabilityAvailability {
  return Object.freeze({ enabled: false, reason });
}

function failure(
  code: ControlCommandFailure['code'],
  message: string
): ControlCommandFailure {
  return Object.freeze({ ok: false, code, message });
}

function success(): ControlCommandResult {
  return Object.freeze({ ok: true });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function cloneControlJson(value: unknown): ControlJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map(item => cloneControlJson(item) ?? null)
    );
  }
  if (!value || typeof value !== 'object') return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;

  const clone: Record<string, ControlJsonValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = cloneControlJson(item);
    if (normalized !== undefined) clone[key] = normalized;
  }
  return Object.freeze(clone);
}

function cloneMetadata(
  presentation: LayerPresentation
): ControlJsonObject | undefined {
  const metadata = cloneControlJson({
    ...(presentation.provenance !== undefined
      ? { provenance: presentation.provenance }
      : {}),
    ...(presentation.missingValueLabel !== undefined
      ? { missingValueLabel: presentation.missingValueLabel }
      : {})
  });
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return undefined;
  return Object.keys(metadata).length > 0 ? metadata as ControlJsonObject : undefined;
}

function finiteRange(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const lower = value[0];
  const upper = value[1];
  if (typeof lower !== 'number' || typeof upper !== 'number' ||
      !Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
    return null;
  }
  return Object.freeze([lower, upper]) as readonly [number, number];
}

function labelFromId(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function getColorMapOptions(): readonly ControlOptionDescriptor[] {
  if (!cachedColorMapOptions) {
    cachedColorMapOptions = deepFreeze(
      ColorMap.getAvailableMaps()
        .slice()
        .sort((left, right) => left.localeCompare(right))
        .map(id => ({ id, label: labelFromId(id), availability: ENABLED }))
    );
  }
  return cachedColorMapOptions;
}

function readLayerState(layer: Layer): Record<string, unknown> {
  try {
    const state = layer.toStateJSON();
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

function resolveScalarPort(layer: Layer): ResolvedScalarPort | null {
  try {
    const candidate = layer as ScalarLayerPort;
    if (typeof candidate.getRange !== 'function' ||
        typeof candidate.getThreshold !== 'function') {
      return null;
    }
    const range = finiteRange(candidate.getRange());
    const threshold = finiteRange(candidate.getThreshold());
    if (!range || !threshold) return null;

    const state = readLayerState(layer);
    const colorMapName = typeof candidate.getColorMapName === 'function'
      ? candidate.getColorMapName()
      : typeof state.colorMapName === 'string'
        ? state.colorMapName
        : null;
    if (!colorMapName) return null;

    const colorMapUpdateKey = typeof candidate.setColorMap === 'function'
      ? 'colorMap'
      : typeof candidate.setColormap === 'function'
        ? 'colormap'
        : null;
    if (!colorMapUpdateKey) return null;
    return { layer: candidate, colorMapName, colorMapUpdateKey, range, threshold };
  } catch {
    return null;
  }
}

function cloneSummary(summary: LayerDataSummary | null): LayerDataSummaryControlDescriptor | undefined {
  if (!summary) return undefined;
  return deepFreeze({
    finiteCount: summary.finiteCount,
    missingCount: summary.missingCount,
    minimum: summary.minimum,
    maximum: summary.maximum,
    ...(summary.histogram
      ? {
          histogram: {
            edges: [...summary.histogram.edges],
            counts: [...summary.histogram.counts]
          }
        }
      : {})
  });
}

function rangeDescriptor(
  value: readonly [number, number],
  summary?: LayerDataSummaryControlDescriptor
) {
  const candidates = [value[0], value[1], summary?.minimum, summary?.maximum]
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  const minimum = candidates.length > 0 ? Math.min(...candidates) : value[0];
  const maximum = candidates.length > 0 ? Math.max(...candidates) : value[1];
  return deepFreeze({ value: [...value] as [number, number], minimum, maximum });
}

function colorMapPreview(colorMapName: string): LayerColorPreviewDescriptor {
  const colors = ColorMap.getPresetMaps()[colorMapName];
  if (!colors || colors.length === 0) {
    return Object.freeze({
      kind: 'colormap',
      label: colorMapName,
      css: 'linear-gradient(90deg, #6b7280, #e5e7eb)'
    });
  }
  const indexes = [0, Math.floor((colors.length - 1) / 2), colors.length - 1];
  const stops = indexes.map(index => {
    const color = colors[index];
    const channels = color.slice(0, 3).map(channel =>
      Math.round(Math.max(0, Math.min(1, channel)) * 255)
    );
    return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
  });
  return Object.freeze({
    kind: 'colormap',
    label: colorMapName,
    css: `linear-gradient(90deg, ${stops.join(', ')})`
  });
}

function solidPreview(color: number, label: string): LayerColorPreviewDescriptor {
  const css = `#${Math.max(0, Math.min(0xffffff, Math.trunc(color)))
    .toString(16)
    .padStart(6, '0')}`;
  return Object.freeze({ kind: 'solid', label, css });
}

class TargetSubscription implements SurfViewControlSubscription {
  private active = true;

  constructor(
    readonly listener: SurfViewControlSnapshotListener,
    private readonly onClose: (subscription: TargetSubscription) => void
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
 * Runtime adapter from NeuroSurfaceViewer to the stable, UI-neutral control
 * protocol. The concrete viewer is retained privately and never appears in a
 * snapshot, command result, or subscription payload.
 */
export class ViewerControlTarget implements SurfViewControlTarget {
  private readonly histogramBins: number;
  private readonly viewerUnsubscribers: Array<() => void> = [];
  private readonly subscriptions = new Set<TargetSubscription>();
  private snapshot: SurfViewControlSnapshot;
  private disposed = false;
  private currentView: CurrentAnatomicalViewDescriptor | null = null;
  private anatomicalSignalPending = false;
  private readonly summaryRevisions = new WeakMap<
    Layer,
    { readonly source: LayerDataSummary | null; readonly revision: number }
  >();
  private readonly histogramSummaries = new WeakMap<
    Layer,
    { readonly revision: number; readonly summary: LayerDataSummaryControlDescriptor }
  >();
  private nextSummaryRevision = 0;

  constructor(
    private readonly viewer: NeuroSurfaceViewer,
    options: ViewerControlTargetOptions = {}
  ) {
    const histogramBins = options.histogramBins ?? 32;
    if (!Number.isInteger(histogramBins) || histogramBins < 1 || histogramBins > 4096) {
      throw new RangeError('histogramBins must be an integer between 1 and 4096.');
    }
    this.histogramBins = histogramBins;
    const currentAnatomicalView = viewer.getCurrentAnatomicalView();
    if (currentAnatomicalView) {
      const target = this.targetFromViewEvent(currentAnatomicalView);
      this.currentView = target
        ? deepFreeze({ view: currentAnatomicalView.view, target })
        : null;
    }
    this.snapshot = this.buildInitialSnapshot();

    this.viewerUnsubscribers.push(
      viewer.on('anatomical-view:changed', event => this.handleAnatomicalViewChanged(event)),
      viewer.on('anatomical-view:reset', () => this.handleAnatomicalViewReset()),
      viewer.on('state:changed', event => this.handleViewerStateChanged(event))
    );
  }

  getSnapshot(): SurfViewControlSnapshot {
    return this.snapshot;
  }

  getLayerDataSummary(
    address: LayerControlAddress
  ): ControlQueryResult<LayerDataSummaryControlDescriptor> {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (!address || typeof address.surfaceId !== 'string' ||
        typeof address.layerId !== 'string') {
      return failure(
        'invalid-value',
        'A layer summary query requires stable surface and layer IDs.'
      );
    }
    const resolved = this.resolveLayer(address);
    if ('failure' in resolved) return resolved.failure;
    const scalar = resolveScalarPort(resolved.layer);
    if (!scalar) {
      return failure(
        'unsupported',
        `Layer "${address.layerId}" has no scalar data summary.`
      );
    }
    const base = this.readLayerSummary(scalar.layer);
    const revision = this.summaryRevisionFor(scalar.layer, base);
    const cached = this.histogramSummaries.get(scalar.layer);
    if (cached?.revision === revision) {
      return Object.freeze({ ok: true, value: cached.summary });
    }
    let summary: LayerDataSummaryControlDescriptor | undefined;
    try {
      summary = cloneSummary(
        scalar.layer.getDataSummary({ histogram: { bins: this.histogramBins } })
      );
    } catch {
      summary = cloneSummary(base);
    }
    if (!summary) {
      return failure('unsupported', `Layer "${address.layerId}" has no data summary.`);
    }
    this.histogramSummaries.set(scalar.layer, { revision, summary });
    return Object.freeze({ ok: true, value: summary });
  }

  subscribe(listener: SurfViewControlSnapshotListener): SurfViewControlSubscription {
    if (typeof listener !== 'function') {
      throw new TypeError('A control-target subscription requires a listener function.');
    }
    listener(this.snapshot);
    const subscription = new TargetSubscription(listener, current => {
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
    if (!this.disposed && this.viewer.isDisposed()) this.dispose();
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.viewerUnsubscribers.splice(0)) unsubscribe();
    for (const subscription of this.subscriptions) subscription.closeFromTarget();
    this.subscriptions.clear();
  }

  setAnatomicalView(request: SetAnatomicalViewRequest): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (!request || !ANATOMICAL_VIEWS.includes(request.view)) {
      return failure('invalid-value', 'An anatomical view must use a supported view name.');
    }
    if (request.fit !== undefined && typeof request.fit !== 'boolean') {
      return failure('invalid-value', 'Anatomical-view fit must be a boolean when provided.');
    }
    if (!request.target || (request.target.kind !== 'surface' && request.target.kind !== 'group')) {
      return failure('invalid-value', 'An anatomical view requires an explicit surface or group target.');
    }

    const result = request.target.kind === 'surface'
      ? this.viewer.setAnatomicalView(request.view, {
          layout: 'single',
          surfaceId: request.target.surfaceId,
          ...(request.fit !== undefined ? { fit: request.fit } : {})
        })
      : this.viewer.setAnatomicalView(request.view, {
          layout: 'paired',
          groupId: request.target.groupId,
          ...(request.fit !== undefined ? { fit: request.fit } : {}),
          ...(request.hemisphereGap !== undefined
            ? { hemisphereGap: request.hemisphereGap }
            : {})
        });
    if (result.ok) return success();
    switch (result.code) {
      case 'surface-not-found':
      case 'group-not-found':
      case 'disposed':
        return failure(result.code, result.message);
      case 'invalid-gap':
      case 'invalid-hemisphere':
        return failure('invalid-value', result.message);
    }
  }

  fitView(): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (this.viewer.initializationFailed || typeof this.viewer.centerCamera !== 'function') {
      return failure('unsupported', 'Camera fitting is unavailable for this viewer.');
    }
    if (this.currentView) {
      return this.setAnatomicalView({
        view: this.currentView.view,
        target: this.currentView.target,
        fit: true
      });
    }
    this.viewer.centerCamera();
    return success();
  }

  resetView(): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    const result = this.viewer.resetAnatomicalView();
    return result.ok ? success() : failure(result.code, result.message);
  }

  setSurfaceVisibility(surfaceId: string, visible: boolean): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (typeof visible !== 'boolean') {
      return failure('invalid-value', 'Surface visibility must be a boolean.');
    }
    const surface = this.viewer.getSurface(surfaceId);
    if (!surface) return failure('surface-not-found', `Surface "${surfaceId}" was not found.`);
    surface.setVisible(visible);
    return success();
  }

  setLayerVisibility(address: LayerControlAddress, visible: boolean): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (typeof visible !== 'boolean') {
      return failure('invalid-value', 'Layer visibility must be a boolean.');
    }
    const resolved = this.resolveLayer(address);
    if ('failure' in resolved) return resolved.failure;
    resolved.layer.setVisible(visible);
    return success();
  }

  setLayerOpacity(address: LayerControlAddress, opacity: number): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      return failure('invalid-value', 'Layer opacity must be a finite number between 0 and 1.');
    }
    const resolved = this.resolveLayer(address);
    if ('failure' in resolved) return resolved.failure;
    resolved.layer.setOpacity(opacity);
    return success();
  }

  setLayerBlendMode(address: LayerControlAddress, blendMode: BlendMode): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (!VALID_BLEND_MODES.includes(blendMode)) {
      return failure('invalid-value', `Unsupported layer blend mode "${String(blendMode)}".`);
    }
    const resolved = this.resolveLayer(address);
    if ('failure' in resolved) return resolved.failure;
    resolved.layer.setBlendMode(blendMode);
    return success();
  }

  setLayerOrder(surfaceId: string, layerIds: readonly string[]): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (!Array.isArray(layerIds) || layerIds.some(id => typeof id !== 'string')) {
      return failure('invalid-value', 'Layer order must be an array of stable layer IDs.');
    }
    const result = this.viewer.setLayerOrder(surfaceId, layerIds);
    if (result.ok) return success();
    switch (result.code) {
      case 'surface-not-found':
      case 'layer-not-found':
        return failure(result.code, result.message);
      case 'layer-not-reorderable':
      case 'constraint-violation':
        return failure('conflict', result.message);
      case 'duplicate-layer-id':
      case 'incomplete-order':
      case 'invalid-destination':
        return failure('invalid-value', result.message);
    }
  }

  updateScalarMapping(
    address: LayerControlAddress,
    update: ScalarMappingUpdate
  ): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    const resolved = this.resolveLayer(address);
    if ('failure' in resolved) return resolved.failure;
    const scalar = resolveScalarPort(resolved.layer);
    if (!scalar) {
      return failure('unsupported', `Layer "${address.layerId}" has no scalar mapping controls.`);
    }
    if (!update || (update.colorMapId === undefined &&
        update.displayRange === undefined && update.maskInterval === undefined)) {
      return failure('invalid-value', 'A scalar mapping update must change at least one property.');
    }

    const changes: Record<string, unknown> = {};
    if (update.colorMapId !== undefined) {
      if (update.colorMapId !== scalar.colorMapName) {
        const available = getColorMapOptions().some(option => option.id === update.colorMapId);
        if (!available) {
          return failure('invalid-value', `Unknown colormap "${update.colorMapId}".`);
        }
        changes[scalar.colorMapUpdateKey] = update.colorMapId;
      }
    }
    if (update.displayRange !== undefined) {
      const range = finiteRange(update.displayRange);
      if (!range) return failure('invalid-value', 'Display range must contain finite ascending bounds.');
      changes.range = [...range];
    }
    if (update.maskInterval !== undefined) {
      const threshold = finiteRange(update.maskInterval);
      if (!threshold) {
        return failure('invalid-value', 'Mask interval must contain finite ascending bounds.');
      }
      changes.threshold = [...threshold];
    }

    if (Object.keys(changes).length === 0) return success();
    try {
      this.viewer.updateLayer(address.surfaceId, address.layerId, changes);
      return success();
    } catch (error) {
      return failure(
        'invalid-value',
        error instanceof Error ? error.message : 'The scalar mapping update was rejected.'
      );
    }
  }

  setInspectionSelection(selection: InspectionSelection): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    const result = this.viewer.setInspectionSelection(selection);
    if (result.ok) return success();
    switch (result.code) {
      case 'disposed':
      case 'surface-not-found':
      case 'unsupported':
        return failure(result.code, result.message);
      case 'invalid-vertex':
      case 'parcel-not-found':
      case 'atlas-mismatch':
        return failure('invalid-value', result.message);
    }
  }

  applyFigurePreset(presetId: string): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    const presetNames = listStylePresets();
    if (!presetNames.includes(presetId as SurfViewStylePresetName)) {
      return failure('invalid-value', `Unknown figure preset "${presetId}".`);
    }
    try {
      this.viewer.applyStylePreset(presetId as SurfViewStylePresetName);
      return success();
    } catch (error) {
      return failure(
        'invalid-value',
        error instanceof Error ? error.message : 'The figure preset was rejected.'
      );
    }
  }

  setFigureBackground(background: number, transparent = false): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (!Number.isInteger(background) || background < 0 || background > 0xffffff ||
        typeof transparent !== 'boolean') {
      return failure(
        'invalid-value',
        'Figure background must be an integer RGB value between 0x000000 and 0xffffff.'
      );
    }
    if (this.viewer.initializationFailed) {
      return failure('unsupported', 'Figure background controls require an initialized viewer.');
    }
    const changed = this.viewer.setFigureBackground(background, transparent);
    const current = this.viewer.getFigureBackground();
    if (!changed && (current.color !== background || current.transparent !== transparent)) {
      return failure('unsupported', 'The viewer could not apply the requested figure background.');
    }
    return success();
  }

  async exportFigure(
    request: FigureExportRequest = {}
  ): Promise<ControlCommandResult<FigureExportResult>> {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    const width = request.width ?? this.snapshot.figure.defaultWidth;
    const height = request.height ?? this.snapshot.figure.defaultHeight;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      return failure('invalid-value', 'Figure width and height must be positive integers.');
    }
    if (request.dpi !== undefined && (!Number.isInteger(request.dpi) || request.dpi <= 0)) {
      return failure('invalid-value', 'Figure DPI must be a positive integer.');
    }
    if (this.viewer.initializationFailed || typeof this.viewer.exportPNG !== 'function') {
      return failure('unsupported', 'PNG export requires an initialized browser viewer.');
    }

    try {
      const dataUrl = this.viewer.exportPNG({
        width,
        height,
        backgroundColor: this.snapshot.figure.background,
        transparent: request.transparent ??
          this.snapshot.figure.defaultTransparent ??
          this.snapshot.figure.transparent,
        ...(request.dpi !== undefined ? { dpi: request.dpi } : {}),
        ...(request.colorbar !== undefined ? { colorbar: request.colorbar } : {}),
        ...(request.title !== undefined ? { title: request.title } : {}),
        ...(request.subtitle !== undefined ? { subtitle: request.subtitle } : {}),
        ...(request.filename !== undefined ? { downloadFilename: request.filename } : {})
      });
      return deepFreeze({
        ok: true,
        value: {
          dataUrl,
          mimeType: 'image/png',
          width,
          height,
          filename: request.filename ?? null
        }
      });
    } catch (error) {
      return failure(
        'unsupported',
        error instanceof Error ? error.message : 'PNG export failed.'
      );
    }
  }

  setDisplayedLayer(_layerId: string): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    return failure(
      'unsupported',
      'Ordinary viewer targets do not define an exclusive displayed map.'
    );
  }

  private commandUnavailable(): ControlCommandFailure | null {
    if (this.isDisposed()) {
      return failure('disposed', 'The viewer control target has been disposed.');
    }
    if (this.viewer.initializationFailed) {
      return failure('unsupported', 'The viewer did not initialize successfully.');
    }
    return null;
  }

  private resolveLayer(
    address: LayerControlAddress
  ): ResolvedLayer | FailedLayerResolution {
    if (!address || typeof address.surfaceId !== 'string' || typeof address.layerId !== 'string') {
      return { failure: failure('invalid-value', 'A layer command requires stable surface and layer IDs.') };
    }
    const surface = this.viewer.getSurface(address.surfaceId);
    if (!surface) {
      return {
        failure: failure('surface-not-found', `Surface "${address.surfaceId}" was not found.`)
      };
    }
    const layer = this.viewer.getOrderedLayers(address.surfaceId)
      .find(candidate => candidate.id === address.layerId);
    return layer
      ? { layer }
      : { failure: failure('layer-not-found', `Layer "${address.layerId}" was not found.`) };
  }

  private handleAnatomicalViewChanged(event: AnatomicalViewChangedEvent): void {
    const target = this.targetFromViewEvent(event);
    this.currentView = target ? deepFreeze({ view: event.view, target }) : null;
    this.anatomicalSignalPending = true;
  }

  private handleAnatomicalViewReset(): void {
    this.currentView = null;
    this.anatomicalSignalPending = true;
  }

  private handleViewerStateChanged(event: ViewerStateChangedEvent): void {
    if (this.disposed) return;
    const domains = new Set(event.domains);
    if (domains.has('camera') && !this.anatomicalSignalPending) this.currentView = null;
    this.anatomicalSignalPending = false;

    const previous = this.snapshot;
    const surfacesChanged = domains.has('surfaces') || domains.has('layers');
    const currentSelection = this.viewer.getInspectionSelection();
    const selectionChanged = domains.has('selection') || domains.has('surfaces') ||
      (domains.has('layers') && currentSelection.kind !== 'none');
    const next = deepFreeze({
      revision: event.revision,
      view: domains.has('camera') || domains.has('surfaces')
        ? this.buildView()
        : previous.view,
      surfaces: surfacesChanged ? this.buildSurfaces() : previous.surfaces,
      selection: selectionChanged ? this.buildSelection() : previous.selection,
      figure: domains.has('appearance') ? this.buildFigure() : previous.figure,
      capabilities: surfacesChanged || domains.has('selection')
        ? this.buildCapabilities()
        : previous.capabilities
    });
    this.snapshot = next;
    this.notify(next);
  }

  private targetFromViewEvent(
    event: AnatomicalViewChangedEvent
  ): AnatomicalViewTargetRef | null {
    if (event.layout === 'single') {
      const surfaceId = event.surfaceIds[0];
      return surfaceId ? Object.freeze({ kind: 'surface', surfaceId }) : null;
    }
    const [leftSurfaceId, rightSurfaceId] = event.surfaceIds;
    const group = this.viewer.getBilateralSurfaceGroups().find(candidate =>
      candidate.leftSurfaceId === leftSurfaceId && candidate.rightSurfaceId === rightSurfaceId
    );
    return group ? Object.freeze({ kind: 'group', groupId: group.id }) : null;
  }

  private buildInitialSnapshot(): SurfViewControlSnapshot {
    return deepFreeze({
      revision: this.viewer.getStateRevision(),
      view: this.buildView(),
      surfaces: this.buildSurfaces(),
      selection: this.buildSelection(),
      figure: this.buildFigure(),
      capabilities: this.buildCapabilities()
    });
  }

  private buildView(): ViewControlDescriptor {
    const capabilities = this.viewer.getAnatomicalViewCapabilities();
    const targets = [
      ...capabilities.singleSurfaceIds.map(surfaceId => ({
        target: { kind: 'surface' as const, surfaceId },
        label: labelFromId(surfaceId),
        availability: ENABLED
      })),
      ...capabilities.bilateralGroups.map(group => ({
        target: { kind: 'group' as const, groupId: group.id },
        label: `${labelFromId(group.id)} Pair`,
        availability: ENABLED
      }))
    ];
    const hasTargets = targets.length > 0;
    const viewAvailability = hasTargets
      ? ENABLED
      : disabled('Load a surface with explicit hemisphere metadata first.');
    const current = this.currentView && this.isCurrentViewTargetAvailable(this.currentView.target)
      ? this.currentView
      : null;
    if (!current) this.currentView = null;
    return deepFreeze({
      current,
      anatomicalViews: ANATOMICAL_VIEWS.map(view => ({
        id: view,
        label: labelFromId(view),
        availability: viewAvailability
      })),
      targets,
      fit: this.viewer.initializationFailed
        ? disabled('Camera fitting requires an initialized viewer.')
        : ENABLED,
      reset: this.viewer.initializationFailed
        ? disabled('Camera reset requires an initialized viewer.')
        : ENABLED
    });
  }

  private isCurrentViewTargetAvailable(target: AnatomicalViewTargetRef): boolean {
    return target.kind === 'surface'
      ? this.viewer.getSurface(target.surfaceId) !== undefined
      : this.viewer.getBilateralSurfaceGroup(target.groupId) !== null;
  }

  private buildSurfaces(): readonly SurfaceControlDescriptor[] {
    return deepFreeze(
      this.getSurfaceIds()
        .slice()
        .sort((left, right) => left.localeCompare(right))
        .flatMap(surfaceId => {
          const surface = this.viewer.getSurface(surfaceId);
          if (!surface) return [];
          const hemisphere = normalizeAnatomicalHemisphere(surface.hemisphere) ?? 'unknown';
          const group = this.viewer.getBilateralSurfaceGroups().find(candidate =>
            candidate.leftSurfaceId === surfaceId || candidate.rightSurfaceId === surfaceId
          );
          const orderedLayers = this.viewer.getOrderedLayers(surfaceId);
          const layerIds = orderedLayers.map(layer => layer.id);
          const layers = orderedLayers.map((layer, index) => this.buildLayer(
            surfaceId,
            layer,
            index,
            this.buildMoveAvailability(surface, layer, layerIds, index, -1),
            this.buildMoveAvailability(surface, layer, layerIds, index, 1)
          ));
          return [{
            id: surfaceId,
            label: labelFromId(surfaceId),
            hemisphere,
            visible: surface.mesh?.visible ?? false,
            groupId: group?.id ?? null,
            layers
          }];
        })
    );
  }

  private buildLayer(
    surfaceId: string,
    layer: Layer,
    index: number,
    moveUp: CapabilityAvailability,
    moveDown: CapabilityAvailability
  ): LayerControlDescriptor {
    const presentation = layer.getPresentation();
    const constraints = layer.getOrderConstraints();
    const scalarPort = resolveScalarPort(layer);
    const scalarMapping = scalarPort ? this.buildScalarMapping(scalarPort) : undefined;
    const bivariateMapping = this.buildBivariateMapping(layer);
    const temporal = this.buildTemporalControls(layer);
    const parcels = this.buildParcelControls(layer);
    const outline = this.buildOutlineControls(layer, constraints.role);
    const state = readLayerState(layer);
    const baseColor = typeof state.color === 'number' ? state.color : null;
    const colorPreview = scalarPort
      ? colorMapPreview(scalarPort.colorMapName)
      : baseColor !== null
        ? solidPreview(baseColor, presentation.label)
        : outline?.color
          ? Object.freeze({
              kind: 'solid' as const,
              label: `${presentation.label} outline`,
              css: outline.color
            })
          : undefined;
    const metadata = cloneMetadata(presentation);

    return deepFreeze({
      id: layer.id,
      surfaceId,
      label: presentation.label,
      ...(presentation.description !== undefined
        ? { description: presentation.description }
        : {}),
      ...(presentation.units !== undefined ? { units: presentation.units } : {}),
      ...(metadata ? { metadata } : {}),
      index,
      role: constraints.role,
      pinned: constraints.pinned,
      reorderable: constraints.reorderable,
      moveUp,
      moveDown,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      ...(colorPreview ? { colorPreview } : {}),
      ...(scalarMapping ? { scalarMapping } : {}),
      ...(bivariateMapping ? { bivariateMapping } : {}),
      ...(temporal ? { temporal } : {}),
      ...(parcels ? { parcels } : {}),
      ...(outline ? { outline } : {})
    });
  }

  private buildMoveAvailability(
    surface: unknown,
    layer: Layer,
    layerIds: readonly string[],
    index: number,
    offset: -1 | 1
  ): CapabilityAvailability {
    const layerId = layerIds[index];
    const destination = index + offset;
    if (layerId === undefined || destination < 0 || destination >= layerIds.length) {
      return disabled(offset < 0
        ? 'Already first in the displayed layer order.'
        : 'Already last in the displayed layer order.');
    }
    if (!layer.getOrderConstraints().reorderable) {
      return disabled(`Layer "${layerId}" is fixed in the stack.`);
    }
    const validator = surface as Partial<LayerOrderValidationPort>;
    if (typeof validator.validateLayerOrder !== 'function') {
      return disabled('This surface does not support canonical layer reordering.');
    }
    const candidate = [...layerIds];
    [candidate[index], candidate[destination]] = [
      candidate[destination],
      candidate[index]
    ];
    const validation = validator.validateLayerOrder(candidate);
    return validation.ok && validation.changed
      ? ENABLED
      : disabled(validation.message ?? 'This move violates the canonical layer order.');
  }

  private buildScalarMapping(scalar: ResolvedScalarPort): ScalarMappingControls {
    const baseSummary = this.readLayerSummary(scalar.layer);
    const summary = cloneSummary(baseSummary);
    const dataRevision = this.summaryRevisionFor(scalar.layer, baseSummary);
    const presetColorMaps = getColorMapOptions();
    const preset = presetColorMaps.find(option => option.id === scalar.colorMapName);
    const colorMap = preset ?? Object.freeze({
      id: scalar.colorMapName,
      label: labelFromId(scalar.colorMapName),
      availability: ENABLED
    });
    const availableColorMaps = preset
      ? presetColorMaps
      : deepFreeze([colorMap, ...presetColorMaps]);
    return deepFreeze({
      availability: ENABLED,
      dataRevision,
      colorMap,
      availableColorMaps,
      displayRange: rangeDescriptor(scalar.range, summary),
      maskInterval: rangeDescriptor(scalar.threshold, summary),
      ...(summary ? { summary } : {})
    });
  }

  private readLayerSummary(layer: Layer): LayerDataSummary | null {
    try {
      return layer.getDataSummary();
    } catch {
      return null;
    }
  }

  private summaryRevisionFor(
    layer: Layer,
    summary: LayerDataSummary | null
  ): number {
    const previous = this.summaryRevisions.get(layer);
    if (previous?.source === summary) return previous.revision;
    const revision = this.nextSummaryRevision;
    this.nextSummaryRevision += 1;
    this.summaryRevisions.set(layer, { source: summary, revision });
    return revision;
  }

  private buildBivariateMapping(layer: Layer): BivariateMappingControls | undefined {
    try {
      const candidate = layer as BivariateLayerPort;
      if (typeof candidate.getRangeX !== 'function' ||
          typeof candidate.getRangeY !== 'function' ||
          typeof candidate.getColorMapName !== 'function') {
        return undefined;
      }
      const xRange = finiteRange(candidate.getRangeX());
      const yRange = finiteRange(candidate.getRangeY());
      if (!xRange || !yRange) return undefined;
      return deepFreeze({
        availability: disabled('Bivariate editing is deferred beyond controls v0.1.'),
        xRange: rangeDescriptor(xRange),
        yRange: rangeDescriptor(yRange),
        colorMapId: candidate.getColorMapName()
      });
    } catch {
      return undefined;
    }
  }

  private buildTemporalControls(layer: Layer): TemporalControls | undefined {
    const candidate = layer as TemporalLayerPort;
    if (typeof candidate.getTimes !== 'function') return undefined;
    const times = candidate.getTimes().filter(Number.isFinite);
    if (times.length === 0) return undefined;
    const first = times[0];
    const last = times[times.length - 1];
    return deepFreeze({
      availability: disabled('Timeline ownership is not attached to the viewer target.'),
      currentTime: first,
      duration: Math.max(0, last - first),
      playing: false,
      speed: 1
    });
  }

  private buildParcelControls(layer: Layer): ParcelControls | undefined {
    const candidate = layer as ParcelLayerPort;
    if (typeof candidate.getParcelData !== 'function') return undefined;
    try {
      const data = candidate.getParcelData();
      const atlasId = typeof data.atlas?.id === 'string' ? data.atlas.id : undefined;
      const atlasLabel = typeof data.atlas?.name === 'string' ? data.atlas.name : undefined;
      return deepFreeze({
        availability: ENABLED,
        ...(atlasId ? { atlasId } : {}),
        ...(atlasLabel ? { atlasLabel } : {}),
        ...(Array.isArray(data.parcels) ? { parcelCount: data.parcels.length } : {})
      });
    } catch {
      return undefined;
    }
  }

  private buildOutlineControls(
    layer: Layer,
    role: LayerControlDescriptor['role']
  ): OutlineControls | undefined {
    if (role !== 'outline') return undefined;
    const candidate = layer as Layer & { color?: unknown; width?: unknown };
    const color = typeof candidate.color === 'number'
      ? `#${candidate.color.toString(16).padStart(6, '0')}`
      : undefined;
    const width = typeof candidate.width === 'number' && Number.isFinite(candidate.width)
      ? candidate.width
      : undefined;
    return deepFreeze({
      availability: disabled('Outline-specific editing is deferred beyond controls v0.1.'),
      ...(color ? { color } : {}),
      ...(width !== undefined ? { width } : {})
    });
  }

  private buildSelection(): SelectionControlDescriptor {
    const current = this.viewer.getInspectionSelection();
    const vertexIndex = current.kind === 'vertex'
      ? current.vertexIndex
      : current.kind === 'parcel'
        ? current.representativeVertexIndex
        : undefined;
    const inspection = current.kind !== 'none' && vertexIndex !== undefined
      ? this.viewer.inspectVertex(current.surfaceId, vertexIndex)
      : null;
    const surfaceIds = this.getSurfaceIds();
    const hasSurfaces = surfaceIds.length > 0;
    const hasParcels = surfaceIds.some(surfaceId => {
      const surface = this.viewer.getSurface(surfaceId) as {
        getParcelRecord?: (parcelId: number) => unknown;
      } | undefined;
      return typeof surface?.getParcelRecord === 'function';
    });
    return deepFreeze({
      current,
      inspection,
      vertexSelection: hasSurfaces
        ? ENABLED
        : disabled('Load a surface before selecting a vertex.'),
      parcelSelection: hasParcels
        ? ENABLED
        : disabled('Load a parcel-aware surface before selecting a parcel.')
    });
  }

  private buildFigure(): FigureControlDescriptor {
    const presetNames = listStylePresets();
    const currentName = this.viewer.stylePreset?.name ?? this.viewer.config?.preset ?? 'default';
    const currentStyle = this.viewer.stylePreset ?? getStylePreset(currentName);
    const availablePresets = presetNames.map(name => {
      const style = getStylePreset(name);
      return { id: name, label: style.label, availability: ENABLED };
    });
    const preset = availablePresets.find(candidate => candidate.id === currentName) ?? {
      id: currentName,
      label: currentStyle.label,
      availability: ENABLED
    };
    const background = this.viewer.getFigureBackground();
    const exportPNG = this.viewer.initializationFailed
      ? disabled('PNG export requires an initialized browser viewer.')
      : ENABLED;
    return deepFreeze({
      preset,
      availablePresets,
      background: background.color,
      transparent: background.transparent,
      defaultWidth: currentStyle.figure.width,
      defaultHeight: currentStyle.figure.height,
      defaultDpi: currentStyle.figure.dpi,
      defaultTransparent: currentStyle.figure.transparent,
      defaultColorbar: currentStyle.figure.colorbar,
      exportPNG
    });
  }

  private buildCapabilities(): SurfViewControlCapabilities {
    const view = this.viewer.getAnatomicalViewCapabilities();
    const hasViewTarget = view.singleSurfaceIds.length > 0 || view.bilateralGroups.length > 0;
    const surfaceIds = this.getSurfaceIds();
    const layers = surfaceIds
      .flatMap(surfaceId => [...this.viewer.getOrderedLayers(surfaceId)]);
    const hasScalar = layers.some(layer => resolveScalarPort(layer) !== null);
    const hasSurfaces = surfaceIds.length > 0;
    return deepFreeze({
      anatomicalViews: hasViewTarget
        ? ENABLED
        : disabled('No surface has supported hemisphere metadata.'),
      surfaceVisibility: hasSurfaces ? ENABLED : disabled('No surfaces are loaded.'),
      layerVisibility: layers.length > 0 ? ENABLED : disabled('No layers are loaded.'),
      layerOpacity: layers.length > 0 ? ENABLED : disabled('No layers are loaded.'),
      layerBlendMode: layers.length > 0 ? ENABLED : disabled('No layers are loaded.'),
      layerOrder: layers.length > 0 ? ENABLED : disabled('No layer stacks are loaded.'),
      scalarMapping: hasScalar ? ENABLED : disabled('No scalar layer is loaded.'),
      scientificSelection: hasSurfaces
        ? ENABLED
        : disabled('No surfaces are loaded.'),
      figurePresets: this.viewer.initializationFailed
        ? disabled('Figure presets require an initialized viewer.')
        : ENABLED,
      figureBackground: this.viewer.initializationFailed
        ? disabled('Figure background controls require an initialized viewer.')
        : ENABLED,
      exportPNG: this.viewer.initializationFailed
        ? disabled('PNG export requires an initialized browser viewer.')
        : ENABLED
    });
  }

  private getSurfaceIds(): string[] {
    if (this.viewer.initializationFailed) return [];
    try {
      return this.viewer.getSurfaceIds();
    } catch {
      return [];
    }
  }

  private notify(snapshot: SurfViewControlSnapshot): void {
    for (const subscription of [...this.subscriptions]) {
      try {
        subscription.deliver(snapshot);
      } catch (error) {
        console.error('surfview: ViewerControlTarget subscriber failed', error);
      }
    }
  }
}

export function createViewerControlTarget(
  viewer: NeuroSurfaceViewer,
  options: ViewerControlTargetOptions = {}
): ViewerControlTarget {
  return new ViewerControlTarget(viewer, options);
}
