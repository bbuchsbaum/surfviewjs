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

const VIEW_LABELS: Record<AnatomicalView, string> = {
  lateral: 'Lateral',
  medial: 'Medial',
  dorsal: 'Dorsal',
  ventral: 'Ventral',
  anterior: 'Anterior',
  posterior: 'Posterior'
};

let nextViewGroupId = 1;

export interface ReportControlsOptions {
  /** State local to this compact control surface. */
  readonly session?: SurfViewControlSessionOptions;
  /** Suggested PNG filename. */
  readonly filename?: string;
  /** Receives a successful export. Defaults to downloading it in the owner document. */
  readonly onExport?: (result: FigureExportResult) => void;
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

/**
 * Compact, dependency-light report controls over one panel-local session.
 *
 * The session is owned by this instance; the target remains caller-owned. The
 * ordinary native controls provide their own keyboard model, so this element
 * deliberately does not claim `role="toolbar"`.
 */
export class ReportControls {
  readonly element: HTMLElement;
  readonly session: SurfViewControlSession;

  private readonly events = new AbortController();
  private readonly subscription: SurfViewControlSubscription;
  private readonly select: HTMLSelectElement;
  private readonly legend: HTMLSpanElement;
  private readonly referenceGroup: HTMLFieldSetElement;
  private readonly referenceToggle: HTMLInputElement;
  private readonly referenceOpacity: HTMLInputElement;
  private readonly referenceName: HTMLSpanElement;
  private readonly referenceSwatch: HTMLSpanElement;
  private readonly feedback: HTMLSpanElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly viewInputs = new Map<AnatomicalView, HTMLInputElement>();
  private readonly onExport: (result: FigureExportResult) => void;
  private optionSignature = '';
  private disposed = false;

