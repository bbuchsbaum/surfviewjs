import * as THREE from 'three';

export type AlignmentSliceAxis = 'sagittal' | 'coronal' | 'axial';

export interface AlignmentVolume {
  id?: string;
  data: Float32Array | ArrayLike<number>;
  dims: [number, number, number];
  worldToIJK?: THREE.Matrix4 | ArrayLike<number>;
  voxelToWorld?: THREE.Matrix4 | ArrayLike<number>;
  space?: string;
  dropoutThreshold?: number;
}

export interface AlignmentSurface {
  id: string;
  kind?: 'pial' | 'white' | 'surface' | string;
  vertices: Float32Array | ArrayLike<number>;
  color?: string;
}

export interface AlignmentTransform {
  id?: string;
  from?: string;
  to?: string;
  matrix: THREE.Matrix4 | ArrayLike<number>;
  provenance?: Record<string, unknown>;
}

export interface AlignmentQAConfig {
  volume: AlignmentVolume;
  surfaces: AlignmentSurface[];
  transform: AlignmentTransform;
  sliceIndices?: Partial<Record<AlignmentSliceAxis, number>>;
  sliceThickness?: number;
}

export interface SurfaceDistanceSummary {
  vertexCount: number;
  meanDistance: number;
  maxDistance: number;
  outOfBoundsFraction: number;
}

export interface EdgeAgreementSummary {
  sampledVertices: number;
  meanGradient: number;
  maxGradient: number;
}

export interface DropoutSummary {
  sampledVertices: number;
  threshold: number;
  dropoutFraction: number;
}

export interface AlignmentQAMetrics {
  surfaceVoxelDistance: SurfaceDistanceSummary;
  edgeAgreement: EdgeAgreementSummary;
  dropoutOverlay: DropoutSummary;
}

export interface AlignmentQAReport {
  transform: {
    id?: string;
    from?: string;
    to?: string;
    matrix: number[];
    provenance?: Record<string, unknown>;
  };
  volume: {
    id?: string;
    dims: [number, number, number];
    space?: string;
  };
  metrics: AlignmentQAMetrics;
}

interface SampledSurfacePoint {
  ijk: THREE.Vector3;
  surface: AlignmentSurface;
}

export class AlignmentQAWorkspace {
  readonly container: HTMLElement;
  readonly config: AlignmentQAConfig;
  readonly report: AlignmentQAReport;

  private canvases = new Map<AlignmentSliceAxis | 'overlay3d', HTMLCanvasElement>();

  constructor(container: HTMLElement, config: AlignmentQAConfig) {
    this.container = container;
    this.config = config;
    this.report = createAlignmentQAReport(config);
    this.mount();
    this.render();
  }

  render(): void {
    (['sagittal', 'coronal', 'axial'] as AlignmentSliceAxis[]).forEach(axis => {
      const canvas = this.canvases.get(axis);
      if (canvas) drawSlice(canvas, this.config, axis);
    });
    const overlay = this.canvases.get('overlay3d');
    if (overlay) drawOverlay3D(overlay, this.config);
  }

  getReport(): AlignmentQAReport {
    return {
      ...this.report,
      transform: {
        ...this.report.transform,
        matrix: [...this.report.transform.matrix],
        ...(this.report.transform.provenance ? { provenance: { ...this.report.transform.provenance } } : {})
      }
    };
  }

  dispose(): void {
    this.container.replaceChildren();
    this.canvases.clear();
  }

  private mount(): void {
    const root = document.createElement('div');
    root.dataset.alignmentQa = 'workspace';
    root.className = 'alignment-qa-workspace';

    (['sagittal', 'coronal', 'axial'] as AlignmentSliceAxis[]).forEach(axis => {
      root.appendChild(this.createPanel(axis, axis));
    });
    root.appendChild(this.createPanel('overlay3d', '3d overlay'));

    const report = document.createElement('pre');
    report.dataset.alignmentQaReport = 'metrics';
    report.className = 'alignment-qa-report';
    report.innerHTML = [
      metricMarkup('Transform', `transform: ${this.report.transform.id ?? 'unnamed'}`),
      metricMarkup('Volume', `volume: ${this.report.volume.dims.join(' x ')}`),
      metricMarkup('Out of bounds', `out-of-bounds: ${this.report.metrics.surfaceVoxelDistance.outOfBoundsFraction.toFixed(3)}`),
      metricMarkup('Dropout', `dropout fraction: ${this.report.metrics.dropoutOverlay.dropoutFraction.toFixed(3)}`),
      metricMarkup('Mean distance', `mean surface distance: ${this.report.metrics.surfaceVoxelDistance.meanDistance.toFixed(3)}`),
      metricMarkup('Edge gradient', `mean edge gradient: ${this.report.metrics.edgeAgreement.meanGradient.toFixed(3)}`)
    ].join('');
    root.appendChild(report);

    this.container.replaceChildren(root);
  }

