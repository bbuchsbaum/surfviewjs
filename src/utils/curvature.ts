import { SurfaceGeometry } from '../classes';
import { buildVertexAdjacency } from './meshAdjacency';
import { finiteNumber } from './validation';

/** Compressed vertex adjacency: neighbours of v are `index[offset[v]..offset[v+1])`. */
interface CompactAdjacency {
  offset: Uint32Array;
  index: Uint32Array;
}

function compactAdjacency(geometry: SurfaceGeometry): CompactAdjacency {
  const vertexCount = geometry.vertices.length / 3;
  const { neighbors } = buildVertexAdjacency(geometry.faces, vertexCount);
  const offset = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) offset[i + 1] = offset[i]! + neighbors[i]!.size;
  const index = new Uint32Array(offset[vertexCount]!);
  for (let i = 0; i < vertexCount; i++) {
    let k = offset[i]!;
    for (const j of neighbors[i]!) index[k++] = j;
  }
  return { offset, index };
}

/**
 * Area-weighted vertex normals from the face winding (unnormalised face
 * normals summed per vertex, then normalised). Counter-clockwise faces seen
 * from outside give outward normals.
 */
function vertexNormals(positions: ArrayLike<number>, faces: ArrayLike<number>, vertexCount: number): Float32Array {
  const normals = new Float32Array(vertexCount * 3);
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f]! * 3, b = faces[f + 1]! * 3, c = faces[f + 2]! * 3;
    const e1x = positions[b]! - positions[a]!, e1y = positions[b + 1]! - positions[a + 1]!, e1z = positions[b + 2]! - positions[a + 2]!;
    const e2x = positions[c]! - positions[a]!, e2y = positions[c + 1]! - positions[a + 1]!, e2z = positions[c + 2]! - positions[a + 2]!;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      normals[v] = normals[v]! + nx;
      normals[v + 1] = normals[v + 1]! + ny;
      normals[v + 2] = normals[v + 2]! + nz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v]!, normals[v + 1]!, normals[v + 2]!);
    if (length > 0) {
      normals[v] = normals[v]! / length;
      normals[v + 1] = normals[v + 1]! / length;
      normals[v + 2] = normals[v + 2]! / length;
    }
  }
  return normals;
}

/** One explicit umbrella step per iteration: x ← (1 − λ)·x + λ·mean(neighbours). */
function smoothScalar(values: Float32Array, adjacency: CompactAdjacency, iterations: number, lambda = 0.5): Float32Array {
  // Work on copies so the caller's array is never overwritten.
  let current = Float32Array.from(values);
  let next = new Float32Array(values.length);
  const { offset, index } = adjacency;
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let i = 0; i < current.length; i++) {
      const start = offset[i]!, end = offset[i + 1]!;
      if (end === start) {
        next[i] = current[i]!;
        continue;
      }
      let sum = 0;
      for (let k = start; k < end; k++) sum += current[index[k]!]!;
      next[i] = (1 - lambda) * current[i]! + lambda * (sum / (end - start));
    }
    const swap = current;
    current = next;
    next = swap;
  }
  return current;
}

/** Options for {@link computeMeanCurvature}. */
export interface MeanCurvatureOptions {
  /**
   * Umbrella smoothing passes applied to the per-vertex estimate (λ = 0.5).
   * Two passes suppress single-vertex noise on tessellated cortical meshes
   * without blurring sulcal walls. Default 2; 0 returns the raw estimate.
   */
  smoothingIterations?: number;
}

