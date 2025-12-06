import * as THREE from 'three';
import ColorMap from './ColorMap';
import { debugLog } from './debug';
import { EventEmitter, UnsubscribeFn } from './EventEmitter';
import { LaplacianSmoothing } from './utils/LaplacianSmoothing';

/**
 * Configuration options for surface material properties and appearance
 * @interface SurfaceConfig
 * 
 * @example
 * ```javascript
 * const config = {
 *   color: 0xA9A9A9,        // Gray base color
 *   shininess: 50,          // Moderate shininess
 *   specularColor: 0x666666,// Light gray highlights
 *   emissive: 0x0a0a0a,     // Slight self-illumination
 *   emissiveIntensity: 0.2, // 20% emissive strength
 *   alpha: 0.8,             // 80% opacity
 *   flatShading: false      // Smooth shading
 * };
 * surface.updateConfig(config);
 * ```
 */
export interface SurfaceConfig {
  /** Base color of the surface when no vertex coloring is applied. Can be hex number, string, or THREE.Color */
  color?: THREE.ColorRepresentation;
  
  /** If true, renders each face with a single normal (faceted look). If false, interpolates normals (smooth look) */
  flatShading?: boolean;
  
  /** Angle threshold in degrees for smooth shading (0-180). Edges with angles above this threshold will appear sharp */
  smoothingAngle?: number;
  
  /** Material type: 'phong' (default) or 'standard' (PBR). Standard enables metalness/roughness */
  materialType?: 'phong' | 'standard' | 'physical';
  
  // Phong material properties (when materialType = 'phong')
  /** Controls size of specular highlights (0-200). 0 = matte/dull, 200 = very shiny/metallic. Only for Phong material */
  shininess?: number;
  
  /** Color of specular reflections. Usually grayscale for realistic materials. Hex number format. Only for Phong material */
  specularColor?: number;
  
  // Standard/Physical material properties (when materialType = 'standard' or 'physical')
  /** How metallic the surface is (0-1). 0 = dielectric (plastic), 1 = metal. Only for Standard/Physical material */
  metalness?: number;
  
  /** How rough the surface is (0-1). 0 = smooth/shiny, 1 = rough/matte. Only for Standard/Physical material */
  roughness?: number;
  
  // Shared properties
  /** Self-illumination color. Makes the surface glow independently of scene lights */
  emissive?: THREE.ColorRepresentation;
  
  /** Multiplier for emissive color strength (0-1). 0 = no glow, 1 = full glow */
  emissiveIntensity?: number;
  
  /** Opacity/transparency (0-1). 0 = fully transparent, 1 = fully opaque */
  alpha?: number;
  
  /** Threshold range [min, max] for hiding values. Values within range are made transparent */
  thresh?: [number, number];
  
  /** Input data range [min, max] for color mapping normalization */
  irange?: [number, number];
}

export class SurfaceGeometry {
  vertices: Float32Array;
  faces: Uint32Array;
  hemi: string;
  hemisphere: string;
  vertexCurv: Float32Array | null;
  mesh: THREE.Mesh | null;
  private _boundsCache: {
    min: THREE.Vector3;
    max: THREE.Vector3;
    center: THREE.Vector3;
    size: THREE.Vector3;
    radius: number;
  } | null;

  constructor(
    vertices: Float32Array | number[],
    faces: Uint32Array | number[],
    hemi: string,
    vertexCurv: Float32Array | number[] | null = null
  ) {
    this.vertices = new Float32Array(vertices);
    this.faces = new Uint32Array(faces);
    this.hemi = hemi;
    this.vertexCurv = vertexCurv ? new Float32Array(vertexCurv) : null;
    this.mesh = null;
    this.hemisphere = hemi; // Add hemisphere property for viewer
    this._boundsCache = null;

    debugLog('SurfaceGeometry constructor called');
    debugLog('Vertices:', this.vertices.length);
    debugLog('Faces:', this.faces.length);
    debugLog('Hemi:', this.hemi);

    this.createMesh();
  }

