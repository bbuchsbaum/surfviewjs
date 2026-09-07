import { finiteNumber } from '../utils/validation';
import type { AtlasPlate, AtlasPlateLabel, AtlasPoint } from './types';
import { atlasDisplayLabels, atlasViewportBounds, emptyAtlasLayout, parseAtlasPlateLayout } from './atlasLayout';
import type { AtlasPlateLayout, AtlasPlatePresentation, AtlasViewport } from './atlasLayout';

export interface AtlasPlateStyle {
  /** Omitted IDs use defaultColor. Colors are #RGB or #RRGGBB. */
  colors?: ReadonlyMap<number, string>;
  defaultColor?: string;
  background?: string;
  dashed?: boolean;
  /** Parcel boundaries; all widths are in SVG units. */
  boundaryColor?: string;
  boundaryWidth?: number;
  boundaryOpacity?: number;
  /** Optional background-colored band under borders; default 0 (no halo). */
  boundaryHaloWidth?: number;
  /** Extra emphasis for boundaries between parcelGroups; 0 disables it. */
  groupBoundaryWidth?: number;
  outlineWidth?: number;
  labelsVisible?: boolean;
  selectedParcelId?: number | null;
}

export interface AtlasPlateViewOptions extends AtlasPlateStyle {
  onParcelClick?: (parcelId: number) => void;
  editableLabels?: boolean;
  adaptiveLabels?: boolean;
  /** Minimum label size in CSS pixels while zoomed (default 12; 0 disables).
   * Density adapts to available space; the unzoomed composition stays fixed. */
  minInspectionFontSize?: number;
  onLayoutChange?: (layout: AtlasPlateLayout) => void;
  onViewportChange?: (viewport: AtlasViewport) => void;
  onInteractionError?: (error: Error) => void;
}

function escapeXML(value: string): string {
  return value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function color(value: string): string {
  if (!/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value)) throw new TypeError('Atlas colors must use #RGB or #RRGGBB');
  return value.length === 4 ? '#' + [...value.slice(1)].map(c => c + c).join('') : value;
}

