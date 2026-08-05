export const SURFVIEW_SCENE_SCHEMA = 'surfview.scene.v1' as const;

export type SceneHemisphere = 'left' | 'right';
export type SceneAssetDType = 'float32' | 'uint32';
export type SceneAssetRole = 'vertices' | 'faces' | 'curvature' | 'values' | 'indices';

export interface SceneAssetDescriptor {
  id: string;
  role: SceneAssetRole;
  dtype: SceneAssetDType;
  shape: number[];
  byteLength: number;
  sha256: string;
  endianness: 'little';
  encoding?: 'base64';
  data?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface SceneGeometryManifest {
  id: string;
  hemisphere: SceneHemisphere;
  vertices: string;
  faces: string;
  curvature?: string;
  vertexCount: number;
  faceCount: number;
  metadata?: Record<string, unknown>;
}

export interface SceneLayerValuesManifest {
  values: string;
  indices?: string;
}

export interface SceneLayerLegend {
  title?: string;
  units?: string;
  visible?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SurfViewSceneLayerManifest {
  id: string;
  label?: string;
  values: Record<string, SceneLayerValuesManifest>;
  colorMap: string | string[];
  limits: [number, number];
  threshold?: [number, number];
  opacity?: number;
  visible?: boolean;
  units?: string;
  legend?: SceneLayerLegend;
  metadata?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export interface SurfViewSceneManifest {
  schemaVersion: typeof SURFVIEW_SCENE_SCHEMA;
  id: string;
  assets: Record<string, SceneAssetDescriptor>;
  geometries: Record<string, SceneGeometryManifest>;
  layers: Record<string, SurfViewSceneLayerManifest>;
  selectedLayer?: string;
  metadata?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export class SceneManifestError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'SceneManifestError';
    this.path = path;
  }
}

const BYTES_PER_ELEMENT: Record<SceneAssetDType, number> = {
  float32: 4,
  uint32: 4
};

function requireNonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SceneManifestError(path, 'must be a non-empty string');
  }
}

function requirePositiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new SceneManifestError(path, 'must be a positive integer');
  }
}

function requireFinitePair(value: unknown, path: string): asserts value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2 ||
      !value.every(item => typeof item === 'number' && Number.isFinite(item)) ||
      value[0] > value[1]) {
    throw new SceneManifestError(path, 'must be an ordered pair of finite numbers');
  }
}

function shapeElements(shape: number[], path: string): number {
  if (!Array.isArray(shape) || shape.length === 0) {
    throw new SceneManifestError(path, 'must contain at least one dimension');
  }
  return shape.reduce((total, dimension, index) => {
    requirePositiveInteger(dimension, `${path}[${index}]`);
    return total * dimension;
  }, 1);
}

function requireAsset(
  manifest: SurfViewSceneManifest,
  assetId: string,
  path: string,
  role?: SceneAssetRole
): SceneAssetDescriptor {
  requireNonEmpty(assetId, path);
  const asset = manifest.assets[assetId];
  if (!asset) throw new SceneManifestError(path, `references unknown asset ${assetId}`);
  if (role && asset.role !== role) {
    throw new SceneManifestError(path, `expected ${role} asset, received ${asset.role}`);
  }
  return asset;
}

