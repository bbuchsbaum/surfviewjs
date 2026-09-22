import { brotliCompressSync, gzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import {
  GPULayerCompositor,
  RGBALayer,
  THREE,
  compositeStraightRGBABuffer,
  computePickInfo
} from '../dist/surfview.es.js';

const VERTEX_COUNTS = Object.freeze([32_492, 163_842, 324_002]);
const LAYER_COUNTS = Object.freeze([1, 4, 8]);
const check = process.argv.includes('--check');
const outputArgument = process.argv.find(argument => argument.startsWith('--output='));
const outputPath = outputArgument?.slice('--output='.length);
if (outputArgument && !outputPath) {
  throw new Error('--output requires a non-empty path');
}
const baseline = JSON.parse(await readFile(new URL('../benchmarks/performance-baseline.json', import.meta.url)));
const { samples, warmup } = baseline.noise;

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function measure(operation) {
  for (let i = 0; i < warmup; i += 1) operation(i);
  const timings = [];
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    operation(i);
    timings.push(performance.now() - start);
  }
  const center = median(timings);
  return {
    medianMs: center,
    madMs: median(timings.map(value => Math.abs(value - center))),
    minMs: Math.min(...timings),
    maxMs: Math.max(...timings)
  };
}

function makeRGBA(vertexCount, layerIndex) {
  const rgba = new Float32Array(vertexCount * 4);
  const phase = (layerIndex + 1) * 0.071;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 4;
    const value = ((vertex * 17 + layerIndex * 31) % 997) / 996;
    rgba[offset] = value;
    rgba[offset + 1] = 1 - value;
    rgba[offset + 2] = (value + phase) % 1;
    rgba[offset + 3] = vertex % 11 === 0 ? 0 : 0.75;
  }
  return rgba;
}

function benchmarkCase(vertexCount, layerCount) {
  const arrays = Array.from({ length: layerCount }, (_, index) => makeRGBA(vertexCount, index));
  const layers = arrays.map((data, index) => new RGBALayer(`layer-${index}`, data, {
    opacity: 0.5 + index / (layerCount * 2)
  }));
  const composite = new Float32Array(vertexCount * 4);

  const cpuComposite = measure(() => {
    composite.fill(0);
    for (const layer of layers) {
      compositeStraightRGBABuffer(composite, layer.getRGBAData(vertexCount), layer.blendMode, layer.opacity);
    }
  });

  let initialStats;
  let textureBytes = 0;
  const gpuInitialPreparation = measure(() => {
    const compositor = new GPULayerCompositor(vertexCount, layerCount);
    compositor.updateLayers(layers);
    initialStats = compositor.getLastUpdateStats();
    textureBytes = compositor.getTextureMemoryUsage().totalBytes;
    compositor.dispose();
  });

  const compositor = new GPULayerCompositor(vertexCount, layerCount);
  compositor.updateLayers(layers);
  layers.forEach(layer => { layer.needsUpdate = false; });
  const dirtyIndex = Math.floor(layerCount / 2);
  let dirtyStats;
  const gpuDirtyLayer = measure(() => {
    layers[dirtyIndex].needsUpdate = true;
    compositor.updateLayers(layers);
    dirtyStats = compositor.getLastUpdateStats();
    layers[dirtyIndex].needsUpdate = false;
  });

  let reversed = false;
  const gpuReorder = measure(() => {
    reversed = !reversed;
    compositor.updateLayers(reversed ? [...layers].reverse() : layers);
    layers.forEach(layer => { layer.needsUpdate = false; });
  });

  let visible = true;
  const gpuVisibility = measure(() => {
    visible = !visible;
    layers[layerCount - 1].visible = visible;
    layers[layerCount - 1].needsUpdate = true;
    compositor.updateLayers(layers);
    layers.forEach(layer => { layer.needsUpdate = false; });
  });
  const incrementalStats = compositor.getLastUpdateStats();
  compositor.dispose();

  return {
    vertexCount,
    layerCount,
    typedArrayBytes: arrays.reduce((sum, array) => sum + array.byteLength, composite.byteLength),
    textureBytes,
    cpuComposite,
    gpuInitialPreparation,
    gpuDirtyLayer,
    gpuReorder,
    gpuVisibility,
    initialStats,
    dirtyStats,
    incrementalStats
  };
}