/**
 * Compute mean curvature for each vertex of a mesh, in the FreeSurfer sign
 * convention: **positive in concave regions (sulci), negative on convex
 * regions (gyral crowns)**.
 *
 * The estimate projects the umbrella (uniform Laplacian) vector, from the
 * vertex to the centroid of its neighbours, onto the area-weighted vertex
 * normal and divides by the squared mean edge length at the vertex:
 *
 *   H ≈ 2 · ((mean(neighbours) − v) · n) / ē²
 *
 * Normalising by the edge length makes the result an approximation of mean
 * curvature in inverse mesh units (1/mm for cortical meshes), so values are
 * comparable across mesh resolutions; a sphere of radius R gives ≈ −1/R.
 *
 * Normals come from the face winding, so the mesh must be wound with outward
 * normals (FreeSurfer and GIFTI surfaces are). Curvature is only meaningful on
 * folded (white, pial or midthickness) surfaces: on inflated, very inflated or
 * flat surfaces, compute it from the folded surface with the same topology, or
 * use {@link computeSulcalDepth} or a FreeSurfer `.sulc`/`.curv` file.
 *
 * @param geometry - The surface geometry to compute curvature for
 * @param options - Smoothing of the per-vertex estimate
 * @returns Float32Array of mean curvature values per vertex
 */
export function computeMeanCurvature(
  geometry: SurfaceGeometry,
  options: MeanCurvatureOptions = {}
): Float32Array {
  const smoothingIterations = finiteNumber(options.smoothingIterations ?? 2, 'smoothingIterations', {
    minimum: 0,
    integer: true
  });
  const vertices = geometry.vertices;
  const vertexCount = vertices.length / 3;
  const adjacency = compactAdjacency(geometry);
  const normals = vertexNormals(vertices, geometry.faces, vertexCount);
  const curvature = new Float32Array(vertexCount);
  const { offset, index } = adjacency;

  for (let i = 0; i < vertexCount; i++) {
    const start = offset[i]!, end = offset[i + 1]!;
    if (end === start) continue;
    const vx = vertices[i * 3]!, vy = vertices[i * 3 + 1]!, vz = vertices[i * 3 + 2]!;
    let cx = 0, cy = 0, cz = 0, edge = 0;
    for (let k = start; k < end; k++) {
      const j = index[k]! * 3;
      const dx = vertices[j]! - vx, dy = vertices[j + 1]! - vy, dz = vertices[j + 2]! - vz;
      cx += dx; cy += dy; cz += dz;
      edge += Math.hypot(dx, dy, dz);
    }
    const n = end - start;
    const meanEdge = edge / n;
    if (!(meanEdge > 0)) continue;
    const projected = (cx * normals[i * 3]! + cy * normals[i * 3 + 1]! + cz * normals[i * 3 + 2]!) / n;
    curvature[i] = (2 * projected) / (meanEdge * meanEdge);
  }

  return smoothingIterations > 0 ? smoothScalar(curvature, adjacency, smoothingIterations) : curvature;
}

/** Options for {@link computeSulcalDepth}. */
export interface SulcalDepthOptions {
  /**
   * Smoothing scale as a fraction of the mesh's bounding-sphere radius: the
   * diffusion length of the smoothing that builds the reference envelope.
   * Default 0.2, calibrated on fsaverage5 (r = 0.96 against FreeSurfer
   * `lh.sulc`; 0.15–0.25 all give r ≥ 0.94).
   */
  scale?: number;
  /** Relative residual at which each linear solve stops. Default 1e-3. */
  tolerance?: number;
  /**
   * Conjugate-gradient iterations allowed per solve. Default 2000, far above
   * what cortical meshes need (about 25 for fsaverage5, 45 for fs_LR 32k);
   * reaching it logs a warning and returns the unconverged estimate.
   */
  maxIterations?: number;
}

/** Implicit smoothing steps; two match explicit diffusion closely (see computeSulcalDepth). */
const SULCAL_DEPTH_STEPS = 2;

/**
 * Solve (D + h·(D − A)) x = D·b per coordinate by Jacobi-preconditioned
 * conjugate gradients, warm-started at b, where D is the vertex degree and A
 * the adjacency: one implicit (backward Euler) step of graph-Laplacian
 * smoothing. Each solve stops when the residual falls to `tolerance` × ‖D·b‖;
 * the caller centres the coordinates so that norm measures the shape, not
 * the mesh's distance from the origin. Returns false if any solve reached
 * `maxIterations`.
 */
