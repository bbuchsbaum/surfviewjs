import { EventEmitter } from '../EventEmitter';
import { GeometryError, checkBudget } from '../geometry/GeometryError';
import { GeometryExecutor, type GeometryJobOptions } from '../geometry/GeometryExecutor';
import { GeometryWorkerClient } from '../geometry/GeometryWorkerClient';
import { vertexLocation, triangleLocation, type SurfaceLocation } from '../geometry/SurfaceLocation';
import { FlatMapChart } from './FlatMapChart';
import { buildFlatMapRasterSteps, validateRasterGrid, type FlatMapRasterGrid, type FlatMapTile } from './FlatMapRasterPlan';
import { FlatMapFrame, FlatMapSampler, type FlatMapSamples, type FlatMapMissingPolicy, type FlatMapInspection, type PreparedFlatMapTile } from './FlatMapSamplingPlan';
import { FlatMapTileCache } from './FlatMapTileCache';

export interface FlatMapControllerEvents {
  change: { revision: number };
  selection: { location: SurfaceLocation | null; inspection: FlatMapInspection | null };
  progress: { completed: number; total: number };
}
export interface FlatMapControllerDiagnostics {
  rasterBuilds: number;
  planBuilds: number;
  applications: number;
  valueHits: number;
  retainedBytes: number;
  plans: number;
  valueTiles: number;
  disposed: boolean;
}
type Plan = { kind: 'local'; plan: PreparedFlatMapTile; bytes: number } | { kind: 'worker'; handle: string; bytes: number };
export interface FlatMapControllerOptions {
  worker?: GeometryWorkerClient;
  executor?: GeometryExecutor;
  /** Total retained plan and numeric tile cache budget. Default 64 MiB. */
  budgetBytes?: number;
  tileSize?: number;
}

/** Owns revisions and caches; geometry, sampling and presentation remain separate. */
export class FlatMapController extends EventEmitter<FlatMapControllerEvents> {
  readonly tileSize: number;
  readonly budgetBytes: number;
  private readonly executor: GeometryExecutor;
  private readonly ownsExecutor: boolean;
  private readonly worker: GeometryWorkerClient | undefined;
  private readonly plans: FlatMapTileCache<Plan>;
  private readonly values: FlatMapTileCache<FlatMapSamples>;
  private sampler: FlatMapSampler | undefined;
  private frame: FlatMapFrame | undefined;
  private policy: FlatMapMissingPolicy = {};
  private generation = 0;
  private abort: AbortController | undefined;
  private disposed = false;
  private selection: SurfaceLocation | null = null;
  private remoteBase: Promise<{ domain: string; chart: string }> | undefined;
  private remoteSampler: Promise<string> | undefined;
  private remoteFrame: Promise<string> | undefined;
  private samplerEpoch = 0;
  private frameHandle: string | undefined;
  private readonly handles = new Set<string>();
  private readonly samplerHandles = new Set<string>();
  private counts = { rasterBuilds: 0, planBuilds: 0, applications: 0, valueHits: 0 };

  constructor(readonly chart: FlatMapChart, options: FlatMapControllerOptions = {}) {
    super();
    this.tileSize = options.tileSize ?? 128;
    if (!Number.isInteger(this.tileSize) || this.tileSize < 8 || this.tileSize > 256) throw new GeometryError('invalid-shape', 'Tile size must be 8–256');
    this.budgetBytes = options.budgetBytes ?? 64 * 1024 * 1024; checkBudget(0, this.budgetBytes);
    this.executor = options.executor ?? new GeometryExecutor(); this.ownsExecutor = !options.executor; this.worker = options.worker;
    this.plans = new FlatMapTileCache(Math.floor(this.budgetBytes * 0.75), plan => { if (plan.kind === 'worker') this.release(plan.handle); });
    this.values = new FlatMapTileCache(Math.floor(this.budgetBytes * 0.25));
  }

  get revision(): number { return this.generation; }
  snapshot(): { chart: FlatMapChart; sampler: FlatMapSampler; frame: FlatMapFrame; policy: FlatMapMissingPolicy } {
    this.checkAlive();
    if (!this.sampler || !this.frame) throw new GeometryError('invalid-domain', 'Set a quantitative source first');
    return { chart: this.chart, sampler: this.sampler, frame: this.frame, policy: { ...this.policy } };
  }
  get diagnostics(): Readonly<FlatMapControllerDiagnostics> {
    return { ...this.counts, retainedBytes: this.plans.byteLength + this.values.byteLength, plans: this.plans.size, valueTiles: this.values.size, disposed: this.disposed };
  }

