import { finiteNumber } from './validation';

/**
 * Utility to automatically scale surfaces to a reasonable viewing size
 */
export class SurfaceScaler {
  /**
   * Determine if a surface needs scaling based on its size
   */
  static needsScaling(vertices: Float32Array, targetSize: number = 100): boolean {
    const normalizedTargetSize = finiteNumber(targetSize, 'targetSize', {
      minimum: 0,
      minimumExclusive: true
    });
    let maxCoord = 0;
    
    for (let i = 0; i < vertices.length; i++) {
      maxCoord = Math.max(maxCoord, Math.abs(finiteNumber(vertices[i], `vertices[${i}]`)));
    }
    
    // If max coordinate is less than 10% of target size, it needs scaling
    return maxCoord < normalizedTargetSize * 0.1;
  }
  
  /**
   * Calculate appropriate scale factor for a surface
   */
  static calculateScaleFactor(vertices: Float32Array, targetSize: number = 100): number {
    const normalizedTargetSize = finiteNumber(targetSize, 'targetSize', {
      minimum: 0,
      minimumExclusive: true
    });
    if (vertices.length === 0 || vertices.length % 3 !== 0) {
      throw new RangeError('vertices must contain one or more complete xyz triples');
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (let i = 0; i < vertices.length; i += 3) {
      const x = finiteNumber(vertices[i], `vertices[${i}]`);
      const y = finiteNumber(vertices[i + 1], `vertices[${i + 1}]`);
      const z = finiteNumber(vertices[i + 2], `vertices[${i + 2}]`);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    
    // Find the largest dimension
    const maxDimension = Math.max(sizeX, sizeY, sizeZ);
    
    // Avoid division by zero
    if (maxDimension === 0) return 1;
    
    // Calculate scale to make largest dimension equal to target size
    return normalizedTargetSize / maxDimension;
  }
  
  /**
   * Scale vertices in place
   */
  static scaleVertices(vertices: Float32Array, scaleFactor: number): void {
    const normalizedScaleFactor = finiteNumber(scaleFactor, 'scaleFactor', {
      minimum: 0,
      minimumExclusive: true
    });
    for (let i = 0; i < vertices.length; i++) {
      vertices[i] = finiteNumber(vertices[i], `vertices[${i}]`) * normalizedScaleFactor;
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
