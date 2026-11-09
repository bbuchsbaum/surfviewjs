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

    const defaultPositions = config.variants[config.defaultVariant];
    if (!defaultPositions) {
      throw new Error(`SurfaceSet: defaultVariant "${config.defaultVariant}" missing in variants map`);
    }

    const faceMod = this.faces.length % 3;
    if (faceMod !== 0) {
      throw new Error(`SurfaceSet: faces length must be multiple of 3 (got ${this.faces.length})`);
    }

    const basePositions = new Float32Array(defaultPositions);
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
          debugLog('SurfaceSet: ignoring curv for', name, '; expected', this.vertexCount, 'values, got', arr.length);
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

  /**
   * Add or replace an embedding after construction (a geometry loaded or
   * computed later). The positions are copied and must match the set's
   * vertex count; curvature of another length is ignored, as in the
   * constructor.
   */
  addVariant(name: string, positions: Float32Array | number[], curv?: Float32Array | number[]): void {
    if (!name) throw new Error('SurfaceSet: variant name must be non-empty');
    const arr = new Float32Array(positions);
    if (arr.length !== this.vertexCount * 3) {
      throw new Error(`SurfaceSet: variant "${name}" vertex count ${arr.length / 3} does not match default ${this.vertexCount}`);
    }
    this.variants[name] = arr;
    if (curv) {
      const values = new Float32Array(curv);
      if (values.length === this.vertexCount) this.curv[name] = values;
      else debugLog('SurfaceSet: ignoring curv for', name, '; expected', this.vertexCount, 'values, got', values.length);
    }
  }

  /**
   * Remove an embedding. The default variant cannot be removed (it defines
   * the set); returns false for it and for unknown names.
   */
  removeVariant(name: string): boolean {
    if (name === this.defaultVariant || !(name in this.variants)) return false;
    delete this.variants[name];
    delete this.curv[name];
    return true;
  }
}
