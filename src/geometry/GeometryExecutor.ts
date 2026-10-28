import { checkBudget, checkFinite, DEFAULT_GEOMETRY_BUDGET, DEFAULT_PLAN_BUDGET, GeometryError } from './GeometryError';

export interface GeometryJobOptions {
  signal?: AbortSignal;
  /** Called before running and before delivery. Bind snapshot, parameter and target revisions here. */
  isCurrent?: () => boolean;
  /** New previews cancel the preceding request on this channel. Committed jobs omit this. */
  previewKey?: string;
}

interface Job {
  iterator: Generator<void, unknown, void>;
  options: GeometryJobOptions;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  cancelled: boolean;
  removeAbort: () => void;
}

/** Cooperative execution of resumable geometry kernels, with bounded retained plan storage. */
export class GeometryExecutor {
  private queue: Job[] = [];
  private running: Job | undefined;
  private disposed = false;
  private pumping = false;
  private previews = new Map<string, Job>();
  private resources = new Map<string, { bytes: number; value: unknown }>();
  private bytes = 0;
  private counter = 0;
  readonly timeSliceMs: number;
  readonly budgetBytes: number;
  readonly planBudgetBytes: number;

  constructor(options: { timeSliceMs?: number; budgetBytes?: number; planBudgetBytes?: number } = {}) {
    this.timeSliceMs = checkFinite(options.timeSliceMs ?? 4, 'timeSliceMs', 0.1);
    this.budgetBytes = options.budgetBytes ?? DEFAULT_GEOMETRY_BUDGET;
    this.planBudgetBytes = options.planBudgetBytes ?? DEFAULT_PLAN_BUDGET;
    checkBudget(this.planBudgetBytes, this.budgetBytes);
  }

  get retainedBytes(): number { return this.bytes; }
  get pendingJobs(): number { return this.queue.length + Number(!!this.running); }

  retain<T>(value: T, bytes: number): string {
    this.checkAlive(); checkBudget(bytes, this.planBudgetBytes); checkBudget(this.bytes + bytes, this.budgetBytes);
    const id = `geometry-resource-${++this.counter}`;
    this.resources.set(id, { bytes, value }); this.bytes += bytes;
    return id;
  }
  resource<T>(id: string): T {
    this.checkAlive(); const resource = this.resources.get(id);
    if (!resource) throw new GeometryError('invalid-domain', `Unknown resource ${id}`);
    return resource.value as T;
  }
  release(id: string): void {
    const resource = this.resources.get(id);
    if (resource) { this.bytes -= resource.bytes; this.resources.delete(id); }
  }

  run<T>(iterator: Generator<void, T, void>, options: GeometryJobOptions = {}): Promise<T> {
    if (this.disposed) return Promise.reject(new GeometryError('disposed', 'Geometry executor is disposed'));
    return new Promise<T>((resolve, reject) => {
      const job: Job = { iterator, options, resolve: value => resolve(value as T), reject, cancelled: false, removeAbort: () => {} };
      if (options.previewKey) {
        const prior = this.previews.get(options.previewKey);
        if (prior) this.cancel(prior);
        this.previews.set(options.previewKey, job);
      }
      const abort = () => this.cancel(job);
      options.signal?.addEventListener('abort', abort, { once: true });
      job.removeAbort = () => options.signal?.removeEventListener('abort', abort);
      if (options.signal?.aborted) job.cancelled = true;
      this.queue.push(job);
      void this.pump();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of this.queue) { job.cancelled = true; job.removeAbort(); job.reject(new GeometryError('disposed', 'Geometry executor is disposed')); }
    this.queue = [];
    if (this.running) this.cancel(this.running);
    this.resources.clear(); this.bytes = 0; this.previews.clear();
  }

  private checkAlive(): void { if (this.disposed) throw new GeometryError('disposed', 'Geometry executor is disposed'); }
  private cancel(job: Job): void {
    job.cancelled = true;
    const queued = this.queue.indexOf(job);
    if (queued >= 0) {
      this.queue.splice(queued, 1); job.removeAbort();
      if (job.options.previewKey && this.previews.get(job.options.previewKey) === job) this.previews.delete(job.options.previewKey);
      job.reject(new GeometryError('cancelled', 'Geometry job cancelled'));
    }
  }
  private validate(job: Job): void {
    this.checkAlive();
    if (job.cancelled || job.options.signal?.aborted) throw new GeometryError('cancelled', 'Geometry job cancelled');
    if (job.options.isCurrent && !job.options.isCurrent()) throw new GeometryError('stale-input', 'Geometry job inputs or target changed');
  }
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.disposed) {
        const job = this.queue.shift()!; this.running = job;
        try {
          let complete = false;
          while (!complete) {
            const start = performance.now();
            do {
              this.validate(job);
              const next = job.iterator.next();
              if (next.done) { this.validate(job); job.resolve(next.value); complete = true; break; }
            } while (performance.now() - start < this.timeSliceMs);
            if (!complete) await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
        } catch (error) {
          try { job.iterator.return(undefined); } catch { /* Preserve original error. */ }
          job.reject(error);
        } finally {
          job.removeAbort();
          if (job.options.previewKey && this.previews.get(job.options.previewKey) === job) this.previews.delete(job.options.previewKey);
          this.running = undefined;
        }
      }
    } finally { this.pumping = false; }
  }
}

/** Consume the identical resumable kernel synchronously. No mid-call cancellation promise. */
export function runGeometrySync<T>(iterator: Generator<void, T, void>): T {
  let next = iterator.next();
  while (!next.done) next = iterator.next();
  return next.value;
}
