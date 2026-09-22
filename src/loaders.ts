/**
 * Loaders for common neuroimaging surface formats
 */

import { Gunzip, Unzlib } from 'fflate';
import {
  MAX_SURFACE_FACES,
  MAX_SURFACE_VERTICES,
  SurfaceGeometry,
  SurfaceGeometryError,
  validateSurfaceGeometryData
} from './classes';
import { SurfaceScaler } from './utils/SurfaceScaler';

export type SurfaceFormat = 'freesurfer' | 'gifti' | 'ply' | 'auto';
export type Hemisphere = 'left' | 'right' | 'both' | 'unknown';

export interface ParsedSurfaceData {
  vertices: Float32Array;
  faces: Uint32Array;
  hemisphere?: Hemisphere;
}

export type SurfaceLoadStage =
  | 'detect'
  | 'fetch'
  | 'body'
  | 'decompress'
  | 'parse'
  | 'validate';

export type SurfaceLoadErrorCode =
  | 'aborted'
  | 'timeout'
  | 'http-error'
  | 'unsupported-format'
  | 'dom-parser-unavailable'
  | 'invalid-magic'
  | 'invalid-header'
  | 'invalid-count'
  | 'invalid-dimensions'
  | 'unsupported-encoding'
  | 'unsupported-data-type'
  | 'truncated-data'
  | 'invalid-data'
  | 'too-large';

export class SurfaceLoadError extends Error {
  readonly code: SurfaceLoadErrorCode;
  readonly stage: SurfaceLoadStage;
  readonly format: Exclude<SurfaceFormat, 'auto'> | null;
  readonly cause?: unknown;

