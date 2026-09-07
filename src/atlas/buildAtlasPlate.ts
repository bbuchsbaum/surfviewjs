import { finiteNumber } from '../utils/validation';
import { atlasContours } from './atlasContours';
import { layoutAtlasLabels } from './layoutAtlasLabels';
import { projectAtlas, validateAtlasInput } from './projectAtlas';
import type { AtlasBounds, AtlasPlate, AtlasPlateInput, AtlasPlateOptions } from './types';

/** Build a fixed anatomical SVG plate from a matching surface and parcellation. */
export function buildAtlasPlate(input: AtlasPlateInput, options: AtlasPlateOptions = {}): AtlasPlate {
  const width = finiteNumber(options.width ?? 1000, 'width', { minimum: 200, maximum: 4096, integer: true });
  const height = finiteNumber(options.height ?? 720, 'height', { minimum: 200, maximum: 4096, integer: true });
  const padding = finiteNumber(options.padding ?? Math.min(110, width / 6, height / 6), 'padding', {
    minimum: 20, maximum: Math.min(width, height) / 2, maximumExclusive: true
  });
  const resolution = finiteNumber(options.resolution ?? 2, 'resolution', { minimum: 0.5, maximum: 4 });
  if (Math.round(width * resolution) * Math.round(height * resolution) > 8_000_000) {
    throw new RangeError('Atlas visibility buffer exceeds 8 million samples; reduce size or resolution');
  }
  const fontSize = finiteNumber(options.fontSize ?? 14, 'fontSize', { minimum: 6, maximum: 64 });
  const minLabelArea = finiteNumber(options.minLabelArea ?? 12, 'minLabelArea', { minimum: 0 });
  const maxLeaderLength = finiteNumber(options.maxLeaderLength ?? 120, 'maxLeaderLength', { minimum: 0 });
  const calloutGap = finiteNumber(options.calloutGap ?? 16, 'calloutGap', { minimum: 3, maximum: 100 });
  const contourSmoothing = finiteNumber(options.contourSmoothing ?? 0, 'contourSmoothing', { minimum: 0, maximum: 8 });
  const view = options.view ?? 'lateral';
  const detailScales = [...new Set(options.detailScales ?? [])].sort((a, b) => a - b);
  if (detailScales.length > 4) throw new RangeError('At most four detailScales are supported');
  for (const scale of detailScales) finiteNumber(scale, 'detailScale', { minimum: 1, minimumExclusive: true, maximum: 8 });
  if (view !== 'lateral' && view !== 'medial') throw new RangeError('view must be lateral or medial');
  validateAtlasInput(input);
  const parcelIds = new Set(input.parcelData.parcels.map(p => p.id));
  for (const [id, group] of options.parcelGroups ?? []) {
    if (!parcelIds.has(id)) throw new RangeError(`Unknown parcel ${id} in parcelGroups`);
    if (typeof group !== 'string' || !group.trim()) throw new TypeError(`Invalid group for parcel ${id}`);
  }
  for (const [id, p] of options.labelPositions ?? []) {
    if (!input.parcelData.parcels.some(parcel => parcel.id === id)) throw new RangeError(`Unknown parcel ${id} in labelPositions`);
    finiteNumber(p.x, 'labelPositions.x'); finiteNumber(p.y, 'labelPositions.y');
  }
  const raster = projectAtlas(input, view, width, height, padding, resolution);
  const counts = new Map<number, number>();
  const bounds = new Map<number, AtlasBounds>();
  // Two independent 32-bit accumulators: a layout compatibility fingerprint,
  // not a cryptographic provenance checksum. Include background/occlusion too.
  let hashA = 2166136261, hashB = 5381;
  for (const [index, id] of raster.ids.entries()) {
    hashA = Math.imul(hashA ^ id, 16777619) >>> 0;
    hashB = (Math.imul(hashB, 33) ^ id) >>> 0;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const x = (index % raster.width) / resolution, y = Math.floor(index / raster.width) / resolution;
    const b = bounds.get(id);
    if (!b) bounds.set(id, { x, y, width: 1 / resolution, height: 1 / resolution });
    else {
      const right = Math.max(b.x + b.width, x + 1 / resolution);
      const bottom = Math.max(b.y + b.height, y + 1 / resolution);
      b.x = Math.min(b.x, x); b.y = Math.min(b.y, y);
      b.width = right - b.x; b.height = bottom - b.y;
    }
  }
  const contours = atlasContours(raster, contourSmoothing, options.parcelGroups);
  const regions = input.parcelData.parcels.filter(p => counts.has(p.id)).map(p => ({
    id: p.id, label: p.label, path: contours.paths.get(p.id)!,
    visibleArea: counts.get(p.id)! / (resolution * resolution), bounds: bounds.get(p.id)!,
    ...(options.parcelGroups?.has(p.id) ? { group: options.parcelGroups.get(p.id)! } : {})
  }));
  const displayLabels = input.parcelData.parcels.filter(p => counts.has(p.id)).map(p => {
    const text = options.labelText ? options.labelText(p) : p.label;
    if (typeof text !== 'string' || !text.trim()) throw new TypeError(`labelText must return non-empty text for parcel ${p.id}`);
    return { id: p.id, text, area: counts.get(p.id)! / (resolution * resolution) };
  });
  const labels = layoutAtlasLabels(raster, displayLabels, {
      width, height, padding, fontSize, minLabelArea, maxLeaderLength, calloutGap,
      // Conservative fallback for Arial; browser callers can supply exact metrics.
      measureText: options.measureText ?? ((text, size) => Array.from(text).length * size * 0.72),
      ...(options.labelPositions ? { positions: options.labelPositions } : {})
    });
  const labeled = new Set(labels.map(label => label.id));
  const detailLevels = detailScales.map(scale => ({ scale, labels: layoutAtlasLabels(raster, displayLabels, {
    width, height, padding, fontSize: fontSize / scale, minLabelArea: minLabelArea / (scale * scale),
    maxLeaderLength: 0, preferCenter: true,
    measureText: options.measureText ?? ((text, size) => Array.from(text).length * size * 0.72)
  }) }));
  return {
    atlasId: input.parcelData.atlas.id, atlasName: input.parcelData.atlas.name,
    ...(input.provenance ? { provenance: { ...input.provenance } } : {}),
    hemisphere: input.hemisphere, view, width, height, resolution, fontSize, contourSmoothing,
    layoutKey: JSON.stringify([input.parcelData.atlas.id, input.hemisphere, view, width, height, resolution,
      hashA.toString(16), hashB.toString(16), input.parcelData.parcels.map(p => [p.id, p.label])]),
    regions, labels, detailLevels, boundaryPath: contours.boundaryPath, silhouettePath: contours.silhouettePath,
    groupBoundaryPath: contours.groupBoundaryPath,
    unlabeledParcelIds: regions.filter(p => !labeled.has(p.id)).map(p => p.id),
    hiddenParcelIds: input.parcelData.parcels.filter(p => !counts.has(p.id)).map(p => p.id)
  };
}
