/** Failures of a computation contract, distinct from unsupported output samples. */
export type GeometryErrorCode = 'invalid-shape' | 'invalid-domain' | 'frame-mismatch' |
  'unsupported-topology' | 'degenerate-geometry' | 'invalid-weights' | 'checksum-mismatch' |
  'budget-exceeded' | 'cancelled' | 'stale-input' | 'disposed';

export class GeometryError extends Error {
  constructor(readonly code: GeometryErrorCode, message: string) {
    super(message);
    this.name = 'GeometryError';
  }
}

export const DEFAULT_GEOMETRY_BUDGET = 256 * 1024 * 1024;
export const DEFAULT_PLAN_BUDGET = 128 * 1024 * 1024;

export function checkBudget(bytes: number, limit = DEFAULT_GEOMETRY_BUDGET): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new GeometryError('invalid-shape', 'Budget must be a positive safe integer');
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit) {
    throw new GeometryError('budget-exceeded', `Computation requires ${bytes} bytes; budget is ${limit}`);
  }
}

export function checkIndex(index: number, length: number, name = 'index'): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
    throw new GeometryError('invalid-shape', `${name} ${index} is outside [0, ${length})`);
  }
}

export function checkMask(mask: Uint8Array | undefined, count: number): void {
  if (mask && (mask.length !== count || mask.some(x => x !== 0 && x !== 1))) {
    throw new GeometryError('invalid-shape', 'Validity mask must contain one 0/1 per input');
  }
}

export function checkFinite(value: number, name: string, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) throw new GeometryError('invalid-shape', `${name} must be finite and >= ${minimum}`);
  return value;
}

export function checkFraction(value: number, name: string): number {
  checkFinite(value, name, 0);
  if (value > 1) throw new GeometryError('invalid-shape', `${name} must be <= 1`);
  return value;
}
