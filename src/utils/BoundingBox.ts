import * as THREE from 'three';

/**
 * Calculate bounding box and optimal camera position for a surface
 */
export class BoundingBoxHelper {
  /**
   * Calculate the bounding box of a surface geometry
   */
  static calculateBounds(vertices: ArrayLike<number>): {
    min: THREE.Vector3;
    max: THREE.Vector3;
    center: THREE.Vector3;
    size: THREE.Vector3;
    radius: number;
  } {
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
    
    const min = new THREE.Vector3(minX, minY, minZ);
    const max = new THREE.Vector3(maxX, maxY, maxZ);
    const center = new THREE.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    );
    const size = new THREE.Vector3(
      maxX - minX,
      maxY - minY,
      maxZ - minZ
    );
    
    // Calculate bounding sphere radius
    const radius = size.length() / 2;
    
    return { min, max, center, size, radius };
  }
  
  /**
   * Calculate optimal camera distance for a given field of view
   */
  static calculateCameraDistance(
    boundingRadius: number,
    fov: number,
    aspectRatio: number
  ): number {
    // Account for aspect ratio to ensure the object fits in both dimensions
    const vFov = fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspectRatio);
    
    // Use the smaller FOV to ensure object fits
    const effectiveFov = Math.min(vFov, hFov);
    
    // Add some padding (20% extra distance)
    const padding = 1.2;
    
    // Calculate distance needed to fit the bounding sphere
    const distance = (boundingRadius * padding) / Math.sin(effectiveFov / 2);
    
    return distance;
  }
  
  /**
   * Fit camera to view all surfaces
   */
  static fitCameraToSurfaces(
    camera: THREE.PerspectiveCamera,
    surfaces: Array<{ vertices: Float32Array }>,
    controls?: any
  ): void {
    if (surfaces.length === 0) return;
    
    // Calculate combined bounding box
    let globalMinX = Infinity, globalMinY = Infinity, globalMinZ = Infinity;
    let globalMaxX = -Infinity, globalMaxY = -Infinity, globalMaxZ = -Infinity;
    
    for (const surface of surfaces) {
      const bounds = this.calculateBounds(surface.vertices);
      globalMinX = Math.min(globalMinX, bounds.min.x);
      globalMinY = Math.min(globalMinY, bounds.min.y);
      globalMinZ = Math.min(globalMinZ, bounds.min.z);
      globalMaxX = Math.max(globalMaxX, bounds.max.x);
      globalMaxY = Math.max(globalMaxY, bounds.max.y);
      globalMaxZ = Math.max(globalMaxZ, bounds.max.z);
    }
    
    const center = new THREE.Vector3(
      (globalMinX + globalMaxX) / 2,
      (globalMinY + globalMaxY) / 2,
      (globalMinZ + globalMaxZ) / 2
    );
    
    const size = new THREE.Vector3(
      globalMaxX - globalMinX,
      globalMaxY - globalMinY,
      globalMaxZ - globalMinZ
    );
    
    const radius = size.length() / 2;
    
    // Calculate optimal camera distance
    const distance = this.calculateCameraDistance(
      radius,
      camera.fov,
      camera.aspect
    );
    
    // Position camera
    const direction = new THREE.Vector3(0, 0, 1);
    camera.position.copy(center).add(direction.multiplyScalar(distance));
    camera.lookAt(center);
    
    // Update controls target if available
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    
    // Update camera near/far planes based on scene size
    camera.near = distance / 1000;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
  }

  /**
   * Compute camera distance to fit a bounding sphere with optional padding.
   */
  static computeInitialZoom(
    radius: number,
    fov: number,
    aspectRatio: number,
    padding: number = 1.2
  ): number {
    const vFov = (fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspectRatio);
    const effectiveFov = Math.min(vFov, hFov);
    return (radius * padding) / Math.sin(effectiveFov / 2);
  }

  /**
   * Pure helper to compute position/target for an arbitrary BufferGeometry or vertices array.
   */
  static fitCameraToGeometry(
    geometry: THREE.BufferGeometry | { attributes?: { position?: { array: ArrayLike<number> } } } | { vertices: ArrayLike<number> },
    options: { fov: number; aspect: number; padding?: number } = { fov: 60, aspect: 1 }
  ): { center: THREE.Vector3; distance: number; position: THREE.Vector3 } {
    const padding = options.padding ?? 1.2;
    let vertices: ArrayLike<number> | null = null;

    if ((geometry as any).attributes?.position?.array) {
      vertices = (geometry as any).attributes.position.array as ArrayLike<number>;
    } else if ((geometry as any).vertices) {
      vertices = (geometry as any).vertices as ArrayLike<number>;
    }
    if (!vertices) {
      throw new Error('fitCameraToGeometry: geometry must provide position data');
    }

    const array = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
    const bounds = this.calculateBounds(array);
    const distance = this.computeInitialZoom(bounds.radius, options.fov, options.aspect, padding);
    const position = new THREE.Vector3(bounds.center.x, bounds.center.y, bounds.center.z + distance);
    return { center: bounds.center, distance, position };
  }
}
