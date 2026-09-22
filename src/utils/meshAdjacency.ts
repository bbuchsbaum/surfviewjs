/**
 * Mesh adjacency data structure and builder.
 *
 * Provides vertex neighbor and vertex-face incidence information
 * for mesh processing algorithms (curvature, clustering, etc.).
 */

/**
 * Mesh adjacency data structure.
 *
 * Stores both vertex-to-vertex (neighbors) and vertex-to-face (vertexFaces)
 * adjacency information for efficient mesh traversal.
 */
export interface MeshAdjacency {
  /** neighbors[v] is the Set of vertex indices adjacent to vertex v */
  neighbors: Set<number>[];
  /** vertexFaces[v] is the array of face indices incident to vertex v */
  vertexFaces: number[][];
  /** Total vertex count */
  vertexCount: number;
}

export type MeshAdjacencyErrorCode =
  | 'invalid-vertex-count'
  | 'invalid-face-layout'
  | 'invalid-face-index';

export class MeshAdjacencyError extends Error {
  readonly code: MeshAdjacencyErrorCode;

  constructor(code: MeshAdjacencyErrorCode, message: string) {
    super(message);
    this.name = 'MeshAdjacencyError';
    this.code = code;
  }
}

/**
 * Build vertex adjacency structure from mesh faces.
 *
 * Constructs both vertex-to-vertex and vertex-to-face adjacency maps
 * by iterating through all triangular faces once.
 *
 * Time complexity: O(F) where F = faces.length / 3 (number of faces)
 * Space complexity: O(V + E + F) where V = vertices, E = edges
 *
 * @param faces - Triangle face indices (length must be divisible by 3)
 * @param vertexCount - Total number of vertices in the mesh
 * @returns MeshAdjacency structure with neighbor and face incidence data
 * @throws Error if vertexCount <= 0 or faces.length not divisible by 3
 */
export function buildVertexAdjacency(
  faces: Uint32Array | number[],
  vertexCount: number
): MeshAdjacency {
  // Validation
  if (!Number.isSafeInteger(vertexCount) || vertexCount <= 0 || vertexCount > 10_000_000) {
    throw new MeshAdjacencyError(
      'invalid-vertex-count',
      'vertexCount must be an integer in [1, 10000000]'
    );
  }
  if (!faces || !Number.isSafeInteger(faces.length) || faces.length < 0 || faces.length % 3 !== 0) {
    throw new MeshAdjacencyError(
      'invalid-face-layout',
      'faces length must be divisible by 3'
    );
  }
  for (let index = 0; index < faces.length; index += 1) {
    // `index` is bounded by `faces.length`; typed-array reads are therefore present.
    const vertexIndex = faces[index]!;
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertexCount) {
      throw new MeshAdjacencyError(
        'invalid-face-index',
        `face index at position ${index} must be an integer in [0, ${vertexCount - 1}] ` +
        `(received ${String(vertexIndex)})`
      );
    }
  }

  // Initialize adjacency structures
  const neighbors: Set<number>[] = new Array(vertexCount);
  const vertexFaces: number[][] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    neighbors[i] = new Set();
    vertexFaces[i] = [];
  }

  // Build neighbor lists and vertex-to-face map from faces
  for (let i = 0; i < faces.length; i += 3) {
    // The layout and range pass above proves this complete triangle is in bounds.
    const a = faces[i]!;
    const b = faces[i + 1]!;
    const c = faces[i + 2]!;
    const faceIdx = i / 3;

    // Add bidirectional edges for each pair in the triangle
    neighbors[a]!.add(b);
    neighbors[a]!.add(c);
    neighbors[b]!.add(a);
    neighbors[b]!.add(c);
    neighbors[c]!.add(a);
    neighbors[c]!.add(b);

    // Record face incidence for each vertex
    // Both adjacency arrays were fully initialized for every valid vertex.
    vertexFaces[a]!.push(faceIdx);
    vertexFaces[b]!.push(faceIdx);
    vertexFaces[c]!.push(faceIdx);
  }

  return {
    neighbors,
    vertexFaces,
    vertexCount
  };
}