  constructor(
    code: SurfaceLoadErrorCode,
    stage: SurfaceLoadStage,
    message: string,
    options: {
      format?: Exclude<SurfaceFormat, 'auto'> | null;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = 'SurfaceLoadError';
    this.code = code;
    this.stage = stage;
    this.format = options.format ?? null;
    this.cause = options.cause;
  }
}

export interface SurfaceLoadOptions {
  /** Optional caller-owned cancellation signal. */
  signal?: AbortSignal;
  /** DOMParser constructor for Node/SSR GIFTI parsing. */
  domParser?: typeof DOMParser;
  /** Maximum accepted response/file body size. Defaults to 500 MiB. */
  maxBytes?: number;
}

const MAX_SURFACE_BYTES = 500 * 1024 * 1024;
const FREESURFER_TRIANGLE_MAGIC = 0xfffffe;
const FREESURFER_CURVATURE_MAGIC = 0xffffff;

function loadError(
  code: SurfaceLoadErrorCode,
  stage: SurfaceLoadStage,
  message: string,
  format: Exclude<SurfaceFormat, 'auto'> | null,
  cause?: unknown
): SurfaceLoadError {
  return new SurfaceLoadError(code, stage, message, { format, cause });
}

function resourceBasename(resource: string): string {
  let pathname = resource.split(/[?#]/, 1)[0] ?? resource;
  try {
    pathname = new URL(resource, 'https://surfview.invalid').pathname;
  } catch {
    // Keep the query/hash-stripped path for non-URL filenames.
  }
  const basename = pathname.slice(pathname.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(basename).toLowerCase();
  } catch {
    return basename.toLowerCase();
  }
}

/** Detect a supported surface format from a filename or URL pathname. */
export function detectSurfaceFormat(
  resource: string
): Exclude<SurfaceFormat, 'auto'> | null {
  const basename = resourceBasename(resource);
  if (basename.endsWith('.gii')) return 'gifti';
  if (basename.endsWith('.ply')) return 'ply';

  const tokens = basename.split(/[._-]+/).filter(Boolean);
  const freesurferSuffixes = new Set([
    'pial', 'white', 'inflated', 'sphere', 'orig', 'smoothwm', 'fiducial', 'surf'
  ]);
  if (
    tokens.some(token => token === 'lh' || token === 'rh') ||
    tokens.some(token => freesurferSuffixes.has(token))
  ) {
    return 'freesurfer';
  }
  return null;
}

/**
 * Infer laterality only from unambiguous basename tokens: `lh`/`left`,
 * `rh`/`right`, or the conventional `L`/`R` token in an fsLR filename.
 */
export function detectHemisphereFromName(resource: string): Hemisphere {
  const basename = resourceBasename(resource);
  const tokens = basename.split(/[._-]+/).filter(Boolean);
  const normalized = tokens.join('');
  const isFsLR = normalized.includes('fslr');
  const left = tokens.some(token => token === 'lh' || token === 'left') ||
    (isFsLR && tokens.includes('l'));
  const right = tokens.some(token => token === 'rh' || token === 'right') ||
    (isFsLR && tokens.includes('r'));
  if (left === right) return 'unknown';
  return left ? 'left' : 'right';
}

function readUint24(view: DataView, offset: number): number {
  return (view.getUint8(offset) << 16) |
    (view.getUint8(offset + 1) << 8) |
    view.getUint8(offset + 2);
}

function checkedElementBytes(
  elementCount: number,
  bytesPerElement: number,
  format: Exclude<SurfaceFormat, 'auto'>
): number {
  const byteLength = elementCount * bytesPerElement;
  if (!Number.isSafeInteger(byteLength) || byteLength > MAX_SURFACE_BYTES) {
    throw loadError(
      'too-large',
      'validate',
      `${format} array exceeds the ${MAX_SURFACE_BYTES}-byte safety limit`,
      format
    );
  }
  return byteLength;
}

export async function getDomParser(domParser?: typeof DOMParser): Promise<typeof DOMParser> {
  if (domParser) return domParser;
  if (typeof DOMParser !== 'undefined') return DOMParser;
  throw loadError(
    'dom-parser-unavailable',
    'parse',
    'GIFTI parsing requires a DOMParser constructor in Node/SSR.',
    'gifti'
  );
}

/**
 * Parse FreeSurfer surface format
 */
export function parseFreeSurferSurface(buffer: ArrayBuffer): ParsedSurfaceData {
  const format = 'freesurfer' as const;
  if (!buffer || buffer.byteLength < 15) {
    throw loadError('truncated-data', 'parse', 'FreeSurfer surface is too small', format);
  }
  const view = new DataView(buffer);
  if (readUint24(view, 0) !== FREESURFER_TRIANGLE_MAGIC) {
    throw loadError(
      'invalid-magic',
      'parse',
      'FreeSurfer triangle surface magic must be 0xFFFFFE',
      format
    );
  }

  let offset = 3;
  while (offset < buffer.byteLength && view.getUint8(offset) !== 0x0A) {
    offset += 1;
  }
  if (offset >= buffer.byteLength) {
    throw loadError('truncated-data', 'parse', 'FreeSurfer creation stamp is truncated', format);
  }
  offset += 1;
  if (offset >= buffer.byteLength) {
    throw loadError('truncated-data', 'parse', 'FreeSurfer blank header line is missing', format);
  }
  if (view.getUint8(offset) === 0x0D) offset += 1;
  if (offset >= buffer.byteLength || view.getUint8(offset) !== 0x0A) {
    throw loadError(
      'invalid-header',
      'parse',
      'FreeSurfer creation stamp must be followed by a blank line',
      format
    );
  }
  offset += 1;

  if (offset + 8 > buffer.byteLength) {
    throw loadError('truncated-data', 'parse', 'FreeSurfer counts are truncated', format);
  }
  const nVertices = view.getInt32(offset, false);
  offset += 4;
  const nFaces = view.getInt32(offset, false);
  offset += 4;

  if (nVertices <= 0 || nVertices > MAX_SURFACE_VERTICES) {
    throw loadError(
      'invalid-count',
      'validate',
      `FreeSurfer vertex count must be in [1, ${MAX_SURFACE_VERTICES}] (received ${nVertices})`,
      format
    );
  }
  if (nFaces <= 0 || nFaces > MAX_SURFACE_FACES) {
    throw loadError(
      'invalid-count',
      'validate',
      `FreeSurfer face count must be in [1, ${MAX_SURFACE_FACES}] (received ${nFaces})`,
      format
    );
  }
  const vertexBytes = checkedElementBytes(nVertices * 3, 4, format);
  const faceBytes = checkedElementBytes(nFaces * 3, 4, format);
  const expectedSize = offset + vertexBytes + faceBytes;
  if (buffer.byteLength < expectedSize) {
    throw loadError(
      'truncated-data',
      'parse',
      `FreeSurfer surface is truncated: expected at least ${expectedSize} bytes, ` +
      `received ${buffer.byteLength}`,
      format
    );
  }

  const vertices = new Float32Array(nVertices * 3);
  for (let i = 0; i < nVertices * 3; i++) {
    const value = view.getFloat32(offset, false);
    if (!Number.isFinite(value)) {
      throw loadError(
        'invalid-data',
        'validate',
        `FreeSurfer coordinate at index ${i} must be finite`,
        format
      );
    }
    vertices[i] = value;
    offset += 4;
  }

  const faces = new Uint32Array(nFaces * 3);
  for (let i = 0; i < nFaces * 3; i++) {
    const vertexIndex = view.getInt32(offset, false);
    if (vertexIndex < 0 || vertexIndex >= nVertices) {
      throw loadError(
        'invalid-data',
        'validate',
        `FreeSurfer face index at position ${i} must be in [0, ${nVertices - 1}] ` +
        `(received ${vertexIndex})`,
        format
      );
    }
    faces[i] = vertexIndex;
    offset += 4;
  }

  return { vertices, faces };
}

/**
 * Parse GIfTI surface format (.gii)
 */
export function parseGIfTISurface(xmlString: string, domParser?: typeof DOMParser): ParsedSurfaceData {
  const format = 'gifti' as const;
  if (!xmlString || xmlString.length < 20) {
    throw loadError('truncated-data', 'parse', 'GIFTI XML is empty or too small', format);
  }
  if (xmlString.length > MAX_SURFACE_BYTES) {
    throw loadError('too-large', 'parse', 'GIFTI XML exceeds the 500 MiB safety limit', format);
  }

  const DOMParserImpl = domParser || (typeof DOMParser !== 'undefined' ? DOMParser : null);
  if (!DOMParserImpl) {
    throw loadError(
      'dom-parser-unavailable',
      'parse',
      'GIFTI parsing requires a DOMParser constructor in Node/SSR.',
      format
    );
  }

  let doc: Document;
  try {
    doc = new DOMParserImpl().parseFromString(xmlString, 'application/xml');
  } catch (error) {
    throw loadError('invalid-data', 'parse', 'GIFTI XML parsing failed', format, error);
  }
  if (doc.querySelector('parsererror')) {
    throw loadError('invalid-data', 'parse', 'GIFTI XML contains a parse error', format);
  }
  if (doc.documentElement?.localName.toUpperCase() !== 'GIFTI') {
    throw loadError('invalid-magic', 'parse', 'GIFTI XML root element must be GIFTI', format);
  }

  let vertices: Float32Array | null = null;
  let faces: Uint32Array | null = null;
  const dataArrays = doc.getElementsByTagName('DataArray');

  for (let i = 0; i < dataArrays.length; i++) {
    const dataArray = dataArrays.item(i);
    if (!dataArray) {
      throw loadError('invalid-data', 'parse', `GIFTI DataArray ${i} is missing`, format);
    }
    const intent = dataArray.getAttribute('Intent');
    if (intent === 'NIFTI_INTENT_POINTSET') {
      if (vertices) {
        throw loadError('invalid-data', 'validate', 'GIFTI contains duplicate pointset arrays', format);
      }
      vertices = parseGIfTIDataArray(dataArray, 'vertices');
    } else if (intent === 'NIFTI_INTENT_TRIANGLE') {
      if (faces) {
        throw loadError('invalid-data', 'validate', 'GIFTI contains duplicate triangle arrays', format);
      }
      faces = parseGIfTIDataArray(dataArray, 'faces');
    }
  }

  if (!vertices || !faces) {
    throw loadError('invalid-data', 'validate', 'GIFTI surface is missing vertices or faces', format);
  }
  try {
    validateSurfaceGeometryData(vertices, faces);
  } catch (error) {
    if (error instanceof SurfaceGeometryError) {
      throw loadError('invalid-data', 'validate', error.message, format, error);
    }
    throw error;
  }

  return {
    vertices,
    faces,
    hemisphere: readGIfTIHemisphere(doc)
  };
}

type GIfTIArrayKind = 'vertices' | 'faces';

function parseGIfTIDataArray(
  dataArray: Element,
  kind: 'vertices'
): Float32Array;
function parseGIfTIDataArray(
  dataArray: Element,
  kind: 'faces'
): Uint32Array;
function parseGIfTIDataArray(
  dataArray: Element,
  kind: GIfTIArrayKind
): Float32Array | Uint32Array {
  const format = 'gifti' as const;
  const dataType = dataArray.getAttribute('DataType') ?? '';
  const encoding = dataArray.getAttribute('Encoding') ?? '';
  const endian = dataArray.getAttribute('Endian') || 'LittleEndian';
  const order = dataArray.getAttribute('ArrayIndexingOrder') || 'RowMajorOrder';
  if (order !== 'RowMajorOrder') {
    throw loadError(
      'invalid-dimensions',
      'validate',
      `GIFTI ${kind} must use RowMajorOrder (received ${order})`,
      format
    );
  }
  if (endian !== 'LittleEndian' && endian !== 'BigEndian') {
    throw loadError(
      'invalid-header',
      'validate',
      `GIFTI ${kind} has invalid Endian value ${endian}`,
      format
    );
  }

  const dimensionality = parseStrictIntegerAttribute(dataArray, 'Dimensionality');
  const rowCount = parseStrictIntegerAttribute(dataArray, 'Dim0');
  const columnCount = parseStrictIntegerAttribute(dataArray, 'Dim1');
  const maximumRows = kind === 'vertices' ? MAX_SURFACE_VERTICES : MAX_SURFACE_FACES;
  if (dimensionality !== 2 || rowCount <= 0 || rowCount > maximumRows || columnCount !== 3) {
    throw loadError(
      'invalid-dimensions',
      'validate',
      `GIFTI ${kind} dimensions must be N x 3 with N in [1, ${maximumRows}] ` +
      `(received dimensionality=${dimensionality}, Dim0=${rowCount}, Dim1=${columnCount})`,
      format
    );
  }
  const elementCount = rowCount * columnCount;
  const bytesPerElement = giftiBytesPerElement(dataType, kind);
  const expectedBytes = checkedElementBytes(elementCount, bytesPerElement, format);

  const data = dataArray.getElementsByTagName('Data')[0];
  if (!data || !data.textContent?.trim()) {
    throw loadError('truncated-data', 'parse', `GIFTI ${kind} Data element is empty`, format);
  }
  const text = data.textContent.trim();
  const littleEndian = endian !== 'BigEndian';

  if (encoding === 'ASCII') {
    return parseGIfTIASCII(text, dataType, kind, elementCount);
  }
  if (encoding !== 'Base64Binary' && encoding !== 'GZipBase64Binary') {
    throw loadError(
      'unsupported-encoding',
      'parse',
      `Unsupported GIFTI Encoding: ${encoding || '(missing)'}`,
      format
    );
  }

  let bytes = base64ToUint8(text);
  if (encoding === 'GZipBase64Binary') {
    bytes = decompressGIfTIExactly(bytes, expectedBytes);
  } else if (bytes.byteLength !== expectedBytes) {
    throw loadError(
      bytes.byteLength < expectedBytes ? 'truncated-data' : 'invalid-dimensions',
      'validate',
      `GIFTI ${kind} byte length must be ${expectedBytes} (received ${bytes.byteLength})`,
      format
    );
  }
  return decodeGIfTINumericArray(bytes, dataType, littleEndian, kind, elementCount);
}

function parseStrictIntegerAttribute(element: Element, name: string): number {
  const value = element.getAttribute(name) ?? '';
  if (!/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function giftiBytesPerElement(dataType: string, kind: GIfTIArrayKind): number {
  const floatTypes = new Map([
    ['NIFTI_TYPE_FLOAT32', 4],
    ['NIFTI_TYPE_FLOAT64', 8]
  ]);
  const integerTypes = new Map([
    ['NIFTI_TYPE_INT8', 1],
    ['NIFTI_TYPE_UINT8', 1],
    ['NIFTI_TYPE_INT16', 2],
    ['NIFTI_TYPE_UINT16', 2],
    ['NIFTI_TYPE_INT32', 4],
    ['NIFTI_TYPE_UINT32', 4]
  ]);
  const bytes = (kind === 'vertices' ? floatTypes : integerTypes).get(dataType);
  if (bytes === undefined) {
    throw loadError(
      'unsupported-data-type',
      'parse',
      `Unsupported GIFTI DataType ${dataType || '(missing)'} for ${kind}`,
      'gifti'
    );
  }
  return bytes;
}

function parseGIfTIASCII(
  text: string,
  dataType: string,
  kind: GIfTIArrayKind,
  elementCount: number
): Float32Array | Uint32Array {
  const tokens = text.split(/\s+/);
  if (tokens.length !== elementCount) {
    throw loadError(
      tokens.length < elementCount ? 'truncated-data' : 'invalid-dimensions',
      'validate',
      `GIFTI ${kind} element count must be ${elementCount} (received ${tokens.length})`,
      'gifti'
    );
  }
  const output = kind === 'vertices'
    ? new Float32Array(elementCount)
    : new Uint32Array(elementCount);
  const numericPattern = kind === 'vertices'
    ? /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
    : /^[+-]?\d+$/;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || !numericPattern.test(token)) {
      throw loadError(
        'invalid-data',
        'validate',
        `GIFTI ${kind} token at index ${index} is not a decimal number`,
        'gifti'
      );
    }
    const value = Number(token);
    validateGIfTINumericValue(value, dataType, kind, index);
    output[index] = value;
    if (!Number.isFinite(output[index])) {
      throw loadError(
        'invalid-data',
        'validate',
        `GIFTI ${kind} value at index ${index} is outside Float32 range`,
        'gifti'
      );
    }
  }
  return output;
}

function decodeGIfTINumericArray(
  bytes: Uint8Array,
  dataType: string,
  littleEndian: boolean,
  kind: GIfTIArrayKind,
  elementCount: number
): Float32Array | Uint32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = kind === 'vertices'
    ? new Float32Array(elementCount)
    : new Uint32Array(elementCount);
  const width = giftiBytesPerElement(dataType, kind);
  for (let index = 0; index < elementCount; index += 1) {
    const offset = index * width;
    let value: number;
    switch (dataType) {
      case 'NIFTI_TYPE_FLOAT32': value = view.getFloat32(offset, littleEndian); break;
      case 'NIFTI_TYPE_FLOAT64': value = view.getFloat64(offset, littleEndian); break;
      case 'NIFTI_TYPE_INT8': value = view.getInt8(offset); break;
      case 'NIFTI_TYPE_UINT8': value = view.getUint8(offset); break;
      case 'NIFTI_TYPE_INT16': value = view.getInt16(offset, littleEndian); break;
      case 'NIFTI_TYPE_UINT16': value = view.getUint16(offset, littleEndian); break;
      case 'NIFTI_TYPE_INT32': value = view.getInt32(offset, littleEndian); break;
      case 'NIFTI_TYPE_UINT32': value = view.getUint32(offset, littleEndian); break;
      default:
        throw loadError('unsupported-data-type', 'parse', `Unsupported GIFTI DataType ${dataType}`, 'gifti');
    }
    validateGIfTINumericValue(value, dataType, kind, index);
    output[index] = value;
    if (!Number.isFinite(output[index])) {
      throw loadError(
        'invalid-data',
        'validate',
        `GIFTI ${kind} value at index ${index} is outside Float32 range`,
        'gifti'
      );
    }
  }
  return output;
}

function validateGIfTINumericValue(
  value: number,
  dataType: string,
  kind: GIfTIArrayKind,
  index: number
): void {
  if (!Number.isFinite(value)) {
    throw loadError(
      'invalid-data',
      'validate',
      `GIFTI ${kind} value at index ${index} must be finite`,
      'gifti'
    );
  }
  if (kind === 'faces' && (!Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
    throw loadError(
      'invalid-data',
      'validate',
      `GIFTI face index at position ${index} must be a nonnegative integer ` +
      `(received ${String(value)} as ${dataType})`,
      'gifti'
    );
  }
}

function decompressGIfTIExactly(compressed: Uint8Array, expectedBytes: number): Uint8Array {
  const isGzip = compressed.length >= 2 && compressed[0] === 0x1f && compressed[1] === 0x8b;
  const output = new Uint8Array(expectedBytes);
  let offset = 0;
  let finalSeen = false;
  const onData = (chunk: Uint8Array, final: boolean): void => {
    if (offset + chunk.byteLength > expectedBytes) {
      throw loadError(
        'invalid-dimensions',
        'decompress',
        `Decompressed GIFTI payload exceeds declared ${expectedBytes} bytes`,
        'gifti'
      );
    }
    output.set(chunk, offset);
    offset += chunk.byteLength;
    finalSeen ||= final;
  };

  try {
    if (isGzip) {
      new Gunzip(onData).push(compressed, true);
    } else {
      new Unzlib(onData).push(compressed, true);
      console.warn('GZipBase64Binary payload used zlib framing; compatibility fallback succeeded.');
    }
  } catch (error) {
    if (error instanceof SurfaceLoadError) throw error;
    throw loadError('invalid-data', 'decompress', 'GIFTI compressed payload is invalid', 'gifti', error);
  }
  if (!finalSeen || offset !== expectedBytes) {
    throw loadError(
      offset < expectedBytes ? 'truncated-data' : 'invalid-dimensions',
      'decompress',
      `Decompressed GIFTI payload must contain ${expectedBytes} bytes (received ${offset})`,
      'gifti'
    );
  }
  return output;
}

function readGIfTIHemisphere(doc: Document): Hemisphere {
  const metadata = doc.getElementsByTagName('MD');
  let detected: Hemisphere = 'unknown';
  for (let index = 0; index < metadata.length; index += 1) {
    const entry = metadata.item(index);
    if (!entry) continue;
    const name = entry.getElementsByTagName('Name').item(0)?.textContent?.trim().toLowerCase();
    if (name !== 'anatomicalstructureprimary') continue;
    const value = entry.getElementsByTagName('Value').item(0)?.textContent?.trim().toLowerCase();
    const candidate = value?.includes('left')
      ? 'left'
      : value?.includes('right')
        ? 'right'
        : 'unknown';
    if (candidate === 'unknown') continue;
    if (detected !== 'unknown' && detected !== candidate) return 'unknown';
    detected = candidate;
  }
  return detected;
}

/**
 * Convert a base64 string into an ArrayBuffer
 */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  let decoded: string;
  try {
    decoded = atob(b64.replace(/\s+/g, ''));
  } catch (error) {
    throw loadError('invalid-data', 'parse', 'GIFTI Base64 payload is invalid', 'gifti', error);
  }
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
 * Parse PLY (Polygon File Format)
 */
export function parsePLY(data: string | ArrayBuffer): ParsedSurfaceData {
  const format = 'ply' as const;
  if (!data) {
    throw loadError('truncated-data', 'parse', 'PLY surface has no data', format);
  }

  let text: string;
  if (typeof data !== 'string') {
    if (data.byteLength === 0) {
      throw loadError('truncated-data', 'parse', 'PLY surface is empty', format);
    }
    if (data.byteLength > MAX_SURFACE_BYTES) {
      throw loadError('too-large', 'parse', 'PLY surface exceeds the 500 MiB safety limit', format);
    }
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch (error) {
      throw loadError('invalid-data', 'parse', 'PLY ASCII data is not valid UTF-8', format, error);
    }
  } else {
    text = data;
  }
  if (text.length > MAX_SURFACE_BYTES) {
    throw loadError('too-large', 'parse', 'PLY surface exceeds the 500 MiB safety limit', format);
  }

  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== 'ply') {
    throw loadError('invalid-magic', 'parse', 'PLY first line must be exactly "ply"', format);
  }
  let headerEnd = 0;
  let vertexCount = 0;
  let faceCount = 0;
  let asciiFormat = false;
  let formatSeen = false;
  let currentElement: 'vertex' | 'face' | null = null;
  const vertexProperties: string[] = [];
  const faceProperties: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    const line = rawLine.trim();
    if (line === 'end_header') {
      headerEnd = i + 1;
      break;
    }
    if (line.startsWith('format ')) {
      if (formatSeen) {
        throw loadError('invalid-header', 'parse', 'PLY contains duplicate format declarations', format);
      }
      const parts = line.split(/\s+/);
      if (parts.length !== 3 || parts[2] !== '1.0') {
        throw loadError('invalid-header', 'parse', `Invalid PLY format declaration: ${line}`, format);
      }
      if (parts[1] !== 'ascii') {
        throw loadError(
          'unsupported-encoding',
          'parse',
          `Unsupported PLY encoding ${parts[1]}; only ascii 1.0 is supported`,
          format
        );
      }
      asciiFormat = true;
      formatSeen = true;
    }
    if (line.startsWith('element ')) {
      const parts = line.split(/\s+/);
      if (parts[1] === 'vertex') {
        if (vertexCount !== 0) {
          throw loadError('invalid-header', 'parse', 'PLY contains duplicate vertex elements', format);
        }
        vertexCount = parsePLYCount(line, 'vertex', MAX_SURFACE_VERTICES);
        currentElement = 'vertex';
      } else if (parts[1] === 'face') {
        if (faceCount !== 0) {
          throw loadError('invalid-header', 'parse', 'PLY contains duplicate face elements', format);
        }
        faceCount = parsePLYCount(line, 'face', MAX_SURFACE_FACES);
        currentElement = 'face';
      } else {
        throw loadError(
          'invalid-header',
          'parse',
          `Unsupported PLY element ${parts[1] || '(missing)'}`,
          format
        );
      }
    }
    if (line.startsWith('property ')) {
      if (!currentElement) {
        throw loadError('invalid-header', 'parse', 'PLY property appears before an element', format);
      }
      (currentElement === 'vertex' ? vertexProperties : faceProperties).push(line);
    }
  }

  if (headerEnd === 0) {
    throw loadError('truncated-data', 'parse', 'PLY end_header marker is missing', format);
  }
  if (!asciiFormat) {
    throw loadError('invalid-header', 'parse', 'PLY format ascii 1.0 declaration is required', format);
  }
  if (vertexCount === 0 || faceCount === 0) {
    throw loadError('invalid-count', 'validate', 'PLY requires positive vertex and face counts', format);
  }
  const vertexPropertyNames = vertexProperties.map(property => {
    const parts = property.split(/\s+/);
    return parts[parts.length - 1];
  });
  if (
    vertexProperties.length < 3 ||
    vertexProperties.slice(0, 3).some(property => property.startsWith('property list ')) ||
    vertexPropertyNames[0] !== 'x' ||
    vertexPropertyNames[1] !== 'y' ||
    vertexPropertyNames[2] !== 'z'
  ) {
    throw loadError(
      'invalid-header',
      'validate',
      'PLY vertex element must declare scalar x, y, z as its first three properties',
      format
    );
  }
  const faceProperty = faceProperties[0]?.split(/\s+/) ?? [];
  const facePropertyName = faceProperty[4];
  if (
    faceProperty.length !== 5 ||
    faceProperty[0] !== 'property' ||
    faceProperty[1] !== 'list' ||
    facePropertyName === undefined ||
    !['vertex_indices', 'vertex_index'].includes(facePropertyName)
  ) {
    throw loadError(
      'invalid-header',
      'validate',
      'PLY face element must declare a leading vertex_indices list property',
      format
    );
  }
  if (lines.length < headerEnd + vertexCount + faceCount) {
    throw loadError(
      'truncated-data',
      'parse',
      `PLY declares ${vertexCount} vertices and ${faceCount} faces but data lines are truncated`,
      format
    );
  }

  const vertices = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const line = lines[headerEnd + i];
    if (!line) {
      throw loadError('truncated-data', 'parse', `PLY vertex ${i} is missing`, format);
    }
    const parts = line.trim().split(/\s+/);
    if (parts.length < vertexProperties.length) {
      throw loadError('truncated-data', 'parse', `PLY vertex ${i} has too few properties`, format);
    }

    const xToken = parts[0];
    const yToken = parts[1];
    const zToken = parts[2];
    if (xToken === undefined || yToken === undefined || zToken === undefined) {
      throw loadError('truncated-data', 'parse', `PLY vertex ${i} has too few coordinates`, format);
    }
    const coordinates = [Number(xToken), Number(yToken), Number(zToken)] as const;
    if (coordinates.some(value => !Number.isFinite(value))) {
      throw loadError('invalid-data', 'validate', `PLY vertex ${i} coordinates must be finite`, format);
    }
    for (let component = 0; component < 3; component += 1) {
      // `component` is constrained to this fixed three-coordinate tuple.
      vertices[i * 3 + component] = coordinates[component]!;
      if (!Number.isFinite(vertices[i * 3 + component])) {
        throw loadError(
          'invalid-data',
          'validate',
          `PLY vertex ${i} coordinate ${component} is outside Float32 range`,
          format
        );
      }
    }
  }

