import { EventEmitter } from './EventEmitter';
import type { SurfacePickEvent, VertexHoverEvent } from './events/ViewerEvents';
import {
  ROIManager,
  RoiDrawMode,
  RoiPoint,
  RoiProvenance,
  VertexROI,
  selectVerticesInPolygon
} from './roi';
import { finiteNumber } from './utils/validation';

export interface FlatMapGeometryInput {
  vertices: Float32Array | number[];
  faces?: Uint32Array | number[];
  surfaceId?: string;
}

export interface FlatMapViewOptions {
  canvas?: HTMLCanvasElement;
  width?: number;
  height?: number;
  padding?: number;
  background?: string;
  fillStyle?: string;
  strokeStyle?: string;
  hoverStyle?: string;
  selectionStyle?: string;
  pointRadius?: number;
  autoRender?: boolean;
}

export interface FlatMapVertexEvent extends VertexHoverEvent {
  mapX: number | null;
  mapY: number | null;
}

export interface FlatMapClickEvent extends SurfacePickEvent {
  mapX: number | null;
  mapY: number | null;
}

export interface FlatMapSelectionEvent {
  surfaceId: string | null;
  vertexIndex: number | null;
}

export interface FlatMapROIEvent {
  surfaceId: string | null;
  roi: VertexROI;
}

export interface FlatMapROIDrawingOptions {
  mode: RoiDrawMode;
  name: string;
  color?: string;
  provenance?: RoiProvenance;
  minVertices?: number;
}

export interface FlatMapEventMap {
  'vertex:hover': FlatMapVertexEvent;
  'vertex:click': FlatMapClickEvent;
  'selection:changed': FlatMapSelectionEvent;
  'roi:created': FlatMapROIEvent;
  'roi:updated': FlatMapROIEvent;
  'roi:removed': FlatMapROIEvent;
  'roi:drawing': { surfaceId: string | null; mode: RoiDrawMode | null; points: RoiPoint[] };
  'layer:state': { layerId: string; state: Record<string, unknown> };
  'time:changed': { time: number };
  'render:needed': void;
}

interface FlatMapBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function normalizedGeometry(geometry: FlatMapGeometryInput): {
  vertices: Float32Array;
  faces: Uint32Array;
} {
  const vertices = new Float32Array(geometry.vertices);
  if (vertices.length === 0 || vertices.length % 3 !== 0) {
    throw new RangeError('vertices must contain one or more complete x/y/z triples.');
  }
  for (let index = 0; index < vertices.length; index += 1) {
    finiteNumber(vertices[index], `vertices[${index}]`);
  }
  const rawFaces = geometry.faces ?? [];
  if (rawFaces.length % 3 !== 0) {
    throw new RangeError('faces must contain complete triangle index triples.');
  }
  const vertexCount = vertices.length / 3;
  const faces = new Uint32Array(rawFaces.length);
  for (let index = 0; index < rawFaces.length; index += 1) {
    faces[index] = finiteNumber(rawFaces[index], `faces[${index}]`, {
      minimum: 0,
      maximum: vertexCount - 1,
      integer: true
    });
  }
  return { vertices, faces };
}

function validatedPolygon(polygon: RoiPoint[]): RoiPoint[] {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new RangeError('polygon must contain at least three points.');
  }
  return polygon.map((point, index) => ({
    x: finiteNumber(point.x, `polygon[${index}].x`),
    y: finiteNumber(point.y, `polygon[${index}].y`)
  }));
}

export class FlatMapView extends EventEmitter<FlatMapEventMap> {
  readonly canvas: HTMLCanvasElement;
  readonly surfaceId: string | null;
  vertices: Float32Array;
  faces: Uint32Array;
  hoverVertexIndex: number | null = null;
  selectedVertexIndex: number | null = null;
  layerState = new Map<string, Record<string, unknown>>();
  currentTime: number | null = null;
  readonly rois = new ROIManager();

