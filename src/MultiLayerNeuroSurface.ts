import * as THREE from 'three';
import { NeuroSurface, SurfaceGeometry, SurfaceConfig } from './classes';
import { LayerStack, BaseLayer, RGBALayer, DataLayer, TwoDataLayer, LabelLayer, Layer, TwoDataLayerConfig } from './layers';
import ColorMap2D, { ColorMap2DPreset } from './ColorMap2D';
import { CurvatureLayer, CurvatureConfig } from './layers/CurvatureLayer';
import { ClipPlaneSet, ClipPlane, ClipAxis } from './utils/ClipPlane';
import { debugLog } from './debug';
import ColorMap from './ColorMap';
import { GPULayerCompositor } from './GPULayerCompositor';
import { OutlineLayer } from './OutlineLayer';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

export interface MultiLayerSurfaceConfig extends SurfaceConfig {
  baseColor?: THREE.ColorRepresentation;
  metalness?: number;
  roughness?: number;
  useGPUCompositing?: boolean; // Enable GPU-accelerated compositing
  useWideLines?: boolean; // Use Line2 wide segments for outlines

  /** Pre-computed curvature data to display as underlay */
  curvature?: Float32Array | number[];
  /** Show curvature underlay (default: true if curvature provided) */
  showCurvature?: boolean;
  /** Curvature display options */
  curvatureOptions?: {
    brightness?: number;  // Base gray level (0-1), default 0.5
    contrast?: number;    // Curvature influence (0-1), default 0.5
    smoothness?: number;  // Curvature scaling factor, default 1
  };
}

type EdgeList = Array<[number, number]>;

function computeBoundaryEdges(
  faces: Uint32Array,
  roiLabels: ArrayLike<number>,
  roiSubset: number[] | null
): EdgeList {
  const edges: EdgeList = [];
  const seen = new Set<string>();
  const subset = roiSubset && roiSubset.length ? new Set(roiSubset) : null;

  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const roiA = roiLabels[a];
    const roiB = roiLabels[b];
    if (roiA === roiB) return;
    if (subset && !subset.has(roiA) && !subset.has(roiB)) return;

    const keyA = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(keyA)) return;
    seen.add(keyA);
    edges.push(a < b ? [a, b] : [b, a]);
  };

  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i];
    const b = faces[i + 1];
    const c = faces[i + 2];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  return edges;
}

export interface LayerUpdate {
  id: string;
  type?: 'base' | 'rgba' | 'data' | 'outline' | 'label' | 'curvature';
  data?: Float32Array;
  indices?: Uint32Array;
  colormap?: ColorMap | string;
  colorMap?: ColorMap | string; // Allow both spellings
  color?: THREE.ColorRepresentation;
  opacity?: number;
  visible?: boolean;
  blendMode?: 'normal' | 'additive' | 'multiply';
  order?: number;
  roiLabels?: Uint32Array | Int32Array | number[];
  halo?: boolean;
  haloColor?: THREE.ColorRepresentation;
  haloWidth?: number;
  width?: number;
  roiSubset?: number[] | null;
  offset?: number;
  labels?: Uint32Array | Int32Array | number[];
  labelDefs?: Array<{ id: number; color: THREE.ColorRepresentation; name?: string }>;
  defaultColor?: THREE.ColorRepresentation;
  // Curvature layer properties
  curvature?: Float32Array | number[];
  brightness?: number;
  contrast?: number;
  smoothness?: number;
}

export interface ClearLayersOptions {
  /**
   * When true, removes the base layer(s) as well. Defaults to false.
   */
  includeBase?: boolean;
}

/**
 * Multi-layer brain surface with flexible layer compositing
 */
export class MultiLayerNeuroSurface extends NeuroSurface {
  layerStack: LayerStack;
  compositeBuffer: Float32Array;
  vertexCount: number;
  private _updatePending: boolean;
  private useGPUCompositing: boolean;
  private gpuCompositor: GPULayerCompositor | null = null;
  private outlineResolution: THREE.Vector2 | null = null;
  private useWideLines: boolean;

  /** Clip plane set for surface clipping */
  readonly clipPlanes: ClipPlaneSet;

  constructor(geometry: SurfaceGeometry, config: MultiLayerSurfaceConfig = {}) {
    // Initialize with empty data
    const vertexCount = geometry.vertices.length / 3;
    // For visualization, we need indices for all vertices
    const indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      indices[i] = i;
    }
    
    // Pass empty data array for now
    super(geometry, indices, new Float32Array(vertexCount), config);
    
    this.layerStack = new LayerStack();
    this.compositeBuffer = new Float32Array(vertexCount * 4);
    this.vertexCount = vertexCount;
    this._updatePending = false; // For throttling updates
    this.useGPUCompositing = config.useGPUCompositing ?? false; // Default to CPU for compatibility
    this.useWideLines = config.useWideLines ?? true;
    this.clipPlanes = new ClipPlaneSet();
    
