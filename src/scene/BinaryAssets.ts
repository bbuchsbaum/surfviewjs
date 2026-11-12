import type {
  SceneAssetDescriptor,
  SceneAssetDType,
  SceneAssetRole
} from './SceneManifest';

export type SceneTypedArray = Float32Array | Uint32Array | Uint16Array;

function requireWebCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 support is required');
  return subtle;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await requireWebCrypto().digest('SHA-256', input);
  return Array.from(new Uint8Array(digest))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

export function encodeFloat32LE(values: ArrayLike<number>): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 4);
  const view = new DataView(buffer);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) throw new RangeError(`float32 value missing at index ${index}`);
    view.setFloat32(index * 4, value, true);
  }
  return new Uint8Array(buffer);
}

export function encodeUint32LE(values: ArrayLike<number>): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 4);
  const view = new DataView(buffer);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new RangeError(`uint32 value out of range at index ${index}: ${value}`);
    }
    view.setUint32(index * 4, value, true);
  }
  return new Uint8Array(buffer);
}

export function encodeUint16LE(values: ArrayLike<number>): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new RangeError(`uint16 value out of range at index ${index}: ${value}`);
    }
    view.setUint16(index * 2, value, true);
  }
  return new Uint8Array(buffer);
}

export function decodeFloat32LE(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) throw new Error('float32 byte length must be divisible by 4');
  const values = new Float32Array(bytes.byteLength / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getFloat32(index * 4, true);
  }
  return values;
}

export function decodeUint32LE(bytes: Uint8Array): Uint32Array {
  if (bytes.byteLength % 4 !== 0) throw new Error('uint32 byte length must be divisible by 4');
  const values = new Uint32Array(bytes.byteLength / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getUint32(index * 4, true);
  }
  return values;
}

export function decodeUint16LE(bytes: Uint8Array): Uint16Array {
  if (bytes.byteLength % 2 !== 0) throw new Error('uint16 byte length must be divisible by 2');
  const values = new Uint16Array(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getUint16(index * 2, true);
  }
  return values;
}

/**
 * The narrowest index dtype for a mesh: `uint16` when every vertex index fits
 * (at most 65,536 vertices), otherwise `uint32`.
 */
export function sceneIndexDType(vertexCount: number): 'uint16' | 'uint32' {
  if (!Number.isInteger(vertexCount) || vertexCount < 0) {
    throw new RangeError('vertexCount must be a non-negative integer');
  }
  return vertexCount <= 65536 ? 'uint16' : 'uint32';
}

function encodeValues(values: ArrayLike<number>, dtype: SceneAssetDType): Uint8Array {
  switch (dtype) {
    case 'float32': return encodeFloat32LE(values);
    case 'uint32': return encodeUint32LE(values);
    case 'uint16': return encodeUint16LE(values);
    default: throw new TypeError(`Unsupported scene asset dtype: ${String(dtype)}`);
  }
}

function decodeValues(bytes: Uint8Array, dtype: SceneAssetDType): SceneTypedArray {
  switch (dtype) {
    case 'float32': return decodeFloat32LE(bytes);
    case 'uint32': return decodeUint32LE(bytes);
    case 'uint16': return decodeUint16LE(bytes);
    default: throw new TypeError(`Unsupported scene asset dtype: ${String(dtype)}`);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function roleSuffix(role: SceneAssetRole): string {
  return role.replace(/[^a-z0-9-]/g, '-');
}

export interface CreateSceneAssetOptions {
  role: SceneAssetRole;
  dtype: SceneAssetDType;
  shape: number[];
  inline?: boolean;
  metadata?: Record<string, unknown>;
}

export async function createSceneAsset(
  values: ArrayLike<number>,
  options: CreateSceneAssetOptions
): Promise<{ descriptor: SceneAssetDescriptor; bytes: Uint8Array }> {
  const bytes = encodeValues(values, options.dtype);
  const sha256 = await sha256Hex(bytes);
  const id = `${options.role}-sha256-${sha256}`;
  const descriptor: SceneAssetDescriptor = {
    id,
    role: options.role,
    dtype: options.dtype,
    shape: [...options.shape],
    byteLength: bytes.byteLength,
    sha256,
    endianness: 'little',
    ...(options.inline === false
      ? { uri: `sha256-${sha256}.${roleSuffix(options.role)}.bin` }
      : { encoding: 'base64' as const, data: bytesToBase64(bytes) }),
    ...(options.metadata ? { metadata: options.metadata } : {})
  };
  return { descriptor, bytes };
}

export interface LoadSceneAssetOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  baseUrl?: string;
}

export async function loadSceneAsset(
  descriptor: SceneAssetDescriptor,
  options: LoadSceneAssetOptions = {}
): Promise<SceneTypedArray> {
  let bytes: Uint8Array;
  if (descriptor.data !== undefined) {
    bytes = base64ToBytes(descriptor.data);
  } else if (descriptor.uri) {
    const fetcher = options.fetcher ?? globalThis.fetch;
    if (!fetcher) throw new Error(`No fetch implementation available for ${descriptor.id}`);
    const url = options.baseUrl
      ? new URL(descriptor.uri, options.baseUrl).toString()
      : descriptor.uri;
    const response = await fetcher(
      url,
      options.signal === undefined ? {} : { signal: options.signal }
    );
    if (!response.ok) {
      throw new Error(`Failed to load ${descriptor.id}: HTTP ${response.status}`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    throw new Error(`Asset ${descriptor.id} has no data source`);
  }
  if (bytes.byteLength !== descriptor.byteLength) {
    throw new Error(
      `Asset ${descriptor.id} byte length mismatch: expected ${descriptor.byteLength}, received ${bytes.byteLength}`
    );
  }
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== descriptor.sha256) {
    throw new Error(
      `Asset ${descriptor.id} checksum mismatch: expected ${descriptor.sha256}, received ${actualSha256}`
    );
  }
  return decodeValues(bytes, descriptor.dtype);
}