function isDark(fill: string): boolean {
  const rgb = [1, 3, 5].map(i => {
    const v = parseInt(fill.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722 < 0.24;
}

function leader(label: AtlasPlateLabel, zoom: number): string {
  if (!label.callout) return '';
  const { x, y, anchor: a } = label;
  const vertical = label.calloutSide ? ['top', 'bottom'].includes(label.calloutSide) : Math.abs(y - a.y) > Math.abs(x - a.x);
  const endX = vertical ? x : x + (a.x < x ? -1 : 1) * (label.width / 2 + 3);
  const endY = vertical ? y + (a.y < y ? -1 : 1) * (label.height / 2 + 2) : y;
  // A short straight stem near the text, then one diagonal to the parcel.
  // Ordered anchors/labels on each margin avoid the old overlapping L routes.
  const elbowX = vertical ? endX : endX + (a.x < x ? -1 : 1) * Math.min(9, Math.abs(endX - a.x) / 2);
  const elbowY = vertical ? endY + (a.y < y ? -1 : 1) * Math.min(9, Math.abs(endY - a.y) / 2) : endY;
  return `<path d="M${a.x},${a.y}L${elbowX},${elbowY}L${endX},${endY}"/><circle cx="${a.x}" cy="${a.y}" r="${1.1 / zoom}" fill="#77716b" stroke="none"/>`;
}

/** Standalone vector output: editable paths/text, no embedded raster or scripts. */
export function renderAtlasPlateSVG(plate: AtlasPlate, style: AtlasPlateStyle = {}, presentation: AtlasPlatePresentation = {}): string {
  const bounds = atlasViewportBounds(plate, presentation.viewport);
  const zoom = plate.width / bounds.width;
  const displayedLabels = atlasDisplayLabels(plate, presentation);
  const labelScale = Math.min(zoom, presentation.labelScale ?? 1);
  const displayedIds = new Set((style.labelsVisible ?? true) ? displayedLabels.map(p => p.id) : []);
  const defaultColor = color(style.defaultColor ?? '#fffdf9');
  const background = color(style.background ?? '#ffffff');
  const boundaryColor = color(style.boundaryColor ?? '#514c47');
  const width = (value: number | undefined, fallback: number, name: string): number =>
    finiteNumber(value ?? fallback, name, { minimum: 0, maximum: 20 });
  const boundaryWidth = width(style.boundaryWidth, 0.65, 'boundaryWidth');
  const haloWidth = width(style.boundaryHaloWidth, 0, 'boundaryHaloWidth');
  const groupWidth = width(style.groupBoundaryWidth, 1.15, 'groupBoundaryWidth');
  const outlineWidth = width(style.outlineWidth, 1.65, 'outlineWidth');
  const opacity = finiteNumber(style.boundaryOpacity ?? 0.55, 'boundaryOpacity', { minimum: 0, maximum: 1 });
  const fills = new Map(plate.regions.map(p => [p.id, color(style.colors?.get(p.id) ?? defaultColor)]));
  const title = `${plate.atlasName} · ${plate.hemisphere} ${plate.view}`;
  const description = 'Inflated cortical atlas. Parcel fills, contours, and labels are independent. ' +
    `${(style.labelsVisible ?? true) ? displayedLabels.length : 0} displayed labels. ` +
    'Fixed orthographic RAS projection; contours are sampled at the recorded resolution.';
  const metadata = JSON.stringify({ atlasId: plate.atlasId, hemisphere: plate.hemisphere, view: plate.view,
    provenance: plate.provenance,
    resolution: plate.resolution, contourSmoothing: plate.contourSmoothing,
    layout: presentation.layout ?? emptyAtlasLayout(plate), viewport: bounds, labelScale,
    displayedLabelIds: [...displayedIds],
    parcelGroups: Object.fromEntries(plate.regions.filter(p => p.group !== undefined).map(p => [p.id, p.group])),
    unlabeledParcelIds: plate.regions.filter(p => !displayedIds.has(p.id)).map(p => p.id),
    overviewUnlabeledParcelIds: plate.unlabeledParcelIds, hiddenParcelIds: plate.hiddenParcelIds });
  const regions = plate.regions.map(p =>
    `<g data-parcel-id="${p.id}" role="button" tabindex="0" aria-label="${escapeXML(p.label)}" aria-pressed="${p.id === style.selectedParcelId}">` +
    `<title>${escapeXML(p.label)}</title><path d="${escapeXML(p.path)}" fill="${fills.get(p.id)}" fill-rule="evenodd"/></g>`).join('');
  const selection = plate.regions.find(p => p.id === style.selectedParcelId);
  const names = new Map(plate.regions.map(p => [p.id, p.label]));
  const labels = (style.labelsVisible ?? true) ? displayedLabels.map(label => {
    const fill = label.callout ? background : fills.get(label.id)!;
    return `<g><title>${escapeXML(names.get(label.id)!)}</title><text data-parcel-id="${label.id}" x="${label.x}" y="${label.y}" ` +
      `fill="${isDark(fill) ? '#ffffff' : '#292522'}" stroke="${fill}" stroke-width="${2.6 / zoom}" ` +
      `data-pinned="${presentation.layout?.labels.some(p => p.id === label.id) ?? false}" ` +
      `font-weight="${label.id === style.selectedParcelId ? '700' : '400'}">${escapeXML(label.text)}</text></g>`;
  }).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${plate.width}" height="${plate.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="group" aria-label="${escapeXML(title)}">` +
    `<title>${escapeXML(title)}</title><desc>${escapeXML(description)}</desc><metadata>${escapeXML(metadata)}</metadata>` +
    `<rect width="${plate.width}" height="${plate.height}" fill="${background}"/>` +
    `<g class="atlas-regions">${regions}</g>` +
    `<g pointer-events="none" fill="none" stroke-linejoin="round" stroke-linecap="round">` +
    (haloWidth ? `<path class="atlas-boundary-halo" d="${escapeXML(plate.boundaryPath)}" stroke="${background}" stroke-width="${haloWidth / zoom}"/>` : '') +
    `<path class="atlas-boundaries" d="${escapeXML(plate.boundaryPath)}" stroke="${boundaryColor}" stroke-width="${boundaryWidth / zoom}" stroke-opacity="${opacity}"${style.dashed ? ` stroke-dasharray="${4 / zoom} ${3 / zoom}"` : ''}/>` +
    (groupWidth && plate.groupBoundaryPath ? `<path class="atlas-group-boundaries" d="${escapeXML(plate.groupBoundaryPath)}" stroke="${boundaryColor}" stroke-width="${groupWidth / zoom}" stroke-opacity="0.85"/>` : '') +
    `<path class="atlas-silhouette" d="${escapeXML(plate.silhouettePath)}" stroke="#38332e" stroke-width="${outlineWidth / zoom}"/>` +
    (selection ? `<path d="${escapeXML(selection.path)}" stroke="#ffffff" stroke-width="${5 / zoom}"/><path d="${escapeXML(selection.path)}" stroke="#202020" stroke-width="${2.5 / zoom}"/>` : '') +
    `</g><g class="atlas-leaders" pointer-events="none" fill="none" stroke="#8c847b" stroke-width="${0.65 / zoom}" stroke-linecap="round">` +
    ((style.labelsVisible ?? true) ? displayedLabels.map(label => leader(label, zoom)).join('') : '') +
    `</g><g class="atlas-labels" font-family="Arial, Helvetica, sans-serif" font-size="${plate.fontSize * labelScale / zoom}" text-anchor="middle" dominant-baseline="central" paint-order="stroke fill" stroke-linejoin="round">${labels}</g></svg>`;
}

/** Mount one plate with parcel selection, independent recoloring, and exports. */
export class AtlasPlateView {
  readonly element: HTMLDivElement;
  private plate: AtlasPlate | null;
  private style: AtlasPlateStyle;
  private onParcelClick: ((parcelId: number) => void) | undefined;
  private layout: AtlasPlateLayout;
  private viewport: AtlasViewport;
  private editableLabels: boolean;
  private adaptiveLabels: boolean;
  private minInspectionFontSize: number;
  private resizeObserver: ResizeObserver | undefined;
  private onLayoutChange: AtlasPlateViewOptions['onLayoutChange'];
  private onViewportChange: AtlasPlateViewOptions['onViewportChange'];
  private onInteractionError: AtlasPlateViewOptions['onInteractionError'];
  private drag: { pointer: number; id: number | null; selectedId: number | null; start: AtlasPoint; origin: AtlasPoint;
    inverse: DOMMatrix; layout: AtlasPlateLayout; viewport: AtlasViewport; moved: boolean } | null = null;
  private suppressClick = false;
  private disposed = false;
  private readonly handleClick = (event: Event): void => {
    if (event.type === 'click' && this.suppressClick) { this.suppressClick = false; return; }
    const target = event.target;
    if (!(target instanceof Element)) return;
    const parcel = target.closest('[data-parcel-id]');
    if (!parcel || !this.element.contains(parcel)) return;
    if (event instanceof KeyboardEvent) {
      if (this.editableLabels && parcel.tagName.toLowerCase() === 'text') {
        const id = Number(parcel.getAttribute('data-parcel-id'));
        const label = atlasDisplayLabels(this.currentPlate(), this.presentation()).find(p => p.id === id);
        const step = (event.shiftKey ? 10 : 1) / this.viewport.zoom;
        const directions: Record<string, AtlasPoint> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
          ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
        const delta = directions[event.key];
        if ((delta && label) || event.key === 'Escape') {
          event.preventDefault();
          try {
            this.setLabelPosition(id, delta && label ? { x: label.x + delta.x, y: label.y + delta.y } : null);
            this.onLayoutChange?.(this.getLayout());
          } catch (error) { this.onInteractionError?.(error as Error); }
          return;
        }
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
    }
    const id = Number(parcel.getAttribute('data-parcel-id'));
    this.setSelection(id);
    this.onParcelClick?.(id);
  };

  constructor(container: HTMLElement, plate: AtlasPlate, options: AtlasPlateViewOptions = {}) {
    this.plate = plate;
    const { onParcelClick, editableLabels = false, adaptiveLabels = true, minInspectionFontSize = 12, onLayoutChange,
      onViewportChange, onInteractionError, ...style } = options;
    this.style = { ...style, ...(style.colors ? { colors: new Map(style.colors) } : {}) };
    this.onParcelClick = onParcelClick;
    this.layout = emptyAtlasLayout(plate);
    this.viewport = { zoom: 1, center: { x: plate.width / 2, y: plate.height / 2 } };
    this.editableLabels = editableLabels;
    this.adaptiveLabels = adaptiveLabels;
    this.minInspectionFontSize = finiteNumber(minInspectionFontSize, 'minInspectionFontSize', { minimum: 0, maximum: 32 });
    this.onLayoutChange = onLayoutChange;
    this.onViewportChange = onViewportChange;
    this.onInteractionError = onInteractionError;
    // Validate and build before modifying the host container.
    const svg = renderAtlasPlateSVG(plate, style);
    this.element = container.ownerDocument.createElement('div');
    this.element.className = 'surfview-atlas-plate';
    this.element.innerHTML = svg;
    this.sizeSVG();
    this.element.addEventListener('click', this.handleClick);
    this.element.addEventListener('keydown', this.handleClick);
    this.element.addEventListener('pointerdown', this.handlePointerDown);
    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerup', this.handlePointerEnd);
    this.element.addEventListener('pointercancel', this.handlePointerEnd);
    this.element.addEventListener('lostpointercapture', this.handlePointerEnd);
    container.append(this.element);
    if (typeof ResizeObserver !== 'undefined') {
      let lastWidth = this.element.clientWidth;
      this.resizeObserver = new ResizeObserver(() => {
        const width = this.element.clientWidth;
        if (!this.disposed && width !== lastWidth) {
          lastWidth = width;
          if (this.viewport.zoom > 1) this.update(this.style);
        }
      });
      this.resizeObserver.observe(this.element);
    }
  }

  private currentPlate(): AtlasPlate {
    if (this.disposed || !this.plate) throw new Error('AtlasPlateView is disposed');
    return this.plate;
  }

  private sizeSVG(): void {
    const svg = this.element.querySelector('svg')!;
    svg.style.display = 'block';
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.style.overflow = 'hidden';
    this.element.style.touchAction = this.viewport.zoom > 1 || this.editableLabels ? 'none' : 'auto';
    this.element.dataset.zoom = String(this.viewport.zoom);
    svg.querySelectorAll<SVGElement>('[data-parcel-id]').forEach(el => { el.style.cursor = 'pointer'; });
    if (this.editableLabels) svg.querySelectorAll<SVGTextElement>('.atlas-labels text').forEach(el => {
      el.style.cursor = 'grab'; el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Move label ${el.parentElement?.querySelector('title')?.textContent ?? el.textContent}; arrow keys move, Escape unpins`);
    });
  }

  private update(style: AtlasPlateStyle): void {
    const active = this.element.ownerDocument.activeElement;
    const focused = active && this.element.contains(active) ? active.getAttribute('data-parcel-id') : null;
    const focusTag = active?.tagName.toLowerCase() === 'text' ? 'text' : 'g';
    const svg = renderAtlasPlateSVG(this.currentPlate(), style, this.presentation());
    this.style = style;
    this.element.innerHTML = svg;
    this.sizeSVG();
    if (focused) this.element.querySelector<SVGElement>(`${focusTag}[data-parcel-id="${Number(focused)}"]`)?.focus();
  }

  private presentation(): AtlasPlatePresentation {
    const plate = this.currentPlate(), width = this.element.clientWidth;
    const labelScale = width > 0 && this.viewport.zoom > 1 ? Math.min(this.viewport.zoom, 8,
      Math.max(1, this.minInspectionFontSize * plate.width / (width * plate.fontSize))) : 1;
    return { layout: this.layout, viewport: this.viewport, adaptiveLabels: this.adaptiveLabels, labelScale };
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag) return;
    this.suppressClick = false;
    const text = event.target instanceof Element ? event.target.closest('.atlas-labels text') : null;
    const id = this.editableLabels && text ? Number(text.getAttribute('data-parcel-id')) : null;
    if (id === null && this.viewport.zoom === 1) return;
    const svg = this.element.querySelector('svg')!;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const inverse = matrix.inverse();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    const label = id === null ? undefined : atlasDisplayLabels(this.currentPlate(), this.presentation()).find(p => p.id === id);
    const parcel = event.target instanceof Element ? event.target.closest('[data-parcel-id]') : null;
    this.drag = { pointer: event.pointerId, id, selectedId: parcel ? Number(parcel.getAttribute('data-parcel-id')) : null, start: { x: point.x, y: point.y },
      origin: label ? { x: label.x, y: label.y } : { ...this.viewport.center }, inverse,
      layout: this.getLayout(), viewport: this.getViewport(), moved: false };
    this.element.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(drag.inverse);
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) * this.viewport.zoom < 3) return;
    drag.moved = true;
    try {
      if (drag.id !== null) this.setLabelPosition(drag.id, { x: drag.origin.x + dx, y: drag.origin.y + dy });
      else this.setZoom(drag.viewport.zoom, { x: drag.origin.x - dx, y: drag.origin.y - dy });
    } catch (error) { this.onInteractionError?.(error as Error); }
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    this.drag = null;
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    this.suppressClick = drag.moved;
    if (event.type !== 'pointerup') {
      this.layout = drag.layout; this.viewport = drag.viewport; this.update(this.style);
      this.onViewportChange?.(this.getViewport());
    } else if (drag.moved && drag.id !== null) this.onLayoutChange?.(this.getLayout());
    else if (!drag.moved && drag.selectedId !== null) {
      this.suppressClick = true;
      this.setSelection(drag.selectedId); this.onParcelClick?.(drag.selectedId);
    }
  };

  getLayout(): AtlasPlateLayout { this.currentPlate(); return { ...this.layout, labels: this.layout.labels.map(p => ({ ...p })) }; }
  setLayout(layout: AtlasPlateLayout): void {
    const next = parseAtlasPlateLayout(this.currentPlate(), layout);
    this.layout = next; this.update(this.style);
  }
  /** Pins reserve space ahead of automatic labels. null restores automatic placement. */
  setLabelPosition(id: number, point: AtlasPoint | null): void {
    const labels = this.layout.labels.filter(p => p.id !== id);
    if (point) labels.push({ id, x: point.x, y: point.y });
    this.setLayout({ ...this.getLayout(), labels });
  }
  resetLabels(): void { this.setLayout(emptyAtlasLayout(this.currentPlate())); }
  setLabelEditing(enabled: boolean): void { this.currentPlate(); this.editableLabels = enabled; this.update(this.style); }
  setAdaptiveLabels(enabled: boolean): void { this.currentPlate(); this.adaptiveLabels = enabled; this.update(this.style); }
  getViewport(): AtlasViewport { this.currentPlate(); return { zoom: this.viewport.zoom, center: { ...this.viewport.center } }; }
  setZoom(zoom: number, center: AtlasPoint = this.viewport.center): void {
    const bounds = atlasViewportBounds(this.currentPlate(), { zoom, center });
    this.viewport = { zoom, center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } };
    this.update(this.style); this.onViewportChange?.(this.getViewport());
  }
  /** Focus a visible footprint; returns false for a parcel hidden in this view. */
  focusParcel(id: number): boolean {
    const plate = this.currentPlate(), region = plate.regions.find(p => p.id === id);
    if (!region) return false;
    const b = region.bounds;
    const zoom = Math.max(1, Math.min(8, plate.width / (b.width + 60), plate.height / (b.height + 60)));
    this.setSelection(id); this.setZoom(zoom, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    return true;
  }

  setColors(colors: ReadonlyMap<number, string>): void {
    this.update({ ...this.style, colors: new Map(colors) });
  }

  getStyle(): AtlasPlateStyle {
    this.currentPlate();
    return { ...this.style, ...(this.style.colors ? { colors: new Map(this.style.colors) } : {}) };
  }

  /** Merge appearance settings without rebuilding geometry or label positions. */
  setStyle(style: AtlasPlateStyle): void {
    this.update({ ...this.style, ...style, ...(style.colors ? { colors: new Map(style.colors) } : {}) });
  }

  setPlate(plate: AtlasPlate): void {
    this.currentPlate();
    // Validate replacement output before mutating the current view.
    const layout = plate.layoutKey === this.layout.plateKey ? parseAtlasPlateLayout(plate, this.layout) : emptyAtlasLayout(plate);
    renderAtlasPlateSVG(plate, this.style, { layout });
    const changed = plate.layoutKey !== this.layout.plateKey;
    this.plate = plate;
    this.layout = layout;
    if (changed) this.viewport = { zoom: 1, center: { x: plate.width / 2, y: plate.height / 2 } };
    const id = this.style.selectedParcelId;
    if (id != null && ![...plate.regions.map(p => p.id), ...plate.hiddenParcelIds].includes(id)) {
      this.style = { ...this.style, selectedParcelId: null };
    }
    this.update(this.style);
    if (changed) this.onViewportChange?.(this.getViewport());
  }

  /** Does not emit onParcelClick, so multiple views can synchronize safely. */
  setSelection(parcelId: number | null): void {
    const plate = this.currentPlate();
    if (parcelId !== null && ![...plate.regions.map(p => p.id), ...plate.hiddenParcelIds].includes(parcelId)) {
      throw new RangeError(`Unknown parcel ${parcelId}`);
    }
    this.update({ ...this.style, selectedParcelId: parcelId });
  }

  setLabelsVisible(visible: boolean): void { this.update({ ...this.style, labelsVisible: visible }); }
  setDashed(dashed: boolean): void { this.update({ ...this.style, dashed }); }

  /** Export current inspection; pass overview: true for the saved figure layout. */
  toSVG(options: { overview?: boolean } = {}): string {
    return renderAtlasPlateSVG(this.currentPlate(), this.style, options.overview ? { layout: this.layout } : this.presentation());
  }

  /** Rasterize the same SVG, retaining the exact text placement and styling. */
  async exportPNG(scale = 2): Promise<Blob> {
    const plate = this.currentPlate();
    finiteNumber(scale, 'scale', { minimum: 0.1, maximum: 8 });
    const width = Math.round(plate.width * scale), height = Math.round(plate.height * scale);
    if (width * height > 32_000_000) throw new RangeError('PNG export exceeds 32 million pixels');
    const doc = this.element.ownerDocument;
    const url = URL.createObjectURL(new Blob([this.toSVG()], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = doc.createElement('img');
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Could not rasterize atlas SVG'));
        image.src = url;
      });
      const canvas = doc.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('PNG export requires a canvas 2D context');
      ctx.drawImage(image, 0, 0, width, height);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
        blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
    } finally { URL.revokeObjectURL(url); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect(); this.resizeObserver = undefined;
    const pointer = this.drag?.pointer;
    this.drag = null;
    if (pointer !== undefined && this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
    this.element.removeEventListener('click', this.handleClick);
    this.element.removeEventListener('keydown', this.handleClick);
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerEnd);
    this.element.removeEventListener('pointercancel', this.handlePointerEnd);
    this.element.removeEventListener('lostpointercapture', this.handlePointerEnd);
    this.element.replaceChildren();
    this.element.remove();
    this.plate = null;
    this.style = {};
    this.onParcelClick = undefined;
    this.onLayoutChange = undefined; this.onViewportChange = undefined; this.onInteractionError = undefined;
  }
}
