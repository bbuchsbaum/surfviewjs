import { ANATOMICAL_VIEWS } from '../AnatomicalView';
import type { AnatomicalView } from '../AnatomicalView';
import {
  createSurfViewControlSession
} from '../controls/ControlSession';
import type {
  SurfViewControlSession,
  SurfViewControlSessionOptions,
  SurfViewControlSessionSnapshot
} from '../controls/ControlSession';
import type {
  ControlCommandResult,
  ControlJsonObject,
  FigureExportResult,
  LayerControlDescriptor,
  SurfViewControlSubscription,
  SurfViewControlTarget
} from '../controls/ControlTarget';
import { installReportStyles } from './reportStyles';

const VIEW_LABELS: Record<AnatomicalView, string> = {
  lateral: 'Lateral',
  medial: 'Medial',
  dorsal: 'Dorsal',
  ventral: 'Ventral',
  anterior: 'Anterior',
  posterior: 'Posterior'
};

let nextControlsId = 1;

/**
 * Colour-bar length assumed when dropping colliding tick labels (the default
 * `--surfview-report-colorbar-width`, CSS px) and the 10px tick font's metrics.
 */
const COLORBAR_LABEL_WIDTH = 160;
const TICK_CHAR_WIDTH = 5.6;
const TICK_LABEL_GAP = 6;

/** Compact tick label: three significant figures and a typographic minus. */
function formatTick(value: number): string {
  const rounded = Number(value.toPrecision(3));
  return String(Object.is(rounded, -0) ? 0 : rounded).replace(/-/g, '\u2212');
}

