import type { ViewerState } from './serialization';

export type SubjectHemisphere = 'left' | 'right' | 'both' | 'unknown';

export interface PackageAssetRef {
  uri: string;
  format?: string;
  byteLength?: number;
  checksum?: string;
}

export interface SubjectPackageSoftware {
  surfview?: string;
  generator?: string;
  generatedAt?: string;
}

export interface SubjectPackageProvenance {
  sourceFiles?: string[];
  pipeline?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface SurfaceVariantManifest {
  name: string;
  kind?: 'pial' | 'white' | 'inflated' | 'flat' | 'sphere' | string;
  file: string | PackageAssetRef;
  vertexCount: number;
  faceCount?: number;
  hemisphere?: SubjectHemisphere;
  topologyKey?: string;
}

export interface SurfaceSetManifest {
  id: string;
  hemisphere: SubjectHemisphere;
  defaultVariant: string;
  variants: SurfaceVariantManifest[];
}

export interface MetricManifest {
  id: string;
  kind?: 'curvature' | 'scalar' | 'label' | string;
  file: string | PackageAssetRef;
  surface: string;
  variant?: string;
  vertexCount: number;
  hemisphere?: SubjectHemisphere;
}

export interface ParcellationManifest {
  id: string;
  file: string | PackageAssetRef;
  surface: string;
  vertexCount: number;
  labelCount?: number;
  hemisphere?: SubjectHemisphere;
}

export interface RoiManifest {
  id: string;
  file?: string | PackageAssetRef;
  surface: string;
  vertexCount?: number;
  vertexIndices?: number[];
  hemisphere?: SubjectHemisphere;
  provenance?: SubjectPackageProvenance;
}

export interface TransformManifest {
  id: string;
  from: string;
  to: string;
  matrix: number[];
  kind?: 'affine' | string;
  source?: string | PackageAssetRef;
}

export interface VolumeManifest {
  id: string;
  file: string | PackageAssetRef;
  dims: [number, number, number];
  transform?: string;
  space?: string;
  dataType?: string;
}

export type SceneLayerSourceType = 'metric' | 'volume' | 'roi' | 'parcellation';

export interface SceneLayerManifest {
  id: string;
  source: {
    type: SceneLayerSourceType;
    id: string;
  };
  surface?: string;
  transform?: string;
  visible?: boolean;
  opacity?: number;
  [key: string]: unknown;
}

export interface SceneSurfaceManifest {
  surface: string;
  variant?: string;
}

export interface SceneManifest {
  id: string;
  label?: string;
  surfaces?: SceneSurfaceManifest[];
  layers?: SceneLayerManifest[];
  viewerState?: ViewerState;
}

export interface SubjectPackageManifest {
  schemaVersion: string;
  id: string;
  name?: string;
  software?: SubjectPackageSoftware;
  provenance?: SubjectPackageProvenance;
  surfaces: SurfaceSetManifest[];
  metrics?: MetricManifest[];
  parcellations?: ParcellationManifest[];
  rois?: RoiManifest[];
  transforms?: TransformManifest[];
  volumes?: VolumeManifest[];
  scenes?: SceneManifest[];
  defaultScene?: string;
}

export type ValidationSeverity = 'error' | 'warning';

export interface SubjectPackageValidationIssue {
  severity: ValidationSeverity;
  code: string;
  path: string;
  message: string;
}

export interface SubjectPackageValidationReport {
  valid: boolean;
  issues: SubjectPackageValidationIssue[];
  errors: SubjectPackageValidationIssue[];
  warnings: SubjectPackageValidationIssue[];
}

const VALID_HEMISPHERES = new Set<SubjectHemisphere>(['left', 'right', 'both', 'unknown']);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeHemisphere(value: SubjectHemisphere | undefined): SubjectHemisphere {
  return value ?? 'unknown';
}

function addIssue(
  issues: SubjectPackageValidationIssue[],
  severity: ValidationSeverity,
  code: string,
  path: string,
  message: string
): void {
  issues.push({ severity, code, path, message });
}

function getAssetUri(asset: string | PackageAssetRef | undefined): string | null {
  if (typeof asset === 'string') return asset;
  if (asset && typeof asset.uri === 'string') return asset.uri;
  return null;
}

function pathJoin(base: string, key: string | number): string {
  return base ? `${base}.${key}` : String(key);
}

function assertUniqueId<T extends { id: string }>(
  items: T[] | undefined,
  path: string,
  issues: SubjectPackageValidationIssue[]
): Set<string> {
  const ids = new Set<string>();
  if (!items) return ids;

  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isNonEmptyString(item.id)) {
      addIssue(issues, 'error', 'missing-id', `${itemPath}.id`, `${path} item requires a non-empty id`);
      return;
    }
    if (ids.has(item.id)) {
      addIssue(issues, 'error', 'duplicate-id', `${itemPath}.id`, `Duplicate id "${item.id}" in ${path}`);
      return;
    }
    ids.add(item.id);
  });

  return ids;
}

