/**
 * Loaders for common neuroimaging surface formats
 */

import { gunzipSync, unzlibSync } from 'fflate';
import { SurfaceGeometry } from './classes';
import { SurfaceScaler } from './utils/SurfaceScaler';

export type SurfaceFormat = 'freesurfer' | 'gifti' | 'ply' | 'auto';
export type Hemisphere = 'left' | 'right' | 'both' | 'unknown';

export interface ParsedSurfaceData {
  vertices: Float32Array;
  faces: Uint32Array;
}

export async function getDomParser(domParser?: typeof DOMParser): Promise<typeof DOMParser> {
  if (domParser) return domParser;
  if (typeof DOMParser !== 'undefined') return DOMParser;

  // Attempt a lazy jsdom import only in Node; keep dynamic to avoid bundler resolution.
  const isNode = typeof globalThis !== 'undefined' && !!(globalThis as any).process?.versions?.node;
  if (isNode) {
    try {
      const moduleName = 'jsdom';
      const mod: any = await import(moduleName);
      if (mod?.JSDOM) {
        return new mod.JSDOM().window.DOMParser as typeof DOMParser;
      }
      if (mod?.DOMParser) {
        return mod.DOMParser as typeof DOMParser;
      }
    } catch (err) {
      throw new Error('DOMParser not available; install jsdom or pass a DOMParser to parseGIfTISurface. ' + (err as Error).message);
    }
  }

  throw new Error('DOMParser not available; supply one (e.g., from jsdom) to parse GIFTI.');
}

/**
 * Parse FreeSurfer surface format
 */
export function parseFreeSurferSurface(buffer: ArrayBuffer): ParsedSurfaceData {
  // Basic validation
  if (!buffer || buffer.byteLength < 15) {
    throw new Error('Invalid FreeSurfer surface: file too small');
  }
  
  const view = new DataView(buffer);
  let offset = 0;
  
  // Skip magic bytes (3 bytes)
  offset += 3;
  
  // Skip comment line - read until newline (with bounds check)
  while (offset < buffer.byteLength && view.getUint8(offset) !== 0x0A) {
    offset++;
    if (offset >= buffer.byteLength) {
      throw new Error('Invalid FreeSurfer surface: unexpected end of file');
    }
  }
  offset++; // Skip the newline
  
  // Skip second newline
  offset++;
  
  // Check we have enough data for counts
  if (offset + 8 > buffer.byteLength) {
    throw new Error('Invalid FreeSurfer surface: missing vertex/face counts');
  }
  
  // Read number of vertices and faces
  const nVertices = view.getInt32(offset, false);
  offset += 4;
  const nFaces = view.getInt32(offset, false);
  offset += 4;
  
  // Validate counts
  if (nVertices <= 0 || nVertices > 10000000) {
    throw new Error(`Invalid FreeSurfer surface: vertex count out of range (${nVertices})`);
  }
  if (nFaces <= 0 || nFaces > 20000000) {
    throw new Error(`Invalid FreeSurfer surface: face count out of range (${nFaces})`);
  }
  
  // Check we have enough data for vertices and faces
  const expectedSize = offset + (nVertices * 3 * 4) + (nFaces * 3 * 4);
  if (buffer.byteLength < expectedSize) {
    throw new Error('Invalid FreeSurfer surface: file truncated');
  }
  
  // Read vertices
  const vertices = new Float32Array(nVertices * 3);
  for (let i = 0; i < nVertices * 3; i++) {
    vertices[i] = view.getFloat32(offset, false);
    offset += 4;
  }
  
  // Read faces
  const faces = new Uint32Array(nFaces * 3);
  for (let i = 0; i < nFaces * 3; i++) {
    faces[i] = view.getInt32(offset, false);
    offset += 4;
  }
  
  return { vertices, faces };
}

/**
 * Parse GIfTI surface format (.gii)
 */
