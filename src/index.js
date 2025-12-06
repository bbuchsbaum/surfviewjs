/**
 * SurfViewJS - Neuroimaging Surface Visualization Library
 * 
 * A comprehensive Three.js-based library for visualizing brain surfaces
 * with support for multiple data layers, colormaps, and interactive controls.
 * 
 * @module surfviewjs
 * @see {@link https://github.com/yourusername/surfviewjs} for documentation
 * @license MIT
 */

import * as THREE from 'three';
import { NeuroSurfaceViewer } from './NeuroSurfaceViewer';
import { SurfaceControls } from './SurfaceControls';
import { SurfaceGeometry, NeuroSurface, ColorMappedNeuroSurface, VertexColoredNeuroSurface } from './classes';
import { MultiLayerNeuroSurface } from './MultiLayerNeuroSurface';
import { VariantSurface } from './VariantSurface';
import { SurfaceSet } from './SurfaceSet';
import { LabeledNeuroSurface } from './LabeledNeuroSurface';
import { SurfaceFactory } from './SurfaceFactory';
import { Layer, RGBALayer, DataLayer, BaseLayer, LabelLayer, LayerStack } from './layers';
import { OutlineLayer } from './OutlineLayer';
import { CurvatureLayer } from './layers/CurvatureLayer';
import { GPULayerCompositor } from './GPULayerCompositor';
import { computeMeanCurvature, normalizeCurvature, curvatureToGrayscale } from './utils/curvature';
import { ClipPlane, ClipPlaneSet } from './utils/ClipPlane';
import { debugLog, setDebug } from './debug';
import ColorMap from './ColorMap';
import * as loaders from './loaders';
import { EventEmitter } from './EventEmitter';
import { LaplacianSmoothing } from './utils/LaplacianSmoothing';
import { BoundingBoxHelper } from './utils/BoundingBox';
import { AnnotationManager } from './annotations';
import { embedStyles, applyEmbedStyles } from './embedStyles';
import { computePickInfo } from './utils/Picking';
import { detectCapabilities } from './utils/capabilities';
import { NoopNeuroSurfaceViewer, hasDOM } from './NoopNeuroSurfaceViewer';

/**
 * Core exports for surface visualization
 * 
 * @example
 * ```javascript
 * import { 
 *   NeuroSurfaceViewer, 
 *   ColorMappedNeuroSurface, 
 *   loadSurface 
 * } from 'surfviewjs';
 * 
 * // Create viewer
 * const viewer = new NeuroSurfaceViewer(container);
 * 
 * // Load and display surface
 * const geometry = await loadSurface('brain.gii', 'gifti');
 * const surface = new ColorMappedNeuroSurface(geometry, null, data, 'viridis');
 * viewer.addSurface(surface, 'brain');
 * ```
 */
export {
  NeuroSurfaceViewer,
  SurfaceControls,
  SurfaceGeometry,
  NeuroSurface,
  ColorMappedNeuroSurface,
  VertexColoredNeuroSurface,
  MultiLayerNeuroSurface,
  VariantSurface,
  SurfaceSet,
  LabeledNeuroSurface,
  Layer,
  RGBALayer,
  DataLayer,
  BaseLayer,
  LabelLayer,
  LayerStack,
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
  hasDOM
};

// Export loaders
export * from './loaders';

// Export React components conditionally - don't break if React isn't available
// These will be handled by a separate entry point for React users

// Optionally, you can also attach these to the global window object
// This can be useful if you need to access these classes directly in the browser
if (typeof window !== 'undefined') {
  window.neurosurface = {
    NeuroSurfaceViewer,
    SurfaceGeometry,
    NeuroSurface,
    ColorMappedNeuroSurface,
    VertexColoredNeuroSurface,
    MultiLayerNeuroSurface,
    VariantSurface,
    SurfaceSet,
    LabeledNeuroSurface,
    Layer,
    RGBALayer,
    DataLayer,
    BaseLayer,
    LabelLayer,
    LayerStack,
    OutlineLayer,
    CurvatureLayer,
    computeMeanCurvature,
    normalizeCurvature,
    curvatureToGrayscale,
    ClipPlane,
    ClipPlaneSet,
    ColorMap,
    EventEmitter,
    THREE,
    debugLog,
    setDebug,
    loaders,
    BoundingBoxHelper,
    AnnotationManager,
    embedStyles,
    applyEmbedStyles,
    computePickInfo,
    SurfaceFactory,
    detectCapabilities
  };
}
debugLog('Neurosurface module initialized');
