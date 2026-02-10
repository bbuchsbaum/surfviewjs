import { describe, it, expect } from 'vitest';
import { StatisticalMapLayer } from '../../src/layers/StatisticalMapLayer';
import { Layer } from '../../src/layers';
import type { DualThresholdConfig } from '../../src/layers/StatisticalMapLayer';

/**
 * Helper: build a small triangle mesh adjacency for cluster tests.
 *
 *   0---1
 *   |\ /|
 *   | 2 |
 *   |/ \|
 *   3---4
 *
 * Faces: [0,1,2], [0,2,3], [1,4,2], [3,2,4]
 */
function makeSmallMesh() {
  const faces = new Uint32Array([0, 1, 2, 0, 2, 3, 1, 4, 2, 3, 2, 4]);
  const vertexCount = 5;
  return { faces, vertexCount };
}

describe('StatisticalMapLayer', () => {
  // -------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------

  describe('construction', () => {
    it('should construct with basic data', () => {
      const data = new Float32Array([1, 2, 3, 4, 5]);
      const layer = new StatisticalMapLayer('stat1', data, null, 'hot', {
        range: [-6, 6],
        threshold: [-2, 2]
      });

      expect(layer.id).toBe('stat1');
      expect(layer.getData()).toBe(data);
      expect(layer.getRange()).toEqual([-6, 6]);
      expect(layer.getThreshold()).toEqual([-2, 2]);
    });

    it('should construct with p-values', () => {
      const data = new Float32Array([3.0, 1.5, 0.5]);
      const pValues = new Float32Array([0.001, 0.05, 0.3]);
      const layer = new StatisticalMapLayer('stat2', data, null, 'hot', {
        pValues,
        statType: 'tstat',
        degreesOfFreedom: 28
      });

      expect(layer.getCorrectionMethod()).toBe('none');
    });

    it('should throw if pValues length mismatches data', () => {
      const data = new Float32Array([1, 2, 3]);
      const pValues = new Float32Array([0.01, 0.05]);
      expect(() => {
        new StatisticalMapLayer('bad', data, null, 'hot', { pValues });
      }).toThrow(/pValues length/);
    });
  });

  // -------------------------------------------------------------------
  // getRGBAData
  // -------------------------------------------------------------------

  describe('getRGBAData', () => {
    it('should return buffer of correct length', () => {
      const data = new Float32Array([1, 2, 3]);
      const layer = new StatisticalMapLayer('t', data, null, 'hot', {
        range: [0, 3],
        threshold: [0, 0]
      });
      const rgba = layer.getRGBAData(3);
      expect(rgba.length).toBe(12); // 3 vertices * 4 channels
    });

    it('should make NaN/Infinity values transparent', () => {
      const data = new Float32Array([1, NaN, Infinity, -Infinity, 2]);
      const layer = new StatisticalMapLayer('t', data, null, 'hot', {
        range: [0, 2],
        threshold: [0, 0]
      });
      const rgba = layer.getRGBAData(5);

      // NaN vertex (index 1) should be transparent
      expect(rgba[1 * 4 + 3]).toBe(0);
      // Infinity vertex (index 2) should be transparent
      expect(rgba[2 * 4 + 3]).toBe(0);
      // -Infinity vertex (index 3) should be transparent
      expect(rgba[3 * 4 + 3]).toBe(0);
      // Valid vertices should have non-zero alpha
      expect(rgba[0 * 4 + 3]).toBeGreaterThan(0);
      expect(rgba[4 * 4 + 3]).toBeGreaterThan(0);
    });

    it('should apply primary threshold (hide zone)', () => {
      // Values within [-2, 2] should be hidden
      const data = new Float32Array([0.5, 3.0, -1.0, -4.0]);
      const layer = new StatisticalMapLayer('t', data, null, 'hot', {
        range: [-6, 6],
        threshold: [-2, 2]
      });
      const rgba = layer.getRGBAData(4);

      // 0.5 is in [-2, 2] → transparent
      expect(rgba[0 * 4 + 3]).toBe(0);
      // 3.0 is outside → visible
      expect(rgba[1 * 4 + 3]).toBeGreaterThan(0);
      // -1.0 is in [-2, 2] → transparent
      expect(rgba[2 * 4 + 3]).toBe(0);
      // -4.0 is outside → visible
      expect(rgba[3 * 4 + 3]).toBeGreaterThan(0);
    });

    it('should handle sparse indices', () => {
      const data = new Float32Array([5.0, 6.0]);
      const indices = new Uint32Array([1, 3]);
      const layer = new StatisticalMapLayer('t', data, indices, 'hot', {
        range: [0, 10],
        threshold: [0, 0]
      });
      const rgba = layer.getRGBAData(5);

      // Vertex 0 has no data → transparent
      expect(rgba[0 * 4 + 3]).toBe(0);
      // Vertex 1 has data → visible
      expect(rgba[1 * 4 + 3]).toBeGreaterThan(0);
      // Vertex 2 has no data → transparent
      expect(rgba[2 * 4 + 3]).toBe(0);
      // Vertex 3 has data → visible
      expect(rgba[3 * 4 + 3]).toBeGreaterThan(0);
    });

    it('should apply opacity', () => {
      const data = new Float32Array([5.0]);
      const layer = new StatisticalMapLayer('t', data, null, 'hot', {
        range: [0, 10],
        threshold: [0, 0],
        opacity: 0.5
      });
      const rgba = layer.getRGBAData(1);
      expect(rgba[3]).toBeLessThanOrEqual(0.5);
      expect(rgba[3]).toBeGreaterThan(0);
    });

    it('should handle empty data (0 vertices)', () => {
      const data = new Float32Array(0);
      const layer = new StatisticalMapLayer('t', data, null, 'hot');
      const rgba = layer.getRGBAData(0);
      expect(rgba.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // FDR correction
  // -------------------------------------------------------------------

  describe('FDR correction', () => {
    it('should apply FDR and mask non-surviving vertices', () => {
      // 10 p-values: 4 should survive at q=0.05 per BH
      const pValues = new Float32Array([
        0.001, 0.004, 0.008, 0.010, // small p-values
        0.15, 0.20, 0.30, 0.50, 0.70, 0.90 // large p-values
      ]);
      const data = new Float32Array([
        5, 4, 3.5, 3, 1.5, 1, 0.8, 0.5, 0.3, 0.1
      ]);

      const layer = new StatisticalMapLayer('fdr', data, null, 'hot', {
        pValues,
        range: [0, 6],
        threshold: [0, 0]
      });

      layer.applyFDR(0.05);
      expect(layer.getCorrectionMethod()).toBe('fdr');
      expect(layer.getFDRQ()).toBe(0.05);

      const rgba = layer.getRGBAData(10);

      // First 4 should survive (small p-values)
      expect(rgba[0 * 4 + 3]).toBeGreaterThan(0);
      expect(rgba[1 * 4 + 3]).toBeGreaterThan(0);

      // Last few should not survive (large p-values)
      expect(rgba[8 * 4 + 3]).toBe(0);
      expect(rgba[9 * 4 + 3]).toBe(0);
    });

    it('should throw if pValues not provided', () => {
      const data = new Float32Array([1, 2, 3]);
      const layer = new StatisticalMapLayer('nop', data, null, 'hot');
      expect(() => layer.applyFDR(0.05)).toThrow(/p-values not provided/);
    });

    it('should update mask when q changes', () => {
      const pValues = new Float32Array([0.001, 0.03, 0.5]);
      const data = new Float32Array([5, 3, 1]);
      const layer = new StatisticalMapLayer('fdr', data, null, 'hot', {
        pValues,
        range: [0, 6],
        threshold: [0, 0]
      });

      layer.applyFDR(0.01);
      const rgba1 = layer.getRGBAData(3);
      const visibleAt001 = [rgba1[0 + 3], rgba1[4 + 3], rgba1[8 + 3]].filter(a => a > 0).length;

      layer.applyFDR(0.5);
      const rgba2 = layer.getRGBAData(3);
      const visibleAt050 = [rgba2[0 + 3], rgba2[4 + 3], rgba2[8 + 3]].filter(a => a > 0).length;

      // More lenient q should show more vertices
      expect(visibleAt050).toBeGreaterThanOrEqual(visibleAt001);
    });
  });

  // -------------------------------------------------------------------
  // Bonferroni correction
  // -------------------------------------------------------------------

  describe('Bonferroni correction', () => {
    it('should apply Bonferroni and mask non-surviving vertices', () => {
      const pValues = new Float32Array([0.001, 0.01, 0.05, 0.1]);
      const data = new Float32Array([5, 3, 2, 1]);
      const layer = new StatisticalMapLayer('bonf', data, null, 'hot', {
        pValues,
        range: [0, 6],
        threshold: [0, 0]
      });

      layer.applyBonferroni(0.05);
      expect(layer.getCorrectionMethod()).toBe('bonferroni');

      const rgba = layer.getRGBAData(4);
      // threshold = 0.05/4 = 0.0125; only p=0.001 survives
      expect(rgba[0 * 4 + 3]).toBeGreaterThan(0);
      expect(rgba[1 * 4 + 3]).toBeGreaterThan(0); // 0.01 <= 0.0125
      expect(rgba[2 * 4 + 3]).toBe(0); // 0.05 > 0.0125
      expect(rgba[3 * 4 + 3]).toBe(0);
    });

    it('should throw if pValues not provided', () => {
      const data = new Float32Array([1, 2]);
      const layer = new StatisticalMapLayer('nop', data, null, 'hot');
      expect(() => layer.applyBonferroni(0.05)).toThrow(/p-values not provided/);
    });
  });

  // -------------------------------------------------------------------
  // Cluster-based thresholding
  // -------------------------------------------------------------------

  describe('cluster thresholding', () => {
    it('should identify clusters and filter by size', () => {
      const { faces, vertexCount } = makeSmallMesh();
      // Vertices 0,1,2 are active (|value| > 2), 3 inactive, 4 active (isolated from 0,1,2)
      // Actually in our mesh 0-1-2 and 2-4 are connected, so 0,1,2,4 form one cluster
      // Let's make vertex 3 below threshold
      const data = new Float32Array([3, 4, 5, 0.5, 3]);
      const layer = new StatisticalMapLayer('clust', data, null, 'hot', {
        range: [0, 6],
        threshold: [0, 0]
      });

      layer.setMeshAdjacency(faces, vertexCount);
      layer.applyClusterThreshold(2, { minClusterSize: 2 });

      expect(layer.getCorrectionMethod()).toBe('cluster');

      const rgba = layer.getRGBAData(5);
      // Vertices 0,1,2,4 form a cluster of size 4 (>= 2) → visible
      expect(rgba[0 * 4 + 3]).toBeGreaterThan(0);
      expect(rgba[1 * 4 + 3]).toBeGreaterThan(0);
      expect(rgba[2 * 4 + 3]).toBeGreaterThan(0);
      // Vertex 3 is below threshold → transparent
      expect(rgba[3 * 4 + 3]).toBe(0);
      // Vertex 4 is connected to cluster → visible
      expect(rgba[4 * 4 + 3]).toBeGreaterThan(0);
    });

    it('should filter small clusters', () => {
      const { faces, vertexCount } = makeSmallMesh();
      // Only vertex 4 is active → cluster of size 1
      const data = new Float32Array([0.5, 0.5, 0.5, 0.5, 5]);
      const layer = new StatisticalMapLayer('clust', data, null, 'hot', {
        range: [0, 6],
        threshold: [0, 0]
      });

      layer.setMeshAdjacency(faces, vertexCount);
      layer.applyClusterThreshold(2, { minClusterSize: 2 });

      const rgba = layer.getRGBAData(5);
      // Cluster of size 1 should be filtered out
      expect(rgba[4 * 4 + 3]).toBe(0);
    });

    it('should throw without mesh adjacency', () => {
      const data = new Float32Array([3, 4, 5]);
      const layer = new StatisticalMapLayer('noadj', data, null, 'hot');
      expect(() => layer.applyClusterThreshold(2, { minClusterSize: 2 }))
        .toThrow(/mesh adjacency not set/);
    });
  });

  // -------------------------------------------------------------------
  // Dual-threshold display
  // -------------------------------------------------------------------

  describe('dual threshold', () => {
    it('should apply separate colormaps for positive/negative values', () => {
      const data = new Float32Array([3, -3, 0.5, -0.5, 0]);
      const layer = new StatisticalMapLayer('dual', data, null, 'hot', {
        range: [-6, 6],
        threshold: [0, 0]
      });

      layer.setDualThreshold({
        positiveColorMap: 'hot',
        negativeColorMap: 'cool',
        positiveRange: [2, 6],
        negativeRange: [-6, -2]
      });

      const rgba = layer.getRGBAData(5);

      // Vertex 0 (value=3): positive, above range start → visible
      expect(rgba[0 * 4 + 3]).toBeGreaterThan(0);
      // Vertex 1 (value=-3): negative, below range start → visible
      expect(rgba[1 * 4 + 3]).toBeGreaterThan(0);

      // Colors should differ between positive and negative
      const posR = rgba[0 * 4];
      const negR = rgba[1 * 4];
      // hot colormap is reddish, cool should be blueish — at minimum they differ
      expect(posR).not.toBeCloseTo(negR, 1);

      // Vertex 4 (value=0): dead zone → transparent
      expect(rgba[4 * 4 + 3]).toBe(0);
    });

    it('should revert to single colormap on clearDualThreshold', () => {
      const data = new Float32Array([3, -3]);
      const layer = new StatisticalMapLayer('dual', data, null, 'hot', {
        range: [-6, 6],
        threshold: [0, 0]
      });

      layer.setDualThreshold({
        positiveColorMap: 'hot',
        negativeColorMap: 'cool',
        positiveRange: [2, 6],
        negativeRange: [-6, -2]
      });

      layer.clearDualThreshold();
      const rgba = layer.getRGBAData(2);
      // Both should be colored by the single 'hot' colormap
      expect(rgba[0 * 4 + 3]).toBeGreaterThan(0);
      expect(rgba[1 * 4 + 3]).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------
  // clearCorrection
  // -------------------------------------------------------------------

  describe('clearCorrection', () => {
    it('should restore all supra-threshold vertices', () => {
      const pValues = new Float32Array([0.001, 0.5, 0.9]);
      const data = new Float32Array([5, 3, 1]);
      const layer = new StatisticalMapLayer('clear', data, null, 'hot', {
        pValues,
        range: [0, 6],
        threshold: [0, 0]
      });

      // Apply FDR — some vertices masked
      layer.applyFDR(0.01);
      const rgba1 = layer.getRGBAData(3);
      const visibleBefore = [rgba1[3], rgba1[7], rgba1[11]].filter(a => a > 0).length;

      // Clear correction — all should be visible again
      layer.clearCorrection();
      expect(layer.getCorrectionMethod()).toBe('none');
      const rgba2 = layer.getRGBAData(3);
      const visibleAfter = [rgba2[3], rgba2[7], rgba2[11]].filter(a => a > 0).length;

      expect(visibleAfter).toBe(3);
      expect(visibleAfter).toBeGreaterThanOrEqual(visibleBefore);
    });
  });

  // -------------------------------------------------------------------
  // getVertexStatInfo
  // -------------------------------------------------------------------

  describe('getVertexStatInfo', () => {
    it('should return stat info for a vertex', () => {
      const data = new Float32Array([4.2, 2.1, 0.5]);
      const pValues = new Float32Array([0.0003, 0.02, 0.3]);
      const layer = new StatisticalMapLayer('info', data, null, 'hot', {
        pValues,
        statType: 'tstat',
        degreesOfFreedom: 28
      });

      const info = layer.getVertexStatInfo(0);
      expect(info).not.toBeNull();
      expect(info!.value).toBeCloseTo(4.2, 1);
      expect(info!.pValue).toBeCloseTo(0.0003, 4);
      expect(info!.zScore).toBeGreaterThan(0); // p=0.0003 → high z
      expect(info!.clusterIndex).toBe(-1); // no clusters computed
      expect(info!.clusterSize).toBe(0);
    });

    it('should return null for out-of-range vertex', () => {
      const data = new Float32Array([1, 2, 3]);
      const layer = new StatisticalMapLayer('info', data, null, 'hot');

      expect(layer.getVertexStatInfo(999)).toBeNull();
      expect(layer.getVertexStatInfo(-1)).toBeNull();
    });

    it('should return pValue null when not provided', () => {
      const data = new Float32Array([1, 2]);
      const layer = new StatisticalMapLayer('info', data, null, 'hot');
      const info = layer.getVertexStatInfo(0);
      expect(info!.pValue).toBeNull();
    });

    it('should include cluster info when clusters computed', () => {
      const { faces, vertexCount } = makeSmallMesh();
      const data = new Float32Array([3, 4, 5, 0.5, 3]);
      const layer = new StatisticalMapLayer('info', data, null, 'hot', {
        range: [0, 6],
        threshold: [0, 0]
      });

      layer.setMeshAdjacency(faces, vertexCount);
      layer.applyClusterThreshold(2, { minClusterSize: 1 });

      const info = layer.getVertexStatInfo(0);
      expect(info!.clusterIndex).toBeGreaterThanOrEqual(0);
      expect(info!.clusterSize).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------
  // Corrections interaction
  // -------------------------------------------------------------------

  describe('corrections interaction', () => {
    it('should switch from FDR to cluster correctly', () => {
      const { faces, vertexCount } = makeSmallMesh();
      const pValues = new Float32Array([0.001, 0.01, 0.05, 0.5, 0.001]);
      const data = new Float32Array([5, 4, 3, 0.5, 5]);
      const layer = new StatisticalMapLayer('switch', data, null, 'hot', {
        pValues,
        range: [0, 6],
        threshold: [0, 0]
      });

      layer.applyFDR(0.05);
      expect(layer.getCorrectionMethod()).toBe('fdr');

      layer.setMeshAdjacency(faces, vertexCount);
      layer.applyClusterThreshold(2, { minClusterSize: 1 });
      expect(layer.getCorrectionMethod()).toBe('cluster');

      // FDR mask should be cleared
      expect(layer.getFDRQ()).toBe(0);
    });

    it('should combine correction with dual threshold', () => {
      const pValues = new Float32Array([0.001, 0.001, 0.5, 0.5]);
      const data = new Float32Array([4, -4, 2.5, -2.5]);
      const layer = new StatisticalMapLayer('combo', data, null, 'hot', {
        pValues,
        range: [-6, 6],
        threshold: [0, 0]
      });

      layer.setDualThreshold({
        positiveColorMap: 'hot',
        negativeColorMap: 'cool',
        positiveRange: [2, 6],
        negativeRange: [-6, -2]
      });

      layer.applyFDR(0.05);

      const rgba = layer.getRGBAData(4);
      // Vertices 0,1 survive FDR → visible
      expect(rgba[0 * 4 + 3]).toBeGreaterThan(0);
      expect(rgba[1 * 4 + 3]).toBeGreaterThan(0);
      // Vertices 2,3 don't survive FDR → transparent
      expect(rgba[2 * 4 + 3]).toBe(0);
      expect(rgba[3 * 4 + 3]).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // Layer.fromConfig
  // -------------------------------------------------------------------

  describe('Layer.fromConfig', () => {
    it('should create StatisticalMapLayer from config', () => {
      const layer = Layer.fromConfig({
        type: 'statistical',
        id: 'stat-from-config',
        data: new Float32Array([1, 2, 3]),
        range: [0, 3]
      });

      expect(layer).toBeInstanceOf(StatisticalMapLayer);
      expect(layer.id).toBe('stat-from-config');
    });
  });

  // -------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------

  describe('dispose', () => {
    it('should clean up all state', () => {
      const data = new Float32Array([1, 2, 3]);
      const pValues = new Float32Array([0.01, 0.05, 0.5]);
      const layer = new StatisticalMapLayer('disp', data, null, 'hot', {
        pValues,
        range: [0, 3]
      });

      layer.applyFDR(0.05);
      layer.getRGBAData(3); // populate cache

      layer.dispose();
      expect(layer.getData()).toBeNull();
    });
  });
});