function implicitSmoothStep(
  positions: Float64Array,
  adjacency: CompactAdjacency,
  h: number,
  tolerance: number,
  maxIterations: number
): boolean {
  const { offset, index } = adjacency;
  const n = offset.length - 1;
  const diagonal = new Float64Array(n);
  for (let i = 0; i < n; i++) diagonal[i] = (offset[i + 1]! - offset[i]!) * (1 + h) || 1;
  const multiply = (x: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const start = offset[i]!, end = offset[i + 1]!;
      if (end === start) { out[i] = x[i]!; continue; }
      let sum = 0;
      for (let k = start; k < end; k++) sum += x[index[k]!]!;
      out[i] = diagonal[i]! * x[i]! - h * sum;
    }
  };
  const x = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n);
  const p = new Float64Array(n), q = new Float64Array(n);
  let converged = true;
  for (let axis = 0; axis < 3; axis++) {
    let bNorm = 0;
    for (let i = 0; i < n; i++) {
      x[i] = positions[i * 3 + axis]!;
      const degree = offset[i + 1]! - offset[i]!;
      const b = (degree || 1) * x[i]!;
      r[i] = b;
      bNorm += b * b;
    }
    multiply(x, q);
    let rz = 0;
    for (let i = 0; i < n; i++) {
      r[i] = r[i]! - q[i]!;
      z[i] = r[i]! / diagonal[i]!;
      p[i] = z[i]!;
      rz += r[i]! * z[i]!;
    }
    const stop = tolerance * tolerance * bNorm;
    let iteration = 0;
    let rNorm = 0;
    for (let i = 0; i < n; i++) rNorm += r[i]! * r[i]!;
    while (rNorm > stop && iteration < maxIterations) {
      multiply(p, q);
      let pq = 0;
      for (let i = 0; i < n; i++) pq += p[i]! * q[i]!;
      const alpha = rz / pq;
      let nextRz = 0;
      rNorm = 0;
      for (let i = 0; i < n; i++) {
        x[i] = x[i]! + alpha * p[i]!;
        r[i] = r[i]! - alpha * q[i]!;
        z[i] = r[i]! / diagonal[i]!;
        nextRz += r[i]! * z[i]!;
        rNorm += r[i]! * r[i]!;
      }
      const beta = nextRz / rz;
      rz = nextRz;
      for (let i = 0; i < n; i++) p[i] = z[i]! + beta * p[i]!;
      iteration++;
    }
    if (rNorm > stop) converged = false;
    for (let i = 0; i < n; i++) positions[i * 3 + axis] = x[i]!;
  }
  return converged;
}

/**
 * Estimate sulcal depth (FreeSurfer `sulc`-like) from a folded surface, in
 * mesh units (mm). **Positive values are deep (sulcal fundi), negative values
 * are superficial (gyral crowns)**, as in FreeSurfer; the result is
 * median-centred.
 *
 * A copy of the surface is smoothed into an envelope that flattens the folds,
 * and depth is the displacement of each vertex from its smoothed position,
 * measured along the envelope's outward normal. Unlike mean curvature, depth is
 * smooth over whole sulci and gyri, which makes it the conventional underlay
 * for inflated and flat surfaces: compute it on the folded surface and display
 * it on the inflated one.
 *
 * Smoothing is two implicit (backward Euler) graph-Laplacian steps whose total
 * diffusion length is `scale` × the bounding radius, each solved by
 * Jacobi-preconditioned conjugate gradients. The number of CG iterations grows
 * with √V (the ratio of brain size to edge length), so the cost is about
 * O(V^1.5), against O(V²) for explicit smoothing at a fixed physical scale.
 * Measured under vitest on Apple silicon: ≈70 ms for fsaverage5 (10k
 * vertices), ≈0.2 s at 41k, ≈1.7 s at 164k (fsaverage resolution) and ≈13 s
 * at 655k. Compute it once and keep it; never per frame. The result does not
 * depend on where the mesh sits in space, and vertices in no face are ignored
 * (depth 0). Agreement with FreeSurfer `lh.sulc` on fsaverage5 is r = 0.96.
 *
 * @param geometry - A folded (white, pial or midthickness) surface with outward winding
 * @param options - Smoothing scale and solver limits
 * @returns Float32Array of depth values per vertex
 */
