import {
  loadSurface,
  loadSurfaceFromFile,
  MeshAdjacencyError,
  SurfaceGeometryError,
  SurfaceLoadError,
  type Hemisphere,
  type SurfaceLoadErrorCode,
  type SurfaceLoadOptions
} from '../../src';

const controller = new AbortController();
const options: SurfaceLoadOptions = {
  signal: controller.signal,
  domParser: DOMParser,
  maxBytes: 1024
};
const hemisphere: Hemisphere = 'unknown';

void loadSurface('/mesh.gii', 'auto', hemisphere, 1_000, false, 100, options);
declare const file: File;
void loadSurfaceFromFile(file, 'auto', hemisphere, false, 100, options);

declare const error: unknown;
if (error instanceof SurfaceLoadError) {
  const code: SurfaceLoadErrorCode = error.code;
  const stage: 'detect' | 'fetch' | 'body' | 'decompress' | 'parse' | 'validate' = error.stage;
  void code;
  void stage;
}
if (error instanceof SurfaceGeometryError || error instanceof MeshAdjacencyError) {
  const code: string = error.code;
  void code;
}
