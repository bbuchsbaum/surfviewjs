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
  const indices: number[] = new Array(V);
  for (let i = 0; i < V; i++) {
    indices[i] = i;
  }

  indices.sort((a, b) => {
    // `a` and `b` are populated from the closed interval [0, V).
    const pA = pValues[a]!;
    const pB = pValues[b]!;
    // Handle NaN: treat as largest value
    if (isNaN(pA)) return 1;
    if (isNaN(pB)) return -1;
    return pA - pB;
  });

  // Find the largest rank i where pValues[sortedIndex[i]] <= (i / V) * q
  let maxRank = -1;
  for (let i = 0; i < V; i++) {
    // `indices` was completely populated with values in [0, V) before sorting.
    const idx = indices[i]!;
    const p = pValues[idx]!;
    const criticalValue = ((i + 1) / V) * q; // 1-indexed rank

    if (!isNaN(p) && p <= criticalValue) {
      maxRank = i;
    }
  }

  // Determine threshold
  let pThreshold = 0;
  if (maxRank >= 0) {
    const thresholdIndex = indices[maxRank]!;
    pThreshold = pValues[thresholdIndex]!;
  }

  // Build surviving mask
  const survivingMask = new Uint8Array(V);
  let survivingCount = 0;

  for (let v = 0; v < V; v++) {
    // `v` is bounded by the typed array's captured length `V`.
    const p = pValues[v]!;
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
    // `v` is bounded by the typed array's captured length `V`.
    const p = pValues[v]!;
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
  if (neighbors.length !== V) {
    throw new RangeError(
      `neighbors length must match activeMask length ${V} (received ${neighbors.length})`
    );
  }
  for (let vertex = 0; vertex < V; vertex++) {
    const neighborSet = neighbors[vertex];
    if (!neighborSet) {
      throw new RangeError(`neighbors[${vertex}] is missing`);
    }
    for (const neighbor of neighborSet) {
      if (!Number.isSafeInteger(neighbor) || neighbor < 0 || neighbor >= V) {
        throw new RangeError(
          `neighbors[${vertex}] contains out-of-range vertex ${String(neighbor)}`
        );
      }
    }
  }
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
        // The shape-and-bounds pass above proves every queued vertex has a set.
        const neighborSet = neighbors[u]!;

        for (const n of neighborSet) {
          if (activeMask[n] === 1 && clusterIds[n] === -1) {
            clusterIds[n] = clusterId;
            clusterSize++;
            queue.push(n);
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
    // `v` is bounded by the typed array's captured length `V`.
    const clusterId = clusterIds[v]!;
    if (clusterId >= 0) {
      const size = clusterSizes.get(clusterId);
      if (size !== undefined && size >= minSize) {
        mask[v] = 1;
      }
    }
  }

  return mask;
}

const NORMAL_QUANTILE_LOWER_BOUND = 0.02425;
const NORMAL_QUANTILE_UPPER_BOUND = 1 - NORMAL_QUANTILE_LOWER_BOUND;
const MAX_FINITE_Z_SCORE = 38;

/**
 * Inverse standard-normal CDF using Peter J. Acklam's rational approximation.
 * The approximation has absolute error below roughly 1.2e-9 over its finite
 * domain, which is comfortably smaller than the incomplete-beta error below.
 */
function inverseNormalCDF(probability: number): number {
  if (!(probability > 0 && probability < 1)) {
    throw new Error(`Normal-CDF probability must be in (0, 1), got ${probability}`);
  }

  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239
  ] as const;
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1
  ] as const;
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783
  ] as const;
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416
  ] as const;

  if (probability < NORMAL_QUANTILE_LOWER_BOUND) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  if (probability > NORMAL_QUANTILE_UPPER_BOUND) {
    const q = Math.sqrt(-2 * Math.log1p(-probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Lanczos log-gamma approximation for positive arguments. */
function logGamma(value: number): number {
  const coefficients = [
    0.9999999999998099,
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7
  ] as const;

  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }

  const shifted = value - 1;
  let series = coefficients[0];
  for (const [i, coefficient] of coefficients.entries()) {
    if (i === 0) continue;
    series += coefficient / (shifted + i);
  }
  const t = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(t) - t + Math.log(series);
}

/** Continued fraction used by the regularized incomplete beta function. */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const minimum = 1e-300;
  const sum = a + b;
  const aPlusOne = a + 1;
  const aMinusOne = a - 1;
  let c = 1;
  let d = 1 - sum * x / aPlusOne;
  if (Math.abs(d) < minimum) d = minimum;
  d = 1 / d;
  let result = d;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const doubled = 2 * iteration;
    let coefficient = iteration * (b - iteration) * x /
      ((aMinusOne + doubled) * (a + doubled));
    d = 1 + coefficient * d;
    if (Math.abs(d) < minimum) d = minimum;
    c = 1 + coefficient / c;
    if (Math.abs(c) < minimum) c = minimum;
    d = 1 / d;
    result *= d * c;

    coefficient = -(a + iteration) * (sum + iteration) * x /
      ((a + doubled) * (aPlusOne + doubled));
    d = 1 + coefficient * d;
    if (Math.abs(d) < minimum) d = minimum;
    c = 1 + coefficient / c;
    if (Math.abs(c) < minimum) c = minimum;
    d = 1 / d;
    const delta = d * c;
    result *= delta;

    if (Math.abs(delta - 1) <= epsilon) return result;
  }

  throw new Error('Regularized incomplete beta failed to converge');
}

