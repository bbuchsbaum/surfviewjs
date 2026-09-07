import type { AtlasPlateLabel, AtlasPoint, AtlasRaster } from './types';
import { packAtlasCallouts } from './packAtlasCallouts';

interface LabelInput { id: number; text: string; area: number }
interface LabelOptions {
  width: number; height: number; padding: number; fontSize: number;
  minLabelArea: number;
  maxLeaderLength?: number;
  calloutGap?: number;
  measureText: (text: string, fontSize: number) => number;
  positions?: ReadonlyMap<number, AtlasPoint>;
  /** For detail layouts, break equal-clearance ties near the footprint center. */
  preferCenter?: boolean;
}
type Side = 'left' | 'right' | 'top' | 'bottom';

function overlaps(a: AtlasPlateLabel, b: AtlasPlateLabel): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 3 &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 3;
}

/** Layout depends only on geometry/text, never fill colors or selection. */
export function layoutAtlasLabels(raster: AtlasRaster, regions: LabelInput[], options: LabelOptions): AtlasPlateLabel[] {
  const { width: w, height: h, resolution: r, ids } = raster;
  const distance = new Float32Array(ids.length);
  const runs = new Uint16Array(ids.length);
  const pixels = new Map<number, number[]>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, id = ids[i]!;
      if (!id) continue;
      if (!pixels.has(id)) pixels.set(id, []);
      pixels.get(id)!.push(i);
      runs[i] = x && ids[i - 1] === id ? runs[i - 1]! + 1 : 1;
      const boundary = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        ids[i - 1] !== id || ids[i + 1] !== id || ids[i - w] !== id || ids[i + w] !== id;
      distance[i] = boundary ? 0 : Math.min(distance[i - 1]! + 1, distance[i - w]! + 1,
        ids[i - w - 1] === id ? distance[i - w - 1]! + Math.SQRT2 : 0);
    }
  }
  for (let y = h - 2; y > 0; y--) {
    for (let x = w - 2; x > 0; x--) {
      const i = y * w + x;
      if (distance[i]) distance[i] = Math.min(distance[i]!, distance[i + 1]! + 1,
        distance[i + w]! + 1, ids[i + w + 1] === ids[i] ? distance[i + w + 1]! + Math.SQRT2 : 0);
    }
  }
  const point = (i: number): AtlasPoint => ({ x: (i % w + 0.5) / r, y: (Math.floor(i / w) + 0.5) / r });
  const contains = (label: AtlasPlateLabel): boolean => {
    const x0 = Math.floor((label.x - label.width / 2 - 2) * r);
    const x1 = Math.ceil((label.x + label.width / 2 + 2) * r);
    const y0 = Math.floor((label.y - label.height / 2 - 2) * r);
    const y1 = Math.ceil((label.y + label.height / 2 + 2) * r);
    if (x0 < 0 || y0 < 0 || x1 >= w || y1 >= h) return false;
    for (let y = y0; y <= y1; y++) {
      const i = y * w + x1;
      if (ids[i] !== label.id || runs[i]! < x1 - x0 + 1) return false;
    }
    return true;
  };
  const labels: AtlasPlateLabel[] = [];
  const areas = new Map(regions.map(p => [p.id, p.area]));
  const callouts: Record<Side, AtlasPlateLabel[]> = { left: [], right: [], top: [], bottom: [] };
  // Saved positions reserve their space first; otherwise prioritize larger areas.
  const sorted = [...regions].sort((a, b) =>
    Number(options.positions?.has(b.id) ?? false) - Number(options.positions?.has(a.id) ?? false) ||
    b.area - a.area || a.id - b.id);
  for (const region of sorted) {
    if (region.area < options.minLabelArea) continue;
    const members = pixels.get(region.id)!;
    const center = options.preferCenter ? members.reduce((sum, i) => ({
      x: sum.x + i % w / members.length, y: sum.y + Math.floor(i / w) / members.length
    }), { x: 0, y: 0 }) : { x: 0, y: 0 };
    const centrality = (i: number): number => options.preferCenter ?
      ((i % w) - center.x) ** 2 + (Math.floor(i / w) - center.y) ** 2 : 0;
    let best = members[0]!;
    for (const i of members) if (distance[i]! > distance[best]! ||
      (distance[i] === distance[best] && centrality(i) < centrality(best))) best = i;
    const anchor = point(best);
    const textWidth = options.measureText(region.text, options.fontSize);
    if (!Number.isFinite(textWidth) || textWidth <= 0) throw new RangeError('measureText must return a positive finite width');
    const label: AtlasPlateLabel = { id: region.id, text: region.text, ...anchor, anchor,
      width: textWidth, height: options.fontSize * 1.2, callout: false };
    const override = options.positions?.get(region.id);
    if (override) {
      Object.assign(label, override);
      if (label.x - label.width / 2 < 0 || label.x + label.width / 2 > options.width ||
          label.y - label.height / 2 < 0 || label.y + label.height / 2 > options.height ||
          labels.some(other => overlaps(label, other))) {
        throw new RangeError(`Saved label position for ${region.id} is clipped or overlaps another label`);
      }
      label.callout = !contains(label);
      labels.push(label);
      continue;
    }
    const candidates = members.filter(i => distance[i]! >= options.fontSize * r * 0.5 &&
      (i % w) % Math.max(1, Math.round(r * 2)) === 0 && Math.floor(i / w) % Math.max(1, Math.round(r * 2)) === 0);
    candidates.sort((a, b) => distance[b]! - distance[a]! || centrality(a) - centrality(b) || a - b);
    candidates.unshift(best);
    let placed = false;
    for (const i of candidates) {
      Object.assign(label, point(i));
      if (contains(label) && !labels.some(other => overlaps(label, other))) {
        labels.push(label); placed = true; break;
      }
    }
    if (placed) continue;
    const dx = (anchor.x - options.width / 2) / (options.width / 2 - options.padding);
    const dy = (anchor.y - options.height / 2) / (options.height / 2 - options.padding);
    const side: Side = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
    // Start callouts near the outward edge of the visible parcel, with a small
    // inset, instead of drawing leaders across the whole parcel from a centroid.
    const coordinate = (i: number): number => side === 'left' ? i % w : side === 'right' ? -(i % w) :
      side === 'top' ? Math.floor(i / w) : -Math.floor(i / w);
    let tip = best;
    const inset = Math.min(distance[best]!, 2 * r);
    for (const i of members) if (distance[i]! >= inset && coordinate(i) < coordinate(tip)) tip = i;
    label.anchor = point(tip);
    Object.assign(label, label.anchor);
    label.callout = true;
    label.calloutSide = side;
    callouts[side].push(label);
  }
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const horizontal = side === 'top' || side === 'bottom';
    const axis = horizontal ? 'x' : 'y';
    const size = horizontal ? 'width' : 'height';
    const limit = horizontal ? options.width : options.height;
    // Leave corners for vertical callouts.
    const margin = horizontal ? options.padding : 22;
    const row = side === 'top' || side === 'left' ? options.padding / 2 :
      (horizontal ? options.height : options.width) - options.padding / 2;
    const candidates = callouts[side].filter(label => (horizontal || label.width < options.padding - 24) &&
      Math.abs(label.anchor[horizontal ? 'y' : 'x'] - row) <= (options.maxLeaderLength ?? Infinity));
    candidates.sort((a, b) => a.anchor[axis] - b.anchor[axis] || a.id - b.id);
    let packed: number[] | null;
    while (!(packed = packAtlasCallouts(candidates.map(p => p.anchor[axis]), candidates.map(p => p[size]),
      options.calloutGap ?? 16, margin, limit - margin))) {
      // If the margin is full, prioritize larger visible footprints. Omitted
      // labels remain reported in unlabeledParcelIds; no parcel fill is removed.
      let smallest = 0;
      for (let i = 1; i < candidates.length; i++) if (areas.get(candidates[i]!.id)! < areas.get(candidates[smallest]!.id)!) smallest = i;
      candidates.splice(smallest, 1);
    }
    for (const [index, label] of candidates.entries()) {
      label[axis] = packed[index]!;
      if (horizontal) label.y = row;
      else label.x = row;
      if (label[axis] - label[size] / 2 >= margin &&
          Math.hypot(label.x - label.anchor.x, label.y - label.anchor.y) <= (options.maxLeaderLength ?? Infinity) &&
          !labels.some(other => overlaps(label, other))) labels.push(label);
    }
  }
  return labels.sort((a, b) => a.id - b.id);
}
