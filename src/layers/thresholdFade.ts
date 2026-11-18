/** Display ramp inside a scalar layer's threshold band. */
export interface ThresholdFade {
  /** Distance from the fade baseline where the ramp begins, in map units. */
  readonly from: number;
  /** Defaults to a linear ramp. */
  readonly curve?: 'linear' | 'quadratic';
}

export function normalizeThresholdFade(
  spec: ThresholdFade | null | undefined,
  label = 'thresholdFade'
): Readonly<Required<ThresholdFade>> | null {
  if (spec === null || spec === undefined) return null;
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError(`${label} must be an object or null.`);
  }
  const { from, curve = 'linear' } = spec;
  if (!Number.isFinite(from) || from < 0) {
    throw new RangeError(`${label}.from must be a finite, non-negative number.`);
  }
  if (curve !== 'linear' && curve !== 'quadratic') {
    throw new TypeError(`${label}.curve must be 'linear' or 'quadratic'.`);
  }
  return Object.freeze({ from, curve });
}

/** Intrinsic alpha multiplier, independently of colour range and layer opacity. */
export function thresholdFadeAlpha(
  value: number,
  [low, high]: readonly [number, number],
  { from, curve }: ThresholdFade
): number {
  if (!Number.isFinite(value)) return 0;
  if (high <= low) return 1;
  const baseline = Math.min(high, Math.max(low, 0));
  if (value === baseline) return 0;
  if (value <= low || value >= high) return 1;
  const distance = Math.abs(value - baseline);
  const cutoff = value < baseline ? baseline - low : high - baseline;
  if (distance <= from || from >= cutoff) return 0;
  const t = (distance - from) / (cutoff - from);
  return curve === 'quadratic' ? t * t : t;
}
