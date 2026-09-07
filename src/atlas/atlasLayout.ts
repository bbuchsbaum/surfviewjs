import { finiteNumber } from '../utils/validation';
import type { AtlasBounds, AtlasPlate, AtlasPlateLabel, AtlasPoint } from './types';

/** Portable label pins. Geometry and data are supplied separately when restoring. */
export interface AtlasPlateLayout {
  version: 1;
  plateKey: string;
  labels: { id: number; x: number; y: number }[];
}

export interface AtlasViewport { zoom: number; center: AtlasPoint }
export interface AtlasPlatePresentation {
  layout?: AtlasPlateLayout;
  viewport?: AtlasViewport;
  adaptiveLabels?: boolean;
  /** Increase inspection text size, reducing label density to preserve fit. */
  labelScale?: number;
}

export function emptyAtlasLayout(plate: AtlasPlate): AtlasPlateLayout {
  return { version: 1, plateKey: plate.layoutKey, labels: [] };
}

function baseLabel(plate: AtlasPlate, id: number): AtlasPlateLabel | undefined {
  const overview = plate.labels.find(p => p.id === id);
  if (overview) return overview;
  for (const level of plate.detailLevels) {
    const label = level.labels.find(p => p.id === id);
    if (label) return { ...label, width: label.width * level.scale, height: label.height * level.scale };
  }
  return undefined;
}

function overlaps(a: AtlasPlateLabel, b: AtlasPlateLabel, gap = 3): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap;
}

function pinnedLabel(plate: AtlasPlate, pin: { id: number; x: number; y: number }): AtlasPlateLabel {
  const base = baseLabel(plate, pin.id);
  if (!base) throw new RangeError(`Parcel ${pin.id} has no visible label to pin`);
  // A moved label always has a leader to a known visible parcel anchor. We do
  // not infer parcel containment from a bounding box or a smoothed outline.
  const { calloutSide: _side, ...label } = base;
  return { ...label, ...pin, callout: base.callout || pin.x !== base.x || pin.y !== base.y };
}

/** Validate external JSON before changing any displayed state. */
export function parseAtlasPlateLayout(plate: AtlasPlate, value: unknown): AtlasPlateLayout {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid atlas label layout');
  const layout = value as AtlasPlateLayout;
  if (layout.version !== 1) throw new RangeError('Unsupported atlas label layout version');
  if (layout.plateKey !== plate.layoutKey) throw new RangeError('Label layout belongs to a different atlas, projection, or sampling domain');
  if (!Array.isArray(layout.labels) || layout.labels.length > plate.regions.length) throw new TypeError('Invalid label pins');
  const seen = new Set<number>();
  const placed: AtlasPlateLabel[] = [];
  const labels = layout.labels.map(pin => {
    if (!pin || typeof pin !== 'object') throw new TypeError('Invalid label pin');
    const id = finiteNumber(pin.id, 'pin.id', { minimum: 1, integer: true });
    if (seen.has(id)) throw new RangeError(`Duplicate label pin ${id}`);
    seen.add(id);
    const position = { id, x: finiteNumber(pin.x, 'pin.x'), y: finiteNumber(pin.y, 'pin.y') };
    const label = pinnedLabel(plate, position);
    if (label.x - label.width / 2 < 0 || label.y - label.height / 2 < 0 ||
        label.x + label.width / 2 > plate.width || label.y + label.height / 2 > plate.height ||
        placed.some(p => overlaps(p, label))) throw new RangeError(`Label pin ${id} is clipped or overlaps another pin`);
    placed.push(label);
    return position;
  });
  return { version: 1, plateKey: plate.layoutKey, labels };
}

/** Clamp inspection to the plate; zoom never changes its geometry. */
export function atlasViewportBounds(plate: AtlasPlate, viewport?: AtlasViewport): AtlasBounds {
  const zoom = finiteNumber(viewport?.zoom ?? 1, 'zoom', { minimum: 1, maximum: 8 });
  const cx = finiteNumber(viewport?.center.x ?? plate.width / 2, 'viewport.center.x');
  const cy = finiteNumber(viewport?.center.y ?? plate.height / 2, 'viewport.center.y');
  const width = plate.width / zoom, height = plate.height / zoom;
  return { x: Math.max(0, Math.min(plate.width - width, cx - width / 2)),
    y: Math.max(0, Math.min(plate.height - height, cy - height / 2)), width, height };
}

export function atlasDisplayLabels(plate: AtlasPlate, presentation: AtlasPlatePresentation = {}): AtlasPlateLabel[] {
  const bounds = atlasViewportBounds(plate, presentation.viewport);
  const zoom = plate.width / bounds.width;
  const labelScale = Math.min(zoom, finiteNumber(presentation.labelScale ?? 1, 'labelScale', { minimum: 1, maximum: 8 }));
  let source = plate.labels, scale = 1;
  if (presentation.adaptiveLabels ?? true) for (const level of plate.detailLevels) {
    if (level.scale <= zoom / labelScale && level.scale > scale) { source = level.labels; scale = level.scale; }
  }
  const pins = presentation.layout ? parseAtlasPlateLayout(plate, presentation.layout).labels : [];
  const pinned = new Set(pins.map(p => p.id));
  const candidates = [
    ...pins.map(p => { const label = pinnedLabel(plate, p); return { ...label, width: label.width * labelScale / zoom, height: label.height * labelScale / zoom }; }),
    ...source.filter(p => !pinned.has(p.id)).map(p => ({ ...p, width: p.width * scale * labelScale / zoom, height: p.height * scale * labelScale / zoom }))
  ];
  const placed: AtlasPlateLabel[] = [];
  for (const label of candidates) {
    if (label.x - label.width / 2 < bounds.x || label.y - label.height / 2 < bounds.y ||
        label.x + label.width / 2 > bounds.x + bounds.width || label.y + label.height / 2 > bounds.y + bounds.height) continue;
    if (label.callout && (label.anchor.x < bounds.x || label.anchor.x > bounds.x + bounds.width ||
      label.anchor.y < bounds.y || label.anchor.y > bounds.y + bounds.height)) continue;
    if (!placed.some(p => overlaps(p, label, 3 / zoom))) placed.push(label);
  }
  return placed;
}