  const faces = new Uint32Array(faceCount * 3);
  for (let i = 0; i < faceCount; i++) {
    const line = lines[headerEnd + vertexCount + i];
    if (!line) {
      throw loadError('truncated-data', 'parse', `PLY face ${i} is missing`, format);
    }
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) {
      throw loadError('truncated-data', 'parse', `PLY face ${i} is incomplete`, format);
    }

    const count = Number(parts[0]);
    if (count !== 3) {
      throw loadError('invalid-data', 'validate', `PLY face ${i} must contain exactly 3 indices`, format);
    }
    for (let component = 0; component < 3; component += 1) {
      const vertexIndex = Number(parts[component + 1]);
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertexCount) {
        throw loadError(
          'invalid-data',
          'validate',
          `PLY face ${i} index ${component} must be an integer in [0, ${vertexCount - 1}] ` +
          `(received ${parts[component + 1]})`,
          format
        );
      }
      faces[i * 3 + component] = vertexIndex;
    }
  }

  return { vertices, faces };
}

function parsePLYCount(line: string, element: 'vertex' | 'face', maximum: number): number {
  const parts = line.split(/\s+/);
  const countToken = parts[2];
  if (
    parts.length !== 3 ||
    parts[0] !== 'element' ||
    parts[1] !== element ||
    countToken === undefined ||
    !/^[1-9]\d*$/.test(countToken)
  ) {
    throw loadError('invalid-count', 'validate', `PLY ${element} count is invalid`, 'ply');
  }
  const count = Number(countToken);
  if (!Number.isSafeInteger(count) || count > maximum) {
    throw loadError(
      'invalid-count',
      'validate',
      `PLY ${element} count must be in [1, ${maximum}] (received ${countToken})`,
      'ply'
    );
  }
  return count;
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
  targetSize: number = 100, // Target size for auto-scaling
  options: SurfaceLoadOptions = {}
): Promise<SurfaceGeometry> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw loadError('invalid-data', 'validate', 'timeoutMs must be a positive finite number', null);
  }
  const maxBytes = options.maxBytes ?? MAX_SURFACE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_SURFACE_BYTES) {
    throw loadError(
      'invalid-data',
      'validate',
      `maxBytes must be an integer in [1, ${MAX_SURFACE_BYTES}]`,
      null
    );
  }
  const detectedFormat = format === 'auto' ? detectSurfaceFormat(url) : format;
  if (!detectedFormat) {
    throw loadError(
      'unsupported-format',
      'detect',
      `Could not detect a supported surface format from ${resourceBasename(url) || url}`,
      null
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  const deadline = Date.now() + timeoutMs;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true });

  let activeStage: SurfaceLoadStage = 'fetch';
  const assertActive = (stage: SurfaceLoadStage): void => {
    activeStage = stage;
    if (options.signal?.aborted) {
      throw loadError('aborted', stage, 'Surface load was aborted by the caller', detectedFormat);
    }
    if (timedOut || Date.now() >= deadline) {
      timedOut = true;
      controller.abort();
      throw loadError(
        'timeout',
        stage,
        `Surface load timed out after ${timeoutMs}ms during ${stage}`,
        detectedFormat
      );
    }
  };

  try {
    assertActive('fetch');
    const response = await fetch(url, { signal: controller.signal });
    assertActive('fetch');
    if (!response.ok) {
      throw loadError(
        'http-error',
        'fetch',
        `HTTP ${response.status}: ${response.statusText}`,
        detectedFormat
      );
    }
    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        throw loadError('invalid-header', 'body', 'Invalid HTTP Content-Length header', detectedFormat);
      }
      if (contentLength > maxBytes) {
        throw loadError(
          'too-large',
          'body',
          `Surface response exceeds the ${maxBytes}-byte limit`,
          detectedFormat
        );
      }
    }

    assertActive('body');
    let parsedData: ParsedSurfaceData;
    const body = await response.arrayBuffer();
    assertBodySize(body.byteLength, maxBytes, detectedFormat);
    assertActive('parse');
    if (detectedFormat === 'freesurfer') {
      parsedData = parseFreeSurferSurface(body);
    } else {
      if (detectedFormat === 'gifti') {
        const parser = await getDomParser(options.domParser);
        assertActive('parse');
        parsedData = parseGIfTISurface(decodeUtf8Body(body, detectedFormat), parser);
      } else {
        parsedData = parsePLY(body);
      }
    }
    assertActive('validate');

    try {
      validateSurfaceGeometryData(parsedData.vertices, parsedData.faces);
    } catch (error) {
      if (error instanceof SurfaceGeometryError) {
        throw loadError('invalid-data', 'validate', error.message, detectedFormat, error);
      }
      throw error;
    }

    if (autoScale) {
      const scaleFactor = SurfaceScaler.autoScale(parsedData.vertices, targetSize);
      if (scaleFactor !== 1) {
        console.log(`Auto-scaled surface by factor of ${scaleFactor}`);
      }
    }

    assertActive('validate');
    const actualHemisphere = resolveHemisphere(hemisphere, parsedData.hemisphere, url);
    return new SurfaceGeometry(
      parsedData.vertices,
      parsedData.faces,
      actualHemisphere
    );
  } catch (error) {
    if (error instanceof SurfaceLoadError) throw error;
    if (error instanceof SurfaceGeometryError) {
      throw loadError('invalid-data', 'validate', error.message, detectedFormat, error);
    }
    if (options.signal?.aborted) {
      throw loadError(
        'aborted',
        activeStage,
        'Surface load was aborted by the caller',
        detectedFormat,
        error
      );
    }
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      throw loadError(
        timedOut ? 'timeout' : 'aborted',
        activeStage,
        timedOut
          ? `Surface load timed out after ${timeoutMs}ms`
          : 'Surface load was aborted',
        detectedFormat,
        error
      );
    }
    throw loadError('invalid-data', activeStage, 'Surface loading failed', detectedFormat, error);
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

