import { describe, expect, it, vi } from 'vitest';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { buildSurfaceSmoothingPlan, smoothSurfaceValues } from '../../../src/geometry/SurfaceSmoothing';
import { GeometryWorkerClient } from '../../../src/geometry/GeometryWorkerClient';
import { GeometryExecutor } from '../../../src/geometry/GeometryExecutor';

function grid() {
  const positions: number[] = [], faces: number[] = [];
  for (let v = 0; v < 100; v++) positions.push(v % 10, Math.floor(v / 10), 0);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) { const a = y * 10 + x; faces.push(a, a + 1, a + 11, a, a + 11, a + 10); }
  const domain = new SurfaceDomain({ id: 'grid', structure: 'test', vertexCount: 100, faces });
  return new SurfaceMetric(domain, { positions, frame: 'mm', units: 'mm' });
}

describe('exact-size retained smoothing', () => {
  it('keeps constant, masked, nonconstant and streamed results identical', () => {
    const metric = grid(), roi = Uint8Array.from({ length: 100 }, (_, i) => +(i % 7 !== 0));
    for (const fwhmMm of [0, 1, 3]) {
      const options = { fwhmMm, roi, budgetBytes: 2 * 1024 * 1024 };
      const plan = buildSurfaceSmoothingPlan(metric, options);
      for (const values of [new Float64Array(100).fill(3), Float64Array.from({ length: 100 }, (_, i) => i % 11 ? Math.sin(i) : NaN)]) {
        expect(plan.apply(values)).toEqual(smoothSurfaceValues(metric, values, options));
      }
      const weights = plan.copyWeights(); weights.weights.fill(0);
      expect(plan.apply(new Float64Array(100).fill(3)).values[1]).toBeCloseTo(3, 12);
    }
  });
  it('captures queued batches and cancels without exposing partial frames', async () => {
    const plan = buildSurfaceSmoothingPlan(grid(), { fwhmMm: 2 }), prepared = plan.prepare();
    const frame = new Float64Array(100).fill(7), steps = prepared.applyBatchSteps([frame]); frame.fill(99);
    const executor = new GeometryExecutor({ timeSliceMs: 0.1 });
    const result = await executor.run(steps); expect(result[0]!.values[50]).toBeCloseTo(7, 12);
    const controller = new AbortController(); controller.abort();
    await expect(executor.run(prepared.applyBatchSteps([frame]), { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    executor.dispose();
  });
  it('refuses invalid or externally owned worker limits before creating a worker', async () => {
    const workerFactory = () => { throw new Error('Factory must not run'); };
    expect(() => new GeometryWorkerClient({ workerFactory, limits: { budgetBytes: 100, planBudgetBytes: 0 } })).toThrow(/positive/);
    expect(() => new GeometryWorkerClient({ workerFactory, ownsWorker: false, limits: { budgetBytes: 100, planBudgetBytes: 50 } })).toThrow(/owned/);
    const client = new GeometryWorkerClient({ ownsWorker: false, workerFactory: () => ({ postMessage: () => { throw new Error('Must not post configuration'); }, addEventListener: () => {}, removeEventListener: () => {}, terminate: () => {} }) });
    await expect(client.request({ type: 'configure', budgetBytes: 100, planBudgetBytes: 50 })).rejects.toThrow(/owned/);
    client.dispose();
  });
  it('enforces construction budgets without returning a truncated kernel', () => {
    expect(buildSurfaceSmoothingPlan(grid(), { fwhmMm: 3, budgetBytes: 100000 }).byteLength).toBeLessThan(100000);
    expect(() => buildSurfaceSmoothingPlan(grid(), { fwhmMm: 8, budgetBytes: 100000 })).toThrow(/budget/i);
  });
});

it('snapshots requests while an owned worker is being configured', async () => {
  const handlers = new Map<string, EventListener>(), sent: unknown[] = [];
  const worker = { postMessage: (message: unknown) => sent.push(message), addEventListener: (type: string, handler: EventListener) => handlers.set(type, handler), removeEventListener: (type: string) => handlers.delete(type), terminate: () => {} } as unknown as import('../../../src/geometry/GeometryWorkerClient').GeometryWorker;
  const client = new GeometryWorkerClient({ workerFactory: () => worker, limits: { budgetBytes: 1000, planBudgetBytes: 500 } });
  const faces = new Uint32Array([0, 1, 2]);
  const queued = client.request({ type: 'domain', options: { id: 'queued', structure: 'test', vertexCount: 3, faces } }); faces[0] = 2;
  const configure = sent[0] as { clientId: string };
  handlers.get('message')!(new MessageEvent('message', { data: { protocol: 1, clientId: configure.clientId, id: 1, value: undefined } }));
  await Promise.resolve();
  expect((sent[1] as { command: { options: { faces: Uint32Array } } }).command.options.faces[0]).toBe(0);
  handlers.get('message')!(new MessageEvent('message', { data: { protocol: 1, clientId: configure.clientId, id: 2, value: 'geometry-resource-1' } }));
  await expect(queued).resolves.toBe('geometry-resource-1'); client.dispose();
});

it('namespaces shared-worker requests, cancellation, responses, and disposal', async () => {
  const handlers = new Map<string, Set<EventListener>>(), messages: any[] = [], terminate = vi.fn();
  const worker = {
    postMessage: (message: unknown) => messages.push(message),
    addEventListener: (type: string, handler: EventListener) => (handlers.get(type) ?? handlers.set(type, new Set()).get(type)!).add(handler),
    removeEventListener: (type: string, handler: EventListener) => handlers.get(type)?.delete(handler),
    terminate
  } as unknown as import('../../../src/geometry/GeometryWorkerClient').GeometryWorker;
  const emit = (type: string, data: unknown) => { for (const handler of handlers.get(type) ?? []) handler(new MessageEvent(type, { data })); };
  const left = new GeometryWorkerClient({ workerFactory: () => worker, ownsWorker: false });
  const right = new GeometryWorkerClient({ workerFactory: () => worker, ownsWorker: false });
  const leftRequest = left.request<string>({ type: 'domain', options: { id: 'left', structure: 'test', vertexCount: 3, faces: [0, 1, 2] } });
  const abort = new AbortController();
  const rightRequest = right.request<string>({ type: 'domain', options: { id: 'right', structure: 'test', vertexCount: 3, faces: [0, 1, 2] } }, { signal: abort.signal });
  const [leftMessage, rightMessage] = messages as [{ clientId: string; id: number }, { clientId: string; id: number }];
  expect(leftMessage.id).toBe(rightMessage.id);
  expect(leftMessage.clientId).not.toBe(rightMessage.clientId);
  emit('message', { protocol: 1, clientId: leftMessage.clientId, id: leftMessage.id, value: 'geometry-resource-left' });
  await expect(leftRequest).resolves.toBe('geometry-resource-left');
  abort.abort();
  await expect(rightRequest).rejects.toMatchObject({ code: 'cancelled' });
  expect(messages.at(-1)).toMatchObject({ protocol: 1, clientId: rightMessage.clientId, cancel: rightMessage.id });
  // The delayed completion is owned by the right client only; it must not be
  // released or otherwise processed by the left client despite the same id.
  emit('message', { protocol: 1, clientId: rightMessage.clientId, id: rightMessage.id, value: 'geometry-resource-right' });
  expect(messages.at(-1)).toMatchObject({ clientId: rightMessage.clientId, command: { type: 'release', handle: 'geometry-resource-right' } });
  left.dispose();
  expect(messages.at(-1)).toMatchObject({ clientId: leftMessage.clientId, command: { type: 'release', handle: 'geometry-resource-left' } });
  right.dispose();
  expect(terminate).not.toHaveBeenCalled();
  expect([...handlers.values()].every(set => set.size === 0)).toBe(true);
});

it('makes a worker error terminal, including queued initialization requests', async () => {
  const handlers = new Map<string, EventListener>(), terminate = vi.fn();
  const postMessage = vi.fn();
  const worker = { postMessage, addEventListener: (type: string, handler: EventListener) => handlers.set(type, handler), removeEventListener: (type: string) => handlers.delete(type), terminate } as unknown as import('../../../src/geometry/GeometryWorkerClient').GeometryWorker;
  const client = new GeometryWorkerClient({ workerFactory: () => worker, limits: { budgetBytes: 1000, planBudgetBytes: 500 } });
  const queued = client.request({ type: 'domain', options: { id: 'queued', structure: 'test', vertexCount: 3, faces: [0, 1, 2] } });
  handlers.get('error')!(new Event('error'));
  await expect(queued).rejects.toThrow(/worker failed/);
  const postCount = postMessage.mock.calls.length;
  await expect(client.request({ type: 'domain', options: { id: 'later', structure: 'test', vertexCount: 3, faces: [0, 1, 2] } })).rejects.toThrow(/worker failed/);
  expect(postMessage).toHaveBeenCalledTimes(postCount);
  client.dispose();
  expect(terminate).toHaveBeenCalledTimes(1);
  expect(handlers.size).toBe(0);
});

it('makes external-worker runtime failure terminal without taking ownership', async () => {
  const handlers = new Map<string, EventListener>(), postMessage = vi.fn(), terminate = vi.fn();
  const worker = { postMessage, addEventListener: (type: string, handler: EventListener) => handlers.set(type, handler), removeEventListener: (type: string) => handlers.delete(type), terminate } as unknown as import('../../../src/geometry/GeometryWorkerClient').GeometryWorker;
  const client = new GeometryWorkerClient({ workerFactory: () => worker, ownsWorker: false });
  const domain = new SurfaceDomain({ id: 'registered', structure: 'test', vertexCount: 3, faces: [0, 1, 2] });
  const registration = client.registerDomain(domain);
  const registeredRequest = postMessage.mock.calls[0]![0] as { clientId: string; id: number };
  handlers.get('message')!(new MessageEvent('message', { data: { protocol: 1, clientId: registeredRequest.clientId, id: registeredRequest.id, value: 'geometry-resource-domain' } }));
  await expect(registration).resolves.toBe('geometry-resource-domain');
  const pending = client.request({ type: 'domain', options: { id: 'pending', structure: 'test', vertexCount: 3, faces: [0, 1, 2] } });
  handlers.get('error')!(new Event('error'));
  await expect(pending).rejects.toThrow(/worker failed/);
  const postCount = postMessage.mock.calls.length;
  await expect(client.request({ type: 'domain', options: { id: 'future', structure: 'test', vertexCount: 3, faces: [0, 1, 2] } })).rejects.toThrow(/worker failed/);
  client.dispose();
  expect(postMessage).toHaveBeenCalledTimes(postCount);
  expect(terminate).not.toHaveBeenCalled();
  expect(handlers.size).toBe(0);
});

it('worker echoes duplicate request ids to their originating client namespaces', async () => {
  const responses: any[] = [];
  const handlers = new Map<string, EventListener>();
  vi.stubGlobal('postMessage', (response: unknown) => responses.push(response));
  vi.stubGlobal('addEventListener', (type: string, handler: EventListener) => handlers.set(type, handler));
  try {
    await import('../../../src/geometry/geometryWorker');
    for (const clientId of ['client-a', 'client-b']) {
      handlers.get('message')!({ data: {
        protocol: 1, clientId, id: 1,
        command: { type: 'domain', options: { id: clientId, structure: 'test', vertexCount: 3, faces: [0, 1, 2] } }
      } } as MessageEvent);
    }
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    expect(responses).toEqual(expect.arrayContaining([
      expect.objectContaining({ protocol: 1, clientId: 'client-a', id: 1 }),
      expect.objectContaining({ protocol: 1, clientId: 'client-b', id: 1 })
    ]));
  } finally {
    vi.unstubAllGlobals();
  }
});

it('snapshots validity before cooperative preparation', async () => {
  const plan = buildSurfaceSmoothingPlan(grid(), { fwhmMm: 2 }), validity = new Uint8Array(100).fill(1), steps = plan.prepareSteps({ validity });
  validity.fill(0);
  const executor = new GeometryExecutor({ timeSliceMs: 0.1 });
  try {
    const prepared = await executor.run(steps);
    expect([...prepared.apply(new Float64Array(100).fill(5)).valid].every(Boolean)).toBe(true);
  } finally { executor.dispose(); }
});
