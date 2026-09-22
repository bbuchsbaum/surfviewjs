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

    it('rejects missing adjacency rows and out-of-range neighbors', () => {
      expect(() => findClusters(
        new Uint8Array([1, 1]),
        [new Set([1])]
      )).toThrow(/neighbors length/);
      expect(() => findClusters(
        new Uint8Array([1, 1]),
        [new Set([2]), new Set([0])]
      )).toThrow(/out-of-range vertex 2/);
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
      expect(() => pToZ(Number.NaN)).toThrow();
      expect(() => pToZ(Number.POSITIVE_INFINITY)).toThrow();
    });
  });

  describe('tToZ', () => {
    // Generated independently with R 4.x using the numerically stable upper
    // tail: qnorm(pt(t, df, lower.tail=FALSE), lower.tail=FALSE).
    const rOracle = [
      { t: 0.1, df: 1, z: 0.0796080844835949 },
      { t: 0.5, df: 1, z: 0.378804878070813 },
      { t: 2, df: 1, z: 1.04685331733493 },
      { t: 5, df: 1, z: 1.53141881730814 },
      { t: 8, df: 1, z: 1.75554079941594 },
      { t: 0.1, df: 2, z: 0.0885174213992957 },
      { t: 0.5, df: 2, z: 0.430727299295457 },
      { t: 2, df: 2, z: 1.33004507921329 },
      { t: 5, df: 2, z: 2.07756382077749 },
      { t: 8, df: 2, z: 2.42595716689398 },
      { t: 0.1, df: 5, z: 0.0951066184385608 },
      { t: 0.5, df: 5, z: 0.470078587598904 },
      { t: 2, df: 5, z: 1.63552289670035 },
      { t: 5, df: 5, z: 2.87000015482413 },
      { t: 8, df: 5, z: 3.48458186030585 },
      { t: 0.1, df: 10, z: 0.0975108495901718 },
      { t: 0.5, df: 10, z: 0.484693742746123 },
      { t: 2, df: 10, z: 1.79040993226883 },
      { t: 5, df: 10, z: 3.46142009618562 },
      { t: 8, df: 10, z: 4.38171378378715 },
      { t: 0.1, df: 30, z: 0.0991620427268623 },
      { t: 0.5, df: 30, z: 0.494825921794522 },
      { t: 2, df: 30, z: 1.92184674115272 },
      { t: 5, df: 30, z: 4.23069840596461 },
      { t: 8, df: 30, z: 5.80950392636888 },
      { t: 0.1, df: 31, z: 0.0991889535353704 },
      { t: 0.5, df: 31, z: 0.494991739827139 },
      { t: 2, df: 31, z: 1.92421838675025 },
      { t: 5, df: 31, z: 4.24894634821719 },
      { t: 8, df: 31, z: 5.84917188633599 },
      { t: 0.1, df: 100, z: 0.099747824860969 },
      { t: 0.5, df: 100, z: 0.49844054421832 },
      { t: 2, df: 100, z: 1.97549343644226 },
      { t: 5, df: 100, z: 4.71223271480169 },
      { t: 8, df: 100, z: 7.0166281257255 },
      { t: 0.1, df: 1000, z: 0.0999747532135894 },
      { t: 0.5, df: 1000, z: 0.499843780290377 },
      { t: 2, df: 1000, z: 1.99750504934628 },
      { t: 5, df: 1000, z: 4.96792660747233 },
      { t: 8, df: 1000, z: 7.87429624322521 }
    ];

    it.each(rOracle)('matches the independent R oracle at t=$t, df=$df', ({ t, df, z }) => {
      expect(tToZ(t, df)).toBeCloseTo(z, 7);
    });

    it('satisfies zero identity and odd symmetry', () => {
      for (const df of [0.5, 1, 5, 30, 31, 100, 1000]) {
        expect(tToZ(0, df)).toBe(0);
        for (const t of [0.1, 0.5, 2, 5]) {
          expect(tToZ(-t, df)).toBeCloseTo(-tToZ(t, df), 12);
        }
      }
    });

    it('is monotone in absolute t for every tested df', () => {
      for (const df of [0.5, 1, 2, 10, 30, 31, 100, 1000]) {
        const values = [0, 0.1, 0.5, 1, 2, 5, 8].map(t => tToZ(t, df));
        for (let i = 1; i < values.length; i++) {
          expect(values[i]).toBeGreaterThan(values[i - 1]);
        }
      }
    });

    it('is continuous across the former df=30 branch boundary', () => {
      for (const t of [0.1, 0.5, 2, 5, 8]) {
        const below = tToZ(t, 30 - 1e-6);
        const above = tToZ(t, 30 + 1e-6);
        expect(Math.abs(above - below)).toBeLessThan(1e-6);
      }
    });

    it('supports positive non-integer degrees of freedom', () => {
      expect(tToZ(2, 0.5)).toBeCloseTo(0.762913657396488, 7);
      expect(tToZ(2, 12.5)).toBeGreaterThan(0);
    });

    it('defines invalid and extreme input behavior', () => {
      expect(() => tToZ(Number.NaN, 10)).toThrow(/t-statistic must be finite/);
      expect(() => tToZ(Number.POSITIVE_INFINITY, 10)).toThrow(/t-statistic must be finite/);
      expect(() => tToZ(2, Number.NaN)).toThrow(/Degrees of freedom/);
      expect(() => tToZ(2, Number.POSITIVE_INFINITY)).toThrow(/Degrees of freedom/);
      expect(() => tToZ(2, 0)).toThrow(/Degrees of freedom/);
      expect(() => tToZ(2, -1)).toThrow(/Degrees of freedom/);
      expect(tToZ(Number.MAX_VALUE, 1)).toBe(38);
      expect(tToZ(-Number.MAX_VALUE, 1)).toBe(-38);
    });
  });
});
