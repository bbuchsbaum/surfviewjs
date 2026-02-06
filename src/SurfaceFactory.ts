import * as THREE from 'three';
import { SurfaceGeometry, NeuroSurface, ColorMappedNeuroSurface, VertexColoredNeuroSurface } from './classes';
import { MultiLayerNeuroSurface } from './MultiLayerNeuroSurface';
import { VariantSurface } from './VariantSurface';
import { SurfaceSet } from './SurfaceSet';
import { LabeledNeuroSurface, LabelDefinition } from './LabeledNeuroSurface';

export type SurfaceType = 'multi-layer' | 'color-mapped' | 'vertex-colored' | 'variant' | 'labeled';

export interface SurfaceDefinition {
  type: SurfaceType;
  id?: string;
  vertices: Float32Array | number[];
  faces: Uint32Array | number[];
  hemisphere?: string;
  vertexCurv?: Float32Array | number[] | null;
  indices?: Uint32Array | number[] | null;
  data?: Float32Array | number[];
  colors?: (number | string | THREE.Color)[];
  colorMap?: string;
  surfaceSet?: SurfaceSet;
  variants?: Record<string, Float32Array | number[]>;
  defaultVariant?: string;
  curv?: Record<string, Float32Array | number[]>;
  labels?: Uint32Array | number[];
  labelDefs?: LabelDefinition[];
  config?: Record<string, any>;
  layers?: any[]; // For multi-layer; pass through to consumer
}

export class SurfaceFactory {
  static fromConfig(def: SurfaceDefinition): NeuroSurface {
    const geometry = new SurfaceGeometry(
      def.vertices,
      def.faces,
      def.hemisphere || 'unknown',
      def.vertexCurv ?? null
    );

    switch (def.type) {
      case 'multi-layer':
        return new MultiLayerNeuroSurface(geometry, def.config);
      case 'color-mapped':
        return new ColorMappedNeuroSurface(
          geometry,
          def.indices ?? null,
          def.data ?? new Float32Array(geometry.vertices.length / 3),
          def.colorMap || 'jet',
          def.config
        );
      case 'vertex-colored':
        if (!def.colors) {
          throw new Error('vertex-colored surface requires colors array');
        }
        return new VertexColoredNeuroSurface(
          geometry,
          def.indices ?? null,
          def.colors as any,
          def.config
        );
      case 'variant': {
        if (def.surfaceSet) {
          return new VariantSurface(def.surfaceSet, def.config);
        }
        if (!def.variants || !def.defaultVariant) {
          throw new Error('variant surface requires variants and defaultVariant');
        }
        const set = new SurfaceSet({
          faces: def.faces,
          hemi: def.hemisphere || 'unknown',
          defaultVariant: def.defaultVariant,
          variants: def.variants,
          curv: def.curv
        });
        return new VariantSurface(set, def.config);
      }
      case 'labeled': {
        if (!def.labels || !def.labelDefs) {
          throw new Error('labeled surface requires labels and labelDefs');
        }
        const geometryForLabels = geometry;
        return new LabeledNeuroSurface(
          geometryForLabels,
          def.indices ?? null,
          def.labels,
          def.labelDefs,
          def.config
        );
      }
      default:
        throw new Error(`Unsupported surface type: ${def.type}`);
    }
  }

  // alias for ergonomics
  static create(def: SurfaceDefinition): NeuroSurface {
    return SurfaceFactory.fromConfig(def);
  }
}
