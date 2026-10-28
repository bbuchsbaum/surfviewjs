import { checkBudget, checkFraction, checkIndex, checkMask, DEFAULT_PLAN_BUDGET, GeometryError } from './GeometryError';
import { runGeometrySync } from './GeometryExecutor';

export interface SparseWeights {
  offsets: ArrayLike<number>;
  indices: ArrayLike<number>;
  weights: ArrayLike<number>;
  supportCoverage?: ArrayLike<number>;
}
export interface ApplySurfaceOptions {
  validity?: Uint8Array;
  missing?: 'strict' | 'renormalize';
  minCoverage?: number;
}
export interface SurfaceComputationResult {
  values: Float64Array;
  coverage: Float64Array;
  valid: Uint8Array;
}

const OWNED_CSR = Symbol('owned-csr');

/** Internal, owned CSR kernel. Public plans expose copies, never this storage. */
export class SparsePlan {
  readonly offsets: Uint32Array;
  readonly indices: Uint32Array;
  readonly weights: Float64Array;
  readonly supportCoverage: Float64Array;
  readonly byteLength: number;
  constructor(readonly sourceCount: number, readonly targetCount: number, input: SparseWeights, budgetBytes = DEFAULT_PLAN_BUDGET, ownership?: symbol) {
    if (!Number.isSafeInteger(sourceCount) || sourceCount < 1 || !Number.isSafeInteger(targetCount) || targetCount < 1 || input.offsets.length !== targetCount + 1 || input.indices.length !== input.weights.length) {
      throw new GeometryError('invalid-shape', 'Invalid sparse plan dimensions');
    }
    this.byteLength = (targetCount + 1) * 4 + targetCount * 8 + input.indices.length * 12;
    checkBudget(this.byteLength * (ownership === OWNED_CSR ? 1 : 2), budgetBytes);
    if (input.offsets[0] !== 0 || input.offsets[targetCount] !== input.indices.length) throw new GeometryError('invalid-weights', 'CSR offsets must span all entries');
    for (let row = 0; row < targetCount; row++) {
      const start = input.offsets[row]!, end = input.offsets[row + 1]!;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > input.indices.length) throw new GeometryError('invalid-weights', 'Invalid CSR offsets');
      let sum = 0, previous = -1;
      for (let j = start; j < end; j++) {
        const index = input.indices[j]!, weight = input.weights[j]!;
        checkIndex(index, sourceCount, 'source index');
        if (index <= previous || !Number.isFinite(weight) || weight <= 0) throw new GeometryError('invalid-weights', 'Rows require sorted unique indices and positive finite weights');
        previous = index; sum += weight;
      }
      if (end > start && Math.abs(sum - 1) > 1e-10) throw new GeometryError('invalid-weights', 'Nonempty rows must sum to one');
    }
    if (input.supportCoverage && input.supportCoverage.length !== targetCount) throw new GeometryError('invalid-shape', 'Coverage must match target count');
    this.offsets = ownership === OWNED_CSR ? input.offsets as Uint32Array : Uint32Array.from(input.offsets); this.indices = ownership === OWNED_CSR ? input.indices as Uint32Array : Uint32Array.from(input.indices); this.weights = ownership === OWNED_CSR ? input.weights as Float64Array : Float64Array.from(input.weights);
    this.supportCoverage = input.supportCoverage ? Float64Array.from(input.supportCoverage) : Float64Array.from({ length: targetCount }, (_, i) => this.offsets[i] === this.offsets[i + 1] ? 0 : 1);
    this.supportCoverage.forEach(x => checkFraction(x, 'supportCoverage'));
    for (let row = 0; row < targetCount; row++) if (this.offsets[row] === this.offsets[row + 1] && this.supportCoverage[row] !== 0) throw new GeometryError('invalid-weights', 'Empty rows cannot have support');
  }
  copyWeights(): Required<SparseWeights> {
    return { offsets: this.offsets.slice(), indices: this.indices.slice(), weights: this.weights.slice(), supportCoverage: this.supportCoverage.slice() };
  }
  apply(values: ArrayLike<number>, options: ApplySurfaceOptions = {}, labels = false, output?: SurfaceComputationResult): SurfaceComputationResult {
    if (output) validateOutput(output, this.targetCount, values, options.validity);
    return runGeometrySync(this.computeSteps(values, options, labels, output));
  }
  /** Capture a frame immediately, before a cooperative executor can queue it. */
  applySteps(values: ArrayLike<number>, options: ApplySurfaceOptions = {}, labels = false): Generator<void, SurfaceComputationResult, void> {
    if (values.length !== this.sourceCount) throw new GeometryError('invalid-shape', 'Input values must match source count');
    checkMask(options.validity, this.sourceCount);
    return this.computeSteps(Float64Array.from(values), { ...options, ...(options.validity ? { validity: options.validity.slice() } : {}) }, labels);
  }
  private *computeSteps(values: ArrayLike<number>, options: ApplySurfaceOptions, labels: boolean, reuse?: SurfaceComputationResult): Generator<void, SurfaceComputationResult, void> {
    if (values.length !== this.sourceCount) throw new GeometryError('invalid-shape', 'Input values must match source count');
    checkMask(options.validity, this.sourceCount);
    if (options.missing !== undefined && options.missing !== 'strict' && options.missing !== 'renormalize') throw new GeometryError('invalid-shape', 'Unknown missing-data policy');
    const min = checkFraction(options.minCoverage ?? (options.missing === 'renormalize' ? 0 : 1), 'minCoverage');
    const output = reuse?.values ?? new Float64Array(this.targetCount); output.fill(NaN);
    const coverage = reuse?.coverage ?? new Float64Array(this.targetCount), valid = reuse?.valid ?? new Uint8Array(this.targetCount); valid.fill(0);
    for (let row = 0; row < this.targetCount; row++) {
      let mass = 0, sum = 0, allValid = true;
      const votes = labels ? new Map<number, number>() : undefined;
      for (let j = this.offsets[row]!; j < this.offsets[row + 1]!; j++) {
        const col = this.indices[j]!, x = values[col]!, w = this.weights[j]!;
        if (!Number.isFinite(x) || (options.validity && !options.validity[col])) { allValid = false; continue; }
        if (labels && (!Number.isSafeInteger(x) || x < -2147483648 || x > 4294967295)) throw new GeometryError('invalid-shape', 'Labels must be signed/unsigned 32-bit integers');
        mass += w;
        if (votes) votes.set(x, (votes.get(x) ?? 0) + w); else sum += w * x;
      }
      coverage[row] = Math.min(1, this.supportCoverage[row]! * mass);
      if (mass > 0 && coverage[row]! + 1e-12 >= min && (options.missing === 'renormalize' || allValid)) {
        valid[row] = 1;
        if (votes) {
          let best = Infinity, bestWeight = -1;
          for (const [label, weight] of votes) if (weight > bestWeight || (weight === bestWeight && label < best)) { best = label; bestWeight = weight; }
          output[row] = best;
        } else output[row] = sum / mass;
      }
      if (row % 128 === 127) yield;
    }
    return { values: output, coverage, valid };
  }
}