function assertBodySize(
  byteLength: number,
  maximum: number,
  format: Exclude<SurfaceFormat, 'auto'>
): void {
  if (byteLength > maximum) {
    throw loadError(
      'too-large',
      'body',
      `Surface body exceeds the ${maximum}-byte limit`,
      format
    );
  }
}

function decodeUtf8Body(
  body: ArrayBuffer,
  format: Exclude<SurfaceFormat, 'auto'>
): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch (error) {
    throw loadError(
      'invalid-data',
      'body',
      `${format} response body is not valid UTF-8`,
      format,
      error
    );
  }
}

function resolveHemisphere(
  requested: Hemisphere,
  metadata: Hemisphere | undefined,
  resource: string
): Hemisphere {
  if (requested && requested !== 'unknown') return requested;
  if (metadata && metadata !== 'unknown') return metadata;
  return detectHemisphereFromName(resource);
}

/**
 * Load surface from File object
 */
export async function loadSurfaceFromFile(
  file: File, 
  format: SurfaceFormat = 'auto', 
  hemisphere: Hemisphere = 'unknown',
  autoScale: boolean = false,
  targetSize: number = 100,
  options: SurfaceLoadOptions = {}
): Promise<SurfaceGeometry> {
  if (!file) {
    throw loadError('invalid-data', 'body', 'No surface file was provided', null);
  }
  if (file.size === 0) {
    throw loadError('truncated-data', 'body', 'Surface file is empty', null);
  }
  const maxBytes = options.maxBytes ?? MAX_SURFACE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_SURFACE_BYTES) {
    throw loadError(
      'invalid-data',
      'validate',
      `maxBytes must be an integer in [1, ${MAX_SURFACE_BYTES}]`,
      null
    );
  }
  if (file.size > maxBytes) {
    throw loadError('too-large', 'body', `Surface file exceeds the ${maxBytes}-byte limit`, null);
  }
  const detectedFormat = format === 'auto' ? detectSurfaceFormat(file.name) : format;
  if (!detectedFormat) {
    throw loadError(
      'unsupported-format',
      'detect',
      `Could not detect a supported surface format from ${file.name}`,
      null
    );
  }

  const assertNotAborted = (stage: SurfaceLoadStage): void => {
    if (options.signal?.aborted) {
      throw loadError('aborted', stage, 'Surface file load was aborted by the caller', detectedFormat);
    }
  };

  try {
    assertNotAborted('body');
    let parsedData: ParsedSurfaceData;
    if (detectedFormat === 'freesurfer') {
      const body = await file.arrayBuffer();
      assertNotAborted('parse');
      parsedData = parseFreeSurferSurface(body);
    } else {
      const body = await file.text();
      assertNotAborted('parse');
      if (detectedFormat === 'gifti') {
        const parser = await getDomParser(options.domParser);
        assertNotAborted('parse');
        parsedData = parseGIfTISurface(body, parser);
      } else {
        parsedData = parsePLY(body);
      }
    }

    validateSurfaceGeometryData(parsedData.vertices, parsedData.faces);
    if (autoScale) {
      const scaleFactor = SurfaceScaler.autoScale(parsedData.vertices, targetSize);
      if (scaleFactor !== 1) {
        console.log(`Auto-scaled surface by factor of ${scaleFactor}`);
      }
    }
    assertNotAborted('validate');
    return new SurfaceGeometry(
      parsedData.vertices,
      parsedData.faces,
      resolveHemisphere(hemisphere, parsedData.hemisphere, file.name)
    );
  } catch (error) {
    if (error instanceof SurfaceLoadError) throw error;
    if (error instanceof SurfaceGeometryError) {
      throw loadError('invalid-data', 'validate', error.message, detectedFormat, error);
    }
    throw loadError('invalid-data', 'parse', 'Surface file loading failed', detectedFormat, error);
  }
}

