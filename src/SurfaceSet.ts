import { debugLog } from './debug';

export interface SurfaceSetConfig {
  faces: Uint32Array | number[];
  hemi: string;
  defaultVariant: string;
  variants: Record<string, Float32Array | number[]>;
  curv?: Record<string, Float32Array | number[]>;
  meta?: Record<string, any>;
}

/**
 * Holds multiple surface embeddings that share identical topology.
 * Faces are shared; each variant supplies a vertex position array.
 */
export class SurfaceSet {
  faces: Uint32Array;
  hemi: string;
  defaultVariant: string;
  variants: Record<string, Float32Array>;
  curv: Record<string, Float32Array>;
  meta: Record<string, any>;
  vertexCount: number;

  constructor(config: SurfaceSetConfig) {
    this.faces = new Uint32Array(config.faces);
    this.hemi = config.hemi;
    this.defaultVariant = config.defaultVariant;
    this.variants = {};
    this.curv = {};
    this.meta = config.meta || {};

    if (!config.variants[config.defaultVariant]) {
      throw new Error(`SurfaceSet: defaultVariant "${config.defaultVariant}" missing in variants map`);
    }

    const faceMod = this.faces.length % 3;
    if (faceMod !== 0) {
      throw new Error(`SurfaceSet: faces length must be multiple of 3 (got ${this.faces.length})`);
    }

    const basePositions = new Float32Array(config.variants[config.defaultVariant]);
    if (basePositions.length % 3 !== 0) {
      throw new Error('SurfaceSet: default variant vertex array length must be multiple of 3');
    }
    this.vertexCount = basePositions.length / 3;
    this.variants[config.defaultVariant] = basePositions;

    Object.entries(config.variants).forEach(([name, positions]) => {
      const arr = new Float32Array(positions);
      if (arr.length !== basePositions.length) {
        throw new Error(`SurfaceSet: variant "${name}" vertex count ${arr.length / 3} does not match default ${this.vertexCount}`);
      }
      this.variants[name] = arr;
    });

    if (config.curv) {
      Object.entries(config.curv).forEach(([name, values]) => {
        const arr = new Float32Array(values);
        if (arr.length !== this.vertexCount) {
          debugLog(`SurfaceSet: ignoring curv for ${name}; expected ${this.vertexCount} values, got ${arr.length}`);
          return;
        }
        this.curv[name] = arr;
      });
    }
  }

  getVariantNames(): string[] {
    return Object.keys(this.variants);
  }

  hasVariant(name: string): boolean {
    return name in this.variants;
  }

  getPositions(name: string): Float32Array {
    const positions = this.variants[name];
    if (!positions) {
      throw new Error(`SurfaceSet: variant "${name}" not found`);
    }
    return positions;
  }

  getCurv(name: string): Float32Array | null {
    return this.curv[name] || null;
  }
}