function validateOutput(output: SurfaceComputationResult, count: number, values: ArrayLike<number>, validity?: Uint8Array): void {
  const arrays = [output.values, output.coverage, output.valid];
  if (!(output.values instanceof Float64Array) || !(output.coverage instanceof Float64Array) || !(output.valid instanceof Uint8Array) || arrays.some(a => a.length !== count)) throw new GeometryError('invalid-shape', 'Output arrays have wrong type or size');
  const inputs: ArrayBufferView[] = [];
  if (ArrayBuffer.isView(values)) inputs.push(values);
  if (validity) inputs.push(validity);
  for (let i = 0; i < arrays.length; i++) for (const other of [...inputs, ...arrays.slice(i + 1)]) {
    const a = arrays[i]!;
    if (a.buffer === other.buffer && a.byteOffset < other.byteOffset + other.byteLength && other.byteOffset < a.byteOffset + a.byteLength) throw new GeometryError('invalid-shape', 'Input and output buffers must not overlap');
  }
}

/** Coalesce, sort and normalize a row before it enters the validated kernel. */
export function appendSparseRow(row: Map<number, number>, indices: number[], weights: number[]): void {
  let sum = 0; for (const w of row.values()) sum += w;
  if (!(sum > 0)) return;
  for (const col of [...row.keys()].sort((a, b) => a - b)) { const w = row.get(col)!; if (w > 0) { indices.push(col); weights.push(w / sum); } }
}

/** @internal Transfer freshly allocated, unaliased constructor buffers into the validated kernel. */
export function ownSparsePlan(sourceCount: number, targetCount: number, offsets: Uint32Array, indices: Uint32Array, weights: Float64Array, budgetBytes: number): SparsePlan {
  return new SparsePlan(sourceCount, targetCount, { offsets, indices, weights }, budgetBytes, OWNED_CSR);
}
