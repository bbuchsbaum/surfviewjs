import type { RoiManifest } from './SubjectPackage';

export type RoiDrawMode = 'lasso' | 'polygon';

export interface RoiPoint {
  x: number;
  y: number;
}

export interface RoiProvenance {
  sourceLayer?: string;
  sourceSurface?: string;
  tool?: RoiDrawMode | string;
  createdBy?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface VertexROI {
  id: string;
  name: string;
  surfaceId: string | null;
  vertexIndices: number[];
  color?: string;
  outline?: RoiPoint[];
  provenance?: RoiProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface CreateROIOptions {
  id?: string;
  name: string;
  surfaceId?: string | null;
  vertexIndices: ArrayLike<number>;
  color?: string;
  outline?: RoiPoint[];
  provenance?: RoiProvenance;
  createdAt?: string;
  updatedAt?: string;
}

export interface PolygonVertexSource {
  vertexCount: number;
  projectVertex(vertexIndex: number): RoiPoint;
}

export interface RoiSVGOptions {
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  includeLabel?: boolean;
}

export interface RoiLabelExportOptions {
  vertexCount: number;
  labelValue?: number;
  backgroundValue?: number;
}

export interface RoiManifestExportOptions {
  surfaceId?: string;
  file?: RoiManifest['file'];
  vertexCount?: number;
  hemisphere?: RoiManifest['hemisphere'];
}

export class ROIManager {
  private rois = new Map<string, VertexROI>();
  private counter = 0;

  create(options: CreateROIOptions): VertexROI {
    const now = new Date().toISOString();
    const roi: VertexROI = {
      id: options.id ?? `roi_${++this.counter}`,
      name: options.name,
      surfaceId: options.surfaceId ?? null,
      vertexIndices: normalizeVertexIndices(options.vertexIndices),
      ...(options.color ? { color: options.color } : {}),
      ...(options.outline ? { outline: normalizeOutline(options.outline) } : {}),
      ...(options.provenance ? { provenance: { ...options.provenance } } : {}),
      createdAt: options.createdAt ?? now,
      updatedAt: options.updatedAt ?? now
    };
    this.rois.set(roi.id, roi);
    return cloneROI(roi);
  }

  update(id: string, updates: Partial<Omit<CreateROIOptions, 'id' | 'createdAt'>>): VertexROI | null {
    const current = this.rois.get(id);
    if (!current) return null;
    const next: VertexROI = {
      ...current,
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.surfaceId !== undefined ? { surfaceId: updates.surfaceId } : {}),
      ...(updates.vertexIndices !== undefined ? { vertexIndices: normalizeVertexIndices(updates.vertexIndices) } : {}),
      ...(updates.color !== undefined ? { color: updates.color } : {}),
      ...(updates.outline !== undefined ? { outline: normalizeOutline(updates.outline) } : {}),
      ...(updates.provenance !== undefined ? { provenance: { ...updates.provenance } } : {}),
      updatedAt: updates.updatedAt ?? new Date().toISOString()
    };
    this.rois.set(id, next);
    return cloneROI(next);
  }

  get(id: string): VertexROI | null {
    const roi = this.rois.get(id);
    return roi ? cloneROI(roi) : null;
  }

  list(surfaceId?: string | null): VertexROI[] {
    const rois = Array.from(this.rois.values());
    return rois
      .filter(roi => surfaceId === undefined || roi.surfaceId === surfaceId)
      .map(cloneROI);
  }

  remove(id: string): boolean {
    return this.rois.delete(id);
  }

  clear(): void {
    this.rois.clear();
  }
}

export function createROIFromPolygon(
  source: PolygonVertexSource,
  polygon: RoiPoint[],
  options: Omit<CreateROIOptions, 'vertexIndices' | 'outline'>
): VertexROI {
  const manager = new ROIManager();
  return manager.create({
    ...options,
    vertexIndices: selectVerticesInPolygon(source, polygon),
    outline: polygon
  });
}

export function selectVerticesInPolygon(source: PolygonVertexSource, polygon: RoiPoint[]): number[] {
  if (polygon.length < 3) return [];
  const bounds = polygonBounds(polygon);
  const indices: number[] = [];
  for (let vertexIndex = 0; vertexIndex < source.vertexCount; vertexIndex++) {
    const point = source.projectVertex(vertexIndex);
    if (
      point.x < bounds.minX ||
      point.x > bounds.maxX ||
      point.y < bounds.minY ||
      point.y > bounds.maxY
    ) {
      continue;
    }
    if (pointOnPolygonBoundary(point, polygon) || pointInPolygon(point, polygon)) {
      indices.push(vertexIndex);
    }
  }
  return indices;
}

export function roiToLabelArray(roi: VertexROI, options: RoiLabelExportOptions): Uint32Array {
  const labels = new Uint32Array(options.vertexCount);
  labels.fill(options.backgroundValue ?? 0);
  const labelValue = options.labelValue ?? 1;
  roi.vertexIndices.forEach(vertexIndex => {
    if (vertexIndex >= 0 && vertexIndex < labels.length) {
      labels[vertexIndex] = labelValue;
    }
  });
  return labels;
}

export function roiToSVG(roi: VertexROI, options: RoiSVGOptions = {}): string {
  const width = options.width ?? 512;
  const height = options.height ?? 512;
  const stroke = options.stroke ?? roi.color ?? '#ffd166';
  const fill = options.fill ?? `${stroke}33`;
  const strokeWidth = options.strokeWidth ?? 2;
  const outline = roi.outline ?? [];
  const path = outline.length >= 2
    ? `M ${outline.map(point => `${round(point.x)} ${round(point.y)}`).join(' L ')} Z`
    : '';
  const label = options.includeLabel !== false && outline.length > 0
    ? `<text x="${round(centroid(outline).x)}" y="${round(centroid(outline).y)}" text-anchor="middle" dominant-baseline="middle">${escapeXml(roi.name)}</text>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <g id="${escapeXml(roi.id)}" data-surface="${escapeXml(roi.surfaceId ?? '')}" data-vertices="${roi.vertexIndices.join(' ')}">`,
    path ? `    <path d="${path}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" />` : '',
    label ? `    ${label}` : '',
    '  </g>',
    '</svg>'
  ].filter(Boolean).join('\n');
}

