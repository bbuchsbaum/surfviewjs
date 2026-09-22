/** Stable error codes for public numeric-domain validation. */
export type NumericValidationErrorCode =
  | 'not-finite'
  | 'not-integer'
  | 'out-of-range'
  | 'invalid-pair'
  | 'invalid-length';

/**
 * Typed error thrown before a public numeric mutation can change observable state.
 */
export class NumericValidationError extends RangeError {
  readonly code: NumericValidationErrorCode;
  readonly parameter: string;
  readonly value: unknown;

  constructor(
    code: NumericValidationErrorCode,
    parameter: string,
    message: string,
    value: unknown
  ) {
    super(`${parameter} ${message}`);
    this.name = 'NumericValidationError';
    this.code = code;
    this.parameter = parameter;
    this.value = value;
  }
}

export interface FiniteNumberDomain {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minimumExclusive?: boolean;
  readonly maximumExclusive?: boolean;
  readonly integer?: boolean;
}

/** Validate and return one finite number in the requested domain. */
export function finiteNumber(
  value: unknown,
  parameter: string,
  domain: FiniteNumberDomain = {}
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new NumericValidationError('not-finite', parameter, 'must be a finite number.', value);
  }
  if (domain.integer && !Number.isInteger(value)) {
    throw new NumericValidationError('not-integer', parameter, 'must be an integer.', value);
  }
  if (domain.minimum !== undefined) {
    const below = domain.minimumExclusive ? value <= domain.minimum : value < domain.minimum;
    if (below) {
      const relation = domain.minimumExclusive ? 'greater than' : 'at least';
      throw new NumericValidationError(
        'out-of-range',
        parameter,
        `must be ${relation} ${domain.minimum}.`,
        value
      );
    }
  }
  if (domain.maximum !== undefined) {
    const above = domain.maximumExclusive ? value >= domain.maximum : value > domain.maximum;
    if (above) {
      const relation = domain.maximumExclusive ? 'less than' : 'at most';
      throw new NumericValidationError(
        'out-of-range',
        parameter,
        `must be ${relation} ${domain.maximum}.`,
        value
      );
    }
  }
  return value;
}

/** Validate and defensively copy finite ascending bounds. Equal bounds are valid. */
export function finitePair(value: unknown, parameter: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new NumericValidationError(
      'invalid-length',
      parameter,
      'must contain exactly two numeric bounds.',
      value
    );
  }
  const lower = finiteNumber(value[0], `${parameter}[0]`);
  const upper = finiteNumber(value[1], `${parameter}[1]`);
  if (lower > upper) {
    throw new NumericValidationError(
      'invalid-pair',
      parameter,
      'must contain ascending bounds (minimum <= maximum).',
      value
    );
  }
  return [lower, upper];
}

/** Validate an opacity/alpha multiplier. Both transparent zero and opaque one are valid. */
export function opacity(value: unknown, parameter = 'opacity'): number {
  return finiteNumber(value, parameter, { minimum: 0, maximum: 1 });
}

/** Validate an RGB integer stored as 0xRRGGBB. */
export function rgbInteger(value: unknown, parameter: string): number {
  return finiteNumber(value, parameter, {
    minimum: 0,
    maximum: 0xffffff,
    integer: true
  });
}

/** Maximum renderer pixel ratio used to bound GPU framebuffer allocation. */
export const MAX_DEVICE_PIXEL_RATIO = 4;

/** Validate a positive DPR and cap it to the documented framebuffer safety limit. */
export function devicePixelRatio(value: unknown, parameter = 'dpr'): number {
  return Math.min(
    MAX_DEVICE_PIXEL_RATIO,
    finiteNumber(value, parameter, { minimum: 0, minimumExclusive: true })
  );
}

/** Recursively reject numbers that JSON would silently coerce to null. */
export function assertFiniteJSONNumbers(
  value: unknown,
  parameter = '$',
  ancestors: Set<object> = new Set()
): void {
  if (typeof value === 'number') {
    finiteNumber(value, parameter);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (ancestors.has(value)) {
    throw new TypeError(`${parameter} must not contain circular references.`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteJSONNumbers(item, `${parameter}[${index}]`, ancestors));
  } else {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertFiniteJSONNumbers(item, `${parameter}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}
