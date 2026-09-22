import * as THREE from 'three';
import { buildVertexAdjacency } from './meshAdjacency';
import { finiteNumber } from './validation';

/**
 * Laplacian smoothing utility for mesh geometry
 * 
 * Provides algorithms to smooth mesh surfaces by moving vertices toward
 * the average position of their neighbors. Useful for:
 * - Reducing noise in scanned surfaces
 * - Smoothing procedurally generated meshes
 * - Creating organic, flowing surfaces
 * 
 * @class LaplacianSmoothing
 * 
 * @example
 * ```javascript
 * // Standard Laplacian smoothing
 * LaplacianSmoothing.smooth(vertices, faces, 3, 0.5);
 * 
 * // Volume-preserving Taubin smoothing
 * LaplacianSmoothing.taubinSmooth(vertices, faces, 3, 0.5, -0.53);
 * 
 * // Apply to THREE.js geometry
 * LaplacianSmoothing.smoothGeometry(geometry, 3, 0.5, 'taubin');
 * ```
 */
export class LaplacianSmoothing {
  /**
   * Build adjacency list for vertices
   */
  private static buildAdjacencyList(
    vertices: Float32Array,
    faces: Uint32Array
  ): Set<number>[] {
    if (vertices.length === 0 || vertices.length % 3 !== 0) {
      throw new RangeError('vertices length must be a non-zero multiple of 3');
    }
    const numVertices = vertices.length / 3;
    for (let index = 0; index < vertices.length; index++) {
      finiteNumber(vertices[index], `vertices[${index}]`);
    }
    return buildVertexAdjacency(faces, numVertices).neighbors;
  }
  
  /**
   * Apply standard Laplacian smoothing to vertices
   * 
   * Algorithm: Each vertex is moved toward the average position of its neighbors.
   * This tends to shrink the surface slightly with each iteration.
   * 
   * @param vertices - Vertex positions (will be modified in place)
   * @param faces - Face indices defining mesh topology
   * @param iterations - Number of smoothing passes (1-10 typical). More = smoother but may lose detail
   * @param lambda - Smoothing strength per iteration:
   *   - 0: No smoothing
   *   - 0.1-0.3: Gentle smoothing, preserves features
   *   - 0.4-0.6: Moderate smoothing
   *   - 0.7-1.0: Aggressive smoothing, may over-smooth
   * @param boundarySmoothing - If false, boundary edges remain fixed (recommended for open meshes)
   * @returns The smoothed vertices (same array, modified in place)
   * 
   * @example
   * ```javascript
   * // Gentle noise reduction
   * LaplacianSmoothing.smooth(vertices, faces, 2, 0.25, false);
   * 
   * // Aggressive smoothing
   * LaplacianSmoothing.smooth(vertices, faces, 5, 0.7, false);
   * ```
   */
  static smooth(
    vertices: Float32Array,
    faces: Uint32Array,
    iterations: number = 1,
    lambda: number = 0.5,
    boundarySmoothing: boolean = false
  ): Float32Array {
    finiteNumber(iterations, 'iterations', { minimum: 0, integer: true });
    finiteNumber(lambda, 'lambda', { minimum: -1, maximum: 1 });
    
    const numVertices = vertices.length / 3;
    const adjacency = this.buildAdjacencyList(vertices, faces);
    
    // Identify boundary vertices if needed
    const boundaryVertices = new Set<number>();
    if (!boundarySmoothing) {
      // Find boundary edges (edges that belong to only one face)
      const edgeCount = new Map<string, number>();
      
      for (let i = 0; i < faces.length; i += 3) {
        // The adjacency builder above validated the complete triangular layout.
        const v0 = faces[i]!;
        const v1 = faces[i + 1]!;
        const v2 = faces[i + 2]!;
        
        // Count each edge
        const edges: readonly (readonly [number, number])[] = [
          [Math.min(v0, v1), Math.max(v0, v1)],
          [Math.min(v1, v2), Math.max(v1, v2)],
          [Math.min(v2, v0), Math.max(v2, v0)]
        ];
        
        edges.forEach(([a, b]) => {
          const key = `${a}-${b}`;
          edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
        });
      }
      
      // Mark vertices on boundary edges
      edgeCount.forEach((count, key) => {
        if (count === 1) {
          const [a, b] = key.split('-').map(Number);
          if (a !== undefined) boundaryVertices.add(a);
          if (b !== undefined) boundaryVertices.add(b);
        }
      });
    }
    
    // Perform smoothing iterations
    for (let iter = 0; iter < iterations; iter++) {
      // Create a copy for the new positions
      const newVertices = new Float32Array(vertices);
      
      // Smooth each vertex
      for (let i = 0; i < numVertices; i++) {
        // Skip boundary vertices if requested
        if (!boundarySmoothing && boundaryVertices.has(i)) {
          continue;
        }
        
        const neighbors = adjacency[i]!;
        if (neighbors.size === 0) {
          continue;
        }
        
        // Calculate average position of neighbors
        let avgX = 0, avgY = 0, avgZ = 0;
        neighbors.forEach(j => {
          // Adjacency construction proved every neighbor index is in range.
          avgX += vertices[j * 3]!;
          avgY += vertices[j * 3 + 1]!;
          avgZ += vertices[j * 3 + 2]!;
        });
        
        const count = neighbors.size;
        avgX /= count;
        avgY /= count;
        avgZ /= count;
        
        // Apply Laplacian smoothing
        const idx = i * 3;
        const x = vertices[idx]!;
        const y = vertices[idx + 1]!;
        const z = vertices[idx + 2]!;
        newVertices[idx] = x + lambda * (avgX - x);
        newVertices[idx + 1] = y + lambda * (avgY - y);
        newVertices[idx + 2] = z + lambda * (avgZ - z);
      }
      
      // Copy new positions back
      vertices.set(newVertices);
    }
    
    return vertices;
  }
  