export function parseGIfTISurface(xmlString: string, domParser?: typeof DOMParser): ParsedSurfaceData {
  // Basic validation
  if (!xmlString || xmlString.length < 20) {
    throw new Error('Invalid GIFTI surface: empty or too small');
  }

  const DOMParserImpl = domParser || (typeof DOMParser !== 'undefined' ? DOMParser : null);
  if (!DOMParserImpl) {
    throw new Error('GIFTI parsing requires DOMParser; provide one (e.g., from jsdom) when running outside the browser.');
  }

  const parser = new DOMParserImpl();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  
  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid GIFTI surface: XML parse error');
  }
  
  let vertices: Float32Array | null = null;
  let faces: Uint32Array | null = null;
  
  const dataArrays = doc.getElementsByTagName('DataArray');
  
  for (let i = 0; i < dataArrays.length; i++) {
    const dataArray = dataArrays[i];
    const intent = dataArray.getAttribute('Intent');
    const dataType = dataArray.getAttribute('DataType');
    const encoding = dataArray.getAttribute('Encoding');
    const endian = dataArray.getAttribute('Endian') || 'LittleEndian';
    
    if (intent === 'NIFTI_INTENT_POINTSET') {
      // Vertices
      const parsed = parseGIfTIDataArray(dataArray, dataType || '', encoding || '', endian);
      if (parsed instanceof Float32Array) {
        vertices = parsed;
      }
    } else if (intent === 'NIFTI_INTENT_TRIANGLE') {
      // Faces
      const parsed = parseGIfTIDataArray(dataArray, dataType || '', encoding || '', endian);
      if (parsed instanceof Uint32Array) {
        faces = parsed;
      }
    }
  }
  
  if (!vertices || !faces) {
    throw new Error('Failed to parse GIFTI surface: missing vertices or faces');
  }
  
  return { vertices, faces };
}

/**
 * Parse a GIFTI data array
 * @private
 */
function parseGIfTIDataArray(
  dataArray: Element, 
  dataType: string, 
  encoding: string, 
  endian: string
): Float32Array | Uint32Array | null {
  const data = dataArray.getElementsByTagName('Data')[0];
  if (!data || !data.textContent) return null;
  
  const text = data.textContent.trim();
  const littleEndian = endian !== 'BigEndian';

  if (encoding === 'ASCII') {
    // ASCII encoding
    const values = text.split(/\s+/).filter(v => v.length > 0);
    if (dataType === 'NIFTI_TYPE_FLOAT32') {
      return new Float32Array(values.map(parseFloat));
    } else if (dataType === 'NIFTI_TYPE_INT32' || dataType === 'NIFTI_TYPE_UINT32') {
      return new Uint32Array(values.map(v => parseInt(v, 10)));
    }
  } else if (encoding === 'Base64Binary') {
    const buffer = base64ToArrayBuffer(text);
    return toTypedArray(buffer, dataType, littleEndian);
  } else if (encoding === 'GZipBase64Binary') {
    try {
      const compressed = base64ToUint8(text);
      let unzipped: Uint8Array;

      try {
        // Standard path: GZIP header present
        unzipped = gunzipSync(compressed);
      } catch (gzipError) {
        // Some writers (e.g. certain FreeSurfer exports) mark data as GZipBase64Binary
        // but actually store raw zlib/deflate content. Try inflate as a graceful fallback.
        try {
          unzipped = unzlibSync(compressed);
          console.warn('GZipBase64Binary payload lacked gzip header; unzlib fallback succeeded.');
        } catch (inflateError) {
          console.warn('Failed to decompress GZipBase64Binary GIFTI data array', gzipError, inflateError);
          throw inflateError;
        }
      }
      const buffer = new ArrayBuffer(unzipped.byteLength);
      new Uint8Array(buffer).set(unzipped);
      return toTypedArray(buffer, dataType, littleEndian);
    } catch (err) {
      // Let caller surface a meaningful error instead of falling through to "missing vertices"
      throw err;
    }
  }
  
  return null;
}

/**
 * Convert a base64 string into an ArrayBuffer
 */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const decoded = atob(b64.replace(/\s+/g, ''));
  const buffer = new ArrayBuffer(decoded.length);
  const view = new Uint8Array(buffer);
  for (let j = 0; j < decoded.length; j++) {
    view[j] = decoded.charCodeAt(j);
  }
  return buffer;
}

/**
 * Convert a base64 string into a Uint8Array
 */
function base64ToUint8(b64: string): Uint8Array {
  const buffer = base64ToArrayBuffer(b64);
  return new Uint8Array(buffer);
}

