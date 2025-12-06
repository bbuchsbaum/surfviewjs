import { SurfaceGeometry } from './classes';

export interface ParsedSurfaceData {
  vertices: Float32Array;
  faces: Uint32Array;
}

export type SurfaceFormat = 'freesurfer' | 'gifti' | 'ply' | 'auto';

export declare function parseFreeSurferSurface(buffer: ArrayBuffer): ParsedSurfaceData;
export declare function parseGIfTISurface(xmlString: string): ParsedSurfaceData;
export declare function parsePLY(data: string | ArrayBuffer): ParsedSurfaceData;

export declare function loadSurface(
  url: string, 
  format?: SurfaceFormat, 
  hemisphere?: 'left' | 'right' | 'both' | 'unknown'
): Promise<SurfaceGeometry>;

export declare function loadSurfaceFromFile(
  file: File, 
  format?: SurfaceFormat, 
  hemisphere?: 'left' | 'right' | 'both' | 'unknown'
): Promise<SurfaceGeometry>;

export declare function parseFreeSurferCurvature(data: string | ArrayBuffer): Float32Array;