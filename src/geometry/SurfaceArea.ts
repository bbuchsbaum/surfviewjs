import { checkFinite, checkMask, GeometryError } from './GeometryError';
import { domainFaces, metricPositions, SurfaceMetric } from './SurfaceDomain';
import { partitionLabelTriangle, type BarycentricPoint } from './labelPartition';
import { topologyData } from './SurfaceTopology';

export function computeFaceAreas(metric: SurfaceMetric): Float64Array {
  const f = domainFaces(metric.domain), p = metricPositions(metric), result = new Float64Array(metric.domain.faceCount);
  for (let i = 0; i < f.length; i += 3) {
    const a = f[i]! * 3, b = f[i + 1]! * 3, c = f[i + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const scale = Math.max(Math.abs(ux), Math.abs(uy), Math.abs(uz), Math.abs(vx), Math.abs(vy), Math.abs(vz));
    result[i / 3] = Math.hypot((uy / scale) * (vz / scale) - (uz / scale) * (vy / scale), (uz / scale) * (vx / scale) - (ux / scale) * (vz / scale), (ux / scale) * (vy / scale) - (uy / scale) * (vx / scale)) * scale / 2 * scale;
  }
  return result;
}

/** Lumped barycentric vertex areas, in square millimetres. */
export function computeVertexAreas(metric: SurfaceMetric): Float64Array {
  const areas = computeFaceAreas(metric), result = new Float64Array(metric.domain.vertexCount), faces = domainFaces(metric.domain);
  areas.forEach((area, face) => { for (let j = 0; j < 3; j++) result[faces[face * 3 + j]!]! += area / 3; });
  return result;
}
export interface SurfaceSummary {
  estimand: 'vertex-membership' | 'label-partition';
  totalAreaMm2: number;
  validAreaMm2: number;
  coverage: number;
  mean: number;
  integral: number;
}
export type SurfaceRegion = { mode: 'vertex-membership'; roi: Uint8Array } |
  { mode: 'label-partition'; labels: ArrayLike<number>; selectedLabels: readonly number[] };

export function summarizeSurfaceRegion(metric: SurfaceMetric, values: ArrayLike<number>, region: SurfaceRegion, validity?: Uint8Array): SurfaceSummary {
  const n = metric.domain.vertexCount;
  if (values.length !== n) throw new GeometryError('invalid-shape', 'Values must match metric');
  checkMask(validity, n);
  const valid = (v: number) => Number.isFinite(values[v]) && (!validity || !!validity[v]);
  let totalAreaMm2 = 0, validAreaMm2 = 0, integral = 0;
  if (region.mode === 'vertex-membership') {
    checkMask(region.roi, n);
    computeVertexAreas(metric).forEach((area, v) => { if (region.roi[v]) { totalAreaMm2 += area; if (valid(v)) { validAreaMm2 += area; integral += area * values[v]!; } } });
  } else {
    if (region.labels.length !== n) throw new GeometryError('invalid-shape', 'Labels must match metric');
    for (let v = 0; v < n; v++) if (!Number.isSafeInteger(region.labels[v]) || region.labels[v]! < -2147483648 || region.labels[v]! > 4294967295) throw new GeometryError('invalid-shape', 'Invalid label');
    const selected = new Set(region.selectedLabels), areas = computeFaceAreas(metric);
    const fraction = (a: BarycentricPoint, b: BarycentricPoint, c: BarycentricPoint) => Math.abs((b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]));
    for (let face = 0; face < metric.domain.faceCount; face++) {
      const vertices = metric.domain.triangle(face), pieces = partitionLabelTriangle(vertices.map(v => region.labels[v]!) as [number, number, number]).pieces;
      for (const piece of pieces) if (selected.has(piece.label)) for (let j = 1; j + 1 < piece.polygon.length; j++) {
        const tri = [piece.polygon[0]!, piece.polygon[j]!, piece.polygon[j + 1]!];
        const area = areas[face]! * fraction(tri[0]!, tri[1]!, tri[2]!); totalAreaMm2 += area;
        const coefficients = [0, 1, 2].map(k => tri.reduce((s, b) => s + b[k]!, 0) / 3);
        if (vertices.every((v, k) => coefficients[k] === 0 || valid(v))) {
          validAreaMm2 += area;
          integral += area * vertices.reduce((s, v, k) => s + (coefficients[k] === 0 ? 0 : coefficients[k]! * values[v]!), 0);
        }
      }
    }
  }
  return { estimand: region.mode, totalAreaMm2, validAreaMm2, coverage: totalAreaMm2 ? validAreaMm2 / totalAreaMm2 : 0, mean: validAreaMm2 ? integral / validAreaMm2 : NaN, integral: validAreaMm2 ? integral : NaN };
}

export interface SurfaceAreaClusters { mask: Uint8Array; clusterIds: Int32Array; areasMm2: Float64Array; sizes: Uint32Array; peaks: Float64Array; peakVertices: Uint32Array; /** Zero denotes a mixed-sign cluster in absolute mode. */ signs: Int8Array }
export function clusterSurfaceByArea(metric: SurfaceMetric, values: ArrayLike<number>, options: { threshold: number; minAreaMm2: number; signMode?: 'separate' | 'absolute'; validity?: Uint8Array }): SurfaceAreaClusters {
  const n = metric.domain.vertexCount;
  if (values.length !== n) throw new GeometryError('invalid-shape', 'Values must match metric');
  checkFinite(options.threshold, 'threshold', 0); checkFinite(options.minAreaMm2, 'minAreaMm2', 0); checkMask(options.validity, n);
  if (options.signMode !== undefined && options.signMode !== 'separate' && options.signMode !== 'absolute') throw new GeometryError('invalid-shape', 'Invalid sign mode');
  const areas = computeVertexAreas(metric), topo = topologyData(metric.domain.topology), ids = new Int32Array(n); ids.fill(-1);
  const active = (v: number) => Number.isFinite(values[v]) && Math.abs(values[v]!) > options.threshold && (!options.validity || !!options.validity[v]);
  const totals: number[] = [], sizes: number[] = [], peaks: number[] = [], peakVertices: number[] = [], signs: number[] = [], queue = new Uint32Array(n);
  for (let seed = 0; seed < n; seed++) if (ids[seed] === -1 && active(seed)) {
    const id = totals.length; let head = 0, tail = 1, area = 0, peak = seed, sign = Math.sign(values[seed]!); queue[0] = seed; ids[seed] = id;
    while (head < tail) {
      const v = queue[head++]!; area += areas[v]!;
      if (Math.sign(values[v]!) !== sign) sign = 0;
      if (Math.abs(values[v]!) > Math.abs(values[peak]!) || (Math.abs(values[v]!) === Math.abs(values[peak]!) && v < peak)) peak = v;
      for (let j = topo.neighborOffsets[v]!; j < topo.neighborOffsets[v + 1]!; j++) {
        const w = topo.neighbors[j]!;
        if (ids[w] === -1 && active(w) && (options.signMode === 'absolute' || Math.sign(values[w]!) === Math.sign(values[seed]!))) { ids[w] = id; queue[tail++] = w; }
      }
    }
    totals.push(area); sizes.push(tail); peaks.push(values[peak]!); peakVertices.push(peak); signs.push(sign);
  }
  return { mask: Uint8Array.from(ids, id => id >= 0 && totals[id]! >= options.minAreaMm2 ? 1 : 0), clusterIds: ids, areasMm2: Float64Array.from(totals), sizes: Uint32Array.from(sizes), peaks: Float64Array.from(peaks), peakVertices: Uint32Array.from(peakVertices), signs: Int8Array.from(signs) };
}
