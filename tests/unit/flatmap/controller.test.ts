import { it, expect, vi } from 'vitest';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import type { GeometryWorkerClient } from '../../../src/geometry/GeometryWorkerClient';
import type { GeometryJobOptions } from '../../../src/geometry/GeometryExecutor';
import type { FlatMapView } from '../../../src/FlatMapView';
import type { FlatMapRenderer } from '../../../src/flatmap/FlatMapRenderer';
import { FlatMapViewAttachment } from '../../../src/flatmap/FlatMapViewAttachment';
import { FlatMapChart } from '../../../src/flatmap/FlatMapChart';
import { FlatMapController } from '../../../src/flatmap/FlatMapController';
import { FlatMapFrame, FlatMapSampler } from '../../../src/flatmap/FlatMapSamplingPlan';

function fixture() {
  const domain = new SurfaceDomain({ id: 'test', structure: 'left', vertexCount: 3, faces: [0, 1, 2] });
  const chart = new FlatMapChart({ domain, coordinates: [0, 0, 1, 0, 0, 1], faces: [0, 1, 2], anatomicalVertices: [0, 1, 2], anatomicalFaces: [0], units: 'mm' });
  const controller = new FlatMapController(chart, { tileSize: 8 }), sampler = new FlatMapSampler({ kind: 'vertex-scalar', domain });
  controller.setSource(sampler, new FlatMapFrame([1, 1, 1]));
  return { chart, controller, sampler, grid: { bounds: chart.bounds, width: 16, height: 16 } };
}
it('reuses geometry across frames, caches values, and releases owned resources', async () => {
  const { controller, sampler, grid } = fixture();
  await controller.render(grid, () => {}); const builds = controller.diagnostics.planBuilds;
  await controller.render(grid, () => {}); expect(controller.diagnostics.valueHits).toBe(4);
  controller.setSource(sampler, new FlatMapFrame([2, 2, 2]));
  await controller.render(grid, (_, s) => s.values.forEach((v, i) => { if (s.valid[i]) expect(v).toBeCloseTo(2); }));
  expect(controller.diagnostics.planBuilds).toBe(builds);
  controller.dispose(); expect(controller.diagnostics.retainedBytes).toBe(0);
  await expect(controller.render(grid, () => {})).rejects.toThrow(/disposed/);
});
it('cancels superseded work without committing stale tiles', async () => {
  const { controller, sampler, grid } = fixture(); let commits = 0;
  const first = controller.render({ ...grid, width: 512, height: 512 }, () => { commits++; });
  const rejection = expect(first).rejects.toThrow(/cancelled|changed/);
  controller.setSource(sampler, new FlatMapFrame([3, 3, 3]));
  await rejection; expect(commits).toBe(0);
  await controller.render(grid, () => {}); controller.dispose();
});

it('delivers owned arrays without exposing cached numeric storage', async () => {
  const { controller, grid } = fixture();
  await controller.render(grid, (_, values) => { values.values.fill(99); values.valid.fill(0); });
  let valid = 0;
  await controller.render(grid, (_, values) => values.values.forEach((v, i) => { if (values.valid[i]) { expect(v).toBeCloseTo(1); valid++; } }));
  expect(valid).toBeGreaterThan(100); controller.dispose();
});

it('snapshots grid dimensions before asynchronous execution', async () => {
  const { controller, grid } = fixture();
  let pixels = 0;
  const rendered = controller.render(grid, tile => { pixels += tile.width * tile.height; });
  grid.width = 1;
  grid.height = 1;
  await rendered;
  expect(pixels).toBe(256);
  controller.dispose();
});

it('detaching a completed view does not cancel another view using the controller', async () => {
  const { controller, chart } = fixture();
  const view = () => ({ vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: chart.copyFaces(),
    attachQuantitative() {}, detachQuantitative() {}, render() {} }) as unknown as FlatMapView;
  const renderer = { setGrid() {}, updateTile() {} } as unknown as FlatMapRenderer;
  const first = new FlatMapViewAttachment(view(), controller, renderer);
  const second = new FlatMapViewAttachment(view(), controller, renderer);
  await first.prepare(16);
  const preparation = second.prepare(32);
  first.dispose();
  await expect(preparation).resolves.toBeUndefined();
  second.dispose();
  expect(controller.diagnostics.disposed).toBe(false);
  controller.dispose();
});

it('shares pending registration after cancellation and retains geometry across frames', async () => {
  const { controller: unused, chart, grid } = fixture();
  unused.dispose();
  const handles = new Set<string>();
  let serial = 0;
  const allocate = () => { const id = `resource-${++serial}`; handles.add(id); return id; };
  let begin!: () => void, resume!: () => void;
  const began = new Promise<void>(resolve => { begin = resolve; });
  const resumed = new Promise<void>(resolve => { resume = resolve; });
  const worker = {
    registerDomain: async () => allocate(),
    registerFlatMapChart: async () => allocate(),
    registerMetric: vi.fn(async () => allocate()),
    registerFlatMapSampler: vi.fn(async (_domain: string, _source?: unknown, job?: GeometryJobOptions) => {
      begin();
      await resumed;
      if (job?.signal?.aborted) throw new Error('cancelled');
      return allocate();
    }),
    registerFlatMapFrame: vi.fn(async () => allocate()),
    prepareFlatMapTile: async () => allocate(),
    applyFlatMapTile: async () => ({ values: new Float64Array(64), coverage: new Float64Array(64),
      geometricCoverage: new Float64Array(64), valid: new Uint8Array(64), status: new Uint8Array(64), byteLength: 1664 }),
    release: async (handle: string) => { handles.delete(handle); }
  };
  const metric = (z: number) => new SurfaceMetric(chart.domain, { frame: 'test', units: 'mm', positions: [0, 0, z, 1, 0, z, 0, 1, z] });
  const sampler = new FlatMapSampler({ kind: 'volume-scalar', white: metric(0), pial: metric(1),
    frame: 'test', dims: [2, 2, 2], voxelToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], depth: { fraction: .5 } });
  const controller = new FlatMapController(chart, { worker: worker as unknown as GeometryWorkerClient, tileSize: 8 });
  controller.setSource(sampler, new FlatMapFrame(new Float64Array(8)));
  const first = controller.render(grid, () => { throw new Error('Stale tile delivered'); });
  const rejected = expect(first).rejects.toThrow(/cancelled/);
  await began;
  controller.cancel();
  const replacement = controller.render(grid, () => {});
  resume();
  await rejected;
  await replacement;
  controller.setSource(sampler, new FlatMapFrame(new Float64Array(8).fill(2)));
  await controller.render(grid, () => {});
  expect(worker.registerFlatMapSampler).toHaveBeenCalledTimes(1);
  expect(worker.registerMetric).toHaveBeenCalledTimes(2);
  expect(worker.registerFlatMapFrame).toHaveBeenCalledTimes(2);
  controller.dispose();
  expect(handles.size).toBe(0);
});
