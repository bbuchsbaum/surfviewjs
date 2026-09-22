/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  detectHemisphereFromName,
  detectSurfaceFormat,
  loadSurface,
  loadSurfaceFromFile,
  parseFreeSurferCurvature,
  parseFreeSurferSurface,
  parseGIfTISurface,
  parsePLY,
  SurfaceLoadError
} from '../../src/loaders';
import { SurfaceGeometry, SurfaceGeometryError } from '../../src/classes';
import { buildVertexAdjacency, MeshAdjacencyError } from '../../src/utils/meshAdjacency';

const DOMParserImpl = new JSDOM().window.DOMParser;
const TETRA_VERTICES = [
  0, 0, 0,
  1, 0, 0,
  0.5, 0.866, 0,
  0.5, 0.289, 0.816
];
const TETRA_FACES = [
  0, 1, 2,
  0, 2, 3,
  0, 3, 1,
  1, 3, 2
];

function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests', 'data', name), 'utf8');
}

function typedArrayHash(data: Float32Array | Uint32Array): string {
  return createHash('sha256')
    .update(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    .digest('hex');
}

function expectSurfaceLoadError(
  action: () => unknown,
  code: SurfaceLoadError['code']
): void {
  try {
    action();
    throw new Error('Expected action to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(SurfaceLoadError);
    expect(error).toMatchObject({ code });
  }
}

async function expectAsyncSurfaceLoadError(
  action: Promise<unknown>,
  code: SurfaceLoadError['code']
): Promise<void> {
  try {
    await action;
    throw new Error('Expected action to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(SurfaceLoadError);
    expect(error).toMatchObject({ code });
  }
}

function makeFreeSurferSurface(
  vertices: readonly number[] = TETRA_VERTICES,
  faces: readonly number[] = TETRA_FACES,
  magic = 0xfffffe
): ArrayBuffer {
  const stamp = new TextEncoder().encode('created by surfview tests\n\n');
  const buffer = new ArrayBuffer(3 + stamp.length + 8 + vertices.length * 4 + faces.length * 4);
  const bytes = new Uint8Array(buffer);
  bytes[0] = (magic >>> 16) & 0xff;
  bytes[1] = (magic >>> 8) & 0xff;
  bytes[2] = magic & 0xff;
  bytes.set(stamp, 3);
  const view = new DataView(buffer);
  let offset = 3 + stamp.length;
  view.setInt32(offset, vertices.length / 3, false);
  offset += 4;
  view.setInt32(offset, faces.length / 3, false);
  offset += 4;
  for (const value of vertices) {
    view.setFloat32(offset, value, false);
    offset += 4;
  }
  for (const value of faces) {
    view.setInt32(offset, value, false);
    offset += 4;
  }
  return buffer;
}

function makeFreeSurferCurvature(
  values: readonly number[] = [0.25, -0.5, 0.75, 1],
  options: { magic?: number; valuesPerVertex?: number } = {}
): ArrayBuffer {
  const buffer = new ArrayBuffer(15 + values.length * 4);
  const bytes = new Uint8Array(buffer);
  const magic = options.magic ?? 0xffffff;
  bytes[0] = (magic >>> 16) & 0xff;
  bytes[1] = (magic >>> 8) & 0xff;
  bytes[2] = magic & 0xff;
  const view = new DataView(buffer);
  view.setInt32(3, values.length, false);
  view.setInt32(7, 4, false);
  view.setInt32(11, options.valuesPerVertex ?? 1, false);
  values.forEach((value, index) => view.setFloat32(15 + index * 4, value, false));
  return buffer;
}

function makePLY(options: { vertex?: string; face?: string; format?: string } = {}): string {
  return [
    'ply',
    `format ${options.format ?? 'ascii 1.0'}`,
    'element vertex 4',
    'property float x',
    'property float y',
    'property float z',
    'element face 4',
    'property list uchar int vertex_indices',
    'end_header',
    options.vertex ?? '0 0 0',
    '1 0 0',
    '0.5 0.866 0',
    '0.5 0.289 0.816',
    options.face ?? '3 0 1 2',
    '3 0 2 3',
    '3 0 3 1',
    '3 1 3 2'
  ].join('\n');
}

function textResponse(text: string): Response {
  const encoded = new TextEncoder().encode(text);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-length': String(encoded.byteLength) }),
    text: async () => text,
    arrayBuffer: async () => encoded.buffer
  } as Response;
}

function binaryResponse(buffer: ArrayBuffer): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-length': String(buffer.byteLength) }),
    text: async () => new TextDecoder().decode(buffer),
    arrayBuffer: async () => buffer
  } as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GIFTI surface parsing', () => {
  it('retains exact geometry across ASCII and Base64 reference encodings', () => {
    const ascii = parseGIfTISurface(readFixture('ascii.surf.gii'), DOMParserImpl);
    const base64 = parseGIfTISurface(readFixture('base64.surf.gii'), DOMParserImpl);

    expect(ascii.vertices.length).toBe(5_124 * 3);
    expect(ascii.faces.length).toBe(10_240 * 3);
    let maxCoordinateDelta = 0;
    for (let index = 0; index < ascii.vertices.length; index += 1) {
      maxCoordinateDelta = Math.max(
        maxCoordinateDelta,
        Math.abs(base64.vertices[index] - ascii.vertices[index])
      );
    }
    expect(maxCoordinateDelta).toBeLessThanOrEqual(1e-6);
    expect(base64.faces).toEqual(ascii.faces);
    expect(typedArrayHash(ascii.vertices))
      .toBe('4e908273ba591d828b6710d22dda7dfc93dbf540323bb979cb6c4a27e7770152');
    expect(typedArrayHash(base64.vertices))
      .toBe('fc7f727c9393d89c0391ab8cb90d9b9cdabadf2a84c16a79f61bf0ad10722653');
    expect(typedArrayHash(ascii.faces))
      .toBe('33d4e5b23f3894f4efd72f77b66b96a88a7dfa6084c18ec7746c74b50325ff34');
    expect(ascii.hemisphere).toBe('unknown');
  });

  it('parses the exact GZipBase64Binary tetrahedron fixture', () => {
    const result = parseGIfTISurface(readFixture('tetrahedron_gzip.gii'), DOMParserImpl);

    expect(result.vertices).toEqual(new Float32Array(TETRA_VERTICES));
    expect(Array.from(result.faces)).toEqual(TETRA_FACES);
  });

  it('supports the zlib-framed compatibility route without changing geometry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = parseGIfTISurface(readFixture('fsaverage5-lh-pial.gii'), DOMParserImpl);

    expect(result.vertices.length / 3).toBe(10_242);
    expect(result.faces.length / 3).toBe(20_480);
    expect(result.hemisphere).toBe('left');
    expect(warn).toHaveBeenCalledWith(
      'GZipBase64Binary payload used zlib framing; compatibility fallback succeeded.'
    );
  });

  it('retains reference laterality metadata independently of filenames', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const left = parseGIfTISurface(readFixture('fsaverage5-lh-pial.gii'), DOMParserImpl);
    const right = parseGIfTISurface(readFixture('fsaverage5-rh-pial.gii'), DOMParserImpl);

    expect(left.hemisphere).toBe('left');
    expect(right.hemisphere).toBe('right');
    expect(left.vertices.length).toBe(right.vertices.length);
    expect(left.faces.length).toBe(right.faces.length);
    expect(typedArrayHash(left.vertices))
      .toBe('09a93e23b794212fc51b5a192da80a30efc3553d8217732e32e0e0c2c03a3770');
    expect(typedArrayHash(right.vertices))
      .toBe('8079a66e43bf7424335d351a9bf653f273127919005a646f7c82a5496dbdcd4e');
    expect(typedArrayHash(left.faces))
      .toBe('190a5f3f846d2a64095587c7ebc6264432ca2ba904603debeb848c286282a01d');
    expect(typedArrayHash(right.faces)).toBe(typedArrayHash(left.faces));
  });

  it('rejects bad dimensions, finite values, indices, encodings, and compressed lengths', () => {
    const tetrahedron = readFixture('tetrahedron.gii');
    const gzip = readFixture('tetrahedron_gzip.gii');
    expectSurfaceLoadError(
      () => parseGIfTISurface(tetrahedron.replace('Dim1="3"', 'Dim1="2"'), DOMParserImpl),
      'invalid-dimensions'
    );
    expectSurfaceLoadError(
      () => parseGIfTISurface(tetrahedron.replace('0.0 0.0 0.0', 'NaN 0.0 0.0'), DOMParserImpl),
      'invalid-data'
    );
    expectSurfaceLoadError(
      () => parseGIfTISurface(tetrahedron.replace('0 1 2\n0 2 3', '-1 1 2\n0 2 3'), DOMParserImpl),
      'invalid-data'
    );
    expectSurfaceLoadError(
      () => parseGIfTISurface(tetrahedron.replace('Encoding="ASCII"', 'Encoding="ExternalFileBinary"'), DOMParserImpl),
      'unsupported-encoding'
    );
    expectSurfaceLoadError(
      () => parseGIfTISurface(gzip.replace('Dim0="4"', 'Dim0="3"'), DOMParserImpl),
      'invalid-dimensions'
    );
  });

  it('rejects wrong roots and malformed XML with bounded typed errors', () => {
    expectSurfaceLoadError(
      () => parseGIfTISurface('<NOT_GIFTI><DataArray /></NOT_GIFTI>', DOMParserImpl),
      'invalid-magic'
    );
    expectSurfaceLoadError(
      () => parseGIfTISurface('<GIFTI><DataArray></GIFTI>', DOMParserImpl),
      'invalid-data'
    );
  });
});