  setSource(sampler: FlatMapSampler, frame: FlatMapFrame, policy: FlatMapMissingPolicy = {}): void {
    this.checkAlive();
    if (sampler.domain !== this.chart.domain || frame.length !== sampler.sourceCount) throw new GeometryError('invalid-domain', 'Source must match chart domain and frame shape');
    // Validate the policy before invalidating a usable current source.
    if ((policy.missing !== undefined && policy.missing !== 'strict' && policy.missing !== 'renormalize') ||
        (policy.minCoverage !== undefined && (!Number.isFinite(policy.minCoverage) || policy.minCoverage < 0 || policy.minCoverage > 1))) throw new GeometryError('invalid-shape', 'Invalid missingness policy');
    this.cancel(); this.generation++;
    const changedSampler = this.sampler !== sampler;
    if (changedSampler) {
      this.plans.clear();
      this.samplerEpoch++;
      for (const handle of this.samplerHandles) this.release(handle);
      this.samplerHandles.clear();
      this.remoteSampler = undefined;
    }
    this.values.clear();
    // Worker frames are replaced once per source update, never once per tile.
    if (this.worker) {
      if (this.frameHandle) this.release(this.frameHandle);
      this.frameHandle = undefined;
      this.remoteFrame = undefined;
      // Geometry handles survive frame changes, including in-flight registration.
    }
    this.sampler = sampler; this.frame = frame; this.policy = { ...policy };
    this.emit('change', { revision: this.generation });
    if (this.selection) this.emit('selection', { location: this.selection, inspection: this.inspect(this.selection) });
  }

  inspect(location: SurfaceLocation): FlatMapInspection {
    this.checkAlive();
    if (!this.sampler || !this.frame) throw new GeometryError('invalid-domain', 'Set a quantitative source first');
    return this.sampler.inspect(location, this.frame, this.policy);
  }
  select(location: SurfaceLocation | null): void {
    this.checkAlive();
    if (location && location.domain !== this.chart.domain) throw new GeometryError('invalid-domain', 'Selection domain differs');
    this.selection = location === null ? null : location.kind === 'vertex' ? vertexLocation(this.chart.domain, location.vertex) : triangleLocation(this.chart.domain, location.face, location.weights);
    this.emit('selection', { location: this.selection, inspection: this.selection ? this.inspect(this.selection) : null });
  }
  getSelection(): SurfaceLocation | null { return this.selection; }
  cancel(): void { this.abort?.abort(); this.abort = undefined; }