function validateAssetRef(
  asset: string | PackageAssetRef | undefined,
  path: string,
  issues: SubjectPackageValidationIssue[]
): void {
  const uri = getAssetUri(asset);
  if (!isNonEmptyString(uri)) {
    addIssue(issues, 'error', 'missing-asset-uri', path, 'Asset reference requires a non-empty URI');
  }
}

interface SurfaceIndexEntry {
  manifest: SurfaceSetManifest;
  vertexCount: number;
  faceCount?: number;
  variants: Set<string>;
}

function validateSurfaceSet(
  surface: SurfaceSetManifest,
  path: string,
  issues: SubjectPackageValidationIssue[]
): SurfaceIndexEntry | null {
  if (!isNonEmptyString(surface.id)) {
    addIssue(issues, 'error', 'missing-id', pathJoin(path, 'id'), 'Surface set requires a non-empty id');
  }

  if (!VALID_HEMISPHERES.has(surface.hemisphere)) {
    addIssue(issues, 'error', 'invalid-hemisphere', pathJoin(path, 'hemisphere'), `Invalid hemisphere "${surface.hemisphere}"`);
  }

  if (!isNonEmptyString(surface.defaultVariant)) {
    addIssue(issues, 'error', 'missing-default-variant', pathJoin(path, 'defaultVariant'), 'Surface set requires a default variant');
  }

  if (!Array.isArray(surface.variants) || surface.variants.length === 0) {
    addIssue(issues, 'error', 'missing-surface-variants', pathJoin(path, 'variants'), 'Surface set requires at least one variant');
    return null;
  }

  const variantNames = new Set<string>();
  let baseVertexCount: number | null = null;
  let baseFaceCount: number | undefined;

  surface.variants.forEach((variant, index) => {
    const variantPath = `${path}.variants[${index}]`;

    if (!isNonEmptyString(variant.name)) {
      addIssue(issues, 'error', 'missing-variant-name', `${variantPath}.name`, 'Surface variant requires a non-empty name');
    } else if (variantNames.has(variant.name)) {
      addIssue(issues, 'error', 'duplicate-variant-name', `${variantPath}.name`, `Duplicate surface variant "${variant.name}"`);
    } else {
      variantNames.add(variant.name);
    }

    validateAssetRef(variant.file, `${variantPath}.file`, issues);

    if (!isPositiveInteger(variant.vertexCount)) {
      addIssue(issues, 'error', 'invalid-vertex-count', `${variantPath}.vertexCount`, 'Surface variant vertexCount must be a positive integer');
    } else if (baseVertexCount === null) {
      baseVertexCount = variant.vertexCount;
    } else if (variant.vertexCount !== baseVertexCount) {
      addIssue(
        issues,
        'error',
        'surface-vertex-count-mismatch',
        `${variantPath}.vertexCount`,
        `Variant "${variant.name}" has ${variant.vertexCount} vertices; expected ${baseVertexCount}`
      );
    }

    if (variant.faceCount !== undefined) {
      if (!isPositiveInteger(variant.faceCount)) {
        addIssue(issues, 'error', 'invalid-face-count', `${variantPath}.faceCount`, 'Surface variant faceCount must be a positive integer');
      } else if (baseFaceCount === undefined) {
        baseFaceCount = variant.faceCount;
      } else if (variant.faceCount !== baseFaceCount) {
        addIssue(
          issues,
          'error',
          'surface-face-count-mismatch',
          `${variantPath}.faceCount`,
          `Variant "${variant.name}" has ${variant.faceCount} faces; expected ${baseFaceCount}`
        );
      }
    }

    const variantHemisphere = normalizeHemisphere(variant.hemisphere);
    if (!VALID_HEMISPHERES.has(variantHemisphere)) {
      addIssue(issues, 'error', 'invalid-hemisphere', `${variantPath}.hemisphere`, `Invalid hemisphere "${variant.hemisphere}"`);
    } else if (
      surface.hemisphere !== 'unknown' &&
      variantHemisphere !== 'unknown' &&
      variantHemisphere !== surface.hemisphere
    ) {
      addIssue(
        issues,
        'error',
        'surface-hemisphere-mismatch',
        `${variantPath}.hemisphere`,
        `Variant hemisphere "${variantHemisphere}" does not match surface hemisphere "${surface.hemisphere}"`
      );
    }
  });

  if (surface.defaultVariant && !variantNames.has(surface.defaultVariant)) {
    addIssue(
      issues,
      'error',
      'missing-default-variant',
      pathJoin(path, 'defaultVariant'),
      `Default variant "${surface.defaultVariant}" is not present in variants`
    );
  }

  return {
    manifest: surface,
    vertexCount: baseVertexCount ?? 0,
    faceCount: baseFaceCount,
    variants: variantNames
  };
}

