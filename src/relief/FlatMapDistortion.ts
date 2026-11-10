import { FlatMapChart, chartStorage } from '../flatmap/FlatMapChart';
import { GeometryError } from '../geometry/GeometryError';
import { SurfaceMetric } from '../geometry/SurfaceDomain';
import { computeFaceAreas } from '../geometry/SurfaceArea';

export interface FlatMapDistortion {
  /** Chart/anatomical area; dimensionless only with calibrated chart coordinates. */
  areaRatio: Float64Array;
  /** Area ratio normalized by total represented chart/anatomical area. */
  relativeAreaRatio: Float64Array;
  /** Largest/smallest singular value of the per-face map, independent of unit scale. */
  anisotropy: Float64Array;
  chartArea: number;
  anatomicalAreaMm2: number;
}

export function computeFlatMapDistortion(chart: FlatMapChart, metric: SurfaceMetric): FlatMapDistortion {
  if (metric.domain !== chart.domain) throw new GeometryError('invalid-domain', 'Distortion metric must share the chart anatomical domain');
  const c = chartStorage(chart), p = metric.copyPositions(), anatomicalAreas = computeFaceAreas(metric);
  const areaRatio = new Float64Array(chart.faceCount), relativeAreaRatio = new Float64Array(chart.faceCount), anisotropy = new Float64Array(chart.faceCount);
  let chartArea = 0, anatomicalAreaMm2 = 0;
  for (let face = 0; face < chart.faceCount; face++) {
    const a = c.faces[face * 3]!, b = c.faces[face * 3 + 1]!, d = c.faces[face * 3 + 2]!;
    const ia = c.vertices[a]! * 3, ib = c.vertices[b]! * 3, ic = c.vertices[d]! * 3;
    const ux = p[ib]! - p[ia]!, uy = p[ib + 1]! - p[ia + 1]!, uz = p[ib + 2]! - p[ia + 2]!;
    const vx = p[ic]! - p[ia]!, vy = p[ic + 1]! - p[ia + 1]!, vz = p[ic + 2]! - p[ia + 2]!;
    const length = Math.hypot(ux, uy, uz), projection = (ux * vx + uy * vy + uz * vz) / length;
    const height = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / length;
    const qx = c.xy[b * 2]! - c.xy[a * 2]!, qy = c.xy[b * 2 + 1]! - c.xy[a * 2 + 1]!;
    const rx = c.xy[d * 2]! - c.xy[a * 2]!, ry = c.xy[d * 2 + 1]! - c.xy[a * 2 + 1]!;
    // J = [q r] * inverse([length projection; 0 height]).
    const j00 = qx / length, j10 = qy / length;
    const j01 = (rx - qx * projection / length) / height, j11 = (ry - qy * projection / length) / height;
    const scale = Math.max(Math.abs(j00), Math.abs(j01), Math.abs(j10), Math.abs(j11));
    const aa = j00 / scale, bb = j01 / scale, cc = j10 / scale, dd = j11 / scale;
    const trace = aa * aa + bb * bb + cc * cc + dd * dd, determinant = Math.abs(aa * dd - bb * cc);
    const maximumSquared = (trace + Math.sqrt(Math.max(0, trace * trace - 4 * determinant * determinant))) / 2;
    const ratio = maximumSquared / determinant;
    if (!Number.isFinite(ratio) || !(determinant > 0)) throw new GeometryError('degenerate-geometry', `Invalid distortion face ${face}`);
    anisotropy[face] = ratio;
    const area = Math.abs(qx * ry - qy * rx) / 2, anatomicalArea = anatomicalAreas[c.anatomicalFaces[face]!]!;
    areaRatio[face] = area / anatomicalArea;
    chartArea += area; anatomicalAreaMm2 += anatomicalArea;
  }
  const normalization = anatomicalAreaMm2 / chartArea;
  areaRatio.forEach((ratio, f) => { relativeAreaRatio[f] = ratio * normalization; });
  return { areaRatio, relativeAreaRatio, anisotropy, chartArea, anatomicalAreaMm2 };
}

/** A display calibration, not a claim that a flattened sheet preserves local anatomy. */
export function flatMapAreaCalibration(chart: FlatMapChart, metric: SurfaceMetric): number {
  const result = computeFlatMapDistortion(chart, metric);
  return Math.sqrt(result.anatomicalAreaMm2 / result.chartArea);
}
