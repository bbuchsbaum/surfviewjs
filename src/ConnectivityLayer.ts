import * as THREE from 'three';
import { Layer, LayerConfig } from './layers';
import ColorMap from './ColorMap';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectivityEdge {
  source: number;
  target: number;
  weight: number;
}

export type RenderMode = 'line' | 'tube';

export interface ConnectivityLayerConfig extends LayerConfig {
  colorMap?: string;
  weightRange?: [number, number];
  threshold?: number;
  renderMode?: RenderMode;
  tubeRadius?: number;
  tubeRadiusScale?: boolean;
  showNodes?: boolean;
  nodeRadius?: number;
  nodeColor?: THREE.ColorRepresentation;
  topN?: number;
  regionFilter?: number[] | null;
}

export interface ConnectivityLayerUpdate extends Partial<ConnectivityLayerConfig> {
  edges?: ConnectivityEdge[];
}

export interface CSRData {
  indptr: ArrayLike<number>;
  indices: ArrayLike<number>;
  data: ArrayLike<number>;
}

// ---------------------------------------------------------------------------
// ConnectivityLayer
// ---------------------------------------------------------------------------

/**
 * Geometry-based layer that renders connectivity edges between surface vertices
 * as lines or instanced tubes, with optional node spheres at endpoints.
 *
 * This layer does not participate in color compositing; it renders its own
 * THREE.js objects that are attached to the surface mesh.
 */
export class ConnectivityLayer extends Layer {

  // --- Edge data ---
  private _edges: ConnectivityEdge[];
  private _filteredEdges: ConnectivityEdge[] = [];

  // --- Configuration ---
  private _colorMap: ColorMap;
  private _colorMapName: string;
  private _weightRange: [number, number];
  private _threshold: number;
  private _renderMode: RenderMode;
  private _tubeRadius: number;
  private _tubeRadiusScale: boolean;
  private _showNodes: boolean;
  private _nodeRadius: number;
  private _nodeColor: THREE.Color;
  private _topN: number;
  private _regionFilter: Set<number> | null;

  // --- Three.js scene objects ---
  private _group: THREE.Group;
  private _edgeObject: THREE.Object3D | null = null;
  private _nodeObject: THREE.InstancedMesh | null = null;

  // --- Shared template geometries ---
  private _tubeTemplate: THREE.CylinderGeometry | null = null;
  private _sphereTemplate: THREE.SphereGeometry | null = null;

  // --- Attached surface reference ---
  private _surface: any = null;

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  constructor(
    id: string,
    edges: ConnectivityEdge[],
    config: ConnectivityLayerConfig = {}
  ) {
    super(id, {
      visible: config.visible,
      opacity: config.opacity ?? 0.85,
      blendMode: config.blendMode,
      order: config.order ?? 15
    });

    if (!edges || edges.length === 0) {
      throw new Error('ConnectivityLayer requires a non-empty edges array');
    }
    for (const e of edges) {
      if (e.source < 0 || e.target < 0) {
        throw new Error(
          `ConnectivityLayer: negative vertex index (source=${e.source}, target=${e.target})`
        );
      }
    }

    this._edges = edges;
    this._colorMapName = config.colorMap ?? 'hot';
    this._colorMap = ConnectivityLayer._resolveColorMap(this._colorMapName);
    this._weightRange = config.weightRange ?? ConnectivityLayer._inferRange(edges);
    this._colorMap.setRange(this._weightRange);
    this._threshold = config.threshold ?? 0;
    this._renderMode = config.renderMode ?? 'tube';
    this._tubeRadius = config.tubeRadius ?? 0.25;
    this._tubeRadiusScale = config.tubeRadiusScale ?? true;
    this._showNodes = config.showNodes ?? true;
    this._nodeRadius = config.nodeRadius ?? 0.8;
    this._nodeColor = new THREE.Color(config.nodeColor ?? 0x2196f3);
    this._topN = config.topN ?? 0;
    this._regionFilter = config.regionFilter
      ? new Set(config.regionFilter)
      : null;

    this._group = new THREE.Group();
    this._group.name = `connectivity-${id}`;

    this._applyFilters();
  }

  // -------------------------------------------------------------------------
  // Static factories
  // -------------------------------------------------------------------------

