// Frozen pre-refactor CPU implementation from src/layers.ts at 88a36ea40fe38967b9e73fb2964b7a18a3a673da.
// This is a compatibility oracle, not an independent scientific reference.
import * as THREE from 'three';
import type { RibbonReducer, VolumeSamplingMode } from '../../../src/layers';

export class LegacyVolumeSampler {
  constructor(
    private volumeData: Float32Array,
    private dims: [number, number, number],
    private worldToIJK: THREE.Matrix4,
    private sampling: VolumeSamplingMode,
    private ribbonWhite: Float32Array,
    private ribbonPial: Float32Array,
    private ribbonSamples: number,
    private ribbonReducer: RibbonReducer,
    private fillValue: number
  ) {}
  sampleValueAtWorldCoordinates(wx: number, wy: number, wz: number): number | null {
    const me = this.worldToIJK.elements;
    const ijkX = me[0] * wx + me[4] * wy + me[8] * wz + me[12];
    const ijkY = me[1] * wx + me[5] * wy + me[9] * wz + me[13];
    const ijkZ = me[2] * wx + me[6] * wy + me[10] * wz + me[14];
    return this.sampleValueAtIJK(ijkX, ijkY, ijkZ);
  }

  private sampleValueAtIJK(ijkX: number, ijkY: number, ijkZ: number): number | null {
    const nx = this.dims[0];
    const ny = this.dims[1];
    const nz = this.dims[2];

    const uvwX = (ijkX + 0.5) / nx;
    const uvwY = (ijkY + 0.5) / ny;
    const uvwZ = (ijkZ + 0.5) / nz;
    if (
      uvwX < 0 || uvwX > 1 ||
      uvwY < 0 || uvwY > 1 ||
      uvwZ < 0 || uvwZ > 1
    ) {
      return null;
    }

    return this.sampling === 'linear'
      ? this.sampleLinear(ijkX, ijkY, ijkZ)
      : this.sampleNearest(ijkX, ijkY, ijkZ);
  }

  private sampleNearest(ijkX: number, ijkY: number, ijkZ: number): number {
    const nx = this.dims[0];
    const ny = this.dims[1];
    const nz = this.dims[2];
    const i = Math.min(nx - 1, Math.max(0, Math.floor(ijkX + 0.5)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor(ijkY + 0.5)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor(ijkZ + 0.5)));
    // Dimensions and volume length are validated by VolumeTexture3D at construction/update.
    return this.volumeData[i + nx * j + nx * ny * k]!;
  }

  private sampleLinear(ijkX: number, ijkY: number, ijkZ: number): number {
    const nx = this.dims[0];
    const ny = this.dims[1];
    const nz = this.dims[2];
    const x0 = Math.min(nx - 1, Math.max(0, Math.floor(ijkX)));
    const y0 = Math.min(ny - 1, Math.max(0, Math.floor(ijkY)));
    const z0 = Math.min(nz - 1, Math.max(0, Math.floor(ijkZ)));
    const x1 = Math.min(nx - 1, x0 + 1);
    const y1 = Math.min(ny - 1, y0 + 1);
    const z1 = Math.min(nz - 1, z0 + 1);
    const tx = Math.min(1, Math.max(0, ijkX - x0));
    const ty = Math.min(1, Math.max(0, ijkY - y0));
    const tz = Math.min(1, Math.max(0, ijkZ - z0));

    // All coordinates are clamped to validated volume dimensions before lookup.
    const at = (i: number, j: number, k: number) =>
      this.volumeData[i + nx * j + nx * ny * k]!;
    const c00 = at(x0, y0, z0) * (1 - tx) + at(x1, y0, z0) * tx;
    const c10 = at(x0, y1, z0) * (1 - tx) + at(x1, y1, z0) * tx;
    const c01 = at(x0, y0, z1) * (1 - tx) + at(x1, y0, z1) * tx;
    const c11 = at(x0, y1, z1) * (1 - tx) + at(x1, y1, z1) * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    return c0 * (1 - tz) + c1 * tz;
  }

  sampleRibbonValue(vertexIndex: number, worldMatrixElements: ArrayLike<number>): number | null {
    if (!this.ribbonPial || !this.ribbonWhite) return null;
    const base = vertexIndex * 3;
    const values: number[] = [];
    const denom = Math.max(1, this.ribbonSamples - 1);
    for (let s = 0; s < this.ribbonSamples; s++) {
      const t = denom === 0 ? 0 : s / denom;
      // `validateRibbonForVertexCount` proves both aligned xyz triplets are present.
      const whiteX = this.ribbonWhite[base]!;
      const whiteY = this.ribbonWhite[base + 1]!;
      const whiteZ = this.ribbonWhite[base + 2]!;
      const x = whiteX + (this.ribbonPial[base]! - whiteX) * t;
      const y = whiteY + (this.ribbonPial[base + 1]! - whiteY) * t;
      const z = whiteZ + (this.ribbonPial[base + 2]! - whiteZ) * t;
      // The only caller passes Three.js Matrix4.elements, whose length is always 16.
      const wx = worldMatrixElements[0]! * x + worldMatrixElements[4]! * y +
        worldMatrixElements[8]! * z + worldMatrixElements[12]!;
      const wy = worldMatrixElements[1]! * x + worldMatrixElements[5]! * y +
        worldMatrixElements[9]! * z + worldMatrixElements[13]!;
      const wz = worldMatrixElements[2]! * x + worldMatrixElements[6]! * y +
        worldMatrixElements[10]! * z + worldMatrixElements[14]!;
      const value = this.sampleValueAtWorldCoordinates(wx, wy, wz);
      if (value !== null && isFinite(value) && Math.abs(value - this.fillValue) >= 1e-6) {
        values.push(value);
      }
    }
    if (!values.length) return null;
    switch (this.ribbonReducer) {
      case 'max':
        return Math.max(...values);
      case 'min':
        return Math.min(...values);
      case 'median': {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        // `values.length > 0`; both median positions are therefore present.
        return sorted.length % 2 === 0
          ? (sorted[mid - 1]! + sorted[mid]!) / 2
          : sorted[mid]!;
      }
      case 'mean':
      default:
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  }

}
