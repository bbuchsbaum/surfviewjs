import type { SubjectPackageManifest } from '../SubjectPackage';
import { serialize } from './StateSerializer';
import type { ViewerStateV1 } from './ViewerState';

export const SURFVIEW_EXPORT_SCHEMA = 'surfview.scene.v1';
export const SURFVIEW_VERSION = '2.2.0';

export type SceneAssetType = 'surface' | 'metric' | 'parcellation' | 'roi' | 'volume' | 'transform' | 'scene' | 'other';

export interface SceneAssetManifest {
  id: string;
  type: SceneAssetType;
  uri: string;
  format?: string;
  byteLength?: number;
  checksum?: string;
  role?: string;
  metadata?: Record<string, unknown>;
}

export interface SceneExportProvenance {
  sourceFiles: string[];
  transforms: Record<string, unknown>;
  softwareVersions: {
    surfview: string;
    generator?: string;
  };
  timestamp: string;
  [key: string]: unknown;
}

export interface SceneExportManifest {
  schemaVersion: typeof SURFVIEW_EXPORT_SCHEMA;
  id: string;
  createdAt: string;
  surfviewVersion: string;
  state: ViewerStateV1;
  assets: SceneAssetManifest[];
  provenance: SceneExportProvenance;
  subject?: SubjectPackageManifest;
  metadata?: Record<string, unknown>;
}

export interface SceneExportOptions {
  id?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  assets?: SceneAssetManifest[];
  subject?: SubjectPackageManifest | { manifest: SubjectPackageManifest };
  provenance?: Partial<SceneExportProvenance> & Record<string, unknown>;
  state?: ViewerStateV1;
  pretty?: boolean;
}

export interface StaticHTMLExportOptions extends SceneExportOptions {
  title?: string;
  containerId?: string;
  scriptUrl?: string;
}

interface AssetRef {
  uri: string;
  format?: string;
  byteLength?: number;
  checksum?: string;
}

export function exportScene(viewer: unknown, options: SceneExportOptions = {}): SceneExportManifest {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const state = options.state ?? serialize(viewer);
  const subject = normalizeSubject(options.subject);
  const subjectAssets = subject ? collectSubjectAssets(subject) : [];
  const assets = dedupeAssets([...(options.assets ?? []), ...subjectAssets]);
  const sourceFiles = uniqueStrings([
    ...(options.provenance?.sourceFiles ?? []),
    ...(subject?.provenance?.sourceFiles ?? []),
    ...assets.map(asset => asset.uri)
  ]);

  return {
    schemaVersion: SURFVIEW_EXPORT_SCHEMA,
    id: options.id ?? `scene-${createdAt.replace(/[:.]/g, '-')}`,
    createdAt,
    surfviewVersion: SURFVIEW_VERSION,
    state,
    assets,
    provenance: {
      ...options.provenance,
      sourceFiles,
      transforms: {
        ...collectSubjectTransforms(subject),
        ...(options.provenance?.transforms ?? {})
      },
      softwareVersions: {
        surfview: SURFVIEW_VERSION,
        ...(options.provenance?.softwareVersions ?? {})
      },
      timestamp: options.provenance?.timestamp ?? createdAt
    },
    ...(subject ? { subject } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {})
  };
}

export function exportSceneJSON(viewer: unknown, options: SceneExportOptions = {}): string {
  const scene = exportScene(viewer, options);
  return JSON.stringify(scene, null, options.pretty === false ? 0 : 2);
}

export function exportSceneBlob(viewer: unknown, options: SceneExportOptions = {}): Blob {
  return new Blob([exportSceneJSON(viewer, options)], {
    type: 'application/vnd.surfview.scene+json'
  });
}