export function computeSulcalDepth(
  geometry: SurfaceGeometry,
  options: SulcalDepthOptions = {}
): Float32Array {
  const scale = finiteNumber(options.scale ?? 0.2, 'scale', { minimum: 0, minimumExclusive: true, maximum: 1 });
  const tolerance = finiteNumber(options.tolerance ?? 1e-3, 'tolerance', {
    minimum: 0,
    minimumExclusive: true,
    maximum: 1,
    maximumExclusive: true
  });
  const maxIterations = finiteNumber(options.maxIterations ?? 2000, 'maxIterations', { minimum: 1, integer: true });
  const vertices = geometry.vertices;
  const faces = geometry.faces;
  const vertexCount = vertices.length / 3;
  const adjacency = compactAdjacency(geometry);
  const { offset, index } = adjacency;
  // Vertices in no face carry no surface; they take no part in the bounds,
  // the scale, the median or the result (depth 0).
  const referenced = (i: number) => offset[i + 1]! > offset[i]!;

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    if (!referenced(i)) continue;
    const v = i * 3;
    minX = Math.min(minX, vertices[v]!); maxX = Math.max(maxX, vertices[v]!);
    minY = Math.min(minY, vertices[v + 1]!); maxY = Math.max(maxY, vertices[v + 1]!);
    minZ = Math.min(minZ, vertices[v + 2]!); maxZ = Math.max(maxZ, vertices[v + 2]!);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  // Work in float64 about the bounding-box centre. Smoothing commutes with a
  // translation (the system matrix maps constants to D·constants), so this is
  // exact, and it keeps the solver's relative tolerance and float precision
  // independent of where the mesh sits in space.
  const centred = new Float64Array(vertices.length);
  let radius = 0;
  let edgeSum = 0;
  for (let i = 0; i < vertexCount; i++) {
    if (!referenced(i)) continue;
    const x = vertices[i * 3]! - cx, y = vertices[i * 3 + 1]! - cy, z = vertices[i * 3 + 2]! - cz;
    centred[i * 3] = x; centred[i * 3 + 1] = y; centred[i * 3 + 2] = z;
    radius = Math.max(radius, Math.hypot(x, y, z));
    for (let k = offset[i]!; k < offset[i + 1]!; k++) {
      const j = index[k]! * 3;
      edgeSum += Math.hypot(vertices[j]! - vertices[i * 3]!, vertices[j + 1]! - vertices[i * 3 + 1]!, vertices[j + 2]! - vertices[i * 3 + 2]!);
    }
  }
  const meanEdge = index.length > 0 ? edgeSum / index.length : 0;
  if (!(meanEdge > 0) || !(radius > 0)) return new Float32Array(vertexCount);

  // Diffusion time (in edge-length units) whose length is scale × radius,
  // split over the implicit steps.
  const ratio = (scale * radius) / meanEdge;
  const h = (2 * ratio * ratio) / SULCAL_DEPTH_STEPS;
  const envelope = Float64Array.from(centred);
  let converged = true;
  for (let step = 0; step < SULCAL_DEPTH_STEPS; step++) {
    converged = implicitSmoothStep(envelope, adjacency, h, tolerance, maxIterations) && converged;
  }
  if (!converged) {
    console.warn(
      `computeSulcalDepth: smoothing did not reach tolerance ${tolerance} within ${maxIterations} ` +
      'iterations; the depth estimate is approximate. Raise maxIterations or tolerance.'
    );
  }

  const envelopeNormals = vertexNormals(envelope, faces, vertexCount);
  const depth = new Float32Array(vertexCount);
  const values: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    if (!referenced(i)) continue;
    const p = i * 3;
    // Inward displacement from the envelope is depth (FreeSurfer sign).
    const d = -(
      (centred[p]! - envelope[p]!) * envelopeNormals[p]! +
      (centred[p + 1]! - envelope[p + 1]!) * envelopeNormals[p + 1]! +
      (centred[p + 2]! - envelope[p + 2]!) * envelopeNormals[p + 2]!
    );
    depth[i] = d;
    values.push(d);
  }
  values.sort((a, b) => a - b);
  const center = values.length > 0 ? values[Math.floor(values.length / 2)]! : 0;
  for (let i = 0; i < vertexCount; i++) {
    if (referenced(i)) depth[i] = depth[i]! - center;
  }
  return depth;
}