export function validateSceneManifest(manifest: SurfViewSceneManifest): SurfViewSceneManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new SceneManifestError('$', 'must be an object');
  }
  if (manifest.schemaVersion !== SURFVIEW_SCENE_SCHEMA) {
    throw new SceneManifestError(
      '$.schemaVersion',
      `unsupported schema ${String(manifest.schemaVersion)}`
    );
  }
  requireNonEmpty(manifest.id, '$.id');

  const assetEntries = Object.entries(manifest.assets ?? {});
  if (assetEntries.length === 0) {
    throw new SceneManifestError('$.assets', 'must contain at least one asset');
  }
  for (const [assetId, asset] of assetEntries) {
    requireNonEmpty(assetId, `$.assets.${assetId}`);
    if (asset.id !== assetId) {
      throw new SceneManifestError(`$.assets.${assetId}.id`, 'must match its object key');
    }
    if (asset.endianness !== 'little') {
      throw new SceneManifestError(`$.assets.${assetId}.endianness`, 'must be little');
    }
    if (!(asset.dtype in BYTES_PER_ELEMENT)) {
      throw new SceneManifestError(`$.assets.${assetId}.dtype`, 'must be float32 or uint32');
    }
    const expectedBytes = shapeElements(asset.shape, `$.assets.${assetId}.shape`) *
      BYTES_PER_ELEMENT[asset.dtype];
    if (asset.byteLength !== expectedBytes) {
      throw new SceneManifestError(
        `$.assets.${assetId}.byteLength`,
        `expected ${expectedBytes}, received ${asset.byteLength}`
      );
    }
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new SceneManifestError(`$.assets.${assetId}.sha256`, 'must be a lowercase SHA-256');
    }
    const sourceCount = Number(typeof asset.data === 'string') + Number(typeof asset.uri === 'string');
    if (sourceCount !== 1) {
      throw new SceneManifestError(
        `$.assets.${assetId}`,
        'must contain exactly one of data or uri'
      );
    }
    if (asset.data && asset.encoding !== 'base64') {
      throw new SceneManifestError(`$.assets.${assetId}.encoding`, 'inline data must use base64');
    }
  }

  const geometryEntries = Object.entries(manifest.geometries ?? {});
  if (geometryEntries.length === 0) {
    throw new SceneManifestError('$.geometries', 'must contain at least one geometry');
  }
  const hemispheres = new Set<SceneHemisphere>();
  for (const [geometryId, geometry] of geometryEntries) {
    if (geometry.id !== geometryId) {
      throw new SceneManifestError(`$.geometries.${geometryId}.id`, 'must match its object key');
    }
    if (geometry.hemisphere !== 'left' && geometry.hemisphere !== 'right') {
      throw new SceneManifestError(
        `$.geometries.${geometryId}.hemisphere`,
        'must be left or right'
      );
    }
    if (hemispheres.has(geometry.hemisphere)) {
      throw new SceneManifestError(
        `$.geometries.${geometryId}.hemisphere`,
        `duplicates ${geometry.hemisphere} geometry`
      );
    }
    hemispheres.add(geometry.hemisphere);
    requirePositiveInteger(geometry.vertexCount, `$.geometries.${geometryId}.vertexCount`);
    requirePositiveInteger(geometry.faceCount, `$.geometries.${geometryId}.faceCount`);
    const vertices = requireAsset(
      manifest,
      geometry.vertices,
      `$.geometries.${geometryId}.vertices`,
      'vertices'
    );
    const faces = requireAsset(
      manifest,
      geometry.faces,
      `$.geometries.${geometryId}.faces`,
      'faces'
    );
    if (vertices.dtype !== 'float32' || vertices.shape.join('x') !== `${geometry.vertexCount}x3`) {
      throw new SceneManifestError(
        `$.geometries.${geometryId}.vertices`,
        'must be float32 with shape [vertexCount, 3]'
      );
    }
    if (faces.dtype !== 'uint32' || faces.shape.join('x') !== `${geometry.faceCount}x3`) {
      throw new SceneManifestError(
        `$.geometries.${geometryId}.faces`,
        'must be uint32 with shape [faceCount, 3]'
      );
    }
    if (geometry.curvature) {
      const curvature = requireAsset(
        manifest,
        geometry.curvature,
        `$.geometries.${geometryId}.curvature`,
        'curvature'
      );
      if (curvature.dtype !== 'float32' || curvature.shape[0] !== geometry.vertexCount) {
        throw new SceneManifestError(
          `$.geometries.${geometryId}.curvature`,
          'must be float32 with one value per vertex'
        );
      }
    }
  }

  const layerEntries = Object.entries(manifest.layers ?? {});
  if (layerEntries.length === 0) {
    throw new SceneManifestError('$.layers', 'must contain at least one layer');
  }
  for (const [layerId, layer] of layerEntries) {
    if (layer.id !== layerId) {
      throw new SceneManifestError(`$.layers.${layerId}.id`, 'must match its object key');
    }
    requireFinitePair(layer.limits, `$.layers.${layerId}.limits`);
    if (layer.threshold) requireFinitePair(layer.threshold, `$.layers.${layerId}.threshold`);
    if (layer.opacity !== undefined &&
        (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)) {
      throw new SceneManifestError(`$.layers.${layerId}.opacity`, 'must be between 0 and 1');
    }
    const valuesEntries = Object.entries(layer.values ?? {});
    if (valuesEntries.length === 0) {
      throw new SceneManifestError(`$.layers.${layerId}.values`, 'must not be empty');
    }
    for (const [geometryId, valueRef] of valuesEntries) {
      const geometry = manifest.geometries[geometryId];
      if (!geometry) {
        throw new SceneManifestError(
          `$.layers.${layerId}.values.${geometryId}`,
          'references unknown geometry'
        );
      }
      const values = requireAsset(
        manifest,
        valueRef.values,
        `$.layers.${layerId}.values.${geometryId}.values`,
        'values'
      );
      if (values.dtype !== 'float32') {
        throw new SceneManifestError(
          `$.layers.${layerId}.values.${geometryId}.values`,
          'must be float32'
        );
      }
      if (valueRef.indices) {
        const indices = requireAsset(
          manifest,
          valueRef.indices,
          `$.layers.${layerId}.values.${geometryId}.indices`,
          'indices'
        );
        if (indices.dtype !== 'uint32' || indices.shape[0] !== values.shape[0]) {
          throw new SceneManifestError(
            `$.layers.${layerId}.values.${geometryId}.indices`,
            'must be uint32 with one index per value'
          );
        }
      } else if (values.shape[0] !== geometry.vertexCount) {
        throw new SceneManifestError(
          `$.layers.${layerId}.values.${geometryId}.values`,
          'must contain one value per vertex when indices are absent'
        );
      }
    }
  }
  if (manifest.selectedLayer && !manifest.layers[manifest.selectedLayer]) {
    throw new SceneManifestError('$.selectedLayer', 'references unknown layer');
  }
  return manifest;
}
