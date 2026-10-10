import { SurfaceGeometry, computeMeanCurvature, loadSurface, normalizeCurvature } from '@src/index.js';
import type { Hemisphere } from '@src/index.js';

/** Real meshes shipped with the repository (see tests/data and demo/data READMEs). */
export const MESH_URLS = {
  fsaverage5Left: new URL('../../tests/data/fsaverage5-lh-pial.gii', import.meta.url).href,
  fsaverage5Right: new URL('../../tests/data/fsaverage5-rh-pial.gii', import.meta.url).href,
  fsLR32kLeftInflated: new URL('../../tests/data/fs_LR.32k.L.inflated.surf.gii', import.meta.url).href
} as const;

export type MeshName = keyof typeof MESH_URLS;

interface MeshArrays {
  vertices: Float32Array;
  faces: Uint32Array;
  hemisphere: Hemisphere;
}

const meshCache = new Map<MeshName, Promise<MeshArrays>>();
const curvatureCache = new Map<MeshName, Float32Array>();

function hemisphereOf(name: MeshName): Hemisphere {
  return name === 'fsaverage5Right' ? 'right' : 'left';
}

async function loadArrays(name: MeshName): Promise<MeshArrays> {
  let pending = meshCache.get(name);
  if (!pending) {
    pending = loadSurface(MESH_URLS[name], 'gifti', hemisphereOf(name)).then(geometry => ({
      vertices: geometry.vertices.slice(),
      faces: geometry.faces.slice(),
      hemisphere: hemisphereOf(name)
    }));
    pending.catch(() => meshCache.delete(name));
    meshCache.set(name, pending);
  }
  return pending;
}

/**
 * A fresh SurfaceGeometry for a real mesh. Parsing is cached; every call gets its own
 * geometry so disposing one chapter's surface never affects another chapter.
 */
export async function loadMesh(name: MeshName): Promise<SurfaceGeometry> {
  const arrays = await loadArrays(name);
  return new SurfaceGeometry(arrays.vertices.slice(), arrays.faces.slice(), arrays.hemisphere);
}

export async function loadBilateral(): Promise<{ left: SurfaceGeometry; right: SurfaceGeometry }> {
  const [left, right] = await Promise.all([loadMesh('fsaverage5Left'), loadMesh('fsaverage5Right')]);
  return { left, right };
}

/** Normalised mean curvature for a mesh (cached), ready for a curvature underlay. */
export function curvatureOf(name: MeshName, geometry: SurfaceGeometry): Float32Array {
  let curvature = curvatureCache.get(name);
  if (!curvature) {
    curvature = normalizeCurvature(computeMeanCurvature(geometry)) as Float32Array;
    curvatureCache.set(name, curvature);
  }
  return curvature.slice();
}

/** A Gaussian blob in the mesh's own millimetre coordinates. */
export interface Blob {
  /** Centre in the surface's RAS millimetre frame. */
  center: readonly [number, number, number];
  /** Signed peak value. */
  amplitude: number;
  /** Spatial standard deviation in millimetres. */
  sigma: number;
}

/**
 * Approximate MNI-space foci on the fsaverage pial surface (left hemisphere, x < 0;
 * mirror x for the right). They place synthetic effects where a reader expects them;
 * they are not results.
 */
export const FOCI = {
  primaryVisual: [-10, -92, 2],
  motorHand: [-38, -22, 58],
  auditory: [-52, -20, 8],
  inferiorFrontal: [-48, 22, 12],
  intraparietal: [-30, -58, 48],
  medialPrefrontal: [-6, 50, 12],
  temporalPole: [-38, 12, -32],
  posteriorCingulate: [-6, -54, 28]
} as const satisfies Record<string, readonly [number, number, number]>;

export function mirror(point: readonly [number, number, number]): [number, number, number] {
  return [-point[0], point[1], point[2]];
}

/** Sum of Gaussian blobs evaluated per vertex. Deterministic. */
export function blobField(vertices: Float32Array, blobs: readonly Blob[], baseline = 0): Float32Array {
  const values = new Float32Array(vertices.length / 3);
  for (let v = 0; v < values.length; v++) {
    const x = vertices[v * 3]!, y = vertices[v * 3 + 1]!, z = vertices[v * 3 + 2]!;
    let value = baseline;
    for (const blob of blobs) {
      const dx = x - blob.center[0], dy = y - blob.center[1], dz = z - blob.center[2];
      value += blob.amplitude * Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * blob.sigma * blob.sigma));
    }
    values[v] = value;
  }
  return values;
}

/** Small deterministic pseudo-random generator (mulberry32) so demos look the same every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spatially smooth noise: a fixed set of low-frequency waves. Deterministic for a seed. */
export function smoothNoise(vertices: Float32Array, seed: number, amplitude = 1, wavelengthMm = 40): Float32Array {
  const random = seededRandom(seed);
  const waves = Array.from({ length: 6 }, () => {
    const theta = random() * Math.PI * 2, phi = Math.acos(2 * random() - 1);
    return {
      k: [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)] as const,
      phase: random() * Math.PI * 2
    };
  });
  const frequency = (2 * Math.PI) / wavelengthMm;
  const values = new Float32Array(vertices.length / 3);
  for (let v = 0; v < values.length; v++) {
    const x = vertices[v * 3]!, y = vertices[v * 3 + 1]!, z = vertices[v * 3 + 2]!;
    let sum = 0;
    for (const wave of waves) {
      sum += Math.sin(frequency * (wave.k[0] * x + wave.k[1] * y + wave.k[2] * z) + wave.phase);
    }
    values[v] = (amplitude * sum) / waves.length;
  }
  return values;
}

/** Add two fields in place into a new array. */
export function addFields(a: Float32Array, b: Float32Array, scaleB = 1): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + scaleB * b[i]!;
  return out;
}

/** Atlas data shipped in demo/data, with licences and provenance READMEs beside them. */
export const ATLAS_URLS = {
  glasser: new URL('../data/glasser/left-fslr32k.json', import.meta.url).href,
  schaefer400x7: new URL('../data/schaefer/left-fslr32k-7networks.json', import.meta.url).href,
  schaefer400x17: new URL('../data/schaefer/left-fslr32k-17networks.json', import.meta.url).href
} as const;

export interface AtlasFile {
  atlas: string;
  parcels: Array<{ id: number; label: string; hemi?: string; color?: string; [key: string]: unknown }>;
  vertexLabels: number[];
  source?: Record<string, unknown>;
}

const atlasCache = new Map<keyof typeof ATLAS_URLS, Promise<AtlasFile>>();

export function loadAtlas(name: keyof typeof ATLAS_URLS): Promise<AtlasFile> {
  let pending = atlasCache.get(name);
  if (!pending) {
    pending = fetch(ATLAS_URLS[name]).then(response => {
      if (!response.ok) throw new Error(`Could not load atlas ${name}: HTTP ${response.status}`);
      return response.json() as Promise<AtlasFile>;
    });
    pending.catch(() => atlasCache.delete(name));
    atlasCache.set(name, pending);
  }
  return pending;
}
