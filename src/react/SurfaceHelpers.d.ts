import { SurfaceGeometry, ColorMappedNeuroSurface, VertexColoredNeuroSurface, MultiLayerNeuroSurface, SurfaceConfig } from '../classes';
import { RGBALayer, DataLayer, BaseLayer, LayerConfig } from '../layers';
import { ColorMapName, ColorMap } from '../ColorMap';
import { Hemisphere } from '../types';
import * as THREE from 'three';

export declare const SurfaceHelpers: {
  createGeometry: (
    vertices: Float32Array | number[],
    faces: Uint32Array | number[],
    hemisphere: Hemisphere,
    vertexCurv?: Float32Array | number[] | null
  ) => SurfaceGeometry;
  
  createMultiLayerSurface: (
    geometry: SurfaceGeometry,
    config?: SurfaceConfig & { baseColor?: number }
  ) => MultiLayerNeuroSurface;
  
  createColorMappedSurface: (
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[],
    data: Float32Array | number[],
    colorMap: ColorMapName | string | ColorMap | string[],
    config?: SurfaceConfig
  ) => ColorMappedNeuroSurface;
  
  createVertexColoredSurface: (
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[],
    colors: (number | string | THREE.Color)[],
    config?: SurfaceConfig
  ) => VertexColoredNeuroSurface;
  
  createRGBALayer: (
    id: string,
    rgbaData: Float32Array | number[],
    config?: LayerConfig
  ) => RGBALayer;
  
  createDataLayer: (
    id: string,
    data: Float32Array | number[],
    indices: Uint32Array | number[] | null,
    colorMap: ColorMapName | string | ColorMap | string[],
    config?: LayerConfig & { range?: [number, number]; threshold?: [number, number] }
  ) => DataLayer;
  
  createBaseLayer: (
    color?: number,
    config?: LayerConfig
  ) => BaseLayer;
};