/**
 * Load curvature data from FreeSurfer format
 */
export function parseFreeSurferCurvature(
  data: string | ArrayBuffer,
  expectedVertexCount?: number
): Float32Array {
  const format = 'freesurfer' as const;
  let buffer: ArrayBuffer;
  if (typeof data === 'string') {
    const encoder = new TextEncoder();
    buffer = encoder.encode(data).buffer;
  } else {
    buffer = data;
  }

  if (!buffer || buffer.byteLength < 15) {
    throw loadError('truncated-data', 'parse', 'FreeSurfer curvature file is too small', format);
  }
  const view = new DataView(buffer);
  if (readUint24(view, 0) !== FREESURFER_CURVATURE_MAGIC) {
    throw loadError(
      'invalid-magic',
      'parse',
      'FreeSurfer new-style curvature magic must be 0xFFFFFF',
      format
    );
  }

  let offset = 3;
  const nVertices = view.getInt32(offset, false);
  offset += 4;
  const nFaces = view.getInt32(offset, false);
  offset += 4;
  const valuesPerVertex = view.getInt32(offset, false);
  offset += 4;

  if (nVertices <= 0 || nVertices > MAX_SURFACE_VERTICES) {
    throw loadError(
      'invalid-count',
      'validate',
      `FreeSurfer curvature vertex count must be in [1, ${MAX_SURFACE_VERTICES}] ` +
      `(received ${nVertices})`,
      format
    );
  }
  if (nFaces < 0 || nFaces > MAX_SURFACE_FACES) {
    throw loadError('invalid-count', 'validate', `Invalid curvature face count ${nFaces}`, format);
  }
  if (valuesPerVertex !== 1) {
    throw loadError(
      'invalid-dimensions',
      'validate',
      `FreeSurfer curvature valuesPerVertex must be 1 (received ${valuesPerVertex})`,
      format
    );
  }
  if (expectedVertexCount !== undefined && nVertices !== expectedVertexCount) {
    throw loadError(
      'invalid-dimensions',
      'validate',
      `FreeSurfer curvature vertex count ${nVertices} does not match surface vertex count ` +
      `${expectedVertexCount}`,
      format
    );
  }

  const expectedSize = offset + checkedElementBytes(nVertices, 4, format);
  if (buffer.byteLength < expectedSize) {
    throw loadError(
      'truncated-data',
      'parse',
      `FreeSurfer curvature is truncated: expected ${expectedSize} bytes, received ${buffer.byteLength}`,
      format
    );
  }

  const curvature = new Float32Array(nVertices);
  for (let i = 0; i < nVertices; i++) {
    const value = view.getFloat32(offset, false);
    if (!Number.isFinite(value)) {
      throw loadError(
        'invalid-data',
        'validate',
        `FreeSurfer curvature value at index ${i} must be finite`,
        format
      );
    }
    curvature[i] = value;
    offset += 4;
  }

  return curvature;
}