  private ctx: CanvasRenderingContext2D | null;
  private options: Required<Omit<FlatMapViewOptions, 'canvas'>>;
  private bounds: FlatMapBounds;
  private drawingOptions: FlatMapROIDrawingOptions | null = null;
  private drawingPoints: RoiPoint[] = [];
  private isDrawingLasso = false;
  private suppressNextClick = false;
  private handleMouseMove: (event: MouseEvent) => void;
  private handleMouseDown: (event: MouseEvent) => void;
  private handleMouseUp: (event: MouseEvent) => void;
  private handleClick: (event: MouseEvent) => void;
  private handleDoubleClick: (event: MouseEvent) => void;

  constructor(container: HTMLElement, geometry: FlatMapGeometryInput, options: FlatMapViewOptions = {}) {
    super();
    const normalized = normalizedGeometry(geometry);
    this.canvas = options.canvas ?? document.createElement('canvas');
    this.surfaceId = geometry.surfaceId ?? null;
    this.vertices = normalized.vertices;
    this.faces = normalized.faces;
    const width = finiteNumber(options.width ?? (container.clientWidth || 320), 'width', {
      minimum: 1,
      integer: true
    });
    const height = finiteNumber(options.height ?? (container.clientHeight || 240), 'height', {
      minimum: 1,
      integer: true
    });
    const padding = finiteNumber(options.padding ?? 12, 'padding', { minimum: 0 });
    if (padding * 2 >= Math.min(width, height)) {
      throw new RangeError('padding must leave a positive drawable width and height.');
    }
    this.options = {
      width,
      height,
      padding,
      background: options.background ?? '#050505',
      fillStyle: options.fillStyle ?? 'rgba(160, 164, 170, 0.35)',
      strokeStyle: options.strokeStyle ?? 'rgba(255, 255, 255, 0.22)',
      hoverStyle: options.hoverStyle ?? '#58c4ff',
      selectionStyle: options.selectionStyle ?? '#ffd166',
      pointRadius: finiteNumber(options.pointRadius ?? 4, 'pointRadius', {
        minimum: 0,
        minimumExclusive: true
      }),
      autoRender: options.autoRender ?? true
    };
    this.canvas.width = this.options.width;
    this.canvas.height = this.options.height;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    if (!this.canvas.parentElement) {
      container.appendChild(this.canvas);
    }
    this.ctx = this.canvas.getContext('2d');
    this.bounds = this.computeBounds();

    this.handleMouseMove = (event: MouseEvent) => {
      const point = this.clientToCanvas(event.clientX, event.clientY);
      if (this.drawingOptions?.mode === 'lasso' && this.isDrawingLasso) {
        this.drawingPoints.push(point);
        this.emitDrawing();
        this.requestRender();
        return;
      }
      const vertexIndex = this.pickVertexAt(point.x, point.y);
      this.setHover(vertexIndex, { emit: true, screenX: event.clientX, screenY: event.clientY });
    };
    this.handleMouseDown = (event: MouseEvent) => {
      if (this.drawingOptions?.mode !== 'lasso') return;
      const point = this.clientToCanvas(event.clientX, event.clientY);
      this.isDrawingLasso = true;
      this.drawingPoints = [point];
      this.emitDrawing();
      this.requestRender();
    };
    this.handleMouseUp = (event: MouseEvent) => {
      if (this.drawingOptions?.mode !== 'lasso' || !this.isDrawingLasso) return;
      this.drawingPoints.push(this.clientToCanvas(event.clientX, event.clientY));
      this.isDrawingLasso = false;
      this.suppressNextClick = true;
      this.finishROIDrawing();
    };
    this.handleClick = (event: MouseEvent) => {
      const point = this.clientToCanvas(event.clientX, event.clientY);
      if (this.suppressNextClick) {
        this.suppressNextClick = false;
        return;
      }
      if (this.drawingOptions?.mode === 'polygon') {
        this.drawingPoints.push(point);
        this.emitDrawing();
        this.requestRender();
        return;
      }
      if (this.drawingOptions?.mode === 'lasso') return;
      const vertexIndex = this.pickVertexAt(point.x, point.y);
      this.setSelection(vertexIndex, { emit: true });
      const mapPoint = vertexIndex === null ? null : this.projectVertex(vertexIndex);
      this.emit('vertex:click', {
        surfaceId: this.surfaceId,
        point: null,
        vertexIndex,
        mapX: mapPoint?.x ?? null,
        mapY: mapPoint?.y ?? null
      });
    };
    this.handleDoubleClick = (event: MouseEvent) => {
      if (this.drawingOptions?.mode !== 'polygon') return;
      event.preventDefault();
      this.finishROIDrawing();
    };
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('click', this.handleClick);
    this.canvas.addEventListener('dblclick', this.handleDoubleClick);

    if (this.options.autoRender) {
      this.render();
    }
  }