describe('FreeSurfer surface and curvature parsing', () => {
  it('parses exact big-endian triangle geometry', () => {
    const result = parseFreeSurferSurface(makeFreeSurferSurface());
    expect(result.vertices).toEqual(new Float32Array(TETRA_VERTICES));
    expect(Array.from(result.faces)).toEqual(TETRA_FACES);
  });

  it('rejects surface magic, truncation, non-finite coordinates, and invalid indices', () => {
    expectSurfaceLoadError(() => parseFreeSurferSurface(makeFreeSurferSurface(
      TETRA_VERTICES, TETRA_FACES, 0xfffffd
    )), 'invalid-magic');

    const truncated = makeFreeSurferSurface().slice(0, -1);
    expectSurfaceLoadError(() => parseFreeSurferSurface(truncated), 'truncated-data');

    const nonFinite = [...TETRA_VERTICES];
    nonFinite[2] = Number.NaN;
    expectSurfaceLoadError(
      () => parseFreeSurferSurface(makeFreeSurferSurface(nonFinite)),
      'invalid-data'
    );

    const badFaces = [...TETRA_FACES];
    badFaces[0] = 4;
    expectSurfaceLoadError(
      () => parseFreeSurferSurface(makeFreeSurferSurface(TETRA_VERTICES, badFaces)),
      'invalid-data'
    );
  });

  it('validates curvature magic, dimensions, finite values, and surface length', () => {
    expect(Array.from(parseFreeSurferCurvature(makeFreeSurferCurvature(), 4)))
      .toEqual([0.25, -0.5, 0.75, 1]);
    expectSurfaceLoadError(
      () => parseFreeSurferCurvature(makeFreeSurferCurvature([1], { magic: 0xfffffe })),
      'invalid-magic'
    );
    expectSurfaceLoadError(
      () => parseFreeSurferCurvature(makeFreeSurferCurvature(), 5),
      'invalid-dimensions'
    );
    expectSurfaceLoadError(
      () => parseFreeSurferCurvature(makeFreeSurferCurvature([1], { valuesPerVertex: 2 })),
      'invalid-dimensions'
    );
    expectSurfaceLoadError(
      () => parseFreeSurferCurvature(makeFreeSurferCurvature([Number.NaN])),
      'invalid-data'
    );
  });
});

