import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  SURFVIEW_SCENE_SCHEMA,
  SceneManifestError,
  createSceneAsset,
  loadSceneAsset,
  validateSceneManifest
} from '../../src/scene';
import type {
  SceneAssetDescriptor,
  SurfViewSceneManifest
} from '../../src/scene';

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto
    });
  }
});

export async function fixtureManifest(inline = true): Promise<SurfViewSceneManifest> {
  const leftVertices = await createSceneAsset(
    [0, 0, 0, -1, 0, 0, 0, 1, 0],
    { role: 'vertices', dtype: 'float32', shape: [3, 3], inline }
  );
  const rightVertices = await createSceneAsset(
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    { role: 'vertices', dtype: 'float32', shape: [3, 3], inline }
  );
  const faces = await createSceneAsset(
    [0, 1, 2],
    { role: 'faces', dtype: 'uint32', shape: [1, 3], inline }
  );
  const leftValues = await createSceneAsset(
    [-1, Number.NaN, 1],
    { role: 'values', dtype: 'float32', shape: [3], inline }
  );
  const rightValues = await createSceneAsset(
    [1, 0, -1],
    { role: 'values', dtype: 'float32', shape: [3], inline }
  );
  const descriptors = [
    leftVertices.descriptor,
    rightVertices.descriptor,
    faces.descriptor,
    leftValues.descriptor,
    rightValues.descriptor
  ];
  const assets = Object.fromEntries(descriptors.map(asset => [asset.id, asset]));

  return {
    schemaVersion: SURFVIEW_SCENE_SCHEMA,
    id: 'bilateral-fixture',
    assets,
    geometries: {
      left: {
        id: 'left',
        hemisphere: 'left',
        vertices: leftVertices.descriptor.id,
        faces: faces.descriptor.id,
        vertexCount: 3,
        faceCount: 1
      },
      right: {
        id: 'right',
        hemisphere: 'right',
        vertices: rightVertices.descriptor.id,
        faces: faces.descriptor.id,
        vertexCount: 3,
        faceCount: 1
      }
    },
    layers: {
      statistic: {
        id: 'statistic',
        values: {
          left: { values: leftValues.descriptor.id },
          right: { values: rightValues.descriptor.id }
        },
        colorMap: 'RdBu',
        limits: [-2, 2],
        opacity: 0.8,
        units: 'z',
        legend: { title: 'Statistic', units: 'z' },
        metadata: { contrast: 'task-rest' },
        provenance: { model: 'authoritative-r-fit' }
      }
    },
    selectedLayer: 'statistic',
    metadata: { report: 'group' }
  };
}