  resize(width: number, height: number): void {
    const nextWidth = finiteNumber(width, 'width', { minimum: 1, integer: true });
    const nextHeight = finiteNumber(height, 'height', { minimum: 1, integer: true });
    if (this.options.padding * 2 >= Math.min(nextWidth, nextHeight)) {
      throw new RangeError('width and height must leave positive drawable space after padding.');
    }
    this.options.width = nextWidth;
    this.options.height = nextHeight;
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
    this.requestRender();
  }

  setGeometry(geometry: FlatMapGeometryInput): void {
    const normalized = normalizedGeometry(geometry);
    this.vertices = normalized.vertices;
    this.faces = normalized.faces;
    this.bounds = this.computeBounds();
    this.requestRender();
  }

  setHover(vertexIndex: number | null, options: { emit?: boolean; screenX?: number; screenY?: number } = {}): void {
    const nextVertexIndex = this.validateVertexIndex(vertexIndex, 'vertexIndex');
    const screenX = options.screenX === undefined
      ? undefined
      : finiteNumber(options.screenX, 'screenX');
    const screenY = options.screenY === undefined
      ? undefined
      : finiteNumber(options.screenY, 'screenY');
    this.hoverVertexIndex = nextVertexIndex;
    if (options.emit ?? true) {
      const point = nextVertexIndex === null ? null : this.projectVertex(nextVertexIndex);
      this.emit('vertex:hover', {
        surfaceId: this.surfaceId,
        vertexIndex: nextVertexIndex,
        screenX: screenX ?? point?.x ?? 0,
        screenY: screenY ?? point?.y ?? 0,
        mapX: point?.x ?? null,
        mapY: point?.y ?? null
      });
    }
    this.requestRender();
  }

  setSelection(vertexIndex: number | null, options: { emit?: boolean } = {}): void {
    const nextVertexIndex = this.validateVertexIndex(vertexIndex, 'vertexIndex');
    this.selectedVertexIndex = nextVertexIndex;
    if (options.emit ?? true) {
      this.emit('selection:changed', {
        surfaceId: this.surfaceId,
        vertexIndex: nextVertexIndex
      });
    }
    this.requestRender();
  }

  setLayerState(layerId: string, state: Record<string, unknown>): void {
    this.layerState.set(layerId, { ...state });
    this.emit('layer:state', { layerId, state: { ...state } });
    this.requestRender();
  }

  setTime(time: number): void {
    const nextTime = finiteNumber(time, 'time');
    this.currentTime = nextTime;
    this.emit('time:changed', { time: nextTime });
    this.requestRender();
  }

  startROIDrawing(options: FlatMapROIDrawingOptions): void {
    if (options.minVertices !== undefined) {
      finiteNumber(options.minVertices, 'minVertices', { minimum: 1, integer: true });
    }
    this.drawingOptions = { ...options };
    this.drawingPoints = [];
    this.isDrawingLasso = false;
    this.emitDrawing();
    this.requestRender();
  }

  cancelROIDrawing(): void {
    this.drawingOptions = null;
    this.drawingPoints = [];
    this.isDrawingLasso = false;
    this.emitDrawing();
    this.requestRender();
  }

  finishROIDrawing(): VertexROI | null {
    const options = this.drawingOptions;
    if (!options || this.drawingPoints.length < 3) {
      this.cancelROIDrawing();
      return null;
    }
    const roi = this.createROIFromPolygon(this.drawingPoints, {
      name: options.name,
      provenance: {
        ...options.provenance,
        tool: options.mode
      },
      ...(options.color === undefined ? {} : { color: options.color }),
      ...(options.minVertices === undefined ? {} : { minVertices: options.minVertices })
    });
    this.drawingOptions = null;
    this.drawingPoints = [];
    this.isDrawingLasso = false;
    this.emitDrawing();
    this.requestRender();
    return roi;
  }

