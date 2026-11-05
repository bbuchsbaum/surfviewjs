/**
 * Magnitude-graded opacity for scalar maps.
 *
 * A map coloured by value can also fade by |value|, so weak effects recede
 * toward the anatomy beneath them and strong effects read as solid. This is
 * the "dual coding" of effect size and evidence advocated by Allen, Erhardt
 * and Calhoun (2012) and Taylor et al. (2023): nothing is hidden by the fade,
 * and a threshold mask, when one is set, still hides values outright.
 *
 * Opacity is evaluated separately for each sign. For a value v with magnitude
 * m = |v| on the side of zero it lies:
 *
 *   start = max(low, threshold edge on that side)
 *   end   = high, or the colour-range end on that side when high is 'range'
 *   alpha = 0                                          when m < start
 *         = floor' + (1 - floor') * clamp((m - start) / (end - start))^gamma
 *
 * where floor' is `floor` when start > 0 and 0 when start is 0, so an
 * unthresholded map fades all the way to transparent at zero while a
 * thresholded map keeps its weakest shown values visible. With `low = 0`,
 * `gamma = 1` and `floor = 0.6` this reproduces neuroim2's "ramp" overlay
 * alpha; a positive `low` (a knee) and a fitted `gamma` reproduce its "soft"
 * mode.
 */
export interface MagnitudeOpacity {
  /** Magnitude below which values are transparent. Defaults to 0. */
  low?: number;
  /** Magnitude at which opacity reaches 1, or 'range' for the colour-range end. Defaults to 'range'. */
  high?: number | 'range';
  /** Exponent applied to the normalized magnitude. Defaults to 1 (linear). */
  gamma?: number;
  /** Opacity at a positive start magnitude, in [0, 1]. Defaults to 0. */
  floor?: number;
}

export interface ResolvedMagnitudeOpacity {
  readonly low: number;
  readonly high: number | 'range';
  readonly gamma: number;
  readonly floor: number;
}

/** Validate a magnitude-opacity spec; null or undefined disables the fade. */
export function normalizeMagnitudeOpacity(
  spec: MagnitudeOpacity | null | undefined,
  label = 'magnitudeOpacity'
): ResolvedMagnitudeOpacity | null {
  if (spec === null || spec === undefined) return null;
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError(`${label} must be an object or null.`);
  }
  const low = spec.low ?? 0;
  const high = spec.high ?? 'range';
  const gamma = spec.gamma ?? 1;
  const floor = spec.floor ?? 0;
  if (!Number.isFinite(low) || low < 0) {
    throw new RangeError(`${label}.low must be a finite, non-negative number.`);
  }
  if (high !== 'range' && (!Number.isFinite(high) || high <= low)) {
    throw new RangeError(`${label}.high must be 'range' or a finite number above low.`);
  }
  if (!Number.isFinite(gamma) || gamma <= 0) {
    throw new RangeError(`${label}.gamma must be a finite, positive number.`);
  }
  if (!Number.isFinite(floor) || floor < 0 || floor > 1) {
    throw new RangeError(`${label}.floor must be between 0 and 1.`);
  }
  return Object.freeze({ low, high, gamma, floor });
}

/**
 * Opacity multiplier in [0, 1] for `value` under `spec`, given the layer's
 * colour range and threshold mask (an empty mask, low >= high, means none).
 */
export function magnitudeOpacityAt(
  value: number,
  spec: ResolvedMagnitudeOpacity,
  range: readonly [number, number],
  threshold: readonly [number, number]
): number {
  if (!Number.isFinite(value)) return 0;
  const positive = value >= 0;
  const magnitude = Math.abs(value);
  const masked = threshold[1] > threshold[0];
  const edge = masked ? Math.max(0, positive ? threshold[1] : -threshold[0]) : 0;
  const start = Math.max(spec.low, edge);
  if (magnitude < start || magnitude === 0) return 0;
  let end: number;
  if (spec.high === 'range') {
    const side = positive ? range[1] : -range[0];
    end = side > 0 ? side : Math.max(Math.abs(range[0]), Math.abs(range[1]));
  } else {
    end = spec.high;
  }
  const floor = start > 0 ? spec.floor : 0;
  if (!(end > start)) return 1;
  const t = Math.min(1, (magnitude - start) / (end - start));
  return floor + (1 - floor) * Math.pow(t, spec.gamma);
}
