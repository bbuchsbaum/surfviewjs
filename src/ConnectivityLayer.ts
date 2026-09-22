import * as THREE from 'three';
import { assertLayerUpdateFields, Layer, LayerConfig, LayerUpdateData } from './layers';
import ColorMap from './ColorMap';
import {
  finiteNumber,
  finitePair,
  opacity as validateOpacity
} from './utils/validation';

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

export interface ConnectivityLayerUpdate extends LayerUpdateData {
  edges?: ConnectivityEdge[];
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

export interface CSRData {
  indptr: ArrayLike<number>;
  indices: ArrayLike<number>;
  data: ArrayLike<number>;
}

function validateEdges(edges: ConnectivityEdge[], parameter = 'edges'): ConnectivityEdge[] {
  if (!Array.isArray(edges) || edges.length === 0) {
    throw new Error('ConnectivityLayer requires a non-empty edges array');
  }
  return edges.map((edge, index) => {
    if (edge.source < 0 || edge.target < 0) {
      throw new Error(
        `ConnectivityLayer: negative vertex index (source=${edge.source}, target=${edge.target})`
      );
    }
    return {
      source: finiteNumber(edge.source, `${parameter}[${index}].source`, {
      minimum: 0,
      integer: true
      }),
      target: finiteNumber(edge.target, `${parameter}[${index}].target`, {
      minimum: 0,
      integer: true
      }),
      weight: finiteNumber(edge.weight, `${parameter}[${index}].weight`)
    };
  });
}

function validateRegionFilter(regionFilter: number[] | null | undefined): Set<number> | null {
  if (!regionFilter) return null;
  return new Set(regionFilter.map((value, index) => finiteNumber(
    value,
    `regionFilter[${index}]`,
    { minimum: 0, integer: true }
  )));
}

function validateRenderMode(mode: RenderMode): RenderMode {
  if (mode !== 'line' && mode !== 'tube') {
    throw new TypeError(`renderMode must be "line" or "tube"; received ${String(mode)}.`);
  }
  return mode;
}

function validateVertexIndices(
  vertexIndices: number[] | undefined,
  count: number
): readonly number[] | null {
  if (vertexIndices === undefined) return null;
  if (vertexIndices.length !== count) {
    throw new RangeError(
      `vertexIndices length must match matrix row count ${count} (received ${vertexIndices.length})`
    );
  }
  return vertexIndices.map((value, index) => finiteNumber(
    value,
    `vertexIndices[${index}]`,
    { minimum: 0, integer: true }
  ));
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
      opacity: config.opacity ?? 0.85,
      order: config.order ?? 15,
      ...(config.visible === undefined ? {} : { visible: config.visible }),
      ...(config.blendMode === undefined ? {} : { blendMode: config.blendMode })
    }, {
      role: 'connectivity',
      pinned: 'top',
      reorderable: false
    });

    this._edges = validateEdges(edges);
    this._colorMapName = config.colorMap ?? 'hot';
    this._colorMap = ConnectivityLayer._resolveColorMap(this._colorMapName);
    this._weightRange = config.weightRange === undefined
      ? ConnectivityLayer._inferRange(this._edges)
      : finitePair(config.weightRange, 'weightRange');
    this._colorMap.setRange(this._weightRange);
    this._threshold = finiteNumber(config.threshold ?? 0, 'threshold', { minimum: 0 });
    this._renderMode = validateRenderMode(config.renderMode ?? 'tube');
    this._tubeRadius = finiteNumber(config.tubeRadius ?? 0.25, 'tubeRadius', {
      minimum: 0,
      minimumExclusive: true
    });
    this._tubeRadiusScale = config.tubeRadiusScale ?? true;
    this._showNodes = config.showNodes ?? true;
    this._nodeRadius = finiteNumber(config.nodeRadius ?? 0.8, 'nodeRadius', {
      minimum: 0,
      minimumExclusive: true
    });
    this._nodeColor = new THREE.Color(config.nodeColor ?? 0x2196f3);
    this._topN = finiteNumber(config.topN ?? 0, 'topN', { minimum: 0, integer: true });
    this._regionFilter = validateRegionFilter(config.regionFilter);

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

    if (Array.isArray(matrix) && Array.isArray(matrix[0])) {
      const N = matrix.length;
      const vIdx = validateVertexIndices(config.vertexIndices, N);
      for (let i = 0; i < N; i++) {
        const row = matrix[i];
        if (!Array.isArray(row) || row.length !== N) {
          throw new RangeError(`fromMatrix: row ${i} must contain exactly ${N} values`);
        }
        for (let j = i + 1; j < N; j++) {
          const w = finiteNumber(row[j], `matrix[${i}][${j}]`);
          if (w !== 0) {
            edges.push({
              source: vIdx ? vIdx[i]! : i,
              target: vIdx ? vIdx[j]! : j,
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
      const vIdx = validateVertexIndices(config.vertexIndices, N);
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const w = finiteNumber(flat[i * N + j], `matrix[${i}][${j}]`);
          if (w !== 0) {
            edges.push({
              source: vIdx ? vIdx[i]! : i,
              target: vIdx ? vIdx[j]! : j,
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
    const N = csr.indptr.length - 1;
    if (N < 1) {
      throw new RangeError('fromSparse: indptr must describe at least one row');
    }
    if (csr.indices.length !== csr.data.length) {
      throw new RangeError('fromSparse: indices and data must have matching lengths');
    }
    const vIdx = validateVertexIndices(config.vertexIndices, N);
    const rowPointers = new Array<number>(N + 1);
    for (let row = 0; row <= N; row++) {
      rowPointers[row] = finiteNumber(csr.indptr[row], `indptr[${row}]`, {
        minimum: 0,
        integer: true
      });
      if (row > 0 && rowPointers[row]! < rowPointers[row - 1]!) {
        throw new RangeError('fromSparse: indptr must be monotonically non-decreasing');
      }
    }
    if (rowPointers[0] !== 0 || rowPointers[N] !== csr.indices.length) {
      throw new RangeError(
        'fromSparse: indptr must start at 0 and end at indices/data length'
      );
    }

    for (let i = 0; i < N; i++) {
      const start = rowPointers[i]!;
      const end = rowPointers[i + 1]!;
      for (let k = start; k < end; k++) {
        const j = finiteNumber(csr.indices[k], `indices[${k}]`, {
          minimum: 0,
          maximum: N - 1,
          integer: true
        });
        const weight = finiteNumber(csr.data[k], `data[${k}]`);
        if (j > i) {
          edges.push({
            source: vIdx ? vIdx[i]! : i,
            target: vIdx ? vIdx[j]! : j,
            weight
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
    assertLayerUpdateFields(config, 'ConnectivityLayer', [
      'edges', 'colorMap', 'weightRange', 'threshold', 'renderMode',
      'tubeRadius', 'tubeRadiusScale', 'showNodes', 'nodeRadius', 'nodeColor',
      'topN', 'regionFilter'
    ]);
    // Resolve every throwing numeric/configuration path before changing live state.
    const nextEdges = config.edges === undefined
      ? undefined
      : validateEdges(config.edges, 'edges');
    const nextThreshold = config.threshold === undefined
      ? undefined
      : finiteNumber(config.threshold, 'threshold', { minimum: 0 });
    const nextTopN = config.topN === undefined
      ? undefined
      : finiteNumber(config.topN, 'topN', { minimum: 0, integer: true });
    const nextRegionFilter = config.regionFilter === undefined
      ? undefined
      : validateRegionFilter(config.regionFilter);
    const nextWeightRange = config.weightRange === undefined
      ? undefined
      : finitePair(config.weightRange, 'weightRange');
    const nextRenderMode = config.renderMode === undefined
      ? undefined
      : validateRenderMode(config.renderMode);
    const nextColorMap = config.colorMap === undefined || config.colorMap === this._colorMapName
      ? undefined
      : ConnectivityLayer._resolveColorMap(config.colorMap);
    const nextTubeRadius = config.tubeRadius === undefined
      ? undefined
      : finiteNumber(config.tubeRadius, 'tubeRadius', { minimum: 0, minimumExclusive: true });
    const nextNodeRadius = config.nodeRadius === undefined
      ? undefined
      : finiteNumber(config.nodeRadius, 'nodeRadius', { minimum: 0, minimumExclusive: true });
    if (config.opacity !== undefined) validateOpacity(config.opacity);
    if (nextEdges) this.validateEdgeVertexBounds(nextEdges);

    let needsRebuild = false;

    if (nextEdges !== undefined) {
      this._edges = nextEdges;
      needsRebuild = true;
    }
    if (nextThreshold !== undefined) {
      this._threshold = nextThreshold;
      needsRebuild = true;
    }
    if (nextTopN !== undefined) {
      this._topN = nextTopN;
      needsRebuild = true;
    }
    if (nextRegionFilter !== undefined) {
      this._regionFilter = nextRegionFilter;
      needsRebuild = true;
    }
    if (nextWeightRange !== undefined) {
      this._weightRange = nextWeightRange;
      this._colorMap.setRange(this._weightRange);
      needsRebuild = true;
    }
    if (nextRenderMode !== undefined && nextRenderMode !== this._renderMode) {
      this._renderMode = nextRenderMode;
      needsRebuild = true;
    }
    if (nextColorMap !== undefined && config.colorMap !== undefined) {
      this._colorMapName = config.colorMap;
      this._colorMap = nextColorMap;
      this._colorMap.setRange(this._weightRange);
      needsRebuild = true;
    }
    if (nextTubeRadius !== undefined) {
      this._tubeRadius = nextTubeRadius;
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
    if (nextNodeRadius !== undefined) {
      this._nodeRadius = nextNodeRadius;
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
    if (config.blendMode !== undefined) {
      this.setBlendMode(config.blendMode);
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
    this.validateEdgeVertexBounds(this._edges, surface);
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
  getFilteredEdges(): ConnectivityEdge[] { return this._filteredEdges.map(edge => ({ ...edge })); }
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
    for (const [i, edge] of this._filteredEdges.entries()) {
      const c = this._colorMap.getColor(Math.abs(edge.weight));
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

  private validateEdgeVertexBounds(edges: ConnectivityEdge[], surface: any = this._surface): void {
    if (!surface) return;
    const vertices = (surface.geometry ?? surface).vertices as ArrayLike<number> | undefined;
    if (!vertices) return;
    const vertexCount = vertices.length / 3;
    for (const [index, edge] of edges.entries()) {
      if (edge.source >= vertexCount || edge.target >= vertexCount) {
        throw new RangeError(
          `edges[${index}] references a vertex outside the attached surface (${vertexCount} vertices).`
        );
      }
    }
  }

  // --- Line mode -----------------------------------------------------------

  private _buildLines(vertices: Float32Array): void {
    const edges = this._filteredEdges;
    const positions = new Float32Array(edges.length * 6);
    const colors = new Float32Array(edges.length * 6);

    for (const [i, edge] of edges.entries()) {
      const { source, target, weight } = edge;
      const s3 = source * 3;
      const t3 = target * 3;
      const i6 = i * 6;

      // Edge bounds are validated against the attached surface before rebuilding.
      positions[i6]     = vertices[s3]!;
      positions[i6 + 1] = vertices[s3 + 1]!;
      positions[i6 + 2] = vertices[s3 + 2]!;
      positions[i6 + 3] = vertices[t3]!;
      positions[i6 + 4] = vertices[t3 + 1]!;
      positions[i6 + 5] = vertices[t3 + 2]!;

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
    for (const edge of edges) {
      const { source, target, weight } = edge;
      const s3 = source * 3;
      const t3 = target * 3;

      // Edge bounds are validated against the attached surface before rebuilding.
      start.set(vertices[s3]!, vertices[s3 + 1]!, vertices[s3 + 2]!);
      end.set(vertices[t3]!, vertices[t3 + 1]!, vertices[t3 + 2]!);
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
    for (const [i, nodeIndex] of nodeIndices.entries()) {
      const vi = nodeIndex * 3;
      // Node indices are derived from the same prevalidated edge endpoints.
      dummy.position.set(vertices[vi]!, vertices[vi + 1]!, vertices[vi + 2]!);
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
