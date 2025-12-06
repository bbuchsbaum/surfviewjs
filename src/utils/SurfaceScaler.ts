/**
 * Utility to automatically scale surfaces to a reasonable viewing size
 */
export class SurfaceScaler {
  /**
   * Determine if a surface needs scaling based on its size
   */
  static needsScaling(vertices: Float32Array, targetSize: number = 100): boolean {
    let maxCoord = 0;
    
    for (let i = 0; i < vertices.length; i++) {
      maxCoord = Math.max(maxCoord, Math.abs(vertices[i]));
    }
    
    // If max coordinate is less than 10% of target size, it needs scaling
    return maxCoord < targetSize * 0.1;
  }
  
  /**
   * Calculate appropriate scale factor for a surface
   */
  static calculateScaleFactor(vertices: Float32Array, targetSize: number = 100): number {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (let i = 0; i < vertices.length; i += 3) {
      minX = Math.min(minX, vertices[i]);
      maxX = Math.max(maxX, vertices[i]);
      minY = Math.min(minY, vertices[i + 1]);
      maxY = Math.max(maxY, vertices[i + 1]);
      minZ = Math.min(minZ, vertices[i + 2]);
      maxZ = Math.max(maxZ, vertices[i + 2]);
    }
    
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    
    // Find the largest dimension
    const maxDimension = Math.max(sizeX, sizeY, sizeZ);
    
    // Avoid division by zero
    if (maxDimension === 0) return 1;
    
    // Calculate scale to make largest dimension equal to target size
    return targetSize / maxDimension;
  }
  
  /**
   * Scale vertices in place
   */
  static scaleVertices(vertices: Float32Array, scaleFactor: number): void {
    for (let i = 0; i < vertices.length; i++) {
      vertices[i] *= scaleFactor;
    }
  }
  
  /**
   * Auto-scale surface if needed
   */
  static autoScale(vertices: Float32Array, targetSize: number = 100): number {
    if (this.needsScaling(vertices, targetSize)) {
      const scaleFactor = this.calculateScaleFactor(vertices, targetSize);
      this.scaleVertices(vertices, scaleFactor);
      return scaleFactor;
    }
    return 1;
  }
}