  private createPanel(key: AlignmentSliceAxis | 'overlay3d', label: string): HTMLElement {
    const panel = document.createElement('div');
    panel.dataset.alignmentQaPanel = key;
    panel.className = 'alignment-qa-panel';

    const canvas = document.createElement('canvas');
    canvas.dataset.alignmentQaCanvas = key;
    canvas.width = 320;
    canvas.height = 240;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    panel.appendChild(canvas);
    this.canvases.set(key, canvas);

    const title = document.createElement('div');
    title.textContent = label;
    title.className = 'alignment-qa-label';
    panel.appendChild(title);
    return panel;
  }
}

function metricMarkup(label: string, value: string): string {
  return `<div class="metric-chip"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`;
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createAlignmentQAReport(config: AlignmentQAConfig): AlignmentQAReport {
  const matrix = toMatrix4(config.transform.matrix);
  return {
    transform: {
      ...(config.transform.id ? { id: config.transform.id } : {}),
      ...(config.transform.from ? { from: config.transform.from } : {}),
      ...(config.transform.to ? { to: config.transform.to } : {}),
      matrix: matrix.toArray(),
      ...(config.transform.provenance ? { provenance: { ...config.transform.provenance } } : {})
    },
    volume: {
      ...(config.volume.id ? { id: config.volume.id } : {}),
      dims: [...config.volume.dims],
      ...(config.volume.space ? { space: config.volume.space } : {})
    },
    metrics: computeAlignmentQAMetrics(config)
  };
}

export function computeAlignmentQAMetrics(config: AlignmentQAConfig): AlignmentQAMetrics {
  const sampled = sampleSurfacePoints(config);
  const distances = sampled.map(point => distanceOutsideVolume(point.ijk, config.volume.dims));
  const outOfBounds = distances.filter(distance => distance > 0);
  const gradients = sampled
    .map(point => gradientMagnitude(config.volume, point.ijk))
    .filter(value => Number.isFinite(value));
  const dropoutThreshold = config.volume.dropoutThreshold ?? computeDropoutThreshold(config.volume.data);
  const sampledValues = sampled
    .map(point => sampleNearest(config.volume, point.ijk))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const dropoutCount = sampledValues.filter(value => value <= dropoutThreshold).length;

  return {
    surfaceVoxelDistance: {
      vertexCount: sampled.length,
      meanDistance: mean(distances),
      maxDistance: distances.length ? Math.max(...distances) : 0,
      outOfBoundsFraction: sampled.length ? outOfBounds.length / sampled.length : 0
    },
    edgeAgreement: {
      sampledVertices: gradients.length,
      meanGradient: mean(gradients),
      maxGradient: gradients.length ? Math.max(...gradients) : 0
    },
    dropoutOverlay: {
      sampledVertices: sampledValues.length,
      threshold: dropoutThreshold,
      dropoutFraction: sampledValues.length ? dropoutCount / sampledValues.length : 0
    }
  };
}

function sampleSurfacePoints(config: AlignmentQAConfig): SampledSurfacePoint[] {
  const surfaceToVolumeWorld = toMatrix4(config.transform.matrix);
  const worldToIJK = computeWorldToIJK(config.volume);
  const points: SampledSurfacePoint[] = [];
  config.surfaces.forEach(surface => {
    const vertices = surface.vertices instanceof Float32Array ? surface.vertices : new Float32Array(surface.vertices);
    for (let i = 0; i < vertices.length; i += 3) {
      const world = new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2])
        .applyMatrix4(surfaceToVolumeWorld);
      const ijk = world.clone().applyMatrix4(worldToIJK);
      points.push({ ijk, surface });
    }
  });
  return points;
}