    // Initialize GPU compositor if requested
    if (this.useGPUCompositing && this.supportsWebGL2()) {
      try {
        this.gpuCompositor = new GPULayerCompositor(vertexCount);
        debugLog('GPU compositing enabled for surface');
      } catch (error) {
        console.warn('Failed to initialize GPU compositor, falling back to CPU:', error);
        this.useGPUCompositing = false;
      }
    } else if (this.useGPUCompositing) {
      console.warn('GPU compositing requested but WebGL2 not available; falling back to CPU');
      this.useGPUCompositing = false;
    }
    
    // Add curvature layer if provided (renders below base layer)
    if (config.curvature && config.showCurvature !== false) {
      const curvOpts = config.curvatureOptions || {};
      const curvLayer = new CurvatureLayer('curvature', config.curvature, {
        brightness: curvOpts.brightness,
        contrast: curvOpts.contrast,
        smoothness: curvOpts.smoothness,
        order: -2 // Below base layer
      });
      this.layerStack.addLayer(curvLayer);
      debugLog(`CurvatureLayer added with ${(config.curvature as any).length} vertices`);
    }

    // Add base layer
    const baseColor = config.baseColor || 0xcccccc;
    const baseLayer = new BaseLayer(typeof baseColor === 'number' ? baseColor : new THREE.Color(baseColor).getHex(), { opacity: 1 });
    this.layerStack.addLayer(baseLayer);

    // Create the mesh
    this.createMesh();
    
