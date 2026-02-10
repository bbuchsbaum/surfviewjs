/**
 * Pure statistical functions for neuroimaging analysis.
 * All functions are stateless, operate on typed arrays, and have zero external dependencies.
 * @module statistics
 */

/** Result of FDR correction */
export interface FDRResult {
  /** The p-value threshold below which hypotheses are rejected */
  pThreshold: number;
  /** Per-vertex mask: 1 = survives, 0 = filtered */
  survivingMask: Uint8Array;
  /** Number of surviving vertices */
  survivingCount: number;
}

/** Result of Bonferroni correction */
export interface BonferroniResult {
  /** The p-value threshold below which hypotheses are rejected */
  pThreshold: number;
  /** Per-vertex mask: 1 = survives, 0 = filtered */
  survivingMask: Uint8Array;
  /** Number of surviving vertices */
  survivingCount: number;
}

/** Result of cluster finding */
export interface ClusterResult {
  /** Per-vertex cluster ID (-1 = not in any cluster) */
  clusterIds: Int32Array;
  /** Map from cluster ID to vertex count */
  clusterSizes: Map<number, number>;
  /** Total number of clusters found */
  clusterCount: number;
}

/**
 * Computes FDR threshold using the Benjamini-Hochberg procedure.
 *
 * Algorithm:
 * 1. Sort p-values in ascending order
 * 2. For each rank i (1-indexed): criticalValue = (i / V) * q
 * 3. Find the largest i where pValues[i] <= criticalValue
 * 4. All p-values <= this threshold survive
 *
 * Time complexity: O(V log V) due to sorting
 * Space complexity: O(V) for sorted indices
 *
 * @param pValues - Array of p-values (one per vertex)
 * @param q - False discovery rate (typically 0.05)
 * @returns FDR result with threshold, mask, and surviving count
 * @throws If q is not in (0, 1]
 */
export function computeFDRThreshold(
  pValues: Float32Array,
  q: number
): FDRResult {
  if (q <= 0 || q > 1) {
    throw new Error(`FDR q must be in (0, 1], got ${q}`);
  }

  const V = pValues.length;
  if (V === 0) {
    return {
      pThreshold: 0,
      survivingMask: new Uint8Array(0),
      survivingCount: 0
    };
  }

  // Create index array and sort by p-values ascending
  const indices = new Array(V);
  for (let i = 0; i < V; i++) {
    indices[i] = i;
  }

  indices.sort((a, b) => {
    const pA = pValues[a];
    const pB = pValues[b];
    // Handle NaN: treat as largest value
    if (isNaN(pA)) return 1;
    if (isNaN(pB)) return -1;
    return pA - pB;
  });

  // Find the largest rank i where pValues[sortedIndex[i]] <= (i / V) * q
  let maxRank = -1;
  for (let i = 0; i < V; i++) {
    const idx = indices[i];
    const p = pValues[idx];
    const criticalValue = ((i + 1) / V) * q; // 1-indexed rank

    if (!isNaN(p) && p <= criticalValue) {
      maxRank = i;
    }
  }

  // Determine threshold
  let pThreshold = 0;
  if (maxRank >= 0) {
    pThreshold = pValues[indices[maxRank]];
  }

  // Build surviving mask
  const survivingMask = new Uint8Array(V);
  let survivingCount = 0;

  for (let v = 0; v < V; v++) {
    const p = pValues[v];
    if (!isNaN(p) && p <= pThreshold) {
      survivingMask[v] = 1;
      survivingCount++;
    }
  }

  return { pThreshold, survivingMask, survivingCount };
}

/**
 * Computes Bonferroni-corrected threshold.
 *
 * Simple multiple testing correction: threshold = alpha / V
 * A vertex survives if its p-value <= threshold
 *
 * Time complexity: O(V)
 * Space complexity: O(V) for the mask
 *
 * @param pValues - Array of p-values (one per vertex)
 * @param alpha - Family-wise error rate (typically 0.05)
 * @returns Bonferroni result with threshold, mask, and surviving count
 * @throws If alpha is not in (0, 1]
 */
export function computeBonferroniThreshold(
  pValues: Float32Array,
  alpha: number
): BonferroniResult {
  if (alpha <= 0 || alpha > 1) {
    throw new Error(`Bonferroni alpha must be in (0, 1], got ${alpha}`);
  }

  const V = pValues.length;
  if (V === 0) {
    return {
      pThreshold: 0,
      survivingMask: new Uint8Array(0),
      survivingCount: 0
    };
  }

  const pThreshold = alpha / V;
  const survivingMask = new Uint8Array(V);
  let survivingCount = 0;

  for (let v = 0; v < V; v++) {
    const p = pValues[v];
    if (!isNaN(p) && p <= pThreshold) {
      survivingMask[v] = 1;
      survivingCount++;
    }
  }

  return { pThreshold, survivingMask, survivingCount };
}

