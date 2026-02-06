/**
 * SurfViewJS - Neuroimaging Surface Visualization Library
 *
 * A comprehensive Three.js-based library for visualizing brain surfaces
 * with support for multiple data layers, colormaps, and interactive controls.
 *
 * @module surfviewjs
 * @see {@link https://github.com/bbuchsbaum/surfviewjs} for documentation
 * @license MIT
 */

import * as THREE from 'three';
import { NeuroSurfaceViewer } from './NeuroSurfaceViewer';
import { SurfaceControls } from './SurfaceControls';
import { SurfaceGeometry, NeuroSurface, ColorMappedNeuroSurface, VertexColoredNeuroSurface } from './classes';
import { MultiLayerNeuroSurface } from './MultiLayerNeuroSurface';
import { VariantSurface } from './VariantSurface';
import { MorphableSurface, Easing } from './MorphableSurface';
import { SurfaceSet } from './SurfaceSet';
import { LabeledNeuroSurface } from './LabeledNeuroSurface';
import { SurfaceFactory } from './SurfaceFactory';
import { Layer, RGBALayer, DataLayer, TwoDataLayer, BaseLayer, LabelLayer, LayerStack, VolumeProjectionLayer } from './layers';
import ColorMap2D from './ColorMap2D';
import { OutlineLayer } from './OutlineLayer';
import { CurvatureLayer } from './layers/CurvatureLayer';
import { GPULayerCompositor } from './GPULayerCompositor';
import { computeMeanCurvature, normalizeCurvature, curvatureToGrayscale } from './utils/curvature';
import { ClipPlane, ClipPlaneSet } from './utils/ClipPlane';
import { debugLog, setDebug } from './debug';
import ColorMap from './ColorMap';
import { EventEmitter } from './EventEmitter';
import { LaplacianSmoothing } from './utils/LaplacianSmoothing';
import { BoundingBoxHelper } from './utils/BoundingBox';
import { AnnotationManager } from './annotations';
import { embedStyles, applyEmbedStyles } from './embedStyles';
import { computePickInfo } from './utils/Picking';
import { GPUPicker } from './utils/GPUPicker';
import { CrosshairManager } from './CrosshairManager';
import { TemporalDataLayer, TimelineController, SparklineOverlay } from './temporal';
import { detectCapabilities } from './utils/capabilities';

// Register TemporalDataLayer with Layer factory to avoid circular dependency
Layer.registerTemporalLayer(TemporalDataLayer);
import { NoopNeuroSurfaceViewer, hasDOM } from './NoopNeuroSurfaceViewer';
import { VolumeTexture3D } from './textures/VolumeTexture3D';
import { VolumeProjectionMaterial } from './materials/VolumeProjectionMaterial';
import { VolumeProjectedSurface } from './surfaces/VolumeProjectedSurface';
import { createColormapTexture } from './textures/createColormapTexture';

export {
  NeuroSurfaceViewer,
  SurfaceControls,
  SurfaceGeometry,
  NeuroSurface,
  ColorMappedNeuroSurface,
  VertexColoredNeuroSurface,
  MultiLayerNeuroSurface,
  VariantSurface,
  MorphableSurface,
  Easing,
  SurfaceSet,
  LabeledNeuroSurface,
  Layer,
  RGBALayer,
  DataLayer,
  TwoDataLayer,
  BaseLayer,
  LabelLayer,
  LayerStack,
  VolumeProjectionLayer,
  ColorMap2D,
  OutlineLayer,
  CurvatureLayer,
  GPULayerCompositor,
  computeMeanCurvature,
  normalizeCurvature,
  curvatureToGrayscale,
  ClipPlane,
  ClipPlaneSet,
  ColorMap,
  EventEmitter,
  LaplacianSmoothing,
  THREE,
  debugLog,
  setDebug,
  BoundingBoxHelper,
  AnnotationManager,
  detectCapabilities,
  embedStyles,
  applyEmbedStyles,
  computePickInfo,
  SurfaceFactory,
  NoopNeuroSurfaceViewer,
  hasDOM,
  GPUPicker,
  CrosshairManager,
  TemporalDataLayer,
  TimelineController,
  SparklineOverlay,
  VolumeTexture3D,
  VolumeProjectionMaterial,
  VolumeProjectedSurface,
  createColormapTexture
};

// Export temporal types for TypeScript consumers
export type {
  TemporalDataConfig,
  FactorDescriptor,
  TimelineState,
  TimelineEvent,
  LoopMode,
  SparklineOptions
} from './temporal';

// Export loaders
export * from './loaders';

// Export event types
export * from './events';