export function exportStaticHTML(viewer: unknown, options: StaticHTMLExportOptions = {}): string {
  const scene = exportScene(viewer, options);
  const title = escapeHTML(options.title ?? scene.id);
  const containerId = options.containerId ?? 'surfview-root';
  const scriptUrl = options.scriptUrl ?? 'https://unpkg.com/surfview/dist/surfview.es.js';
  const sceneJSON = escapeScriptJSON(JSON.stringify(scene));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    html, body, #${escapeHTML(containerId)} { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    body { background: #000; }
  </style>
</head>
<body>
  <div id="${escapeHTML(containerId)}"></div>
  <script type="application/json" id="surfview-scene-manifest">${sceneJSON}</script>
  <script type="module">
    import { NeuroSurfaceViewer } from ${JSON.stringify(scriptUrl)};

    const manifest = JSON.parse(document.getElementById('surfview-scene-manifest').textContent);
    window.surfviewSceneManifest = manifest;
    window.restoreSurfViewScene = (viewer) => {
      if (!viewer || typeof viewer.fromJSON !== 'function') {
        throw new Error('restoreSurfViewScene requires a NeuroSurfaceViewer instance');
      }
      return viewer.fromJSON(manifest.state);
    };
    window.createSurfViewSceneViewer = (container = document.getElementById(${JSON.stringify(containerId)}), config = {}) => {
      const viewer = new NeuroSurfaceViewer(container, container.clientWidth || 800, container.clientHeight || 600, config);
      window.restoreSurfViewScene(viewer);
      return viewer;
    };
  </script>
</body>
</html>`;
}

function normalizeSubject(subject: SceneExportOptions['subject']): SubjectPackageManifest | undefined {
  if (!subject) return undefined;
  if ('manifest' in subject) return subject.manifest;
  return subject;
}

function collectSubjectAssets(subject: SubjectPackageManifest): SceneAssetManifest[] {
  const assets: SceneAssetManifest[] = [];

  subject.surfaces.forEach(surface => {
    surface.variants.forEach(variant => {
      pushAsset(assets, `${surface.id}:${variant.name}`, 'surface', variant.file, variant.kind);
    });
  });
  subject.metrics?.forEach(metric => pushAsset(assets, metric.id, 'metric', metric.file, metric.kind));
  subject.parcellations?.forEach(parcellation => pushAsset(assets, parcellation.id, 'parcellation', parcellation.file));
  subject.rois?.forEach(roi => {
    if (roi.file) pushAsset(assets, roi.id, 'roi', roi.file);
  });
  subject.volumes?.forEach(volume => pushAsset(assets, volume.id, 'volume', volume.file, volume.space));
  subject.transforms?.forEach(transform => {
    if (transform.source) pushAsset(assets, transform.id, 'transform', transform.source, transform.kind);
  });

  return assets;
}

function pushAsset(
  assets: SceneAssetManifest[],
  id: string,
  type: SceneAssetType,
  asset: string | AssetRef,
  role?: string
): void {
  const ref = typeof asset === 'string' ? { uri: asset } : asset;
  if (!ref.uri) return;
  assets.push({
    id,
    type,
    uri: ref.uri,
    ...(ref.format ? { format: ref.format } : {}),
    ...(ref.byteLength ? { byteLength: ref.byteLength } : {}),
    ...(ref.checksum ? { checksum: ref.checksum } : {}),
    ...(role ? { role } : {})
  });
}

function collectSubjectTransforms(subject: SubjectPackageManifest | undefined): Record<string, unknown> {
  if (!subject?.transforms) return {};
  return Object.fromEntries(subject.transforms.map(transform => [
    transform.id,
    {
      from: transform.from,
      to: transform.to,
      kind: transform.kind ?? 'affine',
      matrix: transform.matrix
    }
  ]));
}

function dedupeAssets(assets: SceneAssetManifest[]): SceneAssetManifest[] {
  const seen = new Set<string>();
  const result: SceneAssetManifest[] = [];
  for (const asset of assets) {
    const key = `${asset.type}:${asset.id}:${asset.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(value => typeof value === 'string' && value.length > 0)));
}

function escapeScriptJSON(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