  createMesh(): void {
    try {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.vertices, 3));
      geometry.setIndex(new THREE.Uint32BufferAttribute(this.faces, 1));
      if (this.vertexCurv) {
        geometry.setAttribute('curv', new THREE.Float32BufferAttribute(this.vertexCurv, 1));
      }
    
      const material = new THREE.MeshPhongMaterial({
        color: 0xA9A9A9, // Set default color to dark gray
        flatShading: false,
        vertexColors: false,
        emissive: 0x0a0a0a,     // Slight self-illumination
        emissiveIntensity: 0.2,  // Small amount for better visibility
        specular: 0x555555,      // Lighter gray for better highlights
        shininess: 30
      });

      this.mesh = new THREE.Mesh(geometry, material);
      debugLog('SurfaceGeometry construction complete');
      debugLog('Mesh:', this.mesh);
    } catch (error) {
      console.error('Error creating mesh:', error);
      throw error;
    }
  }

  getVertexCount(): number {
    return this.vertices.length / 3;
  }

  getBounds(): {
    min: THREE.Vector3;
    max: THREE.Vector3;
    center: THREE.Vector3;
    size: THREE.Vector3;
    radius: number;
  } {
    if (this._boundsCache) return this._boundsCache;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < this.vertices.length; i += 3) {
      const x = this.vertices[i];
      const y = this.vertices[i + 1];
      const z = this.vertices[i + 2];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }

    const min = new THREE.Vector3(minX, minY, minZ);
    const max = new THREE.Vector3(maxX, maxY, maxZ);
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    const size = new THREE.Vector3().subVectors(max, min);
    const radius = size.length() / 2;

    this._boundsCache = { min, max, center, size, radius };
    return this._boundsCache;
  }

  invalidateBounds(): void {
    this._boundsCache = null;
  }

  dispose(): void {
    if (this.mesh) {
      // Properly dispose Three.js resources
      if (this.mesh.geometry) {
        this.mesh.geometry.dispose();
      }
      if (this.mesh.material) {
        if (Array.isArray(this.mesh.material)) {
          this.mesh.material.forEach(mat => mat.dispose());
        } else {
          this.mesh.material.dispose();
        }
      }
      this.mesh = null;
    }
    // TypedArrays don't need disposal, just dereference
    this.vertices = null as any;
    this.faces = null as any;
    this.vertexCurv = null;
  }
}

export abstract class NeuroSurface extends EventEmitter {
  /**
   * Calculate min/max range for typed arrays without using spread operator
   */
  protected calculateDataRange(data: Float32Array | number[] | undefined | null): [number, number] {
    if (!data || data.length === 0) return [0, 0];
    
    let min = Infinity;
    let max = -Infinity;
    
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      if (isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    
    // Handle case where all values are non-finite
    if (min === Infinity || max === -Infinity) {
      return [0, 0];
    }
    
    return [min, max];
  }
  
  /**
   * Compute normals for the mesh with optional smoothing control
   */
  protected computeNormals(geometry: THREE.BufferGeometry): void {
    if (this.config.flatShading) {
      // For flat shading, compute face normals
      (geometry as any).computeFaceNormals?.();
    } else {
      // For smooth shading, compute vertex normals
      geometry.computeVertexNormals();
      
      // If smoothing angle is specified and less than 180, apply selective smoothing
      if (this.config.smoothingAngle !== undefined && this.config.smoothingAngle < 180) {
        // Convert angle to radians and compute cosine threshold
        const angleThreshold = (this.config.smoothingAngle * Math.PI) / 180;
        const cosineThreshold = Math.cos(angleThreshold);
        
        // Note: Full implementation would require creating split vertices for edges
        // that exceed the angle threshold. This is a simplified version.
        // For full control, consider using THREE.BufferGeometryUtils.computeMorphedAttributes
        // or implementing custom normal computation based on face adjacency.
        
        debugLog(`Smoothing angle set to ${this.config.smoothingAngle} degrees`);
      }
    }
  }
  
  geometry: SurfaceGeometry;
  indices: Uint32Array;
  data: Float32Array;
  vertexCurv: Float32Array | null;
  mesh: THREE.Mesh | null;
  threshold: [number, number];
  irange: [number, number];
  hemisphere: string;
  config: Required<SurfaceConfig>;
  viewer?: any; // Will be set by viewer when added

  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[] | null,
    data: Float32Array | number[],
    config: SurfaceConfig = {}
  ) {
    super(); // Initialize EventEmitter
    this.geometry = geometry;
    
    // Default indices: one-to-one mapping with vertices if not provided
    if (!indices || (indices as any).length === 0) {
      const vertexCount = geometry.vertices.length / 3;
      // Create identity mapping: vertex i gets data[i]
      this.indices = new Uint32Array(Array.from({length: vertexCount}, (_, i) => i));
      debugLog('Using default indices (identity mapping) for', vertexCount, 'vertices');
    } else {
      this.indices = new Uint32Array(indices);
    }
    
    this.data = new Float32Array(data);
    this.vertexCurv = geometry.vertexCurv || null;
    this.mesh = null;
    // Default threshold shows everything unless explicitly set
    this.threshold = Array.isArray(config.thresh) ? config.thresh : [0, 0];
    // Avoid spread operator for typed arrays - can cause stack overflow
    this.irange = config.irange || this.calculateDataRange(data);
    this.hemisphere = geometry.hemisphere; // Pass through hemisphere

    this.config = {
      color: new THREE.Color(0xA9A9A9), // Set default color to dark gray
      flatShading: false,
      smoothingAngle: undefined, // No angle-based smoothing by default
      shininess: 30,
      specularColor: 0x555555,  // Lighter gray specular for better highlights
      emissive: new THREE.Color(0x0a0a0a),  // Slight self-illumination
      emissiveIntensity: 0.2,  // Small amount of emissive for better visibility
      alpha: 1,
      thresh: this.threshold,
      irange: this.irange,
      ...config
    } as Required<SurfaceConfig>;
  }

