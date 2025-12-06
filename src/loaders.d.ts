import { SurfaceGeometry } from './classes';

export interface ParsedSurfaceData {
  vertices: Float32Array;
  faces: Uint32Array;
}

export type SurfaceFormat = 'freesurfer' | 'gifti' | 'ply' | 'auto';

export declare function parseFreeSurferSurface(buffer: ArrayBuffer): ParsedSurfaceData;
export declare function getDomParser(domParser?: typeof DOMParser): Promise<typeof DOMParser>;
export declare function parseGIfTISurface(xmlString: string, domParser?: typeof DOMParser): ParsedSurfaceData;
export declare function parsePLY(data: string | ArrayBuffer): ParsedSurfaceData;

export declare function loadSurface(
  url: string, 
  format?: SurfaceFormat, 
  hemisphere?: 'left' | 'right' | 'both' | 'unknown',
  timeoutMs?: number,
  autoScale?: boolean,
  targetSize?: number
): Promise<SurfaceGeometry>;

export declare function loadSurfaceFromFile(
  file: File, 
  format?: SurfaceFormat, 
  hemisphere?: 'left' | 'right' | 'both' | 'unknown',
  autoScale?: boolean,
  targetSize?: number
): Promise<SurfaceGeometry>;

export declare function parseFreeSurferCurvature(data: string | ArrayBuffer): Float32Array;