function makePickFixture(vertexCount) {
  const triangleCount = Math.floor(vertexCount / 3);
  const positions = new Float32Array(triangleCount * 9);
  positions.set([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  for (let triangle = 1; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 9;
    positions.set([1000, 1000, 0, 1001, 1000, 0, 1000, 1001, 0], offset);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  return { triangleCount, geometry, mesh, raycaster };
}

function benchmarkPicking(vertexCount) {
  const fixture = makePickFixture(vertexCount);
  const timing = measure(() => computePickInfo(fixture.raycaster, fixture.mesh));
  fixture.geometry.dispose();
  fixture.mesh.material.dispose();
  return { vertexCount, triangleCount: fixture.triangleCount, cpuRaycast: timing };
}

const heapBefore = process.memoryUsage();
const workloads = [];
for (const vertexCount of VERTEX_COUNTS) {
  for (const layerCount of LAYER_COUNTS) {
    workloads.push(benchmarkCase(vertexCount, layerCount));
  }
  if (globalThis.gc) globalThis.gc();
}
const picking = VERTEX_COUNTS.map(benchmarkPicking);
if (globalThis.gc) globalThis.gc();
const heapAfter = process.memoryUsage();

const bundle = await readFile(new URL('../dist/surfview.es.js', import.meta.url));
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  method: {
    statistic: 'median',
    samples,
    warmup,
    dispersion: 'median absolute deviation',
    gpuTimingScope: 'CPU preparation of GPU texture slices; browser GPU execution is measured separately'
  },
  processMemoryDelta: {
    heapUsedBytes: heapAfter.heapUsed - heapBefore.heapUsed,
    externalBytes: heapAfter.external - heapBefore.external,
    arrayBuffersBytes: heapAfter.arrayBuffers - heapBefore.arrayBuffers
  },
  bundle: {
    rawBytes: bundle.byteLength,
    gzipBytes: gzipSync(bundle).byteLength,
    brotliBytes: brotliCompressSync(bundle).byteLength
  },
  workloads,
  picking
};

function assertBudget(name, observed, limit) {
  if (observed > limit) {
    throw new Error(`${name}: ${observed.toFixed(3)} exceeded budget ${limit.toFixed(3)}`);
  }
}

if (check) {
  const budgets = baseline.budgets;
  for (const workload of workloads) {
    const millionVertexLayers = workload.vertexCount * workload.layerCount / 1_000_000;
    const millionVertices = workload.vertexCount / 1_000_000;
    assertBudget(
      `cpuComposite ${workload.vertexCount}x${workload.layerCount}`,
      workload.cpuComposite.medianMs / millionVertexLayers,
      budgets.cpuCompositeMsPerMillionVertexLayers
    );
    assertBudget(
      `gpuInitialPreparation ${workload.vertexCount}x${workload.layerCount}`,
      workload.gpuInitialPreparation.medianMs / millionVertexLayers,
      budgets.gpuInitialPreparationMsPerMillionVertexLayers
    );
    assertBudget(
      `gpuDirtyLayer ${workload.vertexCount}x${workload.layerCount}`,
      workload.gpuDirtyLayer.medianMs / millionVertices,
      budgets.gpuDirtyLayerMsPerMillionVertices
    );
    if (workload.initialStats.regeneratedLayerSlices !== workload.layerCount) {
      throw new Error(`initial upload did not prepare every layer for ${workload.vertexCount}x${workload.layerCount}`);
    }
    if (workload.dirtyStats.regeneratedLayerSlices !== 1 ||
        workload.dirtyStats.clearedLayerSlices !== 0) {
      throw new Error(`dirty update touched unrelated slices for ${workload.vertexCount}x${workload.layerCount}`);
    }
  }
  for (const result of picking) {
    const millionTriangles = result.triangleCount / 1_000_000;
    assertBudget(
      `cpuRaycast ${result.vertexCount}`,
      result.cpuRaycast.medianMs / millionTriangles,
      budgets.cpuRaycastMsPerMillionTriangles
    );
  }
  assertBudget('core bundle Brotli bytes', output.bundle.brotliBytes, budgets.coreBundleBrotliBytes);
}

const serializedOutput = `${JSON.stringify(output, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serializedOutput);
}
process.stdout.write(serializedOutput);
