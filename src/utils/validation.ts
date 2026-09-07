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