/**
 * Create the appropriate typed array for a given dataType code
 */
function toTypedArray(
  buffer: ArrayBuffer, 
  dataType: string, 
  littleEndian: boolean
): Float32Array | Uint32Array | null {
  const dv = new DataView(buffer);

  if (dataType === 'NIFTI_TYPE_FLOAT32') {
    if (littleEndian) return new Float32Array(buffer);
    const length = buffer.byteLength / 4;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = dv.getFloat32(i * 4, littleEndian);
    }
    return out;
  } else if (dataType === 'NIFTI_TYPE_FLOAT64') {
    const length = buffer.byteLength / 8;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = dv.getFloat64(i * 8, littleEndian);
    }
    return out;
  } else if (dataType === 'NIFTI_TYPE_INT32' || dataType === 'NIFTI_TYPE_UINT32') {
    if (littleEndian) return new Uint32Array(buffer);
    const length = buffer.byteLength / 4;
    const out = new Uint32Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = dv.getUint32(i * 4, littleEndian);
    }
    return out;
  } else if (dataType === 'NIFTI_TYPE_INT16') {
    const length = buffer.byteLength / 2;
    const out = new Uint32Array(length);
    for (let i = 0; i < length; i++) {
      const v = dv.getInt16(i * 2, littleEndian);
      out[i] = v;
    }
    return out;
  } else if (dataType === 'NIFTI_TYPE_UINT16') {
    const length = buffer.byteLength / 2;
    const out = new Uint32Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = dv.getUint16(i * 2, littleEndian);
    }
    return out;
  } else if (dataType === 'NIFTI_TYPE_UINT8' || dataType === 'NIFTI_TYPE_INT8') {
    const length = buffer.byteLength;
    const out = new Uint32Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = dv.getUint8(i);
    }
    return out;
  }
  console.warn(`Unsupported GIFTI DataType: ${dataType}`);
  return null;
}

/**
 * Parse PLY (Polygon File Format)
 */
export function parsePLY(data: string | ArrayBuffer): ParsedSurfaceData {
  // Basic validation
  if (!data) {
    throw new Error('Invalid PLY surface: no data provided');
  }
  
  let text: string;
  if (data instanceof ArrayBuffer) {
    if (data.byteLength === 0) {
      throw new Error('Invalid PLY surface: empty file');
    }
    text = new TextDecoder().decode(data);
  } else {
    text = data;
  }
  
  // Check for PLY header
  if (!text.startsWith('ply')) {
    throw new Error('Invalid PLY surface: missing PLY header');
  }
  
  const lines = text.split('\n');
  let headerEnd = 0;
  let vertexCount = 0;
  let faceCount = 0;
  
  // Parse header
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === 'end_header') {
      headerEnd = i + 1;
      break;
    }
    if (line.startsWith('element vertex')) {
      const parts = line.split(' ');
      if (parts.length >= 3) {
        vertexCount = parseInt(parts[2]);
        if (isNaN(vertexCount) || vertexCount <= 0) {
          throw new Error('Invalid PLY surface: invalid vertex count');
        }
      }
    }
    if (line.startsWith('element face')) {
      const parts = line.split(' ');
      if (parts.length >= 3) {
        faceCount = parseInt(parts[2]);
        if (isNaN(faceCount) || faceCount <= 0) {
          throw new Error('Invalid PLY surface: invalid face count');
        }
      }
    }
  }
  
  // Validate header was found
  if (headerEnd === 0) {
    throw new Error('Invalid PLY surface: no end_header found');
  }
  
  // Validate we have enough lines for data
  if (lines.length < headerEnd + vertexCount + faceCount) {
    throw new Error('Invalid PLY surface: insufficient data lines');
  }
  
  // Parse vertices
  const vertices = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const line = lines[headerEnd + i];
    if (!line) {
      throw new Error(`Invalid PLY surface: missing vertex data at line ${headerEnd + i}`);
    }
    const parts = line.trim().split(' ');
    if (parts.length < 3) {
      throw new Error(`Invalid PLY surface: incomplete vertex data at line ${headerEnd + i}`);
    }
    
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    const z = parseFloat(parts[2]);
    
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      throw new Error(`Invalid PLY surface: non-numeric vertex data at line ${headerEnd + i}`);
    }
    
    vertices[i * 3] = x;
    vertices[i * 3 + 1] = y;
    vertices[i * 3 + 2] = z;
  }
  
  // Parse faces
  const faces = new Uint32Array(faceCount * 3);
  for (let i = 0; i < faceCount; i++) {
    const line = lines[headerEnd + vertexCount + i];
    if (!line) {
      throw new Error(`Invalid PLY surface: missing face data at line ${headerEnd + vertexCount + i}`);
    }
    const parts = line.trim().split(' ');
    if (parts.length < 4) {
      throw new Error(`Invalid PLY surface: incomplete face data at line ${headerEnd + vertexCount + i}`);
    }
    
    const count = parseInt(parts[0]);
    if (count !== 3) {
      throw new Error(`Invalid PLY surface: non-triangular face at line ${headerEnd + vertexCount + i}`);
    }
    
    const v0 = parseInt(parts[1]);
    const v1 = parseInt(parts[2]);
    const v2 = parseInt(parts[3]);
    
    if (isNaN(v0) || isNaN(v1) || isNaN(v2)) {
      throw new Error(`Invalid PLY surface: non-numeric face indices at line ${headerEnd + vertexCount + i}`);
    }
    
    // Validate indices are in range
    if (v0 < 0 || v0 >= vertexCount || v1 < 0 || v1 >= vertexCount || v2 < 0 || v2 >= vertexCount) {
      throw new Error(`Invalid PLY surface: face index out of range at line ${headerEnd + vertexCount + i}`);
    }
    
    faces[i * 3] = v0;
    faces[i * 3 + 1] = v1;
    faces[i * 3 + 2] = v2;
  }
  
  return { vertices, faces };
}

