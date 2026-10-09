import { cpus, platform, arch } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { projectVolume } from '../dist/surfview.es.js';

// Synthetic 256^3 Float32 volume, Fibonacci sphere in anatomical mm. Fixture
// construction and output verification are outside timing; each call allocates output.
const dims = [256, 256, 256];
const data = new Float32Array(256 ** 3);
for (let k = 0; k < 256; k++) for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
  data[i + 256 * (j + 256 * k)] = i + 2 * j + 3 * k - 765;
}
const volume = { data, dims, voxelToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -127.5, -127.5, -127.5, 1] };
const warmup = 2, repetitions = 7;
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const cases = [];
for (const vertices of [32_492, 163_842, 324_002]) {
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  for (let v = 0; v < vertices; v++) {
    const z = 1 - 2 * (v + 0.5) / vertices;
    const r = Math.sqrt(1 - z * z), angle = v * Math.PI * (3 - Math.sqrt(5));
    const direction = [r * Math.cos(angle), r * Math.sin(angle), z];
    for (let c = 0; c < 3; c++) {
      normals[v * 3 + c] = direction[c];
      positions[v * 3 + c] = 80 * direction[c];
    }
  }
  for (const steps of [5, 16]) for (const interpolation of ['nearest', 'linear']) {
    const options = { depthMm: [-2, 2], steps, interpolation };
    let result;
    const run = () => { result = projectVolume(volume, { positions, normals }, options); };
    for (let i = 0; i < warmup; i++) run();
    const elapsed = [];
    for (let i = 0; i < repetitions; i++) {
      const start = performance.now();
      run();
      elapsed.push(performance.now() - start);
    }
    if (!result.validSamples.every(n => n === steps) || !result.values.every(Number.isFinite)) {
      throw new Error('Benchmark produced missing samples');
    }
    // An affine scalar field is reproduced by linear interpolation. For nearest,
    // evaluate the same analytic field at rounded voxel centres independently.
    for (const v of [0, 1, 17, Math.floor(vertices / 2), vertices - 1]) {
      const p = positions.slice(v * 3, v * 3 + 3), n = normals.slice(v * 3, v * 3 + 3);
      const norm = Math.hypot(...n);
      let expected = 0;
      for (let s = 0; s < steps; s++) {
        const depth = -2 + 4 * s / (steps - 1);
        const xyz = Array.from(p, (x, c) => x + 127.5 + depth * n[c] / norm);
        if (interpolation === 'nearest') for (let c = 0; c < 3; c++) xyz[c] = Math.floor(xyz[c] + 0.5);
        expected += xyz[0] + 2 * xyz[1] + 3 * xyz[2] - 765;
      }
      if (Math.abs(result.values[v] - expected / steps) > 0.0001) throw new Error('Benchmark analytic oracle failed');
    }
    const medianMs = median(elapsed);
    const row = { vertices, steps, interpolation, medianMs, madMs: median(elapsed.map(x => Math.abs(x - medianMs))), minMs: Math.min(...elapsed), maxMs: Math.max(...elapsed), outputBytes: result.values.byteLength + result.validSamples.byteLength };
    cases.push(row);
    console.log(`${vertices} vertices × ${steps} ${interpolation}: ${medianMs.toFixed(1)} ms (MAD ${row.madMs.toFixed(1)})`);
  }
}
const bundleSha256 = createHash('sha256').update(await readFile(new URL('../dist/surfview.es.js', import.meta.url))).digest('hex');
const report = { bundleSha256, node: process.version, cpu: cpus()[0]?.model, platform: platform(), arch: arch(), warmup, repetitions, dims, volumeBytes: data.byteLength, workload: 'Fibonacci sphere radius 80 mm; affine scalar field; depth [-2,2]; mean; allocations included; synthetic Node CPU timing, not browser frame timing', cases };
const output = process.argv.find(x => x.startsWith('--output='))?.slice(9);
if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