  selectVerticesInPolygon(polygon: RoiPoint[]): number[] {
    const nextPolygon = validatedPolygon(polygon);
    return selectVerticesInPolygon({
      vertexCount: this.vertices.length / 3,
      projectVertex: vertexIndex => this.projectVertex(vertexIndex)
    }, nextPolygon);
  }

  createROIFromPolygon(
    polygon: RoiPoint[],
    options: {
      name: string;
      color?: string;
      provenance?: RoiProvenance;
      minVertices?: number;
    }
  ): VertexROI | null {
    const nextPolygon = validatedPolygon(polygon);
    const minVertices = finiteNumber(options.minVertices ?? 1, 'minVertices', {
      minimum: 1,
      integer: true
    });
    const vertexIndices = this.selectVerticesInPolygon(nextPolygon);
    if (vertexIndices.length < minVertices) return null;
    const roi = this.rois.create({
      name: options.name,
      surfaceId: this.surfaceId,
      vertexIndices,
      outline: nextPolygon,
      ...(options.color === undefined ? {} : { color: options.color }),
      ...(options.provenance === undefined ? {} : { provenance: options.provenance })
    });
    this.emit('roi:created', { surfaceId: this.surfaceId, roi });
    this.requestRender();
    return roi;
  }

  updateROI(
    roiId: string,
    updates: {
      name?: string;
      polygon?: RoiPoint[];
      color?: string;
      provenance?: RoiProvenance;
    }
  ): VertexROI | null {
    const polygon = updates.polygon ? validatedPolygon(updates.polygon) : undefined;
    const vertexIndices = polygon ? this.selectVerticesInPolygon(polygon) : undefined;
    const roi = this.rois.update(roiId, {
      ...(updates.name === undefined ? {} : { name: updates.name }),
      ...(vertexIndices === undefined ? {} : { vertexIndices }),
      ...(updates.color === undefined ? {} : { color: updates.color }),
      ...(polygon === undefined ? {} : { outline: polygon }),
      ...(updates.provenance === undefined ? {} : { provenance: updates.provenance })
    });
    if (roi) {
      this.emit('roi:updated', { surfaceId: this.surfaceId, roi });
      this.requestRender();
    }
    return roi;
  }

  removeROI(roiId: string): boolean {
    const roi = this.rois.get(roiId);
    const removed = this.rois.remove(roiId);
    if (removed && roi) {
      this.emit('roi:removed', { surfaceId: this.surfaceId, roi });
      this.requestRender();
    }
    return removed;
  }

  clearROIs(): void {
    this.rois.list().forEach(roi => {
      this.rois.remove(roi.id);
      this.emit('roi:removed', { surfaceId: this.surfaceId, roi });
    });
    this.requestRender();
  }

  pickVertex(clientX: number, clientY: number): number | null {
    const point = this.clientToCanvas(
      finiteNumber(clientX, 'clientX'),
      finiteNumber(clientY, 'clientY')
    );
    return this.pickVertexAt(point.x, point.y);
  }