function getSurfaceEntry(
  surfaces: Map<string, SurfaceIndexEntry>,
  id: string,
  path: string,
  issues: SubjectPackageValidationIssue[]
): SurfaceIndexEntry | null {
  const entry = surfaces.get(id);
  if (!entry) {
    addIssue(issues, 'error', 'unknown-surface', path, `Unknown surface "${id}"`);
    return null;
  }
  return entry;
}

function validateSurfaceAlignedRecord(
  record: { id: string; surface: string; vertexCount?: number; hemisphere?: SubjectHemisphere; variant?: string },
  path: string,
  surfaces: Map<string, SurfaceIndexEntry>,
  issues: SubjectPackageValidationIssue[],
  codePrefix: string
): SurfaceIndexEntry | null {
  if (!isNonEmptyString(record.surface)) {
    addIssue(issues, 'error', `${codePrefix}-missing-surface`, `${path}.surface`, `${codePrefix} requires a surface id`);
    return null;
  }

  const surface = getSurfaceEntry(surfaces, record.surface, `${path}.surface`, issues);
  if (!surface) return null;

  if (record.vertexCount !== undefined && record.vertexCount !== surface.vertexCount) {
    addIssue(
      issues,
      'error',
      `${codePrefix}-vertex-count-mismatch`,
      `${path}.vertexCount`,
      `${codePrefix} "${record.id}" has ${record.vertexCount} vertices; surface "${record.surface}" has ${surface.vertexCount}`
    );
  }

  if (record.variant && !surface.variants.has(record.variant)) {
    addIssue(
      issues,
      'error',
      `${codePrefix}-unknown-variant`,
      `${path}.variant`,
      `${codePrefix} "${record.id}" references unknown variant "${record.variant}"`
    );
  }

  const hemi = normalizeHemisphere(record.hemisphere);
  if (!VALID_HEMISPHERES.has(hemi)) {
    addIssue(issues, 'error', 'invalid-hemisphere', `${path}.hemisphere`, `Invalid hemisphere "${record.hemisphere}"`);
  } else if (
    record.hemisphere &&
    hemi !== 'unknown' &&
    surface.manifest.hemisphere !== 'unknown' &&
    hemi !== surface.manifest.hemisphere
  ) {
    addIssue(
      issues,
      'error',
      `${codePrefix}-hemisphere-mismatch`,
      `${path}.hemisphere`,
      `${codePrefix} hemisphere "${hemi}" does not match surface hemisphere "${surface.manifest.hemisphere}"`
    );
  }

  return surface;
}

function validateTransform(
  transform: TransformManifest,
  path: string,
  issues: SubjectPackageValidationIssue[]
): void {
  if (!isNonEmptyString(transform.from)) {
    addIssue(issues, 'error', 'missing-transform-from', `${path}.from`, 'Transform requires a source space');
  }
  if (!isNonEmptyString(transform.to)) {
    addIssue(issues, 'error', 'missing-transform-to', `${path}.to`, 'Transform requires a target space');
  }
  if (!Array.isArray(transform.matrix) || transform.matrix.length !== 16 || !transform.matrix.every(isFiniteNumber)) {
    addIssue(issues, 'error', 'invalid-transform-matrix', `${path}.matrix`, 'Transform matrix must contain 16 finite numbers');
  }
}

function validateVolume(
  volume: VolumeManifest,
  path: string,
  transformIds: Set<string>,
  issues: SubjectPackageValidationIssue[]
): void {
  validateAssetRef(volume.file, `${path}.file`, issues);

  if (!Array.isArray(volume.dims) || volume.dims.length !== 3 || !volume.dims.every(isPositiveInteger)) {
    addIssue(issues, 'error', 'invalid-volume-dims', `${path}.dims`, 'Volume dims must contain three positive integers');
  }

  if (volume.transform && !transformIds.has(volume.transform)) {
    addIssue(issues, 'error', 'unknown-transform', `${path}.transform`, `Unknown transform "${volume.transform}"`);
  }
}

