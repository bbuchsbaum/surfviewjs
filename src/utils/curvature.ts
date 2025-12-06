import { SurfaceGeometry } from '../classes';
import * as THREE from 'three';

/**
 * Compute mean curvature for each vertex of a mesh.
 *
 * Uses the discrete Laplace-Beltrami operator approach:
 * Mean curvature H = 0.5 * |Δx| where Δ is the cotangent Laplacian.
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

  // Build adjacency structure
  const neighbors: Set<number>[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    neighbors[i] = new Set();
  }

  // Build neighbor lists from faces
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i];
    const b = faces[i + 1];
    const c = faces[i + 2];
    neighbors[a].add(b);
    neighbors[a].add(c);
    neighbors[b].add(a);
    neighbors[b].add(c);
    neighbors[c].add(a);
    neighbors[c].add(b);
  }

  const curvature = new Float32Array(vertexCount);
  const tempVec = new THREE.Vector3();
  const vertexPos = new THREE.Vector3();
  const neighborPos = new THREE.Vector3();

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
    // This is a fast approximation: H ≈ |v - mean(neighbors)|
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

    // Get vertex normal to determine sign (concave vs convex)
    // We need to compute the normal from adjacent faces
    const normal = computeVertexNormal(i, vertices, faces, neighbors[i]);

    // Curvature magnitude with sign based on normal direction
    const magnitude = tempVec.length();
    const sign = tempVec.dot(normal) > 0 ? 1 : -1;

    curvature[i] = sign * magnitude;
  }

  return curvature;
}

/**
 * Compute vertex normal by averaging adjacent face normals
 */
function computeVertexNormal(
  vertexIndex: number,
  vertices: Float32Array,
  faces: Uint32Array,
  neighbors: Set<number>
): THREE.Vector3 {
  const normal = new THREE.Vector3(0, 0, 0);
  const v0 = new THREE.Vector3(
    vertices[vertexIndex * 3],
    vertices[vertexIndex * 3 + 1],
    vertices[vertexIndex * 3 + 2]
  );
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  let faceCount = 0;

  // Find all faces containing this vertex
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i];
    const b = faces[i + 1];
    const c = faces[i + 2];

    if (a === vertexIndex || b === vertexIndex || c === vertexIndex) {
      // Get the other two vertices
      let i1: number, i2: number;
      if (a === vertexIndex) {
        i1 = b; i2 = c;
      } else if (b === vertexIndex) {
        i1 = c; i2 = a;
      } else {
        i1 = a; i2 = b;
      }

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
  }

  if (faceCount > 0) {
    normal.divideScalar(faceCount);
    normal.normalize();
  }

  return normal;
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
