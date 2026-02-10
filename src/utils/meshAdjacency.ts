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
  if (vertexCount <= 0) {
    throw new Error('vertexCount must be positive');
  }
  if (faces.length % 3 !== 0) {
    throw new Error('faces length must be divisible by 3');
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
    const a = faces[i];
    const b = faces[i + 1];
    const c = faces[i + 2];
    const faceIdx = i / 3;

    // Add bidirectional edges for each pair in the triangle
    neighbors[a].add(b);
    neighbors[a].add(c);
    neighbors[b].add(a);
    neighbors[b].add(c);
    neighbors[c].add(a);
    neighbors[c].add(b);

    // Record face incidence for each vertex
    vertexFaces[a].push(faceIdx);
    vertexFaces[b].push(faceIdx);
    vertexFaces[c].push(faceIdx);
  }

  return {
    neighbors,
    vertexFaces,
    vertexCount
  };
}