describe('portable scene assets', () => {
  it('round-trips little-endian Float32 values and preserves NaN', async () => {
    const { descriptor } = await createSceneAsset(
      [1.25, Number.NaN, -2.5],
      { role: 'values', dtype: 'float32', shape: [3] }
    );
    const values = await loadSceneAsset(descriptor);

    expect(values).toBeInstanceOf(Float32Array);
    expect(values[0]).toBeCloseTo(1.25);
    expect(Number.isNaN(values[1])).toBe(true);
    expect(values[2]).toBeCloseTo(-2.5);
    expect(descriptor.id).toMatch(/^values-sha256-[a-f0-9]{64}$/);
  });

  it('loads adjacent content-addressed bytes and verifies their checksum', async () => {
    const { descriptor, bytes } = await createSceneAsset(
      [0, 2, 1],
      { role: 'faces', dtype: 'uint32', shape: [1, 3], inline: false }
    );
    const fetcher = async (input: RequestInfo | URL) => {
      expect(String(input)).toContain(descriptor.uri);
      return new Response(bytes, { status: 200 });
    };
    const values = await loadSceneAsset(descriptor, {
      baseUrl: 'https://report.invalid/assets/',
      fetcher: fetcher as typeof fetch
    });

    expect(Array.from(values)).toEqual([0, 2, 1]);
    expect(descriptor.uri).toMatch(/^sha256-[a-f0-9]{64}\.faces\.bin$/);
  });

  it('loads identical values from inline and adjacent forms', async () => {
    const source = [1.25, Number.NaN, -2.5, 8];
    const inline = await createSceneAsset(
      source,
      { role: 'values', dtype: 'float32', shape: [4] }
    );
    const adjacent = await createSceneAsset(
      source,
      { role: 'values', dtype: 'float32', shape: [4], inline: false }
    );
    const fetcher = async () => new Response(adjacent.bytes, { status: 200 });

    expect(inline.descriptor.id).toBe(adjacent.descriptor.id);
    const inlineValues = await loadSceneAsset(inline.descriptor);
    const adjacentValues = await loadSceneAsset(adjacent.descriptor, {
      fetcher: fetcher as typeof fetch
    });
    expect(Array.from(adjacentValues)).toEqual(Array.from(inlineValues));
    expect(Number.isNaN(adjacentValues[1])).toBe(true);
  });

  it('stores a bilateral full map in four bytes per vertex with bounded metadata', async () => {
    const leftCount = 1000;
    const rightCount = 1200;
    const left = await createSceneAsset(
      new Float32Array(leftCount),
      { role: 'values', dtype: 'float32', shape: [leftCount], inline: false }
    );
    const right = await createSceneAsset(
      new Float32Array(rightCount),
      { role: 'values', dtype: 'float32', shape: [rightCount], inline: false }
    );
    const layerMetadata = JSON.stringify({
      assets: [left.descriptor, right.descriptor],
      layer: {
        id: 'full-map',
        values: {
          left: { values: left.descriptor.id },
          right: { values: right.descriptor.id }
        },
        colorMap: 'viridis',
        limits: [0, 1],
        units: 'a.u.'
      }
    });

    expect(left.bytes.byteLength + right.bytes.byteLength).toBe(
      4 * (leftCount + rightCount)
    );
    expect(new TextEncoder().encode(layerMetadata).byteLength).toBeLessThanOrEqual(16 * 1024);
  });

  it('rejects corrupted bytes', async () => {
    const { descriptor, bytes } = await createSceneAsset(
      [1, 2, 3],
      { role: 'values', dtype: 'float32', shape: [3], inline: false }
    );
    const corrupted = bytes.slice();
    corrupted[0] ^= 0xff;
    const fetcher = async () => new Response(corrupted, { status: 200 });

    await expect(loadSceneAsset(descriptor, {
      fetcher: fetcher as typeof fetch
    })).rejects.toThrow('checksum mismatch');
  });
});

describe('surfview.scene.v1 validation', () => {
  it('accepts a bilateral topology-sharing manifest with metadata', async () => {
    const manifest = await fixtureManifest();
    const validated = validateSceneManifest(manifest);

    expect(validated).toBe(manifest);
    expect(Object.keys(validated.geometries)).toEqual(['left', 'right']);
    expect(validated.layers.statistic.values.left.values).toBeTruthy();
    expect(validated.layers.statistic.metadata).toEqual({ contrast: 'task-rest' });
  });

  it('preserves presentation, provenance, selection, and missing values through JSON', async () => {
    const manifest = await fixtureManifest();
    const decoded = JSON.parse(JSON.stringify(manifest)) as SurfViewSceneManifest;
    validateSceneManifest(decoded);
    const values = await loadSceneAsset(
      decoded.assets[decoded.layers.statistic.values.left.values]
    );

    expect(decoded.layers.statistic).toMatchObject({
      id: 'statistic',
      colorMap: 'RdBu',
      limits: [-2, 2],
      opacity: 0.8,
      units: 'z',
      legend: { title: 'Statistic', units: 'z' },
      metadata: { contrast: 'task-rest' },
      provenance: { model: 'authoritative-r-fit' }
    });
    expect(decoded.selectedLayer).toBe('statistic');
    expect(decoded.metadata).toEqual({ report: 'group' });
    expect(Number.isNaN(values[1])).toBe(true);
  });

  it('rejects unknown schema versions before asset use', async () => {
    const manifest = await fixtureManifest();
    (manifest as { schemaVersion: string }).schemaVersion = 'surfview.scene.v99';

    expect(() => validateSceneManifest(manifest)).toThrowError(SceneManifestError);
    expect(() => validateSceneManifest(manifest)).toThrow('unsupported schema');
  });

  it('rejects duplicate hemisphere geometries', async () => {
    const manifest = await fixtureManifest();
    manifest.geometries.right.hemisphere = 'left';

    expect(() => validateSceneManifest(manifest)).toThrow('duplicates left geometry');
  });

  it('requires exactly one inline or adjacent source', async () => {
    const manifest = await fixtureManifest();
    const asset = Object.values(manifest.assets)[0] as SceneAssetDescriptor;
    asset.uri = 'duplicate.bin';

    expect(() => validateSceneManifest(manifest)).toThrow('exactly one of data or uri');
  });
});