  /** Streams exact requested tiles. A superseding render cancels the previous one. */
  async render(grid: FlatMapRasterGrid, deliver: (tile: FlatMapTile, values: FlatMapSamples) => void, signal?: AbortSignal): Promise<void> {
    this.checkAlive(); validateRasterGrid(grid);
    if (!this.sampler || !this.frame) throw new GeometryError('invalid-domain', 'Set a quantitative source first');
    this.cancel(); const abort = new AbortController(); this.abort = abort;
    const cancel = () => abort.abort(); signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) abort.abort();
    const sampler = this.sampler, frame = this.frame, policy = { ...this.policy }, generation = this.generation;
    const snapshot: FlatMapRasterGrid = { ...grid, bounds: [...grid.bounds] };
    const job: GeometryJobOptions = { signal: abort.signal, isCurrent: () => !this.disposed && this.generation === generation };
    const total = Math.ceil(snapshot.width / this.tileSize) * Math.ceil(snapshot.height / this.tileSize);
    let completed = 0;
    try {
      const remote = this.worker ? await this.workerSource(sampler, frame, generation, job) : undefined;
      for (let y = 0; y < snapshot.height; y += this.tileSize) for (let x = 0; x < snapshot.width; x += this.tileSize) {
        this.assertCurrent(job);
        const tile = { x, y, width: Math.min(this.tileSize, snapshot.width - x), height: Math.min(this.tileSize, snapshot.height - y) };
        const key = JSON.stringify([this.chart.snapshotId, sampler.revision, snapshot, tile]);
        const valueKey = `${key}:${frame.revision}:${policy.missing ?? 'strict'}:${policy.minCoverage ?? 1}`;
        let values = this.values.get(valueKey);
        if (values) this.counts.valueHits++;
        else {
          let plan = this.plans.get(key);
          if (!plan) {
            const pixels = tile.width * tile.height;
            const bytes = pixels * sampler.sampleCount * (sampler.slots * 12 + 1) + pixels;
            checkBudget(bytes, this.plans.budgetBytes);
            if (this.worker && remote) {
              const handle = await this.worker.prepareFlatMapTile(remote.chart, remote.sampler, snapshot, tile, job);
              this.assertCurrent(job); this.handles.add(handle);
              plan = { kind: 'worker', handle, bytes };
            } else {
              const raster = await this.executor.run(buildFlatMapRasterSteps(this.chart, snapshot, tile), job);
              const prepared = await this.executor.run(sampler.prepareSteps(raster, this.plans.budgetBytes), job);
              plan = { kind: 'local', plan: prepared, bytes: prepared.byteLength };
            }
            this.counts.rasterBuilds++; this.counts.planBuilds++; this.plans.set(key, plan, plan.bytes);
          }
          values = plan.kind === 'worker' && this.worker && remote
            ? await this.worker.applyFlatMapTile(plan.handle, remote.frame, policy, job)
            : plan.kind === 'local' ? await this.executor.run(plan.plan.applySteps(frame, policy), job)
              : (() => { throw new GeometryError('invalid-domain', 'Unavailable tile execution backend'); })();
          this.counts.applications++;
          this.assertCurrent(job); this.values.set(valueKey, values, values.byteLength);
        }
        this.assertCurrent(job);
        // The cache owns its arrays. A consumer can keep or mutate the delivered tile safely.
        deliver(tile, { values: values.values.slice(), geometricCoverage: values.geometricCoverage.slice(),
          coverage: values.coverage.slice(), valid: values.valid.slice(), status: values.status.slice(), byteLength: values.byteLength });
        this.emit('progress', { completed: ++completed, total });
      }
    } finally { signal?.removeEventListener('abort', cancel); if (this.abort === abort) this.abort = undefined; }
  }

  private async workerSource(sampler: FlatMapSampler, frame: FlatMapFrame, generation: number, job: GeometryJobOptions): Promise<{ domain: string; chart: string; sampler: string; frame: string }> {
    const worker = this.worker!;
    // Registrations belong to immutable inputs, not to an individual render's
    // cancellation signal. A replacement render can safely await the same work.
    // Each attempt rolls back partial resources on failure or input replacement.
    this.remoteBase ??= (async () => {
      const owned: string[] = [];
      try {
        const domain = this.retain(await worker.registerDomain(this.chart.domain), owned);
        const chart = this.retain(await worker.registerFlatMapChart(domain, this.chart), owned);
        return { domain, chart };
      } catch (error) { owned.forEach(handle => this.release(handle)); throw error; }
    })().catch(error => { this.remoteBase = undefined; throw error; });
    const base = await this.remoteBase;
    this.assertCurrent(job);
    const epoch = this.samplerEpoch;
    this.remoteSampler ??= (async () => {
      const owned: string[] = [];
      const retain = (handle: string) => this.retain(handle, owned, () => epoch === this.samplerEpoch);
      try {
        const source = sampler.describe();
        let handle: string;
        if (source.kind === 'vertex-scalar') handle = retain(await worker.registerFlatMapSampler(base.domain));
        else {
          const white = retain(await worker.registerMetric(base.domain, source.white));
          const pial = retain(await worker.registerMetric(base.domain, source.pial));
          handle = retain(await worker.registerFlatMapSampler(base.domain, { ...source, white, pial }));
        }
        owned.forEach(resource => this.samplerHandles.add(resource));
        return handle;
      } catch (error) {
        owned.forEach(handle => this.release(handle));
        if (epoch === this.samplerEpoch) this.remoteSampler = undefined;
        throw error;
      }
    })();
    const samplerHandle = await this.remoteSampler;
    this.assertCurrent(job);
    this.remoteFrame ??= worker.registerFlatMapFrame(frame).then(handle => {
      this.frameHandle = this.retain(handle, [], () => generation === this.generation);
      return handle;
    }).catch(error => {
      if (generation === this.generation) this.remoteFrame = undefined;
      throw error;
    });
    const frameHandle = await this.remoteFrame;
    this.assertCurrent(job);
    return { ...base, sampler: samplerHandle, frame: frameHandle };
  }

  private retain(handle: string, owned: string[], current: () => boolean = () => true): string {
    if (this.disposed || !current()) {
      void this.worker!.release(handle).catch(() => {});
      throw new GeometryError('stale-input', 'Resource registration superseded');
    }
    this.handles.add(handle);
    owned.push(handle);
    return handle;
  }

  private assertCurrent(job: GeometryJobOptions): void {
    this.checkAlive();
    if (job.signal?.aborted) throw new GeometryError('cancelled', 'Flatmap render cancelled');
    if (!job.isCurrent?.()) throw new GeometryError('stale-input', 'Flatmap inputs changed');
  }
  private checkAlive(): void { if (this.disposed) throw new GeometryError('disposed', 'Flatmap controller disposed'); }
  private release(handle: string): void { this.handles.delete(handle); void this.worker?.release(handle).catch(() => {}); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.plans.clear(); this.values.clear();
    for (const handle of this.handles) this.release(handle);
    this.samplerHandles.clear(); if (this.ownsExecutor) this.executor.dispose(); this.removeAllListeners();
  }
}
