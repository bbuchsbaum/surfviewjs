import { runGeometrySync } from './GeometryExecutor';
import { checkBudget, checkFraction, checkMask, DEFAULT_PLAN_BUDGET, GeometryError } from './GeometryError';
import type { ApplySurfaceOptions, SparsePlan, SurfaceComputationResult } from './SparsePlan';

/** Owned fixed-validity snapshot. Invalid/nonfinite contributors must be excluded explicitly. */
export class PreparedSurfaceSmoothing {
  readonly byteLength: number;
  private readonly mask: Uint8Array;
  private readonly mass: Float64Array;
  private readonly coverage: Float64Array;
  private readonly valid: Uint8Array;
  private readonly minimum: number;
  private readonly strict: boolean;
  /** @internal Create through SurfaceSmoothingPlan.prepare(). */
  constructor(private readonly kernel: SparsePlan, options: ApplySurfaceOptions = {}, private readonly budgetBytes = DEFAULT_PLAN_BUDGET, initialize = true) {
    checkMask(options.validity, kernel.sourceCount);
    if (options.missing !== undefined && options.missing !== 'strict' && options.missing !== 'renormalize') throw new GeometryError('invalid-shape', 'Unknown missing-data policy');
    this.minimum = checkFraction(options.minCoverage ?? (options.missing === 'strict' ? 1 : 0), 'minCoverage');
    this.strict = options.missing === 'strict';
    this.byteLength = kernel.sourceCount + kernel.targetCount * 17;
    checkBudget(kernel.byteLength + this.byteLength, budgetBytes);
    this.mask = options.validity?.slice() ?? new Uint8Array(kernel.sourceCount).fill(1);
    this.mass = new Float64Array(kernel.targetCount); this.coverage = new Float64Array(kernel.targetCount); this.valid = new Uint8Array(kernel.targetCount);
    if (initialize) runGeometrySync(this.initializeSteps());
  }
  /** @internal Cooperative factory used by SurfaceSmoothingPlan.prepareSteps(). */
  static *createSteps(kernel: SparsePlan, options: ApplySurfaceOptions, budgetBytes: number): Generator<void, PreparedSurfaceSmoothing, void> {
    const prepared = new PreparedSurfaceSmoothing(kernel, options, budgetBytes, false);
    yield* prepared.initializeSteps(); return prepared;
  }
  private *initializeSteps(): Generator<void, void, void> {
    const kernel = this.kernel;
    for (let row = 0; row < kernel.targetCount; row++) {
      let mass = 0, complete = true;
      for (let j = kernel.offsets[row]!; j < kernel.offsets[row + 1]!; j++) {
        if (this.mask[kernel.indices[j]!]) mass += kernel.weights[j]!; else complete = false;
      }
      this.mass[row] = mass; this.coverage[row] = Math.min(1, kernel.supportCoverage[row]! * mass);
      this.valid[row] = +(mass > 0 && this.coverage[row]! + 1e-12 >= this.minimum && (!this.strict || complete));
      if (row % 128 === 127) yield;
    }
  }
  apply(values: ArrayLike<number>): SurfaceComputationResult { return this.applyBatch([values])[0]!; }
  /** At most 16 frames; uses 128-row tiles to reuse weights across frames and cached denominators. */
  applyBatch(frames: readonly ArrayLike<number>[]): SurfaceComputationResult[] { return runGeometrySync(this.computeBatch(frames)); }
  /** Capture caller frames before queueing cooperative background application. */
  applyBatchSteps(frames: readonly ArrayLike<number>[]): Generator<void, SurfaceComputationResult[], void> {
    if (!frames.length || frames.length > 16) throw new GeometryError('invalid-shape', 'A batch requires 1 to 16 frames');
    for (const frame of frames) if (frame.length !== this.kernel.sourceCount) throw new GeometryError('invalid-shape', 'Frame must match source count');
    checkBudget(this.kernel.byteLength + this.byteLength + frames.length * (this.kernel.sourceCount * 8 + this.kernel.targetCount * 17), this.budgetBytes);
    return this.computeBatch(frames.map(frame => Float64Array.from(frame)));
  }
  private *computeBatch(frames: readonly ArrayLike<number>[]): Generator<void, SurfaceComputationResult[], void> {
    const k = this.kernel, n = k.targetCount;
    if (!frames.length || frames.length > 16) throw new GeometryError('invalid-shape', 'A batch requires 1 to 16 frames');
    checkBudget(k.byteLength + this.byteLength + frames.length * n * 17, this.budgetBytes);
    for (const frame of frames) {
      if (frame.length !== k.sourceCount) throw new GeometryError('invalid-shape', 'Frame must match source count');
      for (let col = 0; col < k.sourceCount; col++) if (this.mask[col] && !Number.isFinite(frame[col])) throw new GeometryError('invalid-shape', 'Nonfinite value changes prepared validity; prepare a new mask or use ordinary apply');
      yield;
    }
    const results = frames.map(() => ({ values: new Float64Array(n).fill(NaN), coverage: this.coverage.slice(), valid: this.valid.slice() }));
    for (let tile = 0; tile < n; tile += 128) for (let f = 0; f < frames.length; f++) {
      const frame = frames[f]!, output = results[f]!.values;
      for (let row = tile; row < Math.min(n, tile + 128); row++) {
        if (!this.valid[row]) continue;
        let sum = 0;
        for (let j = k.offsets[row]!; j < k.offsets[row + 1]!; j++) {
          const col = k.indices[j]!; if (this.mask[col]) sum += k.weights[j]! * frame[col]!;
        }
        output[row] = sum / this.mass[row]!;
      }
      yield;
    }
    return results;
  }
}