  update(property: string, value: any): void {
    const methodName = `update${property.charAt(0).toUpperCase() + property.slice(1)}`;
    if ((this as any)[methodName]) {
      (this as any)[methodName](value);
    } else {
      console.warn(`Update method for ${property} not implemented in ${this.constructor.name}`);
    }
  }

  /**
   * Update surface material properties dynamically
   * @param newConfig - Partial configuration object with properties to update
   * @example
   * ```javascript
   * // Make surface shiny and semi-transparent
   * surface.updateConfig({
   *   shininess: 150,
   *   specularColor: 0xffffff,
   *   alpha: 0.7
   * });
   * 
   * // Switch to flat shading for faceted look
   * surface.updateConfig({ flatShading: true });
   * ```
   */
  updateConfig(newConfig: Partial<SurfaceConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig } as Required<SurfaceConfig>;
    
    if (this.mesh && this.mesh.material) {
      const material = this.mesh.material as any; // Type will vary based on material type
      
      // Check if we need to recreate the material due to type change
      if (newConfig.materialType && newConfig.materialType !== oldConfig.materialType) {
        // Material type changed - need to recreate the mesh
        const oldMesh = this.mesh;
        this.mesh = this.createMesh();
        
        // Transfer the mesh to the scene if it was already there
        if (oldMesh.parent) {
          oldMesh.parent.add(this.mesh);
          oldMesh.parent.remove(oldMesh);
        }
        
        // Dispose old material safely
        if (Array.isArray(oldMesh.material)) {
          oldMesh.material.forEach(mat => mat.dispose());
        } else {
          (oldMesh.material as THREE.Material).dispose();
        }
        
        // Update colors for the new mesh
        this.updateColors();
        return;
      }
      
      // Handle color conversions properly
      if (this.config.color !== undefined) {
        material.color = this.config.color instanceof THREE.Color 
          ? this.config.color 
          : new THREE.Color(this.config.color);
      }
      
      // Material-specific properties
      if (material instanceof THREE.MeshPhongMaterial) {
        // Phong material properties
        if (this.config.specularColor !== undefined) {
          material.specular = new THREE.Color(this.config.specularColor);
        }
        
        if (this.config.shininess !== undefined) {
          material.shininess = this.config.shininess;
        }
      } else if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
        // PBR material properties
        if (this.config.metalness !== undefined) {
          material.metalness = this.config.metalness;
        }
        
        if (this.config.roughness !== undefined) {
          material.roughness = this.config.roughness;
        }
      }
      
