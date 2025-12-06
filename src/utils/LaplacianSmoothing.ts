import * as THREE from 'three';

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
  ): Map<number, Set<number>> {
    const adjacency = new Map<number, Set<number>>();
    const numVertices = vertices.length / 3;
    
    // Initialize adjacency list
    for (let i = 0; i < numVertices; i++) {
      adjacency.set(i, new Set<number>());
    }
    
    // Build adjacency from faces
    for (let i = 0; i < faces.length; i += 3) {
      const v0 = faces[i];
      const v1 = faces[i + 1];
      const v2 = faces[i + 2];
      
      // Add bidirectional edges
      adjacency.get(v0)?.add(v1);
      adjacency.get(v0)?.add(v2);
      adjacency.get(v1)?.add(v0);
      adjacency.get(v1)?.add(v2);
      adjacency.get(v2)?.add(v0);
      adjacency.get(v2)?.add(v1);
    }
    
    return adjacency;
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
    if (lambda < -1 || lambda > 1) {
      throw new Error('Lambda must be between -1 and 1');
    }
    
    console.log(`Laplacian smoothing: ${iterations} iterations, lambda=${lambda}, boundarySmoothing=${boundarySmoothing}`);
    
    const numVertices = vertices.length / 3;
    const adjacency = this.buildAdjacencyList(vertices, faces);
    
    // Identify boundary vertices if needed
    const boundaryVertices = new Set<number>();
    if (!boundarySmoothing) {
      // Find boundary edges (edges that belong to only one face)
      const edgeCount = new Map<string, number>();
      
      for (let i = 0; i < faces.length; i += 3) {
        const v0 = faces[i];
        const v1 = faces[i + 1];
        const v2 = faces[i + 2];
        
        // Count each edge
        const edges = [
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
          boundaryVertices.add(a);
          boundaryVertices.add(b);
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
        
        const neighbors = adjacency.get(i);
        if (!neighbors || neighbors.size === 0) {
          continue;
        }
        
        // Calculate average position of neighbors
        let avgX = 0, avgY = 0, avgZ = 0;
        neighbors.forEach(j => {
          avgX += vertices[j * 3];
          avgY += vertices[j * 3 + 1];
          avgZ += vertices[j * 3 + 2];
        });
        
        const count = neighbors.size;
        avgX /= count;
        avgY /= count;
        avgZ /= count;
        
        // Apply Laplacian smoothing
        const idx = i * 3;
        newVertices[idx] = vertices[idx] + lambda * (avgX - vertices[idx]);
        newVertices[idx + 1] = vertices[idx + 1] + lambda * (avgY - vertices[idx + 1]);
        newVertices[idx + 2] = vertices[idx + 2] + lambda * (avgZ - vertices[idx + 2]);
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
    console.log(`Taubin smoothing: ${iterations} iterations, lambda=${lambda}, mu=${mu}`);
    
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