  /**
   * Create from a symmetric NxN weight matrix.
   * Extracts upper-triangle entries (i < j) where weight !== 0.
   */
  static fromMatrix(
    id: string,
    matrix: Float32Array | number[][],
    config: ConnectivityLayerConfig & { vertexIndices?: number[] } = {}
  ): ConnectivityLayer {
    const edges: ConnectivityEdge[] = [];
    const vIdx = config.vertexIndices;

    if (Array.isArray(matrix) && Array.isArray(matrix[0])) {
      const N = matrix.length;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const w = (matrix as number[][])[i][j];
          if (w !== 0) {
            edges.push({
              source: vIdx ? vIdx[i] : i,
              target: vIdx ? vIdx[j] : j,
              weight: w
            });
          }
        }
      }
    } else {
      const flat = matrix as Float32Array;
      const N = Math.round(Math.sqrt(flat.length));
      if (N * N !== flat.length) {
        throw new Error('fromMatrix: flat array length must be a perfect square');
      }
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const w = flat[i * N + j];
          if (w !== 0) {
            edges.push({
              source: vIdx ? vIdx[i] : i,
              target: vIdx ? vIdx[j] : j,
              weight: w
            });
          }
        }
      }
    }

    if (edges.length === 0) {
      throw new Error('fromMatrix: no non-zero edges in upper triangle');
    }
    return new ConnectivityLayer(id, edges, config);
  }

  /**
   * Create from CSR (Compressed Sparse Row) data.
   * Extracts upper-triangle entries (j > i) to avoid duplicates.
   */
  static fromSparse(
    id: string,
    csr: CSRData,
    config: ConnectivityLayerConfig & { vertexIndices?: number[] } = {}
  ): ConnectivityLayer {
    const edges: ConnectivityEdge[] = [];
    const vIdx = config.vertexIndices;
    const N = csr.indptr.length - 1;

    for (let i = 0; i < N; i++) {
      const start = csr.indptr[i];
      const end = csr.indptr[i + 1];
      for (let k = start; k < end; k++) {
        const j = csr.indices[k];
        if (j > i) {
          edges.push({
            source: vIdx ? vIdx[i] : i,
            target: vIdx ? vIdx[j] : j,
            weight: csr.data[k]
          });
        }
      }
    }

    if (edges.length === 0) {
      throw new Error('fromSparse: no edges found in upper triangle');
    }
    return new ConnectivityLayer(id, edges, config);
  }

  // -------------------------------------------------------------------------
  // Layer interface
  // -------------------------------------------------------------------------

  /** Non-compositing layer — returns zeroed buffer. */
  getRGBAData(vertexCount: number): Float32Array {
    return new Float32Array(vertexCount * 4);
  }

  update(config: ConnectivityLayerUpdate): void {
    let needsRebuild = false;

    if (config.edges !== undefined) {
      if (!config.edges || config.edges.length === 0) {
        throw new Error('ConnectivityLayer.update: edges must be non-empty');
      }
      this._edges = config.edges;
      needsRebuild = true;
    }
    if (config.threshold !== undefined) {
      this._threshold = config.threshold;
      needsRebuild = true;
    }
    if (config.topN !== undefined) {
      this._topN = config.topN;
      needsRebuild = true;
    }
    if (config.regionFilter !== undefined) {
      this._regionFilter = config.regionFilter
        ? new Set(config.regionFilter)
        : null;
      needsRebuild = true;
    }
    if (config.weightRange !== undefined) {
      this._weightRange = config.weightRange;
      this._colorMap.setRange(this._weightRange);
      needsRebuild = true;
    }
    if (config.renderMode !== undefined && config.renderMode !== this._renderMode) {
      this._renderMode = config.renderMode;
      needsRebuild = true;
    }
    if (config.colorMap !== undefined && config.colorMap !== this._colorMapName) {
      this._colorMapName = config.colorMap;
      this._colorMap = ConnectivityLayer._resolveColorMap(config.colorMap);
      this._colorMap.setRange(this._weightRange);
      needsRebuild = true;
    }
    if (config.tubeRadius !== undefined) {
      this._tubeRadius = config.tubeRadius;
      needsRebuild = true;
    }
    if (config.tubeRadiusScale !== undefined) {
      this._tubeRadiusScale = config.tubeRadiusScale;
      needsRebuild = true;
    }
    if (config.showNodes !== undefined) {
      this._showNodes = config.showNodes;
      needsRebuild = true;
    }
    if (config.nodeRadius !== undefined) {
      this._nodeRadius = config.nodeRadius;
      needsRebuild = true;
    }
    if (config.nodeColor !== undefined) {
      this._nodeColor = new THREE.Color(config.nodeColor);
      needsRebuild = true;
    }
    if (config.opacity !== undefined) {
      this.setOpacity(config.opacity);
      if (!needsRebuild) this._syncOpacity();
    }
    if (config.visible !== undefined) {
      this.setVisible(config.visible);
      this._group.visible = config.visible;
    }

    if (needsRebuild) {
      this._applyFilters();
      this._rebuild();
    }

    this._notifyChange();
  }

  // -------------------------------------------------------------------------
  // Attach / Detach (duck-typing for MultiLayerNeuroSurface)
  // -------------------------------------------------------------------------

  attach(surface: any): void {
    this._surface = surface;
    if (surface.mesh) {
      surface.mesh.add(this._group);
    }
    this._rebuild();
  }

  detach(): void {
    if (this._group.parent) {
      this._group.parent.remove(this._group);
    }
    this._disposeObjects();
    this._surface = null;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getEdgeCount(): number { return this._filteredEdges.length; }
  getFilteredEdges(): ConnectivityEdge[] { return [...this._filteredEdges]; }
  getRenderMode(): RenderMode { return this._renderMode; }
  getShowNodes(): boolean { return this._showNodes; }
  getThreshold(): number { return this._threshold; }
  getTopN(): number { return this._topN; }
  getColorMapName(): string { return this._colorMapName; }
  getWeightRange(): [number, number] { return [...this._weightRange] as [number, number]; }
  getGroup(): THREE.Group { return this._group; }

  /**
   * Retrieve edge color RGBA values (one per filtered edge).
   * Useful for legend rendering or external visualization.
   */
  getEdgeColors(): Float32Array {
    const out = new Float32Array(this._filteredEdges.length * 4);
    for (let i = 0; i < this._filteredEdges.length; i++) {
      const c = this._colorMap.getColor(Math.abs(this._filteredEdges[i].weight));
      out[i * 4] = c[0];
      out[i * 4 + 1] = c[1];
      out[i * 4 + 2] = c[2];
      out[i * 4 + 3] = c.length > 3 ? (c as [number, number, number, number])[3] : 1;
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Clip planes
  // -------------------------------------------------------------------------

  toStateJSON(): Record<string, unknown> {
    return {
      ...super.toStateJSON(),
      type: 'connectivity',
      colorMapName: this._colorMapName,
      weightRange: [...this._weightRange],
      threshold: this._threshold,
      renderMode: this._renderMode,
      tubeRadius: this._tubeRadius,
      tubeRadiusScale: this._tubeRadiusScale,
      showNodes: this._showNodes,
      nodeRadius: this._nodeRadius,
      nodeColor: this._nodeColor.getHex(),
      topN: this._topN,
      regionFilter: this._regionFilter ? Array.from(this._regionFilter) : null
    };
  }

  /** Propagate clip planes to all connectivity materials. */
  setClipPlanes(planes: THREE.Plane[] | null): void {
    this._group.traverse(obj => {
      const mat = (obj as any).material as THREE.Material | undefined;
      if (mat && 'clippingPlanes' in mat) {
        (mat as any).clippingPlanes = planes && planes.length > 0 ? planes : null;
        mat.needsUpdate = true;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Filtering pipeline: threshold → regionFilter → topN
  // -------------------------------------------------------------------------

  private _applyFilters(): void {
    let edges = this._edges;

    // 1. Threshold — keep edges with |weight| >= threshold
    if (this._threshold > 0) {
      edges = edges.filter(e => Math.abs(e.weight) >= this._threshold);
    }

    // 2. Region filter — keep edges touching at least one vertex in the set
    if (this._regionFilter) {
      const rf = this._regionFilter;
      edges = edges.filter(e => rf.has(e.source) || rf.has(e.target));
    }

    // 3. TopN — keep the N highest-|weight| edges
    if (this._topN > 0 && edges.length > this._topN) {
      edges = edges
        .slice()
        .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
        .slice(0, this._topN);
    }

    this._filteredEdges = edges;
  }

  // -------------------------------------------------------------------------
  // Geometry building
  // -------------------------------------------------------------------------

  private _rebuild(): void {
    this._disposeObjects();

    if (!this._surface || this._filteredEdges.length === 0) return;

    const vertices = this._resolveVertices();
    if (!vertices) return;

    if (this._renderMode === 'line') {
      this._buildLines(vertices);
    } else {
      this._buildTubes(vertices);
    }

    if (this._showNodes) {
      this._buildNodes(vertices);
    }

    this._group.visible = this.visible;
    this._syncOpacity();
  }

  private _resolveVertices(): Float32Array | null {
    if (!this._surface) return null;
    const geo = this._surface.geometry ?? this._surface;
    return geo.vertices ?? null;
  }

  // --- Line mode -----------------------------------------------------------

  private _buildLines(vertices: Float32Array): void {
    const edges = this._filteredEdges;
    const positions = new Float32Array(edges.length * 6);
    const colors = new Float32Array(edges.length * 6);

    for (let i = 0; i < edges.length; i++) {
      const { source, target, weight } = edges[i];
      const s3 = source * 3;
      const t3 = target * 3;
      const i6 = i * 6;

      positions[i6]     = vertices[s3];
      positions[i6 + 1] = vertices[s3 + 1];
      positions[i6 + 2] = vertices[s3 + 2];
      positions[i6 + 3] = vertices[t3];
      positions[i6 + 4] = vertices[t3 + 1];
      positions[i6 + 5] = vertices[t3 + 2];

      const [r, g, b] = this._colorMap.getColor(Math.abs(weight));
      colors[i6]     = r;
      colors[i6 + 1] = g;
      colors[i6 + 2] = b;
      colors[i6 + 3] = r;
      colors[i6 + 4] = g;
      colors[i6 + 5] = b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
      depthTest: false
    });

    this._edgeObject = new THREE.LineSegments(geometry, material);
    this._edgeObject.name = `connectivity-lines-${this.id}`;
    this._edgeObject.renderOrder = 1;
    this._edgeObject.frustumCulled = false;
    this._group.add(this._edgeObject);
  }

  // --- Tube mode ------------------------------------------------------------

  private _buildTubes(vertices: Float32Array): void {
    const edges = this._filteredEdges;

    if (!this._tubeTemplate) {
      this._tubeTemplate = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    }

    const material = new THREE.MeshPhongMaterial({
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
      depthTest: false
    });

    const mesh = new THREE.InstancedMesh(this._tubeTemplate, material, edges.length);
    mesh.name = `connectivity-tubes-${this.id}`;
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const color = new THREE.Color();

    let validCount = 0;
    for (let i = 0; i < edges.length; i++) {
      const { source, target, weight } = edges[i];
      const s3 = source * 3;
      const t3 = target * 3;

      start.set(vertices[s3], vertices[s3 + 1], vertices[s3 + 2]);
      end.set(vertices[t3], vertices[t3 + 1], vertices[t3 + 2]);
      dir.subVectors(end, start);
      const length = dir.length();
      if (length === 0) continue;
      dir.normalize();
      mid.addVectors(start, end).multiplyScalar(0.5);

      // Optionally scale radius by normalized weight
      const norm = this._normalizeWeight(weight);
      const radius = this._tubeRadiusScale
        ? this._tubeRadius * (0.3 + 0.7 * norm)
        : this._tubeRadius;

      dummy.position.copy(mid);
      dummy.quaternion.setFromUnitVectors(yAxis, dir);
      dummy.scale.set(radius, length, radius);
      dummy.updateMatrix();
      mesh.setMatrixAt(validCount, dummy.matrix);

      const [cr, cg, cb] = this._colorMap.getColor(Math.abs(weight));
      color.setRGB(cr, cg, cb);
      mesh.setColorAt(validCount, color);
      validCount++;
    }

    mesh.count = validCount;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this._edgeObject = mesh;
    this._group.add(mesh);
  }

  // --- Node spheres ---------------------------------------------------------

  private _buildNodes(vertices: Float32Array): void {
    const nodeSet = new Set<number>();
    for (const e of this._filteredEdges) {
      nodeSet.add(e.source);
      nodeSet.add(e.target);
    }
    const nodeIndices = Array.from(nodeSet);
    if (nodeIndices.length === 0) return;

    if (!this._sphereTemplate) {
      this._sphereTemplate = new THREE.SphereGeometry(1, 12, 12);
    }

    const material = new THREE.MeshPhongMaterial({
      color: this._nodeColor,
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
      depthTest: false
    });

    const mesh = new THREE.InstancedMesh(
      this._sphereTemplate,
      material,
      nodeIndices.length
    );
    mesh.name = `connectivity-nodes-${this.id}`;
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < nodeIndices.length; i++) {
      const vi = nodeIndices[i] * 3;
      dummy.position.set(vertices[vi], vertices[vi + 1], vertices[vi + 2]);
      dummy.scale.setScalar(this._nodeRadius);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    this._nodeObject = mesh;
    this._group.add(mesh);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Normalize |weight| to [0, 1] within the weight range. */
  private _normalizeWeight(weight: number): number {
    const [lo, hi] = this._weightRange;
    const denom = hi - lo || 1;
    return Math.max(0, Math.min(1, (Math.abs(weight) - lo) / denom));
  }

  /** Sync material opacity to current `this.opacity`. */
  private _syncOpacity(): void {
    this._group.traverse(obj => {
      const mat = (obj as any).material;
      if (mat && 'opacity' in mat) {
        mat.opacity = this.opacity;
      }
    });
  }

  /** Infer [min, max] of |weight| from edges. */
  private static _inferRange(edges: ConnectivityEdge[]): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const e of edges) {
      const aw = Math.abs(e.weight);
      if (aw < min) min = aw;
      if (aw > max) max = aw;
    }
    return [min, max];
  }

  /** Resolve a colormap name or instance. */
  private static _resolveColorMap(colorMap: ColorMap | string): ColorMap {
    if (colorMap instanceof ColorMap) return colorMap;
    return ColorMap.fromPreset(colorMap);
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  private _disposeObjects(): void {
    const disposeTraverse = (obj: THREE.Object3D) => {
      obj.traverse(child => {
        const c = child as any;
        if (c.geometry) c.geometry.dispose();
        if (c.material?.dispose) c.material.dispose();
      });
    };

    if (this._edgeObject) {
      disposeTraverse(this._edgeObject);
      this._group.remove(this._edgeObject);
      this._edgeObject = null;
    }

    if (this._nodeObject) {
      disposeTraverse(this._nodeObject);
      this._group.remove(this._nodeObject);
      this._nodeObject = null;
    }
  }

  dispose(): void {
    this.detach();

    if (this._tubeTemplate) {
      this._tubeTemplate.dispose();
      this._tubeTemplate = null;
    }
    if (this._sphereTemplate) {
      this._sphereTemplate.dispose();
      this._sphereTemplate = null;
    }

    this._edges = [];
    this._filteredEdges = [];
  }
}

// ---------------------------------------------------------------------------
// Layer.fromConfig registration (monkey-patch chain)
// ---------------------------------------------------------------------------

const _origFromConfig = Layer.fromConfig.bind(Layer);
Layer.fromConfig = (config: Record<string, any>): Layer => {
  if (config.type === 'connectivity') {
    if (!config.edges) throw new Error('ConnectivityLayer requires edges');
    return new ConnectivityLayer(config.id, config.edges, {
      visible: config.visible,
      opacity: config.opacity,
      blendMode: config.blendMode,
      order: config.order,
      colorMap: config.cmap ?? config.colorMap ?? 'hot',
      weightRange: config.weightRange,
      threshold: config.threshold,
      renderMode: config.renderMode,
      tubeRadius: config.tubeRadius,
      tubeRadiusScale: config.tubeRadiusScale,
      showNodes: config.showNodes,
      nodeRadius: config.nodeRadius,
      nodeColor: config.nodeColor,
      topN: config.topN,
      regionFilter: config.regionFilter
    });
  }
  return _origFromConfig(config);
};