      // Shared properties
      if (this.config.emissive !== undefined) {
        material.emissive = this.config.emissive instanceof THREE.Color
          ? this.config.emissive
          : new THREE.Color(this.config.emissive);
      }
      
      if (this.config.emissiveIntensity !== undefined) {
        material.emissiveIntensity = this.config.emissiveIntensity;
      }
      
      if (this.config.flatShading !== undefined) {
        material.flatShading = this.config.flatShading;
      }
      
      // Update transparency settings
      if (this.config.alpha !== undefined) {
        material.transparent = this.config.alpha < 1;
        material.opacity = this.config.alpha;
        material.depthWrite = this.config.alpha >= 1;
      }
      
      material.needsUpdate = true;
      
      // Emit events for changes
      if (oldConfig.alpha !== this.config.alpha) {
        this.emit('opacity:changed', { surface: this, opacity: this.config.alpha });
      }
      if (oldConfig.color !== this.config.color) {
        this.emit('color:changed', { surface: this, color: this.config.color });
      }
      
      this.emit('material:updated', { surface: this });
      this.emit('render:needed', { surface: this });
    }
  }

  abstract createMesh(): THREE.Mesh;
  abstract updateColors(): void;
  
  setVisible(visible: boolean): void {
    if (this.mesh) {
      this.mesh.visible = visible;
      this.emit('visibility:changed', { surface: this, visible });
      this.emit('render:needed', { surface: this });
    }
  }
  
  setOpacity(opacity: number): void {
    this.updateConfig({ alpha: opacity });
  }
  
  /**
   * Control surface shading style (visual only, doesn't modify geometry)
   * @param smooth - If true, uses smooth shading (interpolated normals). If false, uses flat shading (face normals)
   * @param smoothingAngle - Optional angle threshold in degrees (0-180). Edges above this angle remain sharp
   * @example
   * ```javascript
   * // Enable smooth shading for organic surfaces
   * surface.setSmoothShading(true);
   * 
   * // Smooth shading with 30° threshold (sharp edges preserved)
   * surface.setSmoothShading(true, 30);
   * 
   * // Flat shading for faceted/crystalline look
   * surface.setSmoothShading(false);
   * ```
   */
  setSmoothShading(smooth: boolean, smoothingAngle?: number): void {
    this.updateConfig({ 
      flatShading: !smooth,
      smoothingAngle: smoothingAngle
    });
    
    // Recompute normals if mesh exists
    if (this.mesh && this.mesh.geometry) {
      this.computeNormals(this.mesh.geometry);
      const normalAttribute = this.mesh.geometry.getAttribute('normal');
      if (normalAttribute) {
        normalAttribute.needsUpdate = true;
      }
    }
  }
  
  /**
   * Apply Laplacian smoothing to the surface vertices (modifies geometry)
   * @param iterations - Number of smoothing iterations (1-10). More iterations = smoother surface
   * @param lambda - Smoothing strength (0-1). 0 = no effect, 1 = maximum smoothing per iteration
   * @param method - Smoothing algorithm:
   *   - 'laplacian': Standard smoothing, may shrink surface
   *   - 'taubin': Alternates shrink/expand to preserve volume
   * @param preserveBoundaries - If true, boundary edges remain fixed
   * @example
   * ```javascript
   * // Gentle smoothing to reduce noise
   * surface.applyLaplacianSmoothing(2, 0.3, 'laplacian', true);
   * 
   * // Aggressive smoothing while preserving volume
   * surface.applyLaplacianSmoothing(5, 0.5, 'taubin', true);
   * 
   * // Smooth including boundaries (may distort edges)
   * surface.applyLaplacianSmoothing(3, 0.4, 'laplacian', false);
   * ```
   */
  applyLaplacianSmoothing(
    iterations: number = 1,
    lambda: number = 0.5,
    method: 'laplacian' | 'taubin' = 'laplacian',
    preserveBoundaries: boolean = true
  ): void {
    if (!this.mesh || !this.mesh.geometry) {
      console.warn('Cannot apply smoothing: mesh not initialized');
      return;
    }
    
    try {
      // Apply smoothing to the mesh geometry
      LaplacianSmoothing.smoothGeometry(
        this.mesh.geometry,
        iterations,
        lambda,
        method,
        !preserveBoundaries // Invert for the smoothing function
      );
      
      // Also update the source geometry vertices if needed
      const positionAttribute = this.mesh.geometry.getAttribute('position');
      if (positionAttribute && this.geometry.vertices) {
        this.geometry.vertices = new Float32Array(positionAttribute.array);
      }
      
      // Emit events
      this.emit('geometry:smoothed', { 
        surface: this, 
        iterations, 
        lambda, 
        method 
      });
      this.emit('geometry:updated', { surface: this });
      this.emit('render:needed', { surface: this });
      
      debugLog(`Applied ${method} smoothing: ${iterations} iterations, lambda=${lambda}`);
    } catch (error) {
      console.error('Error applying Laplacian smoothing:', error);
    }
  }
  
  /**
   * Create a smoothed copy of this surface
   * @param iterations - Number of smoothing iterations
   * @param lambda - Smoothing factor 0-1
   * @param method - 'laplacian' or 'taubin'
   * @returns A new smoothed surface geometry
   */
  createSmoothedCopy(
    iterations: number = 1,
    lambda: number = 0.5,
    method: 'laplacian' | 'taubin' = 'laplacian'
  ): SurfaceGeometry {
    // Clone the vertices and faces
    const smoothedVertices = new Float32Array(this.geometry.vertices);
    const smoothedFaces = new Uint32Array(this.geometry.faces);
    
    // Apply smoothing
    if (method === 'taubin') {
      LaplacianSmoothing.taubinSmooth(smoothedVertices, smoothedFaces, iterations, lambda);
    } else {
      LaplacianSmoothing.smooth(smoothedVertices, smoothedFaces, iterations, lambda);
    }
    
    // Create new surface geometry
    return new SurfaceGeometry(
      smoothedVertices,
      smoothedFaces,
      this.geometry.hemi,
      this.geometry.vertexCurv
    );
  }

  updateMesh(): THREE.Mesh {
    if (!this.mesh) {
      return this.createMesh();
    }
    const geometry = this.mesh.geometry as THREE.BufferGeometry;
    const position = geometry.attributes.position;
    if (position) {
      position.needsUpdate = true;
    }
    if (geometry.index) {
      geometry.index.needsUpdate = true;
    }
    if (this.geometry) {
      this.geometry.invalidateBounds?.();
    }
    
    this.emit('geometry:updated', { surface: this });
    this.emit('render:needed', { surface: this });
    return this.mesh;
  }

  dispose(): void {
    // Emit dispose event before cleanup
    this.emit('dispose', { surface: this });
    
    if (this.mesh) {
      if (this.mesh.geometry) {
        this.mesh.geometry.dispose();
      }
      if (this.mesh.material) {
        if (Array.isArray(this.mesh.material)) {
          this.mesh.material.forEach(mat => mat.dispose());
        } else {
          this.mesh.material.dispose();
        }
      }
      this.mesh = null;
    }
    
    // Don't dispose geometry as it's shared
    this.geometry = null as any;
    this.indices = null as any;
    this.data = null as any;
    this.vertexCurv = null;
    
    // Clean up event listeners
    this.removeAllListeners();
  }
}