/** Regularized incomplete beta I_x(a, b), evaluated in its stable tail. */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x === 0) return 0;
  if (x === 1) return 1;

  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log1p(-x)
  );

  if (x < (a + 1) / (a + b + 2)) {
    return front * betaContinuedFraction(a, b, x) / a;
  }
  return 1 - front * betaContinuedFraction(b, a, 1 - x) / b;
}

/**
 * Converts a two-tailed p-value to the non-negative equivalent z magnitude.
 *
 * The estimand is `-Phi^-1(p / 2)`, where `Phi` is the standard-normal CDF.
 * `p = 0` is capped at 38 rather than returning infinity; `p = 1` maps to 0.
 *
 * @param p - Two-tailed p-value in [0, 1]
 * @returns Non-negative z-score magnitude
 * @throws If p is non-finite or outside [0, 1]
 */
export function pToZ(p: number): number {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error(`p-value must be finite and in [0, 1], got ${p}`);
  }
  if (p === 0) return MAX_FINITE_Z_SCORE;
  if (p === 1) return 0;
  return -inverseNormalCDF(p / 2);
}

/**
 * Converts a signed Student-t statistic to its equivalent standard-normal z.
 *
 * The transformation preserves the signed cumulative probability:
 * `z = Phi^-1(F_t(t; df))`. Equivalently, it computes the exact two-tailed
 * Student-t probability with the regularized incomplete beta function and
 * applies the sign of `t` to the corresponding normal z magnitude.
 *
 * The incomplete-beta continued fraction is evaluated to about 3e-14 relative
 * convergence. Normal quantiles use a rational approximation with about 1e-9
 * absolute error. If the two-tailed probability underflows to zero, the finite
 * result is capped at +/-38, matching `pToZ(0)`.
 *
 * @param t - Finite Student-t statistic
 * @param df - Finite positive degrees of freedom; non-integers are supported
 * @returns Signed equivalent z-score
 * @throws If t is non-finite or df is non-finite/non-positive
 */
export function tToZ(t: number, df: number): number {
  if (!Number.isFinite(t)) {
    throw new Error(`t-statistic must be finite, got ${t}`);
  }
  if (!Number.isFinite(df) || df <= 0) {
    throw new Error(`Degrees of freedom must be finite and > 0, got ${df}`);
  }
  if (t === 0) return 0;

  const tSquared = t * t;
  const betaArgument = Number.isFinite(tSquared)
    ? df / (df + tSquared)
    : 0;
  const twoTailedProbability = regularizedIncompleteBeta(
    betaArgument,
    df / 2,
    0.5
  );
  const magnitude = pToZ(Math.max(0, Math.min(1, twoTailedProbability)));
  return t < 0 ? -magnitude : magnitude;
}