/**
 * Normalize curvature values to a standard range for display.
 * Maps curvature to roughly [-1, 1] based on percentiles to handle outliers.
 *
 * @param curvature - Raw curvature values
 * @param percentile - Percentile to use for normalization (default: 98)
 * @returns Normalized curvature values
 */
export function normalizeCurvature(
  curvature: Float32Array,
  percentile: number = 98
): Float32Array {
  const validPercentile = finiteNumber(percentile, 'percentile', { minimum: 0, maximum: 100 });
  if (curvature.length === 0) return new Float32Array(0);
  // Sort absolute values to find percentile
  const sorted = Array.from(curvature).map(Math.abs).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * validPercentile / 100));
  const scale = sorted[idx] || 1;

  const normalized = new Float32Array(curvature.length);
  for (let i = 0; i < curvature.length; i++) {
    normalized[i] = Math.max(-1, Math.min(1, curvature[i]! / scale));
  }

  return normalized;
}

/**
 * Convert curvature (or sulcal depth) values to grayscale for display, with
 * gyri light and sulci dark:
 *   gray = brightness − clamp(curvature / smoothness, −0.5, 0.5) · contrast
 *
 * Input follows the FreeSurfer convention (positive in sulci, negative on
 * gyral crowns), as returned by {@link computeMeanCurvature},
 * {@link computeSulcalDepth} and FreeSurfer `.curv`/`.sulc` files. Pass
 * `invert: true` for data with the opposite sign, or to reproduce the
 * mapping of earlier releases (`brightness + scaled · contrast`). A small `smoothness`
 * (≈0.2–0.5 on normalised input) gives a near-binary, FreeSurfer-like
 * underlay; 1 gives a graded one.
 *
 * Grey levels are display (sRGB) values.
 *
 * @param curvature - Curvature values (ideally normalized to ~[-1, 1])
 * @param options - Display options
 * @returns Grayscale values in [0, 1] range
 */
export function curvatureToGrayscale(
  curvature: Float32Array,
  options: {
    brightness?: number;  // Base gray level, default 0.5
    contrast?: number;    // How much curvature affects brightness, default 0.5
    smoothness?: number;  // Divisor for curvature, higher = more subtle, default 1
    invert?: boolean;     // true: positive curvature renders lighter, default false
  } = {}
): Float32Array {
  const {
    brightness = 0.5,
    contrast = 0.5,
    smoothness = 1,
    invert = false
  } = options;
  if (typeof invert !== 'boolean') throw new TypeError('invert must be a boolean');
  const sign = invert ? 1 : -1;
  const validBrightness = finiteNumber(brightness, 'brightness');
  const validContrast = finiteNumber(contrast, 'contrast');
  const validSmoothness = finiteNumber(smoothness, 'smoothness', {
    minimum: 0,
    minimumExclusive: true
  });

  const grayscale = new Float32Array(curvature.length);

  for (let i = 0; i < curvature.length; i++) {
    // Clamp curvature/smoothness to [-0.5, 0.5]
    const scaled = Math.max(-0.5, Math.min(0.5, curvature[i]! / validSmoothness));
    // Apply contrast and brightness
    const gray = sign * scaled * validContrast + validBrightness;
    // Clamp to valid range
    grayscale[i] = Math.max(0, Math.min(1, gray));
  }

  return grayscale;
}