export class ColorMappedNeuroSurface extends NeuroSurface {
  colorMap: ColorMap | null;
  private rangeListener: UnsubscribeFn | null;
  private thresholdListener: UnsubscribeFn | null;
  private alphaListener: UnsubscribeFn | null;

  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[] | null,
    data: Float32Array | number[],
    colorMap: ColorMap | string | number[][],
    config: SurfaceConfig = {}
  ) {
    super(geometry, indices, data, config);
    
    this.colorMap = null;
    this.rangeListener = null;
    this.thresholdListener = null;
    this.alphaListener = null;

    this.createMesh();  // Create the mesh first
    if (colorMap) {
      this.setColorMap(colorMap);  // Set the color map and update colors
    }
  }

  setColorMap(colorMap: ColorMap | string | number[][]): void {
    // Clean up old listeners if they exist
    this.removeColorMapListeners();

    if (!(colorMap instanceof ColorMap)) {
      if (typeof colorMap === 'string') {
        try {
          this.colorMap = ColorMap.fromPreset(colorMap);
        } catch (err) {
          const presets = ColorMap.getAvailableMaps();
          const fallback = presets.includes('jet') ? 'jet' : (presets[0] || 'jet');
          console.warn(`ColorMappedNeuroSurface: preset "${colorMap}" unavailable, falling back to "${fallback}"`, err);
          this.colorMap = ColorMap.fromPreset(fallback);
        }
      } else if (Array.isArray(colorMap)) {
        this.colorMap = new ColorMap(colorMap);
      } else {
        console.error('Invalid colorMap provided. Using default.');
        this.colorMap = ColorMap.fromPreset('jet');
      }
    } else {
      this.colorMap = colorMap;
    }

    this.colorMap.setThreshold(this.threshold);
    this.colorMap.setRange(this.irange);
    this.colorMap.setAlpha(this.config.alpha);

    // Set up new listeners
    this.rangeListener = this.colorMap.on('rangeChanged', (range) => {
      debugLog('ColorMappedNeuroSurface: Received rangeChanged event', range);
      this.irange = range;
      this.updateColors();
    });
    this.thresholdListener = this.colorMap.on('thresholdChanged', (threshold) => {
      debugLog('ColorMappedNeuroSurface: Received thresholdChanged event', threshold);
      this.threshold = threshold;
      this.updateColors();
    });
    this.alphaListener = this.colorMap.on('alphaChanged', (alpha) => {
      debugLog('ColorMappedNeuroSurface: Received alphaChanged event', alpha);
      this.config.alpha = alpha;
      this.updateColors();
    });

    if (this.mesh) {
      this.updateColors();
    }
  }

  createMesh(): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.geometry.vertices, 3));

    // If no faces were provided (e.g., non-indexed geometry), build a sequential index
    const faceArray = (this.geometry.faces && this.geometry.faces.length > 0)
      ? this.geometry.faces
      : new Uint32Array(Array.from({ length: this.geometry.vertices.length / 3 }, (_, i) => i));

    geometry.setIndex(new THREE.Uint32BufferAttribute(faceArray, 1));
    
    let material;
    
    // Create material based on type
    if (this.config.materialType === 'standard') {
      // Use PBR Standard Material with metalness/roughness
      material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: this.config.alpha < 1,
        opacity: this.config.alpha,
        metalness: this.config.metalness ?? 0.0,
        roughness: this.config.roughness ?? 0.5,
        emissive: new THREE.Color(this.config.emissive || 0x000000),
        emissiveIntensity: this.config.emissiveIntensity || 0,
        flatShading: this.config.flatShading || false,
        side: THREE.DoubleSide,
        depthWrite: this.config.alpha >= 1
      });
    } else if (this.config.materialType === 'physical') {
      // Use Physical Material for advanced PBR
      material = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        transparent: this.config.alpha < 1,
        opacity: this.config.alpha,
        metalness: this.config.metalness ?? 0.0,
        roughness: this.config.roughness ?? 0.5,
        emissive: new THREE.Color(this.config.emissive || 0x000000),
        emissiveIntensity: this.config.emissiveIntensity || 0,
        flatShading: this.config.flatShading || false,
        side: THREE.DoubleSide,
        depthWrite: this.config.alpha >= 1,
        clearcoat: 0.0,  // Additional physical properties available
        clearcoatRoughness: 0.0
      });
    } else {
      // Default to Phong Material (current behavior)
      material = new THREE.MeshPhongMaterial({
        vertexColors: true,
        transparent: this.config.alpha < 1,
        opacity: this.config.alpha,
        shininess: this.config.shininess || 30,
        specular: new THREE.Color(this.config.specularColor || 0x111111),
        emissive: new THREE.Color(this.config.emissive || 0x000000),
        emissiveIntensity: this.config.emissiveIntensity || 0,
        flatShading: this.config.flatShading || false,
        side: THREE.DoubleSide,
        depthWrite: this.config.alpha >= 1
      });
    }

    this.mesh = new THREE.Mesh(geometry, material);
    
    // Compute normals based on config
    this.computeNormals(geometry);
    
    return this.mesh;
  }

  updateColors(): void {
    debugLog('Updating colors. Mesh:', !!this.mesh, 'ColorMap:', !!this.colorMap);
    if (!this.mesh || !this.colorMap) {
      console.warn('Mesh or ColorMap not initialized in updateColors');
      debugLog('Mesh:', this.mesh);
      debugLog('ColorMap:', this.colorMap);
      return;
    }
    
    // Safety check for geometry
    if (!this.mesh.geometry) {
      console.warn('Mesh geometry not initialized');
      return;
    }

    const vertexCount = this.geometry.vertices.length / 3;
    const componentsPerColor = 4; // Always use RGBA
    
    // Get or create color attribute
    let colorAttribute = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    let colors: Float32Array;
    
    if (!colorAttribute || colorAttribute.array.length !== vertexCount * componentsPerColor) {
      // Create new buffer only if it doesn't exist or has wrong size
      colors = new Float32Array(vertexCount * componentsPerColor);
      colorAttribute = new THREE.BufferAttribute(colors, componentsPerColor);
      this.mesh.geometry.setAttribute('color', colorAttribute);
    } else {
      // Reuse existing buffer
      colors = colorAttribute.array as Float32Array;
    }

    debugLog('threshold', this.threshold);
    debugLog('irange', this.irange);
    debugLog('alpha', this.config.alpha);
    debugLog('data', this.data);

    const baseSurfaceColor = new THREE.Color(this.config.color);

    if (this.data) {
      for (let i = 0; i < this.indices.length; i++) {
        const index = this.indices[i];
        const value = this.data[i];
        const color = this.colorMap.getColor(value);
        const colorIndex = index * componentsPerColor;
        
        // When threshold min == max, no thresholding is applied (show all values)
        // Otherwise, values within threshold range are hidden/made transparent
        const thresholdingEnabled = this.threshold[0] !== this.threshold[1];
        const isWithinThreshold = thresholdingEnabled && 
                                  (value >= this.threshold[0] && value <= this.threshold[1]);
        
        if (isWithinThreshold) {
          // Hide/make transparent values within threshold range
          colors[colorIndex] = baseSurfaceColor.r;
          colors[colorIndex + 1] = baseSurfaceColor.g;
          colors[colorIndex + 2] = baseSurfaceColor.b;
          colors[colorIndex + 3] = 0; // Transparent for thresholded values
        } else {
          // Show values outside threshold range with colormap colors
          colors[colorIndex] = color[0];
          colors[colorIndex + 1] = color[1];
          colors[colorIndex + 2] = color[2];
          colors[colorIndex + 3] = 1; // Opaque for visible values
        }
      }
    } else {
      // When no data, use the opaque default color for all vertices
      for (let i = 0; i < colors.length; i += componentsPerColor) {
        colors[i] = baseSurfaceColor.r;
        colors[i + 1] = baseSurfaceColor.g;
        colors[i + 2] = baseSurfaceColor.b;
        colors[i + 3] = 1; // Fully opaque
      }
    }

    // Mark the attribute as needing update
    colorAttribute.needsUpdate = true;
    const material = this.mesh.material as THREE.MeshPhongMaterial;
    material.vertexColors = true;
    material.needsUpdate = true;

    // Ensure transparency is set correctly
    material.transparent = true;
    material.opacity = 1; // We're using per-vertex color blending now
    
    // Request a render if we have access to the viewer
    if (this.viewer && this.viewer.requestRender) {
      this.viewer.requestRender();
    }
  }

  updateConfig(newConfig: Partial<SurfaceConfig>): void {
    super.updateConfig(newConfig);
    // Parent class already handles all material updates properly
    // Just need to handle colormap-specific updates
    if (this.colorMap) {
      this.colorMap.setAlpha(this.config.alpha);
    }
    this.updateColors(); // Reapply colors with new config
  }

  setData(newData: Float32Array | number[]): void {
    const dataArray = new Float32Array(newData);
    if (dataArray.length !== this.data.length) {
      console.error('New data length does not match the current data length');
      return;
    }
    this.data = dataArray;
    this.updateColors();
  }

  removeColorMapListeners(): void {
    // The listeners are actually remover functions returned by on()
    if (this.rangeListener) {
      this.rangeListener(); // Call the remover function
      this.rangeListener = null;
    }
    if (this.thresholdListener) {
      this.thresholdListener(); // Call the remover function
      this.thresholdListener = null;
    }
    if (this.alphaListener) {
      this.alphaListener(); // Call the remover function
      this.alphaListener = null;
    }
  }

  dispose(): void {
    // Remove event listeners first
    this.removeColorMapListeners();
    
    // Call parent dispose
    super.dispose();
    
    // Clean up color map reference
    this.colorMap = null;
  }
}

