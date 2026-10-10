import { gunzipSync, unzlibSync } from 'fflate';

/**
 * Minimal GIFTI metric (func/shape) reader for the demo. The library parses GIFTI
 * surfaces (`loadSurface`) but exports no reader for per-vertex data arrays, so the
 * Layers chapter carries this one. It decodes ASCII, Base64Binary and GZipBase64Binary
 * arrays of FLOAT32, INT32 or UINT8 data in either byte order.
 */

/** The synthetic Gaussian-splat metric shipped with the tests, on fs_LR 32k left. */
export const METRIC_URLS = {
  gaussianSplat: new URL('../../tests/data/gaussian_splat_demo.func.gii', import.meta.url).href
} as const;

export interface GiftiMetric {
  /** One value per vertex; non-finite file values stay NaN (drawn as no data). */
  values: Float32Array;
  /** Finite minimum and maximum, or [0, 0] when the array has no finite values. */
  range: [number, number];
  nonFinite: number;
}

function base64Bytes(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBinary(bytes: Uint8Array, dataType: string, littleEndian: boolean): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read: Record<string, { size: number; get: (offset: number) => number }> = {
    NIFTI_TYPE_FLOAT32: { size: 4, get: offset => view.getFloat32(offset, littleEndian) },
    NIFTI_TYPE_INT32: { size: 4, get: offset => view.getInt32(offset, littleEndian) },
    NIFTI_TYPE_UINT8: { size: 1, get: offset => view.getUint8(offset) }
  };
  const reader = read[dataType];
  if (!reader) throw new Error(`Unsupported GIFTI DataType ${dataType || '(none)'}`);
  if (bytes.byteLength % reader.size !== 0) throw new Error('GIFTI data length is not a whole number of values');
  const values = new Float32Array(bytes.byteLength / reader.size);
  for (let i = 0; i < values.length; i++) values[i] = reader.get(i * reader.size);
  return values;
}

function decodeDataArray(array: Element): Float32Array {
  const encoding = array.getAttribute('Encoding') ?? 'ASCII';
  const dataType = array.getAttribute('DataType') ?? '';
  const littleEndian = (array.getAttribute('Endian') ?? 'LittleEndian') !== 'BigEndian';
  const text = array.getElementsByTagName('Data')[0]?.textContent?.trim() ?? '';
  if (!text) throw new Error('GIFTI DataArray has no Data');
  switch (encoding) {
    case 'ASCII':
      return Float32Array.from(text.split(/\s+/), Number);
    case 'Base64Binary':
      return decodeBinary(base64Bytes(text), dataType, littleEndian);
    case 'GZipBase64Binary': {
      const compressed = base64Bytes(text);
      let bytes: Uint8Array;
      try {
        bytes = gunzipSync(compressed);
      } catch {
        bytes = unzlibSync(compressed);
      }
      return decodeBinary(bytes, dataType, littleEndian);
    }
    default:
      throw new Error(`Unsupported GIFTI encoding ${encoding}`);
  }
}

export function parseGiftiMetric(xml: string): GiftiMetric {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GIFTI file is not well-formed XML');
  const arrays = Array.from(doc.getElementsByTagName('DataArray'));
  const metric = arrays.find(array => /INTENT_(SHAPE|NONE|ESTIMATE|TTEST|ZSCORE)/.test(array.getAttribute('Intent') ?? ''));
  if (!metric) throw new Error('No per-vertex metric DataArray in the GIFTI file');
  const values = decodeDataArray(metric);
  let min = Infinity, max = -Infinity, nonFinite = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) {
      values[i] = NaN;
      nonFinite++;
      continue;
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { values, range: min <= max ? [min, max] : [0, 0], nonFinite };
}

export async function loadGiftiMetric(url: string): Promise<GiftiMetric> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load metric: HTTP ${response.status}`);
  return parseGiftiMetric(await response.text());
}