/**
 * Load surface from URL with timeout and basic error handling
 */
export async function loadSurface(
  url: string, 
  format: SurfaceFormat = 'auto', 
  hemisphere: Hemisphere = 'unknown',
  timeoutMs: number = 30000, // 30 second default timeout
  autoScale: boolean = false, // Auto-scale small surfaces
  targetSize: number = 100 // Target size for auto-scaling
): Promise<SurfaceGeometry> {
  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  
  let parsedData: ParsedSurfaceData;
  let detectedFormat = format;
  
  if (format === 'auto') {
    // Try to determine format from URL
    if (url.endsWith('.gii')) {
      detectedFormat = 'gifti';
    } else if (url.endsWith('.ply')) {
      detectedFormat = 'ply';
    } else if (url.includes('lh.') || url.includes('rh.')) {
      detectedFormat = 'freesurfer';
    }
  }
  
    switch (detectedFormat) {
      case 'freesurfer':
        const fsBuffer = await response.arrayBuffer();
        parsedData = parseFreeSurferSurface(fsBuffer);
        break;
        
      case 'gifti':
        const giiText = await response.text();
        parsedData = parseGIfTISurface(giiText, await getDomParser());
        break;
        
      case 'ply':
        const plyText = await response.text();
        parsedData = parsePLY(plyText);
        break;
        
      default:
        throw new Error(`Unsupported format: ${detectedFormat}`);
    }
    
    // Basic validation
    if (!parsedData.vertices || !parsedData.faces) {
      throw new Error('Invalid surface data: missing vertices or faces');
    }
    
    // Auto-scale if requested
    if (autoScale) {
      const scaleFactor = SurfaceScaler.autoScale(parsedData.vertices, targetSize);
      if (scaleFactor !== 1) {
        console.log(`Auto-scaled surface by factor of ${scaleFactor}`);
      }
    }
    
    // Default to 'left' if hemisphere is unknown
    const actualHemisphere = (hemisphere === 'unknown' || !hemisphere) ? 'left' : hemisphere;
    
    return new SurfaceGeometry(
      parsedData.vertices,
      parsedData.faces,
      actualHemisphere
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
    throw new Error('Failed to load surface');
  }
}

/**
 * Load surface from File object
 */