/**
 * Finds connected clusters using BFS flood-fill.
 *
 * Algorithm:
 * 1. Initialize all cluster IDs to -1
 * 2. For each active vertex not yet assigned:
 *    a. Start a new cluster with BFS
 *    b. Mark all connected active neighbors with the same cluster ID
 * 3. Record cluster sizes
 *
 * Time complexity: O(V + E) where E is the number of edges
 * Space complexity: O(V) for cluster IDs and queue
 *
 * @param activeMask - Binary mask (1 = active, 0 = inactive)
 * @param neighbors - Adjacency list (neighbors[v] = set of neighbor indices)
 * @returns Cluster result with IDs, sizes, and count
 */
export function findClusters(
  activeMask: Uint8Array,
  neighbors: Set<number>[]
): ClusterResult {
  const V = activeMask.length;
  const clusterIds = new Int32Array(V);
  clusterIds.fill(-1);

  const clusterSizes = new Map<number, number>();
  let clusterCount = 0;

  // BFS queue
  const queue: number[] = [];

  for (let v = 0; v < V; v++) {
    if (activeMask[v] === 1 && clusterIds[v] === -1) {
      // Start a new cluster
      const clusterId = clusterCount;
      let clusterSize = 0;

      queue.push(v);
      clusterIds[v] = clusterId;
      clusterSize++;

      // BFS flood-fill
      while (queue.length > 0) {
        const u = queue.shift()!;
        const neighborSet = neighbors[u];

        if (neighborSet) {
          for (const n of neighborSet) {
            if (activeMask[n] === 1 && clusterIds[n] === -1) {
              clusterIds[n] = clusterId;
              clusterSize++;
              queue.push(n);
            }
          }
        }
      }

      clusterSizes.set(clusterId, clusterSize);
      clusterCount++;
    }
  }

  return { clusterIds, clusterSizes, clusterCount };
}

/**
 * Filters clusters by minimum size.
 *
 * Returns a binary mask where vertices in clusters >= minSize survive.
 *
 * Time complexity: O(V)
 * Space complexity: O(V) for the output mask
 *
 * @param clusterIds - Per-vertex cluster IDs from findClusters
 * @param clusterSizes - Cluster ID to size map from findClusters
 * @param minSize - Minimum cluster size to survive
 * @returns Binary mask (1 = survives, 0 = filtered)
 */
export function filterClustersBySize(
  clusterIds: Int32Array,
  clusterSizes: Map<number, number>,
  minSize: number
): Uint8Array {
  const V = clusterIds.length;
  const mask = new Uint8Array(V);

  for (let v = 0; v < V; v++) {
    const clusterId = clusterIds[v];
    if (clusterId >= 0) {
      const size = clusterSizes.get(clusterId);
      if (size !== undefined && size >= minSize) {
        mask[v] = 1;
      }
    }
  }

  return mask;
}

/**
 * Converts a two-tailed p-value to a z-score.
 *
 * Uses the Abramowitz & Stegun rational approximation for the inverse
 * normal CDF (also known as the probit function).
 *
 * For a two-tailed test: z = inverseNormalCDF(1 - p/2)
 *
 * Time complexity: O(1)
 *
 * @param p - Two-tailed p-value in (0, 1)
 * @returns Z-score (positive for small p-values)
 * @throws If p is not in (0, 1)
 */
export function pToZ(p: number): number {
  if (p < 0 || p > 1) {
    throw new Error(`p-value must be in [0, 1], got ${p}`);
  }

  if (p === 0) {
    return 38.0; // Cap at reasonable z-score to avoid Infinity
  }
  if (p === 1) {
    return 0;
  }

  // For two-tailed test, we want the upper tail
  const pHalf = p / 2;

  // Abramowitz & Stegun coefficients
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;

  const t = Math.sqrt(-2 * Math.log(pHalf));
  const z = t - (c0 + c1 * t + c2 * t * t) /
                 (1 + d1 * t + d2 * t * t + d3 * t * t * t);

  return z;
}

/**
 * Converts a t-statistic to an approximate z-score.
 *
 * For large degrees of freedom (df > 30), uses a simple approximation:
 *   z = ((1 - 1/(4*df)) * t) / sqrt(1 + t*t/(2*df))
 *
 * For smaller df, uses a Wilson-Hilferty cube-root transformation.
 *
 * Time complexity: O(1)
 *
 * @param t - t-statistic value
 * @param df - Degrees of freedom
 * @returns Approximate z-score
 * @throws If df < 1
 */
export function tToZ(t: number, df: number): number {
  if (df < 1) {
    throw new Error(`Degrees of freedom must be >= 1, got ${df}`);
  }

  if (df > 30) {
    // Simple approximation for large df
    const numerator = (1 - 1 / (4 * df)) * t;
    const denominator = Math.sqrt(1 + (t * t) / (2 * df));
    return numerator / denominator;
  } else {
    // Wilson-Hilferty approximation for smaller df
    // More accurate for df <= 30
    const t2 = t * t;
    const term1 = t2 / df;
    const term2 = Math.pow(term1 / (1 + term1), 1/3);
    const term3 = 2 / (9 * df);

    const z = (term2 - (1 - term3)) / Math.sqrt(term3);

    // Preserve sign of t
    return t >= 0 ? Math.abs(z) : -Math.abs(z);
  }
}
