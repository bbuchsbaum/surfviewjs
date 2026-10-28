import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { SurfaceDomain, SurfaceMetric, GeodesicIndex, SurfaceBoundaryGraph, SurfaceTriangleIndex, buildSurfaceSmoothingPlan, computeVertexAreas, GeometryExecutor, buildSurfaceSmoothingPlanSteps } from '../dist/surfview.es.js';

const config = JSON.parse(await readFile(new URL('../benchmarks/surface-geometry-baseline.json', import.meta.url)));
const output = process.argv.find(x => x.startsWith('--output='))?.slice(9) ?? '/tmp/surfview-surface-geometry-benchmark.json';
const quick = process.argv.includes('--quick');
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
function measure(fn, warmup = config.warmup, samples = config.samples) {
  for (let i = 0; i < warmup; i++) fn();
  const times = []; let result;
  const before = process.memoryUsage();
  for (let i = 0; i < samples; i++) { const start = performance.now(); result = fn(); times.push(performance.now() - start); }
  const after = process.memoryUsage(), p50Ms = quantile(times, 0.5);
  return { result, timing: { p50Ms, p95Ms: quantile(times, 0.95), madMs: quantile(times.map(x => Math.abs(x - p50Ms)), 0.5), samples, warmup, rssDeltaBytes: after.rss - before.rss, arrayBufferDeltaBytes: after.arrayBuffers - before.arrayBuffers } };
}
function fixture(n) {
  const width = Math.floor(Math.sqrt(n)), positions = new Float64Array(n * 3), faces = [];
  for (let v = 0; v < n; v++) { positions[v * 3] = v % width; positions[v * 3 + 1] = Math.floor(v / width); }
  for (let a = 0; a + width + 1 < n; a++) if (a % width !== width - 1) {
    const b = a + 1, c = a + width, d = c + 1;
    if ((a % width + Math.floor(a / width)) % 2) faces.push(a, b, c, b, d, c); else faces.push(a, b, d, a, d, c);
  }
  return { positions, faces: Uint32Array.from(faces), width };
}
const cases = [];
process.on('uncaughtException', error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 1; });
for (const n of quick ? [32492] : config.vertexCounts) {
  globalThis.gc?.();
  const f = fixture(n), sha256 = createHash('sha256').update(new Uint8Array(f.positions.buffer)).update(new Uint8Array(f.faces.buffer)).digest('hex');
  const domainBuild = measure(() => new SurfaceDomain({ id: `lattice-${n}`, structure: 'synthetic', vertexCount: n, faces: f.faces }), 0, 3), domain = domainBuild.result;
  const metricBuild = measure(() => new SurfaceMetric(domain, { positions: f.positions, frame: 'lattice', units: 'mm' }), 0, 3), metric = metricBuild.result;
  const geodesicBuild = measure(() => new GeodesicIndex(metric), 0, 3), index = geodesicBuild.result, seed = Math.floor(n / 2);
  const neighborhood = measure(() => index.withinRadius([seed], config.radiusMm));
  const labels = Int32Array.from({ length: n }, (_, v) => Math.floor((v % f.width) / 8) + 100 * Math.floor(Math.floor(v / f.width) / 8));
  const boundaryBuild = measure(() => new SurfaceBoundaryGraph(domain, labels, { background: -1 }), 0, 3), graph = boundaryBuild.result;
  let label = 999999; const boundaryEdit = measure(() => graph.updateLabels([{ vertex: seed, label: label++ }]));
  const treeBuild = measure(() => new SurfaceTriangleIndex(metric), 0, 3), tree = treeBuild.result;
  const projection = measure(() => { for (let i = 0; i < 100; i++) tree.closest([i % f.width + 0.31, Math.floor(n / f.width / 2) + 0.19, 3]); });
  const areas = computeVertexAreas(metric), areaError = Math.abs(areas.reduce((a, b) => a + b, 0) - f.faces.length / 6);
  const smoothing = measure(() => buildSurfaceSmoothingPlan(metric, { fwhmMm: config.smoothingFwhmMm, budgetBytes: config.planBudgetBytes }), 0, 1), values = Float64Array.from({ length: n }, (_, v) => Math.sin(v % f.width / 20));
  const apply = measure(() => smoothing.result.apply(values));
  const executor = new GeometryExecutor({ timeSliceMs: 2 }), abort = new AbortController();
  const submitAt = performance.now();
  const job = executor.run(buildSurfaceSmoothingPlanSteps(metric, { fwhmMm: 5, budgetBytes: config.planBudgetBytes }), { signal: abort.signal });
  const submissionMs = performance.now() - submitAt;
  const abortAt = performance.now(); abort.abort(); let cancelled = false;
  try { await job; } catch (error) { cancelled = error.code === 'cancelled'; }
  const cancelMs = performance.now() - abortAt; executor.dispose();
  cases.push({ vertices: n, faces: f.faces.length / 3, fixtureSha256: sha256, method: 'triangle-pair', dtype: 'Float64', domainBuild: domainBuild.timing, metricBuild: metricBuild.timing, geodesicBuild: geodesicBuild.timing, neighborhood: { ...neighborhood.timing, reached: neighborhood.result.vertices.length }, boundaryBuild: boundaryBuild.timing, boundaryEdit: boundaryEdit.timing, treeBuild: treeBuild.timing, projection100: projection.timing, smoothingBuild: smoothing.timing, smoothingApply: apply.timing, retainedBytes: { domain: domain.byteLength, metric: metric.byteLength, index: index.byteLength, boundaries: graph.byteLength, tree: tree.byteLength, smoothing: smoothing.result.byteLength }, areaErrorMm2: areaError, submissionMs, cancelMs, cancelled, processMaxRssBytes: process.resourceUsage().maxRSS * 1024 });
  process.stdout.write(`${n} vertices: cutoff ${neighborhood.timing.p50Ms.toFixed(2)} ms, smoothing apply ${apply.timing.p50Ms.toFixed(2)} ms, cancel ${cancelMs.toFixed(2)} ms\n`);
}
const report = { schema: config.schema, generated: new Date().toISOString(), sourceBase: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirtyWorktree: true, bundleSha256: createHash('sha256').update(await readFile(new URL('../dist/surfview.es.js', import.meta.url))).digest('hex'), runtime: process.version, threeVersion: JSON.parse(await readFile(new URL('../node_modules/three/package.json', import.meta.url))).version, hardware: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, memory: os.totalmem() }, config, peakMemoryNote: 'Process-wide cumulative max RSS, including retained benchmark results and GC timing; not an isolated per-kernel peak.', storageNote: 'Typed-array storage is counted; boundary JavaScript object storage is conservatively estimated, not heap-measured.', cancellationNote: 'cancelMs starts after run() returns. submissionMs records synchronous setup before the first yield; these are separate responsiveness costs.', cases };
await writeFile(output, JSON.stringify(report, null, 2) + '\n'); process.stdout.write(`Report: ${output}\n`);
