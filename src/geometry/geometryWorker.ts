import { PreparedSurfaceSmoothing } from './PreparedSmoothing';
import { GeometryExecutor } from './GeometryExecutor';
import { GeometryError, checkBudget } from './GeometryError';
import { SurfaceDomain, SurfaceMetric } from './SurfaceDomain';
import { buildSurfaceSmoothingPlanSteps, SurfaceSmoothingPlan, smoothSurfaceBatchSteps, smoothSurfaceValuesSteps } from './SurfaceSmoothing';
import { buildSurfaceResamplingPlanSteps, SurfaceResamplingPlan } from './SurfaceResampling';
import { buildRibbonIntegrationPlanSteps, RibbonIntegrationPlan } from './RibbonIntegration';
import { GeodesicIndex } from './GeodesicIndex';
import type { GeometryWorkerRequest, GeometryWorkerCancellation, GeometryWorkerCommand, GeometryWorkerResponse } from './geometryWorkerProtocol';
import { FlatMapChart } from '../flatmap/FlatMapChart';
import { buildFlatMapRasterSteps } from '../flatmap/FlatMapRasterPlan';
import { FlatMapFrame, FlatMapSampler, PreparedFlatMapTile } from '../flatmap/FlatMapSamplingPlan';
import { buildSurfaceReliefSteps } from '../relief/SurfaceRelief';