/** A CSS percentage of `fraction`, rounded so float noise never reaches the DOM. */
function percent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(4))}%`;
}

function opacityText(opacity: number): string {
  return `${Math.round(Math.max(0, Math.min(1, opacity)) * 100)}%`;
}

export interface ReportControlsOptions {
  /** State local to this compact control surface. */
  readonly session?: SurfViewControlSessionOptions;
  /** Suggested PNG filename. */
  readonly filename?: string;
  /** Receives a successful export. Defaults to downloading it in the owner document. */
  readonly onExport?: (result: FigureExportResult) => void;
  /**
   * Add the default stylesheet (`REPORT_STYLES`) to the document. Default
   * true. Its rules have zero specificity, so host CSS overrides them without
   * `!important`; pass false when the page supplies its own styles.
   */
  readonly styles?: boolean;
}

function metadataObject(
  metadata: ControlJsonObject | undefined,
  key: string
): ControlJsonObject | undefined {
  const value = metadata?.[key];
  return value && !Array.isArray(value) && typeof value === 'object'
    ? value as ControlJsonObject
    : undefined;
}

function findLayer(
  snapshot: SurfViewControlSessionSnapshot,
  layerId: string
): LayerControlDescriptor | null {
  for (const surface of snapshot.canonical.surfaces) {
    const layer = surface.layers.find(candidate => candidate.id === layerId);
    if (layer) return layer;
  }
  return null;
}

interface ColorbarTick {
  readonly value: number;
  readonly position: number;
  readonly label: string;
}

/**
 * Ticks at both limits and at the threshold endpoints inside them. A label
 * that would collide with one already placed is dropped (limits win).
 */
function colorbarTicks(
  range: readonly [number, number],
  threshold: readonly [number, number] | null
): ColorbarTick[] {
  const [low, high] = range;
  const span = high - low;
  const values = [low, high];
  if (threshold) {
    for (const value of threshold) {
      if (value > low && value < high) values.push(value);
    }
  }
  const placed: ColorbarTick[] = [];
  for (const value of values) {
    if (placed.some(tick => tick.value === value)) continue;
    const label = formatTick(value);
    const position = (value - low) / span;
    const collides = placed.some(tick => {
      const separation = Math.abs(tick.position - position) * COLORBAR_LABEL_WIDTH;
      return separation < ((tick.label.length + label.length) / 2) * TICK_CHAR_WIDTH + TICK_LABEL_GAP;
    });
    if (!collides) placed.push({ value, position, label });
  }
  return placed.sort((left, right) => left.position - right.position);
}

/**
 * Compact, dependency-light report controls over one panel-local session.
 *
 * The session is owned by this instance; the target remains caller-owned. The
 * ordinary native controls provide their own keyboard model, so this element
 * deliberately does not claim `role="toolbar"`.
 *
 * Presentation comes from class names (`surfview-report-*`) and the
 * zero-specificity default stylesheet `REPORT_STYLES`, themed by
 * `--surfview-report-*` custom properties, so hosts can restyle it without
 * `!important`. No styles are set inline except the colour bar's data-driven
 * gradient and band positions.
 */
export class ReportControls {
  readonly element: HTMLElement;
  readonly session: SurfViewControlSession;

  private readonly events = new AbortController();
  private readonly subscription: SurfViewControlSubscription;
  private readonly select: HTMLSelectElement;
  private readonly legend: HTMLDivElement;
  private readonly legendTitle: HTMLSpanElement;
  private readonly colorbar: HTMLSpanElement;
  private readonly colorbarRamp: HTMLSpanElement;
  private readonly colorbarMask: HTMLSpanElement;
  private readonly legendSummary: HTMLSpanElement;
  private readonly referenceGroup: HTMLFieldSetElement;
  private readonly referenceToggle: HTMLInputElement;
  private readonly referenceOpacity: HTMLInputElement;
  private readonly referenceOpacityValue: HTMLOutputElement;
  private readonly referenceName: HTMLSpanElement;
  private readonly referenceSwatch: HTMLSpanElement;
  private readonly feedback: HTMLSpanElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly viewInputs = new Map<AnatomicalView, HTMLInputElement>();
  private readonly onExport: (result: FigureExportResult) => void;
  private optionSignature = '';
  private colorbarSignature = '';
  private disposed = false;

  constructor(
    target: SurfViewControlTarget,
    options: ReportControlsOptions = {}
  ) {
    const doc = document;
    if (options.styles !== false) installReportStyles(doc);
    const instanceId = nextControlsId;
    nextControlsId += 1;

    this.element = doc.createElement('section');
    this.element.className = 'surfview-report-controls';
    this.element.setAttribute('aria-label', 'Surface report controls');

    const mapLabel = doc.createElement('label');
    mapLabel.className = 'surfview-report-map';
    mapLabel.textContent = 'Map ';
    this.select = doc.createElement('select');
    this.select.className = 'surfview-report-map-select';
    this.select.setAttribute('aria-label', 'Displayed surface map');
    this.select.addEventListener('change', () => {
      this.reportResult(this.session.setDisplayedLayer(this.select.value));
    }, { signal: this.events.signal });
    mapLabel.appendChild(this.select);
    this.element.appendChild(mapLabel);

    this.referenceGroup = doc.createElement('fieldset');
    this.referenceGroup.className = 'surfview-report-reference';
    const referenceLegend = doc.createElement('legend');
    referenceLegend.textContent = 'Anatomical reference';
    this.referenceGroup.appendChild(referenceLegend);
    const referenceLabel = doc.createElement('label');
    referenceLabel.className = 'surfview-report-reference-toggle';
    this.referenceToggle = doc.createElement('input');
    this.referenceToggle.type = 'checkbox';
    this.referenceName = doc.createElement('span');
    this.referenceName.className = 'surfview-report-reference-name';
    this.referenceSwatch = doc.createElement('span');
    this.referenceSwatch.className = 'surfview-report-swatch';
    this.referenceSwatch.setAttribute('aria-hidden', 'true');
    referenceLabel.append(this.referenceToggle, this.referenceSwatch, this.referenceName);
    const opacityId = `surfview-report-opacity-${instanceId}`;
    // The readout sits beside the label, so the slider's name stays
    // "Reference opacity"; aria-valuetext carries the percentage.
    const opacityGroup = doc.createElement('span');
    opacityGroup.className = 'surfview-report-opacity';
    const opacityLabel = doc.createElement('label');
    opacityLabel.textContent = 'Reference opacity ';
    this.referenceOpacity = doc.createElement('input');
    this.referenceOpacity.className = 'surfview-report-opacity-slider';
    this.referenceOpacity.id = opacityId;
    this.referenceOpacity.type = 'range';
    this.referenceOpacity.min = '0';
    this.referenceOpacity.max = '1';
    this.referenceOpacity.step = '0.05';
    this.referenceOpacityValue = doc.createElement('output');
    this.referenceOpacityValue.className = 'surfview-report-opacity-value';
    this.referenceOpacityValue.htmlFor.add(opacityId);
    opacityLabel.appendChild(this.referenceOpacity);
    opacityGroup.append(opacityLabel, this.referenceOpacityValue);
    this.referenceToggle.addEventListener('change', () => {
      const reference = this.session.getSnapshot().canonical.capabilities.referenceLayers?.layers[0];
      if (reference) this.reportResult(this.session.setLayerVisibility(reference.address, this.referenceToggle.checked));
    }, { signal: this.events.signal });
    this.referenceOpacity.addEventListener('input', () => {
      const opacity = Number(this.referenceOpacity.value);
      this.showOpacity(opacity);
      const reference = this.session.getSnapshot().canonical.capabilities.referenceLayers?.layers[0];
      if (reference) this.reportResult(this.session.setLayerOpacity(reference.address, opacity));
    }, { signal: this.events.signal });
    this.referenceGroup.append(referenceLabel, opacityGroup);

    const viewGroup = doc.createElement('fieldset');
    viewGroup.className = 'surfview-report-views';
    const viewLegend = doc.createElement('legend');
    viewLegend.textContent = 'Anatomical view';
    viewGroup.appendChild(viewLegend);
    const viewGroupName = `surfview-report-view-${instanceId}`;

    for (const view of ANATOMICAL_VIEWS) {
      const label = doc.createElement('label');
      label.className = 'surfview-report-view';
      const input = doc.createElement('input');
      input.type = 'radio';
      input.name = viewGroupName;
      input.value = view;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const targetDescriptor = this.session.getSnapshot().canonical.view.targets[0];
        if (!targetDescriptor) return;
        this.reportResult(this.session.setAnatomicalView({
          view,
          target: targetDescriptor.target,
          fit: true
        }));
      }, { signal: this.events.signal });
      label.append(input, doc.createTextNode(VIEW_LABELS[view]));
      viewGroup.appendChild(label);
      this.viewInputs.set(view, input);
    }
    this.element.appendChild(viewGroup);
    this.element.appendChild(this.referenceGroup);

    this.resetButton = doc.createElement('button');
    this.resetButton.className = 'surfview-report-button surfview-report-reset';
    this.resetButton.type = 'button';
    this.resetButton.textContent = 'Reset';
    this.resetButton.addEventListener('click', () => {
      this.reportResult(this.session.resetView());
    }, { signal: this.events.signal });
    this.element.appendChild(this.resetButton);

    this.exportButton = doc.createElement('button');
    this.exportButton.className = 'surfview-report-button surfview-report-export';
    this.exportButton.type = 'button';
    this.exportButton.textContent = 'PNG';
    this.exportButton.setAttribute('aria-label', 'Export surface view as PNG');
    this.exportButton.addEventListener('click', () => {
      void this.exportPNG();
    }, { signal: this.events.signal });
    this.element.appendChild(this.exportButton);

    // Colour key: a visible title and gradient bar (hidden from assistive
    // technology) plus a text summary that is announced when the map changes.
    this.legend = doc.createElement('div');
    this.legend.className = 'surfview-report-legend';
    this.legendTitle = doc.createElement('span');
    this.legendTitle.className = 'surfview-report-legend-title';
    this.legendTitle.setAttribute('aria-hidden', 'true');
    this.colorbar = doc.createElement('span');
    this.colorbar.className = 'surfview-report-colorbar';
    this.colorbar.setAttribute('aria-hidden', 'true');
    this.colorbarRamp = doc.createElement('span');
    this.colorbarRamp.className = 'surfview-report-colorbar-ramp';
    this.colorbarMask = doc.createElement('span');
    this.colorbarMask.className = 'surfview-report-colorbar-mask';
    this.colorbarRamp.appendChild(this.colorbarMask);
    this.colorbar.appendChild(this.colorbarRamp);
    this.legendSummary = doc.createElement('span');
    this.legendSummary.className = 'surfview-report-sr';
    this.legendSummary.setAttribute('aria-live', 'polite');
    this.legend.append(this.legendTitle, this.colorbar, this.legendSummary);
    this.element.appendChild(this.legend);

    this.feedback = doc.createElement('span');
    this.feedback.className = 'surfview-report-feedback';
    this.feedback.setAttribute('aria-live', 'polite');
    this.element.appendChild(this.feedback);

    this.onExport = options.onExport ?? (result => {
      const anchor = this.element.ownerDocument.createElement('a');
      anchor.href = result.dataUrl;
      anchor.download = result.filename ?? options.filename ?? 'surfview.png';
      anchor.click();
    });
    this.session = createSurfViewControlSession(target, options.session);
    try {
      this.subscription = this.session.subscribe(snapshot => this.render(snapshot));
    } catch (error) {
      this.events.abort();
      this.session.dispose();
      throw error;
    }
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.events.abort();
    this.subscription.unsubscribe();
    this.session.dispose();
    this.element.remove();
  }

  private render(snapshot: SurfViewControlSessionSnapshot): void {
    if (this.disposed) return;
    const { canonical } = snapshot;
    const exclusiveMap = canonical.capabilities.exclusiveMap;
    const availableLayerIds = exclusiveMap?.availableLayerIds ?? [];
    const optionSignature = availableLayerIds.map(layerId => {
      const layer = findLayer(snapshot, layerId);
      return `${layerId}\u0000${layer?.label ?? layerId}`;
    }).join('\u0001');
    if (optionSignature !== this.optionSignature) {
      this.optionSignature = optionSignature;
      this.select.replaceChildren(...availableLayerIds.map(layerId => {
        const option = document.createElement('option');
        option.value = layerId;
        option.textContent = findLayer(snapshot, layerId)?.label ?? layerId;
        return option;
      }));
    }
    this.select.disabled = !exclusiveMap?.availability.enabled;
    this.select.value = exclusiveMap?.displayedLayerId ?? '';
    const reference = canonical.capabilities.referenceLayers?.layers[0];
    this.referenceGroup.hidden = !reference;
    if (reference) {
      this.referenceName.textContent = reference.label;
      this.referenceSwatch.style.backgroundColor = reference.color;
      this.referenceToggle.checked = reference.visible;
      this.referenceOpacity.value = String(reference.opacity);
      this.showOpacity(reference.opacity);
      this.referenceToggle.disabled = !canonical.capabilities.referenceLayers?.availability.enabled;
      this.referenceOpacity.disabled = this.referenceToggle.disabled;
    }

    const viewAvailability = new Map(
      canonical.view.anatomicalViews.map(view => [view.id, view.availability])
    );
    for (const [view, input] of this.viewInputs) {
      input.checked = canonical.view.current?.view === view;
      input.disabled = viewAvailability.get(view)?.enabled !== true ||
        canonical.view.targets.length === 0;
    }
    this.resetButton.disabled = !canonical.view.reset.enabled;
    this.exportButton.disabled = !canonical.figure.exportPNG.enabled;
    this.renderLegend(snapshot, exclusiveMap?.displayedLayerId ?? null);
  }

  private showOpacity(opacity: number): void {
    const text = opacityText(opacity);
    this.referenceOpacityValue.value = text;
    this.referenceOpacityValue.textContent = text;
    this.referenceOpacity.setAttribute('aria-valuetext', text);
  }

  private renderLegend(
    snapshot: SurfViewControlSessionSnapshot,
    layerId: string | null
  ): void {
    const layer = layerId ? findLayer(snapshot, layerId) : null;
    if (!layer) {
      this.legendSummary.textContent = '';
      this.legend.hidden = true;
      return;
    }
    const legend = metadataObject(layer.metadata, 'legend');
    const mapping = layer.scalarMapping;
    const preview = layer.colorPreview?.kind === 'colormap' ? layer.colorPreview : undefined;
    const range = preview?.range ?? mapping?.displayRange.value;
    const mask = mapping?.maskInterval.value;
    const threshold = mask && mask[1] > mask[0] ? mask : null;
    const units = layer.units ? ` ${layer.units}` : '';

    this.legendTitle.textContent = layer.units ? `${layer.label} (${layer.units})` : layer.label;
    let summary = range
      ? `${layer.label}: ${range[0]} to ${range[1]}${units}`
      : `${layer.label}${units}`;
    if (range && threshold) {
      summary += `; values from ${threshold[0]} to ${threshold[1]} are not shown`;
    }
    this.legendSummary.textContent = summary;
    this.renderColorbar(preview?.stops, preview?.css, range, threshold);
    this.legend.hidden = legend?.visible === false;
  }

  private renderColorbar(
    stops: readonly string[] | undefined,
    css: string | undefined,
    range: readonly [number, number] | undefined,
    threshold: readonly [number, number] | null
  ): void {
    const gradient = stops && stops.length >= 2
      ? `linear-gradient(90deg, ${stops.join(', ')})`
      : css;
    const usable = Boolean(gradient && range && range[1] > range[0]);
    const signature = usable
      ? `${gradient}\u0000${range!.join(',')}\u0000${threshold?.join(',') ?? ''}`
      : '';
    if (signature === this.colorbarSignature) return;
    this.colorbarSignature = signature;
    this.colorbar.hidden = !usable;
    if (!usable) return;

    const [low, high] = range!;
    this.colorbarRamp.style.background = gradient!;
    // The masked interval, clipped to the bar: values there are not drawn.
    const bandLow = threshold ? Math.max(low, threshold[0]) : 0;
    const bandHigh = threshold ? Math.min(high, threshold[1]) : 0;
    const hasBand = Boolean(threshold) && bandHigh > bandLow;
    this.colorbarMask.hidden = !hasBand;
    if (hasBand) {
      this.colorbarMask.style.left = percent((bandLow - low) / (high - low));
      this.colorbarMask.style.width = percent((bandHigh - bandLow) / (high - low));
    }

    const ticks = colorbarTicks(range!, threshold);
    this.colorbar.replaceChildren(this.colorbarRamp, ...ticks.map(tick => {
      const element = document.createElement('span');
      element.className = 'surfview-report-colorbar-tick';
      if (tick.position === 0) element.classList.add('is-start');
      if (tick.position === 1) element.classList.add('is-end');
      element.style.left = percent(tick.position);
      element.textContent = tick.label;
      return element;
    }));
  }

  private reportResult(result: ControlCommandResult): void {
    this.feedback.textContent = result.ok ? '' : result.message;
    if (!result.ok) this.render(this.session.getSnapshot());
  }

  private async exportPNG(): Promise<void> {
    // Download presentation remains local to this compact surface. Omitting a
    // target filename prevents NeuroSurfaceViewer from also downloading it.
    try {
      const result = await this.session.exportFigure();
      if (this.disposed) return;
      this.reportResult(result);
      if (result.ok) this.onExport(result.value);
    } catch (error) {
      if (this.disposed) return;
      this.feedback.textContent = error instanceof Error
        ? error.message
        : 'PNG export failed.';
    }
  }
}
