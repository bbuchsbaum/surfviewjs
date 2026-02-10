/**
 * Statistical map layer for neuroimaging data.
 *
 * Extends DataLayer with:
 * - FDR (Benjamini-Hochberg) and Bonferroni multiple comparison correction
 * - Cluster-based thresholding via BFS flood-fill on mesh adjacency
 * - Dual-threshold display (separate positive/negative colormaps)
 * - Per-vertex statistical metadata queries
 *
 * All corrections produce binary masks applied during getRGBAData().
 * The GPU compositor sees standard RGBA output — no shader changes needed.
 *
 * @module StatisticalMapLayer
 */

import { Layer, DataLayer, DataLayerConfig, DataLayerUpdateData } from '../layers';
import ColorMap, { Color, ColorArray } from '../ColorMap';
import { SurfaceGeometry } from '../classes';
import { MeshAdjacency, buildVertexAdjacency } from '../utils/meshAdjacency';
import {
  ClusterResult,
  computeFDRThreshold,
  computeBonferroniThreshold,
  findClusters,
  filterClustersBySize,
  pToZ,
  tToZ
} from '../utils/statistics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatisticalMapLayerConfig extends DataLayerConfig {
  /** Per-vertex p-values (same length as data) */
  pValues?: Float32Array;
  /** Type of statistic stored in data */
  statType?: StatType;
  /** Degrees of freedom (required for tToZ conversion) */
  degreesOfFreedom?: number;
}

export type StatType = 'tstat' | 'zstat' | 'fstat' | 'generic';

export interface DualThresholdConfig {
  /** Colormap name for positive values (e.g. 'hot') */
  positiveColorMap: string;
  /** Colormap name for negative values (e.g. 'cool') */
  negativeColorMap: string;
  /** Display range for positive values [min, max] */
  positiveRange: [number, number];
  /** Display range for negative values [min, max] (both values typically negative) */
  negativeRange: [number, number];
}

export interface VertexStatInfo {
  /** Raw statistic value */
  value: number;
  /** P-value (null if p-values not provided) */
  pValue: number | null;
  /** Approximate z-score (null if cannot be computed) */
  zScore: number | null;
  /** Cluster ID (-1 if no cluster assignment) */
  clusterIndex: number;
  /** Size of the assigned cluster (0 if not in a cluster) */
  clusterSize: number;
}

export interface StatisticalMapLayerUpdateData extends DataLayerUpdateData {
  pValues?: Float32Array;
  statType?: StatType;
  degreesOfFreedom?: number;
}

type CorrectionMethod = 'none' | 'fdr' | 'bonferroni' | 'cluster';

// ---------------------------------------------------------------------------
// StatisticalMapLayer
// ---------------------------------------------------------------------------

export class StatisticalMapLayer extends DataLayer {
  // ---- Statistical metadata ----
  private _pValues: Float32Array | null;
  private _statType: StatType;
  private _degreesOfFreedom: number;

  // ---- Correction state ----
  private _correctionMethod: CorrectionMethod = 'none';
  /** Per-data-point surviving mask (FDR / Bonferroni) */
  private _correctionMask: Uint8Array | null = null;
  /** Per-vertex surviving mask (cluster thresholding) */
  private _clusterMask: Uint8Array | null = null;
  private _clusterResult: ClusterResult | null = null;
  private _fdrQ: number = 0;
  private _bonferroniAlpha: number = 0;
  private _clusterThreshold: number = 0;
  private _clusterMinSize: number = 0;

  // ---- Mesh adjacency ----
  private _adjacency: MeshAdjacency | null = null;

  // ---- Dual-threshold rendering ----
  private _dualThreshold: DualThresholdConfig | null = null;
  private _positiveColorMap: ColorMap;
  private _negativeColorMap: ColorMap | null = null;

  // ---- Rendering cache ----
  private _statRGBABuffer: Float32Array | null = null;

  // ---- Own index reference (parent's is private) ----
  private _statIndices: Uint32Array;