describe('PLY parsing', () => {
  it('parses exact ASCII geometry from strings and ArrayBuffers', () => {
    const text = makePLY();
    const fromString = parsePLY(text);
    const encoded = new TextEncoder().encode(text);
    const fromBuffer = parsePLY(encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength
    ));

    expect(fromString.vertices).toEqual(new Float32Array(TETRA_VERTICES));
    expect(Array.from(fromString.faces)).toEqual(TETRA_FACES);
    expect(fromBuffer.vertices).toEqual(fromString.vertices);
    expect(fromBuffer.faces).toEqual(fromString.faces);
  });

  it('rejects unsupported encodings, non-finite coordinates, and non-integer indices', () => {
    expectSurfaceLoadError(() => parsePLY(makePLY({ format: 'binary_little_endian 1.0' })), 'unsupported-encoding');
    expectSurfaceLoadError(() => parsePLY(makePLY({ vertex: 'Infinity 0 0' })), 'invalid-data');
    expectSurfaceLoadError(() => parsePLY(makePLY({ face: '3 0 1.5 2' })), 'invalid-data');
    expectSurfaceLoadError(() => parsePLY(makePLY({ face: '3 -1 1 2' })), 'invalid-data');
    expectSurfaceLoadError(() => parsePLY(makePLY({ face: '3 0 1 4' })), 'invalid-data');
  });

  it('rejects malformed headers and truncated bodies before allocation', () => {
    expectSurfaceLoadError(() => parsePLY(makePLY().replace(/^ply/, 'not-ply')), 'invalid-magic');
    expectSurfaceLoadError(() => parsePLY(makePLY().replace('element vertex 4', 'element vertex 10000001')), 'invalid-count');
    expectSurfaceLoadError(() => parsePLY(makePLY().split('\n').slice(0, -1).join('\n')), 'truncated-data');
    expectSurfaceLoadError(
      () => parsePLY(makePLY().replace(
        'property float x\nproperty float y\nproperty float z',
        'property float z\nproperty float y\nproperty float x'
      )),
      'invalid-header'
    );
  });
});