  pickVertexAt(x: number, y: number, maxDistance = 10): number | null {
    const nextX = finiteNumber(x, 'x');
    const nextY = finiteNumber(y, 'y');
    const nextMaxDistance = finiteNumber(maxDistance, 'maxDistance', { minimum: 0 });
    let bestIndex: number | null = null;
    let bestDistance = nextMaxDistance * nextMaxDistance;
    for (let i = 0; i < this.vertices.length / 3; i++) {
      const point = this.projectVertex(i);
      const dx = point.x - nextX;
      const dy = point.y - nextY;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDistance) {
        bestDistance = d2;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  projectVertex(vertexIndex: number): { x: number; y: number } {
    const nextVertexIndex = this.validateVertexIndex(vertexIndex, 'vertexIndex')!;
    const x = this.vertices[nextVertexIndex * 3]!;
    const y = this.vertices[nextVertexIndex * 3 + 1]!;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const padding = this.options.padding;
    const spanX = Math.max(1e-6, this.bounds.maxX - this.bounds.minX);
    const spanY = Math.max(1e-6, this.bounds.maxY - this.bounds.minY);
    return {
      x: padding + ((x - this.bounds.minX) / spanX) * Math.max(1, width - padding * 2),
      y: height - padding - ((y - this.bounds.minY) / spanY) * Math.max(1, height - padding * 2)
    };
  }

  render(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = this.options.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = this.options.fillStyle;
    ctx.strokeStyle = this.options.strokeStyle;
    ctx.lineWidth = 1;

    for (let i = 0; i < this.faces.length; i += 3) {
      // Geometry normalization validates complete in-range triangles.
      const a = this.projectVertex(this.faces[i]!);
      const b = this.projectVertex(this.faces[i + 1]!);
      const c = this.projectVertex(this.faces[i + 2]!);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    this.drawROIs();
    this.drawDraftROI();
    this.drawVertex(this.hoverVertexIndex, this.options.hoverStyle, this.options.pointRadius);
    this.drawVertex(this.selectedVertexIndex, this.options.selectionStyle, this.options.pointRadius + 1);
  }

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('dblclick', this.handleDoubleClick);
    this.removeAllListeners();
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }

  private requestRender(): void {
    this.emit('render:needed');
    if (this.options.autoRender) {
      this.render();
    }
  }

  private validateVertexIndex(vertexIndex: number | null, parameter: string): number | null {
    if (vertexIndex === null) return null;
    return finiteNumber(vertexIndex, parameter, {
      minimum: 0,
      maximum: this.vertices.length / 3 - 1,
      integer: true
    });
  }

  private drawVertex(vertexIndex: number | null, style: string, radius: number): void {
    if (vertexIndex === null || !this.ctx) return;
    const point = this.projectVertex(vertexIndex);
    this.ctx.beginPath();
    this.ctx.fillStyle = style;
    this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawROIs(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.rois.list(this.surfaceId).forEach(roi => {
      if (!roi.outline || roi.outline.length < 2) return;
      this.drawPath(roi.outline, roi.color ?? '#ffd166', true);
      const center = centroid(roi.outline);
      ctx.fillStyle = roi.color ?? '#ffd166';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(roi.name, center.x, center.y);
    });
  }

  private drawDraftROI(): void {
    if (!this.drawingOptions || this.drawingPoints.length < 2) return;
    this.drawPath(this.drawingPoints, this.drawingOptions.color ?? '#58c4ff', false);
  }

  private drawPath(points: RoiPoint[], color: string, closed: boolean): void {
    const ctx = this.ctx;
    const firstPoint = points[0];
    if (!ctx || !firstPoint) return;
    ctx.beginPath();
    ctx.moveTo(firstPoint.x, firstPoint.y);
    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      if (point) ctx.lineTo(point.x, point.y);
    }
    if (closed) ctx.closePath();
    ctx.fillStyle = closed ? transparentColor(color, 0.18) : 'transparent';
    ctx.strokeStyle = color;
    ctx.lineWidth = closed ? 2 : 1.5;
    if (closed) ctx.fill();
    ctx.stroke();
  }

  private clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / Math.max(1, rect.width);
    const scaleY = this.canvas.height / Math.max(1, rect.height);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  private computeBounds(): FlatMapBounds {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.vertices.length; i += 3) {
      minX = Math.min(minX, this.vertices[i]!);
      maxX = Math.max(maxX, this.vertices[i]!);
      minY = Math.min(minY, this.vertices[i + 1]!);
      maxY = Math.max(maxY, this.vertices[i + 1]!);
    }
    if (!Number.isFinite(minX)) {
      return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    }
    return { minX, maxX, minY, maxY };
  }

  private emitDrawing(): void {
    this.emit('roi:drawing', {
      surfaceId: this.surfaceId,
      mode: this.drawingOptions?.mode ?? null,
      points: this.drawingPoints.map(point => ({ ...point }))
    });
  }
}

function centroid(points: RoiPoint[]): RoiPoint {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function transparentColor(color: string, alpha: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