  constructor(
    id: string,
    data: Float32Array | number[],
    indices: Uint32Array | number[] | null,
    colorMap: ColorMap | string | Color[],
    config: StatisticalMapLayerConfig = {}
  ) {
    super(id, data, indices, colorMap, config);

    // Store our own index reference since parent's is private
    const dataArr = data instanceof Float32Array ? data : new Float32Array(data);
    if (indices) {
      this._statIndices = indices instanceof Uint32Array
        ? indices
        : new Uint32Array(indices);
    } else {
      this._statIndices = new Uint32Array(dataArr.length);
      for (let i = 0; i < dataArr.length; i++) this._statIndices[i] = i;
    }

    // Create our own ColorMap for the override of getRGBAData
    this._positiveColorMap = StatisticalMapLayer._resolveColorMap(colorMap);
    this._positiveColorMap.setRange(config.range || [0, 1]);
    this._positiveColorMap.setThreshold(config.threshold || [0, 0]);

    // Statistical metadata
    this._pValues = config.pValues ?? null;
    this._statType = config.statType ?? 'generic';
    this._degreesOfFreedom = config.degreesOfFreedom ?? 1;

    // Validate p-values alignment
    if (this._pValues && this._pValues.length !== dataArr.length) {
      throw new Error(
        `pValues length (${this._pValues.length}) must match data length (${dataArr.length})`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Mesh adjacency
  // ---------------------------------------------------------------------------

  /**
   * Set mesh adjacency from a SurfaceGeometry or raw face data.
   * Required before calling `applyClusterThreshold()`.
   */
  setMeshAdjacency(geometry: SurfaceGeometry): void;
  setMeshAdjacency(faces: Uint32Array | number[], vertexCount: number): void;
  setMeshAdjacency(
    geometryOrFaces: SurfaceGeometry | Uint32Array | number[],
    vertexCount?: number
  ): void {
    if (geometryOrFaces instanceof SurfaceGeometry) {
      this._adjacency = geometryOrFaces.getAdjacency();
    } else {
      if (vertexCount === undefined || vertexCount <= 0) {
        throw new Error('vertexCount is required when passing raw faces');
      }
      this._adjacency = buildVertexAdjacency(geometryOrFaces, vertexCount);
    }
  }

  // ---------------------------------------------------------------------------
  // Correction methods
  // ---------------------------------------------------------------------------

  /**
   * Apply FDR (Benjamini-Hochberg) correction.
   * Only vertices with p <= BH-threshold will be visible.
   *
   * @param q - False discovery rate (typically 0.05)
   * @throws If p-values were not provided at construction
   */
  applyFDR(q: number): void {
    if (!this._pValues) {
      throw new Error('Cannot apply FDR: p-values not provided. Pass pValues in config.');
    }
    const result = computeFDRThreshold(this._pValues, q);
    this._correctionMethod = 'fdr';
    this._correctionMask = result.survivingMask;
    this._clusterMask = null;
    this._clusterResult = null;
    this._fdrQ = q;
    this._invalidateRGBA();
  }

  /**
   * Apply Bonferroni correction.
   * Only vertices with p <= alpha/V will be visible.
   *
   * @param alpha - Family-wise error rate (typically 0.05)
   * @throws If p-values were not provided at construction
   */
  applyBonferroni(alpha: number): void {
    if (!this._pValues) {
      throw new Error('Cannot apply Bonferroni: p-values not provided. Pass pValues in config.');
    }
    const result = computeBonferroniThreshold(this._pValues, alpha);
    this._correctionMethod = 'bonferroni';
    this._correctionMask = result.survivingMask;
    this._clusterMask = null;
    this._clusterResult = null;
    this._bonferroniAlpha = alpha;
    this._invalidateRGBA();
  }

  /**
   * Apply cluster-based thresholding.
   * Identifies connected components of supra-threshold vertices via BFS,
   * then removes clusters smaller than `minClusterSize`.
   *
   * @param threshold - Absolute value threshold for activation
   * @param opts - Options with minClusterSize
   * @throws If mesh adjacency has not been set
   */
  applyClusterThreshold(
    threshold: number,
    opts: { minClusterSize: number }
  ): void {
    if (!this._adjacency) {
      throw new Error(
        'Cannot apply cluster threshold: mesh adjacency not set. Call setMeshAdjacency() first.'
      );
    }

    const data = this.getData();
    if (!data) {
      throw new Error('No data available for cluster thresholding');
    }

    // Build per-vertex active mask from |data[i]| > threshold
    const V = this._adjacency.vertexCount;
    const activeMask = new Uint8Array(V);
    const indices = this._statIndices;

    for (let i = 0; i < indices.length && i < data.length; i++) {
      const v = indices[i];
      if (v >= 0 && v < V && isFinite(data[i]) && Math.abs(data[i]) > threshold) {
        activeMask[v] = 1;
      }
    }

    // BFS flood-fill
    const clusterResult = findClusters(activeMask, this._adjacency.neighbors);

    // Filter small clusters → per-vertex mask
    const clusterMask = filterClustersBySize(
      clusterResult.clusterIds,
      clusterResult.clusterSizes,
      opts.minClusterSize
    );

    this._correctionMethod = 'cluster';
    this._correctionMask = null;
    this._fdrQ = 0;
    this._bonferroniAlpha = 0;
    this._clusterMask = clusterMask;
    this._clusterResult = clusterResult;
    this._clusterThreshold = threshold;
    this._clusterMinSize = opts.minClusterSize;
    this._invalidateRGBA();
  }

  /**
   * Remove all statistical corrections, restoring all supra-threshold vertices.
   */
  clearCorrection(): void {
    this._correctionMethod = 'none';
    this._correctionMask = null;
    this._clusterMask = null;
    this._clusterResult = null;
    this._fdrQ = 0;
    this._bonferroniAlpha = 0;
    this._clusterThreshold = 0;
    this._clusterMinSize = 0;
    this._invalidateRGBA();
  }

  // ---------------------------------------------------------------------------
  // Dual-threshold display
  // ---------------------------------------------------------------------------

  /**
   * Enable dual-threshold mode with separate positive/negative colormaps.
   *
   * - Positive values use `positiveColorMap` within `positiveRange`
   * - Negative values use `negativeColorMap` within `negativeRange`
   * - Values between the two ranges (dead zone) are transparent
   */
  setDualThreshold(config: DualThresholdConfig): void {
    this._dualThreshold = config;

    // Update positive colormap
    this._positiveColorMap = ColorMap.fromPreset(config.positiveColorMap);
    this._positiveColorMap.setRange(config.positiveRange);
    this._positiveColorMap.setThreshold([0, 0]); // no hide zone — ranges define visibility

    // Create negative colormap
    this._negativeColorMap = ColorMap.fromPreset(config.negativeColorMap);
    this._negativeColorMap.setRange(config.negativeRange);
    this._negativeColorMap.setThreshold([0, 0]);

    this._invalidateRGBA();
  }

  /**
   * Disable dual-threshold mode, reverting to single-colormap rendering.
   */
  clearDualThreshold(): void {
    this._dualThreshold = null;
    this._negativeColorMap = null;

    // Restore positive colormap to match parent state
    this._positiveColorMap.setRange(this.getRange());
    this._positiveColorMap.setThreshold(this.getThreshold());

    this._invalidateRGBA();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Current correction method: 'none', 'fdr', 'bonferroni', or 'cluster' */
  getCorrectionMethod(): CorrectionMethod {
    return this._correctionMethod;
  }

  /** Current FDR q-value (0 if FDR not active) */
  getFDRQ(): number {
    return this._fdrQ;
  }

  /** Current Bonferroni alpha (0 if Bonferroni not active) */
  getBonferroniAlpha(): number {
    return this._bonferroniAlpha;
  }

  /** Current cluster minimum size (0 if cluster not active) */
  getClusterMinSize(): number {
    return this._clusterMinSize;
  }

  /** Current cluster threshold value (0 if cluster not active) */
  getClusterThreshold(): number {
    return this._clusterThreshold;
  }

  /**
   * Get statistical metadata for a vertex.
   *
   * @param vertexIndex - The vertex to query
   * @returns Stat info, or null if the vertex index is out of range
   */
  getVertexStatInfo(vertexIndex: number): VertexStatInfo | null {
    const data = this.getData();
    if (!data) return null;

    // Find data index for this vertex (identity mapping is the common case)
    const dataIndex = this._findDataIndex(vertexIndex);
    if (dataIndex === -1) return null;

    const value = data[dataIndex];
    const pValue = this._pValues ? this._pValues[dataIndex] : null;

    // Compute z-score
    let zScore: number | null = null;
    if (pValue !== null && isFinite(pValue) && pValue > 0 && pValue < 1) {
      zScore = pToZ(pValue);
    } else if (this._statType === 'tstat' && isFinite(value)) {
      zScore = tToZ(value, this._degreesOfFreedom);
    } else if (this._statType === 'zstat' && isFinite(value)) {
      zScore = value;
    }

    // Cluster info
    let clusterIndex = -1;
    let clusterSize = 0;
    if (this._clusterResult) {
      clusterIndex = this._clusterResult.clusterIds[vertexIndex] ?? -1;
      if (clusterIndex >= 0) {
        clusterSize = this._clusterResult.clusterSizes.get(clusterIndex) ?? 0;
      }
    }

    return { value, pValue, zScore, clusterIndex, clusterSize };
  }

  // ---------------------------------------------------------------------------
  // DataLayer overrides — keep our colormaps in sync
  // ---------------------------------------------------------------------------

  setColorMap(colorMap: ColorMap | string | Color[]): void {
    super.setColorMap(colorMap);
    this._positiveColorMap = StatisticalMapLayer._resolveColorMap(colorMap);
    this._positiveColorMap.setRange(this.getRange());
    this._positiveColorMap.setThreshold(this.getThreshold());
    this._invalidateRGBA();
  }

  setRange(range: [number, number]): void {
    super.setRange(range);
    if (!this._dualThreshold) {
      this._positiveColorMap.setRange(range);
    }
    this._invalidateRGBA();
  }

  setThreshold(threshold: [number, number]): void {
    super.setThreshold(threshold);
    if (!this._dualThreshold) {
      this._positiveColorMap.setThreshold(threshold);
    }
    this._invalidateRGBA();
  }

  setData(data: Float32Array | number[], indices?: Uint32Array | number[] | null): void {
    super.setData(data, indices);
    const arr = data instanceof Float32Array ? data : new Float32Array(data);
    if (indices) {
      this._statIndices = indices instanceof Uint32Array
        ? indices
        : new Uint32Array(indices);
    } else {
      this._statIndices = new Uint32Array(arr.length);
      for (let i = 0; i < arr.length; i++) this._statIndices[i] = i;
    }
    // Invalidate corrections — data changed
    this.clearCorrection();
  }

  // ---------------------------------------------------------------------------
  // Core rendering override
  // ---------------------------------------------------------------------------

  getRGBAData(vertexCount: number): Float32Array {
    const data = this.getData();
    if (!data) {
      throw new Error('StatisticalMapLayer: no data set');
    }

    // Reuse buffer
    if (!this._statRGBABuffer || this._statRGBABuffer.length !== vertexCount * 4) {
      this._statRGBABuffer = new Float32Array(vertexCount * 4);
    }
    const rgba = this._statRGBABuffer;
    rgba.fill(0);

    const indices = this._statIndices;
    const threshold = this.getThreshold();
    const thresholdActive = threshold[0] !== threshold[1];
    const isDual = this._dualThreshold !== null;
    const opacity = this.opacity;

    for (let i = 0; i < indices.length && i < data.length; i++) {
      const vertexIndex = indices[i];
      const value = data[i];

      // Skip invalid
      if (vertexIndex < 0 || vertexIndex >= vertexCount || !isFinite(value)) {
        continue;
      }

      // FDR / Bonferroni mask (per-data-point)
      if (this._correctionMask && this._correctionMask[i] === 0) {
        continue;
      }

      // Cluster mask (per-vertex)
      if (this._clusterMask && this._clusterMask[vertexIndex] === 0) {
        continue;
      }

      // Primary threshold (neuroimaging: hide values IN the zone)
      if (thresholdActive && value >= threshold[0] && value <= threshold[1]) {
        continue;
      }

      // Color mapping
      let color: ColorArray;
      if (isDual) {
        if (value > 0) {
          color = this._positiveColorMap.getColor(value);
        } else if (value < 0 && this._negativeColorMap) {
          color = this._negativeColorMap.getColor(value);
        } else {
          continue; // zero → dead zone
        }
      } else {
        color = this._positiveColorMap.getColor(value);
      }

      const offset = vertexIndex * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = ((color[3] as number) ?? 1) * opacity;
    }

    return rgba;
  }

  // ---------------------------------------------------------------------------
  // Update & dispose
  // ---------------------------------------------------------------------------

  update(updates: StatisticalMapLayerUpdateData): void {
    if (updates.pValues !== undefined) {
      this._pValues = updates.pValues;
    }
    if (updates.statType !== undefined) {
      this._statType = updates.statType;
    }
    if (updates.degreesOfFreedom !== undefined) {
      this._degreesOfFreedom = updates.degreesOfFreedom;
    }
    super.update(updates);
  }

  toStateJSON(): Record<string, unknown> {
    return {
      ...super.toStateJSON(),
      type: 'statistical',
      correctionMethod: this.getCorrectionMethod(),
      fdrQ: this._fdrQ,
      bonferroniAlpha: this._bonferroniAlpha,
      statType: this._statType,
      degreesOfFreedom: this._degreesOfFreedom,
      dualThreshold: this._dualThreshold ? { ...this._dualThreshold } : null
    };
  }

  dispose(): void {
    this._pValues = null;
    this._correctionMask = null;
    this._clusterMask = null;
    this._clusterResult = null;
    this._adjacency = null;
    this._dualThreshold = null;
    this._negativeColorMap = null;
    this._statRGBABuffer = null;
    this._statIndices = null as unknown as Uint32Array;
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _invalidateRGBA(): void {
    this._statRGBABuffer = null;
    this._notifyChange();
  }

  /** Find the data-array index that maps to a given vertex index. */
  private _findDataIndex(vertexIndex: number): number {
    const indices = this._statIndices;
    // Fast path: identity mapping (most common in neuroimaging)
    if (
      indices.length > vertexIndex &&
      indices[vertexIndex] === vertexIndex
    ) {
      return vertexIndex;
    }
    // Slow path: linear scan
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] === vertexIndex) return i;
    }
    return -1;
  }

  /** Resolve a colorMap spec to a ColorMap instance. */
  private static _resolveColorMap(colorMap: ColorMap | string | Color[]): ColorMap {
    if (colorMap instanceof ColorMap) return colorMap;
    if (typeof colorMap === 'string') return ColorMap.fromPreset(colorMap);
    return new ColorMap(colorMap);
  }
}

// ---------------------------------------------------------------------------
// Layer.fromConfig registration
// ---------------------------------------------------------------------------

const _origFromConfig = Layer.fromConfig.bind(Layer);
Layer.fromConfig = (config: Record<string, any>): Layer => {
  if (config.type === 'statistical') {
    if (!config.data) throw new Error('StatisticalMapLayer requires data');
    return new StatisticalMapLayer(
      config.id,
      config.data,
      config.indices ?? null,
      config.cmap ?? config.colorMap ?? 'hot',
      {
        visible: config.visible,
        opacity: config.opacity,
        blendMode: config.blendMode,
        order: config.order,
        range: config.range,
        threshold: config.threshold,
        pValues: config.pValues,
        statType: config.statType,
        degreesOfFreedom: config.degreesOfFreedom
      }
    );
  }
  return _origFromConfig(config);
};