describe('format, laterality, timeout, and abort ownership', () => {
  it('detects case-insensitive URL path formats while ignoring queries and fragments', () => {
    expect(detectSurfaceFormat('https://example.test/BRAIN.SURF.GII?download=1')).toBe('gifti');
    expect(detectSurfaceFormat('/mesh.PLY#preview')).toBe('ply');
    expect(detectSurfaceFormat('/subject/LH.PIAL?token=secret')).toBe('freesurfer');
    expect(detectSurfaceFormat('/surface.unknown')).toBeNull();
  });

  it('uses only documented unambiguous laterality tokens', () => {
    expect(detectHemisphereFromName('lh.pial')).toBe('left');
    expect(detectHemisphereFromName('subject-right.surf.gii')).toBe('right');
    expect(detectHemisphereFromName('fs_LR.32k.L.inflated.surf.gii')).toBe('left');
    expect(detectHemisphereFromName('fs_LR.32k.R.inflated.surf.gii')).toBe('right');
    expect(detectHemisphereFromName('cleft-neutral.ply')).toBe('unknown');
    expect(detectHemisphereFromName('left-right.ply')).toBe('unknown');
  });

  it('preserves unknown laterality and lets explicit input override filename inference', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(makePLY())));

    const unknown = await loadSurface('/neutral.PLY?download=1');
    const inferred = await loadSurface('/subject.RH.PLY?download=1');
    const explicit = await loadSurface('/subject.RH.PLY', 'auto', 'left');

    expect(unknown.hemisphere).toBe('unknown');
    expect(inferred.hemisphere).toBe('right');
    expect(explicit.hemisphere).toBe('left');
    unknown.dispose();
    inferred.dispose();
    explicit.dispose();
  });

  it('loads the FreeSurfer binary route with auto format and laterality detection', async () => {
    const surface = makeFreeSurferSurface();
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(surface)));

    const geometry = await loadSurface('/subjects/S01/LH.PIAL?download=1');

    expect(geometry.getVertexCount()).toBe(4);
    expect(geometry.hemisphere).toBe('left');
    geometry.dispose();
  });

  it('uses GIFTI metadata before a neutral filename and supports File auto-detection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const leftGIfTI = readFixture('fsaverage5-lh-pial.gii');
    const file = {
      name: 'NEUTRAL.GII',
      size: leftGIfTI.length,
      text: async () => leftGIfTI
    } as File;
    const geometry = await loadSurfaceFromFile(
      file,
      'auto',
      'unknown',
      false,
      100,
      { domParser: DOMParserImpl }
    );

    expect(geometry.hemisphere).toBe('left');
    expect(geometry.getVertexCount()).toBe(10_242);
    geometry.dispose();
  });

  it('keeps the timeout alive through body consumption and clears it in finally', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      })
    } as Response)));

    const loading = loadSurface('/neutral.ply', 'auto', 'unknown', 25);
    const rejection = expectAsyncSurfaceLoadError(loading, 'timeout');
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timeout after a successful parse', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(makePLY())));

    const geometry = await loadSurface('/neutral.ply', 'auto', 'unknown', 500);

    expect(vi.getTimerCount()).toBe(0);
    geometry.dispose();
  });

  it('checks the deadline again after synchronous parsing', async () => {
    let dateCalls = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => dateCalls++ < 5 ? 0 : 100);
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(makePLY())));

    await expectAsyncSurfaceLoadError(
      loadSurface('/neutral.ply', 'auto', 'unknown', 50),
      'timeout'
    );
  });

  it('propagates caller abort through body consumption as a typed aborted error', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      })
    } as Response)));

    const loading = loadSurface(
      '/neutral.ply',
      'auto',
      'unknown',
      1_000,
      false,
      100,
      { signal: controller.signal }
    );
    const rejection = expectAsyncSurfaceLoadError(loading, 'aborted');
    controller.abort();
    await rejection;
  });

  it('enforces maxBytes against encoded bytes and rejects invalid UTF-8', async () => {
    const multibyte = makePLY({ vertex: 'é 0 0' });
    const encoded = new TextEncoder().encode(multibyte);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ...textResponse(multibyte),
      headers: new Headers()
    } as Response)));

    await expectAsyncSurfaceLoadError(
      loadSurface('/neutral.ply', 'auto', 'unknown', 1_000, false, 100, {
        maxBytes: encoded.byteLength - 1
      }),
      'too-large'
    );

    const invalidUtf8 = Uint8Array.from([0x70, 0x6c, 0x79, 0xff]).buffer;
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(invalidUtf8)));
    await expectAsyncSurfaceLoadError(loadSurface('/neutral.ply'), 'invalid-data');
  });
});

