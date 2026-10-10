import { THREE } from '@src/index.js';
import type { AlignmentTransform, AlignmentVolume } from '@src/index.js';
import { FOCI, seededRandom } from './data';

/**
 * Alignment QA inputs for the Data in & out chapter: a synthetic BOLD-reference-like
 * volume built from the real fsaverage5 left pial mesh, and the transforms to test.
 */

/** Orbitofrontal cortex, where susceptibility dropout is typical in BOLD images (left, MNI). */
const ORBITOFRONTAL: readonly [number, number, number] = [-24, 34, -18];

export interface SyntheticReference {
  volume: AlignmentVolume;
  voxelSize: number;
  center: [number, number, number];
}

/**
 * Splat the pial vertices into a voxel grid (`voxelSize` mm, `margin` mm beyond the mesh),
 * blur, and attenuate the signal around the orbitofrontal cortex and temporal pole as
 * susceptibility dropout would. Bright voxels lie on the cortical ribbon, so a correctly
 * placed surface sits on them. Deterministic.
 */
export function syntheticReference(vertices: Float32Array, voxelSize = 3, margin = 14): SyntheticReference {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, vertices[i + a]!);
      max[a] = Math.max(max[a]!, vertices[i + a]!);
    }
  }
  const origin = min.map(value => value - margin) as [number, number, number];
  const dims = max.map((value, a) => Math.ceil((value + margin - origin[a]!) / voxelSize) + 1) as [number, number, number];
  const [nx, ny, nz] = dims;
  const density = new Float32Array(nx * ny * nz);
  const sigma = 1.1; // voxels
  for (let i = 0; i < vertices.length; i += 3) {
    const fi = (vertices[i]! - origin[0]) / voxelSize;
    const fj = (vertices[i + 1]! - origin[1]) / voxelSize;
    const fk = (vertices[i + 2]! - origin[2]) / voxelSize;
    for (let k = Math.floor(fk) - 2; k <= Math.ceil(fk) + 2; k++) {
      for (let j = Math.floor(fj) - 2; j <= Math.ceil(fj) + 2; j++) {
        for (let n = Math.floor(fi) - 2; n <= Math.ceil(fi) + 2; n++) {
          if (n < 0 || j < 0 || k < 0 || n >= nx || j >= ny || k >= nz) continue;
          const d2 = (n - fi) ** 2 + (j - fj) ** 2 + (k - fk) ** 2;
          density[n + nx * (j + ny * k)]! += Math.exp(-d2 / (2 * sigma * sigma));
        }
      }
    }
  }
  const random = seededRandom(7);
  const data = new Float32Array(density.length);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let n = 0; n < nx; n++) {
        const index = n + nx * (j + ny * k);
        const world = [origin[0] + n * voxelSize, origin[1] + j * voxelSize, origin[2] + k * voxelSize];
        let attenuation = 1;
        for (const [focus, width] of [[ORBITOFRONTAL, 16], [FOCI.temporalPole, 13]] as const) {
          const d2 = (world[0]! - focus[0]) ** 2 + (world[1]! - focus[1]) ** 2 + (world[2]! - focus[2]) ** 2;
          attenuation *= 1 - 0.97 * Math.exp(-d2 / (2 * width * width));
        }
        data[index] = (1 - Math.exp(-density[index]! / 1.6)) * attenuation + 0.03 * random();
      }
    }
  }
  const voxelToWorld = [
    voxelSize, 0, 0, 0,
    0, voxelSize, 0, 0,
    0, 0, voxelSize, 0,
    origin[0], origin[1], origin[2], 1
  ];
  return {
    volume: { id: 'synthetic-boldref', data, dims, voxelToWorld, space: 'boldref', dropoutThreshold: 0.2 },
    voxelSize,
    center: [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2]
  };
}

export type TransformName = 'aligned' | 'shifted' | 'rotated';

export const TRANSFORMS: ReadonlyArray<{ value: TransformName; label: string }> = [
  { value: 'aligned', label: 'Aligned' },
  { value: 'shifted', label: 'Shifted 16 mm (x)' },
  { value: 'rotated', label: 'Rotated 8° (z)' }
];

/** Surface (anat) to reference (boldref) transform under test. */
export function alignmentTransform(name: TransformName, center: [number, number, number]): AlignmentTransform {
  const matrix = new THREE.Matrix4();
  if (name === 'shifted') matrix.makeTranslation(16, 0, 0);
  if (name === 'rotated') {
    const [cx, cy, cz] = center;
    matrix.makeTranslation(cx, cy, cz)
      .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(8)))
      .multiply(new THREE.Matrix4().makeTranslation(-cx, -cy, -cz));
  }
  return {
    id: name === 'aligned' ? 'anat-to-boldref' : `anat-to-boldref-${name}`,
    from: 'anat',
    to: 'boldref',
    matrix,
    provenance: { source: 'SurfView demo, synthetic' }
  };
}
