// Re-export all types from the main modules
export * from './types';
export * from './ColorMap';
export * from './classes';
export * from './layers';
export * from './loaders';
export * from './NeuroSurfaceViewer';
export * from './VariantSurface';
export * from './SurfaceSet';
export * from './LabeledNeuroSurface';
export * from './react/NeuroSurfaceViewer';
export * from './react/useNeuroSurface';
export * from './react/SurfaceHelpers';
export * from './utils/BoundingBox';
export * from './embedStyles';
export * from './SurfaceFactory';
export * from './utils/Picking';
export * from './annotations';
export * from './utils/capabilities';
export * from './NoopNeuroSurfaceViewer';

// Default exports
export { default as NeuroSurfaceViewer } from './NeuroSurfaceViewer';
export { default as NeuroSurfaceViewerReact } from './react/NeuroSurfaceViewer';

// Re-export THREE.js for convenience
import * as THREE from 'three';
export { THREE };
