import { GeometryError, checkBudget } from './GeometryError';
import type { GeometryJobOptions } from './GeometryExecutor';
import type { GeometryWorkerCommand, GeometryWorkerResponse } from './geometryWorkerProtocol';
import type { SurfaceDomain, SurfaceMetric } from './SurfaceDomain';
import type { SurfaceSmoothingOptions, SurfaceSmoothingBatchOptions } from './SurfaceSmoothing';
import type { ApplySurfaceOptions, SurfaceComputationResult } from './SparsePlan';
import type { RibbonIntegrationResult } from './RibbonIntegration';
import type { GeodesicOptions, GeodesicNeighborhood } from './GeodesicIndex';

export type GeometryWorker = Pick<Worker, 'postMessage' | 'addEventListener' | 'removeEventListener' | 'terminate'>;
interface Pending { resolve(value: unknown): void; reject(error: unknown): void; options: GeometryJobOptions; cleanup(): void }
function createClientId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `geometry-client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
/** Explicit worker ownership. Inputs are structured-cloned, never transferred from renderer buffers. */
export class GeometryWorkerClient {
  private worker: GeometryWorker;
  private owned: boolean;
  private pending = new Map<number, Pending>();
  private previews = new Map<string, number>();
  private sequence = 0;
  private disposed = false;
  private handles = new Set<string>();
  private domains = new Map<string, SurfaceDomain>();
  private awaiting = new Set<number>();
  private ready: Promise<void> | undefined;
  private readonly clientId = createClientId();
  private failureError: GeometryError | undefined;
  constructor(options: { workerFactory: () => GeometryWorker; ownsWorker?: boolean; limits?: { budgetBytes: number; planBudgetBytes: number } }) {
    if (options.limits) {
      if (options.ownsWorker === false) throw new GeometryError('invalid-domain', 'Only owned workers can be configured');
      checkBudget(0, options.limits.planBudgetBytes);
      checkBudget(options.limits.planBudgetBytes, options.limits.budgetBytes);
    }
    this.worker = options.workerFactory(); this.owned = options.ownsWorker ?? true;
    this.worker.addEventListener('message', this.receive);
    this.worker.addEventListener('error', this.failure);
    if (options.limits) {
      this.ready = this.postRequest<void>({ type: 'configure', ...options.limits });
      void this.ready.then(() => { this.ready = undefined; }, () => {});
    }
  }
  private receive = (event: MessageEvent<GeometryWorkerResponse>): void => {
    const response = event.data;
    if (response?.protocol !== 1 || response.clientId !== this.clientId) return;
    this.awaiting.delete(response.id);
    const pending = this.pending.get(response.id);
    const handle = 'value' in response && typeof response.value === 'string' && response.value.startsWith('geometry-resource-') ? response.value : undefined;
    if (!pending) { if (handle) this.dropHandle(handle); if (this.disposed && !this.awaiting.size) this.detach(); return; }
    this.pending.delete(response.id); pending.cleanup();
    if ('error' in response) pending.reject(new GeometryError(response.error.code, response.error.message));
    else if (pending.options.isCurrent && !pending.options.isCurrent()) { if (handle) this.dropHandle(handle); pending.reject(new GeometryError('stale-input', 'Worker result belongs to stale inputs')); }
    else { if (handle) this.handles.add(handle); pending.resolve(response.value); }
  };
  private failure = (): void => {
    if (this.failureError) return;
    this.failureError = new GeometryError('disposed', 'Geometry worker failed');
    this.disposed = true;
    this.awaiting.clear();
    this.rejectAll(this.failureError);
    this.handles.clear(); this.domains.clear();
    if (this.owned) this.worker.terminate();
    this.detach();
  };
  private rejectAll(error: GeometryError): void { for (const p of this.pending.values()) { p.cleanup(); p.reject(error); } this.pending.clear(); this.previews.clear(); }
  request<T = unknown>(command: GeometryWorkerCommand, options: GeometryJobOptions = {}): Promise<T> {
    if (this.failureError) return Promise.reject(this.failureError);
    if (command.type === 'configure' && !this.owned) return Promise.reject(new GeometryError('invalid-domain', 'Only owned workers can be configured'));
    if (!this.ready) return this.postRequest<T>(command, options);
    // Initialization may queue callers; preserve the same submission-time snapshot.
    try {
      const snapshot = structuredClone(command);
      return this.ready.then(() => this.postRequest<T>(snapshot, options));
    } catch (error) { return Promise.reject(error); }
  }
  private postRequest<T = unknown>(command: GeometryWorkerCommand, options: GeometryJobOptions = {}): Promise<T> {
    if (this.failureError) return Promise.reject(this.failureError);
    if (this.disposed) return Promise.reject(new GeometryError('disposed', 'Geometry worker client is disposed'));
    if (options.signal?.aborted) return Promise.reject(new GeometryError('cancelled', 'Geometry job cancelled'));
    if (options.isCurrent && !options.isCurrent()) return Promise.reject(new GeometryError('stale-input', 'Geometry inputs are stale'));
    const id = ++this.sequence;
    if (options.previewKey) { const prior = this.previews.get(options.previewKey); if (prior !== undefined) this.cancel(prior); this.previews.set(options.previewKey, id); }
    return new Promise<T>((resolve, reject) => {
      const abort = () => this.cancel(id);
      const cleanup = () => { options.signal?.removeEventListener('abort', abort); if (options.previewKey && this.previews.get(options.previewKey) === id) this.previews.delete(options.previewKey); };
      this.pending.set(id, { resolve: value => resolve(value as T), reject, options, cleanup });
      this.awaiting.add(id);
      options.signal?.addEventListener('abort', abort, { once: true });
      try { this.worker.postMessage({ protocol: 1, clientId: this.clientId, id, command }); }
      catch (error) { this.awaiting.delete(id); this.pending.delete(id); cleanup(); reject(error); }
    });
  }
  async registerDomain(domain: SurfaceDomain, options?: GeometryJobOptions): Promise<string> {
    const handle = await this.request<string>({ type: 'domain', options: { id: domain.id, structure: domain.structure, vertexCount: domain.vertexCount, faces: domain.copyFaces() } }, options);
    this.domains.set(handle, domain); return handle;
  }
  registerMetric(domain: string, metric: SurfaceMetric, options?: GeometryJobOptions): Promise<string> {
    if (this.domains.get(domain) !== metric.domain) return Promise.reject(new GeometryError('invalid-domain', 'Metric does not belong to the registered domain handle'));
    return this.request({ type: 'metric', domain, options: { positions: metric.copyPositions(), frame: metric.frame, units: metric.units } }, options);
  }
  buildSmoothing(metric: string, options: SurfaceSmoothingOptions, job?: GeometryJobOptions): Promise<string> { return this.request({ type: 'smoothing', metric, options }, job); }
  buildGeodesic(metric: string, options: GeodesicOptions = {}, job?: GeometryJobOptions): Promise<string> { return this.request({ type: 'geodesic-index', metric, options }, job); }
  withinRadius(index: string, seeds: Uint32Array, radiusMm: number, job?: GeometryJobOptions): Promise<GeodesicNeighborhood> { return this.request({ type: 'geodesic-query', index, seeds, radiusMm }, job); }
  apply(plan: string, values: ArrayLike<number>, options: ApplySurfaceOptions = {}, job?: GeometryJobOptions): Promise<SurfaceComputationResult | RibbonIntegrationResult> { return this.request({ type: 'apply', plan, values: Float64Array.from(values), options }, job); }
  smoothBatch(metric: string, frames: readonly ArrayLike<number>[], smoothing: SurfaceSmoothingOptions, options: SurfaceSmoothingBatchOptions = {}, job?: GeometryJobOptions): Promise<SurfaceComputationResult[]> {
    if (!frames.length || frames.length > 16) return Promise.reject(new GeometryError('invalid-shape', 'Supply 1 to 16 frames'));
    return this.request({ type: 'smooth-batch-stream', metric, frames: frames.map(frame => Float64Array.from(frame)), smoothing, options }, job);
  }
  prepareSmoothing(plan: string, options: ApplySurfaceOptions = {}, budgetBytes?: number, job?: GeometryJobOptions): Promise<string> { return this.request({ type: 'prepare-smoothing', plan, options: { ...options, ...(options.validity ? { validity: options.validity.slice() } : {}) }, ...(budgetBytes === undefined ? {} : { budgetBytes }) }, job); }
  applyBatch(prepared: string, frames: readonly ArrayLike<number>[], job?: GeometryJobOptions): Promise<SurfaceComputationResult[]> {
    if (!frames.length || frames.length > 16) return Promise.reject(new GeometryError('invalid-shape', 'A batch requires 1 to 16 frames'));
    return this.request({ type: 'apply-batch', prepared, frames: frames.map(frame => Float64Array.from(frame)) }, job);
  }
  release(handle: string): Promise<void> { this.handles.delete(handle); this.domains.delete(handle); return this.request({ type: 'release', handle }); }
  private dropHandle(handle: string): void {
    this.handles.delete(handle);
    if (!this.failureError) this.worker.postMessage({ protocol: 1, clientId: this.clientId, id: ++this.sequence, command: { type: 'release', handle } });
  }
  private cancel(id: number): void {
    const pending = this.pending.get(id); if (!pending) return;
    this.worker.postMessage({ protocol: 1, clientId: this.clientId, cancel: id }); this.pending.delete(id); pending.cleanup(); pending.reject(new GeometryError('cancelled', 'Geometry job cancelled'));
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const id of this.pending.keys()) if (!this.failureError) this.worker.postMessage({ protocol: 1, clientId: this.clientId, cancel: id });
    if (!this.owned) for (const handle of this.handles) this.dropHandle(handle);
    this.handles.clear(); this.domains.clear();
    this.rejectAll(new GeometryError('disposed', 'Geometry worker client is disposed'));
    if (this.owned) { this.awaiting.clear(); this.worker.terminate(); }
    if (!this.awaiting.size) this.detach();
  }
  private detach(): void { this.worker.removeEventListener('message', this.receive); this.worker.removeEventListener('error', this.failure); }
}