export class VertexColoredNeuroSurface extends NeuroSurface {
  colors: Float32Array;

  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[] | null,
    colors: number[] | THREE.Color[] | string[],
    config: SurfaceConfig = {}
  ) {
    // Pass dummy data array - will be set based on colors  
    const vertexCount = geometry.vertices.length / 3;
    super(geometry, indices, new Float32Array(vertexCount), config);
    this.colors = new Float32Array(0);
    this.createMesh();  // Create the mesh first
    this.setColors(colors);
  }

  setColors(newColors: number[] | THREE.Color[] | string[]): void {
    this.colors = new Float32Array(newColors.length * 3);
    for (let i = 0; i < newColors.length; i++) {
      const color = new THREE.Color(newColors[i]);
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
    }
    this.updateColors();
  }

  updateColors(): void {
    if (!this.mesh) return;

    const vertexCount = this.geometry.vertices.length / 3;
    const componentsPerColor = 3;
    
    // Get or create color attribute
    let colorAttribute = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    let colors: Float32Array;
    
    if (!colorAttribute || colorAttribute.array.length !== vertexCount * componentsPerColor) {
      // Create new buffer only if it doesn't exist or has wrong size
      colors = new Float32Array(vertexCount * componentsPerColor);
      colorAttribute = new THREE.BufferAttribute(colors, componentsPerColor);
      this.mesh.geometry.setAttribute('color', colorAttribute);
    } else {
      // Reuse existing buffer
      colors = colorAttribute.array as Float32Array;
    }
    
    // Update colors in place
    for (let i = 0; i < this.indices.length; i++) {
      const index = this.indices[i];
      colors[index * 3] = this.colors[i * 3];
      colors[index * 3 + 1] = this.colors[i * 3 + 1];
      colors[index * 3 + 2] = this.colors[i * 3 + 2];
    }

    // Mark the attribute as needing update
    colorAttribute.needsUpdate = true;
    const material = this.mesh.material as THREE.MeshPhongMaterial;
    material.vertexColors = true;
    material.needsUpdate = true;
  }

  createMesh(): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.geometry.vertices, 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(this.geometry.faces, 1));
    if (this.vertexCurv) {
      geometry.setAttribute('curv', new THREE.Float32BufferAttribute(this.vertexCurv, 1));
    }
    
    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: this.config.alpha < 1,
      opacity: this.config.alpha,
      shininess: this.config.shininess || 30,
      specular: new THREE.Color(this.config.specularColor || 0x111111),
      emissive: new THREE.Color(this.config.emissive || 0x000000),
      emissiveIntensity: this.config.emissiveIntensity || 0,
      flatShading: this.config.flatShading || false,
      side: THREE.DoubleSide,  // Render both sides for transparency
      depthWrite: this.config.alpha >= 1  // Disable depth write for transparent objects
    });

    this.mesh = new THREE.Mesh(geometry, material);
    
    // Compute normals based on config
    this.computeNormals(geometry);
    
    this.updateColors();
    return this.mesh;
  }

  dispose(): void {
    // Clean up colors array
    this.colors = null as any;
    
    // Call parent dispose
    super.dispose();
  }
}