  /**
   * Apply Taubin smoothing (volume-preserving algorithm)
   * 
   * Algorithm: Alternates between shrinking (positive lambda) and expanding (negative mu)
   * passes. This prevents the volume loss common in standard Laplacian smoothing.
   * 
   * @param vertices - Vertex positions (will be modified in place)
   * @param faces - Face indices defining mesh topology
   * @param iterations - Number of shrink-expand cycles (1-5 typical)
   * @param lambda - Shrinking factor (0.3-0.7 typical). Higher = more aggressive
   * @param mu - Expansion factor (-0.2 to -0.7 typical). Must be negative.
   *   - Classic Taubin: mu = -(lambda + 0.02)
   *   - Common default: mu = -0.53 when lambda = 0.5
   * @param boundarySmoothing - If false, boundary edges remain fixed
   * @returns The smoothed vertices (same array, modified in place)
   * 
   * @example
   * ```javascript
   * // Classic Taubin parameters
   * LaplacianSmoothing.taubinSmooth(vertices, faces, 3, 0.5, -0.53, false);
   * 
   * // Gentle volume-preserving smoothing
   * LaplacianSmoothing.taubinSmooth(vertices, faces, 2, 0.33, -0.35, false);
   * ```
   */
  static taubinSmooth(
    vertices: Float32Array,
    faces: Uint32Array,
    iterations: number = 1,
    lambda: number = 0.5,
    mu: number = -0.53,
    boundarySmoothing: boolean = false
  ): Float32Array {
    finiteNumber(iterations, 'iterations', { minimum: 0, integer: true });
    finiteNumber(lambda, 'lambda', { minimum: -1, maximum: 1 });
    finiteNumber(mu, 'mu', { minimum: -1, maximum: 0, maximumExclusive: true });
    
    for (let i = 0; i < iterations; i++) {
      // Apply positive lambda (shrinking)
      this.smooth(vertices, faces, 1, lambda, boundarySmoothing);
      // Apply negative mu (expanding)  
      this.smooth(vertices, faces, 1, mu, boundarySmoothing);
    }
    
    return vertices;
  }
  
  /**
   * Apply smoothing to a BufferGeometry
   */
  static smoothGeometry(
    geometry: THREE.BufferGeometry,
    iterations: number = 1,
    lambda: number = 0.5,
    method: 'laplacian' | 'taubin' = 'laplacian',
    boundarySmoothing: boolean = false,
    mu: number = -0.53
  ): void {
    const positionAttribute = geometry.getAttribute('position');
    if (!positionAttribute) {
      throw new Error('Geometry must have position attribute');
    }
    
    const indexAttribute = geometry.getIndex();
    if (!indexAttribute) {
      throw new Error('Geometry must have index attribute');
    }
    
    const vertices = positionAttribute.array as Float32Array;
    const faces = indexAttribute.array as Uint32Array;
    
    if (method === 'taubin') {
      this.taubinSmooth(vertices, faces, iterations, lambda, mu, boundarySmoothing);
    } else {
      this.smooth(vertices, faces, iterations, lambda, boundarySmoothing);
    }
    
    // Mark for update
    positionAttribute.needsUpdate = true;
    
    // Recompute normals after smoothing
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
}