function validateScene(
  scene: SceneManifest,
  path: string,
  surfaces: Map<string, SurfaceIndexEntry>,
  sourceIds: Record<SceneLayerSourceType, Set<string>>,
  transformIds: Set<string>,
  issues: SubjectPackageValidationIssue[]
): void {
  if (scene.surfaces) {
    scene.surfaces.forEach((sceneSurface, index) => {
      const surfacePath = `${path}.surfaces[${index}]`;
      const surface = getSurfaceEntry(surfaces, sceneSurface.surface, `${surfacePath}.surface`, issues);
      if (surface && sceneSurface.variant && !surface.variants.has(sceneSurface.variant)) {
        addIssue(issues, 'error', 'scene-unknown-variant', `${surfacePath}.variant`, `Scene references unknown variant "${sceneSurface.variant}"`);
      }
    });
  }

  if (scene.layers) {
    const layerIds = new Set<string>();
    scene.layers.forEach((layer, index) => {
      const layerPath = `${path}.layers[${index}]`;
      if (!isNonEmptyString(layer.id)) {
        addIssue(issues, 'error', 'missing-layer-id', `${layerPath}.id`, 'Scene layer requires a non-empty id');
      } else if (layerIds.has(layer.id)) {
        addIssue(issues, 'error', 'duplicate-layer-id', `${layerPath}.id`, `Duplicate scene layer "${layer.id}"`);
      } else {
        layerIds.add(layer.id);
      }

      const sourceType = layer.source?.type;
      const sourceId = layer.source?.id;
      if (!sourceType || !sourceIds[sourceType]) {
        addIssue(issues, 'error', 'invalid-layer-source-type', `${layerPath}.source.type`, 'Scene layer source type must be metric, volume, roi, or parcellation');
      } else if (!sourceIds[sourceType].has(sourceId)) {
        addIssue(issues, 'error', 'unknown-layer-source', `${layerPath}.source.id`, `Unknown ${sourceType} source "${sourceId}"`);
      }

      if (layer.surface) {
        getSurfaceEntry(surfaces, layer.surface, `${layerPath}.surface`, issues);
      }
      if (layer.transform && !transformIds.has(layer.transform)) {
        addIssue(issues, 'error', 'unknown-transform', `${layerPath}.transform`, `Unknown transform "${layer.transform}"`);
      }
    });
  }
}

export function validateSubjectPackageManifest(manifest: SubjectPackageManifest): SubjectPackageValidationReport {
  const issues: SubjectPackageValidationIssue[] = [];

  if (!isObject(manifest)) {
    addIssue(issues, 'error', 'invalid-manifest', '', 'Subject package manifest must be an object');
    return buildReport(issues);
  }

  if (!isNonEmptyString(manifest.schemaVersion)) {
    addIssue(issues, 'error', 'missing-schema-version', 'schemaVersion', 'Manifest requires a schemaVersion');
  }
  if (!isNonEmptyString(manifest.id)) {
    addIssue(issues, 'error', 'missing-id', 'id', 'Manifest requires a non-empty id');
  }
  if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length === 0) {
    addIssue(issues, 'error', 'missing-surfaces', 'surfaces', 'Manifest requires at least one surface set');
  }

  const surfaceIds = assertUniqueId(manifest.surfaces, 'surfaces', issues);
  const metricIds = assertUniqueId(manifest.metrics, 'metrics', issues);
  const parcellationIds = assertUniqueId(manifest.parcellations, 'parcellations', issues);
  const roiIds = assertUniqueId(manifest.rois, 'rois', issues);
  const transformIds = assertUniqueId(manifest.transforms, 'transforms', issues);
  const volumeIds = assertUniqueId(manifest.volumes, 'volumes', issues);
  const sceneIds = assertUniqueId(manifest.scenes, 'scenes', issues);

  const surfaces = new Map<string, SurfaceIndexEntry>();
  if (Array.isArray(manifest.surfaces)) {
    manifest.surfaces.forEach((surface, index) => {
      const entry = validateSurfaceSet(surface, `surfaces[${index}]`, issues);
      if (entry && surfaceIds.has(surface.id)) {
        surfaces.set(surface.id, entry);
      }
    });
  }

  manifest.metrics?.forEach((metric, index) => {
    const path = `metrics[${index}]`;
    validateAssetRef(metric.file, `${path}.file`, issues);
    validateSurfaceAlignedRecord(metric, path, surfaces, issues, 'metric');
  });

  manifest.parcellations?.forEach((parcellation, index) => {
    const path = `parcellations[${index}]`;
    validateAssetRef(parcellation.file, `${path}.file`, issues);
    validateSurfaceAlignedRecord(parcellation, path, surfaces, issues, 'parcellation');
  });

  manifest.rois?.forEach((roi, index) => {
    const path = `rois[${index}]`;
    if (roi.file) validateAssetRef(roi.file, `${path}.file`, issues);
    const surface = validateSurfaceAlignedRecord(roi, path, surfaces, issues, 'roi');
    if (surface && roi.vertexIndices) {
      roi.vertexIndices.forEach((vertexIndex, vertexOffset) => {
        if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= surface.vertexCount) {
          addIssue(
            issues,
            'error',
            'roi-vertex-out-of-range',
            `${path}.vertexIndices[${vertexOffset}]`,
            `ROI "${roi.id}" references vertex ${vertexIndex}; valid range is 0-${surface.vertexCount - 1}`
          );
        }
      });
    }
  });

  manifest.transforms?.forEach((transform, index) => {
    validateTransform(transform, `transforms[${index}]`, issues);
  });

  manifest.volumes?.forEach((volume, index) => {
    validateVolume(volume, `volumes[${index}]`, transformIds, issues);
  });

  const sourceIds: Record<SceneLayerSourceType, Set<string>> = {
    metric: metricIds,
    volume: volumeIds,
    roi: roiIds,
    parcellation: parcellationIds
  };

  manifest.scenes?.forEach((scene, index) => {
    validateScene(scene, `scenes[${index}]`, surfaces, sourceIds, transformIds, issues);
  });

  if (manifest.defaultScene && !sceneIds.has(manifest.defaultScene)) {
    addIssue(issues, 'error', 'unknown-default-scene', 'defaultScene', `Default scene "${manifest.defaultScene}" is not present in scenes`);
  }

  return buildReport(issues);
}