    // Initial color update
    this.updateColors();
  }

  /**
   * Toggle a simple edge wireframe for debugging/presentation. Creates if missing.
   */
  toggleWireframe(enabled: boolean): void {
    if (!this.mesh) return;
    const existing = this.mesh.getObjectByName('__WIREFRAME__') as THREE.LineSegments | undefined;
    if (enabled && !existing) {
      const edges = new THREE.EdgesGeometry(this.mesh.geometry as THREE.BufferGeometry, 5);
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.6 })
      );
      line.name = '__WIREFRAME__';
      this.mesh.add(line);
    }
    const wire = this.mesh.getObjectByName('__WIREFRAME__');
    if (wire) wire.visible = enabled;
    if (this.mesh.material) {
      (this.mesh.material as any).visible = !enabled ? true : (this.mesh.material as any).visible;
    }
    this.requestColorUpdate();
  }

  /**
   * Build or rebuild the line objects for an outline layer and attach them to the surface mesh.
   */
  private applyOutlineLayer(layer: OutlineLayer): void {
    if (!this.mesh) return;

    // Dispose previous objects if any
    this.detachOutlineLayer(layer);

    const outlineObjects = this.buildOutlineObjects(layer);
    if (!outlineObjects) {
      debugLog(`OutlineLayer ${layer.id}: no boundary edges found`);
      return;
    }

    if (outlineObjects.halo) {
      outlineObjects.halo.renderOrder = (layer.order || 0) - 0.5;
      this.mesh.add(outlineObjects.halo);
      layer.haloObject = outlineObjects.halo;
    }

    outlineObjects.line.renderOrder = layer.order || 0;
    this.mesh.add(outlineObjects.line);
    layer.lineObject = outlineObjects.line;

    layer.needsUpdate = false;
    this.emit('layer:updated', { surface: this, layer });
    this.requestColorUpdate();
  }

  private detachOutlineLayer(layer: OutlineLayer): void {
    const mesh = this.mesh;
    if (!mesh) return;

    const removeObject = (obj: THREE.Object3D | null) => {
      if (!obj) return;
      if (obj.parent === mesh) {
        mesh.remove(obj);
      }
      obj.traverse(o => {
        const anyObj = o as any;
        if (anyObj.geometry?.dispose) {
          anyObj.geometry.dispose();
        }
        if (anyObj.material?.dispose) {
          anyObj.material.dispose();
        }
      });
    };

    removeObject(layer.lineObject);
    removeObject(layer.haloObject);
    layer.lineObject = null;
    layer.haloObject = null;
  }

  private ensureOutlineResolution(): void {
    if (!this.outlineResolution) {
      this.outlineResolution = new THREE.Vector2();
    }

    if (this.viewer && this.viewer.renderer && this.viewer.renderer.getSize) {
      this.viewer.renderer.getSize(this.outlineResolution);
    } else {
      this.outlineResolution.set(
        (this.viewer as any)?.width || 1,
        (this.viewer as any)?.height || 1
      );
    }
  }

  private setMaterialResolution(
    object: THREE.Object3D | null,
    width: number,
    height: number
  ): void {
    if (!object) return;
    object.traverse(o => {
      const mat = (o as any).material;
      if (mat && mat.resolution && typeof mat.resolution.set === 'function') {
        mat.resolution.set(width, height);
      }
    });
  }

  private buildOutlineObjects(layer: OutlineLayer): { line: THREE.LineSegments | LineSegments2; halo?: THREE.LineSegments | LineSegments2 } | null {
    if (!this.mesh) return null;

    if (layer.roiLabels.length !== this.vertexCount) {
      console.warn(
        `OutlineLayer ${layer.id}: roiLabels length ${layer.roiLabels.length} does not match vertex count ${this.vertexCount}`
      );
    }

    const geometry = this.mesh.geometry as THREE.BufferGeometry;
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    let normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;

    if (!normalAttr) {
      geometry.computeVertexNormals();
      normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    }

    if (!positionAttr || !normalAttr) return null;

    const edges = computeBoundaryEdges(this.geometry.faces, layer.roiLabels, layer.roiSubset);
    if (!edges.length) {
      return null;
    }

    const positions: number[] = [];
    const pos = positionAttr.array as ArrayLike<number>;
    const normals = normalAttr.array as ArrayLike<number>;
    const offset = layer.offset || 0;

    for (const [a, b] of edges) {
      const ax = pos[a * 3];
      const ay = pos[a * 3 + 1];
      const az = pos[a * 3 + 2];
      const bx = pos[b * 3];
      const by = pos[b * 3 + 1];
      const bz = pos[b * 3 + 2];

      const anx = normals[a * 3];
      const any = normals[a * 3 + 1];
      const anz = normals[a * 3 + 2];
      const bnx = normals[b * 3];
      const bny = normals[b * 3 + 1];
      const bnz = normals[b * 3 + 2];

      positions.push(
        ax + anx * offset,
        ay + any * offset,
        az + anz * offset,
        bx + bnx * offset,
        by + bny * offset,
        bz + bnz * offset
      );
    }

    this.ensureOutlineResolution();
    const resolutionX = this.outlineResolution?.x || 1;
    const resolutionY = this.outlineResolution?.y || 1;

    const lineGeom = this.useWideLines ? new LineSegmentsGeometry() : new THREE.BufferGeometry();
    if (lineGeom instanceof LineSegmentsGeometry) {
      lineGeom.setPositions(positions);
    } else {
      lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    }

    const createMaterial = (color: number, width: number, opacity: number) => {
      if (this.useWideLines) {
        const mat = new LineMaterial({
          color,
          linewidth: width,
          transparent: opacity < 1,
          opacity,
          depthTest: true,
          depthWrite: false
        });
        mat.resolution.set(resolutionX, resolutionY);
        return mat;
      }
      return new THREE.LineBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity
      });
    };

    const lineMat = createMaterial(layer.color, layer.width, layer.opacity);
    const line = this.useWideLines
      ? new LineSegments2(lineGeom as LineSegmentsGeometry, lineMat as LineMaterial)
      : new THREE.LineSegments(lineGeom as THREE.BufferGeometry, lineMat as THREE.LineBasicMaterial);
    line.visible = layer.visible;

    let halo: THREE.LineSegments | LineSegments2 | undefined;
    if (layer.halo) {
      const haloMat = createMaterial(
        layer.haloColor,
        layer.width + layer.haloWidth,
        Math.min(1, layer.opacity * 0.6)
      );
      const haloGeom = this.useWideLines ? (lineGeom as LineSegmentsGeometry).clone() : (lineGeom as THREE.BufferGeometry).clone();
      halo = this.useWideLines
        ? new LineSegments2(haloGeom as LineSegmentsGeometry, haloMat as LineMaterial)
        : new THREE.LineSegments(haloGeom as THREE.BufferGeometry, haloMat as THREE.LineBasicMaterial);
      halo.visible = layer.visible;
    }

    return { line, halo };
  }

  updateOutlineResolution(width: number, height: number, dpr: number = 1): void {
    if (!this.outlineResolution) {
      this.outlineResolution = new THREE.Vector2();
    }
    this.outlineResolution.set(width * dpr, height * dpr);

    this.layerStack.getAllLayers().forEach(layer => {
      if (layer instanceof OutlineLayer) {
        this.setMaterialResolution(layer.lineObject, width * dpr, height * dpr);
        this.setMaterialResolution(layer.haloObject, width * dpr, height * dpr);
      }
    });
  }

  /**
   * Request a color update (throttled)
   */
  requestColorUpdate(): void {
    if (!this._updatePending) {
      this._updatePending = true;
      // Use requestAnimationFrame for smooth updates
      requestAnimationFrame(() => {
        this._updatePending = false;
        this.updateColors();
        this.emit('render:needed', { surface: this });
      });
    }
  }

  /**
   * Add a layer to the surface
   */
  addLayer(layer: Layer): void {
    this.layerStack.addLayer(layer);
    this.emit('layer:added', { surface: this, layer });
    if (layer instanceof OutlineLayer) {
      this.applyOutlineLayer(layer);
    } else {
      this.requestColorUpdate();
    }
  }

  /**
   * Add a 2D data layer that maps two scalar fields to a 2D colormap.
   *
   * This is a convenience method for creating TwoDataLayer instances.
   *
   * @param id - Layer identifier
   * @param dataX - First scalar field (X axis of colormap)
   * @param dataY - Second scalar field (Y axis of colormap)
   * @param colorMap - 2D colormap preset name or ColorMap2D instance
   * @param config - Layer configuration options
   *
   * @example
   * ```typescript
   * // Visualize effect size vs. confidence
   * surface.addTwoDataLayer(
   *   'effect-confidence',
   *   effectSizeData,
   *   confidenceData,
   *   'confidence',
   *   {
   *     rangeX: [-2, 2],
   *     rangeY: [0, 1],
   *     thresholdY: [0, 0.05]  // Hide low-confidence values
   *   }
   * );
   * ```
   */
  addTwoDataLayer(
    id: string,
    dataX: Float32Array | number[],
    dataY: Float32Array | number[],
    colorMap: ColorMap2D | ColorMap2DPreset = 'confidence',
    config: TwoDataLayerConfig = {}
  ): TwoDataLayer {
    const layer = new TwoDataLayer(id, dataX, dataY, null, colorMap, config);
    this.addLayer(layer);
    return layer;
  }

  /**
   * Get a TwoDataLayer by ID (type-safe convenience method)
   */
  getTwoDataLayer(id: string): TwoDataLayer | undefined {
    const layer = this.layerStack.getLayer(id);
    return layer instanceof TwoDataLayer ? layer : undefined;
  }

  /**
   * Remove a layer by ID
   */
  removeLayer(id: string): boolean {
    const layer = this.layerStack.getLayer(id);
    if (layer instanceof OutlineLayer) {
      this.detachOutlineLayer(layer);
    }

    if (this.layerStack.removeLayer(id)) {
      this.emit('layer:removed', { surface: this, layerId: id });
      this.requestColorUpdate();
      return true;
    }
    return false;
  }

  /**
   * Remove all non-base layers (optionally including base).
   */
  clearLayers(options: ClearLayersOptions = {}): void {
    const includeBase = options.includeBase ?? false;

    this.layerStack.getAllLayers().forEach(layer => {
      const isBaseLayer = layer instanceof BaseLayer || layer.id.startsWith('base');
      if (!includeBase && isBaseLayer) {
        return;
      }
      this.removeLayer(layer.id);
    });
  }

  /**
   * Update a layer's properties
   */
  updateLayer(id: string, updates: Record<string, any>): void {
    this.layerStack.updateLayer(id, updates);
    const layer = this.layerStack.getLayer(id);
    if (layer instanceof OutlineLayer && layer.needsUpdate) {
      this.layerStack.needsComposite = false;
      this.applyOutlineLayer(layer);
    } else if (this.layerStack.needsComposite) {
      this.requestColorUpdate();
    }
  }

  updateLayerData(id: string, data: Float32Array | number[], indices?: Uint32Array | number[] | null): void {
    this.updateLayer(id, { data, indices });
  }

  updateLayerVisibility(id: string, visible: boolean): void {
    this.updateLayer(id, { visible });
  }

  /**
   * Get a layer by ID
   */
  getLayer(id: string): Layer | undefined {
    return this.layerStack.getLayer(id);
  }

  /**
   * Set curvature data for display as underlay.
   * Creates curvature layer if it doesn't exist.
   *
   * @param curvature - Curvature values per vertex
   * @param options - Display options (brightness, contrast, smoothness)
   */
  setCurvature(
    curvature: Float32Array | number[],
    options?: { brightness?: number; contrast?: number; smoothness?: number }
  ): void {
    const existing = this.layerStack.getLayer('curvature');
    if (existing && existing instanceof CurvatureLayer) {
      existing.setCurvature(curvature);
      if (options?.brightness !== undefined) existing.setBrightness(options.brightness);
      if (options?.contrast !== undefined) existing.setContrast(options.contrast);
      if (options?.smoothness !== undefined) existing.setSmoothness(options.smoothness);
    } else {
      const layer = new CurvatureLayer('curvature', curvature, {
        brightness: options?.brightness,
        contrast: options?.contrast,
        smoothness: options?.smoothness,
        order: -2
      });
      this.layerStack.addLayer(layer);
    }
    this.requestColorUpdate();
  }

  /**
   * Get the curvature layer if it exists
   */
  getCurvatureLayer(): CurvatureLayer | undefined {
    const layer = this.layerStack.getLayer('curvature');
    return layer instanceof CurvatureLayer ? layer : undefined;
  }

  /**
   * Toggle curvature visibility
   */
  showCurvature(visible: boolean): void {
    const layer = this.getCurvatureLayer();
    if (layer) {
      layer.setVisible(visible);
      this.requestColorUpdate();
    }
  }

  // ============================================================
  // Clip Plane Methods
  // ============================================================

  /**
   * Set a clip plane by axis.
   *
   * @param axis - Which axis to clip ('x', 'y', or 'z')
   * @param distance - Distance from origin along axis
   * @param enabled - Whether to enable (default: true)
   * @param flip - Flip clipping direction (default: false)
   *
   * @example
   * // Clip at x=0 (midline sagittal cut)
   * surface.setClipPlane('x', 0);
   *
   * // Clip right hemisphere only
   * surface.setClipPlane('x', 0, true, true);
   */
  setClipPlane(
    axis: ClipAxis,
    distance: number,
    enabled = true,
    flip = false
  ): void {
    this.clipPlanes.setClipPlane(axis, distance, enabled, flip);
    this._syncClipPlanes();
    this.requestColorUpdate();
  }

  /**
   * Enable a clip plane.
   */
  enableClipPlane(axis: ClipAxis): void {
    this.clipPlanes.enableClipPlane(axis);
    this._syncClipPlanes();
    this.requestColorUpdate();
  }

  /**
   * Disable a clip plane.
   */
  disableClipPlane(axis: ClipAxis): void {
    this.clipPlanes.disableClipPlane(axis);
    this._syncClipPlanes();
    this.requestColorUpdate();
  }

  /**
   * Clear all clip planes (disable all).
   */
  clearClipPlanes(): void {
    this.clipPlanes.clearClipPlanes();
    this._syncClipPlanes();
    this.requestColorUpdate();
  }

  /**
   * Get a clip plane by axis.
   */
  getClipPlane(axis: ClipAxis): ClipPlane {
    return this.clipPlanes.getClipPlane(axis);
  }

  /**
   * Sync clip planes to both CPU and GPU materials.
   */
  private _syncClipPlanes(): void {
    // Sync to GPU compositor
    if (this.gpuCompositor) {
      this.gpuCompositor.setClipPlanes(this.clipPlanes);
    }

    // Sync to CPU material
    if (this.mesh && this.mesh.material) {
      const material = this.mesh.material as THREE.Material;
      if ('clippingPlanes' in material) {
        const threePlanes = this.clipPlanes.getThreePlanes();
        (material as any).clippingPlanes = threePlanes.length > 0 ? threePlanes : null;
        material.needsUpdate = true;
      }
    }

    // Enable clipping on the renderer if we have any planes
    if (this.viewer?.renderer) {
      this.viewer.renderer.localClippingEnabled = this.clipPlanes.hasEnabledPlanes();
    }
  }

  /**
   * Set the order of layers (bottom to top)
   */
  setLayerOrder(ids: string[]): void {
    this.layerStack.setLayerOrder(ids);
    this.requestColorUpdate();
  }

  /**
   * Batch update multiple layers
   */
  updateLayers(updates: LayerUpdate[]): void {
    let needsUpdate = false;
    
    updates.forEach(update => {
      const { id, type, ...props } = update;
      
      if (type) {
        // Create new layer
        let layer: Layer | null = null;
        switch (type) {
          case 'base':
            const color = props.color || 0xcccccc;
            layer = new BaseLayer(typeof color === 'number' ? color : new THREE.Color(color).getHex(), props);
            break;
          case 'rgba':
            if (props.data) {
              layer = new RGBALayer(id, props.data, props);
            }
            break;
          case 'data':
            if (props.data && props.indices) {
              const colormap = props.colormap || props.colorMap;
              layer = new DataLayer(id, props.data, props.indices, colormap || 'jet', props);
            }
            break;
          case 'label':
            if (props.labels && props.labelDefs) {
              layer = new LabelLayer(id, {
                labels: props.labels,
                labelDefs: props.labelDefs,
                defaultColor: props.defaultColor,
                visible: props.visible,
                opacity: props.opacity,
                blendMode: props.blendMode,
                order: props.order
              });
            }
            break;
          case 'outline':
            if (props.roiLabels) {
              layer = new OutlineLayer(id, {
                roiLabels: props.roiLabels,
                color: props.color,
                width: props.width,
                opacity: props.opacity,
                halo: props.halo,
                haloColor: props.haloColor,
                haloWidth: props.haloWidth,
                offset: props.offset,
                roiSubset: props.roiSubset,
                visible: props.visible,
                blendMode: props.blendMode,
                order: props.order
              });
            }
            break;
          case 'curvature':
            if (props.curvature) {
              layer = new CurvatureLayer(id, props.curvature, {
                brightness: props.brightness,
                contrast: props.contrast,
                smoothness: props.smoothness,
                visible: props.visible,
                opacity: props.opacity,
                blendMode: props.blendMode,
                order: props.order ?? -2
              });
            }
            break;
          default:
            console.warn(`Unknown layer type: ${type}`);
            return;
        }
        
        if (layer) {
          this.layerStack.addLayer(layer);
          if (layer instanceof OutlineLayer) {
            this.applyOutlineLayer(layer);
          }
          needsUpdate = true;
        }
      } else {
        // Update existing layer
        this.layerStack.updateLayer(id, props);
        if (this.layerStack.getLayer(id) instanceof OutlineLayer) {
          const outlineLayer = this.layerStack.getLayer(id) as OutlineLayer;
          if (outlineLayer.needsUpdate) {
            this.applyOutlineLayer(outlineLayer);
          }
        }
        needsUpdate = needsUpdate || this.layerStack.needsComposite;
      }
    });
    
    if (needsUpdate) {
      this.emit('layer:updated', { surface: this, layer: this.layerStack.getLayer(updates[0].id) });
      this.requestColorUpdate();
    }
  }

  /**
   * Composite all layers and update mesh colors
   */
  updateColors(): void {
    if (!this.mesh) {
      debugLog('MultiLayerNeuroSurface: No mesh to update');
      return;
    }
    
    debugLog('MultiLayerNeuroSurface: Updating colors');
    
    // Use GPU compositor if available
    if (this.useGPUCompositing && this.gpuCompositor) {
      this.updateColorsGPU();
      return;
    }
    
    // Fall back to CPU compositing
    this.updateColorsCPU();
  }

  /**
   * Update colors using GPU compositor
   */
  private updateColorsGPU(): void {
    if (!this.gpuCompositor) return;
    
    const visibleLayers = this.layerStack
      .getVisibleLayers()
      .filter(layer => !(layer instanceof OutlineLayer));
    this.gpuCompositor.updateLayers(visibleLayers);
    visibleLayers.forEach(layer => (layer.needsUpdate = false));
    
    // Mark as updated
    this.layerStack.needsComposite = false;
    
    // Request render
    if (this.viewer && this.viewer.requestRender) {
      this.viewer.requestRender();
    }
  }

  /**
   * Update colors using CPU compositing (original method)
   */
  private updateColorsCPU(): void {
    // Initialize composite buffer with base color (not zeros/transparent black)
    // This provides a fallback if overlay data is invalid/transparent
    const baseColor = (this.config as MultiLayerSurfaceConfig).baseColor || 0xcccccc;
    const baseColorNum = typeof baseColor === 'number' ? baseColor : new THREE.Color(baseColor).getHex();
    const r = ((baseColorNum >> 16) & 255) / 255;
    const g = ((baseColorNum >> 8) & 255) / 255;
    const b = (baseColorNum & 255) / 255;

    // Initialize all vertices with base color (full alpha)
    for (let i = 0; i < this.compositeBuffer.length; i += 4) {
      this.compositeBuffer[i] = r;
      this.compositeBuffer[i + 1] = g;
      this.compositeBuffer[i + 2] = b;
      this.compositeBuffer[i + 3] = 1.0;
    }

    debugLog(`MultiLayerNeuroSurface: updateColorsCPU initialized with base color rgb(${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)})`);

    // Get visible layers in order
    const visibleLayers = this.layerStack
      .getVisibleLayers()
      .filter(layer => !(layer instanceof OutlineLayer));

    debugLog(`MultiLayerNeuroSurface: updateColorsCPU found ${visibleLayers.length} visible layers`);

    if (visibleLayers.length === 0) {
      debugLog('No visible layers');
      this.applyCompositeToMesh();
      return;
    }

    // Composite each layer
    for (const layer of visibleLayers) {
      try {
        debugLog(`MultiLayerNeuroSurface: Processing layer ${layer.id} (type: ${layer.constructor.name})`);
        const layerRGBA = layer.getRGBAData(this.vertexCount);

        // Debug: sample first few values
        if (layerRGBA.length >= 8) {
          const sample = Array.from(layerRGBA.slice(0, 8)).map(v => v.toFixed(3));
          debugLog(`MultiLayerNeuroSurface: Layer ${layer.id} RGBA sample [0..7]: ${sample.join(', ')}`);
        }

        // Count non-transparent pixels
        let nonTransparentCount = 0;
        for (let i = 3; i < layerRGBA.length; i += 4) {
          if (layerRGBA[i] > 0) nonTransparentCount++;
        }
        debugLog(`MultiLayerNeuroSurface: Layer ${layer.id} has ${nonTransparentCount}/${this.vertexCount} non-transparent vertices`);

        this.compositeLayer(layerRGBA, layer);
        layer.needsUpdate = false;
      } catch (error) {
        console.error(`Error processing layer ${layer.id}:`, error);
      }
    }

    // Apply composite to mesh
    this.applyCompositeToMesh();

    // Mark as updated
    this.layerStack.needsComposite = false;

    // Request render
    if (this.viewer && this.viewer.requestRender) {
      this.viewer.requestRender();
    }
  }

  /**
   * Composite a single layer into the buffer
   */
  private compositeLayer(layerRGBA: Float32Array, layer: Layer): void {
    const blendMode = layer.blendMode;
    const opacity = layer.opacity;
    
    for (let i = 0; i < this.vertexCount; i++) {
      const offset = i * 4;
      const srcR = layerRGBA[offset];
      const srcG = layerRGBA[offset + 1];
      const srcB = layerRGBA[offset + 2];
      const srcA = layerRGBA[offset + 3] * opacity;
      
      if (srcA === 0) continue; // Skip transparent pixels
      
      const dstR = this.compositeBuffer[offset];
      const dstG = this.compositeBuffer[offset + 1];
      const dstB = this.compositeBuffer[offset + 2];
      const dstA = this.compositeBuffer[offset + 3];
      
      switch (blendMode) {
        case 'normal':
          // Standard alpha blending
          const alpha = srcA + dstA * (1 - srcA);
          if (alpha > 0) {
            this.compositeBuffer[offset] = (srcR * srcA + dstR * dstA * (1 - srcA)) / alpha;
            this.compositeBuffer[offset + 1] = (srcG * srcA + dstG * dstA * (1 - srcA)) / alpha;
            this.compositeBuffer[offset + 2] = (srcB * srcA + dstB * dstA * (1 - srcA)) / alpha;
            this.compositeBuffer[offset + 3] = alpha;
          }
          break;
          
        case 'additive':
          // Additive blending (good for activations)
          this.compositeBuffer[offset] = Math.min(1, dstR + srcR * srcA);
          this.compositeBuffer[offset + 1] = Math.min(1, dstG + srcG * srcA);
          this.compositeBuffer[offset + 2] = Math.min(1, dstB + srcB * srcA);
          this.compositeBuffer[offset + 3] = Math.min(1, dstA + srcA);
          break;
          
        case 'multiply':
          // Multiply blending
          const invSrcA = 1 - srcA;
          this.compositeBuffer[offset] = dstR * (invSrcA + srcR * srcA);
          this.compositeBuffer[offset + 1] = dstG * (invSrcA + srcG * srcA);
          this.compositeBuffer[offset + 2] = dstB * (invSrcA + srcB * srcA);
          this.compositeBuffer[offset + 3] = dstA + srcA * (1 - dstA);
          break;
      }
    }
  }

  /**
   * Check if composite buffer has any non-zero alpha values (valid color data)
   */
  private hasValidColorData(): boolean {
    for (let i = 3; i < this.compositeBuffer.length; i += 4) {
      if (this.compositeBuffer[i] > 0) return true;
    }
    return false;
  }

  /**
   * Apply the composite buffer to the mesh
   */
  private applyCompositeToMesh(): void {
    if (!this.mesh) return;

    const geometry = this.mesh.geometry as THREE.BufferGeometry;
    const material = this.mesh.material as THREE.MeshPhongMaterial;

    // Check if we have valid color data before enabling vertex colors
    const hasValidColors = this.hasValidColorData();

    debugLog(`MultiLayerNeuroSurface: applyCompositeToMesh hasValidColors=${hasValidColors}`);

    if (!hasValidColors) {
      // No valid overlay colors - use material base color instead
      material.vertexColors = false;
      material.needsUpdate = true;
      debugLog('MultiLayerNeuroSurface: No valid colors, using material base color');
      return;
    }

    // Get or create color attribute
    let colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;

    if (!colorAttribute) {
      // Create new attribute with its own buffer
      const colorBuffer = new Float32Array(this.vertexCount * 4);
      colorAttribute = new THREE.BufferAttribute(colorBuffer, 4);
      geometry.setAttribute('color', colorAttribute);
    }

    // Always copy data to the attribute's buffer
    const colors = colorAttribute.array as Float32Array;
    if (colors.length === this.compositeBuffer.length) {
      colors.set(this.compositeBuffer);
    } else {
      console.error('Color attribute size mismatch');
      return;
    }

    colorAttribute.needsUpdate = true;
    // Only enable vertex colors AFTER valid data exists
    material.vertexColors = true;
    material.transparent = true;
    material.needsUpdate = true;

    debugLog('MultiLayerNeuroSurface: Applied vertex colors to mesh');

    // Debug: Log mesh and geometry state
    debugLog('MultiLayerNeuroSurface: Mesh state:', {
      meshExists: !!this.mesh,
      geometryExists: !!geometry,
      positionCount: geometry.getAttribute('position')?.count,
      colorCount: colorAttribute.count,
      indexCount: geometry.getIndex()?.count,
      materialVertexColors: material.vertexColors,
      materialVisible: material.visible,
      meshVisible: this.mesh?.visible,
    });

    // Compute bounding box/sphere for camera centering
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) {
      debugLog('MultiLayerNeuroSurface: Bounding sphere center:',
        geometry.boundingSphere.center.toArray(),
        'radius:', geometry.boundingSphere.radius);
    }
  }

  /**
   * Create fallback material for CPU compositing
   * NOTE: Start with vertexColors: false until color attribute is populated with valid data
   */
  private createFallbackMaterial(): THREE.MeshPhongMaterial {
    return new THREE.MeshPhongMaterial({
      vertexColors: false, // Start false until color attribute has valid data
      transparent: true,
      opacity: 1, // We handle opacity per-vertex
      shininess: this.config.shininess || 30,
      specular: new THREE.Color(this.config.specularColor || 0x111111),
      flatShading: this.config.flatShading || false,
      side: THREE.DoubleSide, // Ensure both sides are visible
      color: new THREE.Color((this.config as MultiLayerSurfaceConfig).baseColor || 0xcccccc) // Fallback base color
    });
  }

  /**
   * Create mesh with proper material settings
   */
  createMesh(): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.geometry.vertices, 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(this.geometry.faces, 1));

    // Add vertexIndex attribute for GPU compositing shader
    const vertexIndices = new Float32Array(this.vertexCount);
    for (let i = 0; i < this.vertexCount; i++) {
      vertexIndices[i] = i;
    }
    geometry.setAttribute('vertexIndex', new THREE.Float32BufferAttribute(vertexIndices, 1));

    let material: THREE.Material;

    if (this.useGPUCompositing && this.gpuCompositor) {
      // Use GPU shader material for compositing
      material = this.gpuCompositor.getMaterial() || this.createFallbackMaterial();
    } else {
      // Use standard material for CPU compositing
      material = this.createFallbackMaterial();
    }

    this.mesh = new THREE.Mesh(geometry, material);

    // Compute vertex normals for better lighting
    geometry.computeVertexNormals();

    // Compute bounding box/sphere for camera centering
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    debugLog('MultiLayerNeuroSurface: createMesh complete', {
      vertexCount: this.geometry.vertices.length / 3,
      faceCount: this.geometry.faces.length / 3,
      boundingSphereRadius: geometry.boundingSphere?.radius,
      boundingSphereCenter: geometry.boundingSphere?.center.toArray(),
    });

    // Initial color update
    this.updateColors();

    return this.mesh;
  }

  /**
   * Switch compositing mode between CPU and GPU
   */
  setCompositingMode(useGPU: boolean): void {
    if (useGPU === this.useGPUCompositing) return; // No change needed
    
    this.useGPUCompositing = useGPU;
    
    if (useGPU) {
      if (!this.supportsWebGL2()) {
        console.warn('GPU compositing requires WebGL2; keeping CPU mode');
        this.useGPUCompositing = false;
        return;
      }
      // Switch to GPU compositing
      if (!this.gpuCompositor) {
        try {
          this.gpuCompositor = new GPULayerCompositor(this.vertexCount);
          debugLog('Switched to GPU compositing');
        } catch (error) {
          console.warn('Failed to initialize GPU compositor:', error);
          this.useGPUCompositing = false;
          return;
        }
      }
      
      // Replace material with shader material
      if (this.mesh && this.gpuCompositor) {
        const oldMaterial = this.mesh.material;
        this.mesh.material = this.gpuCompositor.getMaterial() || this.createFallbackMaterial();
        
        // Dispose old material
        if (oldMaterial && 'dispose' in oldMaterial) {
          (oldMaterial as THREE.Material).dispose();
        }
      }
    } else {
      // Switch to CPU compositing
      if (this.mesh) {
        const oldMaterial = this.mesh.material;
        this.mesh.material = this.createFallbackMaterial();
        
        // Dispose old material
        if (oldMaterial && 'dispose' in oldMaterial) {
          (oldMaterial as THREE.Material).dispose();
        }
      }
      
      // Optionally dispose GPU compositor to free memory
      if (this.gpuCompositor) {
        this.gpuCompositor.dispose();
        this.gpuCompositor = null;
      }
      
      debugLog('Switched to CPU compositing');
    }
    
    // Update colors with new method
    this.updateColors();
  }

  setWideLines(useWide: boolean): void {
    if (useWide === this.useWideLines) return;
    this.useWideLines = useWide;

    // Rebuild all outline layers with the new line implementation
    this.layerStack.getAllLayers().forEach(layer => {
      if (layer instanceof OutlineLayer) {
        this.applyOutlineLayer(layer);
      }
    });

    this.requestColorUpdate();
  }

  /**
   * Get current compositing mode
   */
  getCompositingMode(): 'CPU' | 'GPU' {
    return this.useGPUCompositing ? 'GPU' : 'CPU';
  }

  private supportsWebGL2(): boolean {
    const renderer = (this.viewer as any)?.renderer;
    return !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2);
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    // Remove outline objects to avoid orphaned materials
    this.layerStack.getAllLayers().forEach(layer => {
      if (layer instanceof OutlineLayer) {
        this.detachOutlineLayer(layer);
      }
    });

    // Dispose GPU compositor if present
    if (this.gpuCompositor) {
      this.gpuCompositor.dispose();
      this.gpuCompositor = null;
    }
    
    if (this.layerStack) {
      this.layerStack.dispose();
      this.layerStack = null as any;
    }
    
    this.compositeBuffer = null as any;
    
    // Call parent dispose
    super.dispose();
  }
}