describe('reference scene validation', () => {
  async function referenceManifest() {
    const manifest = await fixtureManifest();
    manifest.schemaVersion = 'surfview.scene.v2';
    const mask = await createSceneAsset([0, 1, 1], { role: 'values', dtype: 'float32', shape: [3] });
    manifest.assets[mask.descriptor.id] = mask.descriptor;
    manifest.layers.reference = {
      id: 'reference', role: 'reference', label: 'Synthetic anatomy', color: '#8844aa', boundary: 'midpoint',
      values: { left: { values: mask.descriptor.id }, right: { values: mask.descriptor.id } },
      visible: true, opacity: 0.25, provenance: { atlas: 'synthetic', region: 'PSL-like' }
    };
    return manifest;
  }

  it('round-trips the reference role, categorical display, membership and provenance', async () => {
    const manifest = JSON.parse(JSON.stringify(await referenceManifest()));
    validateSceneManifest(manifest);
    expect(manifest.layers.reference).toMatchObject({ role: 'reference', color: '#8844aa', boundary: 'midpoint', provenance: { atlas: 'synthetic' } });
    expect(Array.from(await loadSceneAsset(manifest.assets[manifest.layers.reference.values.left.values]))).toEqual([0, 1, 1]);
  });

  it('requires v2 so older runtimes cannot silently treat references as maps', async () => {
    const manifest = await referenceManifest();
    manifest.schemaVersion = 'surfview.scene.v1';
    expect(() => validateSceneManifest(manifest)).toThrow('references require surfview.scene.v2');
  });

  it.each([
    ['role', 'annotation', 'must be map or reference'],
    ['color', 'red', 'must be #rrggbb'],
    ['boundary', 'linear', 'must be midpoint'],
    ['label', '', 'non-empty'],
    ['visible', 1, 'boolean'],
    ['opacity', 2, 'between 0 and 1'],
    ['limits', [0, 1], 'not supported for references'],
    ['threshold', [0, 0.5], 'not supported for references'],
    ['colorMap', 'viridis', 'not supported for references'],
    ['legend', {}, 'not supported for references']
  ])('rejects invalid reference %s', async (field, value, message) => {
    const manifest = await referenceManifest();
    Object.assign(manifest.layers.reference!, { [field]: value });
    expect(() => validateSceneManifest(manifest)).toThrow(message);
  });

  it('rejects reference selection, duplicate references, sparse membership and missing hemispheres', async () => {
    const manifest = await referenceManifest();
    manifest.selectedLayer = 'reference';
    expect(() => validateSceneManifest(manifest)).toThrow('quantitative map');
    manifest.selectedLayer = 'statistic';
    manifest.layers.other = { ...manifest.layers.reference!, id: 'other' };
    expect(() => validateSceneManifest(manifest)).toThrow('at most one reference');
    delete manifest.layers.other;
    manifest.layers.reference!.values.left!.indices = 'sparse';
    expect(() => validateSceneManifest(manifest)).toThrow('dense');
    delete manifest.layers.reference!.values.left!.indices;
    delete manifest.layers.reference!.values.right;
    expect(() => validateSceneManifest(manifest)).toThrow('every geometry');
  });
});
