import { validateSurfaceGeometryData } from '../classes';
import { finiteNumber } from '../utils/validation';
import type { AtlasPlateInput, AtlasPlateOrientation, AtlasRaster } from './types';

export function validateAtlasInput(input: AtlasPlateInput): void {
  validateSurfaceGeometryData(input.vertices, input.faces);
  if (input.hemisphere !== 'left' && input.hemisphere !== 'right') {
    throw new RangeError('hemisphere must be left or right');
  }
  if (!input.parcelData.atlas.id || !input.parcelData.atlas.name) {
    throw new TypeError('Atlas plates require atlas id and name');
  }
  if (input.vertexLabels.length !== input.vertices.length / 3) {
    throw new RangeError('vertexLabels must match the mesh vertex count and ordering');
  }
  const ids = new Set<number>([0]);
  for (const parcel of input.parcelData.parcels) {
    finiteNumber(parcel.id, 'parcel.id', { minimum: 1, maximum: 0xffffffff, integer: true });
    if (ids.has(parcel.id)) throw new RangeError(`Duplicate parcel id ${parcel.id}`);
    if (typeof parcel.label !== 'string' || !parcel.label.trim()) {
      throw new TypeError(`Parcel ${parcel.id} requires a label`);
    }
    if (parcel.hemi !== null && parcel.hemi !== input.hemisphere) {
      throw new RangeError(`Parcel ${parcel.id} hemisphere does not match the surface`);
    }
    ids.add(parcel.id);
  }
  for (let i = 0; i < input.vertexLabels.length; i++) {
    const id = finiteNumber(input.vertexLabels[i], `vertexLabels[${i}]`, {
      minimum: 0, maximum: 0xffffffff, integer: true
    });
    if (!ids.has(id)) throw new RangeError(`Missing parcel metadata for label ${id}`);
  }
}

/**
 * Orthographic CPU depth test, including zero-labeled occluders. Each sample
 * takes the label of the largest barycentric coordinate (categorical nearest
 * corner); this partitions mixed faces without interpolating categorical IDs.
 */
export function projectAtlas(
  input: AtlasPlateInput, view: AtlasPlateOrientation,
  width: number, height: number, padding: number, resolution: number
): AtlasRaster {
  const rw = Math.round(width * resolution);
  const rh = Math.round(height * resolution);
  const projected = new Float64Array(input.vertices.length);
  const sign = (input.hemisphere === 'left' ? 1 : -1) * (view === 'medial' ? 1 : -1);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < input.vertices.length; i += 3) {
    const x = sign * input.vertices[i + 1]!;
    const y = -input.vertices[i + 2]!;
    projected[i] = x;
    projected[i + 1] = y;
    projected[i + 2] = sign * input.vertices[i]!;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX === minX || maxY === minY) throw new RangeError('Surface has no area in this view');
  const scale = Math.min((width - 2 * padding) / (maxX - minX),
    (height - 2 * padding) / (maxY - minY)) * resolution;
  for (let i = 0; i < projected.length; i += 3) {
    projected[i] = (projected[i]! - (minX + maxX) / 2) * scale + rw / 2;
    projected[i + 1] = (projected[i + 1]! - (minY + maxY) / 2) * scale + rh / 2;
  }
  const ids = new Uint32Array(rw * rh);
  const depth = new Float64Array(rw * rh).fill(-Infinity);
  const faces = input.faces;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f]!, b = faces[f + 1]!, c = faces[f + 2]!;
    const ax = projected[a * 3]!, ay = projected[a * 3 + 1]!, az = projected[a * 3 + 2]!;
    const bx = projected[b * 3]!, by = projected[b * 3 + 1]!, bz = projected[b * 3 + 2]!;
    const cx = projected[c * 3]!, cy = projected[c * 3 + 1]!, cz = projected[c * 3 + 2]!;
    const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(determinant) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(rw - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(rh - 1, Math.ceil(Math.max(ay, by, cy)));
    const ia = input.vertexLabels[a]!, ib = input.vertexLabels[b]!, ic = input.vertexLabels[c]!;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wa = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / determinant;
        const wb = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / determinant;
        const wc = 1 - wa - wb;
        if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
        const z = wa * az + wb * bz + wc * cz;
        const index = y * rw + x;
        let id = ia, weight = wa;
        if (wb > weight || (wb === weight && ib < id)) { id = ib; weight = wb; }
        if (wc > weight || (wc === weight && ic < id)) id = ic;
        if (z > depth[index]! + 1e-9 ||
            (Math.abs(z - depth[index]!) <= 1e-9 && id < ids[index]!)) {
          depth[index] = z;
          ids[index] = id;
        }
      }
    }
  }
  return { width: rw, height: rh, resolution, ids };
}