let executor = new GeometryExecutor({ timeSliceMs: 4 });
type Resource = PreparedSurfaceSmoothing | SurfaceDomain | SurfaceMetric | SurfaceSmoothingPlan | SurfaceResamplingPlan | RibbonIntegrationPlan | GeodesicIndex | FlatMapChart | FlatMapFrame | FlatMapSampler | PreparedFlatMapTile;
const resources = new Map<string, { value: Resource; dependencies: string[]; released: boolean }>();
const controllers = new Map<string, AbortController>();
let configurationLocked = false;
const scope = globalThis as unknown as { addEventListener(type: 'message', handler: (event: MessageEvent<GeometryWorkerRequest | GeometryWorkerCancellation>) => void): void; postMessage(response: GeometryWorkerResponse): void };
function controllerKey(clientId: string, id: number): string { return `${clientId}:${id}`; }
function resource<T extends Resource>(id: string, kind: new (...args: never[]) => T): T {
  const entry = resources.get(id);
  if (!entry || entry.released || !(entry.value instanceof kind)) throw new GeometryError('invalid-domain', 'Unknown, released or wrong-kind worker resource');
  return entry.value;
}
function retain(value: Resource, dependencies: string[] = []): string {
  const handle = executor.retain(value, value.byteLength); resources.set(handle, { value, dependencies, released: false }); return handle;
}
function release(id: string): void {
  const entry = resources.get(id); if (!entry) return; entry.released = true;
  if ([...resources.values()].some(r => r.dependencies.includes(id))) return;
  resources.delete(id); executor.release(id);
  for (const dependency of entry.dependencies) if (resources.get(dependency)?.released) release(dependency);
}
function* execute(command: GeometryWorkerCommand): Generator<void, unknown, void> {
  yield;
  switch (command.type) {
    case 'diagnostics': return { resources: resources.size, retainedBytes: executor.retainedBytes, pendingJobs: Math.max(0, executor.pendingJobs - 1) };
    case 'flatmap-chart': return retain(new FlatMapChart({ ...command.options, domain: resource(command.domain, SurfaceDomain) }), [command.domain]);
    case 'flatmap-frame': return retain(new FlatMapFrame(command.values, command.validity, executor.planBudgetBytes));
    case 'flatmap-sampler': {
      const domain = resource(command.domain, SurfaceDomain), volume = command.volume;
      if (!volume) return retain(new FlatMapSampler({ kind: 'vertex-scalar', domain }), [command.domain]);
      const white = resource(volume.white, SurfaceMetric), pial = resource(volume.pial, SurfaceMetric);
      if (white.domain !== domain || pial.domain !== domain) throw new GeometryError('invalid-domain', 'Volume metrics belong to another domain');
      return retain(new FlatMapSampler({ ...volume, white, pial }), [command.domain, volume.white, volume.pial]);
    }
    case 'flatmap-prepare': {
      const sampler = resource(command.sampler, FlatMapSampler);
      const rasterBytes = command.tile.width * command.tile.height * 56;
      checkBudget(rasterBytes + command.tile.width * command.tile.height * sampler.sampleCount * (sampler.slots * 12 + 1), executor.planBudgetBytes);
      const raster = yield* buildFlatMapRasterSteps(resource(command.chart, FlatMapChart), command.grid, command.tile, executor.planBudgetBytes);
      return retain(yield* sampler.prepareSteps(raster, executor.planBudgetBytes), [command.chart, command.sampler]);
    }
    case 'flatmap-apply': return yield* resource(command.plan, PreparedFlatMapTile).applySteps(resource(command.frame, FlatMapFrame), command.options);
    case 'flatmap-relief': {
      const relief = yield* buildSurfaceReliefSteps(resource(command.chart, FlatMapChart), resource(command.white, SurfaceMetric), resource(command.pial, SurfaceMetric), command.options);
      return { rawHeightMm: relief.copyRawHeightMm(), heightMm: relief.copyHeightMm(), valid: relief.copyValidity(), attributes: relief.copyDisplayAttributes(),
        method: relief.method, mmPerUnit: relief.mmPerUnit, regularizationFwhmMm: relief.regularizationFwhmMm, detrendFwhmMm: relief.detrendFwhmMm };
    }
    case 'domain': return retain(new SurfaceDomain(command.options));
    case 'metric': return retain(new SurfaceMetric(resource(command.domain, SurfaceDomain), command.options), [command.domain]);
    case 'smoothing': return retain(yield* buildSurfaceSmoothingPlanSteps(resource(command.metric, SurfaceMetric), command.options), [command.metric]);
    case 'smooth-batch-stream': return yield* smoothSurfaceBatchSteps(resource(command.metric, SurfaceMetric), command.frames, command.smoothing, command.options);
    case 'smooth-stream': return yield* smoothSurfaceValuesSteps(resource(command.metric, SurfaceMetric), command.values, command.smoothing, command.options);
    case 'resampling': {
      const source = resource(command.source, SurfaceMetric), target = resource(command.target, SurfaceMetric);
      const plan = yield* buildSurfaceResamplingPlanSteps({ source, target, registration: command.registration }, {
        ...command.options, ...(command.sourceAreaMetric ? { sourceAreaMetric: resource(command.sourceAreaMetric, SurfaceMetric) } : {}), ...(command.targetAreaMetric ? { targetAreaMetric: resource(command.targetAreaMetric, SurfaceMetric) } : {})
      });
      return retain(plan, [command.source, command.target, ...[command.sourceAreaMetric, command.targetAreaMetric].filter((x): x is string => !!x)]);
    }
    case 'ribbon': return retain(yield* buildRibbonIntegrationPlanSteps({ domain: resource(command.domain, SurfaceDomain), whiteMetric: resource(command.white, SurfaceMetric), pialMetric: resource(command.pial, SurfaceMetric), volumeGrid: command.grid }, command.options), [command.domain, command.white, command.pial]);
    case 'prepare-smoothing': return retain(yield* resource(command.plan, SurfaceSmoothingPlan).prepareSteps(command.options, command.budgetBytes), [command.plan]);
    case 'apply-batch': return yield* resource(command.prepared, PreparedSurfaceSmoothing).applyBatchSteps(command.frames);
    case 'apply': {
      const entry = resources.get(command.plan);
      const plan = entry?.released ? undefined : entry?.value;
      if (plan instanceof SurfaceSmoothingPlan || plan instanceof RibbonIntegrationPlan) {
        if (command.labels) throw new GeometryError('invalid-domain', 'Label voting requires a resampling plan');
        return yield* plan.applySteps(command.values, command.options);
      }
      if (plan instanceof SurfaceResamplingPlan) return yield* plan.applySteps(command.values, command.options, command.labels);
      throw new GeometryError('invalid-domain', 'Unknown worker plan');
    }
    case 'geodesic': {
      const index = new GeodesicIndex(resource(command.metric, SurfaceMetric), { method: command.method, barrier: command.barrier });
      return yield* index.querySteps(command.seeds, command.radiusMm);
    }
    case 'geodesic-index': return retain(new GeodesicIndex(resource(command.metric, SurfaceMetric), command.options), [command.metric]);
    case 'geodesic-query': return yield* resource(command.index, GeodesicIndex).querySteps(command.seeds, command.radiusMm);
    case 'release': release(command.handle); return;
  }
}
scope.addEventListener('message', event => {
  const message = event.data;
  if (message?.protocol !== 1 || typeof message.clientId !== 'string') return;
  if ('cancel' in message) { controllers.get(controllerKey(message.clientId, message.cancel))?.abort(); return; }
  if (message.command.type === 'configure') {
    try {
      if (configurationLocked || resources.size || controllers.size) throw new GeometryError('invalid-domain', 'Worker limits can only be configured before creating resources or jobs');
      checkBudget(0, message.command.planBudgetBytes);
      const configured = new GeometryExecutor({ budgetBytes: message.command.budgetBytes, planBudgetBytes: message.command.planBudgetBytes });
      executor.dispose(); executor = configured; scope.postMessage({ protocol: 1, clientId: message.clientId, id: message.id, value: undefined });
    } catch (error) { scope.postMessage({ protocol: 1, clientId: message.clientId, id: message.id, error: { code: error instanceof GeometryError ? error.code : 'invalid-shape', message: String(error) } }); }
    return;
  }
  configurationLocked = true;
  const controller = new AbortController(), key = controllerKey(message.clientId, message.id); controllers.set(key, controller);
  void executor.run(execute(message.command), { signal: controller.signal }).then(value => scope.postMessage({ protocol: 1, clientId: message.clientId, id: message.id, value }), error => {
    scope.postMessage({ protocol: 1, clientId: message.clientId, id: message.id, error: { code: error instanceof GeometryError ? error.code : 'invalid-shape', message: error instanceof Error ? error.message : String(error) } });
  }).finally(() => controllers.delete(key));
});
