import { describe, it, expect } from 'vitest';
import {
  computeFDRThreshold,
  computeBonferroniThreshold,
  findClusters,
  filterClustersBySize,
  pToZ,
  tToZ
} from '../../src/utils/statistics';

describe('statistics', () => {
  describe('computeFDRThreshold', () => {
    it('should compute FDR threshold correctly', () => {
      const pValues = new Float32Array([0.001, 0.01, 0.05, 0.1, 0.5]);
      const result = computeFDRThreshold(pValues, 0.05);

      expect(result.pThreshold).toBeGreaterThan(0);
      expect(result.survivingMask.length).toBe(5);
      expect(result.survivingCount).toBeGreaterThan(0);
    });

    it('should handle all non-surviving case', () => {
      const pValues = new Float32Array([0.9, 0.95, 0.99]);
      const result = computeFDRThreshold(pValues, 0.05);

      expect(result.survivingCount).toBe(0);
      expect(result.pThreshold).toBe(0);
    });

    it('should handle NaN values', () => {
      const pValues = new Float32Array([0.01, NaN, 0.05]);
      const result = computeFDRThreshold(pValues, 0.05);

      expect(result.survivingMask[1]).toBe(0); // NaN should not survive
    });

    it('should throw on invalid q', () => {
      const pValues = new Float32Array([0.01, 0.05]);
      expect(() => computeFDRThreshold(pValues, 0)).toThrow();
      expect(() => computeFDRThreshold(pValues, 1.5)).toThrow();
    });
  });

  describe('computeBonferroniThreshold', () => {
    it('should compute Bonferroni threshold correctly', () => {
      const pValues = new Float32Array([0.001, 0.01, 0.05, 0.1]);
      const result = computeBonferroniThreshold(pValues, 0.05);

      expect(result.pThreshold).toBe(0.05 / 4);
      expect(result.survivingMask[0]).toBe(1); // 0.001 should survive
      expect(result.survivingMask[3]).toBe(0); // 0.1 should not survive
    });

    it('should throw on invalid alpha', () => {
      const pValues = new Float32Array([0.01, 0.05]);
      expect(() => computeBonferroniThreshold(pValues, 0)).toThrow();
      expect(() => computeBonferroniThreshold(pValues, 2)).toThrow();
    });
  });

  describe('findClusters', () => {
    it('should find connected clusters', () => {
      const activeMask = new Uint8Array([1, 1, 0, 1, 1]);
      const neighbors = [
        new Set([1]),      // 0 -> 1
        new Set([0]),      // 1 -> 0
        new Set([]),       // 2 (inactive)
        new Set([4]),      // 3 -> 4
        new Set([3])       // 4 -> 3
      ];

      const result = findClusters(activeMask, neighbors);

      expect(result.clusterCount).toBe(2);
      expect(result.clusterIds[0]).toBe(result.clusterIds[1]); // same cluster
      expect(result.clusterIds[3]).toBe(result.clusterIds[4]); // same cluster
      expect(result.clusterIds[0]).not.toBe(result.clusterIds[3]); // different clusters
      expect(result.clusterIds[2]).toBe(-1); // inactive
    });

    it('should handle no active vertices', () => {
      const activeMask = new Uint8Array([0, 0, 0]);
      const neighbors = [new Set(), new Set(), new Set()];

      const result = findClusters(activeMask, neighbors);

      expect(result.clusterCount).toBe(0);
    });
  });

  describe('filterClustersBySize', () => {
    it('should filter clusters by minimum size', () => {
      const clusterIds = new Int32Array([0, 0, 1, 1, 1, -1]);
      const clusterSizes = new Map([[0, 2], [1, 3]]);

      const mask = filterClustersBySize(clusterIds, clusterSizes, 3);

      expect(mask[0]).toBe(0); // cluster 0 has size 2, filtered
      expect(mask[1]).toBe(0);
      expect(mask[2]).toBe(1); // cluster 1 has size 3, survives
      expect(mask[3]).toBe(1);
      expect(mask[4]).toBe(1);
      expect(mask[5]).toBe(0); // not in cluster
    });
  });

  describe('pToZ', () => {
    it('should convert p-values to z-scores', () => {
      expect(pToZ(0.05)).toBeCloseTo(1.96, 1);
      expect(pToZ(0.01)).toBeCloseTo(2.58, 1);
      expect(pToZ(1)).toBe(0);
    });

    it('should handle edge cases', () => {
      expect(pToZ(0)).toBe(38.0);
      expect(() => pToZ(-0.1)).toThrow();
      expect(() => pToZ(1.1)).toThrow();
    });
  });

  describe('tToZ', () => {
    it('should convert t-statistics to z-scores for large df', () => {
      const z = tToZ(2.0, 100);
      expect(z).toBeCloseTo(2.0, 1); // For large df, t ≈ z
    });

    it('should handle small df', () => {
      const z = tToZ(2.0, 10);
      expect(z).toBeGreaterThan(0);
    });

    it('should preserve sign', () => {
      expect(tToZ(-2.0, 20)).toBeLessThan(0);
      expect(tToZ(2.0, 20)).toBeGreaterThan(0);
    });

    it('should throw on invalid df', () => {
      expect(() => tToZ(2.0, 0)).toThrow();
      expect(() => tToZ(2.0, -1)).toThrow();
    });
  });
});
