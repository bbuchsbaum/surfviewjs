import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { FlatMapChart } from '../../../src/flatmap/FlatMapChart';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';

it('admits the provenance-bound matched real S1 anatomy and explicitly masked chart', () => {
  const root = new URL('../../../demo/data/flatmap/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as {
    file: string; sha256: string; uncompressedSha256: string; vertexCount: number; chartFaceCount: number;
    arrays: Record<string, { offset: number; length: number; type: string }>;
    excludedChartFaces: { inverted: number[]; overlapping: number[] };
  };
  const compressed = readFileSync(new URL(manifest.file, root)), bytes = gunzipSync(compressed);
  expect(createHash('sha256').update(compressed).digest('hex')).toBe(manifest.sha256);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.uncompressedSha256);
  const array = (name: string) => {
    const descriptor = manifest.arrays[name]!;
    const buffer = bytes.buffer.slice(bytes.byteOffset + descriptor.offset, bytes.byteOffset + descriptor.offset + descriptor.length * 4);
    return descriptor.type === 'float32' ? new Float32Array(buffer) : new Uint32Array(buffer);
  };
  const domain = new SurfaceDomain({ id: 'pycortex-S1-left', structure: 'left', vertexCount: manifest.vertexCount, faces: array('faces') });
  for (const name of ['white', 'pial', 'inflated']) {
    const metric = new SurfaceMetric(domain, { positions: array(name), units: 'mm', frame: 'pycortex-S1-surface' });
    expect(metric.domain.vertexCount).toBe(152893);
  }
  const chart = new FlatMapChart({ domain, coordinates: array('coordinates'), faces: array('chartFaces'),
    anatomicalFaces: array('anatomicalFaces'), anatomicalVertices: array('anatomicalVertices'), units: 'arbitrary' });
  const cutDomain = new SurfaceDomain({ id: 'cut', structure: 'left', vertexCount: chart.vertexCount, faces: chart.copyFaces() });
  expect(() => cutDomain.topology.requireManifold(true)).not.toThrow();
  expect(chart.vertexCount).toBe(domain.vertexCount + 1);
  expect(chart.faceCount).toBe(manifest.chartFaceCount);
  expect(manifest.excludedChartFaces.inverted).toHaveLength(30);
  expect(manifest.excludedChartFaces.overlapping).toHaveLength(258);
  let hits = 0;
  for (let y = chart.bounds[1]; y < chart.bounds[3]; y += 10) for (let x = chart.bounds[0]; x < chart.bounds[2]; x += 10) {
    const hit = chart.locate(x, y);
    if (hit) {
      hits++;
      const point = chart.chartPoints(hit.location)[0]!;
      expect(point[0]).toBeCloseTo(x, 10); expect(point[1]).toBeCloseTo(y, 10);
    }
  }
  expect(hits).toBeGreaterThan(100);
}, 30000);
