import { SurfaceGeometry, NeuroSurface } from './classes';
import { SurfaceDefinition } from './types';

export declare class SurfaceFactory {
  static fromConfig(def: SurfaceDefinition): NeuroSurface;
  static create(def: SurfaceDefinition): NeuroSurface;
}