function drawSlice(canvas: HTMLCanvasElement, config: AlignmentQAConfig, axis: AlignmentSliceAxis): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const [nx, ny, nz] = config.volume.dims;
  const sliceIndex = config.sliceIndices?.[axis] ?? Math.floor(axis === 'sagittal' ? nx / 2 : axis === 'coronal' ? ny / 2 : nz / 2);
  const xCount = axis === 'sagittal' ? ny : nx;
  const yCount = axis === 'axial' ? ny : nz;
  const scaleX = canvas.width / xCount;
  const scaleY = canvas.height / yCount;
  const range = dataRange(config.volume.data);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const ijk = sliceCoords(axis, sliceIndex, x, y, config.volume.dims);
      const value = getVoxel(config.volume, ijk[0], ijk[1], ijk[2]);
      const gray = Math.round(255 * normalize(value, range.min, range.max));
      ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
      ctx.fillRect(x * scaleX, canvas.height - (y + 1) * scaleY, Math.ceil(scaleX), Math.ceil(scaleY));
    }
  }

  const thickness = config.sliceThickness ?? 1.25;
  sampleSurfacePoints(config)
    .filter(point => Math.abs(axisValue(axis, point.ijk) - sliceIndex) <= thickness)
    .forEach(point => {
      const projected = slicePoint(axis, point.ijk, config.volume.dims);
      ctx.fillStyle = point.surface.color ?? surfaceColor(point.surface.kind);
      ctx.beginPath();
      ctx.arc(projected.x * scaleX, canvas.height - projected.y * scaleY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
}

function drawOverlay3D(canvas: HTMLCanvasElement, config: AlignmentQAConfig): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const [nx, ny, nz] = config.volume.dims;
  const points = sampleSurfacePoints(config);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  points.forEach(point => {
    const x = 12 + (point.ijk.x / Math.max(1, nx - 1)) * (canvas.width - 24);
    const y = canvas.height - 12 - (point.ijk.y / Math.max(1, ny - 1)) * (canvas.height - 24);
    const zAlpha = 0.35 + 0.65 * Math.max(0, Math.min(1, point.ijk.z / Math.max(1, nz - 1)));
    ctx.fillStyle = withAlpha(point.surface.color ?? surfaceColor(point.surface.kind), zAlpha);
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function computeWorldToIJK(volume: AlignmentVolume): THREE.Matrix4 {
  if (volume.worldToIJK) return toMatrix4(volume.worldToIJK);
  if (volume.voxelToWorld) return toMatrix4(volume.voxelToWorld).invert();
  return new THREE.Matrix4();
}

function toMatrix4(matrix: THREE.Matrix4 | ArrayLike<number>): THREE.Matrix4 {
  return matrix instanceof THREE.Matrix4
    ? matrix.clone()
    : new THREE.Matrix4().fromArray(Array.from(matrix));
}

function distanceOutsideVolume(ijk: THREE.Vector3, dims: [number, number, number]): number {
  const clamped = new THREE.Vector3(
    Math.max(0, Math.min(dims[0] - 1, ijk.x)),
    Math.max(0, Math.min(dims[1] - 1, ijk.y)),
    Math.max(0, Math.min(dims[2] - 1, ijk.z))
  );
  return ijk.distanceTo(clamped);
}

function gradientMagnitude(volume: AlignmentVolume, ijk: THREE.Vector3): number {
  const i = Math.round(ijk.x);
  const j = Math.round(ijk.y);
  const k = Math.round(ijk.z);
  const dx = centralDiff(volume, i, j, k, 0);
  const dy = centralDiff(volume, i, j, k, 1);
  const dz = centralDiff(volume, i, j, k, 2);
  return Math.hypot(dx, dy, dz);
}

function centralDiff(volume: AlignmentVolume, i: number, j: number, k: number, axis: 0 | 1 | 2): number {
  const a = axis === 0 ? [i - 1, j, k] : axis === 1 ? [i, j - 1, k] : [i, j, k - 1];
  const b = axis === 0 ? [i + 1, j, k] : axis === 1 ? [i, j + 1, k] : [i, j, k + 1];
  const va = getVoxel(volume, a[0], a[1], a[2]);
  const vb = getVoxel(volume, b[0], b[1], b[2]);
  if (!Number.isFinite(va) || !Number.isFinite(vb)) return 0;
  return (vb - va) * 0.5;
}

function sampleNearest(volume: AlignmentVolume, ijk: THREE.Vector3): number | null {
  const i = Math.round(ijk.x);
  const j = Math.round(ijk.y);
  const k = Math.round(ijk.z);
  if (i < 0 || j < 0 || k < 0 || i >= volume.dims[0] || j >= volume.dims[1] || k >= volume.dims[2]) {
    return null;
  }
  return getVoxel(volume, i, j, k);
}

function getVoxel(volume: AlignmentVolume, i: number, j: number, k: number): number {
  const [nx, ny, nz] = volume.dims;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return NaN;
  return volume.data[i + nx * j + nx * ny * k];
}

function sliceCoords(axis: AlignmentSliceAxis, sliceIndex: number, x: number, y: number, dims: [number, number, number]): [number, number, number] {
  if (axis === 'sagittal') return [sliceIndex, x, y];
  if (axis === 'coronal') return [x, sliceIndex, y];
  return [x, y, sliceIndex];
}

function slicePoint(axis: AlignmentSliceAxis, ijk: THREE.Vector3, dims: [number, number, number]): { x: number; y: number } {
  if (axis === 'sagittal') return { x: ijk.y, y: ijk.z };
  if (axis === 'coronal') return { x: ijk.x, y: ijk.z };
  return { x: ijk.x, y: ijk.y };
}

function axisValue(axis: AlignmentSliceAxis, ijk: THREE.Vector3): number {
  return axis === 'sagittal' ? ijk.x : axis === 'coronal' ? ijk.y : ijk.z;
}

function dataRange(data: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 1 };
}

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, (value - min) / Math.max(1e-12, max - min)));
}

function computeDropoutThreshold(data: ArrayLike<number>): number {
  const range = dataRange(data);
  return range.min + (range.max - range.min) * 0.05;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function surfaceColor(kind: string | undefined): string {
  if (kind === 'pial') return '#58c4ff';
  if (kind === 'white') return '#ffd166';
  return '#e6e6e6';
}

function withAlpha(color: string, alpha: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