describe('geometry invariant boundary', () => {
  it('rejects invalid layouts, finite values, face indices, and curvature lengths before coercion', () => {
    expect(() => new SurfaceGeometry(
      null as unknown as number[],
      [0, 1, 2],
      'unknown'
    )).toThrowError(SurfaceGeometryError);
    expect(() => new SurfaceGeometry([0, 0], [0, 1, 2], 'unknown'))
      .toThrowError(SurfaceGeometryError);
    expect(() => new SurfaceGeometry([0, 0, Number.NaN], [0, 0, 0], 'unknown'))
      .toThrowError(SurfaceGeometryError);
    expect(() => new SurfaceGeometry([0, 0, 0], [-1, 0, 0], 'unknown'))
      .toThrowError(SurfaceGeometryError);
    expect(() => new SurfaceGeometry([0, 0, 0], [0.5, 0, 0], 'unknown'))
      .toThrowError(SurfaceGeometryError);
    expect(() => new SurfaceGeometry([0, 0, 0], [0, 0, 0], 'unknown', [1, 2]))
      .toThrowError(SurfaceGeometryError);
  });

  it('makes public adjacency construction reject bad indices without a TypeError', () => {
    for (const faces of [[0, 1, 3], [0, -1, 2], [0, 1.5, 2]]) {
      expect(() => buildVertexAdjacency(faces, 3)).toThrowError(MeshAdjacencyError);
    }
    expect(() => buildVertexAdjacency(
      null as unknown as number[],
      3
    )).toThrowError(MeshAdjacencyError);
  });
});