function buildReport(issues: SubjectPackageValidationIssue[]): SubjectPackageValidationReport {
  const errors = issues.filter(issue => issue.severity === 'error');
  const warnings = issues.filter(issue => issue.severity === 'warning');
  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings
  };
}

export interface SubjectPackageOptions {
  validate?: boolean;
}

export interface SubjectPackageLoadOptions extends SubjectPackageOptions {
  fetch?: typeof fetch;
}

export class SubjectPackage {
  readonly manifest: SubjectPackageManifest;
  readonly validation: SubjectPackageValidationReport;

  constructor(manifest: SubjectPackageManifest, options: SubjectPackageOptions = {}) {
    this.manifest = manifest;
    this.validation = validateSubjectPackageManifest(manifest);

    if (options.validate !== false && !this.validation.valid) {
      const summary = this.validation.errors
        .slice(0, 5)
        .map(issue => `${issue.path}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid SubjectPackage manifest: ${summary}`);
    }
  }

  static fromManifest(manifest: SubjectPackageManifest, options: SubjectPackageOptions = {}): SubjectPackage {
    return new SubjectPackage(manifest, options);
  }

  static async load(url: string, options: SubjectPackageLoadOptions = {}): Promise<SubjectPackage> {
    const fetcher = options.fetch ?? globalThis.fetch;
    if (!fetcher) {
      throw new Error('SubjectPackage.load requires fetch or options.fetch');
    }

    const response = await fetcher(url);
    if (!response.ok) {
      throw new Error(`Failed to load SubjectPackage manifest from ${url}: ${response.status} ${response.statusText}`);
    }

    const manifest = await response.json() as SubjectPackageManifest;
    return new SubjectPackage(manifest, options);
  }

  get id(): string {
    return this.manifest.id;
  }

  getSurfaceSet(id: string): SurfaceSetManifest | null {
    return this.manifest.surfaces.find(surface => surface.id === id) ?? null;
  }

  getSurfaceVariant(surfaceId: string, variantName?: string): SurfaceVariantManifest | null {
    const surface = this.getSurfaceSet(surfaceId);
    if (!surface) return null;

    const target = variantName ?? surface.defaultVariant;
    return surface.variants.find(variant => variant.name === target) ?? null;
  }

  getMetric(id: string): MetricManifest | null {
    return this.manifest.metrics?.find(metric => metric.id === id) ?? null;
  }

  getTransform(id: string): TransformManifest | null {
    return this.manifest.transforms?.find(transform => transform.id === id) ?? null;
  }

  getScene(id = this.manifest.defaultScene): SceneManifest | null {
    if (!id) return null;
    return this.manifest.scenes?.find(scene => scene.id === id) ?? null;
  }
}