export async function loadSurfaceFromFile(
  file: File, 
  format: SurfaceFormat = 'auto', 
  hemisphere: Hemisphere = 'unknown',
  autoScale: boolean = false,
  targetSize: number = 100
): Promise<SurfaceGeometry> {
  // Basic validation
  if (!file) {
    throw new Error('No file provided');
  }
  if (file.size === 0) {
    throw new Error('File is empty');
  }
  if (file.size > 500 * 1024 * 1024) { // 500MB limit
    throw new Error('File too large (max 500MB)');
  }
  
  let detectedFormat = format;
  
  if (format === 'auto') {
    // Try to determine format from filename
    if (file.name.endsWith('.gii')) {
      detectedFormat = 'gifti';
    } else if (file.name.endsWith('.ply')) {
      detectedFormat = 'ply';
    } else if (file.name.includes('lh.') || file.name.includes('rh.')) {
      detectedFormat = 'freesurfer';
    }
  }
  
  let parsedData: ParsedSurfaceData;
  
  switch (detectedFormat) {
    case 'freesurfer':
      const fsBuffer = await file.arrayBuffer();
      parsedData = parseFreeSurferSurface(fsBuffer);
      break;
      
    case 'gifti':
      const giiText = await file.text();
      parsedData = parseGIfTISurface(giiText, await getDomParser());
      break;
      
    case 'ply':
      const plyText = await file.text();
      parsedData = parsePLY(plyText);
      break;
      
    default:
      throw new Error(`Unsupported format: ${detectedFormat}`);
  }
  
  // Validate parsed data
  if (!parsedData.vertices || !parsedData.faces) {
    throw new Error('Invalid surface data: missing vertices or faces');
  }
  if (parsedData.vertices.length === 0 || parsedData.faces.length === 0) {
    throw new Error('Invalid surface data: empty vertices or faces');
  }
  
  // Try to detect hemisphere from filename
  let detectedHemisphere = hemisphere;
  if (hemisphere === 'unknown') {
    if (file.name.includes('lh.') || file.name.includes('left')) {
      detectedHemisphere = 'left';
    } else if (file.name.includes('rh.') || file.name.includes('right')) {
      detectedHemisphere = 'right';
    } else {
      // Default to 'left' if still unknown
      detectedHemisphere = 'left';
    }
  }
  
  // Auto-scale if requested
  if (autoScale) {
    const scaleFactor = SurfaceScaler.autoScale(parsedData.vertices, targetSize);
    if (scaleFactor !== 1) {
      console.log(`Auto-scaled surface by factor of ${scaleFactor}`);
    }
  }
  
  return new SurfaceGeometry(
    parsedData.vertices,
    parsedData.faces,
    detectedHemisphere
  );
}

/**
 * Load curvature data from FreeSurfer format
 */
export function parseFreeSurferCurvature(data: string | ArrayBuffer): Float32Array {
  let buffer: ArrayBuffer;
  if (typeof data === 'string') {
    // Convert string to ArrayBuffer
    const encoder = new TextEncoder();
    buffer = encoder.encode(data).buffer;
  } else {
    buffer = data;
  }
  
  // Basic validation
  if (!buffer || buffer.byteLength < 16) {
    throw new Error('Invalid FreeSurfer curvature: file too small');
  }
  
  const view = new DataView(buffer);
  let offset = 0;
  
  // Skip magic number (3 bytes)
  offset += 3;
  
  // Read number of vertices
  const nVertices = view.getInt32(offset, false);
  offset += 4;
  
  // Validate vertex count
  if (nVertices <= 0 || nVertices > 10000000) {
    throw new Error(`Invalid FreeSurfer curvature: vertex count out of range (${nVertices})`);
  }
  
  // Check we have enough data
  const expectedSize = offset + 8 + (nVertices * 4); // +8 for nFaces and valuesPerVertex
  if (buffer.byteLength < expectedSize) {
    throw new Error('Invalid FreeSurfer curvature: file truncated');
  }
  
  // Skip number of faces (not used in curvature)
  offset += 4;
  
  // Skip values per vertex (always 1 for curvature)
  offset += 4;
  
  // Read curvature values
  const curvature = new Float32Array(nVertices);
  for (let i = 0; i < nVertices; i++) {
    curvature[i] = view.getFloat32(offset, false);
    offset += 4;
  }
  
  return curvature;
}
