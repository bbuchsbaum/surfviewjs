import { LaplacianSmoothing } from '@src/index.js';

/**
 * Geometry derived in the browser from a real pial mesh, for the Anatomy chapter.
 * Both are approximations of what FreeSurfer produces offline (mris_inflate,
 * mris_flatten); the chapter says so in its synthetic note.
 */

function centroidOf(vertices: Float32Array): [number, number, number] {
  let x = 0, y = 0, z = 0;
  const n = vertices.length / 3;
  for (let v = 0; v < n; v++) {
    x += vertices[v * 3]!;
    y += vertices[v * 3 + 1]!;
    z += vertices[v * 3 + 2]!;
  }
  return [x / n, y / n, z / n];
}

function rmsRadius(vertices: Float32Array, center: readonly [number, number, number]): number {
  let sum = 0;
  const n = vertices.length / 3;
  for (let v = 0; v < n; v++) {
    const dx = vertices[v * 3]! - center[0], dy = vertices[v * 3 + 1]! - center[1], dz = vertices[v * 3 + 2]! - center[2];
    sum += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(sum / n);
}

/**
 * Inflate by Laplacian smoothing, then rescale about the centroid so the smoothed
 * hemisphere keeps the folded one's RMS size and position. Vertex order is preserved,
 * so the result is a valid morph target or surface variant.
 */
export function inflateMesh(vertices: Float32Array, faces: Uint32Array, iterations: number, lambda = 0.6): Float32Array {
  const center = centroidOf(vertices);
  const before = rmsRadius(vertices, center);
  const out = LaplacianSmoothing.smooth(vertices.slice(), faces, iterations, lambda);
  const shifted = centroidOf(out);
  const scale = before / Math.max(1e-6, rmsRadius(out, shifted));
  for (let v = 0; v < out.length / 3; v++) {
    for (let axis = 0; axis < 3; axis++) {
      out[v * 3 + axis] = center[axis]! + (out[v * 3 + axis]! - shifted[axis]!) * scale;
    }
  }
  return out;
}

export interface FlatProjection {
  /** x, y in map units, z = 0; same vertex order as the source mesh. */
  vertices: Float32Array;
  /** Faces kept on the map; triangles torn by the cut on the medial wall are dropped. */
  faces: Uint32Array;
  droppedFaces: number;
}

/**
 * Lambert azimuthal equal-area projection of an inflated hemisphere, centred on its
 * lateral pole (superior up, anterior to the left for the left hemisphere, as seen
 * from the side). The antipode, on the medial wall, becomes the map's rim; faces
 * stretched across it are dropped from the map.
 */
export function projectFlat(inflated: Float32Array, faces: Uint32Array, hemisphere: 'left' | 'right'): FlatProjection {
  const n = inflated.length / 3;
  const center = centroidOf(inflated);
  const spread = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    for (let axis = 0; axis < 3; axis++) spread[axis] += (inflated[v * 3 + axis]! - center[axis]!) ** 2;
  }
  const scale = spread.map(value => Math.sqrt(value / n) || 1);
  const lateral = hemisphere === 'left' ? -1 : 1;
  // Screen-right as seen from the lateral side: posterior for the left hemisphere.
  const rightY = hemisphere === 'left' ? -1 : 1;
  const flat = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    let px = (inflated[v * 3]! - center[0]) / scale[0]!;
    let py = (inflated[v * 3 + 1]! - center[1]) / scale[1]!;
    let pz = (inflated[v * 3 + 2]! - center[2]) / scale[2]!;
    const length = Math.hypot(px, py, pz) || 1;
    px /= length; py /= length; pz /= length;
    const cosine = px * lateral;
    const k = Math.sqrt(2 / Math.max(1e-4, 1 + cosine));
    flat[v * 3] = k * py * rightY;
    flat[v * 3 + 1] = k * pz;
  }

  const edge = (a: number, b: number) => Math.hypot(flat[a * 3]! - flat[b * 3]!, flat[a * 3 + 1]! - flat[b * 3 + 1]!);
  const lengths = new Float32Array(faces.length / 3);
  for (let f = 0; f < lengths.length; f++) {
    const a = faces[f * 3]!, b = faces[f * 3 + 1]!, c = faces[f * 3 + 2]!;
    lengths[f] = Math.max(edge(a, b), edge(b, c), edge(c, a));
  }
  const median = Float32Array.from(lengths).sort()[lengths.length >> 1]!;
  const kept: number[] = [];
  for (let f = 0; f < lengths.length; f++) {
    if (lengths[f]! <= median * 6) kept.push(faces[f * 3]!, faces[f * 3 + 1]!, faces[f * 3 + 2]!);
  }
  return { vertices: flat, faces: Uint32Array.from(kept), droppedFaces: lengths.length - kept.length / 3 };
}