export function roiToLabelGIFTI(roi: VertexROI, options: RoiLabelExportOptions): string {
  const labels = Array.from(roiToLabelArray(roi, options)).join(' ');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<GIFTI Version="1.0" NumberOfDataArrays="1">',
    `  <MetaData><MD><Name>ROIName</Name><Value>${escapeXml(roi.name)}</Value></MD></MetaData>`,
    '  <DataArray Intent="NIFTI_INTENT_LABEL" DataType="NIFTI_TYPE_UINT32" ArrayIndexingOrder="RowMajorOrder" Dimensionality="1"',
    `             Dim0="${options.vertexCount}" Encoding="ASCII" Endian="LittleEndian" ExternalFileName="" ExternalFileOffset="">`,
    `    <Data>${labels}</Data>`,
    '  </DataArray>',
    '</GIFTI>'
  ].join('\n');
}

export function roiToSubjectPackageRoi(roi: VertexROI, options: RoiManifestExportOptions = {}): RoiManifest {
  const surface = options.surfaceId ?? roi.surfaceId;
  if (!surface) {
    throw new Error('roiToSubjectPackageRoi requires a surface id');
  }
  return {
    id: roi.id,
    ...(options.file ? { file: options.file } : {}),
    surface,
    ...(options.vertexCount !== undefined ? { vertexCount: options.vertexCount } : {}),
    vertexIndices: [...roi.vertexIndices],
    ...(options.hemisphere ? { hemisphere: options.hemisphere } : {}),
    provenance: {
      ...roi.provenance,
      roiName: roi.name
    }
  };
}

export function cloneROI(roi: VertexROI): VertexROI {
  return {
    ...roi,
    vertexIndices: [...roi.vertexIndices],
    ...(roi.outline ? { outline: roi.outline.map(point => ({ ...point })) } : {}),
    ...(roi.provenance ? { provenance: { ...roi.provenance } } : {})
  };
}

function normalizeVertexIndices(indices: ArrayLike<number>): number[] {
  return Array.from(indices)
    .filter(index => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b)
    .filter((index, offset, arr) => offset === 0 || arr[offset - 1] !== index);
}

function normalizeOutline(outline: RoiPoint[]): RoiPoint[] {
  return outline.map(point => ({ x: point.x, y: point.y }));
}

function polygonBounds(polygon: RoiPoint[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return polygon.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function pointInPolygon(point: RoiPoint, polygon: RoiPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects = ((pi.y > point.y) !== (pj.y > point.y)) &&
      (point.x < ((pj.x - pi.x) * (point.y - pi.y)) / Math.max(1e-12, pj.y - pi.y) + pi.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnPolygonBoundary(point: RoiPoint, polygon: RoiPoint[], tolerance = 1e-6): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 <= tolerance) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const dist2 = (point.x - px) ** 2 + (point.y - py) ** 2;
    if (dist2 <= tolerance * tolerance) return true;
  }
  return false;
}

function centroid(points: RoiPoint[]): RoiPoint {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
