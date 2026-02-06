import { SurfaceGeometry } from '../classes';
import * as THREE from 'three';

/**
 * Compute mean curvature for each vertex of a mesh.
 *
 * Uses the umbrella operator (uniform Laplacian) as a fast approximation:
 * H ≈ |v - mean(neighbors)| with sign determined by the vertex normal.
 *
 * NOTE: This is only meaningful on folded (pial) surfaces.
 * On inflated or flat surfaces, curvature will be near-zero.
 * For those cases, load pre-computed curvature from the original folded surface.
 *
 * @param geometry - The surface geometry to compute curvature for
 * @returns Float32Array of mean curvature values per vertex
 */
export function computeMeanCurvature(geometry: SurfaceGeometry): Float32Array {
  const vertices = geometry.vertices;
  const faces = geometry.faces;
  const vertexCount = vertices.length / 3;

  // Build adjacency structure: neighbors and adjacent faces per vertex
  const neighbors: Set<number>[] = new Array(vertexCount);
  const vertexFaces: number[][] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    neighbors[i] = new Set();
    vertexFaces[i] = [];
  }

  // Build neighbor lists and vertex-to-face map from faces
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i];
    const b = faces[i + 1];
    const c = faces[i + 2];
    const faceIdx = i / 3;
    neighbors[a].add(b);
    neighbors[a].add(c);
    neighbors[b].add(a);
    neighbors[b].add(c);
    neighbors[c].add(a);
    neighbors[c].add(b);
    vertexFaces[a].push(faceIdx);
    vertexFaces[b].push(faceIdx);
    vertexFaces[c].push(faceIdx);
  }

  const curvature = new Float32Array(vertexCount);

  // Reusable vectors to avoid per-vertex allocation
  const vertexPos = new THREE.Vector3();
  const neighborPos = new THREE.Vector3();
  const tempVec = new THREE.Vector3();
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < vertexCount; i++) {
    vertexPos.set(
      vertices[i * 3],
      vertices[i * 3 + 1],
      vertices[i * 3 + 2]
    );

    const neighborSet = neighbors[i];
    if (neighborSet.size === 0) {
      curvature[i] = 0;
      continue;
    }

    // Compute mean curvature using umbrella operator (simplified Laplacian)
    let sumX = 0, sumY = 0, sumZ = 0;

    for (const j of neighborSet) {
      sumX += vertices[j * 3];
      sumY += vertices[j * 3 + 1];
      sumZ += vertices[j * 3 + 2];
    }

    const n = neighborSet.size;
    neighborPos.set(sumX / n, sumY / n, sumZ / n);

    // Vector from vertex to centroid of neighbors
    tempVec.subVectors(neighborPos, vertexPos);

    // Compute vertex normal from adjacent faces using pre-built vertex-to-face map
    normal.set(0, 0, 0);
    v0.copy(vertexPos);
    let faceCount = 0;

    for (const fi of vertexFaces[i]) {
      const a = faces[fi * 3];
      const b = faces[fi * 3 + 1];
      const c = faces[fi * 3 + 2];

      // Get the other two vertices
      let i1: number, i2: number;
      if (a === i) { i1 = b; i2 = c; }
      else if (b === i) { i1 = c; i2 = a; }
      else { i1 = a; i2 = b; }

      v1.set(vertices[i1 * 3], vertices[i1 * 3 + 1], vertices[i1 * 3 + 2]);
      v2.set(vertices[i2 * 3], vertices[i2 * 3 + 1], vertices[i2 * 3 + 2]);

      edge1.subVectors(v1, v0);
      edge2.subVectors(v2, v0);
      faceNormal.crossVectors(edge1, edge2);

      if (faceNormal.lengthSq() > 0) {
        faceNormal.normalize();
        normal.add(faceNormal);
        faceCount++;
      }
    }

    if (faceCount > 0) {
      normal.divideScalar(faceCount);
      normal.normalize();
    }

    // Curvature magnitude with sign based on normal direction
    const magnitude = tempVec.length();
    const sign = tempVec.dot(normal) > 0 ? 1 : -1;

    curvature[i] = sign * magnitude;
  }

  return curvature;
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
  // Sort absolute values to find percentile
  const sorted = Array.from(curvature).map(Math.abs).sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * percentile / 100);
  const scale = sorted[idx] || 1;

  const normalized = new Float32Array(curvature.length);
  for (let i = 0; i < curvature.length; i++) {
    normalized[i] = Math.max(-1, Math.min(1, curvature[i] / scale));
  }

  return normalized;
}

/**
 * Convert curvature values to grayscale for display.
 * Follows the pycortex convention:
 *   gray = clamp(curvature / smoothness, -0.5, 0.5) * contrast + brightness
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
  } = {}
): Float32Array {
  const {
    brightness = 0.5,
    contrast = 0.5,
    smoothness = 1
  } = options;

  const grayscale = new Float32Array(curvature.length);

  for (let i = 0; i < curvature.length; i++) {
    // Clamp curvature/smoothness to [-0.5, 0.5]
    const scaled = Math.max(-0.5, Math.min(0.5, curvature[i] / smoothness));
    // Apply contrast and brightness
    const gray = scaled * contrast + brightness;
    // Clamp to valid range
    grayscale[i] = Math.max(0, Math.min(1, gray));
  }

  return grayscale;
}