  constructor(
    target: SurfViewControlTarget,
    options: ReportControlsOptions = {}
  ) {
    this.element = document.createElement('section');
    this.element.className = 'surfview-report-controls';
    this.element.setAttribute('aria-label', 'Surface report controls');
    Object.assign(this.element.style, {
      alignItems: 'center',
      background: '#f8fafc',
      border: '1px solid #d7dde5',
      borderRadius: '6px',
      color: '#111827',
      display: 'flex',
      flexWrap: 'wrap',
      font: '12px/1.4 system-ui, sans-serif',
      gap: '6px',
      marginBottom: '8px',
      padding: '7px'
    });

    const mapLabel = document.createElement('label');
    mapLabel.textContent = 'Map ';
    this.select = document.createElement('select');
    this.select.setAttribute('aria-label', 'Displayed surface map');
    this.select.addEventListener('change', () => {
      this.reportResult(this.session.setDisplayedLayer(this.select.value));
    }, { signal: this.events.signal });
    mapLabel.appendChild(this.select);
    this.element.appendChild(mapLabel);

    this.referenceGroup = document.createElement('fieldset');
    Object.assign(this.referenceGroup.style, { border: '0', margin: '0', padding: '0', display: 'flex', alignItems: 'center', gap: '6px' });
    const referenceLegend = document.createElement('legend');
    referenceLegend.textContent = 'Anatomical reference';
    this.referenceGroup.appendChild(referenceLegend);
    const referenceLabel = document.createElement('label');
    this.referenceToggle = document.createElement('input');
    this.referenceToggle.type = 'checkbox';
    this.referenceName = document.createElement('span');
    this.referenceSwatch = document.createElement('span');
    this.referenceSwatch.setAttribute('aria-hidden', 'true');
    Object.assign(this.referenceSwatch.style, { display: 'inline-block', width: '12px', height: '12px', border: '1px solid currentColor', marginInline: '4px' });
    referenceLabel.append(this.referenceToggle, this.referenceSwatch, this.referenceName);
    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Reference opacity ';
    this.referenceOpacity = document.createElement('input');
    this.referenceOpacity.type = 'range';
    this.referenceOpacity.min = '0';
    this.referenceOpacity.max = '1';
    this.referenceOpacity.step = '0.05';
    this.referenceOpacity.style.width = '90px';
    opacityLabel.appendChild(this.referenceOpacity);
    this.referenceToggle.addEventListener('change', () => {
      const reference = this.session.getSnapshot().canonical.capabilities.referenceLayers?.layers[0];
      if (reference) this.reportResult(this.session.setLayerVisibility(reference.address, this.referenceToggle.checked));
    }, { signal: this.events.signal });
    this.referenceOpacity.addEventListener('input', () => {
      const reference = this.session.getSnapshot().canonical.capabilities.referenceLayers?.layers[0];
      if (reference) this.reportResult(this.session.setLayerOpacity(reference.address, Number(this.referenceOpacity.value)));
    }, { signal: this.events.signal });
    this.referenceGroup.append(referenceLabel, opacityLabel);


    const viewGroup = document.createElement('fieldset');
    Object.assign(viewGroup.style, {
      alignItems: 'center',
      border: '0',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px',
      margin: '0',
      padding: '0'
    });
    const viewLegend = document.createElement('legend');
    viewLegend.textContent = 'Anatomical view';
    viewLegend.style.cssFloat = 'left';
    viewLegend.style.marginRight = '2px';
    viewGroup.appendChild(viewLegend);
    const viewGroupName = `surfview-report-view-${nextViewGroupId}`;
    nextViewGroupId += 1;

    for (const view of ANATOMICAL_VIEWS) {
      const label = document.createElement('label');
      label.style.whiteSpace = 'nowrap';
      const input = document.createElement('input');
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
      label.append(input, document.createTextNode(VIEW_LABELS[view]));
      viewGroup.appendChild(label);
      this.viewInputs.set(view, input);
    }
    this.element.appendChild(viewGroup);
    this.element.appendChild(this.referenceGroup);

    this.resetButton = document.createElement('button');
    this.resetButton.type = 'button';
    this.resetButton.textContent = 'Reset';
    this.resetButton.addEventListener('click', () => {
      this.reportResult(this.session.resetView());
    }, { signal: this.events.signal });
    this.element.appendChild(this.resetButton);

    this.exportButton = document.createElement('button');
    this.exportButton.type = 'button';
    this.exportButton.textContent = 'PNG';
    this.exportButton.setAttribute('aria-label', 'Export surface view as PNG');
    this.exportButton.addEventListener('click', () => {
      void this.exportPNG();
    }, { signal: this.events.signal });
    this.element.appendChild(this.exportButton);

    this.legend = document.createElement('span');
    this.legend.setAttribute('aria-live', 'polite');
    this.legend.style.marginLeft = 'auto';
    this.element.appendChild(this.legend);

    this.feedback = document.createElement('span');
    this.feedback.setAttribute('aria-live', 'polite');
    this.feedback.style.color = '#991b1b';
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
    // A hidden fieldset must not retain its inline display:flex.
    this.referenceGroup.style.display = reference ? 'flex' : 'none';
    if (reference) {
      this.referenceName.textContent = reference.label;
      this.referenceSwatch.style.backgroundColor = reference.color;
      this.referenceToggle.checked = reference.visible;
      this.referenceOpacity.value = String(reference.opacity);
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

  private renderLegend(
    snapshot: SurfViewControlSessionSnapshot,
    layerId: string | null
  ): void {
    const layer = layerId ? findLayer(snapshot, layerId) : null;
    if (!layer) {
      this.legend.textContent = '';
      this.legend.hidden = true;
      return;
    }
    const legend = metadataObject(layer.metadata, 'legend');
    const range = layer.scalarMapping?.displayRange.value;
    const units = layer.units ? ` ${layer.units}` : '';
    this.legend.textContent = range
      ? `${layer.label}: ${range[0]} to ${range[1]}${units}`
      : `${layer.label}${units}`;
    this.legend.hidden = legend?.visible === false;
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
